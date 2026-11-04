//! Shelf desktop shell.
//!
//! Startup opens `library.sqlite` in the OS app-data directory and applies
//! `db/schema.sql`. The window then talks to the catalog through commands.

mod commands;
mod db;
mod models;
mod services;

use db::Library;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            let library = Library::open(directory.join("library.sqlite")).map_err(|err| {
                let boxed: Box<dyn std::error::Error> = Box::new(err);
                boxed
            })?;
            app.manage(library.clone());
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                for ready in services::generate_missing_thumbnails(&library) {
                    let _ = handle.emit("thumbnail-ready", &ready);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library_summary,
            commands::list_media,
            commands::scan_directory,
            commands::index_paths,
            commands::set_rating,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shelf");
}
