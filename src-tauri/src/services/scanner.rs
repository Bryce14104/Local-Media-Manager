//! Recursive media discovery.
//!
//! Scanning uses `walkdir`. `jwalk` is faster, but release 0.9 marks that
//! crate unmaintained, so Shelf stays on `walkdir`.
//!
//! Hidden names (anything starting with `.`) are skipped, and the root the
//! user chose is still scanned even when that folder itself is hidden.
//! Symbolic links are not followed.

use crate::models::{MediaKind, ScannedFile};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use walkdir::WalkDir;

const HASH_BUFFER: usize = 1024 * 1024;

#[derive(Debug, Error)]
pub enum ScanError {
    #[error("{0} does not exist")]
    Missing(String),
    #[error("{0} is not a directory")]
    NotDirectory(String),
    #[error("cannot read {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("{0} is not a photo or video Shelf can read")]
    Unsupported(String),
}

#[derive(Debug)]
pub struct ScanBatch {
    pub files: Vec<ScannedFile>,
    pub errors: Vec<String>,
}

/// Walk `root` and return media files. Non-media files are ignored.
pub fn scan_directory(root: &Path) -> Result<ScanBatch, ScanError> {
    if !root.exists() {
        return Err(ScanError::Missing(root.display().to_string()));
    }
    if !root.is_dir() {
        return Err(ScanError::NotDirectory(root.display().to_string()));
    }

    let mut files = Vec::new();
    let mut errors = Vec::new();

    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| entry.depth() == 0 || !is_hidden(entry.file_name()));

    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                push_note(&mut errors, err.to_string());
                continue;
            }
        };

        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let Some(media_kind) = classify(path) else {
            continue;
        };

        match scanned_file(path, media_kind) {
            Ok(file) => files.push(file),
            Err(err) => push_note(&mut errors, err.to_string()),
        }
    }

    Ok(ScanBatch { files, errors })
}

/// Read one media file. Directories and other file types are errors.
pub fn describe_file(path: &Path) -> Result<ScannedFile, ScanError> {
    if !path.exists() {
        return Err(ScanError::Missing(path.display().to_string()));
    }
    if !path.is_file() {
        return Err(ScanError::NotDirectory(path.display().to_string()));
    }
    let Some(media_kind) = classify(path) else {
        return Err(ScanError::Unsupported(path.display().to_string()));
    };
    scanned_file(path, media_kind)
}

/// SHA-256 of the file bytes, as lowercase hex.
pub fn hash_file(path: &Path) -> Result<String, ScanError> {
    let mut file = File::open(path).map_err(|source| io_error(path, source))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; HASH_BUFFER];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|source| io_error(path, source))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(encode_hex(hasher.finalize().as_ref()))
}

pub fn classify(path: &Path) -> Option<MediaKind> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tif" | "tiff" | "heic" | "heif"
        | "avif" => MediaKind::Image,
        "raw" | "cr2" | "cr3" | "nef" | "arw" | "dng" | "orf" | "rw2" | "raf" | "pef" | "srw" => {
            MediaKind::Raw
        }
        "mp4" | "mov" | "m4v" | "mkv" | "avi" | "webm" => MediaKind::Video,
        _ => return None,
    })
}

fn scanned_file(path: &Path, media_kind: MediaKind) -> Result<ScannedFile, ScanError> {
    let metadata = std::fs::metadata(path).map_err(|source| io_error(path, source))?;
    Ok(ScannedFile {
        path: path.to_path_buf(),
        file_size: metadata.len(),
        created_at: metadata.created().ok().and_then(unix_time),
        modified_at: metadata.modified().ok().and_then(unix_time).unwrap_or(0),
        media_kind,
    })
}

fn is_hidden(name: &std::ffi::OsStr) -> bool {
    name.as_encoded_bytes().first() == Some(&b'.')
}

fn unix_time(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64)
}

fn io_error(path: &Path, source: std::io::Error) -> ScanError {
    ScanError::Io {
        path: path.display().to_string(),
        source,
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn push_note(errors: &mut Vec<String>, message: String) {
    if errors.len() < 50 {
        errors.push(message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_keeps_media_and_skips_hidden_and_other_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("cat.JPG"), b"jpeg-bytes").unwrap();
        std::fs::write(root.join("notes.txt"), b"hello").unwrap();
        std::fs::write(root.join(".secret.png"), b"hidden").unwrap();
        std::fs::create_dir(root.join("roll")).unwrap();
        std::fs::write(root.join("roll").join("frame.dng"), b"raw").unwrap();
        std::fs::write(root.join("roll").join("clip.MP4"), b"video").unwrap();
        std::fs::create_dir(root.join(".cache")).unwrap();
        std::fs::write(root.join(".cache").join("thumb.jpg"), b"nope").unwrap();

        let batch = scan_directory(root).unwrap();
        let mut names: Vec<_> = batch
            .files
            .iter()
            .map(|file| {
                file.path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();

        assert_eq!(names, vec!["cat.JPG", "clip.MP4", "frame.dng"]);
        assert!(
            batch.files.iter().any(|file| {
                file.path.ends_with("frame.dng") && file.media_kind == MediaKind::Raw
            })
        );
        assert!(batch.files.iter().any(|file| {
            file.path.ends_with("clip.MP4") && file.media_kind == MediaKind::Video
        }));
    }

    #[test]
    fn hash_is_stable_lowercase_sha256() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cat.jpg");
        std::fs::write(&path, b"jpeg-bytes").unwrap();

        let first = hash_file(&path).unwrap();
        let second = hash_file(&path).unwrap();
        assert_eq!(first, second);
        assert_eq!(
            first,
            "0111dbc398b94eacda6759809c050530868ee7e313b3381c2f95ce8b55331c50"
        );
    }

    #[test]
    fn missing_path_and_file_path_are_errors() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope");
        assert!(matches!(
            scan_directory(&missing).unwrap_err(),
            ScanError::Missing(_)
        ));

        let file = dir.path().join("photo.jpg");
        std::fs::write(&file, b"x").unwrap();
        assert!(matches!(
            scan_directory(&file).unwrap_err(),
            ScanError::NotDirectory(_)
        ));
    }
}
