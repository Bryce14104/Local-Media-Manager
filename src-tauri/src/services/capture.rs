//! Capture time from EXIF, then XMP.
//!
//! The filesystem import time is not a capture time. When neither EXIF nor
//! XMP has a date, callers leave `captured_at` empty.

use crate::services::exif::read_exif;
use std::fs::File;
use std::io::Read;
use std::path::Path;

const EDGE: u64 = 4 * 1024 * 1024;

/// Unix seconds for the capture instant, when metadata has one.
pub fn capture_unix(path: &Path) -> Option<i64> {
    if let Ok(Some(snapshot)) = read_exif(path)
        && let Some(raw) = snapshot.captured_at.as_deref()
        && let Some(unix) = parse_capture_unix(raw)
    {
        return Some(unix);
    }
    let bytes = read_edges(path).ok()?;
    xmp_date(&bytes).and_then(|raw| parse_capture_unix(&raw))
}

/// `YYYY:MM:DD HH:MM:SS`, `YYYY-MM-DDTHH:MM:SS`, with an optional timezone.
pub fn parse_capture_unix(raw: &str) -> Option<i64> {
    let text = raw.trim().trim_matches('"');
    let bytes = text.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let year = number(&bytes[0..4])?;
    let month = number(&bytes[5..7])?;
    let day = number(&bytes[8..10])?;
    let hour = number(&bytes[11..13])?;
    let minute = number(&bytes[14..16])?;
    let second = number(&bytes[17..19])?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let mut unix = civil_unix(year, month, day, hour, minute, second)?;
    if let Some(offset) = timezone_offset(text) {
        unix -= offset;
    }
    Some(unix)
}

pub fn unix_to_iso(unix: i64) -> String {
    let (year, month, day, hour, minute, second) = civil_from_unix(unix);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}")
}

fn xmp_date(bytes: &[u8]) -> Option<String> {
    const MARKERS: &[&[u8]] = &[
        b"exif:DateTimeOriginal=\"",
        b"exif:DateTimeOriginal>",
        b"xmp:CreateDate=\"",
        b"xmp:CreateDate>",
        b"photoshop:DateCreated=\"",
        b"photoshop:DateCreated>",
    ];
    for marker in MARKERS {
        let Some(start) = find_slice(bytes, marker) else {
            continue;
        };
        let rest = &bytes[start + marker.len()..];
        let end = rest
            .iter()
            .position(|byte| *byte == b'"' || *byte == b'<' || *byte == b'\n')
            .unwrap_or(rest.len().min(32));
        let text = String::from_utf8_lossy(&rest[..end]);
        if parse_capture_unix(&text).is_some() {
            return Some(text.trim().to_string());
        }
    }
    None
}

fn read_edges(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    if len <= EDGE * 2 {
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        return Ok(bytes);
    }
    let mut head = vec![0_u8; EDGE as usize];
    let read = file.read(&mut head)?;
    head.truncate(read);
    use std::io::{Seek, SeekFrom};
    file.seek(SeekFrom::End(-(EDGE as i64)))?;
    let mut tail = Vec::new();
    file.read_to_end(&mut tail)?;
    head.extend(tail);
    Ok(head)
}

fn timezone_offset(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    let sign_at = bytes.iter().rposition(|byte| *byte == b'+' || *byte == b'-')?;
    if sign_at < 19 || bytes.len() < sign_at + 6 {
        return None;
    }
    let sign = if bytes[sign_at] == b'+' { 1 } else { -1 };
    let hour = number(&bytes[sign_at + 1..sign_at + 3])?;
    let minute = number(&bytes[sign_at + 4..sign_at + 6])?;
    Some(sign * (hour as i64 * 3600 + minute as i64 * 60))
}

fn number(bytes: &[u8]) -> Option<u32> {
    let text = std::str::from_utf8(bytes).ok()?;
    text.parse().ok()
}

fn find_slice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

fn civil_unix(year: u32, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> Option<i64> {
    let days = days_from_civil(year as i32, month as i32, day as i32)?;
    Some(days * 86_400 + hour as i64 * 3600 + minute as i64 * 60 + second as i64)
}

fn civil_from_unix(unix: i64) -> (i32, u32, u32, u32, u32, u32) {
    let days = unix.div_euclid(86_400);
    let secs = unix.rem_euclid(86_400) as u32;
    let (year, month, day) = civil_from_days(days);
    (year, month, day, secs / 3600, (secs % 3600) / 60, secs % 60)
}

fn days_from_civil(year: i32, month: i32, day: i32) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let y = if month <= 2 { year - 1 } else { year } as i64;
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400) as u64;
    let mp = if month > 2 { month - 3 } else { month + 9 } as u64;
    let doy = (153 * mp + 2) / 5 + day as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe as i64 - 719_468)
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    (year as i32, month as u32, day as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_exif_and_xmp_shapes() {
        assert_eq!(parse_capture_unix("2024:06:01 15:04:05"), Some(1_717_254_245));
        assert_eq!(parse_capture_unix("2024-06-01T15:04:05"), Some(1_717_254_245));
        assert_eq!(
            parse_capture_unix("2024-06-01T15:04:05+02:00"),
            Some(1_717_254_245 - 2 * 3600)
        );
        assert!(parse_capture_unix("not a date").is_none());
    }

    #[test]
    fn xmp_date_is_used_when_exif_is_absent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.xmp.jpg");
        std::fs::write(
            &path,
            b"junk exif:DateTimeOriginal=\"2019-04-05T08:09:10\" tail",
        )
        .unwrap();
        assert_eq!(capture_unix(&path), parse_capture_unix("2019-04-05T08:09:10"));
    }

    #[test]
    fn iso_round_trip() {
        let unix = parse_capture_unix("2024:06:01 15:04:05").unwrap();
        assert_eq!(unix_to_iso(unix), "2024-06-01T15:04:05");
    }
}
