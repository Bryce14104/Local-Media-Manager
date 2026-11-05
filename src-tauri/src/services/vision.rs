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
    let pending = library.pending_vision().unwrap_or_default();
    let mut workable = Vec::new();
    for item in pending {
        if source_path(&item).is_some() {
            workable.push(item);
        } else {
            let _ = library.mark_vision(item.id);
        }
    }
    if workable.is_empty() {
        return Ok(());
    }
    progress(0, workable.len(), "Loading vision models");
    let mut engine = Engine::load()?;
    for (index, target) in workable.iter().enumerate() {
        progress(index, workable.len(), "Reading faces and subjects");
        if let Err(error) = recognize_one(&mut engine, library, target) {
            eprintln!("shelf vision: {error}");
        }
        let _ = library.mark_vision(target.id);
    }
    progress(workable.len(), workable.len(), "Reading faces and subjects");
    Ok(())
}

fn recognize_one(engine: &mut Engine, library: &Library, target: &VisionTarget) -> Result<(), VisionError> {
    let Some(path) = source_path(target) else {
        return Ok(());
    };
    let Some(image) = image::open(path).ok().map(|image| image.to_rgb8()) else {
        return Ok(());
    };
    let _ = library.clear_file_vision(target.id);
    let resized = image::imageops::resize(&image, INPUT, INPUT, FilterType::Triangle);
    let faces = engine.detect(&resized)?;
    let mut known = library.face_embeddings().unwrap_or_default();
    for face in faces {
        let aligned = align_or_crop(&resized, &face);
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

    let mut tags = engine.subjects(&resized)?;
    if let Some(score) = sunset_score(&resized) {
        tags.push(Tag {
            kind: "scene",
            label: "sunset".into(),
            score,
        });
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
    let _ = library.replace_labels(target.id, &labels);
    Ok(())
}

fn source_path(target: &VisionTarget) -> Option<&Path> {
    if let Some(thumb) = target.thumbnail_path.as_deref()
        && Path::new(thumb).is_file()
    {
        return Some(Path::new(thumb));
    }
    if target.media_kind == "image" && Path::new(&target.file_path).is_file() {
        return Some(Path::new(&target.file_path));
    }
    None
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
    fn load() -> Result<Self, VisionError> {
        let environment = environment()?;
        Ok(Self {
            yunet: session(environment, "yunet.onnx")?,
            sface: session(environment, "sface.onnx")?,
            mobilenet: session(environment, "mobilenet.onnx")?,
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
    if let Some(existing) = ENV.get() {
        return Ok(existing);
    }
    let built = ort::init().with_name("shelf").build()?;
    let _ = ENV.set(built);
    Ok(ENV.get().expect("vision environment"))
}

fn session(environment: &ort::environment::Environment, file_name: &str) -> Result<Session, VisionError> {
    let path = model_path(file_name);
    if !path.is_file() {
        return Err(VisionError::MissingModel(path.display().to_string()));
    }
    Ok(Session::builder(environment)?
        .with_intra_threads(2)
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
    for index in order.into_iter().take(5) {
        let score = probabilities[index];
        if score < 0.05 {
            continue;
        }
        tags.extend(tags_for_class(index, score));
    }
    dedupe_tags(tags)
}

fn tags_for_class(index: usize, score: f32) -> Vec<Tag> {
    let name = imagenet_name(index).unwrap_or("");
    let (kind, family) = if (151..=268).contains(&index) {
        ("pet", "dog")
    } else if (281..=285).contains(&index) {
        ("pet", "cat")
    } else if (80..=100).contains(&index) || index == 145 || index == 146 {
        ("wildlife", "bird")
    } else if (269..=297).contains(&index)
        || index == 340
        || (342..=344).contains(&index)
        || (346..=355).contains(&index)
    {
        ("wildlife", "wildlife")
    } else if index == 339 {
        ("animal", "horse")
    } else {
        return Vec::new();
    };
    let mut tags = vec![Tag {
        kind,
        label: family.into(),
        score,
    }];
    let specific = name.to_ascii_lowercase();
    if specific != family && !specific.is_empty() {
        tags.push(Tag {
            kind,
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
    }

    #[test]
    fn models_run_on_a_plain_frame() {
        let mut engine = Engine::load().expect("models");
        let frame = RgbImage::from_pixel(64, 48, Rgb([20, 40, 80]));
        let resized = image::imageops::resize(&frame, INPUT, INPUT, FilterType::Triangle);
        let faces = engine.detect(&resized).expect("yunet");
        assert!(faces.is_empty());
        let tags = engine.subjects(&resized).expect("mobilenet");
        assert!(tags.len() < 20);
    }
}
