//! Grid posters, 720p stills, and a 3 fps web-playable video proxy.
//!
//! Stills and RAW embedded JPEGs are scaled in-process. Video posters come
//! from one ffmpeg frame. The lightbox paints the 720p JPEG immediately; a
//! H.264 MP4 next to it is what the webview can actually play while the
//! original disk is unplugged. Work stays off the UI thread; see
//! `generate_missing_thumbnails`.

use crate::db::Library;
use crate::models::{MediaKind, MediaRecord, ThumbnailReady};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ExtendedColorType};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

const MAX_EDGE: u32 = 480;
const PROXY_EDGE: u32 = 1280;
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
pub fn generate_missing_thumbnails_with<F, E>(library: &Library, mut progress: F, mut emit: E) -> Vec<ThumbnailReady>
where
    F: FnMut(usize, usize),
    E: FnMut(&ThumbnailReady),
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
            if !Path::new(&record.file_path).is_file() {
                return false;
            }
            if record.media_kind == MediaKind::Video && !ffmpeg {
                return false;
            }
            preview_incomplete(record.thumbnail_path.as_deref(), record.media_kind)
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
        }
        if !valid_jpeg(&destination) {
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
        let (proxy, mut play) = sidecar_ready(&destination);
        let mut item = ThumbnailReady {
            id: record.id,
            file_path: record.file_path,
            thumbnail_path: destination.to_string_lossy().into_owned(),
            proxy_path: proxy,
            play_path: play.clone(),
            media_kind: record.media_kind,
        };
        emit(&item);
        if record.media_kind == MediaKind::Video && play.is_none() {
            if let Err(error) = write_playable(Path::new(&item.file_path), &play_path(&destination)) {
                eprintln!("shelf index: playback proxy failed for {}: {error}", item.file_path);
            }
            play = existing_file(&play_path(&destination));
            item.play_path = play;
            emit(&item);
        }
        ready.push(item);
        progress(index + 1, total);
    }
    ready
}

pub fn attach_sidecars(record: &mut MediaRecord) {
    let Some(thumb) = record.thumbnail_path.as_deref() else {
        return;
    };
    let (proxy, play) = sidecar_ready(Path::new(thumb));
    record.proxy_path = proxy;
    record.play_path = play;
}

fn sidecar_ready(thumb: &Path) -> (Option<String>, Option<String>) {
    let proxy = existing_file(&proxy_path(thumb)).or_else(|| existing_file(&legacy_proxy_path(thumb)));
    (proxy, existing_file(&play_path(thumb)))
}

fn existing_file(path: &Path) -> Option<String> {
    path.is_file().then(|| path.to_string_lossy().into_owned())
}

pub fn proxy_path(thumbnail: &Path) -> PathBuf {
    let stem = thumbnail.file_stem().unwrap_or_default().to_string_lossy();
    thumbnail.with_file_name(format!("{stem}.720.jpg"))
}

fn legacy_proxy_path(thumbnail: &Path) -> PathBuf {
    let stem = thumbnail.file_stem().unwrap_or_default().to_string_lossy();
    thumbnail.with_file_name(format!("{stem}.1080.jpg"))
}

pub fn play_path(thumbnail: &Path) -> PathBuf {
    let stem = thumbnail.file_stem().unwrap_or_default().to_string_lossy();
    thumbnail.with_file_name(format!("{stem}.play.mp4"))
}

pub fn write_thumbnail(source: &Path, destination: &Path) -> Result<(), ThumbError> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|err| ThumbError::Io(err.to_string()))?;
    }
    let need_thumb = !valid_jpeg(destination);
    let need_proxy = !valid_jpeg(&proxy_path(destination));
    if need_thumb || need_proxy {
        let image = decode_preview(source)?;
        if need_proxy {
            save_fitted(&image, PROXY_EDGE, &proxy_path(destination))?;
        }
        if need_thumb {
            save_fitted(&image, MAX_EDGE, destination)?;
        }
    }
    if !valid_jpeg(destination) {
        return Err(ThumbError::Empty);
    }
    Ok(())
}

fn preview_incomplete(thumbnail: Option<&str>, kind: MediaKind) -> bool {
    let Some(path) = thumbnail else {
        return true;
    };
    let thumb = Path::new(path);
    if !thumb.is_file() || (!proxy_path(thumb).is_file() && !legacy_proxy_path(thumb).is_file()) {
        return true;
    }
    kind == MediaKind::Video && !play_path(thumb).is_file()
}

fn save_fitted(image: &DynamicImage, edge: u32, destination: &Path) -> Result<(), ThumbError> {
    if image.width() <= edge && image.height() <= edge {
        return save_jpeg(image, destination);
    }
    save_jpeg(&image.resize(edge, edge, FilterType::Triangle), destination)
}

