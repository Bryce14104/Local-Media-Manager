//! Read a small set of EXIF fields from JPEG and TIFF files.
//!
//! Files without an EXIF block, including most PNG, HEIC, and video files,
//! return `Ok(None)` so a scan can still index them.

use crate::models::ExifSnapshot;
use exif::{Field, In, Reader, Tag, Value};
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ExifError {
    #[error("cannot read {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("could not parse EXIF: {0}")]
    Parse(String),
}

/// Parse EXIF from `path`.
///
/// `Ok(None)` means the file has no EXIF container. `Ok(Some(_))` means a
/// container was read, even when the camera fields Shelf cares about are blank.
pub fn read_exif(path: &Path) -> Result<Option<ExifSnapshot>, ExifError> {
    let mut snapshot = match read_container_file(path) {
        Ok(value) => value,
        Err(error @ ExifError::Io { .. }) => return Err(error),
        Err(ExifError::Parse(_)) => None,
    };
    if gps_missing(&snapshot) {
        if let Some(jpeg) = first_embedded_jpeg(path) {
            if let Some(embedded) = read_container_bytes(&jpeg) {
                snapshot = Some(merge_snapshot(snapshot, embedded));
            }
        }
    }
    if gps_missing(&snapshot) {
        if let Some((latitude, longitude)) = xmp_gps_file(path) {
            let entry = snapshot.get_or_insert_with(ExifSnapshot::default);
            entry.latitude.get_or_insert(latitude);
            entry.longitude.get_or_insert(longitude);
        }
    }
    Ok(snapshot.filter(|item| !item.is_empty()))
}

fn read_container_file(path: &Path) -> Result<Option<ExifSnapshot>, ExifError> {
    let file = File::open(path).map_err(|source| ExifError::Io {
        path: path.display().to_string(),
        source,
    })?;
    let mut reader = BufReader::new(file);
    match Reader::new().read_from_container(&mut reader) {
        Ok(exif) => Ok(Some(snapshot(&exif))),
        Err(exif::Error::InvalidFormat(_)) | Err(exif::Error::NotFound(_)) => Ok(None),
        Err(error) => Err(ExifError::Parse(error.to_string())),
    }
}

fn read_container_bytes(bytes: &[u8]) -> Option<ExifSnapshot> {
    let mut cursor = std::io::Cursor::new(bytes);
    let exif = Reader::new().read_from_container(&mut cursor).ok()?;
    Some(snapshot(&exif))
}

fn gps_missing(snapshot: &Option<ExifSnapshot>) -> bool {
    snapshot
        .as_ref()
        .is_none_or(|item| item.latitude.is_none() || item.longitude.is_none())
}

fn merge_snapshot(base: Option<ExifSnapshot>, extra: ExifSnapshot) -> ExifSnapshot {
    let Some(mut base) = base else {
        return extra;
    };
    if base.latitude.is_none() {
        base.latitude = extra.latitude;
    }
    if base.longitude.is_none() {
        base.longitude = extra.longitude;
    }
    if base.camera_make.is_none() {
        base.camera_make = extra.camera_make;
    }
    if base.camera_model.is_none() {
        base.camera_model = extra.camera_model;
    }
    if base.captured_at.is_none() {
        base.captured_at = extra.captured_at;
    }
    base
}

fn snapshot(exif: &exif::Exif) -> ExifSnapshot {
    let (latitude, longitude) = gps_pair(exif);
    ExifSnapshot {
        camera_make: text_tag(exif, Tag::Make),
        camera_model: text_tag(exif, Tag::Model),
        lens_model: text_tag(exif, Tag::LensModel),
        captured_at: text_tag(exif, Tag::DateTimeOriginal),
        orientation: text_tag(exif, Tag::Orientation),
        width: number_tag(exif, Tag::PixelXDimension),
        height: number_tag(exif, Tag::PixelYDimension),
        iso: text_tag(exif, Tag::PhotographicSensitivity),
        exposure_time: text_tag(exif, Tag::ExposureTime),
        f_number: text_tag(exif, Tag::FNumber),
        focal_length: text_tag(exif, Tag::FocalLength),
        latitude,
        longitude,
    }
}

