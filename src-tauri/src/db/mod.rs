//! Local SQLite catalog.
//!
//! The SQL in `schema.sql` is the initialization script. It is compiled into
//! the binary and executed whenever a library file is opened.

use crate::models::{ExifSnapshot, MediaKind, MediaRecord};
use rusqlite::{Connection, OptionalExtension, params};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

const SCHEMA_SQL: &str = include_str!("schema.sql");

/// Values written for a newly hashed media file.
///
/// `rating` is not part of this struct. A rescan must not wipe a rating the
/// user already set.
pub struct NewMedia<'a> {
    pub file_path: &'a str,
    pub content_hash: &'a str,
    pub file_size: i64,
    pub created_at: Option<i64>,
    pub modified_at: i64,
    pub media_kind: MediaKind,
    pub exif_json: Option<&'a str>,
}

#[derive(Debug, Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("could not create the library folder: {0}")]
    Io(#[from] std::io::Error),
    #[error("rating must be from 0 to 5")]
    InvalidRating,
    #[error("no indexed file at {0}")]
    NotFound(String),
    #[error("the library lock was poisoned")]
    Poisoned,
}

struct LibraryInner {
    conn: Mutex<Connection>,
    path: PathBuf,
}

/// Open SQLite file for one Shelf library.
///
/// Cloning is cheap: connections are shared behind a mutex.
#[derive(Clone)]
pub struct Library {
    inner: Arc<LibraryInner>,
}

impl Library {
    /// Open `path`, creating parent directories and applying `schema.sql`.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, DbError> {
        let path = path.as_ref();
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.pragma_update(None::<&str>, "foreign_keys", "ON")?;
        conn.pragma_update(None::<&str>, "journal_mode", "WAL")?;
        conn.execute_batch(SCHEMA_SQL)?;

        Ok(Self {
            inner: Arc::new(LibraryInner {
                conn: Mutex::new(conn),
                path: path.to_path_buf(),
            }),
        })
    }

    pub fn summary(&self) -> Result<crate::models::LibrarySummary, DbError> {
        let conn = self.lock()?;
        let media_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM media_files", [], |row| row.get(0))?;
        let schema_version: i64 = conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        let mut stmt = conn.prepare("PRAGMA table_info(media_files)")?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(crate::models::LibrarySummary {
            database_path: self.inner.path.display().to_string(),
            media_count,
            schema_version,
            columns,
        })
    }

    pub fn list_media(&self) -> Result<Vec<MediaRecord>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, file_path, content_hash, file_size, created_at, modified_at,
                    indexed_at, rating, media_kind, exif_json
             FROM media_files
             ORDER BY modified_at DESC, file_path COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], map_media)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn find_by_path(&self, path: &str) -> Result<Option<MediaRecord>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, file_path, content_hash, file_size, created_at, modified_at,
                    indexed_at, rating, media_kind, exif_json
             FROM media_files
             WHERE file_path = ?1",
        )?;
        let record = stmt.query_row(params![path], map_media).optional()?;
        Ok(record)
    }

    pub fn upsert_media(&self, media: NewMedia<'_>) -> Result<(), DbError> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO media_files (
                file_path, content_hash, file_size, created_at, modified_at,
                indexed_at, media_kind, exif_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(file_path) DO UPDATE SET
                content_hash = excluded.content_hash,
                file_size = excluded.file_size,
                created_at = excluded.created_at,
                modified_at = excluded.modified_at,
                indexed_at = excluded.indexed_at,
                media_kind = excluded.media_kind,
                exif_json = excluded.exif_json",
            params![
                media.file_path,
                media.content_hash,
                media.file_size,
                media.created_at,
                media.modified_at,
                unix_now(),
                media.media_kind.as_str(),
                media.exif_json,
            ],
        )?;
        Ok(())
    }

    /// Set or clear the rating for a path that is already indexed.
    pub fn set_rating(&self, path: &str, rating: Option<u8>) -> Result<MediaRecord, DbError> {
        if let Some(value) = rating
            && value > 5
        {
            return Err(DbError::InvalidRating);
        }

        let rating_value = rating.map(i64::from);
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE media_files SET rating = ?1 WHERE file_path = ?2",
            params![rating_value, path],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(path.to_string()));
        }

        let record = conn.query_row(
            "SELECT id, file_path, content_hash, file_size, created_at, modified_at,
                    indexed_at, rating, media_kind, exif_json
             FROM media_files
             WHERE file_path = ?1",
            params![path],
            map_media,
        )?;
        Ok(record)
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, DbError> {
        self.inner.conn.lock().map_err(|_| DbError::Poisoned)
    }
}

fn map_media(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaRecord> {
    let kind: String = row.get(8)?;
    let exif_json: Option<String> = row.get(9)?;
    let exif = exif_json.and_then(|raw| serde_json::from_str::<ExifSnapshot>(&raw).ok());
    Ok(MediaRecord {
        id: row.get(0)?,
        file_path: row.get(1)?,
        content_hash: row.get(2)?,
        file_size: row.get(3)?,
        created_at: row.get(4)?,
        modified_at: row.get(5)?,
        indexed_at: row.get(6)?,
        rating: row.get(7)?,
        media_kind: MediaKind::parse(&kind),
        exif,
    })
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_script_declares_the_catalog_columns() {
        for column in [
            "file_path",
            "content_hash",
            "file_size",
            "created_at",
            "modified_at",
            "indexed_at",
            "rating",
        ] {
            assert!(
                SCHEMA_SQL.contains(column),
                "schema.sql is missing {column}"
            );
        }
    }

    #[test]
    fn open_creates_media_files_and_records_schema_version() {
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(dir.path().join("library.sqlite")).unwrap();
        let summary = library.summary().unwrap();

        assert_eq!(summary.schema_version, 1);
        assert_eq!(summary.media_count, 0);
        for column in [
            "file_path",
            "content_hash",
            "file_size",
            "created_at",
            "modified_at",
            "indexed_at",
            "rating",
        ] {
            assert!(
                summary.columns.iter().any(|name| name == column),
                "missing column {column}"
            );
        }

        let again = Library::open(dir.path().join("library.sqlite")).unwrap();
        assert_eq!(again.summary().unwrap().schema_version, 1);
    }

    #[test]
    fn rating_round_trip_rejects_values_above_five() {
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(dir.path().join("library.sqlite")).unwrap();
        library
            .upsert_media(NewMedia {
                file_path: "/photos/one.jpg",
                content_hash: "abc",
                file_size: 12,
                created_at: None,
                modified_at: 10,
                media_kind: MediaKind::Image,
                exif_json: None,
            })
            .unwrap();

        let rated = library.set_rating("/photos/one.jpg", Some(4)).unwrap();
        assert_eq!(rated.rating, Some(4));

        let cleared = library.set_rating("/photos/one.jpg", None).unwrap();
        assert_eq!(cleared.rating, None);

        let error = library.set_rating("/photos/one.jpg", Some(9)).unwrap_err();
        assert!(matches!(error, DbError::InvalidRating));

        let missing = library.set_rating("/missing.jpg", Some(1)).unwrap_err();
        assert!(matches!(missing, DbError::NotFound(_)));
    }
}
