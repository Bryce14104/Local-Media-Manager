//! Local subject recognition.
//!
//! CLIP ViT-B/32 embeds each still into 512 floats and scores a photographer
//! tag bank plus open-vocabulary search. Color heuristics still add sunset,
//! beach, water, and lighthouse. Drone comes from the camera name. Weights
//! stay on this machine after the first download.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use image::imageops::FilterType;
use image::{Rgb, RgbImage};
use ndarray::Array4;
use ort::session::Session;
use ort::value::Tensor;
use thiserror::Error;

use crate::db::{DbError, Library, VisionTarget};
use crate::models::{AiSearchHit, ExifSnapshot};

const INPUT: u32 = 640;
const FACE_SCORE: f32 = 0.6;
const FACE_NMS: f32 = 0.3;
/// Cosine similarity used by OpenCV's SFace matcher for the same person.
pub const SAME_PERSON: f32 = 0.36;
const STRIDES: [u32; 3] = [8, 16, 32];
const RIGHT_EYE: (f32, f32) = (38.2946, 51.6963);
const LEFT_EYE: (f32, f32) = (73.5318, 51.5014);
pub use super::vocab::{CONCEPTS, query_embedding};

use super::vocab::{
    aliases_for_label, concept_index, concepts_for_class, extra_words_from_class_name, imagenet_name,
    kind_for_concept,
};

const CONCEPT_FLOOR: f32 = 0.08;

const _: () = assert!(CONCEPTS.len() == crate::models::VISUAL_CONCEPTS);
const _: () = assert!(crate::models::VISUAL_EMBEDDING_FLOATS == crate::models::CLIP_DIM);

