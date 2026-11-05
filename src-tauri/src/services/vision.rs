//! Local face and subject recognition.
//!
//! YuNet finds faces, SFace turns each aligned crop into a 128-d identity
//! vector, and MobileNetV2 tags pets, wildlife, and other ImageNet subjects.
//! Sunset comes from the color of the sky. Drone comes from the camera name.
//! Nothing leaves the machine.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use image::imageops::FilterType;
use image::{Rgb, RgbImage};
use ndarray::Array4;
use ort::session::Session;
use ort::value::Tensor;
use thiserror::Error;

use crate::db::{Library, VisionTarget};
use crate::models::ExifSnapshot;

const INPUT: u32 = 640;
const FACE_SCORE: f32 = 0.6;
const FACE_NMS: f32 = 0.3;
/// Cosine similarity used by OpenCV's SFace matcher for the same person.
pub const SAME_PERSON: f32 = 0.36;
const STRIDES: [u32; 3] = [8, 16, 32];
const RIGHT_EYE: (f32, f32) = (38.2946, 51.6963);
const LEFT_EYE: (f32, f32) = (73.5318, 51.5014);
const IMAGENET_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const IMAGENET_STD: [f32; 3] = [0.229, 0.224, 0.225];

#[derive(Debug, Error)]
pub enum VisionError {
    #[error("missing vision model at {0}")]
    MissingModel(String),
    #[error(transparent)]
    Ort(#[from] ort::Error),
}

#[derive(Clone, Debug)]
struct DetectedFace {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    score: f32,
    landmarks: [(f32, f32); 5],
}

#[derive(Clone, Debug)]
struct Tag {
    kind: &'static str,
    label: String,
    score: f32,
}

struct Heads<'a> {
    cls: [&'a [f32]; 3],
    obj: [&'a [f32]; 3],
    bbox: [&'a [f32]; 3],
    kps: [&'a [f32]; 3],
}

struct Engine {
    yunet: Session,
    sface: Session,
    mobilenet: Session,
}

pub fn recognize_library<F>(library: &Library, mut progress: F) -> Result<(), VisionError>
where
    F: FnMut(usize, usize, &str),
{
    let pending = match library.pending_vision() {
        Ok(rows) => rows,
        Err(error) => {
            eprintln!("shelf index: could not read the vision queue: {error}");
            return Ok(());
        }
    };
    if pending.is_empty() {
        eprintln!("shelf index: no frames waiting for visual tags");
        return Ok(());
    }
    eprintln!("shelf index: {} frames waiting for visual tags", pending.len());
    progress(0, pending.len(), "Loading vision models");
    let threads = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(2)
        .clamp(1, 8);
    let mut engine = match Engine::load(threads) {
        Ok(engine) => {
            eprintln!("shelf index: visual model ready on cpu ({threads} threads)");
            Some(engine)
        }
        Err(error) => {
            eprintln!("shelf index: visual model unavailable ({error}); tagging from pixel colors");
            None
        }
    };
    for (index, target) in pending.iter().enumerate() {
        progress(index, pending.len(), "Reading faces and subjects");
        match analyze_frame(&mut engine, library, target) {
            Ok(labels) => {
                if labels.is_empty() {
                    eprintln!("shelf index: analyzed {} (no visual tags)", target.file_path);
                } else {
                    let names = labels
                        .iter()
                        .map(|(_, label, _)| label.as_str())
                        .collect::<Vec<_>>()
                        .join(", ");
                    eprintln!("shelf index: analyzed {} -> {names}", target.file_path);
                }
            }
            Err(error) => eprintln!("shelf index: {} failed: {error}", target.file_path),
        }
        if let Err(error) = library.mark_vision(target.id) {
            eprintln!("shelf index: could not record vision for {}: {error}", target.file_path);
        }
    }
    progress(pending.len(), pending.len(), "Reading faces and subjects");
    Ok(())
}

fn analyze_frame(
    engine: &mut Option<Engine>,
    library: &Library,
    target: &VisionTarget,
) -> Result<Vec<(String, String, f32)>, VisionError> {
    let Some(image) = load_pixels(target) else {
        eprintln!("shelf index: no decodable pixels in {}", target.file_path);
        return Ok(Vec::new());
    };
    eprintln!(
        "shelf index: analyzing pixels ({}) {}",
        target.media_kind, target.file_path
    );
    let _ = library.clear_file_vision(target.id);
    let resized = image::imageops::resize(&image, INPUT, INPUT, FilterType::Triangle);
    if let Some(engine) = engine.as_mut() {
        if let Err(error) = read_faces(engine, library, target, &resized) {
            eprintln!("shelf index: faces failed for {}: {error}", target.file_path);
        }
    }

    let mut tags = scene_tags(&resized);
    if let Some(engine) = engine.as_mut() {
        match engine.subjects(&resized) {
            Ok(found) => tags.extend(found),
            Err(error) => eprintln!("shelf index: classifier failed for {}: {error}", target.file_path),
        }
    }
    if drone_camera(&camera_text(target)) {
        tags.push(Tag {
            kind: "scene",
            label: "drone".into(),
            score: 1.0,
        });
    }
    let labels: Vec<(String, String, f32)> = dedupe_tags(tags)
        .into_iter()
        .map(|tag| (tag.kind.to_string(), tag.label, tag.score))
        .collect();
    library.replace_labels(target.id, &labels).map_err(|error| {
        eprintln!("shelf index: could not store tags for {}: {error}", target.file_path);
        VisionError::MissingModel(error.to_string())
    })?;
    Ok(labels)
}

fn read_faces(
    engine: &mut Engine,
    library: &Library,
    target: &VisionTarget,
    image: &RgbImage,
) -> Result<(), VisionError> {
    let faces = engine.detect(image)?;
    let mut known = library.face_embeddings().unwrap_or_default();
    for face in faces {
        let aligned = align_or_crop(image, &face);
        let mut embedding = engine.embed(&aligned)?;
        l2_normalize(&mut embedding);
        let person_id = match nearest(&embedding, &known) {
            Some((person_id, score)) if score >= SAME_PERSON => person_id,
            _ => library.create_person(None).unwrap_or(0),
        };
        if person_id == 0 {
            continue;
        }
        let _ = library.insert_face(
            target.id,
            person_id,
            (face.x / INPUT as f32).clamp(0.0, 1.0),
            (face.y / INPUT as f32).clamp(0.0, 1.0),
            (face.width / INPUT as f32).clamp(0.0, 1.0),
            (face.height / INPUT as f32).clamp(0.0, 1.0),
            face.score,
            &embedding,
        );
        known.push((person_id, embedding));
    }
    Ok(())
}

fn load_pixels(target: &VisionTarget) -> Option<RgbImage> {
    if let Some(thumb) = target.thumbnail_path.as_deref()
        && let Ok(image) = image::open(thumb)
    {
        return Some(image.to_rgb8());
    }
    let path = Path::new(&target.file_path);
    if !path.is_file() {
        return None;
    }
    super::thumbs::decode_preview(path)
        .ok()
        .map(|image| image.to_rgb8())
}

fn camera_text(target: &VisionTarget) -> String {
    let Some(json) = target.exif_json.as_deref() else {
        return String::new();
    };
    let Ok(exif) = serde_json::from_str::<ExifSnapshot>(json) else {
        return String::new();
    };
    format!(
        "{} {}",
        exif.camera_make.unwrap_or_default(),
        exif.camera_model.unwrap_or_default()
    )
}

impl Engine {
    fn load(threads: usize) -> Result<Self, VisionError> {
        let environment = environment()?;
        Ok(Self {
            yunet: session(environment, "yunet.onnx", threads)?,
            sface: session(environment, "sface.onnx", threads)?,
            mobilenet: session(environment, "mobilenet.onnx", threads)?,
        })
    }

    fn detect(&mut self, image: &RgbImage) -> Result<Vec<DetectedFace>, VisionError> {
        let tensor = Tensor::from_array(nchw(image, true, |value, _channel| value))?;
        let outputs = self.yunet.run(ort::inputs!["input" => tensor])?;
        let names = [
            "cls_8", "cls_16", "cls_32", "obj_8", "obj_16", "obj_32", "bbox_8", "bbox_16", "bbox_32", "kps_8",
            "kps_16", "kps_32",
        ];
        let mut planes = Vec::with_capacity(names.len());
        for name in names {
            let (_shape, data) = outputs[name].try_extract_tensor::<f32>()?;
            planes.push(data.to_vec());
        }
        let heads = Heads {
            cls: [&planes[0], &planes[1], &planes[2]],
            obj: [&planes[3], &planes[4], &planes[5]],
            bbox: [&planes[6], &planes[7], &planes[8]],
            kps: [&planes[9], &planes[10], &planes[11]],
        };
        Ok(decode_yunet(&heads, FACE_SCORE, FACE_NMS))
    }

    fn embed(&mut self, face: &RgbImage) -> Result<Vec<f32>, VisionError> {
        let tensor = Tensor::from_array(nchw(face, false, |value, _channel| value))?;
        let outputs = self.sface.run(ort::inputs!["data" => tensor])?;
        let (_shape, data) = outputs["fc1"].try_extract_tensor::<f32>()?;
        Ok(data.to_vec())
    }

    fn subjects(&mut self, image: &RgbImage) -> Result<Vec<Tag>, VisionError> {
        let sized = image::imageops::resize(image, 224, 224, FilterType::Triangle);
        let tensor = Tensor::from_array(nchw(&sized, false, |value, channel| {
            (value / 255.0 - IMAGENET_MEAN[channel]) / IMAGENET_STD[channel]
        }))?;
        let outputs = self.mobilenet.run(ort::inputs!["input" => tensor])?;
        let (_shape, data) = outputs["output"].try_extract_tensor::<f32>()?;
        Ok(tags_from_logits(data))
    }
}

fn environment() -> Result<&'static ort::environment::Environment, VisionError> {
    static ENV: OnceLock<ort::environment::Environment> = OnceLock::new();
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    if let Some(existing) = ENV.get() {
        return Ok(existing);
    }
    let _guard = LOCK.lock().unwrap_or_else(|err| err.into_inner());
    if let Some(existing) = ENV.get() {
        return Ok(existing);
    }
    let built = ort::init().with_name("shelf").build()?;
    let _ = ENV.set(built);
    Ok(ENV.get().expect("vision environment"))
}

fn session(
    environment: &ort::environment::Environment,
    file_name: &str,
    threads: usize,
) -> Result<Session, VisionError> {
    let path = model_path(file_name);
    if !path.is_file() {
        return Err(VisionError::MissingModel(path.display().to_string()));
    }
    Ok(Session::builder(environment)?
        .with_intra_threads(threads)
        .map_err(ort::Error::from)?
        .commit_from_file(path)?)
}

fn model_path(file_name: &str) -> PathBuf {
    let mut candidates = Vec::new();
    if let Ok(dir) = std::env::var("SHELF_MODELS") {
        candidates.push(PathBuf::from(dir).join(file_name));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models").join(file_name));
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for relative in ["models", "resources/models", "../Resources/models", "../resources/models"] {
                candidates.push(dir.join(relative).join(file_name));
            }
        }
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models").join(file_name))
}

fn nchw(image: &RgbImage, bgr: bool, map: impl Fn(f32, usize) -> f32) -> Array4<f32> {
    let width = image.width() as usize;
    let height = image.height() as usize;
    let mut tensor = Array4::<f32>::zeros((1, 3, height, width));
    for y in 0..height {
        for x in 0..width {
            let pixel = image.get_pixel(x as u32, y as u32);
            let channels = if bgr {
                [pixel[2], pixel[1], pixel[0]]
            } else {
                [pixel[0], pixel[1], pixel[2]]
            };
            for (channel, value) in channels.into_iter().enumerate() {
                tensor[[0, channel, y, x]] = map(value as f32, channel);
            }
        }
    }
    tensor
}

fn decode_yunet(heads: &Heads<'_>, score_threshold: f32, nms_threshold: f32) -> Vec<DetectedFace> {
    let mut faces = Vec::new();
    for (level, stride) in STRIDES.iter().copied().enumerate() {
        let cols = INPUT / stride;
        let rows = INPUT / stride;
        let cls = heads.cls[level];
        let obj = heads.obj[level];
        let bbox = heads.bbox[level];
        let kps = heads.kps[level];
        for row in 0..rows {
            for col in 0..cols {
                let index = (row * cols + col) as usize;
                let class = cls.get(index).copied().unwrap_or(0.0).clamp(0.0, 1.0);
                let objectness = obj.get(index).copied().unwrap_or(0.0).clamp(0.0, 1.0);
                let score = (class * objectness).sqrt();
                if score < score_threshold {
                    continue;
                }
                let base = index * 4;
                if bbox.len() < base + 4 || kps.len() < index * 10 + 10 {
                    continue;
                }
                let center_x = (col as f32 + bbox[base]) * stride as f32;
                let center_y = (row as f32 + bbox[base + 1]) * stride as f32;
                let width = bbox[base + 2].exp() * stride as f32;
                let height = bbox[base + 3].exp() * stride as f32;
                let mut landmarks = [(0.0, 0.0); 5];
                for point in 0..5 {
                    landmarks[point] = (
                        (kps[index * 10 + point * 2] + col as f32) * stride as f32,
                        (kps[index * 10 + point * 2 + 1] + row as f32) * stride as f32,
                    );
                }
                faces.push(DetectedFace {
                    x: center_x - width / 2.0,
                    y: center_y - height / 2.0,
                    width,
                    height,
                    score,
                    landmarks,
                });
            }
        }
    }
    nms(&mut faces, nms_threshold);
    faces
}

fn nms(faces: &mut Vec<DetectedFace>, threshold: f32) {
    faces.sort_by(|left, right| right.score.partial_cmp(&left.score).unwrap_or(std::cmp::Ordering::Equal));
    let mut kept = Vec::new();
    for face in faces.drain(..) {
        if kept.iter().any(|other: &DetectedFace| iou(&face, other) > threshold) {
            continue;
        }
        kept.push(face);
        if kept.len() == 8 {
            break;
        }
    }
    *faces = kept;
}

fn iou(left: &DetectedFace, right: &DetectedFace) -> f32 {
    let x1 = left.x.max(right.x);
    let y1 = left.y.max(right.y);
    let x2 = (left.x + left.width).min(right.x + right.width);
    let y2 = (left.y + left.height).min(right.y + right.height);
    let inter = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
    let union = left.width * left.height + right.width * right.height - inter;
    if union <= 0.0 { 0.0 } else { inter / union }
}

fn align_or_crop(image: &RgbImage, face: &DetectedFace) -> RgbImage {
    let right = face.landmarks[0];
    let left = face.landmarks[1];
    let src_dx = left.0 - right.0;
    let src_dy = left.1 - right.1;
    let src_len = (src_dx * src_dx + src_dy * src_dy).sqrt();
    if src_len < 4.0 {
        return crop_resize(image, face.x, face.y, face.width, face.height);
    }
    let dst_dx = LEFT_EYE.0 - RIGHT_EYE.0;
    let dst_dy = LEFT_EYE.1 - RIGHT_EYE.1;
    let dst_len = (dst_dx * dst_dx + dst_dy * dst_dy).sqrt();
    let scale = src_len / dst_len;
    let angle = src_dy.atan2(src_dx) - dst_dy.atan2(dst_dx);
    let (sin, cos) = angle.sin_cos();
    let mut aligned = RgbImage::new(112, 112);
    for y in 0..112 {
        for x in 0..112 {
            let dx = (x as f32 - RIGHT_EYE.0) * scale;
            let dy = (y as f32 - RIGHT_EYE.1) * scale;
            let sample_x = right.0 + dx * cos - dy * sin;
            let sample_y = right.1 + dx * sin + dy * cos;
            aligned.put_pixel(x, y, Rgb(sample_rgb(image, sample_x, sample_y)));
        }
    }
    aligned
}

fn crop_resize(image: &RgbImage, x: f32, y: f32, width: f32, height: f32) -> RgbImage {
    let x0 = (x - width * 0.15).clamp(0.0, image.width().saturating_sub(1) as f32);
    let y0 = (y - height * 0.15).clamp(0.0, image.height().saturating_sub(1) as f32);
    let x1 = (x + width * 1.15).clamp(x0 + 1.0, image.width() as f32);
    let y1 = (y + height * 1.15).clamp(y0 + 1.0, image.height() as f32);
    let crop = image::imageops::crop_imm(
        image,
        x0 as u32,
        y0 as u32,
        (x1 - x0) as u32,
        (y1 - y0) as u32,
    )
    .to_image();
    image::imageops::resize(&crop, 112, 112, FilterType::Triangle)
}

fn sample_rgb(image: &RgbImage, x: f32, y: f32) -> [u8; 3] {
    if x < 0.0 || y < 0.0 || x >= image.width() as f32 - 1.0 || y >= image.height() as f32 - 1.0 {
        return [0, 0, 0];
    }
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let tx = x - x0 as f32;
    let ty = y - y0 as f32;
    let p00 = image.get_pixel(x0, y0);
    let p10 = image.get_pixel(x0 + 1, y0);
    let p01 = image.get_pixel(x0, y0 + 1);
    let p11 = image.get_pixel(x0 + 1, y0 + 1);
    let mut out = [0; 3];
    for channel in 0..3 {
        let value = p00[channel] as f32 * (1.0 - tx) * (1.0 - ty)
            + p10[channel] as f32 * tx * (1.0 - ty)
            + p01[channel] as f32 * (1.0 - tx) * ty
            + p11[channel] as f32 * tx * ty;
        out[channel] = value.round().clamp(0.0, 255.0) as u8;
    }
    out
}

pub fn l2_normalize(values: &mut [f32]) {
    let norm = values.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 {
        for value in values {
            *value /= norm;
        }
    }
}

pub fn cosine(left: &[f32], right: &[f32]) -> f32 {
    let mut dot = 0.0;
    let mut left_norm = 0.0;
    let mut right_norm = 0.0;
    for (a, b) in left.iter().zip(right) {
        dot += a * b;
        left_norm += a * a;
        right_norm += b * b;
    }
    let denom = left_norm.sqrt() * right_norm.sqrt();
    if denom == 0.0 { 0.0 } else { dot / denom }
}

fn nearest(embedding: &[f32], known: &[(i64, Vec<f32>)]) -> Option<(i64, f32)> {
    known
        .iter()
        .map(|(person_id, other)| (*person_id, cosine(embedding, other)))
        .max_by(|left, right| left.1.partial_cmp(&right.1).unwrap_or(std::cmp::Ordering::Equal))
}

fn scene_tags(image: &RgbImage) -> Vec<Tag> {
    let width = image.width();
    let height = image.height();
    if width == 0 || height == 0 {
        return Vec::new();
    }
    let sample = if width > 160 {
        image::imageops::resize(
            image,
            160,
            (height * 160 / width).max(1),
            FilterType::Nearest,
        )
    } else {
        image.clone()
    };
    let sample_width = sample.width();
    let sample_height = sample.height();
    let mut sky_blue = 0.0;
    let mut sky_count = 0.0;
    let mut sand = 0.0;
    let mut ground_count = 0.0;
    let mut water = 0.0;
    let mut total = 0.0;
    let sky_end = ((sample_height as f32) * 0.45).max(1.0) as u32;
    let ground_start = ((sample_height as f32) * 0.62).min(sample_height.saturating_sub(1) as f32) as u32;
    let tower_bottom = ((sample_height as f32) * 0.78) as u32;
    let mut columns = vec![0.0f32; sample_width as usize];
    let mut column_count = vec![0.0f32; sample_width as usize];

    for y in 0..sample_height {
        for x in 0..sample_width {
            let pixel = sample.get_pixel(x, y);
            let red = pixel[0] as f32;
            let green = pixel[1] as f32;
            let blue = pixel[2] as f32;
            total += 1.0;
            let blueish = blue > 80.0 && blue > red * 1.12 && blue >= green * 0.95;
            let sandy = red > 140.0 && green > 105.0 && blue < 180.0 && red > blue * 1.15 && (red - blue) > 25.0;
            if blueish {
                water += 1.0;
            }
            if y < sky_end {
                sky_count += 1.0;
                if blueish {
                    sky_blue += 1.0;
                }
            }
            if y >= ground_start {
                ground_count += 1.0;
                if sandy {
                    sand += 1.0;
                }
            }
            if y < tower_bottom {
                columns[x as usize] += (red + green + blue) / 3.0;
                column_count[x as usize] += 1.0;
            }
        }
    }

    let mut tags = Vec::new();
    if let Some(score) = sunset_score(image) {
        tags.push(Tag {
            kind: "scene",
            label: "sunset".into(),
            score,
        });
    }
    let water_ratio: f32 = if total > 0.0 { water / total } else { 0.0 };
    if water_ratio > 0.18 {
        tags.push(Tag {
            kind: "scene",
            label: "water".into(),
            score: water_ratio.min(1.0),
        });
    }
    let sand_ratio: f32 = if ground_count > 0.0 { sand / ground_count } else { 0.0 };
    let sky_ratio: f32 = if sky_count > 0.0 { sky_blue / sky_count } else { 0.0 };
    if sand_ratio > 0.45 && (sky_ratio > 0.35 || water_ratio > 0.12) {
        let score = ((sand_ratio + sky_ratio) / 2.0).clamp(0.0, 1.0);
        tags.push(Tag {
            kind: "scene",
            label: "beach".into(),
            score,
        });
        if !tags.iter().any(|tag| tag.label == "water") {
            tags.push(Tag {
                kind: "scene",
                label: "water".into(),
                score: score * 0.8,
            });
        }
    }
    if let Some(score) = lighthouse_score(&columns, &column_count) {
        tags.push(Tag {
            kind: "object",
            label: "lighthouse".into(),
            score,
        });
    }
    tags
}

fn lighthouse_score(columns: &[f32], counts: &[f32]) -> Option<f32> {
    if columns.is_empty() {
        return None;
    }
    let means: Vec<f32> = columns
        .iter()
        .zip(counts)
        .map(|(sum, count)| if *count > 0.0 { sum / count } else { 0.0 })
        .collect();
    let average = means.iter().copied().sum::<f32>() / means.len() as f32;
    let mut run_start: Option<usize> = None;
    let mut best: Option<(usize, usize, f32)> = None;
    for (index, value) in means.iter().copied().enumerate() {
        let tower = value >= 170.0 && value >= average + 35.0;
        if tower {
            if run_start.is_none() {
                run_start = Some(index);
            }
        } else if let Some(start) = run_start.take() {
            note_run(&mut best, start, index, &means);
        }
    }
    if let Some(start) = run_start {
        note_run(&mut best, start, means.len(), &means);
    }
    let (start, end, mean) = best?;
    let width = end.saturating_sub(start);
    let min_width = ((means.len() as f32) * 0.02).max(2.0) as usize;
    let max_width = ((means.len() as f32) * 0.16).max(min_width as f32) as usize;
    if width < min_width || width > max_width {
        return None;
    }
    Some(((mean - average) / 255.0).clamp(0.35, 0.95))
}

fn note_run(best: &mut Option<(usize, usize, f32)>, start: usize, end: usize, means: &[f32]) {
    if end <= start {
        return;
    }
    let mean = means[start..end].iter().copied().sum::<f32>() / (end - start) as f32;
    let replace = best.is_none_or(|(_, _, current)| mean > current);
    if replace {
        *best = Some((start, end, mean));
    }
}

pub fn sunset_score(image: &RgbImage) -> Option<f32> {
    let height = (image.height() as f32 * 0.4).max(1.0) as u32;
    let mut red = 0.0;
    let mut green = 0.0;
    let mut blue = 0.0;
    let mut count = 0.0;
    for y in 0..height {
        for x in (0..image.width()).step_by(2) {
            let pixel = image.get_pixel(x, y);
            red += pixel[0] as f32;
            green += pixel[1] as f32;
            blue += pixel[2] as f32;
            count += 1.0;
        }
    }
    if count == 0.0 {
        return None;
    }
    red /= count;
    green /= count;
    blue /= count;
    if red > 110.0 && red > blue * 1.35 && red > green * 0.9 {
        Some(((red - blue) / red).clamp(0.0, 1.0))
    } else {
        None
    }
}

pub fn drone_camera(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    ["dji", "mavic", "autel", "skydio", "parrot", "drone", "inspire"]
        .iter()
        .any(|hint| lower.contains(hint))
}

fn tags_from_logits(logits: &[f32]) -> Vec<Tag> {
    if logits.is_empty() {
        return Vec::new();
    }
    let max = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let mut probabilities: Vec<f32> = logits.iter().map(|value| (value - max).exp()).collect();
    let sum: f32 = probabilities.iter().sum();
    if sum > 0.0 {
        for value in &mut probabilities {
            *value /= sum;
        }
    }
    let mut order: Vec<usize> = (0..probabilities.len()).collect();
    order.sort_by(|&left, &right| {
        probabilities[right]
            .partial_cmp(&probabilities[left])
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut tags = Vec::new();
    for (rank, index) in order.into_iter().take(8).enumerate() {
        let score = probabilities[index];
        let useful = is_family(index) || !nouns_for_class(index).is_empty();
        if score < 0.05 && !(useful && score >= 0.02) {
            continue;
        }
        if rank >= 5 && !useful {
            continue;
        }
        tags.extend(tags_for_class(index, score));
    }
    dedupe_tags(tags)
}

fn is_family(index: usize) -> bool {
    (151..=268).contains(&index)
        || (281..=285).contains(&index)
        || (80..=100).contains(&index)
        || index == 145
        || index == 146
        || (269..=297).contains(&index)
        || index == 340
        || (342..=344).contains(&index)
        || (346..=355).contains(&index)
        || index == 339
}

fn kind_for_index(index: usize) -> &'static str {
    if (151..=268).contains(&index) || (281..=285).contains(&index) {
        "pet"
    } else if (80..=100).contains(&index)
        || index == 145
        || index == 146
        || (269..=297).contains(&index)
        || index == 340
        || (342..=344).contains(&index)
        || (346..=355).contains(&index)
    {
        "wildlife"
    } else if index == 339 {
        "animal"
    } else if nouns_for_class(index)
        .iter()
        .any(|noun| *noun == "beach" || *noun == "water")
    {
        "scene"
    } else {
        "object"
    }
}

fn kind_for_noun(noun: &str) -> &'static str {
    match noun {
        "dog" | "cat" => "pet",
        "bird" | "wildlife" => "wildlife",
        "horse" => "animal",
        "beach" | "water" => "scene",
        _ => "object",
    }
}

/// Everyday words a photo of this ImageNet class should match in search.
fn nouns_for_class(index: usize) -> &'static [&'static str] {
    match index {
        460 | 972 | 973 | 975 | 976 | 977 | 978 => &["beach", "water"],
        525 | 562 | 974 => &["water"],
        536 | 718 => &["water", "boat"],
        437 => &["lighthouse"],
        449 => &["boat", "architecture"],
        472 | 484 | 554 | 576 | 625 | 694 | 780 | 814 | 871 | 913 | 914 => &["boat"],
        425 | 483 | 497 | 538 | 663 | 668 | 698 | 708 | 821 | 832 | 839 | 888 | 900 => &["architecture"],
        407 | 436 | 468 | 511 | 555 | 565 | 609 | 656 | 705 | 717 | 751 | 757 | 817 | 829 => &["vehicle"],
        _ => &[],
    }
}

fn tags_for_class(index: usize, score: f32) -> Vec<Tag> {
    let mut tags = Vec::new();
    if (151..=268).contains(&index) {
        tags.push(Tag { kind: "pet", label: "dog".into(), score });
    } else if (281..=285).contains(&index) {
        tags.push(Tag { kind: "pet", label: "cat".into(), score });
    } else if (80..=100).contains(&index) || index == 145 || index == 146 {
        tags.push(Tag { kind: "wildlife", label: "bird".into(), score });
    } else if (269..=297).contains(&index)
        || index == 340
        || (342..=344).contains(&index)
        || (346..=355).contains(&index)
    {
        tags.push(Tag { kind: "wildlife", label: "wildlife".into(), score });
    } else if index == 339 {
        tags.push(Tag { kind: "animal", label: "horse".into(), score });
    }
    for noun in nouns_for_class(index) {
        tags.push(Tag {
            kind: kind_for_noun(noun),
            label: (*noun).into(),
            score,
        });
    }
    let specific = imagenet_name(index).unwrap_or("").to_ascii_lowercase();
    if !specific.is_empty() && tags.iter().all(|tag| tag.label != specific) {
        tags.push(Tag {
            kind: kind_for_index(index),
            label: specific,
            score,
        });
    }
    tags
}

fn dedupe_tags(tags: Vec<Tag>) -> Vec<Tag> {
    let mut kept: Vec<Tag> = Vec::new();
    for tag in tags {
        if let Some(existing) = kept.iter_mut().find(|item| item.kind == tag.kind && item.label == tag.label) {
            existing.score = existing.score.max(tag.score);
        } else {
            kept.push(tag);
        }
    }
    kept
}

fn imagenet_name(index: usize) -> Option<&'static str> {
    imagenet().get(index).copied()
}

fn imagenet() -> &'static [&'static str] {
    static CLASSES: OnceLock<Vec<&str>> = OnceLock::new();
    CLASSES.get_or_init(|| include_str!("imagenet_classes.txt").lines().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_embedding_clusters_and_opposites_do_not() {
        let known = vec![(7_i64, vec![1.0, 0.0, 0.0])];
        let close = nearest(&[0.9, 0.1, 0.0], &known).unwrap();
        assert_eq!(close.0, 7);
        assert!(close.1 >= SAME_PERSON);
        let far = nearest(&[0.0, 1.0, 0.0], &known).unwrap();
        assert!(far.1 < SAME_PERSON);
    }

    #[test]
    fn yunet_decode_keeps_a_confident_cell() {
        let cells = (INPUT / 32) * (INPUT / 32);
        let mut cls = vec![0.0; cells as usize];
        let mut obj = vec![0.0; cells as usize];
        let mut bbox = vec![0.0; cells as usize * 4];
        let kps = vec![0.0; cells as usize * 10];
        let index = (10 * (INPUT / 32) + 10) as usize;
        cls[index] = 1.0;
        obj[index] = 1.0;
        bbox[index * 4 + 2] = 2.0_f32.ln();
        bbox[index * 4 + 3] = 2.0_f32.ln();
        let heads = Heads {
            cls: [&[], &[], &cls],
            obj: [&[], &[], &obj],
            bbox: [&[], &[], &bbox],
            kps: [&[], &[], &kps],
        };
        let faces = decode_yunet(&heads, 0.5, 0.3);
        assert_eq!(faces.len(), 1);
        assert!(faces[0].width > 10.0);
    }

    #[test]
    fn warm_sky_is_a_sunset_and_dji_is_a_drone() {
        let mut sky = RgbImage::new(8, 8);
        for pixel in sky.pixels_mut() {
            *pixel = Rgb([210, 120, 70]);
        }
        assert!(sunset_score(&sky).is_some());
        let mut noon = RgbImage::new(8, 8);
        for pixel in noon.pixels_mut() {
            *pixel = Rgb([120, 160, 220]);
        }
        assert!(sunset_score(&noon).is_none());
        assert!(drone_camera("DJI FC3411"));
        assert!(!drone_camera("Sony A7 IV"));
    }

    #[test]
    fn imagenet_dogs_and_big_cats_map_to_subjects() {
        let dogs = tags_for_class(207, 0.4);
        assert!(dogs.iter().any(|tag| tag.kind == "pet" && tag.label == "dog"));
        let lion = tags_for_class(291, 0.5);
        assert!(lion.iter().any(|tag| tag.kind == "wildlife" && tag.label == "lion"));
        assert_eq!(imagenet_name(151), Some("Chihuahua"));
        let shore = tags_for_class(978, 0.4);
        assert!(shore.iter().any(|tag| tag.label == "beach" && tag.kind == "scene"));
        assert!(shore.iter().any(|tag| tag.label == "water"));
        assert!(shore.iter().any(|tag| tag.label == "seashore"));
        let boat = tags_for_class(814, 0.4);
        assert!(boat.iter().any(|tag| tag.label == "boat" && tag.kind == "object"));
        let tower = tags_for_class(437, 0.4);
        assert!(tower.iter().any(|tag| tag.label == "lighthouse"));
        let hall = tags_for_class(483, 0.4);
        assert!(hall.iter().any(|tag| tag.label == "architecture"));
    }

    #[test]
    fn pixel_colors_tag_beach_water_sunset_and_lighthouse() {
        let mut shore = RgbImage::new(80, 80);
        for y in 0..48 {
            for x in 0..80 {
                shore.put_pixel(x, y, Rgb([70, 140, 220]));
            }
        }
        for y in 48..80 {
            for x in 0..80 {
                shore.put_pixel(x, y, Rgb([214, 176, 112]));
            }
        }
        for y in 6..64 {
            for x in 36..44 {
                shore.put_pixel(x, y, Rgb([248, 246, 236]));
            }
        }
        let tags = scene_tags(&shore);
        assert!(tags.iter().any(|tag| tag.label == "beach"), "{tags:?}");
        assert!(tags.iter().any(|tag| tag.label == "water"), "{tags:?}");
        assert!(tags.iter().any(|tag| tag.label == "lighthouse"), "{tags:?}");

        let mut sky = RgbImage::new(24, 16);
        for pixel in sky.pixels_mut() {
            *pixel = Rgb([210, 110, 60]);
        }
        assert!(scene_tags(&sky).iter().any(|tag| tag.label == "sunset"));
    }

    #[test]
    fn analyzed_pixels_are_stored_for_search() {
        let dir = tempfile::tempdir().unwrap();
        let library = crate::db::Library::open(dir.path().join("library.sqlite")).unwrap();
        let photo = dir.path().join("shore.png");
        let mut shore = RgbImage::new(64, 48);
        for y in 0..28 {
            for x in 0..64 {
                shore.put_pixel(x, y, Rgb([60, 130, 220]));
            }
        }
        for y in 28..48 {
            for x in 0..64 {
                shore.put_pixel(x, y, Rgb([210, 170, 100]));
            }
        }
        shore.save(&photo).unwrap();
        library
            .upsert_media(crate::db::NewMedia {
                file_path: photo.to_str().unwrap(),
                content_hash: "abc",
                file_size: 12,
                created_at: None,
                modified_at: 10,
                media_kind: crate::models::MediaKind::Image,
                exif_json: None,
                captured_at: None,
            })
            .unwrap();
        recognize_library(&library, |_, _, _| {}).unwrap();
        let labels = library.insights().unwrap().labels;
        assert!(
            labels.iter().any(|label| label.label == "beach"),
            "stored labels: {labels:?}"
        );
        assert!(library.pending_vision().unwrap().is_empty());
    }

    #[test]
    fn models_run_on_a_plain_frame() {
        let mut engine = Engine::load(2).expect("models");
        let frame = RgbImage::from_pixel(64, 48, Rgb([20, 40, 80]));
        let resized = image::imageops::resize(&frame, INPUT, INPUT, FilterType::Triangle);
        let faces = engine.detect(&resized).expect("yunet");
        assert!(faces.is_empty());
        let tags = engine.subjects(&resized).expect("mobilenet");
        assert!(tags.len() < 20);
    }
}
