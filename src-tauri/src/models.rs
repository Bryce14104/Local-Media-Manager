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
}

/// A preview JPEG finished on a background thread.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailReady {
    pub id: i64,
    pub file_path: String,
    pub thumbnail_path: String,
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
