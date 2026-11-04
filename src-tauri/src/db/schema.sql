-- Shelf library schema, version 1.
-- Applied when the database opens (see src-tauri/src/db/mod.rs).
-- Every statement is idempotent, so opening an existing library is safe.
--
-- Ratings are intentionally left alone by later rescans. The upsert in
-- db/mod.rs updates metadata and does not assign `rating`.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);

-- One row per media file Shelf has seen.
-- file_path      absolute path on this machine
-- content_hash   lowercase SHA-256 of the file bytes
-- file_size      size in bytes
-- created_at     creation time, unix seconds, when the OS provides one
-- modified_at    modification time, unix seconds
-- indexed_at     when Shelf last wrote this row, unix seconds
-- rating         0 through 5, or NULL when the file is unrated
-- media_kind     image, video, or raw
-- exif_json      selected EXIF fields as JSON, or NULL
-- captured_at    capture time from EXIF or XMP, unix seconds, or NULL
-- thumbnail_path low-res JPEG preview written by Shelf, or NULL
CREATE TABLE IF NOT EXISTS media_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    content_hash TEXT,
    file_size INTEGER NOT NULL,
    created_at INTEGER,
    modified_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL,
    rating INTEGER CHECK (rating IS NULL OR (rating BETWEEN 0 AND 5)),
    media_kind TEXT NOT NULL,
    exif_json TEXT,
    captured_at INTEGER,
    thumbnail_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_files_modified_at
    ON media_files (modified_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_files_captured_at
    ON media_files (captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_files_rating
    ON media_files (rating);

CREATE INDEX IF NOT EXISTS idx_media_files_content_hash
    ON media_files (content_hash);

INSERT INTO schema_migrations (version, applied_at)
SELECT 1, CAST(strftime('%s', 'now') AS INTEGER)
WHERE NOT EXISTS (
    SELECT 1 FROM schema_migrations WHERE version = 1
);
