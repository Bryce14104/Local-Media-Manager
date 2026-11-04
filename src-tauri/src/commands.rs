//! Tauri commands the React UI calls through `invoke`.

use crate::db::Library;
use crate::models::{LibrarySummary, MediaRecord, ScanReport};
use crate::services;
use std::path::Path;
use tauri::{AppHandle, Emitter, State, async_runtime};

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
    let report = async_runtime::spawn_blocking({
        let library = library.clone();
        move || services::index_directory(&library, Path::new(&root)).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())??;
    spawn_thumbnails(library, app);
    Ok(report)
}

#[tauri::command]
pub async fn index_paths(
    paths: Vec<String>,
    state: State<'_, Library>,
    app: AppHandle,
) -> Result<ScanReport, String> {
    let library = Library::clone(&*state);
    let report = async_runtime::spawn_blocking({
        let library = library.clone();
        move || services::index_paths(&library, &paths).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())??;
    spawn_thumbnails(library, app);
    Ok(report)
}

fn spawn_thumbnails(library: Library, app: AppHandle) {
    std::thread::spawn(move || {
        for ready in services::generate_missing_thumbnails(&library) {
            let _ = app.emit("thumbnail-ready", &ready);
        }
    });
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
