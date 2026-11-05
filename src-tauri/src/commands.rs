//! Tauri commands the React UI calls through `invoke`.

use crate::db::Library;
use crate::models::{JobProgress, LibrarySummary, MediaRecord, ScanReport};
use crate::services;
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State, async_runtime};

static CATALOG_JOB: Mutex<()> = Mutex::new(());

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
    state.list_media().map_err(|err| err.to_string())
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
        let ready = services::generate_missing_thumbnails_with(&library, |done, total| {
            emit_progress(&app, "thumbnails", done, total, "Writing previews");
        });
        eprintln!("shelf index: wrote {} previews", ready.len());
        for item in &ready {
            let _ = app.emit("thumbnail-ready", item);
        }
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
