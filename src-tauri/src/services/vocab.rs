//! Photographer-facing words on top of ImageNet classes.
//!
//! ResNet-50 still outputs 1000 class probabilities. This module maps those
//! into more tags, everyday synonyms, and a query vector that tolerates typos.

use std::sync::OnceLock;

pub const CONCEPTS: [&str; 27] = [
    "dog",
    "cat",
    "bird",
    "wildlife",
    "horse",
    "beach",
    "water",
    "boat",
    "lighthouse",
    "vehicle",
    "architecture",
    "sunset",
    "drone",
    "person",
    "flower",
    "food",
    "mountain",
    "forest",
    "snow",
    "sky",
    "airplane",
    "motorcycle",
    "bicycle",
    "train",
    "sports",
    "music",
    "night",
];

const STOP: [&str; 16] = [
    "the", "and", "for", "with", "from", "built", "two", "one", "red", "great", "common", "white", "black",
    "yellow", "blue", "golden",
];

pub fn concept_index(label: &str) -> Option<usize> {
    CONCEPTS.iter().position(|concept| *concept == label)
}

pub fn kind_for_concept(concept: &str) -> &'static str {
    match concept {
        "dog" | "cat" => "pet",
        "bird" | "wildlife" | "horse" => "wildlife",
        "beach" | "water" | "sunset" | "drone" | "mountain" | "forest" | "snow" | "sky" | "night" => "scene",
        "person" => "object",
        _ => "object",
    }
}

pub fn concepts_for_class(index: usize) -> &'static [&'static str] {
    if (151..=268).contains(&index) {
        return &["dog"];
    }
    if (281..=285).contains(&index) {
        return &["cat"];
    }
    if (80..=100).contains(&index) || index == 145 || index == 146 {
        return &["bird"];
    }
    if (269..=280).contains(&index) || (286..=297).contains(&index) || index == 340 || (342..=355).contains(&index) {
        return &["wildlife"];
    }
    if index == 339 {
        return &["horse"];
    }
    match index {
        460 | 972 | 973 | 975 | 976 | 977 | 978 => &["beach", "water"],
        525 | 562 | 974 => &["water"],
        536 | 718 => &["water", "boat"],
        437 => &["lighthouse"],
        449 => &["boat", "architecture"],
        472 | 484 | 554 | 576 | 625 | 694 | 780 | 814 | 871 | 913 | 914 => &["boat"],
        425 | 483 | 497 | 538 | 663 | 668 | 698 | 708 | 821 | 832 | 839 | 888 | 900 => &["architecture"],
        407 | 436 | 468 | 511 | 555 | 565 | 609 | 656 | 717 | 751 | 757 | 817 => &["vehicle"],
        403 | 404 | 405 | 895 => &["airplane"],
        665 | 670 => &["motorcycle", "vehicle"],
        444 | 671 | 870 | 880 => &["bicycle"],
        466 | 547 | 705 | 829 => &["train"],
        984 | 985 | 986 | 987 | 988 => &["flower"],
        924..=969 => &["food"],
        970 | 979 | 980 => &["mountain"],
        990 => &["forest"],
        795 | 802 | 803 | 289 => &["snow"],
        429 | 430 | 768 | 805 | 852 => &["sports"],
        402 | 420 | 486 | 546 | 579 | 541 | 594 | 687 | 819 => &["music"],
        981 | 982 | 983 => &["person"],
        _ => &[],
    }
}

pub fn class_is_concept(index: usize, concept: &str) -> bool {
    concepts_for_class(index).contains(&concept)
        || match concept {
            "dog" => (151..=268).contains(&index),
            "cat" => (281..=285).contains(&index),
            "bird" => (80..=100).contains(&index) || index == 145 || index == 146,
            "wildlife" => {
                (269..=280).contains(&index)
                    || (286..=297).contains(&index)
                    || index == 340
                    || (342..=355).contains(&index)
            }
            "horse" => index == 339,
            "food" => (924..=969).contains(&index),
            "flower" => (984..=988).contains(&index),
            _ => false,
        }
}

