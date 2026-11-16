//! File-system scanning and EXIF reading, then a write into the local catalog.

mod capture;
mod clip;
mod exif;
mod pool;
mod scanner;
mod thumbs;
mod vocab;
mod vision;
pub mod volumes;

pub use thumbs::{attach_sidecars, generate_missing_thumbnails_with};
pub use vision::{recognize_library, search_embeddings, warm_vision};

use crate::db::{DbError, Library, NewMedia};
use crate::models::{ExportReport, MediaRecord, ScanReport, VolumeRecord};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;
use thiserror::Error;

use crate::models::ExifSnapshot;
use capture::{capture_unix, unix_to_iso};
use exif::read_exif;
use scanner::{ScanError, describe_file, hash_file, scan_directory};

#[derive(Debug, Error)]
pub enum ServiceError {
    #[error(transparent)]
    Scan(#[from] ScanError),
    #[error(transparent)]
    Db(#[from] DbError),
    #[error("could not store EXIF: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0} is larger than Shelf can store")]
    FileTooLarge(String),
    #[error("choose a folder or some files")]
    Empty,
}

enum IndexOutcome {
    Indexed { note: Option<String> },
}

/// Index folders and individual media files.
///
/// A directory is scanned recursively. A file is stored only when Shelf
/// recognizes its extension. Other paths are reported and skipped.
pub fn index_paths(library: &Library, paths: &[String]) -> Result<ScanReport, ServiceError> {
    index_paths_with(library, paths, |_, _| {})
}

pub fn index_paths_with<F>(
    library: &Library,
    paths: &[String],
    mut progress: F,
) -> Result<ScanReport, ServiceError>
where
    F: FnMut(usize, usize),
{
    let started = Instant::now();
    let mut files = Vec::new();
    let mut failed = 0;
    let mut errors = Vec::new();
    let mut roots = Vec::new();
    let mut saw_path = false;

    for raw in paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        saw_path = true;
        let path = Path::new(trimmed);
        roots.push(path.display().to_string());
        if path.is_dir() {
            match scan_directory(path) {
                Ok(batch) => {
                    for note in batch.errors {
                        push_note(&mut errors, note);
                    }
                    files.extend(batch.files);
                }
                Err(err) => {
                    failed += 1;
                    push_note(&mut errors, err.to_string());
                }
            }
            continue;
        }
        match describe_file(path) {
            Ok(file) => files.push(file),
            Err(err) => {
                failed += 1;
                push_note(&mut errors, err.to_string());
            }
        }
    }

    if !saw_path {
        return Err(ServiceError::Empty);
    }

    for raw in &roots {
        remember_root(library, Path::new(raw));
    }

    let discovered = files.len();
    eprintln!("shelf index: scanning {}", roots.join(", "));
    let (indexed, unchanged, loop_failed, loop_errors) =
        index_files(library, &files, &mut progress);
    failed += loop_failed;
    eprintln!(
        "shelf index: scan finished, indexed {indexed}, unchanged {unchanged}, failed {failed}"
    );
    for note in loop_errors {
        push_note(&mut errors, note);
    }

    Ok(ScanReport {
        root: if roots.is_empty() {
            String::new()
        } else {
            roots.join(", ")
        },
        discovered,
        indexed,
        unchanged,
        failed,
        errors,
        duration_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}

/// Index every media file under `root`.
///
/// A file is left untouched when its size and modification time still match
/// the catalog and a hash is already stored. That path keeps the rating.
pub fn index_directory(library: &Library, root: &Path) -> Result<ScanReport, ServiceError> {
    index_directory_with(library, root, |_, _| {})
}

pub fn index_directory_with<F>(
    library: &Library,
    root: &Path,
    mut progress: F,
) -> Result<ScanReport, ServiceError>
where
    F: FnMut(usize, usize),
{
    let started = Instant::now();
    remember_root(library, root);
    eprintln!("shelf index: scanning {}", root.display());
    let batch = scan_directory(root)?;
    let discovered = batch.files.len();
    let mut errors = batch.errors;
    let (indexed, unchanged, failed, loop_errors) = index_files(library, &batch.files, &mut progress);
    for note in loop_errors {
        push_note(&mut errors, note);
    }
    eprintln!(
        "shelf index: scan finished, indexed {indexed}, unchanged {unchanged}, failed {failed}"
    );

    Ok(ScanReport {
        root: root.display().to_string(),
        discovered,
        indexed,
        unchanged,
        failed,
        errors,
        duration_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}

fn index_files<F>(
    library: &Library,
    files: &[crate::models::ScannedFile],
    progress: &mut F,
) -> (usize, usize, usize, Vec<String>)
where
    F: FnMut(usize, usize),
{
    let total = files.len();
    progress(0, total);
    let mut indexed = 0;
    let mut unchanged = 0;
    let mut failed = 0;
    let mut errors = Vec::new();
    let mut done = 0;
    let mut to_hash = Vec::new();

    for file in files {
        match plan_index(library, file) {
            Ok(IndexPlan::Unchanged) => {
                unchanged += 1;
                done += 1;
                progress(done, total);
            }
            Ok(IndexPlan::Hash(job)) => to_hash.push(job),
            Err(err) => {
                failed += 1;
                push_note(&mut errors, err.to_string());
                done += 1;
                progress(done, total);
            }
        }
    }

    if !to_hash.is_empty() {
        let workers = pool::catalog_threads();
        eprintln!(
            "shelf index: hashing {} files on {workers} workers",
            to_hash.len()
        );
        for result in pool::map_unordered(to_hash, workers, hash_index_job) {
            match store_hashed(library, result) {
                Ok(IndexOutcome::Indexed { note }) => {
                    indexed += 1;
                    if let Some(note) = note {
                        push_note(&mut errors, note);
                    }
                }
                Err(err) => {
                    failed += 1;
                    push_note(&mut errors, err.to_string());
                }
            }
            done += 1;
            progress(done, total);
        }
    }
    (indexed, unchanged, failed, errors)
}

enum IndexPlan {
    Unchanged,
    Hash(HashJob),
}

struct HashJob {
    path: String,
    file_size: u64,
    created_at: Option<i64>,
    modified_at: i64,
    media_kind: crate::models::MediaKind,
    volume_id: i64,
    relative: String,
}

struct HashResult {
    job: HashJob,
    payload: Result<(String, Option<i64>, Option<String>, Option<String>), String>,
}

fn plan_index(library: &Library, file: &crate::models::ScannedFile) -> Result<IndexPlan, ServiceError> {
    let path = file.path_string();
    let volume = volumes::detect(&file.path);
    let volume_id = library.upsert_volume(&volume.fingerprint, &volume.label, &volume.mount)?;
    let relative = volumes::relative_to(&file.path, &volume.mount);

    let mut existing = library.find_by_path(&path)?;
    if existing.is_none() {
        existing = library.find_by_volume_path(volume_id, &relative)?;
        if let Some(row) = existing.as_ref()
            && row.file_path != path
        {
            library.set_file_path(row.id, &path)?;
        }
    }
    if let Some(existing) = existing {
        library.set_volume(existing.id, volume_id, &relative)?;
        let same_size = i64::try_from(file.file_size)
            .ok()
            .is_some_and(|size| size == existing.file_size);
        if same_size && existing.modified_at == file.modified_at && existing.content_hash.is_some()
        {
            if existing.captured_at.is_none()
                && let Some(unix) = capture_unix(&file.path)
            {
                library.set_captured_at(&path, unix)?;
            }
            let missing_gps = existing
                .exif
                .as_ref()
                .is_none_or(|exif| exif.latitude.is_none() || exif.longitude.is_none());
            if missing_gps
                && let Ok(Some(fresh)) = read_exif(&file.path)
                && fresh.latitude.is_some()
                && fresh.longitude.is_some()
                && let Ok(json) = serde_json::to_string(&fresh)
            {
                library.set_exif_json(&path, &json)?;
            }
            return Ok(IndexPlan::Unchanged);
        }
    }

    Ok(IndexPlan::Hash(HashJob {
        path,
        file_size: file.file_size,
        created_at: file.created_at,
        modified_at: file.modified_at,
        media_kind: file.media_kind,
        volume_id,
        relative,
    }))
}

fn hash_index_job(job: HashJob) -> HashResult {
    let path = Path::new(&job.path);
    let payload = (|| {
        let hash = hash_file(path)?;
        let captured_at = capture_unix(path);
        let (exif_json, note) = match read_exif(path) {
            Ok(snapshot) => {
                let mut snapshot = snapshot.filter(|item| !item.is_empty());
                if let Some(unix) = captured_at {
                    let entry = snapshot.get_or_insert_with(ExifSnapshot::default);
                    entry.captured_at = Some(unix_to_iso(unix));
                }
                let json = match snapshot {
                    Some(snapshot) => Some(serde_json::to_string(&snapshot)?),
                    None => None,
                };
                (json, None)
            }
            Err(err) => (None, Some(format!("{}: {err}", job.path))),
        };
        Ok::<_, ServiceError>((hash, captured_at, exif_json, note))
    })()
    .map_err(|err| err.to_string());
    HashResult { job, payload }
}

fn store_hashed(library: &Library, result: HashResult) -> Result<IndexOutcome, ServiceError> {
    let HashResult { job, payload } = result;
    let (hash, captured_at, exif_json, note) = payload.map_err(|err| {
        ServiceError::Scan(ScanError::Io {
            path: job.path.clone(),
            source: std::io::Error::other(err),
        })
    })?;
    let Ok(file_size) = i64::try_from(job.file_size) else {
        return Err(ServiceError::FileTooLarge(job.path));
    };

    library.upsert_media(NewMedia {
        file_path: &job.path,
        content_hash: &hash,
        file_size,
        created_at: job.created_at,
        modified_at: job.modified_at,
        media_kind: job.media_kind,
        exif_json: exif_json.as_deref(),
        captured_at,
        volume_id: Some(job.volume_id),
        relative_path: Some(&job.relative),
    })?;

    Ok(IndexOutcome::Indexed { note })
}

fn remember_root(library: &Library, root: &Path) {
    if !root.exists() {
        return;
    }
    let volume = volumes::detect(root);
    let Ok(volume_id) = library.upsert_volume(&volume.fingerprint, &volume.label, &volume.mount) else {
        return;
    };
    let relative = volumes::relative_to(root, &volume.mount);
    let _ = library.add_watch(&root.display().to_string(), Some(volume_id), &relative);
}

pub fn hydrate_origins(library: &Library, records: &mut [MediaRecord]) {
    let volumes = library.list_volumes().unwrap_or_default();
    let by_id: HashMap<i64, VolumeRecord> = volumes.into_iter().map(|volume| (volume.id, volume)).collect();
    for record in records {
        let Some(volume_id) = record.volume_id else {
            record.original_online = Path::new(&record.file_path).is_file();
            continue;
        };
        let Some(volume) = by_id.get(&volume_id) else {
            record.original_online = Path::new(&record.file_path).is_file();
            continue;
        };
        record.volume_label = Some(volume.label.clone());
        record.volume_mount = Some(volume.last_mount.clone());
        let relative = record.relative_path.clone().unwrap_or_default();
        let remounted = volumes::join_mount(&volume.last_mount, &relative);
        if remounted.is_file() && remounted.to_string_lossy() != record.file_path {
            let next = remounted.to_string_lossy().into_owned();
            let _ = library.set_file_path(record.id, &next);
            record.file_path = next;
        }
        let on_volume = Path::new(&record.file_path).starts_with(&volume.last_mount);
        record.original_online =
            remounted.is_file() || (on_volume && Path::new(&record.file_path).is_file());
        record.plug_hint = Some(volumes::plug_hint(
            &volume.label,
            &volume.last_mount,
            record.original_online,
        ));
    }
}

pub fn sync_volumes(library: &Library) {
    let Ok(known) = library.list_volumes() else {
        return;
    };
    let live = volumes::live_mounts();
    for volume in known {
        if Path::new(&volume.last_mount).is_dir() {
            let detected = volumes::detect(Path::new(&volume.last_mount));
            let _ = library.upsert_volume(&detected.fingerprint, &detected.label, &detected.mount);
            continue;
        }
        if let Some(found) = live.iter().find(|item| item.fingerprint == volume.fingerprint) {
            let _ = library.upsert_volume(&found.fingerprint, &found.label, &found.mount);
        }
    }
}

pub fn newly_plugged<'a>(previous: &[VolumeRecord], current: &'a [VolumeRecord]) -> Vec<&'a VolumeRecord> {
    current
        .iter()
        .filter(|now| {
            now.online
                && previous
                    .iter()
                    .any(|was| was.fingerprint == now.fingerprint && !was.online)
        })
        .collect()
}

pub fn rescan_watched_with<F>(
    library: &Library,
    volume_fingerprint: Option<&str>,
    mut progress: F,
) -> Result<ScanReport, ServiceError>
where
    F: FnMut(usize, usize),
{
    sync_volumes(library);
    let mut watches = library.list_watches()?;
    let volumes = library.list_volumes().unwrap_or_default();
    if let Some(fingerprint) = volume_fingerprint {
        let Some(volume) = volumes.iter().find(|item| item.fingerprint == fingerprint) else {
            progress(0, 0);
            return Ok(ScanReport {
                root: String::new(),
                discovered: 0,
                indexed: 0,
                unchanged: 0,
                failed: 0,
                errors: vec!["That drive is not in the library.".into()],
                duration_ms: 0,
            });
        };
        watches.retain(|watch| watch.volume_id == Some(volume.id));
    }
    if watches.is_empty() {
        progress(0, 0);
        return Ok(ScanReport {
            root: String::new(),
            discovered: 0,
            indexed: 0,
            unchanged: 0,
            failed: 0,
            errors: vec!["No remembered folders yet.".into()],
            duration_ms: 0,
        });
    }
    let mut combined = ScanReport {
        root: String::new(),
        discovered: 0,
        indexed: 0,
        unchanged: 0,
        failed: 0,
        errors: Vec::new(),
        duration_ms: 0,
    };
    let roots: Vec<PathBuf> = watches
        .iter()
        .map(|watch| resolve_watch(watch, &volumes))
        .collect();
    let online: Vec<PathBuf> = roots.into_iter().filter(|root| root.is_dir()).collect();
    if online.is_empty() {
        combined.errors.push("Remembered folders are offline. Plug the drive back in.".into());
        return Ok(combined);
    }
    combined.root = online
        .iter()
        .map(|root| root.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    let paths: Vec<String> = online.iter().map(|root| root.display().to_string()).collect();
    let report = index_paths_with(library, &paths, &mut progress)?;
    Ok(report)
}

fn resolve_watch(watch: &crate::models::WatchedRoot, volumes: &[VolumeRecord]) -> PathBuf {
    let current = PathBuf::from(&watch.path);
    if current.is_dir() {
        return current;
    }
    let Some(volume_id) = watch.volume_id else {
        return current;
    };
    let Some(volume) = volumes.iter().find(|item| item.id == volume_id) else {
        return current;
    };
    let Some(relative) = watch.relative_path.as_deref() else {
        return current;
    };
    volumes::join_mount(&volume.last_mount, relative)
}

pub fn export_media(library: &Library, paths: &[String], destination: &str) -> Result<ExportReport, DbError> {
    let dest = Path::new(destination);
    std::fs::create_dir_all(dest)?;
    let mut report = ExportReport::default();
    for path in paths {
        let mut record = match library.find_by_path(path)? {
            Some(record) => record,
            None => {
                report.missing.push(format!("{path}: not in the library"));
                continue;
            }
        };
        hydrate_origins(library, std::slice::from_mut(&mut record));
        thumbs::attach_sidecars(&mut record);
        let source = Path::new(&record.file_path);
        if source.is_file() {
            copy_named(source, dest, source.file_name().unwrap_or_default(), &mut report.originals)?;
            continue;
        }
        if let Some(proxy) = record.proxy_path.as_deref().or(record.thumbnail_path.as_deref()) {
            let proxy_path = Path::new(proxy);
            if proxy_path.is_file() {
                let stem = source.file_stem().and_then(|name| name.to_str()).unwrap_or("frame");
                let name = format!("{stem}-720.jpg");
                copy_named(proxy_path, dest, std::ffi::OsStr::new(&name), &mut report.proxies)?;
                if let Some(hint) = record.plug_hint {
                    report.missing.push(hint);
                }
                continue;
            }
        }
        report.missing.push(
            record
                .plug_hint
                .unwrap_or_else(|| format!("Plug the drive back in to export {path}")),
        );
    }
    Ok(report)
}

fn copy_named(
    source: &Path,
    dest: &Path,
    name: &std::ffi::OsStr,
    count: &mut usize,
) -> Result<(), DbError> {
    let mut target = dest.join(name);
    if target.exists() {
        let stem = Path::new(name)
            .file_stem()
            .and_then(|part| part.to_str())
            .unwrap_or("frame");
        let ext = Path::new(name)
            .extension()
            .and_then(|part| part.to_str())
            .unwrap_or("");
        target = dest.join(format!("{stem}-{count}.{ext}"));
    }
    std::fs::copy(source, target)?;
    *count += 1;
    Ok(())
}

fn push_note(errors: &mut Vec<String>, message: String) {
    if errors.len() < 50 {
        errors.push(message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Library;

    #[test]
    fn index_stores_hash_and_keeps_rating_across_rescans() {
        let root = tempfile::tempdir().unwrap();
        let photo = root.path().join("a.jpg");
        std::fs::write(&photo, b"jpeg-bytes").unwrap();

        let database = tempfile::tempdir().unwrap();
        let library = Library::open(database.path().join("library.sqlite")).unwrap();

        let first = index_directory(&library, root.path()).unwrap();
        assert_eq!(first.discovered, 1);
        assert_eq!(first.indexed, 1);
        assert_eq!(first.failed, 0);

        let media = library.list_media().unwrap();
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].file_size, 10);
        assert_eq!(media[0].content_hash.as_ref().unwrap().len(), 64);
        assert!(media[0].exif.is_none());
        assert!(media[0].volume_id.is_some());
        assert!(media[0].relative_path.as_ref().is_some_and(|path| path.ends_with("a.jpg")));
        assert_eq!(library.list_watches().unwrap().len(), 1);
        assert_eq!(library.list_volumes().unwrap().len(), 1);

        let rated = library.set_rating(&media[0].file_path, Some(5)).unwrap();
        assert_eq!(rated.rating, Some(5));

        let second = index_directory(&library, root.path()).unwrap();
        assert_eq!(second.unchanged, 1);
        assert_eq!(second.indexed, 0);
        assert_eq!(library.list_media().unwrap()[0].rating, Some(5));

        std::fs::write(&photo, b"jpeg-bytes-changed").unwrap();
        let third = index_directory(&library, root.path()).unwrap();
        assert_eq!(third.indexed, 1);
        let updated = &library.list_media().unwrap()[0];
        assert_eq!(updated.rating, Some(5));
        assert_ne!(updated.file_size, 10);
        assert_ne!(
            updated.content_hash.as_deref(),
            media[0].content_hash.as_deref()
        );
    }

    #[test]
    fn index_paths_accepts_a_folder_and_a_file() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("still.jpg"), b"jpeg-bytes").unwrap();
        let loose = tempfile::tempdir().unwrap();
        let clip = loose.path().join("clip.mp4");
        std::fs::write(&clip, b"video-bytes").unwrap();
        std::fs::write(loose.path().join("notes.txt"), b"skip").unwrap();

        let database = tempfile::tempdir().unwrap();
        let library = Library::open(database.path().join("library.sqlite")).unwrap();
        let report = index_paths(
            &library,
            &[
                root.path().display().to_string(),
                clip.display().to_string(),
                loose.path().join("notes.txt").display().to_string(),
            ],
        )
        .unwrap();

        assert_eq!(report.discovered, 2);
        assert_eq!(report.indexed, 2);
        assert_eq!(report.failed, 1);
        let mut names: Vec<_> = library
            .list_media()
            .unwrap()
            .into_iter()
            .map(|record| record.file_path)
            .collect();
        names.sort();
        assert!(names.iter().any(|path| path.ends_with("still.jpg")));
        assert!(names.iter().any(|path| path.ends_with("clip.mp4")));
    }

    #[test]
    fn newly_plugged_only_when_a_known_drive_comes_back() {
        let offline = VolumeRecord {
            id: 1,
            fingerprint: "uuid:cam".into(),
            label: "Camera".into(),
            last_mount: "/Volumes/missing".into(),
            last_seen_at: 1,
            online: false,
            media_count: 12,
        };
        let still_online = VolumeRecord {
            id: 2,
            fingerprint: "uuid:home".into(),
            label: "Home".into(),
            last_mount: "/".into(),
            last_seen_at: 1,
            online: true,
            media_count: 3,
        };
        let previous = vec![offline.clone(), still_online.clone()];
        let mut plugged = offline.clone();
        plugged.online = true;
        plugged.last_mount = "/Volumes/Camera".into();
        let current = vec![plugged, still_online];
        let found = newly_plugged(&previous, &current);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].fingerprint, "uuid:cam");
        assert!(newly_plugged(&current, &current).is_empty());
    }

