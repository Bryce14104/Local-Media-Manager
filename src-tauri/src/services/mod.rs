//! File-system scanning and EXIF reading, then a write into the local catalog.

mod capture;
mod exif;
mod scanner;
mod thumbs;

pub use thumbs::generate_missing_thumbnails_with;

use crate::db::{DbError, Library, NewMedia};
use crate::models::ScanReport;
use std::path::Path;
use std::time::Instant;
use thiserror::Error;

use crate::models::ExifSnapshot;
use capture::{capture_unix, unix_to_iso};
use exif::read_exif;
use scanner::{ScanError, describe_file, hash_file, scan_directory};

#[derive(Debug, Error)]
pub enum ServiceError {
    #[error(transparent)]
    Scan(#[from] ScanError),
    #[error(transparent)]
    Db(#[from] DbError),
    #[error("could not store EXIF: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0} is larger than Shelf can store")]
    FileTooLarge(String),
    #[error("choose a folder or some files")]
    Empty,
}

enum IndexOutcome {
    Indexed { note: Option<String> },
    Unchanged,
}

/// Index folders and individual media files.
///
/// A directory is scanned recursively. A file is stored only when Shelf
/// recognizes its extension. Other paths are reported and skipped.
pub fn index_paths(library: &Library, paths: &[String]) -> Result<ScanReport, ServiceError> {
    index_paths_with(library, paths, |_, _| {})
}

pub fn index_paths_with<F>(
    library: &Library,
    paths: &[String],
    mut progress: F,
) -> Result<ScanReport, ServiceError>
where
    F: FnMut(usize, usize),
{
    let started = Instant::now();
    let mut files = Vec::new();
    let mut failed = 0;
    let mut errors = Vec::new();
    let mut roots = Vec::new();
    let mut saw_path = false;

    for raw in paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        saw_path = true;
        let path = Path::new(trimmed);
        roots.push(path.display().to_string());
        if path.is_dir() {
            match scan_directory(path) {
                Ok(batch) => {
                    for note in batch.errors {
                        push_note(&mut errors, note);
                    }
                    files.extend(batch.files);
                }
                Err(err) => {
                    failed += 1;
                    push_note(&mut errors, err.to_string());
                }
            }
            continue;
        }
        match describe_file(path) {
            Ok(file) => files.push(file),
            Err(err) => {
                failed += 1;
                push_note(&mut errors, err.to_string());
            }
        }
    }

    if !saw_path {
        return Err(ServiceError::Empty);
    }

    let discovered = files.len();
    let (indexed, unchanged, loop_failed, loop_errors) =
        index_files(library, &files, &mut progress);
    failed += loop_failed;
    for note in loop_errors {
        push_note(&mut errors, note);
    }

    Ok(ScanReport {
        root: if roots.is_empty() {
            String::new()
        } else {
            roots.join(", ")
        },
        discovered,
        indexed,
        unchanged,
        failed,
        errors,
        duration_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}

/// Index every media file under `root`.
///
/// A file is left untouched when its size and modification time still match
/// the catalog and a hash is already stored. That path keeps the rating.
pub fn index_directory(library: &Library, root: &Path) -> Result<ScanReport, ServiceError> {
    index_directory_with(library, root, |_, _| {})
}

pub fn index_directory_with<F>(
    library: &Library,
    root: &Path,
    mut progress: F,
) -> Result<ScanReport, ServiceError>
where
    F: FnMut(usize, usize),
{
    let started = Instant::now();
    let batch = scan_directory(root)?;
    let discovered = batch.files.len();
    let mut errors = batch.errors;
    let (indexed, unchanged, failed, loop_errors) = index_files(library, &batch.files, &mut progress);
    for note in loop_errors {
        push_note(&mut errors, note);
    }

    Ok(ScanReport {
        root: root.display().to_string(),
        discovered,
        indexed,
        unchanged,
        failed,
        errors,
        duration_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}

fn index_files<F>(
    library: &Library,
    files: &[crate::models::ScannedFile],
    progress: &mut F,
) -> (usize, usize, usize, Vec<String>)
where
    F: FnMut(usize, usize),
{
    let total = files.len();
    progress(0, total);
    let mut indexed = 0;
    let mut unchanged = 0;
    let mut failed = 0;
    let mut errors = Vec::new();
    for (index, file) in files.iter().enumerate() {
        match index_one(library, file) {
            Ok(IndexOutcome::Indexed { note }) => {
                indexed += 1;
                if let Some(note) = note {
                    push_note(&mut errors, note);
                }
            }
            Ok(IndexOutcome::Unchanged) => unchanged += 1,
            Err(err) => {
                failed += 1;
                push_note(&mut errors, err.to_string());
            }
        }
        progress(index + 1, total);
    }
    (indexed, unchanged, failed, errors)
}

fn index_one(
    library: &Library,
    file: &crate::models::ScannedFile,
) -> Result<IndexOutcome, ServiceError> {
    let path = file.path_string();
    if let Some(existing) = library.find_by_path(&path)? {
        let same_size = i64::try_from(file.file_size)
            .ok()
            .is_some_and(|size| size == existing.file_size);
        if same_size && existing.modified_at == file.modified_at && existing.content_hash.is_some()
        {
            if existing.captured_at.is_none()
                && let Some(unix) = capture_unix(&file.path)
            {
                library.set_captured_at(&path, unix)?;
            }
            let missing_gps = existing
                .exif
                .as_ref()
                .is_none_or(|exif| exif.latitude.is_none() || exif.longitude.is_none());
            if missing_gps
                && let Ok(Some(fresh)) = read_exif(&file.path)
                && fresh.latitude.is_some()
                && fresh.longitude.is_some()
                && let Ok(json) = serde_json::to_string(&fresh)
            {
                library.set_exif_json(&path, &json)?;
            }
            return Ok(IndexOutcome::Unchanged);
        }
    }

    let hash = hash_file(&file.path)?;
    let captured_at = capture_unix(&file.path);
    let (exif_json, note) = match read_exif(&file.path) {
        Ok(snapshot) => {
            let mut snapshot = snapshot.filter(|item| !item.is_empty());
            if let Some(unix) = captured_at {
                let entry = snapshot.get_or_insert_with(ExifSnapshot::default);
                entry.captured_at = Some(unix_to_iso(unix));
            }
            let json = match snapshot {
                Some(snapshot) => Some(serde_json::to_string(&snapshot)?),
                None => None,
            };
            (json, None)
        }
        Err(err) => (None, Some(format!("{path}: {err}"))),
    };
    let Ok(file_size) = i64::try_from(file.file_size) else {
        return Err(ServiceError::FileTooLarge(path));
    };

    library.upsert_media(NewMedia {
        file_path: &path,
        content_hash: &hash,
        file_size,
        created_at: file.created_at,
        modified_at: file.modified_at,
        media_kind: file.media_kind,
        exif_json: exif_json.as_deref(),
        captured_at,
    })?;

    Ok(IndexOutcome::Indexed { note })
}

fn push_note(errors: &mut Vec<String>, message: String) {
    if errors.len() < 50 {
        errors.push(message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Library;

    #[test]
    fn index_stores_hash_and_keeps_rating_across_rescans() {
        let root = tempfile::tempdir().unwrap();
        let photo = root.path().join("a.jpg");
        std::fs::write(&photo, b"jpeg-bytes").unwrap();

        let database = tempfile::tempdir().unwrap();
        let library = Library::open(database.path().join("library.sqlite")).unwrap();

        let first = index_directory(&library, root.path()).unwrap();
        assert_eq!(first.discovered, 1);
        assert_eq!(first.indexed, 1);
        assert_eq!(first.failed, 0);

        let media = library.list_media().unwrap();
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].file_size, 10);
        assert_eq!(media[0].content_hash.as_ref().unwrap().len(), 64);
        assert!(media[0].exif.is_none());

        let rated = library.set_rating(&media[0].file_path, Some(5)).unwrap();
        assert_eq!(rated.rating, Some(5));

        let second = index_directory(&library, root.path()).unwrap();
        assert_eq!(second.unchanged, 1);
        assert_eq!(second.indexed, 0);
        assert_eq!(library.list_media().unwrap()[0].rating, Some(5));

        std::fs::write(&photo, b"jpeg-bytes-changed").unwrap();
        let third = index_directory(&library, root.path()).unwrap();
        assert_eq!(third.indexed, 1);
        let updated = &library.list_media().unwrap()[0];
        assert_eq!(updated.rating, Some(5));
        assert_ne!(updated.file_size, 10);
        assert_ne!(
            updated.content_hash.as_deref(),
            media[0].content_hash.as_deref()
        );
    }

    #[test]
    fn index_paths_accepts_a_folder_and_a_file() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("still.jpg"), b"jpeg-bytes").unwrap();
        let loose = tempfile::tempdir().unwrap();
        let clip = loose.path().join("clip.mp4");
        std::fs::write(&clip, b"video-bytes").unwrap();
        std::fs::write(loose.path().join("notes.txt"), b"skip").unwrap();

        let database = tempfile::tempdir().unwrap();
        let library = Library::open(database.path().join("library.sqlite")).unwrap();
        let report = index_paths(
            &library,
            &[
                root.path().display().to_string(),
                clip.display().to_string(),
                loose.path().join("notes.txt").display().to_string(),
            ],
        )
        .unwrap();

        assert_eq!(report.discovered, 2);
        assert_eq!(report.indexed, 2);
        assert_eq!(report.failed, 1);
        let mut names: Vec<_> = library
            .list_media()
            .unwrap()
            .into_iter()
            .map(|record| record.file_path)
            .collect();
        names.sort();
        assert!(names.iter().any(|path| path.ends_with("still.jpg")));
        assert!(names.iter().any(|path| path.ends_with("clip.mp4")));
    }

    #[test]
    fn index_sorts_by_xmp_capture_time() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(
            root.path().join("later-import.jpg"),
            b"plain-bytes-without-a-date",
        )
        .unwrap();
        std::fs::write(
            root.path().join("earlier-shot.jpg"),
            b"junk exif:DateTimeOriginal=\"2018-01-02T03:04:05\" tail",
        )
        .unwrap();

        let database = tempfile::tempdir().unwrap();
        let library = Library::open(database.path().join("library.sqlite")).unwrap();
        index_directory(&library, root.path()).unwrap();

        let media = library.list_media().unwrap();
        assert!(media[0].file_path.ends_with("earlier-shot.jpg"));
        assert_eq!(
            media[0].exif.as_ref().and_then(|exif| exif.captured_at.as_deref()),
            Some("2018-01-02T03:04:05")
        );
        assert!(media[1].captured_at.is_none());
    }
}
