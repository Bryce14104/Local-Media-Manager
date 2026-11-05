//! Local SQLite catalog.
//!
//! The SQL in `schema.sql` is the initialization script. It is compiled into
//! the binary and executed whenever a library file is opened.

use crate::models::{ExifSnapshot, FaceRecord, InsightSnapshot, LabelRecord, MediaKind, MediaRecord, PersonRecord};
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
    pub captured_at: Option<i64>,
}

#[derive(Debug, Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("could not create the library folder: {0}")]
    Io(#[from] std::io::Error),
    #[error("rating must be from 0 to 5")]
    InvalidRating,
    #[error("flag must be pick, reject, or empty")]
    InvalidFlag,
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
        migrate(&conn)?;

        Ok(Self {
            inner: Arc::new(LibraryInner {
                conn: Mutex::new(conn),
                path: path.to_path_buf(),
            }),
        })
    }

    pub fn database_path(&self) -> &Path {
        &self.inner.path
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
                    indexed_at, rating, media_kind, exif_json, captured_at, thumbnail_path, flag
             FROM media_files
             ORDER BY captured_at IS NULL, captured_at DESC, file_path COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], map_media)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn find_by_path(&self, path: &str) -> Result<Option<MediaRecord>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, file_path, content_hash, file_size, created_at, modified_at,
                    indexed_at, rating, media_kind, exif_json, captured_at, thumbnail_path, flag
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
                indexed_at, media_kind, exif_json, captured_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(file_path) DO UPDATE SET
                content_hash = excluded.content_hash,
                file_size = excluded.file_size,
                created_at = excluded.created_at,
                modified_at = excluded.modified_at,
                indexed_at = excluded.indexed_at,
                media_kind = excluded.media_kind,
                exif_json = excluded.exif_json,
                captured_at = excluded.captured_at,
                vision_at = CASE
                    WHEN media_files.content_hash IS NOT excluded.content_hash THEN NULL
                    ELSE media_files.vision_at
                END",
            params![
                media.file_path,
                media.content_hash,
                media.file_size,
                media.created_at,
                media.modified_at,
                unix_now(),
                media.media_kind.as_str(),
                media.exif_json,
                media.captured_at,
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
                    indexed_at, rating, media_kind, exif_json, captured_at, thumbnail_path, flag
             FROM media_files
             WHERE file_path = ?1",
            params![path],
            map_media,
        )?;
        Ok(record)
    }

    pub fn set_thumbnail(&self, path: &str, thumbnail_path: &str) -> Result<(), DbError> {
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE media_files SET thumbnail_path = ?1 WHERE file_path = ?2",
            params![thumbnail_path, path],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(path.to_string()));
        }
        Ok(())
    }

    pub fn set_exif_json(&self, path: &str, exif_json: &str) -> Result<(), DbError> {
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE media_files SET exif_json = ?1 WHERE file_path = ?2",
            params![exif_json, path],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(path.to_string()));
        }
        Ok(())
    }

    pub fn set_flag(&self, paths: &[String], flag: Option<&str>) -> Result<usize, DbError> {
        if let Some(value) = flag
            && value != "pick"
            && value != "reject"
        {
            return Err(DbError::InvalidFlag);
        }
        let conn = self.lock()?;
        let mut changed = 0;
        for path in paths {
            changed += conn.execute(
                "UPDATE media_files SET flag = ?1 WHERE file_path = ?2",
                params![flag, path],
            )?;
        }
        Ok(changed)
    }

    /// Drop catalog rows and Shelf-written previews. Source files stay on disk.
    pub fn remove_paths(&self, paths: &[String]) -> Result<usize, DbError> {
        let mut removed = 0;
        for path in paths {
            let thumb = self
                .find_by_path(path)?
                .and_then(|record| record.thumbnail_path);
            delete_owned_thumbnail(thumb.as_deref());
            let conn = self.lock()?;
            removed += conn.execute("DELETE FROM media_files WHERE file_path = ?1", params![path])?;
        }
        Ok(removed)
    }

    /// Delete source files that are already in the catalog, then their rows and previews.
    /// A path with no library row is left untouched.
    pub fn delete_paths(&self, paths: &[String]) -> Result<(usize, Vec<String>), DbError> {
        let mut removed = 0;
        let mut failed = Vec::new();
        for path in paths {
            let Some(record) = self.find_by_path(path)? else {
                failed.push(format!("{path}: not in the library"));
                continue;
            };
            match std::fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    failed.push(format!("{path}: {error}"));
                    continue;
                }
            }
            delete_owned_thumbnail(record.thumbnail_path.as_deref());
            let conn = self.lock()?;
            removed += conn.execute("DELETE FROM media_files WHERE file_path = ?1", params![path])?;
        }
        Ok((removed, failed))
    }

    pub fn pending_vision(&self) -> Result<Vec<VisionTarget>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, file_path, thumbnail_path, media_kind, exif_json
             FROM media_files
             WHERE vision_at IS NULL
             ORDER BY id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(VisionTarget {
                id: row.get(0)?,
                file_path: row.get(1)?,
                thumbnail_path: row.get(2)?,
                media_kind: row.get(3)?,
                exif_json: row.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn face_embeddings(&self) -> Result<Vec<(i64, Vec<f32>)>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT person_id, embedding FROM faces WHERE person_id IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |row| {
            let person_id: i64 = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            Ok((person_id, blob_to_embedding(&blob)))
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn create_person(&self, name: Option<&str>) -> Result<i64, DbError> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO people (name, created_at) VALUES (?1, ?2)",
            params![name, unix_now()],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn clear_file_vision(&self, media_id: i64) -> Result<(), DbError> {
        let conn = self.lock()?;
        conn.execute("DELETE FROM faces WHERE media_id = ?1", params![media_id])?;
        conn.execute("DELETE FROM media_labels WHERE media_id = ?1", params![media_id])?;
        Ok(())
    }

    pub fn insert_face(
        &self,
        media_id: i64,
        person_id: i64,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        confidence: f32,
        embedding: &[f32],
    ) -> Result<(), DbError> {
        let blob = embedding_to_blob(embedding);
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO faces (media_id, person_id, x, y, width, height, confidence, embedding)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![media_id, person_id, x, y, width, height, confidence, blob],
        )?;
        Ok(())
    }

    pub fn replace_labels(&self, media_id: i64, labels: &[(String, String, f32)]) -> Result<(), DbError> {
        let conn = self.lock()?;
        for (kind, label, score) in labels {
            conn.execute(
                "INSERT INTO media_labels (media_id, kind, label, score) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(media_id, kind, label) DO UPDATE SET score = excluded.score",
                params![media_id, kind, label, score],
            )?;
        }
        Ok(())
    }

    pub fn mark_vision(&self, media_id: i64) -> Result<(), DbError> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE media_files SET vision_at = ?1 WHERE id = ?2",
            params![unix_now(), media_id],
        )?;
        Ok(())
    }

    pub fn insights(&self) -> Result<InsightSnapshot, DbError> {
        let conn = self.lock()?;
        let mut people_stmt = conn.prepare(
            "SELECT p.id, p.name, COUNT(f.id)
             FROM people p
             LEFT JOIN faces f ON f.person_id = p.id
             GROUP BY p.id
             HAVING COUNT(f.id) > 0 OR p.name IS NOT NULL
             ORDER BY COUNT(f.id) DESC, p.id",
        )?;
        let people = people_stmt
            .query_map([], |row| {
                Ok(PersonRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    face_count: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut face_stmt = conn.prepare(
            "SELECT id, media_id, person_id, x, y, width, height, confidence
             FROM faces
             WHERE person_id IS NOT NULL
             ORDER BY id",
        )?;
        let faces = face_stmt
            .query_map([], |row| {
                Ok(FaceRecord {
                    id: row.get(0)?,
                    media_id: row.get(1)?,
                    person_id: row.get(2)?,
                    x: row.get(3)?,
                    y: row.get(4)?,
                    width: row.get(5)?,
                    height: row.get(6)?,
                    confidence: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut label_stmt = conn.prepare(
            "SELECT media_id, kind, label, score FROM media_labels ORDER BY score DESC",
        )?;
        let labels = label_stmt
            .query_map([], |row| {
                Ok(LabelRecord {
                    media_id: row.get(0)?,
                    kind: row.get(1)?,
                    label: row.get(2)?,
                    score: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(InsightSnapshot {
            people,
            faces,
            labels,
        })
    }

    pub fn rename_person(&self, id: i64, name: Option<&str>) -> Result<(), DbError> {
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE people SET name = ?1 WHERE id = ?2",
            params![name, id],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(format!("person {id}")));
        }
        Ok(())
    }

    pub fn merge_people(&self, keep_id: i64, drop_id: i64) -> Result<(), DbError> {
        if keep_id == drop_id {
            return Ok(());
        }
        let conn = self.lock()?;
        conn.execute(
            "UPDATE faces SET person_id = ?1 WHERE person_id = ?2",
            params![keep_id, drop_id],
        )?;
        conn.execute("DELETE FROM people WHERE id = ?1", params![drop_id])?;
        Ok(())
    }

    pub fn split_face(&self, face_id: i64) -> Result<i64, DbError> {
        let conn = self.lock()?;
        let exists: Option<i64> = conn
            .query_row(
                "SELECT id FROM faces WHERE id = ?1",
                params![face_id],
                |row| row.get(0),
            )
            .optional()?;
        if exists.is_none() {
            return Err(DbError::NotFound(format!("face {face_id}")));
        }
        conn.execute(
            "INSERT INTO people (name, created_at) VALUES (NULL, ?1)",
            params![unix_now()],
        )?;
        let person_id = conn.last_insert_rowid();
        conn.execute(
            "UPDATE faces SET person_id = ?1 WHERE id = ?2",
            params![person_id, face_id],
        )?;
        Ok(person_id)
    }

    pub fn set_captured_at(&self, path: &str, captured_at: i64) -> Result<(), DbError> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE media_files SET captured_at = ?1 WHERE file_path = ?2 AND captured_at IS NULL",
            params![captured_at, path],
        )?;
        Ok(())
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, DbError> {
        self.inner.conn.lock().map_err(|_| DbError::Poisoned)
    }
}

fn delete_owned_thumbnail(path: Option<&str>) {
    let Some(path) = path else {
        return;
    };
    let file = Path::new(path);
    let owned = file
        .parent()
        .and_then(|parent| parent.file_name())
        .is_some_and(|name| name == "thumbnails");
    if owned {
        let _ = std::fs::remove_file(file);
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
        captured_at: row.get(10)?,
        thumbnail_path: row.get(11)?,
        flag: row.get(12)?,
    })
}

fn migrate(conn: &Connection) -> Result<(), DbError> {
    let mut stmt = conn.prepare("PRAGMA table_info(media_files)")?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if !columns.iter().any(|name| name == "captured_at") {
        conn.execute("ALTER TABLE media_files ADD COLUMN captured_at INTEGER", [])?;
    }
    if !columns.iter().any(|name| name == "thumbnail_path") {
        conn.execute("ALTER TABLE media_files ADD COLUMN thumbnail_path TEXT", [])?;
    }
    if !columns.iter().any(|name| name == "flag") {
        conn.execute("ALTER TABLE media_files ADD COLUMN flag TEXT", [])?;
    }
    if !columns.iter().any(|name| name == "vision_at") {
        conn.execute("ALTER TABLE media_files ADD COLUMN vision_at INTEGER", [])?;
    }
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_media_files_captured_at ON media_files (captured_at DESC)",
        [],
    )?;
    Ok(())
}

pub struct VisionTarget {
    pub id: i64,
    pub file_path: String,
    pub thumbnail_path: Option<String>,
    pub media_kind: String,
    pub exif_json: Option<String>,
}

fn embedding_to_blob(values: &[f32]) -> Vec<u8> {
    let mut blob = Vec::with_capacity(values.len() * 4);
    for value in values {
        blob.extend_from_slice(&value.to_le_bytes());
    }
    blob
}

fn blob_to_embedding(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
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
    fn remove_drops_the_row_and_delete_removes_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(dir.path().join("library.sqlite")).unwrap();
        let kept = dir.path().join("kept.jpg");
        let gone = dir.path().join("gone.jpg");
        std::fs::write(&kept, b"kept").unwrap();
        std::fs::write(&gone, b"gone").unwrap();
        for path in [&kept, &gone] {
            library
                .upsert_media(NewMedia {
                    file_path: path.to_str().unwrap(),
                    content_hash: "abc",
                    file_size: 4,
                    created_at: None,
                    modified_at: 10,
                    media_kind: MediaKind::Image,
                    exif_json: None,
                    captured_at: None,
                })
                .unwrap();
        }
        assert_eq!(library.remove_paths(&[kept.display().to_string()]).unwrap(), 1);
        assert!(kept.is_file());
        assert!(library.find_by_path(kept.to_str().unwrap()).unwrap().is_none());

        let (removed, failed) = library.delete_paths(&[gone.display().to_string()]).unwrap();
        assert_eq!(removed, 1);
        assert!(failed.is_empty());
        assert!(!gone.exists());

        let outsider = dir.path().join("outsider.jpg");
        std::fs::write(&outsider, b"keep").unwrap();
        let (removed, failed) = library
            .delete_paths(&[outsider.display().to_string()])
            .unwrap();
        assert_eq!(removed, 0);
        assert_eq!(failed.len(), 1);
        assert!(outsider.is_file());

        assert_eq!(
            library.set_flag(&[kept.display().to_string()], Some("pick")).unwrap(),
            0
        );
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
                captured_at: Some(1_700_000_000),
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

    #[test]
    fn list_orders_by_capture_time_not_file_mtime() {
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(dir.path().join("library.sqlite")).unwrap();
        library
            .upsert_media(NewMedia {
                file_path: "/photos/imported-later.jpg",
                content_hash: "a",
                file_size: 4,
                created_at: Some(1_800_000_000),
                modified_at: 1_800_000_000,
                media_kind: MediaKind::Image,
                exif_json: None,
                captured_at: Some(1_600_000_000),
            })
            .unwrap();
        library
            .upsert_media(NewMedia {
                file_path: "/photos/shot-later.jpg",
                content_hash: "b",
                file_size: 4,
                created_at: Some(1_500_000_000),
                modified_at: 1_500_000_000,
                media_kind: MediaKind::Image,
                exif_json: None,
                captured_at: Some(1_700_000_000),
            })
            .unwrap();
        library
            .upsert_media(NewMedia {
                file_path: "/photos/no-exif.jpg",
                content_hash: "c",
                file_size: 4,
                created_at: Some(1_900_000_000),
                modified_at: 1_900_000_000,
                media_kind: MediaKind::Image,
                exif_json: None,
                captured_at: None,
            })
            .unwrap();

        let names: Vec<_> = library
            .list_media()
            .unwrap()
            .into_iter()
            .map(|record| record.file_path)
            .collect();
        assert_eq!(
            names,
            vec![
                "/photos/shot-later.jpg",
                "/photos/imported-later.jpg",
                "/photos/no-exif.jpg",
            ]
        );
    }

    #[test]
    fn faces_cluster_merge_and_split_without_touching_files() {
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(dir.path().join("library.sqlite")).unwrap();
        library
            .upsert_media(NewMedia {
                file_path: "/photos/portrait.jpg",
                content_hash: "abc",
                file_size: 10,
                created_at: None,
                modified_at: 10,
                media_kind: MediaKind::Image,
                exif_json: None,
                captured_at: Some(20),
            })
            .unwrap();
        let media_id = library.list_media().unwrap()[0].id;
        let first = library.create_person(Some("Bryce")).unwrap();
        let second = library.create_person(None).unwrap();
        library
            .insert_face(media_id, first, 0.2, 0.1, 0.3, 0.4, 0.9, &[1.0, 0.0, 0.0, 0.0])
            .unwrap();
        library
            .insert_face(media_id, second, 0.6, 0.2, 0.2, 0.3, 0.8, &[0.0, 1.0, 0.0, 0.0])
            .unwrap();
        library
            .replace_labels(media_id, &[("pet".into(), "dog".into(), 0.7)])
            .unwrap();
        library.mark_vision(media_id).unwrap();

        let snapshot = library.insights().unwrap();
        assert_eq!(snapshot.people.len(), 2);
        assert_eq!(snapshot.faces.len(), 2);
        assert_eq!(snapshot.labels[0].label, "dog");
        assert!(library.pending_vision().unwrap().is_empty());

        let guest = snapshot
            .faces
            .iter()
            .find(|face| face.person_id == second)
            .unwrap();
        let split = library.split_face(guest.id).unwrap();
        assert_ne!(split, second);
        library.merge_people(first, split).unwrap();
        let after = library.insights().unwrap();
        assert!(after.faces.iter().all(|face| face.person_id == first));
        library.rename_person(first, Some("Bryce Hill")).unwrap();
        assert_eq!(
            library
                .insights()
                .unwrap()
                .people
                .iter()
                .find(|person| person.id == first)
                .unwrap()
                .name
                .as_deref(),
            Some("Bryce Hill")
        );

        library
            .remove_paths(&["/photos/portrait.jpg".into()])
            .unwrap();
        assert!(library.insights().unwrap().faces.is_empty());
    }
}
