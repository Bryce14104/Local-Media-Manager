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
                let ready = services::generate_missing_thumbnails_with(&library, |done, total| {
                    let _ = handle.emit(
                        "library-progress",
                        crate::models::JobProgress {
                            phase: "thumbnails".to_string(),
                            done,
                            total,
                            label: "Writing previews".to_string(),
                        },
                    );
                });
                for item in &ready {
                    let _ = handle.emit("thumbnail-ready", item);
                }
                let _ = handle.emit(
                    "library-progress",
                    crate::models::JobProgress {
                        phase: "done".to_string(),
                        done: 1,
                        total: 1,
                        label: "Catalog ready".to_string(),
                    },
                );
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library_summary,
            commands::list_media,
            commands::scan_directory,
            commands::index_paths,
            commands::set_rating,
            commands::set_flags,
            commands::remove_media,
            commands::delete_media,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shelf");
}
