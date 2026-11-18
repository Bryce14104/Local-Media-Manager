//! Import preview, relink, library health, virtual copies, working previews.

use super::scanner::{hash_file, scan_directory};
use super::thumbs::{self, extract_largest_jpeg, thumbnail_dir};
use super::volumes;
use crate::db::{DbError, Library};
use crate::models::{MediaKind, MediaRecord};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ExtendedColorType};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelReport {
    pub destination: String,
    pub media_count: usize,
    pub previews: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XmpReport {
    pub path: String,
    pub wrote: bool,
}

pub fn eject_volume(mount: &str) -> Result<(), super::ServiceError> {
    let mount = mount.trim();
    if mount.is_empty() {
        return Err(super::ServiceError::Empty);
    }
    let status = if cfg!(target_os = "macos") {
        Command::new("diskutil").args(["eject", mount]).status()
    } else if cfg!(target_os = "linux") {
        Command::new("umount").arg(mount).status()
    } else {
        return Err(super::ServiceError::Scan(super::scanner::ScanError::Io {
            path: mount.to_string(),
            source: std::io::Error::other("eject is not available on this OS"),
        }));
    };
    match status {
        Ok(code) if code.success() => Ok(()),
        Ok(_) => Err(super::ServiceError::Scan(super::scanner::ScanError::Io {
            path: mount.to_string(),
            source: std::io::Error::other("the volume did not eject"),
        })),
        Err(err) => Err(super::ServiceError::Io(err)),
    }
}

pub fn export_travel_library(
    library: &Library,
    dest: &Path,
    ids: &[i64],
) -> Result<TravelReport, super::ServiceError> {
    std::fs::create_dir_all(dest)?;
    let sqlite = dest.join("library.sqlite");
    if sqlite.exists() {
        let _ = std::fs::remove_file(&sqlite);
    }
    library.vacuum_into(&sqlite)?;
    let packed = Library::open(&sqlite)?;
    if !ids.is_empty() {
        packed.keep_media_ids(ids)?;
    }
    let previews = dest.join("previews");
    std::fs::create_dir_all(&previews)?;
    let mut copied = 0;
    let media = packed.list_media()?;
    for record in &media {
        let Some(thumb) = record.thumbnail_path.as_deref() else {
            continue;
        };
        let source = Path::new(thumb);
        if !source.is_file() {
            continue;
        }
        let name = source.file_name().unwrap_or_default();
        let target = previews.join(name);
        std::fs::copy(source, &target)?;
        copied += 1;
        if let Some(stem) = source.file_stem() {
            let stem = stem.to_string_lossy();
            let parent = source.parent().unwrap_or_else(|| Path::new("."));
            for extra in [format!("{stem}.720.jpg"), format!("{stem}.play.mp4"), format!("{stem}.1080.jpg")] {
                let extra_src = parent.join(&extra);
                if extra_src.is_file() {
                    let _ = std::fs::copy(&extra_src, previews.join(&extra));
                    copied += 1;
                }
            }
        }
        packed.rewrite_thumbnail_path(record.id, &target.display().to_string())?;
    }
    Ok(TravelReport {
        destination: dest.display().to_string(),
        media_count: media.len(),
        previews: copied,
    })
}

pub fn write_xmp(library: &Library, path: &str) -> Result<XmpReport, super::ServiceError> {
    let record = library
        .find_by_path(path)?
        .ok_or_else(|| DbError::NotFound(path.to_string()))?;
    let disk = PathBuf::from(catalog_path(&record.file_path));
    if !disk.is_file() {
        return Ok(XmpReport {
            path: disk.display().to_string(),
            wrote: false,
        });
    }
    let sidecar = PathBuf::from(format!("{}.xmp", disk.display()));
    let xml = xmp_document(&record);
    std::fs::write(&sidecar, xml)?;
    Ok(XmpReport {
        path: sidecar.display().to_string(),
        wrote: true,
    })
}

pub fn xmp_document(record: &MediaRecord) -> String {
    let rating = record.rating.unwrap_or(0);
    let flag = match record.flag.as_deref() {
        Some("pick") => "Accepted",
        Some("reject") => "Rejected",
        _ => "",
    };
    let keywords = record
        .keywords
        .iter()
        .map(|word| format!("      <rdf:li>{}</rdf:li>", xml_escape(word)))
        .collect::<Vec<_>>()
        .join("\n");
    let notes = record.notes.clone().unwrap_or_default();
    let gps = match (record.exif.as_ref().and_then(|exif| exif.latitude), record.exif.as_ref().and_then(|exif| exif.longitude)) {
        (Some(lat), Some(lon)) => format!(
            "   <exif:GPSLatitude>{}</exif:GPSLatitude>\n   <exif:GPSLongitude>{}</exif:GPSLongitude>\n",
            lat as f64 / 1_000_000.0,
            lon as f64 / 1_000_000.0
        ),
        _ => String::new(),
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:exif="http://ns.adobe.com/exif/1.0/"
    xmp:Rating="{rating}">
   <dc:description>
    <rdf:Alt><rdf:li xml:lang="x-default">{notes}</rdf:li></rdf:Alt>
   </dc:description>
   <dc:subject>
    <rdf:Bag>
{keywords}
    </rdf:Bag>
   </dc:subject>
   <photoshop:Urgency>{flag}</photoshop:Urgency>
{gps}  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
"#
    )
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn export_subclip(
    library: &Library,
    path: &str,
    dest: &Path,
) -> Result<String, super::ServiceError> {
    let record = library
        .find_by_path(path)?
        .ok_or_else(|| DbError::NotFound(path.to_string()))?;
    if record.media_kind != MediaKind::Video {
        return Err(super::ServiceError::Scan(super::scanner::ScanError::Unsupported(
            path.to_string(),
        )));
    }
    let disk = PathBuf::from(catalog_path(&record.file_path));
    let source = if disk.is_file() {
        disk
    } else if let Some(play) = record.play_path.as_deref().filter(|value| Path::new(value).is_file()) {
        PathBuf::from(play)
    } else {
        return Err(super::ServiceError::Scan(super::scanner::ScanError::Missing(
            record.file_path,
        )));
    };
    let start = record.mark_in_ms.unwrap_or(0);
    let end = record.mark_out_ms;
    thumbs::write_subclip(&source, dest, start, end).map_err(|err| {
        super::ServiceError::Scan(super::scanner::ScanError::Io {
            path: dest.display().to_string(),
            source: std::io::Error::other(err.to_string()),
        })
    })?;
    Ok(dest.display().to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadReport {
    pub copied: usize,
    pub missing: Vec<String>,
}

/// Copy full-resolution files onto this computer and point the catalog at the copies.
pub fn download_originals(
    library: &Library,
    paths: &[String],
    dest: &Path,
) -> Result<DownloadReport, super::ServiceError> {
    std::fs::create_dir_all(dest)?;
    let mut copied = 0;
    let mut missing = Vec::new();
    for path in paths {
        let disk = PathBuf::from(catalog_path(path));
        if !disk.is_file() {
            missing.push(path.clone());
            continue;
        }
        let name = disk.file_name().unwrap_or_default();
        let mut target = dest.join(name);
        if target.exists() && target != disk {
            let stem = disk.file_stem().and_then(|s| s.to_str()).unwrap_or("frame");
            let ext = disk.extension().and_then(|s| s.to_str()).unwrap_or("");
            target = dest.join(format!("{stem}-local.{ext}"));
        }
        if target != disk {
            std::fs::copy(&disk, &target)?;
        }
        let volume = volumes::detect(&target);
        let volume_id = library.upsert_volume(&volume.fingerprint, &volume.label, &volume.mount)?;
        let relative = volumes::relative_to(&target, &volume.mount);
        if let Some(record) = library.find_by_path(path)? {
            library.set_file_path(record.id, &target.display().to_string())?;
            library.set_volume(record.id, volume_id, &relative)?;
        }
        copied += 1;
    }
    Ok(DownloadReport { copied, missing })
}

pub fn fill_video_meta(library: &Library, path: &str) -> Result<MediaRecord, super::ServiceError> {
    let record = library
        .find_by_path(path)?
        .ok_or_else(|| DbError::NotFound(path.to_string()))?;
    let disk = PathBuf::from(catalog_path(&record.file_path));
    if record.media_kind != MediaKind::Video || !disk.is_file() {
        return Ok(record);
    }
    if let Some(probe) = thumbs::probe_video(&disk) {
        let json = serde_json::to_string(&probe)?;
        library.set_video_json(&record.file_path, &json)?;
    }
    Ok(library.find_by_path(path)?.ok_or_else(|| DbError::NotFound(path.to_string()))?)
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
    fn xmp_includes_rating_and_keywords() {
        let record = crate::models::MediaRecord {
            id: 1,
            file_path: "/tmp/a.jpg".into(),
            content_hash: None,
            file_size: 1,
            created_at: None,
            modified_at: 0,
            indexed_at: 0,
            rating: Some(4),
            media_kind: MediaKind::Image,
            exif: None,
            captured_at: None,
            thumbnail_path: None,
            proxy_path: None,
            play_path: None,
            flag: Some("pick".into()),
            color_label: None,
            rotation: 0,
            notes: Some("keep".into()),
            keywords: vec!["beach".into()],
            develop_json: None,
            volume_id: None,
            volume_label: None,
            volume_mount: None,
            relative_path: None,
            original_online: true,
            plug_hint: None,
            cull_hint: None,
            mark_in_ms: None,
            mark_out_ms: None,
            video: None,
        };
        let xml = xmp_document(&record);
        assert!(xml.contains("xmp:Rating=\"4\""));
        assert!(xml.contains("<rdf:li>beach</rdf:li>"));
        assert!(xml.contains("Accepted"));
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

    #[test]
    fn travel_pack_copies_the_catalog_slice() {
        let dir = tempfile::tempdir().unwrap();
        let library = crate::db::Library::open(dir.path().join("library.sqlite")).unwrap();
        library
            .upsert_media(crate::db::NewMedia {
                file_path: "/photos/keep.jpg",
                content_hash: "aa",
                file_size: 4,
                created_at: None,
                modified_at: 1,
                media_kind: MediaKind::Image,
                exif_json: None,
                captured_at: None,
                volume_id: None,
                relative_path: None,
            })
            .unwrap();
        library
            .upsert_media(crate::db::NewMedia {
                file_path: "/photos/drop.jpg",
                content_hash: "bb",
                file_size: 4,
                created_at: None,
                modified_at: 1,
                media_kind: MediaKind::Image,
                exif_json: None,
                captured_at: None,
                volume_id: None,
                relative_path: None,
            })
            .unwrap();
        let keep = library.find_by_path("/photos/keep.jpg").unwrap().unwrap().id;
        let dest = dir.path().join("travel");
        let report = export_travel_library(&library, &dest, &[keep]).unwrap();
        assert_eq!(report.media_count, 1);
        let packed = crate::db::Library::open(dest.join("library.sqlite")).unwrap();
        assert_eq!(packed.list_media().unwrap().len(), 1);
        assert!(packed.find_by_path("/photos/keep.jpg").unwrap().is_some());
        assert!(packed.find_by_path("/photos/drop.jpg").unwrap().is_none());
    }

    #[test]
    fn download_moves_the_catalog_path_onto_this_computer() {
        let dir = tempfile::tempdir().unwrap();
        let library = crate::db::Library::open(dir.path().join("library.sqlite")).unwrap();
        let source = dir.path().join("card");
        std::fs::create_dir(&source).unwrap();
        let file = source.join("keep.dng");
        std::fs::write(&file, b"raw-bytes").unwrap();
        library
            .upsert_media(crate::db::NewMedia {
                file_path: file.to_str().unwrap(),
                content_hash: "cc",
                file_size: 9,
                created_at: None,
                modified_at: 1,
                media_kind: MediaKind::Raw,
                exif_json: None,
                captured_at: None,
                volume_id: None,
                relative_path: None,
            })
            .unwrap();
        let dest = dir.path().join("archive");
        let report = download_originals(&library, &[file.to_string_lossy().into_owned()], &dest).unwrap();
        assert_eq!(report.copied, 1);
        assert!(dest.join("keep.dng").is_file());
        assert!(library.find_by_path(dest.join("keep.dng").to_str().unwrap()).unwrap().is_some());
    }
}
