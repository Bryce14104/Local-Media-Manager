//! Grid posters and 1080p proxies.
//!
//! Stills and RAW embedded JPEGs are scaled in-process. Video posters come
//! from one ffmpeg frame, then the same scaler writes a 480px grid JPEG and a
//! long-edge 1920 JPEG the lightbox can show before the original file decodes.
//! Work stays off the UI thread; see `generate_missing_thumbnails`.

use crate::db::Library;
use crate::models::{MediaKind, ThumbnailReady};
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

const MAX_EDGE: u32 = 480;
const PROXY_EDGE: u32 = 1920;
const MAX_SOURCE: u64 = 80 * 1024 * 1024;
const MIN_EMBEDDED: usize = 2 * 1024;
static FRAME_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
pub enum ThumbError {
    Io(String),
    Decode(String),
    Empty,
}

impl std::fmt::Display for ThumbError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) | Self::Decode(message) => formatter.write_str(message),
            Self::Empty => formatter.write_str("no preview in this file"),
        }
    }
}

pub fn thumbnail_dir(library: &Library) -> PathBuf {
    library
        .database_path()
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("thumbnails")
}

/// Write a JPEG preview for each file that does not have one yet.
pub fn generate_missing_thumbnails_with<F>(library: &Library, mut progress: F) -> Vec<ThumbnailReady>
where
    F: FnMut(usize, usize),
{
    let Ok(media) = library.list_media() else {
        progress(0, 0);
        return Vec::new();
    };
    let directory = thumbnail_dir(library);
    if std::fs::create_dir_all(&directory).is_err() {
        progress(0, 0);
        return Vec::new();
    }

    let ffmpeg = ffmpeg_available();
    let pending: Vec<_> = media
        .into_iter()
        .filter(|record| {
            if record.content_hash.is_none() {
                return false;
            }
            if record.media_kind == MediaKind::Video && !ffmpeg {
                return false;
            }
            preview_incomplete(record.thumbnail_path.as_deref())
        })
        .collect();
    let total = pending.len();
    progress(0, total);

    let mut ready = Vec::new();
    for (index, record) in pending.into_iter().enumerate() {
        let Some(hash) = record.content_hash.as_deref() else {
            progress(index + 1, total);
            continue;
        };
        let destination = directory.join(format!("{hash}.jpg"));
        eprintln!("shelf index: writing preview {}", record.file_path);
        if let Err(error) = write_thumbnail(Path::new(&record.file_path), &destination) {
            eprintln!("shelf index: preview failed for {}: {error}", record.file_path);
            progress(index + 1, total);
            continue;
        }
        if library
            .set_thumbnail(&record.file_path, &destination.to_string_lossy())
            .is_err()
        {
            progress(index + 1, total);
            continue;
        }
        ready.push(ThumbnailReady {
            id: record.id,
            file_path: record.file_path,
            thumbnail_path: destination.to_string_lossy().into_owned(),
            media_kind: record.media_kind,
        });
        progress(index + 1, total);
    }
    ready
}

pub fn proxy_path(thumbnail: &Path) -> PathBuf {
    let stem = thumbnail.file_stem().unwrap_or_default().to_string_lossy();
    thumbnail.with_file_name(format!("{stem}.1080.jpg"))
}

pub fn write_thumbnail(source: &Path, destination: &Path) -> Result<(), ThumbError> {
    let image = decode_preview(source)?;
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|err| ThumbError::Io(err.to_string()))?;
    }
    save_fitted(&image, PROXY_EDGE, &proxy_path(destination))?;
    save_fitted(&image, MAX_EDGE, destination)
}

fn preview_incomplete(thumbnail: Option<&str>) -> bool {
    let Some(path) = thumbnail else {
        return true;
    };
    let thumb = Path::new(path);
    !thumb.is_file() || !proxy_path(thumb).is_file()
}

