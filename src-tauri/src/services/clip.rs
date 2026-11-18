//! CLIP ViT-B/32 for tags and search. Runs on-device via ONNX.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use image::imageops::FilterType;
use image::RgbImage;
use ndarray::{Array2, Array4};
use ort::session::Session;
use ort::value::Tensor;
use tokenizers::tokenizer::TruncationParams;
use tokenizers::{PaddingDirection, PaddingParams, PaddingStrategy, Tokenizer, TruncationDirection};

use super::vocab::{concept_for_term, correct_term};
use crate::services::vision::VisionError;

const VISION_MODEL: &str = "clip-vision.onnx";
const TEXT_MODEL: &str = "clip-text.onnx";
const TOKENIZER_FILE: &str = "tokenizer.json";
const CONTEXT: usize = 77;
const PAD_ID: u32 = 49407;
const CLIP_MEAN: [f32; 3] = [0.48145466, 0.4578275, 0.40821073];
const CLIP_STD: [f32; 3] = [0.26862954, 0.26130258, 0.27577711];
const TAG_TEMPERATURE: f32 = 100.0;

const VISION_URL: &str =
    "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx";
const TEXT_URL: &str =
    "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model_quantized.onnx";
const TOKENIZER_URL: &str =
    "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/tokenizer.json";

pub struct Clip {
    vision: Session,
    text: Session,
    vision_in: String,
    vision_out: String,
    text_in: String,
    text_out: String,
    tokenizer: Tokenizer,
    bank: Vec<TagVec>,
}

struct TagVec {
    kind: &'static str,
    label: &'static str,
    vector: Vec<f32>,
}

pub struct ClipTag {
    pub kind: &'static str,
    pub label: String,
    pub score: f32,
}

static SHARED: Mutex<Option<Clip>> = Mutex::new(None);

pub fn with_engine<T>(
    threads: usize,
    op: impl FnOnce(&mut Clip) -> Result<T, VisionError>,
) -> Result<T, VisionError> {
    let mut guard = SHARED.lock().unwrap_or_else(|err| err.into_inner());
    if guard.is_none() {
        *guard = Some(load(threads)?);
    }
    op(guard.as_mut().expect("clip engine"))
}

pub fn load(threads: usize) -> Result<Clip, VisionError> {
    ensure_file(VISION_MODEL, VISION_URL)?;
    ensure_file(TEXT_MODEL, TEXT_URL)?;
    ensure_file(TOKENIZER_FILE, TOKENIZER_URL)?;
    let environment = environment()?;
    let vision = session(environment, VISION_MODEL, threads)?;
    let text = session(environment, TEXT_MODEL, threads)?;
    let tokenizer = load_tokenizer()?;
    let mut clip = Clip {
        vision_in: tensor_name(&vision, true, &["pixel_values"]),
        vision_out: tensor_name(&vision, false, &["image_embeds"]),
        text_in: tensor_name(&text, true, &["input_ids"]),
        text_out: tensor_name(&text, false, &["text_embeds"]),
        vision,
        text,
        tokenizer,
        bank: Vec::new(),
    };
    clip.bank = clip.build_bank()?;
    Ok(clip)
}

impl Clip {
    pub fn encode_image(&mut self, image: &RgbImage) -> Result<Vec<f32>, VisionError> {
        let sized = clip_resize(image);
        let tensor = Tensor::from_array(nchw(&sized))?;
        let outputs = self
            .vision
            .run(ort::inputs![self.vision_in.as_str() => tensor])?;
        let (_shape, data) = outputs[self.vision_out.as_str()].try_extract_tensor::<f32>()?;
        Ok(normalized(data))
    }

