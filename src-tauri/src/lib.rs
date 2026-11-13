//! Shelf desktop shell.
//!
//! Startup opens `library.sqlite` in the OS app-data directory and applies
//! `db/schema.sql`. The window then talks to the catalog through commands.

mod commands;
mod db;
mod media_protocol;
mod models;
mod services;

use db::Library;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("shelf", |_ctx, request, responder| {
            std::thread::spawn(move || {
                responder.respond(media_protocol::handle(request));
            });
        })
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            let library = Library::open(directory.join("library.sqlite")).map_err(|err| {
                let boxed: Box<dyn std::error::Error> = Box::new(err);
                boxed
            })?;
            if let Ok(resources) = app.path().resource_dir() {
                let models = resources.join("models");
                if models.join("yunet.onnx").is_file() {
                    // The vision worker reads this before the first session is built.
                    unsafe { std::env::set_var("SHELF_MODELS", models) };
                }
            }
            if let Err(error) = services::warm_vision() {
                eprintln!("shelf index: CRITICAL ort initialization failed: {error}");
                let boxed: Box<dyn std::error::Error> = Box::new(error);
                return Err(boxed);
            }
            app.manage(library.clone());
            commands::spawn_catalog_jobs(library, app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ai_search,
            commands::log_search,
            commands::library_summary,
            commands::list_media,
            commands::scan_directory,
            commands::index_paths,
            commands::set_rating,
            commands::set_flags,
            commands::remove_media,
            commands::delete_media,
            commands::list_insights,
            commands::list_concepts,
            commands::rename_person,
            commands::merge_people,
            commands::split_face,
            commands::read_media,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shelf");
}
