//! Local SQLite catalog.
//!
//! The SQL in `schema.sql` is the initialization script. It is compiled into
//! the binary and executed whenever a library file is opened.

mod concepts;

use crate::models::{
    AlbumRecord, ConceptIndex, ExifSnapshot, FaceRecord, InsightSnapshot, LabelRecord, MediaKind,
    MediaRecord, PersonRecord, VideoProbe, VolumeRecord, WatchedRoot,
};
use rusqlite::{Connection, OptionalExtension, params};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

const SCHEMA_SQL: &str = include_str!("schema.sql");

const MEDIA_SELECT: &str = "SELECT id, file_path, content_hash, file_size, created_at, modified_at,
                    indexed_at, rating, media_kind, exif_json, captured_at, thumbnail_path, flag,
                    color_label, rotation, notes, keywords, develop_json, volume_id, relative_path,
                    cull_hint, mark_in_ms, mark_out_ms, video_json
             FROM media_files";

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
    pub volume_id: Option<i64>,
    pub relative_path: Option<&'a str>,
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
    #[error("color must be red, yellow, green, blue, purple, or empty")]
    InvalidColor,
    #[error("no indexed file at {0}")]
    NotFound(String),
    #[error("the library lock was poisoned")]
    Poisoned,
}

struct LibraryInner {
    conn: Mutex<Connection>,
    path: Mutex<PathBuf>,
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
        conn.pragma_update(None::<&str>, "synchronous", "NORMAL")?;
        conn.pragma_update(None::<&str>, "temp_store", "MEMORY")?;
        conn.pragma_update(None::<&str>, "cache_size", "-20000")?;
        conn.execute_batch(SCHEMA_SQL)?;
        migrate(&conn)?;