fn save_jpeg(image: &DynamicImage, destination: &Path) -> Result<(), ThumbError> {
    let tmp = destination.with_extension("part.jpg");
    {
        let mut file = File::create(&tmp).map_err(|err| ThumbError::Io(err.to_string()))?;
        let rgb = image.to_rgb8();
        let mut encoder = JpegEncoder::new_with_quality(&mut file, 82);
        encoder
            .encode(rgb.as_raw(), rgb.width(), rgb.height(), ExtendedColorType::Rgb8)
            .map_err(|err| ThumbError::Decode(err.to_string()))?;
    }
    std::fs::rename(&tmp, destination).map_err(|err| ThumbError::Io(err.to_string()))
}

fn valid_jpeg(path: &Path) -> bool {
    let Ok(bytes) = std::fs::read(path) else {
        return false;
    };
    bytes.len() > 100 && bytes.starts_with(&[0xff, 0xd8])
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
        return decode_still(source);
    }
    let embedded = extract_largest_jpeg(source).ok_or(ThumbError::Empty)?;
    image::load_from_memory(&embedded).map_err(|err| ThumbError::Decode(err.to_string()))
}

fn decode_still(source: &Path) -> Result<DynamicImage, ThumbError> {
    if let Ok(image) = image::open(source) {
        return Ok(image);
    }
    let embedded = extract_largest_jpeg(source).ok_or_else(|| {
        ThumbError::Decode(format!("could not decode {}", source.display()))
    })?;
    image::load_from_memory(&embedded).map_err(|err| ThumbError::Decode(err.to_string()))
}

fn is_video(kind: &str) -> bool {
    matches!(kind, "mp4" | "mov" | "m4v" | "mkv" | "avi" | "webm")
}

fn ffmpeg_available() -> bool {
    ffmpeg_bin().is_some()
}

fn ffmpeg_bin() -> Option<PathBuf> {
    static BIN: OnceLock<Option<PathBuf>> = OnceLock::new();
    BIN.get_or_init(|| {
        let candidates = [
            "ffmpeg",
            "ffmpeg.exe",
            "/usr/bin/ffmpeg",
            "/usr/local/bin/ffmpeg",
            "/opt/homebrew/bin/ffmpeg",
            "/snap/bin/ffmpeg",
            "/opt/ffmpeg/bin/ffmpeg",
        ];
        for candidate in candidates {
            let path = PathBuf::from(candidate);
            if ffmpeg_runs(&path) {
                return Some(path);
            }
        }
        eprintln!("shelf index: install ffmpeg to build video posters and playback proxies");
        None
    })
    .clone()
}

fn ffmpeg_runs(bin: &Path) -> bool {
    Command::new(bin)
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn grab_video_frame(source: &Path) -> Result<DynamicImage, ThumbError> {
    let bin = ffmpeg_bin().ok_or_else(|| ThumbError::Decode("ffmpeg is not installed".into()))?;
    let out = std::env::temp_dir().join(format!(
        "shelf-frame-{}-{}.jpg",
        std::process::id(),
        FRAME_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    for seek in ["0.4", "0"] {
        if grab_at(&bin, source, seek, &out) {
            let image = image::open(&out).map_err(|err| ThumbError::Decode(err.to_string()));
            let _ = std::fs::remove_file(&out);
            return image;
        }
    }
    let _ = std::fs::remove_file(&out);
    Err(ThumbError::Empty)
}

fn grab_at(bin: &Path, source: &Path, seek: &str, out: &Path) -> bool {
    let ok = Command::new(bin)
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-ss", seek, "-i"])
        .arg(source)
        .args(["-frames:v", "1", "-q:v", "3"])
        .arg(out)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success());
    ok && jpeg_file(out)
}

pub fn write_playable(source: &Path, destination: &Path) -> Result<(), ThumbError> {
    let bin = ffmpeg_bin().ok_or_else(|| ThumbError::Decode("ffmpeg is not installed".into()))?;
    let tmp = destination.with_extension("part.mp4");
    let ok = transcode(&bin, source, &tmp, true) || transcode(&bin, source, &tmp, false);
    if ok && mp4_file(&tmp) {
        std::fs::rename(&tmp, destination).map_err(|err| ThumbError::Io(err.to_string()))?;
        return Ok(());
    }
    let _ = std::fs::remove_file(&tmp);
    Err(ThumbError::Decode("could not write a playable mp4".into()))
}

fn transcode(bin: &Path, source: &Path, destination: &Path, audio: bool) -> bool {
    let mut command = Command::new(bin);
    command
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"])
        .arg(source)
        .args([
            "-map",
            "0:v:0",
            "-vf",
            "fps=3,scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "28",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
        ]);
    let _ = audio;
    command
        .arg(destination)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn jpeg_file(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|meta| meta.len() > 100)
}

fn mp4_file(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|meta| meta.len() > 500)
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
    use image::ImageFormat;

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
        assert!(!play_path(&destination).is_file());
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
        write_playable(&source, &play_path(&destination)).unwrap();
        let play = std::fs::read(play_path(&destination)).unwrap();
        assert!(play.len() > 500);
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
