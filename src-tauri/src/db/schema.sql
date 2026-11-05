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
-- flag           pick, reject, or NULL
-- vision_at      when the local vision pass last finished, unix seconds, or NULL
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
    thumbnail_path TEXT,
    flag TEXT CHECK (flag IS NULL OR flag IN ('pick', 'reject')),
    vision_at INTEGER
);

-- A person cluster. `name` stays NULL until someone names the cluster.
CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    created_at INTEGER NOT NULL
);

-- One detected face. The embedding is 128 little-endian f32 values from SFace.
CREATE TABLE IF NOT EXISTS faces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    confidence REAL NOT NULL,
    embedding BLOB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_faces_media_id ON faces (media_id);
CREATE INDEX IF NOT EXISTS idx_faces_person_id ON faces (person_id);

-- Subject and scene tags. kind is pet, wildlife, animal, scene, or object.
CREATE TABLE IF NOT EXISTS media_labels (
    media_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    score REAL NOT NULL,
    PRIMARY KEY (media_id, kind, label)
);

CREATE INDEX IF NOT EXISTS idx_media_files_modified_at
    ON media_files (modified_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_files_captured_at
    ON media_files (captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_files_rating
    ON media_files (rating);

CREATE INDEX IF NOT EXISTS idx_media_files_content_hash
    ON media_files (content_hash);

-- One visual embedding per frame. The values are little-endian f32 scores
-- from the in-process ONNX classifier and the pixel rules, one per concept.
CREATE TABLE IF NOT EXISTS media_embeddings (
    media_id INTEGER PRIMARY KEY REFERENCES media_files(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL
);

INSERT INTO schema_migrations (version, applied_at)
SELECT 1, CAST(strftime('%s', 'now') AS INTEGER)
WHERE NOT EXISTS (
    SELECT 1 FROM schema_migrations WHERE version = 1
);

INSERT INTO schema_migrations (version, applied_at)
SELECT 2, CAST(strftime('%s', 'now') AS INTEGER)
WHERE NOT EXISTS (
    SELECT 1 FROM schema_migrations WHERE version = 2
);