#[derive(Debug, Error)]
pub enum VisionError {
    #[error("missing vision model at {0}")]
    MissingModel(String),
    #[error(transparent)]
    Ort(#[from] ort::Error),
    #[error("could not store the visual embedding: {0}")]
    Database(#[from] DbError),
    #[error("could not decode pixels in {0}")]
    Decode(String),
    #[error("classifier returned {0} values, expected 1000")]
    BadOutput(usize),
}

pub fn warm_vision() -> Result<(), VisionError> {
    let threads = worker_threads();
    let started = std::time::Instant::now();
    Engine::load(threads)?;
    eprintln!(
        "shelf index: CLIP ViT-B/32 ready in {} ms",
        started.elapsed().as_millis()
    );
    let blank = RgbImage::new(224, 224);
    let started = std::time::Instant::now();
    let embedding = clip_engine(|clip| clip.encode_image(&blank))?;
    if embedding.len() != crate::models::CLIP_DIM {
        eprintln!(
            "shelf index: CRITICAL CLIP returned {} floats, expected {}",
            embedding.len(),
            crate::models::CLIP_DIM
        );
        return Err(VisionError::BadOutput(embedding.len()));
    }
    let _ = clip_engine(|clip| clip.encode_text("a photo of a dog"))?;
    eprintln!(
        "shelf index: CLIP image embed ok in {} ms -> {} floats",
        started.elapsed().as_millis(),
        embedding.len()
    );
    Ok(())
}

fn worker_threads() -> usize {
    let cores = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(4);
    cores.saturating_sub(1).clamp(2, 6)
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

struct Engine;

fn clip_engine<T>(op: impl FnOnce(&mut super::clip::Clip) -> Result<T, VisionError>) -> Result<T, VisionError> {
    super::clip::with_engine(worker_threads(), op)
}

struct PreparedFrame {
    labels: Vec<(String, String, f32)>,
    embedding: Vec<f32>,
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
    eprintln!("shelf index: {} frames waiting for a CLIP embedding", pending.len());
    progress(0, pending.len(), "Loading CLIP");
    if let Err(error) = Engine::load(worker_threads()) {
        eprintln!("shelf index: CRITICAL CLIP could not load: {error}");
        return Err(error);
    }
    for (index, target) in pending.iter().enumerate() {
        progress(index, pending.len(), "Running ONNX on image pixels");
        match prepare_frame(target) {
            Ok(prepared) => {
                let names = prepared
                    .labels
                    .iter()
                    .map(|(_, label, _)| label.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                if names.is_empty() {
                    eprintln!("shelf index: embedded {} (no tags above the cutoff)", target.file_path);
                } else {
                    eprintln!("shelf index: embedded {} -> {names}", target.file_path);
                }
                if let Err(error) = store_frame(library, target.id, &prepared.labels, &prepared.embedding) {
                    eprintln!("shelf index: could not store {}: {error}", target.file_path);
                }
                if let Some(image) = load_pixels(target) {
                    match assign_faces(library, target.id, &image) {
                        Ok(count) if count > 0 => {
                            eprintln!("shelf index: {count} face(s) on {}", target.file_path);
                        }
                        Err(error) => eprintln!("shelf index: faces skipped on {}: {error}", target.file_path),
                        _ => {}
                    }
                }
            }
            Err(error) => {
                eprintln!("shelf index: CRITICAL {} was not embedded: {error}", target.file_path);
            }
        }
    }
    progress(0, 0, "Clustering");
    if let Err(error) = library.rebuild_concepts() {
        eprintln!("shelf index: could not write clusters and captions: {error}");
    }
    progress(0, 0, "Captioning");
    Ok(())
}

fn prepare_frame(target: &VisionTarget) -> Result<PreparedFrame, VisionError> {
    let Some(image) = load_pixels(target) else {
        eprintln!("shelf index: CRITICAL no decodable pixels in {}", target.file_path);
        return Err(VisionError::Decode(target.file_path.clone()));
    };
    eprintln!(
        "shelf index: decoding pixels ({}) {}",
        target.media_kind, target.file_path
    );
    let mut tags = scene_tags(&image);
    let embedding = clip_engine(|clip| clip.encode_image(&image))?;
    let clip_tags = clip_engine(|clip| Ok(clip.tags_for(&embedding)))?;
    for clip_tag in clip_tags {
        tags.push(Tag {
            kind: clip_tag.kind,
            label: clip_tag.label,
            score: clip_tag.score,
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
    eprintln!(
        "shelf index: tagged {} ({} floats)",
        target.file_path,
        embedding.len()
    );
    Ok(PreparedFrame { labels, embedding })
}

fn store_frame(
    library: &Library,
    media_id: i64,
    labels: &[(String, String, f32)],
    embedding: &[f32],
) -> Result<(), VisionError> {
    let _ = library.clear_file_vision(media_id);
    library.replace_labels(media_id, labels)?;
    library.upsert_embedding(media_id, embedding)?;
    library.mark_vision(media_id)?;
    Ok(())
}

fn note_person(labels: &mut Vec<(String, String, f32)>, embedding: &mut [f32]) {
    if !labels.iter().any(|(_, label, _)| label == "person") {
        labels.push(("object".to_string(), "person".to_string(), 1.0));
    }
    let Some(index) = concept_index("person") else {
        return;
    };
    let slot = crate::models::IMAGENET_DIM + index;
    if slot < embedding.len() {
        embedding[slot] = embedding[slot].max(1.0);
    }
}

fn might_contain_person(image: &RgbImage) -> bool {
    skin_ratio(image) >= 0.012
}

fn skin_ratio(image: &RgbImage) -> f32 {
    let width = image.width();
    let height = image.height();
    if width == 0 || height == 0 {
        return 0.0;
    }
    let step = (width.max(height) / 96).max(1);
    let mut skin = 0.0;
    let mut total = 0.0;
    let mut y = 0;
    while y < height {
        let mut x = 0;
        while x < width {
            let pixel = image.get_pixel(x, y);
            if is_skin(pixel[0] as f32, pixel[1] as f32, pixel[2] as f32) {
                skin += 1.0;
            }
            total += 1.0;
            x += step;
        }
        y += step;
    }
    if total == 0.0 { 0.0 } else { skin / total }
}

fn is_skin(red: f32, green: f32, blue: f32) -> bool {
    let y = 0.299 * red + 0.587 * green + 0.114 * blue;
    let cb = 128.0 - 0.168736 * red - 0.331264 * green + 0.5 * blue;
    let cr = 128.0 + 0.5 * red - 0.418688 * green - 0.081312 * blue;
    y > 80.0 && (77.0..135.0).contains(&cb) && (133.0..173.0).contains(&cr)
}

fn center_crop(image: &RgbImage) -> RgbImage {
    let width = image.width().max(1);
    let height = image.height().max(1);
    let crop_width = ((width as f32) * 0.62).max(1.0) as u32;
    let crop_height = ((height as f32) * 0.62).max(1.0) as u32;
    let x = width.saturating_sub(crop_width) / 2;
    let y = height.saturating_sub(crop_height) / 2;
    image::imageops::crop_imm(image, x, y, crop_width.min(width), crop_height.min(height)).to_image()
}

pub fn search_embeddings(library: &Library, query: &str) -> Result<Vec<AiSearchHit>, VisionError> {
    let started = std::time::Instant::now();
    Engine::load(worker_threads())?;
    let query_vec = clip_engine(|clip| clip.query_vector(query))?;
    let rewritten = super::clip::rewrite_query(query);
    let rows = library.visual_embeddings()?;
    eprintln!(
        "shelf search: CLIP scoring {} embeddings for {query:?} (normalized {rewritten:?})",
        rows.len()
    );
    let mut hits = Vec::new();
    for (media_id, path, embedding) in &rows {
        if embedding.len() != crate::models::VISUAL_EMBEDDING_FLOATS {
            eprintln!(
                "shelf search: CRITICAL {} has a {}-float embedding, expected {}",
                path,
                embedding.len(),
                crate::models::VISUAL_EMBEDDING_FLOATS
            );
            continue;
        }
        let score = super::clip::cosine(embedding, &query_vec);
        if score < 0.22 {
            continue;
        }
        hits.push(AiSearchHit {
            media_id: *media_id,
            path: path.clone(),
            score,
            label: rewritten.clone(),
        });
    }
    hits.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    eprintln!(
        "shelf search: scored {} embeddings in {} ms, {} matched {query:?}",
        rows.len(),
        started.elapsed().as_millis(),
        hits.len()
    );
    Ok(hits)
}

pub fn similar_to(library: &Library, path: &str) -> Result<Vec<AiSearchHit>, VisionError> {
    let media_id = library
        .find_by_path(path)
        .ok()
        .flatten()
        .map(|row| row.id);
    let rows = library.visual_embeddings()?;
    let Some((_, _, probe)) = rows.iter().find(|(id, file, _)| {
        media_id.is_some_and(|want| *id == want) || file == path
    }) else {
        return Ok(Vec::new());
    };
    let mut hits = Vec::new();
    for (id, file, embedding) in &rows {
        if media_id.is_some_and(|want| *id == want) {
            continue;
        }
        let score = super::clip::cosine(embedding, probe);
        if score < 0.28 {
            continue;
        }
        hits.push(AiSearchHit {
            media_id: *id,
            path: file.clone(),
            score,
            label: "similar".into(),
        });
    }
    hits.sort_by(|left, right| right.score.partial_cmp(&left.score).unwrap_or(std::cmp::Ordering::Equal));
    hits.truncate(48);
    Ok(hits)
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
        super::clip::with_engine(threads, |_| Ok(()))?;
        Ok(Self)
    }
}

const YUNET: &str = "face_detection_yunet_2023mar.onnx";
const SFACE: &str = "face_recognition_sface_2021dec.onnx";
const YUNET_URL: &str =
    "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx";
const SFACE_URL: &str =
    "https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx";

struct FaceSessions {
    det: Session,
    rec: Session,
}

fn face_sessions() -> Result<&'static Mutex<FaceSessions>, VisionError> {
    static FACES: OnceLock<Mutex<FaceSessions>> = OnceLock::new();
    if let Some(existing) = FACES.get() {
        return Ok(existing);
    }
    super::clip::ensure_face_models(YUNET, YUNET_URL, SFACE, SFACE_URL)?;
    let environment = environment()?;
    let threads = worker_threads();
    let det = session(environment, YUNET, threads)?;
    let rec = session(environment, SFACE, threads.max(1))?;
    let _ = FACES.set(Mutex::new(FaceSessions { det, rec }));
    FACES.get().ok_or_else(|| VisionError::Decode("face engine".into()))
}

fn assign_faces(library: &Library, media_id: i64, image: &RgbImage) -> Result<usize, VisionError> {
    if !might_contain_person(image) {
        return Ok(0);
    }
    let Ok(lock) = face_sessions() else {
        return Ok(0);
    };
    let mut guard = lock.lock().unwrap_or_else(|err| err.into_inner());
    let faces = detect_faces(&mut guard.det, image)?;
    if faces.is_empty() {
        return Ok(0);
    }
    let mut known = library.person_prototypes().unwrap_or_default();
    let mut stored = 0;
    for face in faces {
        let aligned = align_or_crop(image, &face);
        let mut embedding = sface_embed(&mut guard.rec, &aligned)?;
        l2_normalize(&mut embedding);
        let person_id = match nearest(&embedding, &known) {
            Some((id, score)) if score >= SAME_PERSON => id,
            _ => {
                let id = library.create_person(None).map_err(VisionError::Database)?;
                known.push((id, embedding.clone()));
                id
            }
        };
        let width = image.width().max(1) as f32;
        let height = image.height().max(1) as f32;
        library
            .insert_face(
                media_id,
                person_id,
                (face.x / width).clamp(0.0, 1.0),
                (face.y / height).clamp(0.0, 1.0),
                (face.width / width).clamp(0.0, 1.0),
                (face.height / height).clamp(0.0, 1.0),
                face.score,
                &embedding,
            )
            .map_err(VisionError::Database)?;
        stored += 1;
    }
    Ok(stored)
}

fn detect_faces(det: &mut Session, image: &RgbImage) -> Result<Vec<DetectedFace>, VisionError> {
    let scaled = image::imageops::resize(image, INPUT, INPUT, FilterType::Triangle);
    let tensor = Tensor::from_array(nchw(&scaled, true, |value, _| value))?;
    let input = tensor_name(det, true, &["input"]);
    let outputs = det.run(ort::inputs![input.as_str() => tensor])?;
    let mut cls = [&[] as &[f32]; 3];
    let mut obj = [&[] as &[f32]; 3];
    let mut bbox = [&[] as &[f32]; 3];
    let mut kps = [&[] as &[f32]; 3];
    let mut extracted = Vec::new();
    for (name, value) in outputs.iter() {
        let Ok((_shape, data)) = value.try_extract_tensor::<f32>() else {
            continue;
        };
        extracted.push((name.to_string(), data.to_vec()));
    }
    for (name, data) in &extracted {
        let slot = if name.contains("8") && !name.contains("16") && !name.contains("32") {
            0
        } else if name.contains("16") {
            1
        } else if name.contains("32") {
            2
        } else {
            continue;
        };
        let lower = name.to_ascii_lowercase();
        if lower.contains("cls") {
            cls[slot] = data.as_slice();
        } else if lower.contains("obj") {
            obj[slot] = data.as_slice();
        } else if lower.contains("bbox") {
            bbox[slot] = data.as_slice();
        } else if lower.contains("kps") || lower.contains("key") {
            kps[slot] = data.as_slice();
        }
    }
    if cls.iter().any(|row| row.is_empty()) {
        return Ok(Vec::new());
    }
    let mut faces = decode_yunet(
        &Heads {
            cls,
            obj,
            bbox,
            kps,
        },
        FACE_SCORE,
        FACE_NMS,
    );
    let scale_x = image.width() as f32 / INPUT as f32;
    let scale_y = image.height() as f32 / INPUT as f32;
    for face in &mut faces {
        face.x *= scale_x;
        face.y *= scale_y;
        face.width *= scale_x;
        face.height *= scale_y;
        for point in &mut face.landmarks {
            point.0 *= scale_x;
            point.1 *= scale_y;
        }
    }
    Ok(faces)
}

fn sface_embed(rec: &mut Session, image: &RgbImage) -> Result<Vec<f32>, VisionError> {
    let sized = if image.width() == 112 && image.height() == 112 {
        image.clone()
    } else {
        image::imageops::resize(image, 112, 112, FilterType::Triangle)
    };
    let tensor = Tensor::from_array(nchw(&sized, true, |value, _| (value - 127.5) / 128.0))?;
    let input = tensor_name(rec, true, &["data", "input"]);
    let out = tensor_name(rec, false, &["fc1", "output"]);
    let outputs = rec.run(ort::inputs![input.as_str() => tensor])?;
    let (_shape, data) = outputs[out.as_str()].try_extract_tensor::<f32>()?;
    Ok(data.to_vec())
}

fn tensor_name(session: &Session, input: bool, hints: &[&str]) -> String {
    let names: Vec<String> = if input {
        session.inputs().iter().map(|item| item.name().to_string()).collect()
    } else {
        session.outputs().iter().map(|item| item.name().to_string()).collect()
    };
    for hint in hints {
        if let Some(name) = names.iter().find(|name| name.eq_ignore_ascii_case(hint) || name.contains(hint)) {
            return name.clone();
        }
    }
    names.into_iter().next().unwrap_or_else(|| "input".into())
}

struct Classified {
    tags: Vec<Tag>,
    probabilities: Vec<f32>,
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
    if sky_ratio > 0.55 && sunset_score(image).is_none() {
        tags.push(Tag {
            kind: "scene",
            label: "sky".into(),
            score: sky_ratio.min(1.0),
        });
    }
    if let Some(score) = snow_score(&sample) {
        tags.push(Tag {
            kind: "scene",
            label: "snow".into(),
            score,
        });
    }
    if let Some(score) = night_score(&sample) {
        tags.push(Tag {
            kind: "scene",
            label: "night".into(),
            score,
        });
    }
    if let Some(score) = forest_score(&sample) {
        tags.push(Tag {
            kind: "scene",
            label: "forest".into(),
            score,
        });
    }
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

fn snow_score(image: &RgbImage) -> Option<f32> {
    let mut bright = 0.0;
    let mut total = 0.0;
    for pixel in image.pixels() {
        let red = pixel[0] as f32;
        let green = pixel[1] as f32;
        let blue = pixel[2] as f32;
        total += 1.0;
        let mean = (red + green + blue) / 3.0;
        let spread = (red - green).abs() + (green - blue).abs();
        if mean > 198.0 && spread < 48.0 {
            bright += 1.0;
        }
    }
    let ratio: f32 = if total > 0.0 { bright / total } else { 0.0 };
    (ratio > 0.42).then_some(ratio.min(1.0))
}

fn night_score(image: &RgbImage) -> Option<f32> {
    let mut sum = 0.0;
    let mut total = 0.0;
    for pixel in image.pixels() {
        sum += (pixel[0] as f32 + pixel[1] as f32 + pixel[2] as f32) / 3.0;
        total += 1.0;
    }
    if total == 0.0 {
        return None;
    }
    let mean = sum / total;
    (mean < 38.0).then_some(((50.0 - mean) / 50.0).clamp(0.4, 0.95))
}

fn forest_score(image: &RgbImage) -> Option<f32> {
    let mut greenish = 0.0;
    let mut total = 0.0;
    for pixel in image.pixels() {
        let red = pixel[0] as f32;
        let green = pixel[1] as f32;
        let blue = pixel[2] as f32;
        total += 1.0;
        if green > 70.0 && green > red * 1.12 && green > blue * 1.08 {
            greenish += 1.0;
        }
    }
    let ratio: f32 = if total > 0.0 { greenish / total } else { 0.0 };
    (ratio > 0.38).then_some(ratio.min(1.0))
}

pub fn drone_camera(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    ["dji", "mavic", "autel", "skydio", "parrot", "drone", "inspire"]
        .iter()
        .any(|hint| lower.contains(hint))
}

fn probabilities_from_logits(logits: &[f32]) -> Vec<f32> {
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
    probabilities
}

pub fn embedding_from_probabilities(probabilities: &[f32]) -> Vec<f32> {
    let mut embedding = vec![0.0; CONCEPTS.len()];
    for (index, probability) in probabilities.iter().copied().enumerate() {
        if probability <= 0.0 {
            continue;
        }
        if (151..=268).contains(&index) {
            bump(&mut embedding, "dog", probability);
        } else if (281..=285).contains(&index) {
            bump(&mut embedding, "cat", probability);
        } else if (80..=100).contains(&index) || index == 145 || index == 146 {
            bump(&mut embedding, "bird", probability);
        } else if (269..=297).contains(&index)
            || index == 340
            || (342..=344).contains(&index)
            || (346..=355).contains(&index)
        {
            bump(&mut embedding, "wildlife", probability);
        } else if index == 339 {
            bump(&mut embedding, "horse", probability);
        }
        for noun in concepts_for_class(index) {
            bump(&mut embedding, noun, probability);
        }
    }
    embedding
}

pub fn visual_vector(probabilities: &[f32], concepts: &[f32]) -> Vec<f32> {
    let mut embedding = vec![0.0; crate::models::VISUAL_EMBEDDING_FLOATS];
    for (index, probability) in probabilities.iter().take(crate::models::IMAGENET_DIM).enumerate() {
        embedding[index] = *probability;
    }
    let derived = embedding_from_probabilities(probabilities);
    for index in 0..CONCEPTS.len() {
        let from_model = derived.get(index).copied().unwrap_or(0.0);
        let from_pixels = concepts.get(index).copied().unwrap_or(0.0);
        embedding[crate::models::IMAGENET_DIM + index] = from_model.max(from_pixels);
    }
    embedding
}

pub fn embedding_match(image: &[f32], query: &[f32]) -> Option<f32> {
    if image.len() != query.len() || query.iter().all(|value| *value == 0.0) {
        return None;
    }
    let mut mass = 0.0;
    for (image_value, query_value) in image.iter().zip(query) {
        if *query_value > 0.0 {
            mass += *image_value;
        }
    }
    if mass < 0.03 {
        return None;
    }
    let score = cosine(image, query);
    if score >= 0.04 { Some(score) } else { None }
}

fn bump(embedding: &mut [f32], label: &str, amount: f32) {
    bump_at(embedding, label, amount);
}

fn bump_at(embedding: &mut [f32], label: &str, amount: f32) {
    if let Some(index) = concept_index(label) {
        if let Some(slot) = embedding.get_mut(index) {
            *slot = (*slot + amount).min(1.0);
        }
    }
}

fn fold_tags(embedding: &mut [f32], tags: &[Tag]) {
    for tag in tags {
        bump(embedding, &tag.label, tag.score);
    }
}

fn matched_concepts(image: &[f32], query: &[f32]) -> String {
    let start = crate::models::IMAGENET_DIM;
    let mut names = Vec::new();
    for index in 0..CONCEPTS.len() {
        let image_value = image.get(start + index).copied().unwrap_or(0.0);
        let query_value = query.get(start + index).copied().unwrap_or(0.0);
        if query_value > 0.0 && image_value >= CONCEPT_FLOOR {
            names.push(CONCEPTS[index].to_string());
        }
    }
    if names.is_empty() {
        let mut best: Option<(usize, f32)> = None;
        for index in 0..start.min(image.len()) {
            if query.get(index).copied().unwrap_or(0.0) <= 0.0 || image[index] <= 0.0 {
                continue;
            }
            best = Some(match best {
                Some((previous, score)) if score >= image[index] => (previous, score),
                _ => (index, image[index]),
            });
        }
        if let Some((index, _)) = best
            && let Some(name) = imagenet_name(index)
        {
            names.push(name.to_string());
        }
    }
    if names.is_empty() {
        "embedding".to_string()
    } else {
        names.join(", ")
    }
}

fn tags_from_probabilities(probabilities: &[f32]) -> Vec<Tag> {
    if probabilities.is_empty() {
        return Vec::new();
    }
    let mut order: Vec<usize> = (0..probabilities.len()).collect();
    order.sort_by(|&left, &right| {
        probabilities[right]
            .partial_cmp(&probabilities[left])
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut tags = Vec::new();
    for (rank, index) in order.into_iter().take(20).enumerate() {
        let score = probabilities[index];
        let useful = is_family(index) || !concepts_for_class(index).is_empty();
        if score < 0.012 && !(useful && score >= 0.006) {
            continue;
        }
        if rank >= 12 && !useful {
            continue;
        }
        tags.extend(tags_for_class(index, score));
    }
    let mut tags = dedupe_tags(tags);
    tags.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    tags.truncate(28);
    tags
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
    } else if concepts_for_class(index)
        .iter()
        .any(|noun| kind_for_concept(noun) == "scene")
    {
        "scene"
    } else {
        "object"
    }
}

fn tags_for_class(index: usize, score: f32) -> Vec<Tag> {
    let mut tags = Vec::new();
    for noun in concepts_for_class(index) {
        tags.push(Tag {
            kind: kind_for_concept(noun),
            label: (*noun).into(),
            score,
        });
        for alias in aliases_for_label(noun) {
            tags.push(Tag {
                kind: kind_for_concept(noun),
                label: (*alias).into(),
                score: (score * 0.92).min(1.0),
            });
        }
    }
    let specific = imagenet_name(index).unwrap_or("").to_ascii_lowercase();
    if !specific.is_empty() {
        tags.push(Tag {
            kind: kind_for_index(index),
            label: specific.clone(),
            score,
        });
        for alias in aliases_for_label(&specific) {
            tags.push(Tag {
                kind: kind_for_index(index),
                label: (*alias).into(),
                score: (score * 0.9).min(1.0),
            });
        }
        for word in extra_words_from_class_name(&specific) {
            if tags.iter().all(|tag| tag.label != word) {
                tags.push(Tag {
                    kind: kind_for_index(index),
                    label: word,
                    score: (score * 0.85).min(1.0),
                });
            }
        }
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
        assert!(dogs.iter().any(|tag| tag.label == "golden retriever" || tag.label.contains("retriever")));
        let lion = tags_for_class(291, 0.5);
        assert!(lion.iter().any(|tag| tag.kind == "wildlife" && tag.label == "lion"));
        assert_eq!(imagenet_name(151), Some("Chihuahua"));
        let shore = tags_for_class(978, 0.4);
        assert!(shore.iter().any(|tag| tag.label == "beach" && tag.kind == "scene"));
        assert!(shore.iter().any(|tag| tag.label == "water"));
        assert!(shore.iter().any(|tag| tag.label == "seashore"));
        let boat = tags_for_class(814, 0.4);
        assert!(boat.iter().any(|tag| tag.label == "boat"));
        let cats = query_embedding("beech");
        let beach = crate::models::IMAGENET_DIM + concept_index("beach").unwrap();
        assert!(cats[beach] > 0.5);
        let tower = tags_for_class(437, 0.4);
        assert!(tower.iter().any(|tag| tag.label == "lighthouse"));
        let hall = tags_for_class(483, 0.4);
        assert!(hall.iter().any(|tag| tag.label == "architecture"));
    }

    #[test]
    fn open_landscape_skips_faces_and_a_portrait_does_not() {
        let mut water = RgbImage::new(80, 48);
        for pixel in water.pixels_mut() {
            *pixel = Rgb([60, 140, 210]);
        }
        assert!(
            !might_contain_person(&water),
            "skin ratio {}",
            skin_ratio(&water)
        );

        let mut portrait = RgbImage::new(80, 48);
        for pixel in portrait.pixels_mut() {
            *pixel = Rgb([214, 164, 132]);
        }
        assert!(
            might_contain_person(&portrait),
            "skin ratio {}",
            skin_ratio(&portrait)
        );
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
            volume_id: None,
            relative_path: None,
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
        Engine::load(2).expect("models");
        let frame = RgbImage::from_pixel(64, 48, Rgb([20, 40, 80]));
        let embedding = clip_engine(|clip| clip.encode_image(&frame)).expect("clip vision");
        assert_eq!(embedding.len(), crate::models::CLIP_DIM);
        let tags = clip_engine(|clip| Ok(clip.tags_for(&embedding))).expect("tags");
        assert!(tags.len() < 32);
    }

    #[test]
    fn cat_query_is_closer_than_a_lighthouse() {
        Engine::load(2).expect("models");
        let cat = clip_engine(|clip| clip.encode_text("cat")).expect("cat");
        let cats = clip_engine(|clip| clip.encode_text("cats")).expect("cats");
        let tower = clip_engine(|clip| clip.encode_text("lighthouse")).expect("tower");
        assert!(
            super::super::clip::cosine(&cat, &cats) > super::super::clip::cosine(&cat, &tower),
            "cat {} lighthouse {}",
            super::super::clip::cosine(&cat, &cats),
            super::super::clip::cosine(&cat, &tower)
        );
    }

    #[test]
    fn embedding_search_ranks_the_beach_and_skips_a_flat_frame() {
        let dir = tempfile::tempdir().unwrap();
        let library = crate::db::Library::open(dir.path().join("library.sqlite")).unwrap();
        let shore_path = dir.path().join("shore.png");
        let flat_path = dir.path().join("flat.png");
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
        shore.save(&shore_path).unwrap();
        RgbImage::from_pixel(32, 32, Rgb([30, 30, 30]))
            .save(&flat_path)
            .unwrap();
        for path in [&shore_path, &flat_path] {
            library
                .upsert_media(crate::db::NewMedia {
                    file_path: path.to_str().unwrap(),
                    content_hash: path.to_str().unwrap(),
                    file_size: 8,
                    created_at: None,
                    modified_at: 10,
                    media_kind: crate::models::MediaKind::Image,
                    exif_json: None,
                    captured_at: None,
            volume_id: None,
            relative_path: None,
                })
                .unwrap();
        }
        recognize_library(&library, |_, _, _| {}).unwrap();
        let hits = search_embeddings(&library, "beach").unwrap();
        assert!(
            hits.iter().any(|hit| hit.path.ends_with("shore.png")),
            "hits: {hits:?}"
        );
        assert!(
            hits.iter().all(|hit| !hit.path.ends_with("flat.png")),
            "flat frame was returned: {hits:?}"
        );
        let stored = library.visual_embeddings().unwrap();
        assert_eq!(stored.len(), 2);
        assert!(stored.iter().all(|(_, _, vector)| vector.len() == crate::models::VISUAL_EMBEDDING_FLOATS));
        assert!(stored.iter().all(|(_, _, vector)| {
            let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
            (norm - 1.0).abs() < 0.05
        }));
    }
}
