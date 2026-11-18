//! Cheap cull hints from 480px previews. Never deletes.

use crate::db::Library;
use crate::models::MediaKind;
use jpeg_decoder::{Decoder, PixelFormat};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

/// Score existing thumbnails. `blur` | `dark` | `dupe`.
pub fn score_library(library: &Library) -> usize {
    let Ok(media) = library.list_media() else {
        return 0;
    };
    let embeddings = library.visual_embeddings().unwrap_or_default();
    let mut by_id: std::collections::HashMap<i64, Vec<f32>> = embeddings
        .into_iter()
        .map(|(id, _, vec)| (id, vec))
        .collect();
    let mut scored = 0;
    let mut previous: Option<(Vec<f32>, i64)> = None;
    let mut ordered = media;
    ordered.sort_by_key(|row| row.captured_at.unwrap_or(row.modified_at));
    for record in ordered {
        if record.media_kind == MediaKind::Video {
            continue;
        }
        let mut hint: Option<&str> = None;
        if let Some(path) = record.thumbnail_path.as_deref()
            && Path::new(path).is_file()
            && let Some(stats) = luma_stats(Path::new(path))
        {
            if stats.mean < 18.0 {
                hint = Some("dark");
            } else if stats.laplacian < 12.0 {
                hint = Some("blur");
            }
        }
        if hint.is_none()
            && let Some(embed) = by_id.remove(&record.id)
        {
            if let Some((prev_embed, prev_time)) = &previous {
                let gap = (record.captured_at.unwrap_or(record.modified_at) - prev_time).abs();
                if gap <= 8 && cosine(&embed, prev_embed) > 0.94 {
                    hint = Some("dupe");
                }
            }
            previous = Some((embed, record.captured_at.unwrap_or(record.modified_at)));
        }
        if let Some(value) = hint {
            let _ = library.set_cull_hint(record.id, Some(value));
            scored += 1;
        } else {
            let _ = library.set_cull_hint(record.id, None);
        }
    }
    scored
}

struct LumaStats {
    mean: f32,
    laplacian: f32,
}

fn luma_stats(path: &Path) -> Option<LumaStats> {
    let file = File::open(path).ok()?;
    let mut decoder = Decoder::new(BufReader::new(file));
    let pixels = decoder.decode().ok()?;
    let info = decoder.info()?;
    let gray = to_gray(&pixels, info.pixel_format, info.width as usize, info.height as usize)?;
    Some(score_gray(&gray, info.width as usize, info.height as usize))
}

fn to_gray(pixels: &[u8], format: PixelFormat, width: usize, height: usize) -> Option<Vec<u8>> {
    match format {
        PixelFormat::L8 => Some(pixels.to_vec()),
        PixelFormat::RGB24 => {
            let mut gray = Vec::with_capacity(width * height);
            for chunk in pixels.chunks_exact(3) {
                gray.push(((chunk[0] as u16 * 30 + chunk[1] as u16 * 59 + chunk[2] as u16 * 11) / 100) as u8);
            }
            Some(gray)
        }
        PixelFormat::CMYK32 => None,
        _ => None,
    }
}

fn score_gray(gray: &[u8], width: usize, height: usize) -> LumaStats {
    if gray.is_empty() || width < 3 || height < 3 {
        return LumaStats {
            mean: 0.0,
            laplacian: 0.0,
        };
    }
    let mut sum = 0u64;
    for value in gray {
        sum += *value as u64;
    }
    let mean = sum as f32 / gray.len() as f32;
    let mut lap = 0.0f32;
    let mut count = 0u32;
    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let i = y * width + x;
            let center = gray[i] as i32;
            let value = gray[i - 1] as i32
                + gray[i + 1] as i32
                + gray[i - width] as i32
                + gray[i + width] as i32
                - 4 * center;
            lap += (value as f32) * (value as f32);
            count += 1;
        }
    }
    LumaStats {
        mean,
        laplacian: if count == 0 { 0.0 } else { lap / count as f32 }.sqrt(),
    }
}

fn cosine(left: &[f32], right: &[f32]) -> f32 {
    if left.len() != right.len() || left.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0;
    let mut a = 0.0;
    let mut b = 0.0;
    for (x, y) in left.iter().zip(right) {
        dot += x * y;
        a += x * x;
        b += y * y;
    }
    if a == 0.0 || b == 0.0 {
        0.0
    } else {
        dot / (a.sqrt() * b.sqrt())
    }
}

pub fn score_jpeg_file(path: &Path) -> Option<&'static str> {
    let stats = luma_stats(path)?;
    if stats.mean < 18.0 {
        Some("dark")
    } else if stats.laplacian < 12.0 {
        Some("blur")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageBuffer, Rgb};

    #[test]
    fn black_jpeg_is_dark() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("black.jpg");
        let image = ImageBuffer::from_pixel(64, 48, Rgb([0u8, 0, 0]));
        let dyn_img = DynamicImage::ImageRgb8(image);
        dyn_img.save(&path).unwrap();
        assert_eq!(score_jpeg_file(&path), Some("dark"));
    }
}
