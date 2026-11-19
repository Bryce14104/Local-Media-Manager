//! Identify the disk a file lives on so Shelf can keep previews after unplug.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectedVolume {
    pub fingerprint: String,
    pub label: String,
    pub mount: String,
}

static CACHE: Mutex<Option<HashMap<String, DetectedVolume>>> = Mutex::new(None);

pub fn clear_cache() {
    if let Ok(mut guard) = CACHE.lock() {
        *guard = None;
    }
}

pub fn detect(path: &Path) -> DetectedVolume {
    let key = path
        .parent()
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned();
    if let Ok(guard) = CACHE.lock()
        && let Some(cache) = guard.as_ref()
        && let Some(hit) = cache.get(&key)
    {
        return hit.clone();
    }
    let found = detect_uncached(path);
    if let Ok(mut guard) = CACHE.lock() {
        let cache = guard.get_or_insert_with(HashMap::new);
        cache.insert(key, found.clone());
    }
    found
}

pub fn relative_to(path: &Path, mount: &str) -> String {
    let mount_path = Path::new(mount);
    path.strip_prefix(mount_path)
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"))
}

pub fn join_mount(mount: &str, relative: &str) -> PathBuf {
    let rel = relative.replace('/', std::path::MAIN_SEPARATOR_STR);
    Path::new(mount).join(rel)
}

pub fn plug_hint(label: &str, mount: &str, online: bool) -> String {
    if online {
        format!("{label} is connected at {mount}")
    } else {
        format!("Plug in {label} (last seen as {mount}) to open the original")
    }
}

pub fn live_mounts() -> Vec<DetectedVolume> {
    let mut found = Vec::new();
    for root in candidate_roots() {
        if !root.is_dir() {
            continue;
        }
        let volume = detect(&root);
        if found.iter().any(|item: &DetectedVolume| item.fingerprint == volume.fingerprint) {
            continue;
        }
        found.push(volume);
    }
    found
}

fn candidate_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    {
        for letter in b'A'..=b'Z' {
            roots.push(PathBuf::from(format!("{}:\\", letter as char)));
        }
    }
    #[cfg(not(windows))]
    {
        roots.push(PathBuf::from("/"));
        roots.push(PathBuf::from("/Volumes"));
        for parent in ["/media", "/mnt", "/run/media"] {
            let Ok(entries) = std::fs::read_dir(parent) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    roots.push(path.clone());
                    if let Ok(nested) = std::fs::read_dir(&path) {
                        for child in nested.flatten() {
                            if child.path().is_dir() {
                                roots.push(child.path());
                            }
                        }
                    }
                }
            }
        }
    }
    roots
}

fn detect_uncached(path: &Path) -> DetectedVolume {
    let absolute = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf());
    #[cfg(windows)]
    {
        return windows_volume(&absolute);
    }
    #[cfg(not(windows))]
    {
        unix_volume(&absolute)
    }
}

#[cfg(not(windows))]
fn unix_volume(path: &Path) -> DetectedVolume {
    let mount = unix_mount_root(path);
    let mount_str = mount.to_string_lossy().into_owned();
    let label = volume_label(&mount);
    let fingerprint = unix_fingerprint(&mount).unwrap_or_else(|| format!("path:{mount_str}"));
    DetectedVolume {
        fingerprint,
        label,
        mount: mount_str,
    }
}

#[cfg(not(windows))]
fn unix_mount_root(path: &Path) -> PathBuf {
    use std::os::unix::fs::MetadataExt;
    let Ok(meta) = std::fs::metadata(path) else {
        return path.parent().unwrap_or(path).to_path_buf();
    };
    let device = meta.dev();
    let mut current = if path.is_file() {
        path.parent().unwrap_or(path).to_path_buf()
    } else {
        path.to_path_buf()
    };
    loop {
        let Some(parent) = current.parent() else {
            return current;
        };
        let Ok(parent_meta) = std::fs::metadata(parent) else {
            return current;
        };
        if parent_meta.dev() != device {
            return current;
        }
        current = parent.to_path_buf();
    }
}

