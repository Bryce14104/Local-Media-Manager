//! File-system scanning and EXIF reading, then a write into the local catalog.

mod exif;
mod scanner;

use crate::db::{DbError, Library, NewMedia};
use crate::models::ScanReport;
use std::path::Path;
use std::time::Instant;
use thiserror::Error;

use exif::read_exif;
use scanner::{ScanError, hash_file, scan_directory};

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
}

enum IndexOutcome {
    Indexed { note: Option<String> },
    Unchanged,
}

/// Index every media file under `root`.
///
/// A file is left untouched when its size and modification time still match
/// the catalog and a hash is already stored. That path keeps the rating.
pub fn index_directory(library: &Library, root: &Path) -> Result<ScanReport, ServiceError> {
    let started = Instant::now();
    let batch = scan_directory(root)?;
    let discovered = batch.files.len();
    let mut indexed = 0;
    let mut unchanged = 0;
    let mut failed = 0;
    let mut errors = batch.errors;

    for file in batch.files {
        match index_one(library, &file) {
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
            return Ok(IndexOutcome::Unchanged);
        }
    }

    let hash = hash_file(&file.path)?;
    let (exif_json, note) = match read_exif(&file.path) {
        Ok(Some(snapshot)) if !snapshot.is_empty() => {
            (Some(serde_json::to_string(&snapshot)?), None)
        }
        Ok(_) => (None, None),
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
}