fn gps_pair(exif: &exif::Exif) -> (Option<i32>, Option<i32>) {
    let latitude = gps_axis(exif, Tag::GPSLatitude, Tag::GPSLatitudeRef, b'S');
    let longitude = gps_axis(exif, Tag::GPSLongitude, Tag::GPSLongitudeRef, b'W');
    (latitude, longitude)
}

fn gps_axis(exif: &exif::Exif, tag: Tag, reference: Tag, negative: u8) -> Option<i32> {
    let field = find_field(exif, tag)?;
    let Value::Rational(values) = &field.value else {
        return None;
    };
    if values.is_empty() {
        return None;
    }
    let degrees = values.first()?.to_f64();
    let minutes = values.get(1).map(|value| value.to_f64()).unwrap_or(0.0);
    let seconds = values.get(2).map(|value| value.to_f64()).unwrap_or(0.0);
    if !degrees.is_finite() || !minutes.is_finite() || !seconds.is_finite() {
        return None;
    }
    let mut decimal = degrees.abs() + minutes / 60.0 + seconds / 3600.0;
    let marker = text_tag(exif, reference)
        .and_then(|text| text.chars().find(|char| char.is_ascii_alphabetic()))
        .map(|char| char.to_ascii_uppercase() as u8);
    if marker == Some(negative) || degrees < 0.0 {
        decimal = -decimal;
    }
    if !(-180.0..=180.0).contains(&decimal) {
        return None;
    }
    Some((decimal * 1_000_000.0).round() as i32)
}

fn first_embedded_jpeg(path: &Path) -> Option<Vec<u8>> {
    let bytes = read_sample(path).ok()?;
    let mut index = 0;
    while index + 1 < bytes.len() {
        if bytes[index] != 0xff || bytes[index + 1] != 0xd8 {
            index += 1;
            continue;
        }
        let mut end = index + 2;
        while end + 1 < bytes.len() {
            if bytes[end] == 0xff && bytes[end + 1] == 0xd9 {
                return Some(bytes[index..end + 2].to_vec());
            }
            end += 1;
        }
        return None;
    }
    None
}

fn xmp_gps_file(path: &Path) -> Option<(i32, i32)> {
    let bytes = read_sample(path).ok()?;
    let latitude = xmp_axis(&bytes, b"GPSLatitude", b'S')?;
    let longitude = xmp_axis(&bytes, b"GPSLongitude", b'W')?;
    Some((latitude, longitude))
}

fn xmp_axis(bytes: &[u8], name: &[u8], negative: u8) -> Option<i32> {
    let key_attr = [b"exif:", name, b"=\""].concat();
    let key_elem = [b"exif:", name, b">"].concat();
    let raw = find_marked(bytes, &key_attr).or_else(|| find_marked(bytes, &key_elem))?;
    parse_axis(&raw, negative)
}

fn find_marked(bytes: &[u8], marker: &[u8]) -> Option<String> {
    let start = bytes.windows(marker.len()).position(|window| window == marker)?;
    let rest = &bytes[start + marker.len()..];
    let end = rest
        .iter()
        .position(|byte| *byte == b'"' || *byte == b'<' || *byte == b'\n')
        .unwrap_or(rest.len().min(64));
    Some(String::from_utf8_lossy(&rest[..end]).trim().to_string())
}