    pub fn encode_text(&mut self, text: &str) -> Result<Vec<f32>, VisionError> {
        let ids = self.tokenize(text)?;
        let array = Array2::from_shape_vec((1, CONTEXT), ids).map_err(|err| {
            VisionError::Decode(format!("clip text tensor: {err}"))
        })?;
        let tensor = Tensor::from_array(array)?;
        let outputs = self.text.run(ort::inputs![self.text_in.as_str() => tensor])?;
        let (_shape, data) = outputs[self.text_out.as_str()].try_extract_tensor::<f32>()?;
        Ok(normalized(data))
    }

    pub fn query_vector(&mut self, query: &str) -> Result<Vec<f32>, VisionError> {
        let rewritten = rewrite_query(query);
        let mut vectors = vec![self.encode_text(query)?];
        if rewritten != query {
            vectors.push(self.encode_text(&rewritten)?);
        }
        vectors.push(self.encode_text(&format!("a photo of {rewritten}"))?);
        if let Some(concept) = concept_for_term(&rewritten)
            && concept != rewritten
        {
            vectors.push(self.encode_text(&format!("a photo of {concept}"))?);
        }
        average_normalized(&vectors)
    }

    pub fn tags_for(&self, image: &[f32]) -> Vec<ClipTag> {
        if self.bank.is_empty() {
            return Vec::new();
        }
        let mut scored: Vec<(usize, f32)> = self
            .bank
            .iter()
            .enumerate()
            .map(|(index, tag)| (index, cosine(image, &tag.vector)))
            .collect();
        let logits: Vec<f32> = scored
            .iter()
            .map(|(_, score)| score * TAG_TEMPERATURE)
            .collect();
        let probs = softmax(&logits);
        scored.sort_by(|left, right| right.1.partial_cmp(&left.1).unwrap_or(std::cmp::Ordering::Equal));
        let mut tags = Vec::new();
        for (index, score) in scored {
            let prob = probs[index];
            if tags.len() >= 8 && score < 0.24 && prob < 0.035 {
                continue;
            }
            if score < 0.21 && prob < 0.02 {
                continue;
            }
            let item = &self.bank[index];
            tags.push(ClipTag {
                kind: item.kind,
                label: item.label.to_string(),
                score: score.clamp(0.0, 1.0),
            });
            if tags.len() == 24 {
                break;
            }
        }
        tags
    }

    fn tokenize(&self, text: &str) -> Result<Vec<i64>, VisionError> {
        let encoding = self
            .tokenizer
            .encode(text, true)
            .map_err(|err| VisionError::Decode(format!("clip tokenizer: {err}")))?;
        let mut ids: Vec<i64> = encoding.get_ids().iter().map(|id| i64::from(*id)).collect();
        ids.truncate(CONTEXT);
        while ids.len() < CONTEXT {
            ids.push(i64::from(PAD_ID));
        }
        Ok(ids)
    }

    fn build_bank(&mut self) -> Result<Vec<TagVec>, VisionError> {
        let mut bank = Vec::with_capacity(PHOTO_TAGS.len());
        for (kind, label) in PHOTO_TAGS {
            let article = if starts_with_vowel(label) { "an" } else { "a" };
            let prompt = format!("a photo of {article} {label}.");
            let vector = self.encode_text(&prompt)?;
            bank.push(TagVec {
                kind,
                label,
                vector,
            });
        }
        Ok(bank)
    }
}

pub fn rewrite_query(query: &str) -> String {
    query
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(correct_term)
        .collect::<Vec<_>>()
        .join(" ")
}

fn load_tokenizer() -> Result<Tokenizer, VisionError> {
    let path = model_path(TOKENIZER_FILE);
    let mut tokenizer = Tokenizer::from_file(&path).map_err(|err| {
        VisionError::Decode(format!("clip tokenizer {}: {err}", path.display()))
    })?;
    let _ = tokenizer.with_padding(Some(PaddingParams {
        strategy: PaddingStrategy::Fixed(CONTEXT),
        direction: PaddingDirection::Right,
        pad_to_multiple_of: None,
        pad_id: PAD_ID,
        pad_type_id: 0,
        pad_token: "<|endoftext|>".into(),
    }));
    let _ = tokenizer.with_truncation(Some(TruncationParams {
        max_length: CONTEXT,
        stride: 0,
        strategy: tokenizers::TruncationStrategy::LongestFirst,
        direction: TruncationDirection::Right,
    }));
    Ok(tokenizer)
}

