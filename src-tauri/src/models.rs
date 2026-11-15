//! Types shared by the database, the file services, and the React UI.
//!
//! Serde renames fields to camelCase so the frontend can use them directly.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Kind of media Shelf knows how to index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Image,
    Video,
    Raw,
}

impl MediaKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Video => "video",
            Self::Raw => "raw",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "video" => Self::Video,
            "raw" => Self::Raw,
            _ => Self::Image,
        }
    }
}

/// A media file found on disk, before it is written to SQLite.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScannedFile {
    pub path: PathBuf,
    pub file_size: u64,
    pub created_at: Option<i64>,
    pub modified_at: i64,
    pub media_kind: MediaKind,
}

impl ScannedFile {
    pub fn path_string(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }
}

/// Camera and capture fields Shelf keeps from an EXIF block.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExifSnapshot {
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens_model: Option<String>,
    pub captured_at: Option<String>,
    pub orientation: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub iso: Option<String>,
    pub exposure_time: Option<String>,
    pub f_number: Option<String>,
    pub focal_length: Option<String>,
    /// Decimal degrees times 1_000_000. South and west are negative.
    pub latitude: Option<i32>,
    pub longitude: Option<i32>,
}

impl ExifSnapshot {
    pub fn is_empty(&self) -> bool {
        self.camera_make.is_none()
            && self.camera_model.is_none()
            && self.lens_model.is_none()
            && self.captured_at.is_none()
            && self.orientation.is_none()
            && self.width.is_none()
            && self.height.is_none()
            && self.iso.is_none()
            && self.exposure_time.is_none()
            && self.f_number.is_none()
            && self.focal_length.is_none()
            && self.captured_at.is_none()
            && self.latitude.is_none()
            && self.longitude.is_none()
    }
}

/// One row from `media_files`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaRecord {
    pub id: i64,
    pub file_path: String,
    pub content_hash: Option<String>,
    pub file_size: i64,
    pub created_at: Option<i64>,
    pub modified_at: i64,
    pub indexed_at: i64,
    pub rating: Option<i64>,
    pub media_kind: MediaKind,
    pub exif: Option<ExifSnapshot>,
    pub captured_at: Option<i64>,
    pub thumbnail_path: Option<String>,
    pub proxy_path: Option<String>,
    pub play_path: Option<String>,
    pub flag: Option<String>,
    pub color_label: Option<String>,
    pub rotation: i64,
    pub notes: Option<String>,
    pub keywords: Vec<String>,
    pub develop_json: Option<String>,
    pub volume_id: Option<i64>,
    pub volume_label: Option<String>,
    pub volume_mount: Option<String>,
    pub relative_path: Option<String>,
    pub original_online: bool,
    pub plug_hint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeRecord {
    pub id: i64,
    pub fingerprint: String,
    pub label: String,
    pub last_mount: String,
    pub last_seen_at: i64,
    pub online: bool,
    pub media_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedRoot {
    pub id: i64,
    pub path: String,
    pub volume_id: Option<i64>,
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub originals: usize,
    pub proxies: usize,
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumRecord {
    pub id: i64,
    pub name: String,
    pub count: i64,
}

/// Progress for indexing or thumbnail generation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub label: String,
}

/// A preview JPEG finished on a background thread.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailReady {
    pub id: i64,
    pub file_path: String,
    pub thumbnail_path: String,
    pub proxy_path: Option<String>,
    pub play_path: Option<String>,
    pub media_kind: MediaKind,
}

/// Result of opening the local catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySummary {
    pub database_path: String,
    pub media_count: i64,
    pub schema_version: i64,
    pub columns: Vec<String>,
}

/// A named or still-unnamed person cluster.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonRecord {
    pub id: i64,
    pub name: Option<String>,
    pub face_count: i64,
}

/// A face box in normalized image coordinates, without the embedding.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceRecord {
    pub id: i64,
    pub media_id: i64,
    pub person_id: i64,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub confidence: f32,
}

/// A pet, wildlife, or scene tag written by the local vision pass.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelRecord {
    pub media_id: i64,
    pub kind: String,
    pub label: String,
    pub score: f32,
}

/// Length of the vector stored for each frame: 1000 ImageNet probabilities
/// from ResNet-50 `Session::run`, then one score per visual concept.
pub const IMAGENET_DIM: usize = 1000;
pub const VISUAL_CONCEPTS: usize = 27;
pub const VISUAL_EMBEDDING_FLOATS: usize = IMAGENET_DIM + VISUAL_CONCEPTS;

/// One frame ranked by the in-process visual embedding.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSearchHit {
    pub media_id: i64,
    pub path: String,
    pub score: f32,
    pub label: String,
}

/// People, faces, and subject tags for the open library.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightSnapshot {
    pub people: Vec<PersonRecord>,
    pub faces: Vec<FaceRecord>,
    pub labels: Vec<LabelRecord>,
}

/// A burst, semantic group, or person cluster stored in `clusters`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptCluster {
    pub id: i64,
    pub kind: String,
    pub label: String,
    pub summary: Option<String>,
    pub score: f32,
    /// `people.id` when `kind` is `person`.
    pub source_id: Option<i64>,
    pub media_ids: Vec<i64>,
}

/// One searchable caption tag from `media_captions`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaCaption {
    pub media_id: i64,
    pub tag: String,
    pub caption: Option<String>,
    pub score: f32,
}

/// Clusters, their members, and caption tags for the AI Insights view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptIndex {
    pub clusters: Vec<ConceptCluster>,
    pub captions: Vec<MediaCaption>,
}

/// What a folder scan changed in the catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub root: String,
    pub discovered: usize,
    pub indexed: usize,
    pub unchanged: usize,
    pub failed: usize,
    pub errors: Vec<String>,
    pub duration_ms: u64,
}
