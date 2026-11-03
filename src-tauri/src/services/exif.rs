//! Read a small set of EXIF fields from JPEG and TIFF files.
//!
//! Files without an EXIF block, including most PNG, HEIC, and video files,
//! return `Ok(None)` so a scan can still index them.

use crate::models::ExifSnapshot;
use exif::{Field, In, Reader, Tag, Value};
use std::fs::File;
use std::io::BufReader;
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

fn snapshot(exif: &exif::Exif) -> ExifSnapshot {
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
    }
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