fn save_fitted(image: &DynamicImage, edge: u32, destination: &Path) -> Result<(), ThumbError> {
    if image.width() <= edge && image.height() <= edge {
        return save_jpeg(image, destination);
    }
    save_jpeg(&image.resize(edge, edge, FilterType::Triangle), destination)
}

fn save_jpeg(image: &DynamicImage, destination: &Path) -> Result<(), ThumbError> {
    image
        .save_with_format(destination, ImageFormat::Jpeg)
        .map_err(|err| ThumbError::Decode(err.to_string()))
}

pub fn decode_preview(source: &Path) -> Result<DynamicImage, ThumbError> {
    let kind = source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if is_video(&kind) {
        return grab_video_frame(source);
    }
    if matches!(kind.as_str(), "jpg" | "jpeg" | "png" | "gif" | "bmp") {
        return image::open(source).map_err(|err| ThumbError::Decode(err.to_string()));
    }
    let embedded = extract_largest_jpeg(source).ok_or(ThumbError::Empty)?;
    image::load_from_memory(&embedded).map_err(|err| ThumbError::Decode(err.to_string()))
}

fn is_video(kind: &str) -> bool {
    matches!(kind, "mp4" | "mov" | "m4v" | "mkv" | "avi" | "webm")
}

fn ffmpeg_available() -> bool {
    static READY: OnceLock<bool> = OnceLock::new();
    *READY.get_or_init(|| {
        let ok = Command::new("ffmpeg")
            .arg("-version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success());
        if !ok {
            eprintln!("shelf index: install ffmpeg to build video posters");
        }
        ok
    })
}

fn grab_video_frame(source: &Path) -> Result<DynamicImage, ThumbError> {
    if !ffmpeg_available() {
        return Err(ThumbError::Decode("ffmpeg is not installed".into()));
    }
    let out = std::env::temp_dir().join(format!(
        "shelf-frame-{}-{}.jpg",
        std::process::id(),
        FRAME_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    for seek in ["0.4", "0"] {
        if grab_at(source, seek, &out) {
            let image = image::open(&out).map_err(|err| ThumbError::Decode(err.to_string()));
            let _ = std::fs::remove_file(&out);
            return image;
        }
    }
    let _ = std::fs::remove_file(&out);
    Err(ThumbError::Empty)
}

fn grab_at(source: &Path, seek: &str, out: &Path) -> bool {
    let scaled = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-ss",
            seek,
            "-i",
        ])
        .arg(source)
        .args(["-frames:v", "1", "-vf", "scale='min(1920,iw)':-2"])
        .arg(out)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success());
    if scaled && jpeg_file(out) {
        return true;
    }
    let plain = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-ss", seek, "-i"])
        .arg(source)
        .args(["-frames:v", "1"])
        .arg(out)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success());
    plain && jpeg_file(out)
}

fn jpeg_file(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|meta| meta.len() > 100)
}

pub fn extract_largest_jpeg(path: &Path) -> Option<Vec<u8>> {
    let bytes = read_capped(path).ok()?;
    largest_jpeg(&bytes)
}

fn largest_jpeg(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut best: Option<Vec<u8>> = None;
    let mut index = 0;
    while index + 1 < bytes.len() {
        if bytes[index] != 0xff || bytes[index + 1] != 0xd8 {
            index += 1;
            continue;
        }
        let mut end = index + 2;
        while end + 1 < bytes.len() {
            if bytes[end] == 0xff && bytes[end + 1] == 0xd9 {
                let slice = &bytes[index..end + 2];
                if slice.len() >= MIN_EMBEDDED && best.as_ref().is_none_or(|current| slice.len() > current.len()) {
                    best = Some(slice.to_vec());
                }
                index = end + 2;
                break;
            }
            end += 1;
        }
        if end + 1 >= bytes.len() {
            break;
        }
    }
    best
}