        Ok(Self {
            inner: Arc::new(LibraryInner {
                conn: Mutex::new(conn),
                path: Mutex::new(path.to_path_buf()),
            }),
        })
    }

    pub fn database_path(&self) -> PathBuf {
        self.inner
            .path
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .clone()
    }

    /// Replace the open SQLite file. Callers keep the same `Library` handle.
    pub fn reopen(&self, path: impl AsRef<Path>) -> Result<(), DbError> {
        let next = Library::open(path)?;
        let mut dest = self.lock()?;
        let mut src = next.lock()?;
        std::mem::swap(&mut *dest, &mut *src);
        drop(dest);
        drop(src);
        let mut dest_path = self.inner.path.lock().map_err(|_| DbError::Poisoned)?;
        let mut src_path = next.inner.path.lock().map_err(|_| DbError::Poisoned)?;
        std::mem::swap(&mut *dest_path, &mut *src_path);
        Ok(())
    }

    pub fn vacuum_into(&self, dest: &Path) -> Result<(), DbError> {
        let conn = self.lock()?;
        conn.execute("VACUUM INTO ?1", params![dest.to_string_lossy().as_ref()])?;
        Ok(())
    }

    pub fn keep_media_ids(&self, ids: &[i64]) -> Result<usize, DbError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let conn = self.lock()?;
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("DELETE FROM media_files WHERE id NOT IN ({placeholders})");
        let mut stmt = conn.prepare(&sql)?;
        let params = rusqlite::params_from_iter(ids.iter());
        Ok(stmt.execute(params)?)
    }

    pub fn rewrite_thumbnail_path(&self, id: i64, thumbnail_path: &str) -> Result<(), DbError> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE media_files SET thumbnail_path = ?1 WHERE id = ?2",
            params![thumbnail_path, id],
        )?;
        Ok(())
    }

    pub fn set_cull_hint(&self, id: i64, hint: Option<&str>) -> Result<(), DbError> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE media_files SET cull_hint = ?1 WHERE id = ?2",
            params![hint, id],
        )?;
        Ok(())
    }

    pub fn set_marks(&self, path: &str, mark_in_ms: Option<i64>, mark_out_ms: Option<i64>) -> Result<MediaRecord, DbError> {
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE media_files SET mark_in_ms = ?1, mark_out_ms = ?2 WHERE file_path = ?3",
            params![mark_in_ms, mark_out_ms, path],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(path.to_string()));
        }
        drop(conn);
        self.find_by_path(path)?
            .ok_or_else(|| DbError::NotFound(path.to_string()))
    }

    pub fn set_video_json(&self, path: &str, video_json: &str) -> Result<(), DbError> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE media_files SET video_json = ?1 WHERE file_path = ?2",
            params![video_json, path],
        )?;
        Ok(())
    }

    pub fn clear_thumbnail(&self, path: &str) -> Result<(), DbError> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE media_files SET thumbnail_path = NULL WHERE file_path = ?1",
            params![path],
        )?;
        Ok(())
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
            database_path: self.database_path().display().to_string(),
            media_count,
            schema_version,
            columns,
        })
    }

    pub fn list_media(&self) -> Result<Vec<MediaRecord>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(&format!(
            "{MEDIA_SELECT}
             ORDER BY captured_at IS NULL, captured_at DESC, file_path COLLATE NOCASE ASC"
        ))?;
        let rows = stmt.query_map([], map_media)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn find_by_path(&self, path: &str) -> Result<Option<MediaRecord>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(&format!("{MEDIA_SELECT} WHERE file_path = ?1"))?;
        let record = stmt.query_row(params![path], map_media).optional()?;
        Ok(record)
    }

    pub fn find_by_hash(&self, hash: &str) -> Result<Option<MediaRecord>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(&format!(
            "{MEDIA_SELECT} WHERE content_hash = ?1 AND file_path NOT LIKE '%::v%' LIMIT 1"
        ))?;
        Ok(stmt.query_row(params![hash], map_media).optional()?)
    }

    pub fn find_by_volume_relative(
        &self,
        fingerprint: &str,
        relative: &str,
    ) -> Result<Option<MediaRecord>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(&format!(
            "{MEDIA_SELECT}
             WHERE volume_id = (SELECT id FROM volumes WHERE fingerprint = ?1)
               AND relative_path = ?2
             LIMIT 1"
        ))?;
        Ok(stmt.query_row(params![fingerprint, relative], map_media).optional()?)
    }

    pub fn clone_virtual(&self, path: &str) -> Result<MediaRecord, DbError> {
        let source = self
            .find_by_path(path)?
            .ok_or_else(|| DbError::NotFound(path.to_string()))?;
        let stamp = unix_now();
        let base = crate::models::catalog_path(path);
        let virtual_path = format!("{base}::v{stamp}-{}", source.id);
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO media_files (
                file_path, content_hash, file_size, created_at, modified_at, indexed_at,
                rating, media_kind, exif_json, captured_at, thumbnail_path, flag, vision_at,
                color_label, rotation, notes, keywords, develop_json, volume_id, relative_path
             )
             SELECT ?1, content_hash, file_size, created_at, modified_at, ?2,
                rating, media_kind, exif_json, captured_at, thumbnail_path, flag, vision_at,
                color_label, rotation, notes, keywords, develop_json, volume_id, relative_path
             FROM media_files WHERE id = ?3",
            params![virtual_path, stamp, source.id],
        )?;
        drop(conn);
        self.find_by_path(&virtual_path)?
            .ok_or_else(|| DbError::NotFound(virtual_path))
    }

    pub fn person_prototypes(&self) -> Result<Vec<(i64, Vec<f32>)>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT person_id, embedding FROM faces WHERE person_id IS NOT NULL",
        )?;
        let mut grouped: std::collections::HashMap<i64, (Vec<f32>, usize)> =
            std::collections::HashMap::new();
        let rows = stmt.query_map([], |row| {
            let person_id: i64 = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            Ok((person_id, blob_to_embedding(&blob)))
        })?;
        for row in rows {
            let (person_id, embedding) = row?;
            let entry = grouped.entry(person_id).or_insert_with(|| (vec![0.0; embedding.len()], 0));
            if entry.0.len() != embedding.len() {
                continue;
            }
            for (slot, value) in entry.0.iter_mut().zip(embedding) {
                *slot += value;
            }
            entry.1 += 1;
        }
        Ok(grouped
            .into_iter()
            .filter_map(|(id, (mut sum, count))| {
                if count == 0 {
                    return None;
                }
                for value in &mut sum {
                    *value /= count as f32;
                }
                Some((id, sum))
            })
            .collect())
    }

    pub fn with_transaction<T, F>(&self, op: F) -> Result<T, DbError>
    where
        F: FnOnce(&Connection) -> Result<T, DbError>,
    {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let value = op(&tx)?;
        tx.commit()?;
        Ok(value)
    }

    pub fn upsert_media(&self, media: NewMedia<'_>) -> Result<(), DbError> {
        let conn = self.lock()?;
        upsert_media_sql(&conn, media)
    }

    pub(crate) fn upsert_media_on(conn: &Connection, media: NewMedia<'_>) -> Result<(), DbError> {
        upsert_media_sql(conn, media)
    }
}