pub fn aliases_for_label(label: &str) -> &'static [&'static str] {
    match label {
        "dog" => &["dogs", "puppy", "puppies", "canine", "hound"],
        "cat" => &["cats", "kitten", "kittens", "tabby", "feline"],
        "bird" => &["birds", "avian"],
        "wildlife" => &["animal", "animals", "fauna", "wild"],
        "horse" => &["horses", "equine", "pony"],
        "beach" => &["beaches", "seashore", "shore", "coast", "sand", "seaside"],
        "water" => &["ocean", "sea", "lake", "river", "waters"],
        "boat" => &["boats", "ship", "ships", "sailboat", "speedboat", "yacht", "kayak"],
        "lighthouse" => &["lighthouses", "beacon"],
        "vehicle" => &["car", "cars", "auto", "automobile"],
        "architecture" => &["building", "buildings", "church", "castle"],
        "sunset" => &["sunsets", "sunrise", "golden hour", "dusk"],
        "drone" => &["drones", "aerial", "aerials"],
        "person" => &["people", "portrait", "portraits", "face", "faces"],
        "flower" => &["flowers", "bloom", "floral"],
        "food" => &["meal", "dinner", "lunch", "restaurant"],
        "mountain" => &["mountains", "alp", "alps", "peak", "peaks", "hill"],
        "forest" => &["woods", "trees", "tree", "jungle"],
        "snow" => &["snowy", "winter", "ski", "skiing"],
        "sky" => &["clouds", "cloud", "blue sky"],
        "airplane" => &["plane", "planes", "aircraft", "jet", "airport"],
        "motorcycle" => &["motorbike", "moto", "scooter"],
        "bicycle" => &["bike", "bikes", "cycling"],
        "train" => &["trains", "railway", "railroad"],
        "sports" => &["sport", "game", "soccer", "football", "basketball", "baseball"],
        "music" => &["concert", "guitar", "piano", "band", "stage"],
        "night" => &["nighttime", "evening", "dark"],
        "seashore" => &["beach", "coast", "shore", "ocean"],
        "lakeside" => &["lake", "water"],
        "sandbar" => &["beach", "sand"],
        "promontory" => &["coast", "cliff"],
        "sports car" => &["car", "vehicle"],
        "beacon" => &["lighthouse"],
        "golden retriever" => &["retriever", "dog"],
        "labrador retriever" => &["retriever", "labrador", "lab", "dog"],
        "german shepherd" => &["shepherd", "dog"],
        "tabby" => &["cat"],
        "lion" => &["wildlife", "cat"],
        "tiger" => &["wildlife", "cat"],
        "airliner" => &["airplane", "plane", "jet"],
        "mountain bike" => &["bicycle", "bike"],
        _ => &[],
    }
}

pub fn extra_words_from_class_name(name: &str) -> Vec<String> {
    let lower = name.to_ascii_lowercase();
    let mut words = Vec::new();
    for word in lower.split(|character: char| !character.is_ascii_alphanumeric()) {
        if word.len() < 4 || STOP.contains(&word) {
            continue;
        }
        if !words.iter().any(|existing| existing == word) {
            words.push(word.to_string());
        }
    }
    words
}

pub fn query_embedding(query: &str) -> Vec<f32> {
    let mut embedding = vec![0.0; crate::models::VISUAL_EMBEDDING_FLOATS];
    let intent = resolve_query(query);
    for index in intent.class_indices {
        if index < crate::models::IMAGENET_DIM {
            embedding[index] = 1.0;
        }
    }
    for concept in intent.concepts {
        for index in 0..crate::models::IMAGENET_DIM {
            if class_is_concept(index, concept) {
                embedding[index] = (embedding[index] as f32).max(1.0);
            }
        }
        if let Some(slot) = concept_index(concept) {
            let dest = crate::models::IMAGENET_DIM + slot;
            if dest < embedding.len() {
                embedding[dest] = 1.0;
            }
        }
    }
    embedding
}

pub struct QueryIntent {
    pub concepts: Vec<&'static str>,
    pub class_indices: Vec<usize>,
    pub corrected: Vec<String>,
}

pub fn resolve_query(query: &str) -> QueryIntent {
    let terms = query_terms(query);
    let corrected: Vec<String> = terms.iter().map(|term| correct_term(term)).collect();
    let mut concepts = Vec::new();
    let mut class_indices = Vec::new();

    let mut phrases = corrected.clone();
    for window in corrected.windows(2) {
        phrases.push(format!("{} {}", window[0], window[1]));
    }
    if corrected.len() >= 3 {
        phrases.push(corrected.join(" "));
    }

    for phrase in &phrases {
        if let Some(concept) = concept_for_term(phrase) {
            if !concepts.contains(&concept) {
                concepts.push(concept);
            }
        }
        for (index, name) in imagenet_names().iter().enumerate() {
            let lower = name.to_ascii_lowercase();
            if lower == *phrase || (phrase.len() >= 4 && lower.contains(phrase.as_str())) {
                if !class_indices.contains(&index) {
                    class_indices.push(index);
                }
                for concept in concepts_for_class(index) {
                    if !concepts.contains(concept) {
                        concepts.push(*concept);
                    }
                }
            }
        }
    }

    QueryIntent {
        concepts,
        class_indices,
        corrected,
    }
}

