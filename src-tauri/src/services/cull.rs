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
            && let Some(stats) = frame_stats(Path::new(path))
        {
            hint = classify(&stats);
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

struct FrameStats {
    mean: f32,
    laplacian: f32,
    peak_laplacian: f32,
    edge_frac: f32,
    blue_bias: f32,
}

fn classify(stats: &FrameStats) -> Option<&'static str> {
    if stats.mean < 12.0 {
        return Some("dark");
    }
    if looks_like_water_or_sky(stats) {
        return None;
    }
    // Shallow DOF, leaves, and 480px JPEGs have low *mean* Laplacian.
    // Only flag mush with no real edges in any tile.
    if stats.peak_laplacian < 9.0 && stats.laplacian < 3.2 && stats.edge_frac < 0.004 {
        Some("blur")
    } else {
        None
    }
}

fn looks_like_water_or_sky(stats: &FrameStats) -> bool {
    stats.blue_bias > 10.0 && stats.mean > 35.0
}

pub fn score_jpeg_file(path: &Path) -> Option<&'static str> {
    classify(&frame_stats(path)?)
}

fn frame_stats(path: &Path) -> Option<FrameStats> {
    let file = File::open(path).ok()?;
    let mut decoder = Decoder::new(BufReader::new(file));
    let pixels = decoder.decode().ok()?;
    let info = decoder.info()?;
    let width = info.width as usize;
    let height = info.height as usize;
    let (gray, blue_bias) = to_gray(&pixels, info.pixel_format, width, height)?;
    let mut stats = score_gray(&gray, width, height);
    stats.blue_bias = blue_bias;
    Some(stats)
}

fn to_gray(pixels: &[u8], format: PixelFormat, width: usize, height: usize) -> Option<(Vec<u8>, f32)> {
    match format {
        PixelFormat::L8 => Some((pixels.to_vec(), 0.0)),
        PixelFormat::RGB24 => {
            let mut gray = Vec::with_capacity(width * height);
            let mut sum_r = 0u64;
            let mut sum_b = 0u64;
            let mut count = 0u64;
            for chunk in pixels.chunks_exact(3) {
                sum_r += chunk[0] as u64;
                sum_b += chunk[2] as u64;
                count += 1;
                gray.push(((chunk[0] as u16 * 30 + chunk[1] as u16 * 59 + chunk[2] as u16 * 11) / 100) as u8);
            }
            let blue_bias = if count == 0 {
                0.0
            } else {
                sum_b as f32 / count as f32 - sum_r as f32 / count as f32
            };
            Some((gray, blue_bias))
        }
        PixelFormat::CMYK32 => None,
        _ => None,
    }
}

fn score_gray(gray: &[u8], width: usize, height: usize) -> FrameStats {
    if gray.is_empty() || width < 3 || height < 3 {
        return FrameStats {
            mean: 0.0,
            laplacian: 0.0,
            peak_laplacian: 0.0,
            edge_frac: 0.0,
            blue_bias: 0.0,
        };
    }
    let mut sum = 0u64;
    for value in gray {
        sum += *value as u64;
    }
    let mean = sum as f32 / gray.len() as f32;
    let mut lap = 0.0f32;
    let mut count = 0u32;
    let mut edges = 0u32;
    let tile = 16;
    let tiles_x = (width + tile - 1) / tile;
    let tiles_y = (height + tile - 1) / tile;
    let mut tile_sum = vec![0.0f32; tiles_x * tiles_y];
    let mut tile_n = vec![0u32; tiles_x * tiles_y];
    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let i = y * width + x;
            let center = gray[i] as i32;
            let value = gray[i - 1] as i32
                + gray[i + 1] as i32
                + gray[i - width] as i32
                + gray[i + width] as i32
                - 4 * center;
            let sq = (value as f32) * (value as f32);
            lap += sq;
            count += 1;
            if value.unsigned_abs() > 28 {
                edges += 1;
            }
            let tx = (x / tile).min(tiles_x - 1);
            let ty = (y / tile).min(tiles_y - 1);
            let t = ty * tiles_x + tx;
            tile_sum[t] += sq;
            tile_n[t] += 1;
        }
    }
    let mut peak = 0.0f32;
    for (sum_sq, n) in tile_sum.iter().zip(tile_n) {
        if n == 0 {
            continue;
        }
        peak = peak.max((sum_sq / n as f32).sqrt());
    }
    FrameStats {
        mean,
        laplacian: if count == 0 { 0.0 } else { (lap / count as f32).sqrt() },
        peak_laplacian: peak,
        edge_frac: if count == 0 { 0.0 } else { edges as f32 / count as f32 },
        blue_bias: 0.0,
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

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageBuffer, Rgb};

    fn save_rgb(path: &std::path::Path, pixel: [u8; 3], w: u32, h: u32) {
        let image = ImageBuffer::from_pixel(w, h, Rgb(pixel));
        DynamicImage::ImageRgb8(image).save(path).unwrap();
    }

    #[test]
    fn black_jpeg_is_dark() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("black.jpg");
        save_rgb(&path, [0, 0, 0], 64, 48);
        assert_eq!(score_jpeg_file(&path), Some("dark"));
    }

    #[test]
    fn smooth_water_is_not_blur() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("water.jpg");
        save_rgb(&path, [28, 96, 168], 96, 64);
        assert_eq!(score_jpeg_file(&path), None);
    }

    #[test]
    fn checkerboard_is_not_blur() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("edges.jpg");
        let mut image = ImageBuffer::from_pixel(64, 48, Rgb([20u8, 20, 20]));
        for y in 0..48 {
            for x in 0..64 {
                if (x / 4 + y / 4) % 2 == 0 {
                    image.put_pixel(x, y, Rgb([220, 210, 200]));
                }
            }
        }
        DynamicImage::ImageRgb8(image).save(&path).unwrap();
        assert_eq!(score_jpeg_file(&path), None);
    }

    #[test]
    fn mushy_gray_is_blur() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mush.jpg");
        save_rgb(&path, [90, 90, 88], 64, 48);
        assert_eq!(score_jpeg_file(&path), Some("blur"));
    }

    #[test]
    fn sharp_branch_on_smooth_sky_is_not_blur() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("leaves.jpg");
        let mut image = ImageBuffer::from_pixel(320, 240, Rgb([196u8, 154, 110]));
        for y in 30..210 {
            let x = 70 + y / 2;
            for dx in 0..6u32 {
                if x + dx < 320 {
                    image.put_pixel(x + dx, y, Rgb([42, 34, 24]));
                }
            }
        }
        DynamicImage::ImageRgb8(image).save(&path).unwrap();
        assert_eq!(score_jpeg_file(&path), None);
    }
}