fn clip_resize(image: &RgbImage) -> RgbImage {
    let width = image.width().max(1);
    let height = image.height().max(1);
    let scale = 224.0 / width.min(height) as f32;
    let resized_w = ((width as f32) * scale).round().max(224.0) as u32;
    let resized_h = ((height as f32) * scale).round().max(224.0) as u32;
    let resized = image::imageops::resize(image, resized_w, resized_h, FilterType::CatmullRom);
    let x = resized_w.saturating_sub(224) / 2;
    let y = resized_h.saturating_sub(224) / 2;
    image::imageops::crop_imm(&resized, x, y, 224, 224).to_image()
}

fn nchw(image: &RgbImage) -> Array4<f32> {
    let mut tensor = Array4::<f32>::zeros((1, 3, 224, 224));
    for y in 0..224 {
        for x in 0..224 {
            let pixel = image.get_pixel(x, y);
            for channel in 0..3 {
                tensor[[0, channel, y as usize, x as usize]] =
                    (pixel[channel] as f32 / 255.0 - CLIP_MEAN[channel]) / CLIP_STD[channel];
            }
        }
    }
    tensor
}

fn normalized(values: &[f32]) -> Vec<f32> {
    let mut out = values.to_vec();
    let norm = out.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 {
        for value in &mut out {
            *value /= norm;
        }
    }
    out
}

fn average_normalized(vectors: &[Vec<f32>]) -> Result<Vec<f32>, VisionError> {
    let dim = vectors.first().map(Vec::len).unwrap_or(0);
    if dim == 0 {
        return Err(VisionError::Decode("empty clip query".into()));
    }
    let mut acc = vec![0.0; dim];
    for vector in vectors {
        for (slot, value) in acc.iter_mut().zip(vector) {
            *slot += *value;
        }
    }
    Ok(normalized(&acc))
}

pub fn cosine(left: &[f32], right: &[f32]) -> f32 {
    let mut dot = 0.0;
    for (a, b) in left.iter().zip(right) {
        dot += a * b;
    }
    dot
}

fn softmax(logits: &[f32]) -> Vec<f32> {
    let max = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let mut out: Vec<f32> = logits.iter().map(|value| (value - max).exp()).collect();
    let sum: f32 = out.iter().sum();
    if sum > 0.0 {
        for value in &mut out {
            *value /= sum;
        }
    }
    out
}

fn starts_with_vowel(label: &str) -> bool {
    matches!(label.chars().next(), Some('a' | 'e' | 'i' | 'o' | 'u'))
}

fn tensor_name(session: &Session, input: bool, preferred: &[&str]) -> String {
    let names: Vec<String> = if input {
        session.inputs().iter().map(|item| item.name().to_string()).collect()
    } else {
        session.outputs().iter().map(|item| item.name().to_string()).collect()
    };
    for want in preferred {
        if names.iter().any(|name| name == want) {
            return (*want).to_string();
        }
    }
    names
        .into_iter()
        .next()
        .unwrap_or_else(|| if input { "input".into() } else { "output".into() })
}

fn environment() -> Result<&'static ort::environment::Environment, VisionError> {
    static ENV: OnceLock<ort::environment::Environment> = OnceLock::new();
    static LOCK: Mutex<()> = Mutex::new(());
    if let Some(existing) = ENV.get() {
        return Ok(existing);
    }
    let _guard = LOCK.lock().unwrap_or_else(|err| err.into_inner());
    if let Some(existing) = ENV.get() {
        return Ok(existing);
    }
    let built = ort::init().with_name("shelf-clip").build()?;
    let _ = ENV.set(built);
    Ok(ENV.get().expect("clip environment"))
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