pub fn concept_for_term(word: &str) -> Option<&'static str> {
    let key = word.trim().to_ascii_lowercase();
    if let Some(direct) = CONCEPTS.iter().copied().find(|concept| *concept == key) {
        return Some(direct);
    }
    for concept in CONCEPTS {
        if aliases_for_label(concept).iter().any(|alias| *alias == key) {
            return Some(concept);
        }
    }
    match key.as_str() {
        "dogs" | "puppy" | "puppies" | "canine" | "hound" => Some("dog"),
        "cats" | "kitten" | "kittens" | "tabby" | "feline" => Some("cat"),
        "birds" => Some("bird"),
        "animals" | "animal" | "fauna" | "wild" => Some("wildlife"),
        "horses" | "pony" => Some("horse"),
        "beaches" | "seashore" | "shore" | "sand" | "coast" | "seaside" => Some("beach"),
        "ocean" | "sea" | "lake" | "river" | "waters" => Some("water"),
        "boats" | "ship" | "ships" | "sailboat" | "speedboat" | "yacht" => Some("boat"),
        "lighthouses" | "beacon" => Some("lighthouse"),
        "car" | "cars" | "auto" => Some("vehicle"),
        "building" | "buildings" => Some("architecture"),
        "sunsets" | "sunrise" | "dusk" => Some("sunset"),
        "drones" | "aerial" | "aerials" => Some("drone"),
        "people" | "portrait" | "portraits" | "face" | "faces" => Some("person"),
        "flowers" | "floral" | "bloom" => Some("flower"),
        "meal" | "dinner" => Some("food"),
        "mountains" | "alp" | "alps" | "peak" => Some("mountain"),
        "woods" | "trees" | "jungle" => Some("forest"),
        "snowy" | "winter" | "ski" | "skiing" => Some("snow"),
        "clouds" | "cloud" => Some("sky"),
        "plane" | "planes" | "aircraft" | "jet" => Some("airplane"),
        "motorbike" | "scooter" => Some("motorcycle"),
        "bike" | "bikes" | "cycling" => Some("bicycle"),
        "trains" | "railway" => Some("train"),
        "sport" | "soccer" | "football" | "basketball" => Some("sports"),
        "concert" | "guitar" | "piano" => Some("music"),
        "nighttime" | "evening" => Some("night"),
        _ => None,
    }
}

pub fn query_terms(query: &str) -> Vec<String> {
    query
        .split(|character: char| !character.is_ascii_alphanumeric())
        .map(|word| word.to_ascii_lowercase())
        .filter(|word| word.len() >= 2)
        .collect()
}

pub fn correct_term(term: &str) -> String {
    let lower = term.to_ascii_lowercase();
    if vocabulary().iter().any(|word| word == &lower) {
        return lower;
    }
    let budget = max_edits(&lower);
    if budget == 0 {
        return lower;
    }
    let mut best: Option<(String, usize)> = None;
    let start = lower.chars().next();
    for candidate in vocabulary() {
        if candidate.len().abs_diff(lower.len()) > budget {
            continue;
        }
        if start.is_some() && candidate.chars().next() != start {
            continue;
        }
        let distance = levenshtein(&lower, candidate);
        if distance == 0 {
            return candidate.clone();
        }
        if distance <= budget && best.as_ref().is_none_or(|(_, current)| distance < *current) {
            best = Some((candidate.clone(), distance));
        }
    }
    best.map(|(word, _)| word).unwrap_or(lower)
}

fn max_edits(word: &str) -> usize {
    match word.len() {
        0..=3 => 0,
        4..=6 => 1,
        _ => 2,
    }
}

pub fn levenshtein(left: &str, right: &str) -> usize {
    let a: Vec<char> = left.chars().collect();
    let b: Vec<char> = right.chars().collect();
    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut next = vec![0; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        next[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != cb);
            next[j + 1] = (prev[j + 1] + 1).min(next[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut next);
    }
    prev[b.len()]
}

fn vocabulary() -> &'static Vec<String> {
    static WORDS: OnceLock<Vec<String>> = OnceLock::new();
    WORDS.get_or_init(|| {
        let mut words = Vec::new();
        let mut push = |value: &str| {
            let lower = value.to_ascii_lowercase();
            if lower.len() >= 2 && !words.iter().any(|existing| existing == &lower) {
                words.push(lower);
            }
        };
        for concept in CONCEPTS {
            push(concept);
            for alias in aliases_for_label(concept) {
                push(alias);
            }
        }
        for name in imagenet_names() {
            push(name);
            for word in extra_words_from_class_name(name) {
                push(&word);
            }
        }
        words
    })
}

pub fn imagenet_name(index: usize) -> Option<&'static str> {
    imagenet_names().get(index).copied()
}

fn imagenet_names() -> &'static [&'static str] {
    static CLASSES: OnceLock<Vec<&str>> = OnceLock::new();
    CLASSES
        .get_or_init(|| include_str!("imagenet_classes.txt").lines().collect())
        .as_slice()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spelling_fixes_beach_and_retriever() {
        assert_eq!(correct_term("beech"), "beach");
        assert_eq!(correct_term("retriver"), "retriever");
        assert_eq!(correct_term("dog"), "dog");
        assert_eq!(correct_term("car"), "car");
    }

    #[test]
    fn query_maps_typo_to_beach_concept() {
        let intent = resolve_query("beech");
        assert!(intent.concepts.contains(&"beach"), "{:?}", intent.concepts);
        let embedding = query_embedding("beech");
        let slot = crate::models::IMAGENET_DIM + concept_index("beach").unwrap();
        assert!(embedding[slot] > 0.5);
    }

    #[test]
    fn query_maps_golden_retriever_to_a_dog_class() {
        let intent = resolve_query("goden retriver");
        assert!(intent.concepts.contains(&"dog"), "{:?}", intent.concepts);
        assert!(!intent.class_indices.is_empty(), "{:?}", intent.corrected);
    }
}
