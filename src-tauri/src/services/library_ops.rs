//! Import preview, relink, library health, virtual copies, working previews.

use super::scanner::{hash_file, scan_directory};
use super::thumbs::{self, extract_largest_jpeg, thumbnail_dir};
use super::volumes;
use crate::db::{DbError, Library};
use crate::models::MediaRecord;
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ExtendedColorType};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub root: String,
    pub volume_label: String,
    pub volume_mount: String,
    pub new_count: usize,
    pub known_count: usize,
    pub new_files: Vec<ImportFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryHealth {
    pub media_count: usize,
    pub online: usize,
    pub offline: usize,
    pub missing: Vec<MissingOriginal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingOriginal {
    pub id: i64,
    pub path: String,
    pub volume_label: Option<String>,
    pub hint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkReport {
    pub relinked: usize,
    pub scanned: usize,
}

pub use crate::models::catalog_path;

pub fn preview_import(library: &Library, root: &Path) -> Result<ImportPreview, super::ServiceError> {
    let volume = volumes::detect(root);
    let batch = scan_directory(root)?;
    let mut new_files = Vec::new();
    let mut known_count = 0;
    let mut new_count = 0;
    for file in batch.files {
        let path = file.path_string();
        let known = library.find_by_path(&path)?.is_some()
            || library
                .find_by_volume_relative(&volume.fingerprint, &volumes::relative_to(&file.path, &volume.mount))?
                .is_some();
        if known {
            known_count += 1;
            continue;
        }
        new_count += 1;
        if new_files.len() < 80 {
            new_files.push(ImportFile {
                name: file
                    .path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.clone()),
                path,
                size: file.file_size,
                kind: file.media_kind.as_str().to_string(),
            });
        }
    }
    Ok(ImportPreview {
        root: root.display().to_string(),
        volume_label: volume.label,
        volume_mount: volume.mount,
        new_count,
        known_count,
        new_files,
    })
}

pub fn relink_folder(library: &Library, root: &Path) -> Result<RelinkReport, super::ServiceError> {
    let batch = scan_directory(root)?;
    let mut relinked = 0;
    let scanned = batch.files.len();
    for file in batch.files {
        let path = file.path_string();
        if library.find_by_path(&path)?.is_some() {
            continue;
        }
        let Ok(hash) = hash_file(&file.path) else {
            continue;
        };
        if let Some(existing) = library.find_by_hash(&hash)? {
            let volume = volumes::detect(&file.path);
            let volume_id = library.upsert_volume(&volume.fingerprint, &volume.label, &volume.mount)?;
            let relative = volumes::relative_to(&file.path, &volume.mount);
            library.set_file_path(existing.id, &path)?;
            library.set_volume(existing.id, volume_id, &relative)?;
            relinked += 1;
        }
    }
    Ok(RelinkReport { relinked, scanned })
}

pub fn library_health(library: &Library) -> Result<LibraryHealth, DbError> {
    let mut media = library.list_media()?;
    super::hydrate_origins(library, &mut media);
    let mut online = 0;
    let mut offline = 0;
    let mut missing = Vec::new();
    for record in media {
        if record.original_online {
            online += 1;
            continue;
        }
        offline += 1;
        let volume_online = record
            .volume_mount
            .as_deref()
            .is_some_and(|mount| Path::new(mount).is_dir());
        if volume_online {
            missing.push(MissingOriginal {
                id: record.id,
                path: catalog_path(&record.file_path).to_string(),
                volume_label: record.volume_label.clone(),
                hint: record.plug_hint.unwrap_or_else(|| {
                    format!(
                        "{} is connected but this file is gone",
                        record.volume_label.unwrap_or_else(|| "Drive".into())
                    )
                }),
            });
        }
    }
    Ok(LibraryHealth {
        media_count: online + offline,
        online,
        offline,
        missing,
    })
}

pub fn clone_virtual(library: &Library, path: &str) -> Result<MediaRecord, DbError> {
    library.clone_virtual(path)
}

pub fn working_preview(library: &Library, path: &str) -> Result<String, super::ServiceError> {
    let real = PathBuf::from(catalog_path(path));
    if !real.is_file() {
        return Err(super::ServiceError::Scan(super::scanner::ScanError::Missing(
            real.display().to_string(),
        )));
    }
    let ext = real
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp") {
        return Ok(real.display().to_string());
    }
    let record = library.find_by_path(path)?;
    let hash = record
        .as_ref()
        .and_then(|row| row.content_hash.clone())
        .unwrap_or_else(|| format!("work-{}", real.display()));
    let dest = thumbnail_dir(library).join(format!("{hash}.work.jpg"));
    if dest.is_file() && dest.metadata().map(|meta| meta.len() > 1000).unwrap_or(false) {
        return Ok(dest.display().to_string());
    }
    if let Some(jpeg) = extract_largest_jpeg(&real) {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&dest, jpeg)?;
        return Ok(dest.display().to_string());
    }
    if let Ok(image) = thumbs::decode_preview(&real) {
        save_full_jpeg(&image, &dest)?;
        return Ok(dest.display().to_string());
    }
    Err(super::ServiceError::Scan(super::scanner::ScanError::Unsupported(
        real.display().to_string(),
    )))
}

fn save_full_jpeg(image: &DynamicImage, destination: &Path) -> Result<(), super::ServiceError> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let rgb = image.to_rgb8();
    let mut file = std::fs::File::create(destination)?;
    let mut encoder = JpegEncoder::new_with_quality(&mut file, 90);
    encoder
        .encode(rgb.as_raw(), rgb.width(), rgb.height(), ExtendedColorType::Rgb8)
        .map_err(|err| super::ServiceError::Scan(super::scanner::ScanError::Io {
            path: destination.display().to_string(),
            source: std::io::Error::other(err.to_string()),
        }))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn virtual_suffix_is_stripped_for_disk_paths() {
        assert_eq!(catalog_path("/Volumes/E/roll/a.dng::v99"), "/Volumes/E/roll/a.dng");
        assert_eq!(catalog_path("/Volumes/E/roll/a.dng"), "/Volumes/E/roll/a.dng");
    }

    #[test]
    fn preview_counts_new_files_without_hashing() {
        let dir = tempfile::tempdir().unwrap();
        let library = crate::db::Library::open(dir.path().join("library.sqlite")).unwrap();
        let roll = dir.path().join("card");
        std::fs::create_dir(&roll).unwrap();
        std::fs::write(roll.join("a.jpg"), b"jpeg-bytes").unwrap();
        let preview = preview_import(&library, &roll).unwrap();
        assert_eq!(preview.new_count, 1);
        assert_eq!(preview.known_count, 0);
    }
}
