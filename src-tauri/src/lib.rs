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
use std::path::PathBuf;
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
            let marker = directory.join("active-library.txt");
            let sqlite = std::fs::read_to_string(&marker)
                .ok()
                .map(|raw| PathBuf::from(raw.trim()))
                .filter(|path| path.is_file())
                .unwrap_or_else(|| directory.join("library.sqlite"));
            let library = Library::open(sqlite).map_err(|err| {
                let boxed: Box<dyn std::error::Error> = Box::new(err);
                boxed
            })?;
            let cache = directory.join("models");
            std::fs::create_dir_all(&cache)?;
            if let Ok(resources) = app.path().resource_dir() {
                let bundled = resources.join("models");
                for name in ["tokenizer.json", "clip-vision.onnx", "clip-text.onnx"] {
                    let source = bundled.join(name);
                    let dest = cache.join(name);
                    if source.is_file() && !dest.is_file() {
                        let _ = std::fs::copy(&source, &dest);
                    }
                }
            }
            // CLIP weights download here on first launch if they were not bundled.
            unsafe { std::env::set_var("SHELF_MODELS", &cache) };
            if let Err(error) = services::warm_vision() {
                eprintln!("shelf index: CRITICAL ort initialization failed: {error}");
                let boxed: Box<dyn std::error::Error> = Box::new(error);
                return Err(boxed);
            }
            services::sync_volumes(&library);
            if let Ok(mut media) = library.list_media() {
                services::hydrate_origins(&library, &mut media);
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
            commands::list_volumes,
            commands::list_watches,
            commands::rescan_watched,
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
            commands::set_color,
            commands::set_rotation,
            commands::set_notes,
            commands::set_keywords,
            commands::list_albums,
            commands::create_album,
            commands::add_to_album,
            commands::album_media_ids,
            commands::reveal_path,
            commands::copy_originals,
            commands::download_originals,
            commands::export_media,
            commands::set_develop,
            commands::preview_import,
            commands::relink_folder,
            commands::library_health,
            commands::similar_to,
            commands::clone_virtual,
            commands::working_preview,
            commands::write_bytes,
            commands::pause_catalog,
            commands::stop_catalog,
            commands::eject_volume,
            commands::remove_volume,
            commands::export_travel_library,
            commands::open_library,
            commands::new_library,
            commands::write_xmp,
            commands::set_marks,
            commands::export_subclip,
            commands::rebuild_previews,
            commands::ffmpeg_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shelf");
}
