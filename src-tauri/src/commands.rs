//! Tauri commands the React UI calls through `invoke`.

use crate::db::Library;
use crate::models::{ExportReport, JobProgress, LibrarySummary, MediaKind, MediaRecord, ScanReport, VolumeRecord, WatchedRoot};
use crate::services;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State, async_runtime};

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
        "shelf search: Smart Search {mode} | query {:?} | {}",
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
            services::index_directory_notified(
                &library,
                Path::new(&root),
                |done, total| {
                    emit_progress(&progress_app, "index", done, total, "Indexing");
                },
                |record| {
                    let _ = progress_app.emit("media-ready", record);
                },
            )
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
            services::index_paths_notified(
                &library,
                &paths,
                |done, total| {
                    emit_progress(&progress_app, "index", done, total, "Indexing");
                },
                |record| {
                    let _ = progress_app.emit("media-ready", record);
                },
            )
            .map_err(|err| err.to_string())
        }
    })
    .await
    .map_err(|err| err.to_string())??;
    spawn_catalog_jobs(library, app);
    Ok(report)
}

pub fn spawn_catalog_jobs(library: Library, app: AppHandle) {
    spawn_catalog_jobs_with(library, app, false);
}

pub fn spawn_catalog_jobs_with(library: Library, app: AppHandle, force_previews: bool) {
    std::thread::spawn(move || {
        let _guard = CATALOG_JOB.lock().unwrap_or_else(|err| err.into_inner());
        services::begin_job();
        eprintln!("shelf index: catalog job started");
        if !services::ffmpeg_available() {
            emit_progress(&app, "warning", 0, 1, "Install ffmpeg to play video proxies");
        }
        let ready = services::generate_previews(
            &library,
            |done, total| {
                emit_progress(&app, "thumbnails", done, total, "Writing previews");
            },
            |item| {
                let _ = app.emit("thumbnail-ready", item);
            },
            force_previews,
        );
        eprintln!("shelf index: wrote {} previews", ready.len());
        if services::canceled() {
            emit_progress(&app, "done", 1, 1, "Catalog stopped");
            return;
        }
        emit_progress(&app, "vision", 0, 1, "Tagging photos");
        if let Err(error) = services::recognize_library(&library, |done, total, label| {
            emit_progress(&app, "vision", done, total, label);
        }) {
            eprintln!("shelf index: visual tagging failed: {error}");
        }
        if !services::canceled() {
            let hinted = services::score_cull(&library);
            eprintln!("shelf index: cull hints on {hinted} frames");
            probe_pending_videos(&library);
        }
        emit_progress(&app, "done", 1, 1, if services::canceled() { "Catalog stopped" } else { "Catalog ready" });
        eprintln!("shelf index: catalog job finished");
    });
}

fn probe_pending_videos(library: &Library) {
    let Ok(media) = library.list_media() else {
        return;
    };
    for record in media {
        if record.media_kind != MediaKind::Video || record.video.is_some() {
            continue;
        }
        let _ = services::fill_video_meta(library, &record.file_path);
    }
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
pub fn download_originals(
    paths: Vec<String>,
    destination: String,
    state: State<'_, Library>,
) -> Result<services::DownloadReport, String> {
    services::download_originals(&state, &paths, Path::new(&destination)).map_err(|err| err.to_string())
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
pub fn preview_import(root: String, state: State<'_, Library>) -> Result<services::ImportPreview, String> {
    services::preview_import(&state, Path::new(&root)).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn relink_folder(root: String, state: State<'_, Library>) -> Result<services::RelinkReport, String> {
    services::relink_folder(&state, Path::new(&root)).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn library_health(state: State<'_, Library>) -> Result<services::LibraryHealth, String> {
    services::library_health(&state).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn similar_to(path: String, state: State<'_, Library>) -> Result<Vec<crate::models::AiSearchHit>, String> {
    services::similar_to(&state, &path).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn clone_virtual(path: String, state: State<'_, Library>) -> Result<MediaRecord, String> {
    let mut record = services::clone_virtual(&state, &path).map_err(|err| err.to_string())?;
    services::hydrate_origins(&state, std::slice::from_mut(&mut record));
    services::attach_sidecars(&mut record);
    Ok(record)
}

#[tauri::command]
pub fn working_preview(path: String, state: State<'_, Library>) -> Result<String, String> {
    services::working_preview(&state, &path).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn pause_catalog(paused: bool) {
    services::set_paused(paused);
}

#[tauri::command]
pub fn stop_catalog() {
    services::request_cancel();
}

#[tauri::command]
pub fn eject_volume(mount: String) -> Result<(), String> {
    services::eject_volume(&mount).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn remove_volume(volume_id: i64, state: State<'_, Library>) -> Result<usize, String> {
    state.remove_volume(volume_id).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn export_travel_library(
    destination: String,
    ids: Vec<i64>,
    state: State<'_, Library>,
) -> Result<services::TravelReport, String> {
    services::export_travel_library(&state, Path::new(&destination), &ids).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn open_library(path: String, state: State<'_, Library>, app: AppHandle) -> Result<LibrarySummary, String> {
    let file = PathBuf::from(path.trim());
    services::request_cancel();
    state.reopen(&file).map_err(|err| err.to_string())?;
    persist_active_library(&app, &file);
    spawn_catalog_jobs(Library::clone(&*state), app);
    Ok(state.summary().map_err(|err| err.to_string())?)
}

#[tauri::command]
pub fn new_library(destination: String, state: State<'_, Library>, app: AppHandle) -> Result<LibrarySummary, String> {
    let dest = PathBuf::from(destination.trim());
    services::request_cancel();
    if dest.is_dir() {
        let sqlite = dest.join("library.sqlite");
        state.reopen(&sqlite).map_err(|err| err.to_string())?;
        persist_active_library(&app, &sqlite);
    } else {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        state.reopen(&dest).map_err(|err| err.to_string())?;
        persist_active_library(&app, &dest);
    }
    spawn_catalog_jobs(Library::clone(&*state), app);
    Ok(state.summary().map_err(|err| err.to_string())?)
}

fn persist_active_library(app: &AppHandle, path: &Path) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::write(dir.join("active-library.txt"), path.to_string_lossy().as_bytes());
    }
}

#[tauri::command]
pub fn write_xmp(path: String, state: State<'_, Library>) -> Result<services::XmpReport, String> {
    services::write_xmp(&state, &path).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn set_marks(
    path: String,
    mark_in_ms: Option<i64>,
    mark_out_ms: Option<i64>,
    state: State<'_, Library>,
) -> Result<MediaRecord, String> {
    let mut record = state
        .set_marks(&path, mark_in_ms, mark_out_ms)
        .map_err(|err| err.to_string())?;
    services::hydrate_origins(&state, std::slice::from_mut(&mut record));
    services::attach_sidecars(&mut record);
    Ok(record)
}

#[tauri::command]
pub fn export_subclip(path: String, destination: String, state: State<'_, Library>) -> Result<String, String> {
    services::export_subclip(&state, &path, Path::new(&destination)).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn rebuild_previews(state: State<'_, Library>, app: AppHandle) -> Result<(), String> {
    if let Ok(media) = state.list_media() {
        for record in media {
            let _ = state.clear_thumbnail(&record.file_path);
        }
    }
    spawn_catalog_jobs_with(Library::clone(&*state), app, true);
    Ok(())
}

#[tauri::command]
pub fn ffmpeg_status() -> bool {
    services::ffmpeg_available()
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