fn model_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(dir) = std::env::var("SHELF_MODELS") {
        dirs.push(PathBuf::from(dir));
    }
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models"));
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        for relative in ["models", "resources/models", "../Resources/models", "../resources/models"] {
            dirs.push(dir.join(relative));
        }
    }
    dirs
}

fn model_path(file_name: &str) -> PathBuf {
    model_dirs()
        .into_iter()
        .map(|dir| dir.join(file_name))
        .find(|path| path.is_file())
        .unwrap_or_else(|| writable_models_dir().join(file_name))
}

fn writable_models_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("SHELF_MODELS") {
        let path = PathBuf::from(dir);
        let _ = std::fs::create_dir_all(&path);
        return path;
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models")
}

pub(crate) fn ensure_face_models(
    det: &str,
    det_url: &str,
    rec: &str,
    rec_url: &str,
) -> Result<(), VisionError> {
    ensure_file(det, det_url)?;
    ensure_file(rec, rec_url)?;
    Ok(())
}

fn ensure_file(file_name: &str, url: &str) -> Result<PathBuf, VisionError> {
    let dest = model_path(file_name);
    if dest.is_file() && dest.metadata().map(|meta| meta.len() > 1_000).unwrap_or(false) {
        return Ok(dest);
    }
    let dest = writable_models_dir().join(file_name);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|err| VisionError::Decode(err.to_string()))?;
    }
    eprintln!("shelf index: downloading {file_name}");
    let tmp = dest.with_file_name(format!("{file_name}.part"));
    let response = ureq::get(url)
        .call()
        .map_err(|err| VisionError::Decode(format!("download {file_name}: {err}")))?;
    let mut reader = response.into_reader();
    let mut file = std::fs::File::create(&tmp).map_err(|err| VisionError::Decode(err.to_string()))?;
    std::io::copy(&mut reader, &mut file).map_err(|err| VisionError::Decode(err.to_string()))?;
    std::fs::rename(&tmp, &dest).map_err(|err| VisionError::Decode(err.to_string()))?;
    Ok(dest)
}