fn upsert_media_sql(conn: &Connection, media: NewMedia<'_>) -> Result<(), DbError> {
        conn.execute(
            "INSERT INTO media_files (
                file_path, content_hash, file_size, created_at, modified_at,
                indexed_at, media_kind, exif_json, captured_at, volume_id, relative_path
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(file_path) DO UPDATE SET
                content_hash = excluded.content_hash,
                file_size = excluded.file_size,
                created_at = excluded.created_at,
                modified_at = excluded.modified_at,
                indexed_at = excluded.indexed_at,
                media_kind = excluded.media_kind,
                exif_json = excluded.exif_json,
                captured_at = excluded.captured_at,
                volume_id = COALESCE(excluded.volume_id, media_files.volume_id),
                relative_path = COALESCE(excluded.relative_path, media_files.relative_path),
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
                media.volume_id,
                media.relative_path,
            ],
        )?;
        Ok(())
}

impl Library {
    pub fn upsert_volume(&self, fingerprint: &str, label: &str, mount: &str) -> Result<i64, DbError> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO volumes (fingerprint, label, last_mount, last_seen_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(fingerprint) DO UPDATE SET
                label = excluded.label,
                last_mount = excluded.last_mount,
                last_seen_at = excluded.last_seen_at",
            params![fingerprint, label, mount, unix_now()],
        )?;
        let id = conn.query_row(
            "SELECT id FROM volumes WHERE fingerprint = ?1",
            params![fingerprint],
            |row| row.get(0),
        )?;
        Ok(id)
    }

    pub fn find_by_volume_path(&self, volume_id: i64, relative: &str) -> Result<Option<MediaRecord>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(&format!(
            "{MEDIA_SELECT} WHERE volume_id = ?1 AND relative_path = ?2"
        ))?;
        Ok(stmt.query_row(params![volume_id, relative], map_media).optional()?)
    }

    pub fn set_file_path(&self, id: i64, path: &str) -> Result<(), DbError> {
        let conn = self.lock()?;
        conn.execute("UPDATE media_files SET file_path = ?1 WHERE id = ?2", params![path, id])?;
        Ok(())
    }

    pub fn add_watch(&self, path: &str, volume_id: Option<i64>, relative: &str) -> Result<(), DbError> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO watched_roots (path, volume_id, relative_path, added_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET
                volume_id = excluded.volume_id,
                relative_path = excluded.relative_path",
            params![path, volume_id, relative, unix_now()],
        )?;
        Ok(())
    }

    pub fn set_volume(&self, id: i64, volume_id: i64, relative: &str) -> Result<(), DbError> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE media_files SET volume_id = ?1, relative_path = ?2 WHERE id = ?3",
            params![volume_id, relative, id],
        )?;
        Ok(())
    }

    pub fn list_watches(&self) -> Result<Vec<WatchedRoot>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, path, volume_id, relative_path FROM watched_roots ORDER BY path",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(WatchedRoot {
                id: row.get(0)?,
                path: row.get(1)?,
                volume_id: row.get(2)?,
                relative_path: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn list_volumes(&self) -> Result<Vec<VolumeRecord>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT volumes.id, volumes.fingerprint, volumes.label, volumes.last_mount, volumes.last_seen_at,
                    COUNT(media_files.id)
             FROM volumes
             LEFT JOIN media_files ON media_files.volume_id = volumes.id
             GROUP BY volumes.id
             ORDER BY volumes.label COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let mount: String = row.get(3)?;
            Ok(VolumeRecord {
                id: row.get(0)?,
                fingerprint: row.get(1)?,
                label: row.get(2)?,
                last_mount: mount.clone(),
                last_seen_at: row.get(4)?,
                online: Path::new(&mount).is_dir(),
                media_count: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
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
            &format!("{MEDIA_SELECT} WHERE file_path = ?1"),
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

    pub fn set_color(&self, paths: &[String], color: Option<&str>) -> Result<usize, DbError> {
        if let Some(value) = color
            && !matches!(value, "red" | "yellow" | "green" | "blue" | "purple")
        {
            return Err(DbError::InvalidColor);
        }
        let conn = self.lock()?;
        let mut changed = 0;
        for path in paths {
            changed += conn.execute(
                "UPDATE media_files SET color_label = ?1 WHERE file_path = ?2",
                params![color, path],
            )?;
        }
        Ok(changed)
    }

    pub fn set_rotation(&self, path: &str, rotation: i64) -> Result<MediaRecord, DbError> {
        let degrees = ((rotation % 360) + 360) % 360;
        if degrees % 90 != 0 {
            return Err(DbError::InvalidFlag);
        }
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE media_files SET rotation = ?1 WHERE file_path = ?2",
            params![degrees, path],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(path.to_string()));
        }
        conn.query_row(&format!("{MEDIA_SELECT} WHERE file_path = ?1"), params![path], map_media)
            .map_err(DbError::from)
    }

    pub fn set_notes(&self, path: &str, notes: Option<&str>) -> Result<(), DbError> {
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE media_files SET notes = ?1 WHERE file_path = ?2",
            params![notes, path],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(path.to_string()));
        }
        Ok(())
    }

    pub fn set_develop(&self, path: &str, develop_json: Option<&str>) -> Result<(), DbError> {
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE media_files SET develop_json = ?1 WHERE file_path = ?2",
            params![develop_json, path],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(path.to_string()));
        }
        Ok(())
    }

    pub fn set_keywords(&self, path: &str, keywords: &[String]) -> Result<(), DbError> {
        let encoded = serde_json::to_string(keywords).unwrap_or_else(|_| "[]".into());
        let conn = self.lock()?;
        let changed = conn.execute(
            "UPDATE media_files SET keywords = ?1 WHERE file_path = ?2",
            params![encoded, path],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound(path.to_string()));
        }
        Ok(())
    }

    pub fn list_albums(&self) -> Result<Vec<AlbumRecord>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT albums.id, albums.name, COUNT(album_members.media_id)
             FROM albums
             LEFT JOIN album_members ON album_members.album_id = albums.id
             GROUP BY albums.id
             ORDER BY albums.name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AlbumRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                count: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn create_album(&self, name: &str) -> Result<AlbumRecord, DbError> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(DbError::NotFound("album name".into()));
        }
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO albums (name, created_at) VALUES (?1, ?2)",
            params![trimmed, unix_now()],
        )?;
        let id = conn.last_insert_rowid();
        Ok(AlbumRecord {
            id,
            name: trimmed.to_string(),
            count: 0,
        })
    }

    pub fn add_to_album(&self, album_id: i64, media_ids: &[i64]) -> Result<usize, DbError> {
        let conn = self.lock()?;
        let mut changed = 0;
        for media_id in media_ids {
            changed += conn.execute(
                "INSERT OR IGNORE INTO album_members (album_id, media_id) VALUES (?1, ?2)",
                params![album_id, media_id],
            )?;
        }
        Ok(changed)
    }

    pub fn album_media_ids(&self, album_id: i64) -> Result<Vec<i64>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT media_id FROM album_members WHERE album_id = ?1 ORDER BY media_id",
        )?;
        let rows = stmt.query_map(params![album_id], |row| row.get(0))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn copy_originals(&self, paths: &[String], destination: &str) -> Result<usize, DbError> {
        let dest = Path::new(destination);
        std::fs::create_dir_all(dest)?;
        let mut copied = 0;
        for path in paths {
            let source = Path::new(path);
            if !source.is_file() {
                continue;
            }
            let name = source.file_name().unwrap_or_default();
            let mut target = dest.join(name);
            if target.exists() {
                let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("frame");
                let ext = source.extension().and_then(|s| s.to_str()).unwrap_or("");
                target = dest.join(format!("{stem}-{copied}.{ext}"));
            }
            std::fs::copy(source, target)?;
            copied += 1;
        }
        Ok(copied)
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
        let expected = i64::try_from(crate::models::VISUAL_EMBEDDING_FLOATS * 4).unwrap_or(0);
        let mut stmt = conn.prepare(
            "SELECT media_files.id, media_files.file_path, media_files.thumbnail_path,
                    media_files.media_kind, media_files.exif_json
             FROM media_files
             LEFT JOIN media_embeddings ON media_embeddings.media_id = media_files.id
             WHERE (media_files.media_kind != 'video' OR media_files.thumbnail_path IS NOT NULL)
               AND (media_embeddings.embedding IS NULL OR length(media_embeddings.embedding) != ?1)
             ORDER BY media_files.id",
        )?;
        let rows = stmt.query_map(params![expected], |row| {
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
        conn.execute("DELETE FROM media_embeddings WHERE media_id = ?1", params![media_id])?;
        conn.execute("DELETE FROM media_captions WHERE media_id = ?1", params![media_id])?;
        conn.execute("DELETE FROM cluster_members WHERE media_id = ?1", params![media_id])?;
        Ok(())
    }

    pub fn upsert_embedding(&self, media_id: i64, embedding: &[f32]) -> Result<(), DbError> {
        let blob = embedding_to_blob(embedding);
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO media_embeddings (media_id, embedding) VALUES (?1, ?2)
             ON CONFLICT(media_id) DO UPDATE SET embedding = excluded.embedding",
            params![media_id, blob],
        )?;
        Ok(())
    }

    pub fn visual_embeddings(&self) -> Result<Vec<(i64, String, Vec<f32>)>, DbError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT media_files.id, media_files.file_path, media_embeddings.embedding
             FROM media_embeddings
             JOIN media_files ON media_files.id = media_embeddings.media_id
             ORDER BY media_files.id",
        )?;
        let rows = stmt.query_map([], |row| {
            let id: i64 = row.get(0)?;
            let path: String = row.get(1)?;
            let blob: Vec<u8> = row.get(2)?;
            Ok((id, path, blob_to_embedding(&blob)))
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
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

    /// Rewrite `clusters`, `cluster_members`, and `media_captions` from faces and labels.
    pub fn rebuild_concepts(&self) -> Result<(), DbError> {
        let mut conn = self.lock()?;
        concepts::write(&mut conn)
    }

    /// Refresh the concept tables, then read them for the AI Insights view.
    pub fn concept_index(&self) -> Result<ConceptIndex, DbError> {
        let mut conn = self.lock()?;
        concepts::write(&mut conn)?;
        concepts::read(&conn)
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
        if let Some(stem) = file.file_stem() {
            let name = stem.to_string_lossy();
            let _ = std::fs::remove_file(file.with_file_name(format!("{name}.1080.jpg")));
            let _ = std::fs::remove_file(file.with_file_name(format!("{name}.720.jpg")));
            let _ = std::fs::remove_file(file.with_file_name(format!("{name}.play.mp4")));
        }
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
        proxy_path: None,
        play_path: None,
        flag: row.get(12)?,
        color_label: row.get(13).ok().flatten(),
        rotation: row.get::<_, Option<i64>>(14).ok().flatten().unwrap_or(0),
        notes: row.get(15).ok().flatten(),
        keywords: row
            .get::<_, Option<String>>(16)
            .ok()
            .flatten()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default(),
        develop_json: row.get(17).ok().flatten(),
        volume_id: row.get(18).ok().flatten(),
        volume_label: None,
        volume_mount: None,
        relative_path: row.get(19).ok().flatten(),
        original_online: true,
        plug_hint: None,
        cull_hint: row.get(20).ok().flatten(),
        mark_in_ms: row.get(21).ok().flatten(),
        mark_out_ms: row.get(22).ok().flatten(),
        video: row
            .get::<_, Option<String>>(23)
            .ok()
            .flatten()
            .and_then(|raw| serde_json::from_str::<VideoProbe>(&raw).ok()),
    })
}

