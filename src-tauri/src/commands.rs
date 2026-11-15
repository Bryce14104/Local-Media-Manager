//! Tauri commands the React UI calls through `invoke`.

use crate::db::Library;
use crate::models::{ExportReport, JobProgress, LibrarySummary, MediaRecord, ScanReport, VolumeRecord, WatchedRoot};
use crate::services;
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, State, async_runtime};

static CATALOG_JOB: Mutex<()> = Mutex::new(());

#[tauri::command]
pub async fn ai_search(
    query: String,
    state: State<'_, Library>,
    app: AppHandle,
) -> Result<Vec<crate::models::AiSearchHit>, String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let library = Library::clone(&*state);
    let progress_app = app.clone();
    async_runtime::spawn_blocking(move || {
        eprintln!("shelf search: embedding search {query:?} — scoring every indexed image");
        if let Err(error) = services::recognize_library(&library, |done, total, label| {
            emit_progress(&progress_app, "vision", done, total, label);
        }) {
            eprintln!("shelf search: visual pass failed before scoring: {error}");
        }
        services::search_embeddings(&library, &query).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn log_search(ai: bool, query: String, summary: String) {
    let mode = if ai {
        "on, visual tags"
    } else {
        "off, file names and paths"
    };
    eprintln!(
        "shelf search: AI search {mode} | query {:?} | {}",
        query.trim(),
        if summary.trim().is_empty() { "no filter" } else { summary.trim() }
    );
}

#[tauri::command]
pub fn library_summary(state: State<'_, Library>) -> Result<LibrarySummary, String> {
    state.summary().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_media(state: State<'_, Library>) -> Result<Vec<MediaRecord>, String> {
    let mut media = state.list_media().map_err(|err| err.to_string())?;
    services::sync_volumes(&state);
    services::hydrate_origins(&state, &mut media);
    for record in &mut media {
        services::attach_sidecars(record);
    }
    Ok(media)
}

#[tauri::command]
pub fn list_volumes(state: State<'_, Library>) -> Result<Vec<VolumeRecord>, String> {
    services::sync_volumes(&state);
    state.list_volumes().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_watches(state: State<'_, Library>) -> Result<Vec<WatchedRoot>, String> {
    services::sync_volumes(&state);
    state.list_watches().map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn rescan_watched(
    volume_fingerprint: Option<String>,
    state: State<'_, Library>,
    app: AppHandle,
) -> Result<ScanReport, String> {
    let library = Library::clone(&*state);
    let progress_app = app.clone();
    let report = async_runtime::spawn_blocking({
        let library = library.clone();
        move || {
            services::rescan_watched_with(&library, volume_fingerprint.as_deref(), |done, total| {
                emit_progress(&progress_app, "index", done, total, "Rescanning");
            })
            .map_err(|err| err.to_string())
        }
    })
    .await
    .map_err(|err| err.to_string())??;
    spawn_catalog_jobs(library, app);
    Ok(report)
}

#[tauri::command]
pub async fn scan_directory(
    root: String,
    state: State<'_, Library>,
    app: AppHandle,
) -> Result<ScanReport, String> {
    let root = root.trim().to_string();
    if root.is_empty() {
        return Err("Enter a folder path.".to_string());
    }

    let library = Library::clone(&*state);
    let progress_app = app.clone();
    let report = async_runtime::spawn_blocking({
        let library = library.clone();
        move || {
            services::index_directory_with(&library, Path::new(&root), |done, total| {
                emit_progress(&progress_app, "index", done, total, "Indexing");
            })
            .map_err(|err| err.to_string())
        }
    })
    .await
    .map_err(|err| err.to_string())??;
    spawn_catalog_jobs(library, app);
    Ok(report)
}

#[tauri::command]
pub async fn index_paths(
    paths: Vec<String>,
    state: State<'_, Library>,
    app: AppHandle,
) -> Result<ScanReport, String> {
    let library = Library::clone(&*state);
    let progress_app = app.clone();
    let report = async_runtime::spawn_blocking({
        let library = library.clone();
        move || {
            services::index_paths_with(&library, &paths, |done, total| {
                emit_progress(&progress_app, "index", done, total, "Indexing");
            })
            .map_err(|err| err.to_string())
        }
    })
    .await
    .map_err(|err| err.to_string())??;
    spawn_catalog_jobs(library, app);
    Ok(report)
}

pub fn spawn_catalog_jobs(library: Library, app: AppHandle) {
    std::thread::spawn(move || {
        let _guard = CATALOG_JOB.lock().unwrap_or_else(|err| err.into_inner());
        eprintln!("shelf index: catalog job started");
        let ready = services::generate_missing_thumbnails_with(
            &library,
            |done, total| {
                emit_progress(&app, "thumbnails", done, total, "Writing previews");
            },
            |item| {
                let _ = app.emit("thumbnail-ready", item);
            },
        );
        eprintln!("shelf index: wrote {} previews", ready.len());
        if let Err(error) = services::recognize_library(&library, |done, total, label| {
            emit_progress(&app, "vision", done, total, label);
        }) {
            eprintln!("shelf index: visual tagging failed: {error}");
        }
        emit_progress(&app, "done", 1, 1, "Catalog ready");
        eprintln!("shelf index: catalog job finished");
    });
}

fn emit_progress(app: &AppHandle, phase: &str, done: usize, total: usize, label: &str) {
    let _ = app.emit(
        "library-progress",
        JobProgress {
            phase: phase.to_string(),
            done,
            total,
            label: label.to_string(),
        },
    );
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReport {
    pub removed: usize,
    pub failed: Vec<String>,
}

#[tauri::command]
pub fn remove_media(paths: Vec<String>, state: State<'_, Library>) -> Result<usize, String> {
    state.remove_paths(&paths).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn delete_media(paths: Vec<String>, state: State<'_, Library>) -> Result<DeleteReport, String> {
    let (removed, failed) = state.delete_paths(&paths).map_err(|err| err.to_string())?;
    Ok(DeleteReport { removed, failed })
}

#[tauri::command]
pub fn set_flags(
    paths: Vec<String>,
    flag: Option<String>,
    state: State<'_, Library>,
) -> Result<usize, String> {
    state
        .set_flag(&paths, flag.as_deref())
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_insights(state: State<'_, Library>) -> Result<crate::models::InsightSnapshot, String> {
    state.insights().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_concepts(state: State<'_, Library>) -> Result<crate::models::ConceptIndex, String> {
    state.concept_index().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn rename_person(id: i64, name: Option<String>, state: State<'_, Library>) -> Result<(), String> {
    let trimmed = name.as_deref().map(str::trim).filter(|value| !value.is_empty());
    state.rename_person(id, trimmed).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn merge_people(keep_id: i64, drop_id: i64, state: State<'_, Library>) -> Result<(), String> {
    state.merge_people(keep_id, drop_id).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn split_face(face_id: i64, state: State<'_, Library>) -> Result<i64, String> {
    state.split_face(face_id).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn set_rating(
    path: String,
    rating: Option<u8>,
    state: State<'_, Library>,
) -> Result<MediaRecord, String> {
    state
        .set_rating(&path, rating)
        .map_err(|err| err.to_string())
}

/// Raw bytes for the webview. Linux WebKit will not play MP4 from a custom protocol.
#[tauri::command]
pub fn read_media(path: String) -> Result<Response, String> {
    let file = Path::new(&path);
    if !file.is_file() {
        return Err(format!("missing file {path}"));
    }
    let bytes = std::fs::read(file).map_err(|err| err.to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn set_color(
    paths: Vec<String>,
    color: Option<String>,
    state: State<'_, Library>,
) -> Result<usize, String> {
    state
        .set_color(&paths, color.as_deref())
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn set_rotation(
    path: String,
    rotation: i64,
    state: State<'_, Library>,
) -> Result<MediaRecord, String> {
    state.set_rotation(&path, rotation).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn set_notes(path: String, notes: Option<String>, state: State<'_, Library>) -> Result<(), String> {
    let trimmed = notes.as_deref().map(str::trim).filter(|value| !value.is_empty());
    state.set_notes(&path, trimmed).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn set_keywords(
    path: String,
    keywords: Vec<String>,
    state: State<'_, Library>,
) -> Result<(), String> {
    let cleaned: Vec<String> = keywords
        .into_iter()
        .map(|word| word.trim().to_string())
        .filter(|word| !word.is_empty())
        .collect();
    state.set_keywords(&path, &cleaned).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_albums(state: State<'_, Library>) -> Result<Vec<crate::models::AlbumRecord>, String> {
    state.list_albums().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn create_album(name: String, state: State<'_, Library>) -> Result<crate::models::AlbumRecord, String> {
    state.create_album(&name).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn add_to_album(album_id: i64, media_ids: Vec<i64>, state: State<'_, Library>) -> Result<usize, String> {
    state.add_to_album(album_id, &media_ids).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn album_media_ids(album_id: i64, state: State<'_, Library>) -> Result<Vec<i64>, String> {
    state.album_media_ids(album_id).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(Path::new(&path)).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn copy_originals(
    paths: Vec<String>,
    destination: String,
    state: State<'_, Library>,
) -> Result<usize, String> {
    state
        .copy_originals(&paths, &destination)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn export_media(
    paths: Vec<String>,
    destination: String,
    state: State<'_, Library>,
) -> Result<ExportReport, String> {
    services::export_media(&state, &paths, &destination).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn set_develop(path: String, develop: Option<String>, state: State<'_, Library>) -> Result<(), String> {
    state.set_develop(&path, develop.as_deref()).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let file = Path::new(&path);
    if let Some(parent) = file.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    std::fs::write(file, bytes).map_err(|err| err.to_string())
}