    #[test]
    fn rescan_a_remembered_drive_picks_up_new_files() {
        let disk = tempfile::tempdir().unwrap();
        std::fs::write(disk.path().join("one.jpg"), b"jpeg-bytes").unwrap();
        let database = tempfile::tempdir().unwrap();
        let library = Library::open(database.path().join("library.sqlite")).unwrap();
        index_directory(&library, disk.path()).unwrap();
        std::fs::write(disk.path().join("two.jpg"), b"jpeg-bytes").unwrap();

        let fingerprint = library.list_volumes().unwrap()[0].fingerprint.clone();
        let unknown = rescan_watched_with(&library, Some("uuid:missing"), |_, _| {}).unwrap();
        assert!(unknown.errors.iter().any(|error| error.contains("not in the library")));
        assert_eq!(library.list_media().unwrap().len(), 1);

        let report = rescan_watched_with(&library, Some(&fingerprint), |_, _| {}).unwrap();
        assert_eq!(report.indexed, 1);
        assert_eq!(library.list_media().unwrap().len(), 2);
    }

    #[test]
    fn remembered_drive_can_go_offline_without_losing_the_row() {
        let disk = tempfile::tempdir().unwrap();
        let photo = disk.path().join("cam").join("a.jpg");
        std::fs::create_dir_all(photo.parent().unwrap()).unwrap();
        std::fs::write(&photo, b"jpeg-bytes").unwrap();
        let database = tempfile::tempdir().unwrap();
        let library = Library::open(database.path().join("library.sqlite")).unwrap();
        index_directory(&library, disk.path()).unwrap();

        let mut media = library.list_media().unwrap();
        hydrate_origins(&library, &mut media);
        assert!(media[0].original_online);
        let id = media[0].id;
        let fingerprint = library.list_volumes().unwrap()[0].fingerprint.clone();
        library
            .upsert_volume(&fingerprint, "Drive E", "/Volumes/missing-disk")
            .unwrap();

        let mut media = library.list_media().unwrap();
        hydrate_origins(&library, &mut media);
        assert_eq!(media[0].id, id);
        assert!(!media[0].original_online);
        assert!(
            media[0]
                .plug_hint
                .as_ref()
                .is_some_and(|hint| hint.contains("Drive E"))
        );
    }

    #[test]
    fn index_sorts_by_xmp_capture_time() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(
            root.path().join("later-import.jpg"),
            b"plain-bytes-without-a-date",
        )
        .unwrap();
        std::fs::write(
            root.path().join("earlier-shot.jpg"),
            b"junk exif:DateTimeOriginal=\"2018-01-02T03:04:05\" tail",
        )
        .unwrap();

        let database = tempfile::tempdir().unwrap();
        let library = Library::open(database.path().join("library.sqlite")).unwrap();
        index_directory(&library, root.path()).unwrap();

        let media = library.list_media().unwrap();
        assert!(media[0].file_path.ends_with("earlier-shot.jpg"));
        assert_eq!(
            media[0].exif.as_ref().and_then(|exif| exif.captured_at.as_deref()),
            Some("2018-01-02T03:04:05")
        );
        assert!(media[1].captured_at.is_none());
    }
}