const PHOTO_TAGS: &[(&str, &str)] = &[
    ("pet", "dog"),
    ("pet", "puppy"),
    ("pet", "cat"),
    ("pet", "kitten"),
    ("wildlife", "bird"),
    ("wildlife", "eagle"),
    ("wildlife", "horse"),
    ("wildlife", "wildlife"),
    ("wildlife", "deer"),
    ("wildlife", "fox"),
    ("wildlife", "lion"),
    ("wildlife", "tiger"),
    ("wildlife", "bear"),
    ("wildlife", "elephant"),
    ("wildlife", "whale"),
    ("wildlife", "fish"),
    ("object", "person"),
    ("object", "portrait"),
    ("object", "people"),
    ("object", "child"),
    ("object", "crowd"),
    ("scene", "beach"),
    ("scene", "ocean"),
    ("scene", "sea"),
    ("scene", "coast"),
    ("scene", "lake"),
    ("scene", "river"),
    ("scene", "waterfall"),
    ("scene", "water"),
    ("scene", "mountain"),
    ("scene", "forest"),
    ("scene", "jungle"),
    ("scene", "desert"),
    ("scene", "snow"),
    ("scene", "ice"),
    ("scene", "glacier"),
    ("scene", "sky"),
    ("scene", "clouds"),
    ("scene", "sunset"),
    ("scene", "sunrise"),
    ("scene", "night"),
    ("scene", "stars"),
    ("scene", "moon"),
    ("scene", "flower"),
    ("scene", "field"),
    ("scene", "canyon"),
    ("scene", "island"),
    ("scene", "city"),
    ("scene", "street"),
    ("object", "architecture"),
    ("object", "building"),
    ("object", "church"),
    ("object", "bridge"),
    ("object", "house"),
    ("object", "interior"),
    ("object", "car"),
    ("object", "vehicle"),
    ("object", "motorcycle"),
    ("object", "bicycle"),
    ("object", "train"),
    ("object", "airplane"),
    ("object", "boat"),
    ("object", "ship"),
    ("scene", "drone"),
    ("scene", "aerial"),
    ("object", "food"),
    ("object", "coffee"),
    ("object", "wine"),
    ("object", "guitar"),
    ("object", "piano"),
    ("object", "camera"),
    ("object", "wedding"),
    ("object", "concert"),
    ("object", "soccer"),
    ("object", "basketball"),
    ("scene", "surfing"),
    ("scene", "skiing"),
    ("scene", "underwater"),
    ("scene", "macro"),
    ("scene", "landscape"),
    ("object", "lighthouse"),
    ("object", "golden retriever"),
    ("object", "labrador"),
    ("object", "german shepherd"),
    ("object", "border collie"),
    ("pet", "husky"),
    ("wildlife", "owl"),
    ("wildlife", "penguin"),
    ("wildlife", "dolphin"),
    ("wildlife", "kangaroo"),
    ("wildlife", "koala"),
    ("wildlife", "giraffe"),
    ("wildlife", "zebra"),
    ("wildlife", "wolf"),
    ("wildlife", "squirrel"),
    ("wildlife", "rabbit"),
    ("scene", "fog"),
    ("scene", "rain"),
    ("scene", "storm"),
    ("scene", "rainbow"),
    ("scene", "lightning"),
    ("scene", "fireworks"),
    ("scene", "aurora"),
    ("scene", "milky way"),
    ("scene", "golden hour"),
    ("scene", "blue hour"),
    ("scene", "cliff"),
    ("scene", "valley"),
    ("scene", "vineyard"),
    ("scene", "farm"),
    ("scene", "meadow"),
    ("scene", "park"),
    ("scene", "garden"),
    ("scene", "cave"),
    ("scene", "volcano"),
    ("scene", "harbor"),
    ("scene", "pier"),
    ("object", "skyscraper"),
    ("object", "castle"),
    ("object", "temple"),
    ("object", "stadium"),
    ("object", "airport"),
    ("object", "kitchen"),
    ("object", "bedroom"),
    ("object", "office"),
    ("object", "studio"),
    ("object", "product"),
    ("object", "still life"),
    ("object", "jewelry"),
    ("object", "watch"),
    ("object", "phone"),
    ("object", "computer"),
    ("object", "book"),
    ("object", "cake"),
    ("object", "pizza"),
    ("object", "sushi"),
    ("object", "bread"),
    ("object", "fruit"),
    ("object", "wine glass"),
    ("object", "cocktail"),
    ("scene", "birthday"),
    ("scene", "festival"),
    ("scene", "market"),
    ("scene", "cafe"),
    ("scene", "restaurant"),
    ("object", "baby"),
    ("object", "family"),
    ("object", "couple"),
    ("scene", "hiking"),
    ("scene", "camping"),
    ("scene", "fishing"),
    ("scene", "running"),
    ("scene", "swimming"),
    ("scene", "yoga"),
    ("scene", "tennis"),
    ("scene", "golf"),
    ("object", "helicopter"),
    ("object", "truck"),
    ("object", "bus"),
    ("object", "scooter"),
    ("scene", "bokeh"),
    ("scene", "black and white"),
    ("scene", "silhouette"),
    ("scene", "reflection"),
    ("scene", "long exposure"),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizer_matches_clip_special_tokens() {
        ensure_file(TOKENIZER_FILE, TOKENIZER_URL).unwrap();
        let tok = load_tokenizer().unwrap();
        let ids = tok.encode("a photo of a dog", true).unwrap();
        assert_eq!(ids.get_ids()[0], 49406);
        assert!(ids.get_ids().contains(&1929));
    }
}