fn migrate(conn: &Connection) -> Result<(), DbError> {
    let columns = {
        let mut stmt = conn.prepare("PRAGMA table_info(media_files)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?
    };
    // Older libraries were created before capture time was stored. The column
    // has to exist before the index below, or opening the file fails.
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
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS media_embeddings (
            media_id INTEGER PRIMARY KEY REFERENCES media_files(id) ON DELETE CASCADE,
            embedding BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS clusters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL CHECK (kind IN ('burst', 'semantic', 'person')),
            label TEXT NOT NULL,
            summary TEXT,
            score REAL NOT NULL DEFAULT 0,
            source_id INTEGER,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cluster_members (
            cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
            media_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
            rank INTEGER NOT NULL DEFAULT 0,
            score REAL,
            PRIMARY KEY (cluster_id, media_id)
        );
        CREATE INDEX IF NOT EXISTS idx_cluster_members_media ON cluster_members (media_id);
        CREATE TABLE IF NOT EXISTS media_captions (
            media_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            caption TEXT,
            score REAL NOT NULL,
            PRIMARY KEY (media_id, tag)
        );
        CREATE INDEX IF NOT EXISTS idx_media_captions_tag ON media_captions (tag);",
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_media_files_captured_at ON media_files (captured_at DESC)",
        [],
    )?;
    let has_v3: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 3",
        [],
        |row| row.get(0),
    )?;
    if has_v3 == 0 {
        conn.execute_batch(
            "DELETE FROM media_embeddings;
             DELETE FROM faces;
             DELETE FROM people;
             DELETE FROM cluster_members;
             DELETE FROM clusters WHERE kind = 'person';
             UPDATE media_files SET vision_at = NULL;
             INSERT INTO schema_migrations (version, applied_at)
             VALUES (3, CAST(strftime('%s', 'now') AS INTEGER));",
        )?;
    }
    let columns = {
        let mut stmt = conn.prepare("PRAGMA table_info(media_files)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?
    };
    if !columns.iter().any(|name| name == "color_label") {
        conn.execute("ALTER TABLE media_files ADD COLUMN color_label TEXT", [])?;
    }
    if !columns.iter().any(|name| name == "rotation") {
        conn.execute(
            "ALTER TABLE media_files ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    if !columns.iter().any(|name| name == "notes") {
        conn.execute("ALTER TABLE media_files ADD COLUMN notes TEXT", [])?;
    }
    if !columns.iter().any(|name| name == "keywords") {
        conn.execute("ALTER TABLE media_files ADD COLUMN keywords TEXT", [])?;
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS albums (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS album_members (
            album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
            media_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
            PRIMARY KEY (album_id, media_id)
        );",
    )?;
    let has_v4: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 4",
        [],
        |row| row.get(0),
    )?;
    if has_v4 == 0 {
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (4, CAST(strftime('%s', 'now') AS INTEGER))",
            [],
        )?;
    }
    let columns = {
        let mut stmt = conn.prepare("PRAGMA table_info(media_files)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?
    };
    if !columns.iter().any(|name| name == "develop_json") {
        conn.execute("ALTER TABLE media_files ADD COLUMN develop_json TEXT", [])?;
    }
    let has_v5: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 5",
        [],
        |row| row.get(0),
    )?;
    if has_v5 == 0 {
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (5, CAST(strftime('%s', 'now') AS INTEGER))",
            [],
        )?;
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS volumes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fingerprint TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            last_mount TEXT NOT NULL,
            last_seen_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS watched_roots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            volume_id INTEGER REFERENCES volumes(id),
            relative_path TEXT,
            added_at INTEGER NOT NULL
        );",
    )?;
    let watch_columns = {
        let mut stmt = conn.prepare("PRAGMA table_info(watched_roots)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?
    };
    if !watch_columns.iter().any(|name| name == "relative_path") {
        conn.execute("ALTER TABLE watched_roots ADD COLUMN relative_path TEXT", [])?;
    }
    let columns = {
        let mut stmt = conn.prepare("PRAGMA table_info(media_files)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?
    };
    if !columns.iter().any(|name| name == "volume_id") {
        conn.execute("ALTER TABLE media_files ADD COLUMN volume_id INTEGER", [])?;
    }
    if !columns.iter().any(|name| name == "relative_path") {
        conn.execute("ALTER TABLE media_files ADD COLUMN relative_path TEXT", [])?;
    }
    let has_v6: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 6",
        [],
        |row| row.get(0),
    )?;
    if has_v6 == 0 {
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (6, CAST(strftime('%s', 'now') AS INTEGER))",
            [],
        )?;
    }
    let columns = {
        let mut stmt = conn.prepare("PRAGMA table_info(media_files)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?
    };
    if !columns.iter().any(|name| name == "cull_hint") {
        conn.execute("ALTER TABLE media_files ADD COLUMN cull_hint TEXT", [])?;
    }
    if !columns.iter().any(|name| name == "mark_in_ms") {
        conn.execute("ALTER TABLE media_files ADD COLUMN mark_in_ms INTEGER", [])?;
    }
    if !columns.iter().any(|name| name == "mark_out_ms") {
        conn.execute("ALTER TABLE media_files ADD COLUMN mark_out_ms INTEGER", [])?;
    }
    if !columns.iter().any(|name| name == "video_json") {
        conn.execute("ALTER TABLE media_files ADD COLUMN video_json TEXT", [])?;
    }
    let has_v7: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 7",
        [],
        |row| row.get(0),
    )?;
    if has_v7 == 0 {
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (7, CAST(strftime('%s', 'now') AS INTEGER))",
            [],
        )?;
    }
    Ok(())
}