fn parse_axis(raw: &str, negative: u8) -> Option<i32> {
    let text = raw.trim().trim_matches('"');
    let marked = text.bytes().any(|byte| byte.eq_ignore_ascii_case(&negative));
    let signed = text.trim().starts_with('-');
    let mut parts = Vec::new();
    let mut current = String::new();
    for char in text.chars() {
        if char.is_ascii_digit() || char == '.' || char == '-' {
            current.push(char);
        } else if !current.is_empty() {
            parts.push(current);
            current = String::new();
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }
    let numbers: Vec<f64> = parts.iter().filter_map(|part| part.parse().ok()).collect();
    let decimal = match numbers.as_slice() {
        [degrees] => *degrees,
        [degrees, minutes] => degrees.abs() + minutes / 60.0,
        [degrees, minutes, seconds, ..] => degrees.abs() + minutes / 60.0 + seconds / 3600.0,
        _ => return None,
    };
    let mut decimal = decimal.abs();
    if marked || signed {
        decimal = -decimal;
    }
    if !(-180.0..=180.0).contains(&decimal) {
        return None;
    }
    Some((decimal * 1_000_000.0).round() as i32)
}

fn read_sample(path: &Path) -> std::io::Result<Vec<u8>> {
    const EDGE: u64 = 8 * 1024 * 1024;
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
    file.seek(SeekFrom::End(-(EDGE as i64)))?;
    let mut tail = Vec::new();
    file.read_to_end(&mut tail)?;
    head.extend(tail);
    Ok(head)
}

fn find_field(exif: &exif::Exif, tag: Tag) -> Option<&Field> {
    exif.fields()
        .find(|field| field.tag == tag && field.ifd_num == In::PRIMARY)
        .or_else(|| exif.fields().find(|field| field.tag == tag))
}

fn text_tag(exif: &exif::Exif, tag: Tag) -> Option<String> {
    let field = find_field(exif, tag)?;
    let text = field.display_value().to_string();
    let cleaned = text.trim().trim_matches('"').trim().to_string();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

fn number_tag(exif: &exif::Exif, tag: Tag) -> Option<u32> {
    let field = find_field(exif, tag)?;
    match &field.value {
        Value::Short(values) => values.first().copied().map(u32::from),
        Value::Long(values) => values.first().copied(),
        Value::Byte(values) => values.first().copied().map(u32::from),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_and_jpeg_without_exif_return_none() {
        let dir = tempfile::tempdir().unwrap();
        let text = dir.path().join("notes.txt");
        std::fs::write(&text, b"not an image").unwrap();
        assert!(read_exif(&text).unwrap().is_none());

        let jpeg = dir.path().join("plain.jpg");
        std::fs::write(&jpeg, decode_hex(MINIMAL_JPEG)).unwrap();
        assert!(read_exif(&jpeg).unwrap().is_none());
    }

    #[test]
    fn reads_make_from_a_tiny_exif_jpeg() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("camera.jpg");
        std::fs::write(&path, exif_jpeg_with_make()).unwrap();

        let snapshot = read_exif(&path).unwrap().expect("exif present");
        assert_eq!(snapshot.camera_make.as_deref(), Some("Canon"));
        assert!(snapshot.latitude.is_none());
    }

    #[test]
    fn reads_gps_from_jpeg_tiff_and_raw_container() {
        let tiff = brisbane_gps_tiff();
        let jpeg = jpeg_app1(&tiff);
        let dir = tempfile::tempdir().unwrap();
        let jpeg_path = dir.path().join("brisbane.jpg");
        let raw_path = dir.path().join("brisbane.ARW");
        std::fs::write(&jpeg_path, &jpeg).unwrap();
        std::fs::write(&raw_path, &jpeg).unwrap();

        for path in [&jpeg_path, &raw_path] {
            let snapshot = read_exif(path).unwrap().expect("gps");
            assert_eq!(snapshot.latitude, Some(-27_480_000), "{}", path.display());
            assert_eq!(snapshot.longitude, Some(153_025_000));
        }
    }

    #[test]
    fn reads_gps_from_xmp_when_exif_container_is_absent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.CR2");
        std::fs::write(
            &path,
            b"header exif:GPSLatitude=\"10,30.0S\" exif:GPSLongitude=\"20,15.0W\" tail",
        )
        .unwrap();
        let snapshot = read_exif(&path).unwrap().expect("xmp gps");
        assert_eq!(snapshot.latitude, Some(-10_500_000));
        assert_eq!(snapshot.longitude, Some(-20_250_000));
    }

    fn brisbane_gps_tiff() -> Vec<u8> {
        fn push_u16(buf: &mut Vec<u8>, value: u16) {
            buf.extend_from_slice(&value.to_le_bytes());
        }
        fn push_u32(buf: &mut Vec<u8>, value: u32) {
            buf.extend_from_slice(&value.to_le_bytes());
        }
        let mut buf = Vec::new();
        buf.extend_from_slice(&[0x49, 0x49, 0x2a, 0x00]);
        push_u32(&mut buf, 8);
        push_u16(&mut buf, 1);
        push_u16(&mut buf, 0x8825);
        push_u16(&mut buf, 4);
        push_u32(&mut buf, 1);
        push_u32(&mut buf, 26);
        push_u32(&mut buf, 0);
        assert_eq!(buf.len(), 26);

        push_u16(&mut buf, 4);
        push_u16(&mut buf, 1);
        push_u16(&mut buf, 2);
        push_u32(&mut buf, 2);
        buf.extend_from_slice(b"S\0\0\0");
        push_u16(&mut buf, 2);
        push_u16(&mut buf, 5);
        push_u32(&mut buf, 3);
        let latitude_at = buf.len();
        push_u32(&mut buf, 0);
        push_u16(&mut buf, 3);
        push_u16(&mut buf, 2);
        push_u32(&mut buf, 2);
        buf.extend_from_slice(b"E\0\0\0");
        push_u16(&mut buf, 4);
        push_u16(&mut buf, 5);
        push_u32(&mut buf, 3);
        let longitude_at = buf.len();
        push_u32(&mut buf, 0);
        push_u32(&mut buf, 0);

        let latitude_offset = buf.len() as u32;
        for (numerator, denominator) in [(27u32, 1u32), (28, 1), (48, 1)] {
            push_u32(&mut buf, numerator);
            push_u32(&mut buf, denominator);
        }
        let longitude_offset = buf.len() as u32;
        for (numerator, denominator) in [(153u32, 1u32), (1, 1), (30, 1)] {
            push_u32(&mut buf, numerator);
            push_u32(&mut buf, denominator);
        }
        buf[latitude_at..latitude_at + 4].copy_from_slice(&latitude_offset.to_le_bytes());
        buf[longitude_at..longitude_at + 4].copy_from_slice(&longitude_offset.to_le_bytes());
        buf
    }

    fn jpeg_app1(tiff: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0xff, 0xd8, 0xff, 0xe1];
        let length = (2 + 6 + tiff.len()) as u16;
        bytes.extend_from_slice(&length.to_be_bytes());
        bytes.extend_from_slice(b"Exif\0\0");
        bytes.extend_from_slice(tiff);
        bytes.extend_from_slice(&[0xff, 0xd9]);
        bytes
    }

    fn exif_jpeg_with_make() -> Vec<u8> {
        // Little-endian TIFF with one ASCII Make entry, "Canon".
        let tiff = [
            0x49, 0x49, // II
            0x2a, 0x00, // 42
            0x08, 0x00, 0x00, 0x00, // IFD at offset 8
            0x01, 0x00, // one entry
            0x0f, 0x01, // Make, 0x010F
            0x02, 0x00, // ASCII
            0x06, 0x00, 0x00, 0x00, // count, including the trailing NUL
            0x1a, 0x00, 0x00, 0x00, // value offset 26
            0x00, 0x00, 0x00, 0x00, // no next IFD
            b'C', b'a', b'n', b'o', b'n', 0x00,
        ];
        assert_eq!(tiff.len(), 32);

        let mut bytes = Vec::with_capacity(2 + 2 + 2 + 6 + tiff.len() + 2);
        bytes.extend_from_slice(&[0xff, 0xd8]); // SOI
        bytes.extend_from_slice(&[0xff, 0xe1]); // APP1
        let length = 2 + 6 + tiff.len();
        bytes.extend_from_slice(&(length as u16).to_be_bytes());
        bytes.extend_from_slice(b"Exif\0\0");
        bytes.extend_from_slice(&tiff);
        bytes.extend_from_slice(&[0xff, 0xd9]); // EOI
        bytes
    }

    fn decode_hex(input: &str) -> Vec<u8> {
        (0..input.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&input[index..index + 2], 16).unwrap())
            .collect()
    }

    /// 1x1 JPEG with a JFIF header and no EXIF segment.
    const MINIMAL_JPEG: &str = "\
ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda000c03010002110311003f00f7fa28a2803fffd9";
}