#[cfg(not(windows))]
fn unix_fingerprint(mount: &Path) -> Option<String> {
    let mount_str = mount.to_string_lossy();
    if let Some(uuid) = linux_uuid(&mount_str) {
        return Some(format!("uuid:{uuid}"));
    }
    let created = std::fs::metadata(mount)
        .and_then(|meta| meta.created())
        .ok()
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Some(format!("mnt:{mount_str}:{created}"))
}

#[cfg(not(windows))]
fn linux_uuid(mount: &str) -> Option<String> {
    let mounts = std::fs::read_to_string("/proc/mounts").ok()?;
    let mut device = None;
    for line in mounts.lines() {
        let mut parts = line.split_whitespace();
        let source = parts.next()?;
        let point = parts.next()?;
        if point == mount {
            device = Some(source.to_string());
        }
    }
    let device = device?;
    let entries = std::fs::read_dir("/dev/disk/by-uuid").ok()?;
    for entry in entries.flatten() {
        let Ok(target) = std::fs::read_link(entry.path()) else {
            continue;
        };
        let resolved = entry.path().parent().unwrap_or_else(|| Path::new("/")).join(target);
        if resolved.to_string_lossy() == device
            || resolved.file_name() == Path::new(&device).file_name()
            || device.ends_with(&entry.file_name().to_string_lossy().into_owned())
        {
            return Some(entry.file_name().to_string_lossy().into_owned());
        }
        if let Ok(canon) = resolved.canonicalize()
            && let Ok(dev_canon) = Path::new(&device).canonicalize()
            && canon == dev_canon
        {
            return Some(entry.file_name().to_string_lossy().into_owned());
        }
    }
    None
}

fn volume_label(mount: &Path) -> String {
    let name = mount
        .file_name()
        .and_then(|part| part.to_str())
        .unwrap_or("");
    if name.is_empty() || mount == Path::new("/") {
        return "System disk".into();
    }
    if name.len() == 2 && name.as_bytes()[1] == b':' {
        return format!("Drive {name}");
    }
    name.to_string()
}

#[cfg(windows)]
fn windows_volume(path: &Path) -> DetectedVolume {
    let mount = path
        .components()
        .next()
        .map(|component| {
            let mut root = PathBuf::new();
            root.push(component);
            if !root.to_string_lossy().ends_with('\\') {
                root.push("\\");
            }
            root
        })
        .unwrap_or_else(|| PathBuf::from("C:\\"));
    let mount_str = mount.to_string_lossy().into_owned();
    let (label, serial) = vol_command(&mount_str);
    DetectedVolume {
        fingerprint: format!("win:{serial}"),
        label: if label.is_empty() {
            format!("Drive {}", mount_str.trim_end_matches('\\'))
        } else {
            label
        },
        mount: mount_str,
    }
}

#[cfg(windows)]
fn vol_command(mount: &str) -> (String, String) {
    let letter = mount.chars().next().unwrap_or('C');
    let output = std::process::Command::new("cmd")
        .args(["/C", &format!("vol {letter}:")])
        .output()
        .ok();
    let text = output
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .unwrap_or_default();
    let mut label = String::new();
    let mut serial = format!("letter-{letter}");
    for line in text.lines() {
        if let Some(rest) = line.split(" is ").nth(1) {
            label = rest.trim().to_string();
        }
        if let Some(rest) = line.split("is ").last()
            && line.to_ascii_lowercase().contains("serial")
        {
            serial = rest.trim().to_string();
        }
    }
    (label, serial)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_the_disk_for_a_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.jpg");
        std::fs::write(&file, b"x").unwrap();
        let volume = detect(&file);
        assert!(!volume.fingerprint.is_empty());
        assert!(!volume.mount.is_empty());
        let rel = relative_to(&file, &volume.mount);
        assert!(rel.ends_with("a.jpg"), "{rel}");
        assert!(join_mount(&volume.mount, &rel).ends_with("a.jpg"));
    }
}