#[derive(Clone)]
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
            "cull_hint",
            "mark_in_ms",
            "video_json",
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

        assert_eq!(summary.schema_version, 7);
        assert_eq!(summary.media_count, 0);
        for column in [
            "file_path",
            "content_hash",
            "file_size",
            "created_at",
            "modified_at",
            "indexed_at",
            "rating",
            "cull_hint",
            "mark_in_ms",
            "video_json",
        ] {
            assert!(
                summary.columns.iter().any(|name| name == column),
                "missing column {column}"
            );
        }

        let again = Library::open(dir.path().join("library.sqlite")).unwrap();
        assert_eq!(again.summary().unwrap().schema_version, 7);
    }

    #[test]
    fn older_library_adds_captured_at_before_indexing_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE media_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL UNIQUE,
                content_hash TEXT,
                file_size INTEGER NOT NULL,
                created_at INTEGER,
                modified_at INTEGER NOT NULL,
                indexed_at INTEGER NOT NULL,
                rating INTEGER,
                media_kind TEXT NOT NULL,
                exif_json TEXT
            );",
        )
        .unwrap();
        drop(conn);

        let library = Library::open(&path).unwrap();
        let summary = library.summary().unwrap();
        assert!(summary.columns.iter().any(|name| name == "captured_at"));
        drop(library);

        let conn = Connection::open(&path).unwrap();
        let indexed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'index' AND name = 'idx_media_files_captured_at'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(indexed, 1);
        conn.execute(
            "INSERT INTO media_files (file_path, file_size, modified_at, indexed_at, media_kind, captured_at)
             VALUES ('/photos/old.jpg', 4, 10, 10, 'image', 20)",
            [],
        )
        .unwrap();
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
            volume_id: None,
            relative_path: None,
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
            volume_id: None,
            relative_path: None,
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
            volume_id: None,
            relative_path: None,
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
            volume_id: None,
            relative_path: None,
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
            volume_id: None,
            relative_path: None,
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
            volume_id: None,
            relative_path: None,
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
        library
            .upsert_embedding(media_id, &vec![0.0; crate::models::VISUAL_EMBEDDING_FLOATS])
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

    #[test]
    fn concept_tables_group_bursts_labels_people_and_captions() {
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(dir.path().join("library.sqlite")).unwrap();
        let shots = [
            ("/trips/iceland/a.jpg", 1_000_i64),
            ("/trips/iceland/b.jpg", 1_500),
            ("/trips/iceland/c.jpg", 3_000),
            ("/trips/lisbon/d.jpg", 1_100),
            ("/trips/lisbon/e.jpg", 1_200),
        ];
        for (path, captured_at) in shots {
            library
                .upsert_media(NewMedia {
                    file_path: path,
                    content_hash: path,
                    file_size: 4,
                    created_at: None,
                    modified_at: captured_at,
                    media_kind: MediaKind::Image,
                    exif_json: None,
                    captured_at: Some(captured_at),
            volume_id: None,
            relative_path: None,
                })
                .unwrap();
        }
        let media = library.list_media().unwrap();
        let id = |name: &str| {
            media
                .iter()
                .find(|record| record.file_path.ends_with(name))
                .unwrap()
                .id
        };
        let beach = id("a.jpg");
        let also_beach = id("b.jpg");
        let dog = id("c.jpg");
        library
            .replace_labels(
                beach,
                &[
                    ("scene".into(), "beach".into(), 0.9),
                    ("object".into(), "lighthouse".into(), 0.4),
                ],
            )
            .unwrap();
        library
            .replace_labels(also_beach, &[("scene".into(), "beach".into(), 0.5)])
            .unwrap();
        library
            .replace_labels(dog, &[("pet".into(), "dog".into(), 0.8)])
            .unwrap();
        let index = library.concept_index().unwrap();
        let burst_labels: Vec<_> = index
            .clusters
            .iter()
            .filter(|cluster| cluster.kind == "burst")
            .map(|cluster| cluster.label.as_str())
            .collect();
        assert_eq!(burst_labels, vec!["Lisbon · 00:18", "Iceland · 00:16"]);
        let iceland = index
            .clusters
            .iter()
            .find(|cluster| cluster.label == "Iceland · 00:16")
            .unwrap();
        assert_eq!(iceland.media_ids, vec![beach, also_beach]);
        assert_eq!(iceland.summary.as_deref(), Some("2 frames · 8 min"));

        assert!(
            index
                .clusters
                .iter()
                .all(|cluster| cluster.kind != "semantic" && cluster.kind != "person")
        );

        let beach_caption = index
            .captions
            .iter()
            .find(|caption| caption.media_id == beach && caption.tag == "beach")
            .unwrap();
        assert_eq!(beach_caption.caption.as_deref(), Some("Beach and Lighthouse"));
        assert!(index.captions.iter().any(|caption| caption.tag == "dog"));
        assert!(SCHEMA_SQL.contains("CREATE TABLE IF NOT EXISTS clusters"));
        assert!(SCHEMA_SQL.contains("CREATE TABLE IF NOT EXISTS cluster_members"));
        assert!(SCHEMA_SQL.contains("CREATE TABLE IF NOT EXISTS media_captions"));
    }

    #[test]
    fn color_rotation_notes_and_albums_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(dir.path().join("library.sqlite")).unwrap();
        library
            .upsert_media(NewMedia {
                file_path: "/photos/a.jpg",
                content_hash: "aa",
                file_size: 8,
                created_at: None,
                modified_at: 10,
                media_kind: MediaKind::Image,
                exif_json: None,
                captured_at: Some(20),
            volume_id: None,
            relative_path: None,
            })
            .unwrap();
        library
            .set_color(&["/photos/a.jpg".into()], Some("green"))
            .unwrap();
        library.set_rotation("/photos/a.jpg", 90).unwrap();
        library.set_notes("/photos/a.jpg", Some("keep this")).unwrap();
        library
            .set_keywords("/photos/a.jpg", &["drone".into(), "gold coast".into()])
            .unwrap();
        let record = library.find_by_path("/photos/a.jpg").unwrap().unwrap();
        assert_eq!(record.color_label.as_deref(), Some("green"));
        assert_eq!(record.rotation, 90);
        assert_eq!(record.notes.as_deref(), Some("keep this"));
        assert_eq!(record.keywords, vec!["drone", "gold coast"]);
        let album = library.create_album("Keepers").unwrap();
        library.add_to_album(album.id, &[record.id]).unwrap();
        assert_eq!(library.album_media_ids(album.id).unwrap(), vec![record.id]);
        let source = dir.path().join("a.jpg");
        std::fs::write(&source, b"jpg").unwrap();
        library
            .upsert_media(NewMedia {
                file_path: source.to_str().unwrap(),
                content_hash: "bb",
                file_size: 3,
                created_at: None,
                modified_at: 10,
                media_kind: MediaKind::Image,
                exif_json: None,
                captured_at: Some(20),
            volume_id: None,
            relative_path: None,
            })
            .unwrap();
        let dest = dir.path().join("out");
        let copied = library
            .copy_originals(&[source.to_string_lossy().into_owned()], dest.to_str().unwrap())
            .unwrap();
        assert_eq!(copied, 1);
        assert!(dest.join("a.jpg").is_file());
        library
            .set_marks(source.to_str().unwrap(), Some(1000), Some(4000))
            .unwrap();
        let marked = library.find_by_path(source.to_str().unwrap()).unwrap().unwrap();
        assert_eq!(marked.mark_in_ms, Some(1000));
        assert_eq!(marked.mark_out_ms, Some(4000));
    }

    #[test]
    fn volumes_are_remembered_by_fingerprint() {
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(dir.path().join("library.sqlite")).unwrap();
        let first = library.upsert_volume("uuid:abc", "Drive E", "/Volumes/E").unwrap();
        let again = library.upsert_volume("uuid:abc", "Photos", "/media/photos").unwrap();
        assert_eq!(first, again);
        let volumes = library.list_volumes().unwrap();
        assert_eq!(volumes.len(), 1);
        assert_eq!(volumes[0].label, "Photos");
        assert_eq!(volumes[0].last_mount, "/media/photos");
        library
            .add_watch("/media/photos/cam", Some(first), "cam")
            .unwrap();
        assert_eq!(library.list_watches().unwrap()[0].relative_path.as_deref(), Some("cam"));
    }
}
