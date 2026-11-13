//! Serves local files to the webview without the asset-protocol scope.
//!
//! `convertFileSrc(path, "shelf")` becomes `shelf://localhost/<urlencoded path>`
//! on Linux/macOS and `http://shelf.localhost/<urlencoded path>` on Windows.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tauri::http::{header, Request, Response, StatusCode, response::Builder};

pub fn handle(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == "OPTIONS" {
        return cors(Response::builder().status(StatusCode::NO_CONTENT))
            .body(Vec::new())
            .unwrap_or_else(|_| empty(StatusCode::NO_CONTENT));
    }
    let Some(path) = path_from_request(&request) else {
        return empty(StatusCode::BAD_REQUEST);
    };
    if !path.is_file() {
        eprintln!("shelf media: missing {}", path.display());
        return empty(StatusCode::NOT_FOUND);
    }
    match serve(&path, &request) {
        Ok(response) => response,
        Err(error) => {
            eprintln!("shelf media: {} ({error})", path.display());
            empty(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

fn path_from_request(request: &Request<Vec<u8>>) -> Option<PathBuf> {
    let raw = request.uri().path();
    let trimmed = raw.strip_prefix('/').unwrap_or(raw);
    let decoded = percent_decode(trimmed);
    if decoded.is_empty() {
        return None;
    }
    Some(PathBuf::from(decoded))
}

fn serve(path: &Path, request: &Request<Vec<u8>>) -> std::io::Result<Response<Vec<u8>>> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let mime = mime_of(path);
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_range);
    if let Some((start, end)) = range {
        let end = end.unwrap_or(len.saturating_sub(1)).min(len.saturating_sub(1));
        if start > end {
            return Ok(cors(Response::builder().status(StatusCode::RANGE_NOT_SATISFIABLE))
                .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                .body(Vec::new())
                .unwrap_or_else(|_| empty(StatusCode::RANGE_NOT_SATISFIABLE)));
        }
        let take = (end - start + 1) as usize;
        file.seek(SeekFrom::Start(start))?;
        let mut body = vec![0_u8; take];
        file.read_exact(&mut body)?;
        return Ok(cors(Response::builder().status(StatusCode::PARTIAL_CONTENT))
            .header(header::CONTENT_TYPE, mime)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
            .header(header::CONTENT_LENGTH, take.to_string())
            .body(body)
            .unwrap_or_else(|_| empty(StatusCode::PARTIAL_CONTENT)));
    }
    let mut body = Vec::new();
    file.read_to_end(&mut body)?;
    Ok(cors(Response::builder().status(StatusCode::OK))
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, body.len().to_string())
        .body(body)
        .unwrap_or_else(|_| empty(StatusCode::OK)))
}

fn parse_range(header: &str) -> Option<(u64, Option<u64>)> {
    let spec = header.strip_prefix("bytes=")?;
    let first = spec.split(',').next()?.trim();
    let (start, end) = first.split_once('-')?;
    let start = start.parse().ok()?;
    let end = if end.is_empty() { None } else { Some(end.parse().ok()?) };
    Some((start, end))
}

fn mime_of(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    }
}

fn cors(builder: Builder) -> Builder {
    builder
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "*")
}

fn empty(status: StatusCode) -> Response<Vec<u8>> {
    cors(Response::builder().status(status))
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (from_hex(bytes[index + 1]), from_hex(bytes[index + 2])) {
                out.push((hi << 4) | lo);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn from_hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_a_linux_path() {
        let decoded = percent_decode("%2Fhome%2Fbryce%2Fclip.mp4");
        assert_eq!(decoded, "/home/bryce/clip.mp4");
    }
}