fn read_capped(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    if len <= MAX_SOURCE {
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        return Ok(bytes);
    }
    let mut head = vec![0_u8; 24 * 1024 * 1024];
    let read = file.read(&mut head)?;
    head.truncate(read);
    file.seek(SeekFrom::End(-8 * 1024 * 1024))?;
    let mut tail = Vec::new();
    file.read_to_end(&mut tail)?;
    head.extend(tail);
    Ok(head)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn largest_embedded_jpeg_is_chosen() {
        let mut jpeg = vec![0xff, 0xd8];
        jpeg.extend(std::iter::repeat(0x11).take(MIN_EMBEDDED));
        jpeg.extend_from_slice(&[0xff, 0xd9]);
        let mut bytes = b"header".to_vec();
        bytes.extend_from_slice(&jpeg);
        bytes.extend_from_slice(b"tail");
        let found = largest_jpeg(&bytes).expect("jpeg");
        assert!(found.starts_with(&[0xff, 0xd8]));
        assert!(found.ends_with(&[0xff, 0xd9]));
        assert!(found.len() > MIN_EMBEDDED);
    }

    #[test]
    fn jpeg_file_becomes_a_jpeg_thumbnail() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("frame.jpg");
        let picture = image::RgbImage::from_pixel(16, 12, image::Rgb([32, 96, 140]));
        picture.save_with_format(&source, ImageFormat::Jpeg).unwrap();
        let destination = dir.path().join("thumbs").join("frame.jpg");
        write_thumbnail(&source, &destination).unwrap();
        let written = std::fs::read(&destination).unwrap();
        assert!(written.starts_with(&[0xff, 0xd8]));
        assert!(written.len() > 100);
        let proxy = std::fs::read(proxy_path(&destination)).unwrap();
        assert!(proxy.starts_with(&[0xff, 0xd8]));
        assert!(proxy.len() > 100);
    }

    #[test]
    fn ffmpeg_writes_a_poster_and_a_proxy_for_mp4() {
        if !ffmpeg_available() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("clip.mp4");
        let status = Command::new("ffmpeg")
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=0x206080:s=640x360:d=1",
                "-frames:v",
                "12",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "ffmpeg could not write a sample clip");
        let destination = dir.path().join("thumbs").join("clip.jpg");
        write_thumbnail(&source, &destination).unwrap();
        assert!(std::fs::read(&destination).unwrap().starts_with(&[0xff, 0xd8]));
        assert!(std::fs::read(proxy_path(&destination)).unwrap().starts_with(&[0xff, 0xd8]));
    }

    #[test]
    fn a_video_without_a_decodable_frame_does_not_panic() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("clip.mov");
        std::fs::write(&source, b"not a movie").unwrap();
        let destination = dir.path().join("thumbs").join("clip.jpg");
        assert!(write_thumbnail(&source, &destination).is_err());
    }

    #[test]
    fn raw_thumbnail_comes_from_the_embedded_jpeg() {
        let dir = tempfile::tempdir().unwrap();
        let inner = dir.path().join("inner.jpg");
        let mut picture = image::RgbImage::new(640, 480);
        for (x, y, pixel) in picture.enumerate_pixels_mut() {
            *pixel = image::Rgb([(x % 255) as u8, (y % 255) as u8, 80]);
        }
        picture.save_with_format(&inner, ImageFormat::Jpeg).unwrap();
        let jpeg = std::fs::read(&inner).unwrap();
        assert!(jpeg.len() >= MIN_EMBEDDED, "embedded preview {} bytes", jpeg.len());
        let mut raw = b"ARW\0".to_vec();
        raw.extend(std::iter::repeat(0).take(4096));
        raw.extend_from_slice(&jpeg);
        let source = dir.path().join("frame.arw");
        std::fs::write(&source, &raw).unwrap();
        let destination = dir.path().join("thumbs").join("frame.jpg");
        write_thumbnail(&source, &destination).unwrap();
        assert!(std::fs::read(&destination).unwrap().starts_with(&[0xff, 0xd8]));
    }
}
