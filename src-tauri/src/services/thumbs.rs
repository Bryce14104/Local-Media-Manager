//! Low-resolution JPEG previews.
//!
//! JPEG and PNG files are decoded and scaled. RAW files are not demosaiced:
//! the largest embedded JPEG preview is scaled instead. Work stays off the UI
//! thread; see `generate_missing_thumbnails`.

use crate::db::Library;
use crate::models::{MediaKind, ThumbnailReady};
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const MAX_EDGE: u32 = 480;
const MAX_SOURCE: u64 = 80 * 1024 * 1024;
const MIN_EMBEDDED: usize = 2 * 1024;

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

/// Write a JPEG preview for `source` and return the records that changed.
pub fn generate_missing_thumbnails(library: &Library) -> Vec<ThumbnailReady> {
    let Ok(media) = library.list_media() else {
        return Vec::new();
    };
    let directory = thumbnail_dir(library);
    if std::fs::create_dir_all(&directory).is_err() {
        return Vec::new();
    }

    let mut ready = Vec::new();
    for record in media {
        if record.media_kind == MediaKind::Video {
            continue;
        }
        if let Some(path) = record.thumbnail_path.as_deref()
            && Path::new(path).is_file()
        {
            continue;
        }
        let Some(hash) = record.content_hash.as_deref() else {
            continue;
        };
        let destination = directory.join(format!("{hash}.jpg"));
        if write_thumbnail(Path::new(&record.file_path), &destination).is_err() {
            continue;
        }
        if library.set_thumbnail(&record.file_path, &destination.to_string_lossy()).is_err() {
            continue;
        }
        ready.push(ThumbnailReady {
            id: record.id,
            file_path: record.file_path,
            thumbnail_path: destination.to_string_lossy().into_owned(),
            media_kind: record.media_kind,
        });
    }
    ready
}

pub fn write_thumbnail(source: &Path, destination: &Path) -> Result<(), ThumbError> {
    let image = load_preview(source)?;
    let thumb = image.resize(MAX_EDGE, MAX_EDGE, FilterType::Triangle);
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|err| ThumbError::Io(err.to_string()))?;
    }
    thumb
        .save_with_format(destination, ImageFormat::Jpeg)
        .map_err(|err| ThumbError::Decode(err.to_string()))
}

fn load_preview(source: &Path) -> Result<DynamicImage, ThumbError> {
    let kind = source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(kind.as_str(), "jpg" | "jpeg" | "png" | "gif" | "bmp") {
        return image::open(source).map_err(|err| ThumbError::Decode(err.to_string()));
    }
    let embedded = extract_largest_jpeg(source).ok_or(ThumbError::Empty)?;
    image::load_from_memory(&embedded).map_err(|err| ThumbError::Decode(err.to_string()))
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
