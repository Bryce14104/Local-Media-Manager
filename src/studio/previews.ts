import { captureMillis, coordinatesFor, fakeHash, histogram, normalizeCapture } from "./catalog";
import type { MediaFormat, StudioItem } from "./types";

const RAW = new Set(["raw", "cr2", "cr3", "nef", "arw", "dng", "orf", "rw2", "raf", "pef", "srw"]);
const VIDEO = new Set(["mp4", "mov", "m4v", "mkv", "avi", "webm"]);
const STILL = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif", "avif"]);

export async function itemsFromFiles(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<StudioItem[]> {
  const items: StudioItem[] = [];
  onProgress?.(0, files.length);
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const relative = file.webkitRelativePath || file.name;
    const parts = relative.split(/[/\\]/).filter(Boolean);
    const fileName = parts.pop() ?? file.name;
    const format = formatForName(fileName);
    if (!format) continue;
    const folder = parts.join("/") || "Inbox";
    const id = `import-${relative}-${file.size}-${file.lastModified}`;
    const meta = await readFileMeta(file, format);
    items.push({
      id,
      fileName,
      folder,
      capturedAt: meta.capturedAt ?? new Date(file.lastModified || Date.now()).toISOString().slice(0, 19),
      camera: meta.camera ?? "Unknown camera",
      lens: "Unknown lens",
      rating: null,
      flag: "unflagged",
      format,
      fileSize: file.size,
      iso: null,
      shutter: null,
      aperture: null,
      focalLength: null,
      width: null,
      height: null,
      hash: fakeHash(id),
      histogram: histogram(id),
      previewUrl: meta.previewUrl,
      inspectUrl: meta.inspectUrl,
      sourcePath: null,
      ...(meta.gps
        ? { latitude: meta.gps.latitude, longitude: meta.gps.longitude, geotagged: true }
        : { ...coordinatesFor(folder, id), geotagged: false }),
    });
    onProgress?.(index + 1, files.length);
    await yieldToUi();
  }
  return items;
}

async function readFileMeta(
  file: File,
  format: MediaFormat,
): Promise<{
  capturedAt: string | null;
  camera: string | null;
  previewUrl: string | null;
  inspectUrl: string | null;
  gps: { latitude: number; longitude: number } | null;
}> {
  if (format === "video") {
    return { capturedAt: null, camera: null, previewUrl: null, inspectUrl: null, gps: null };
  }
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 32 * 1024 * 1024)).arrayBuffer());
  const capturedAt = findCapture(bytes);
  const camera = findCamera(bytes);
  const gps = readGps(bytes);
  if (format === "jpg" && STILL.has(extensionOf(file.name))) {
    const inspectUrl = URL.createObjectURL(file);
    const previewUrl = await downscale(file);
    return { capturedAt, camera, previewUrl: previewUrl ?? inspectUrl, inspectUrl, gps };
  }
  const embedded = largestJpeg(bytes);
  if (!embedded) return { capturedAt, camera, previewUrl: null, inspectUrl: null, gps };
  const copy = embedded.slice();
  const blob = new Blob([copy.buffer], { type: "image/jpeg" });
  const inspectUrl = URL.createObjectURL(blob);
  const previewUrl = (await downscale(blob)) ?? inspectUrl;
  return { capturedAt, camera, previewUrl, inspectUrl, gps: gps ?? readGps(embedded) };
}

export function readGps(bytes: Uint8Array): { latitude: number; longitude: number } | null {
  return readExifGps(bytes) ?? readXmpGps(bytes);
}

function readExifGps(bytes: Uint8Array): { latitude: number; longitude: number } | null {
  const marker = findBytes(bytes, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  if (marker >= 0) return readTiffGps(bytes, marker + 6);
  if (bytes[0] === 0x49 || bytes[0] === 0x4d) return readTiffGps(bytes, 0);
  return null;
}

function readTiffGps(bytes: Uint8Array, start: number): { latitude: number; longitude: number } | null {
  if (start + 8 > bytes.length) return null;
  const little = bytes[start] === 0x49;
  const u16 = (offset: number) => {
    if (offset + 2 > bytes.length) return 0;
    return little ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
  };
  const u32 = (offset: number) => {
    if (offset + 4 > bytes.length) return 0;
    const value = little
      ? bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)
      : (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    return value >>> 0;
  };
  if (u16(start + 2) !== 42) return null;
  const ifd = start + u32(start + 4);
  const pointer = ifdValue(bytes, ifd, 0x8825, little, u16, u32);
  if (pointer == null) return null;
  const gps = start + pointer;
  const latitude = readAxis(bytes, gps, 0x0001, 0x0002, "S", little, start, u16, u32);
  const longitude = readAxis(bytes, gps, 0x0003, 0x0004, "W", little, start, u16, u32);
  if (latitude == null || longitude == null) return null;
  return { latitude, longitude };
}

function readAxis(
  bytes: Uint8Array,
  ifd: number,
  refTag: number,
  valueTag: number,
  negative: string,
  little: boolean,
  tiffStart: number,
  u16: (offset: number) => number,
  u32: (offset: number) => number,
): number | null {
  const parts = readRationals(bytes, ifd, valueTag, little, tiffStart, u16, u32);
  if (!parts) return null;
  const [degrees, minutes, seconds] = parts;
  const decimal = Math.abs(degrees) + minutes / 60 + seconds / 3600;
  const ref = readAscii(bytes, ifd, refTag, little, tiffStart, u16, u32);
  const marker = ref?.trim().charAt(0).toUpperCase();
  const signed = marker === negative || degrees < 0 ? -decimal : decimal;
  return signed >= -180 && signed <= 180 ? signed : null;
}

function readRationals(
  bytes: Uint8Array,
  ifd: number,
  tag: number,
  _little: boolean,
  tiffStart: number,
  u16: (offset: number) => number,
  u32: (offset: number) => number,
): [number, number, number] | null {
  const field = findIfdTag(bytes, ifd, tag, u16, u32);
  if (!field || field.type !== 5 || field.count < 1) return null;
  const offset = field.count * 8 <= 4 ? field.entry + 8 : tiffStart + field.value;
  const read = (index: number) => {
    const at = offset + index * 8;
    const denominator = u32(at + 4);
    return denominator === 0 ? 0 : u32(at) / denominator;
  };
  return [read(0), field.count > 1 ? read(1) : 0, field.count > 2 ? read(2) : 0];
}

function readAscii(
  bytes: Uint8Array,
  ifd: number,
  tag: number,
  _little: boolean,
  tiffStart: number,
  u16: (offset: number) => number,
  u32: (offset: number) => number,
): string | null {
  const field = findIfdTag(bytes, ifd, tag, u16, u32);
  if (!field || field.type !== 2 || field.count < 1) return null;
  const offset = field.count <= 4 ? field.entry + 8 : tiffStart + field.value;
  let text = "";
  for (let index = 0; index < field.count && offset + index < bytes.length; index += 1) {
    const byte = bytes[offset + index];
    if (byte === 0) break;
    text += String.fromCharCode(byte);
  }
  return text;
}

function ifdValue(
  bytes: Uint8Array,
  ifd: number,
  tag: number,
  _little: boolean,
  u16: (offset: number) => number,
  u32: (offset: number) => number,
): number | null {
  const field = findIfdTag(bytes, ifd, tag, u16, u32);
  if (!field) return null;
  return field.value;
}

function findIfdTag(
  bytes: Uint8Array,
  ifd: number,
  tag: number,
  u16: (offset: number) => number,
  u32: (offset: number) => number,
): { type: number; count: number; value: number; entry: number } | null {
  if (ifd + 2 > bytes.length) return null;
  const count = u16(ifd);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > bytes.length) return null;
    if (u16(entry) !== tag) continue;
    return { type: u16(entry + 2), count: u32(entry + 4), value: u32(entry + 8), entry };
  }
  return null;
}

function readXmpGps(bytes: Uint8Array): { latitude: number; longitude: number } | null {
  const text = new TextDecoder("latin1").decode(bytes);
  const latitude = xmpAxis(text, "GPSLatitude", "S");
  const longitude = xmpAxis(text, "GPSLongitude", "W");
  if (latitude == null || longitude == null) return null;
  return { latitude, longitude };
}

function xmpAxis(text: string, name: string, negative: string): number | null {
  const match = new RegExp(`exif:${name}="([^"]+)"|exif:${name}>([^<]+)`).exec(text);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return null;
  return parseAxis(raw, negative);
}

function parseAxis(raw: string, negative: string): number | null {
  const marked = raw.toUpperCase().includes(negative);
  const numbers = raw.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (numbers.length === 0 || numbers.some((value) => !Number.isFinite(value))) return null;
  const [degrees, minutes = 0, seconds = 0] = numbers;
  const decimal = Math.abs(degrees) + minutes / 60 + seconds / 3600;
  const signed = marked || degrees < 0 ? -decimal : decimal;
  return signed >= -180 && signed <= 180 ? signed : null;
}

function findBytes(bytes: Uint8Array, needle: number[]): number {
  for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    let found = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) {
        found = false;
        break;
      }
    }
    if (found) return index;
  }
  return -1;
}

function findCapture(bytes: Uint8Array): string | null {
  const text = new TextDecoder("latin1").decode(bytes);
  const patterns = [
    /exif:DateTimeOriginal="([^"]+)"/,
    /xmp:CreateDate="([^"]+)"/,
    /photoshop:DateCreated="([^"]+)"/,
    /(\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2})/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const normalized = normalizeCapture(match[1]);
    if (captureMillis(normalized) !== Number.NEGATIVE_INFINITY) return normalized;
  }
  return null;
}

function findCamera(bytes: Uint8Array): string | null {
  const text = new TextDecoder("latin1").decode(bytes);
  const make = /tiff:Make="([^"]+)"|exif:Make="([^"]+)"/.exec(text);
  const model = /tiff:Model="([^"]+)"|exif:Model="([^"]+)"/.exec(text);
  const parts = [make?.[1] ?? make?.[2], model?.[1] ?? model?.[2]].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

function largestJpeg(bytes: Uint8Array): Uint8Array | null {
  let best: Uint8Array | null = null;
  for (let index = 0; index < bytes.length - 1; index += 1) {
    if (bytes[index] !== 0xff || bytes[index + 1] !== 0xd8) continue;
    for (let end = index + 2; end < bytes.length - 1; end += 1) {
      if (bytes[end] === 0xff && bytes[end + 1] === 0xd9) {
        const slice = bytes.slice(index, end + 2);
        if (slice.length >= 2048 && (!best || slice.length > best.length)) best = slice;
        index = end + 1;
        break;
      }
    }
  }
  return best;
}

async function downscale(source: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(source, { resizeWidth: 480, resizeQuality: "low" });
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return null;
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function formatForName(name: string): MediaFormat | null {
  const extension = extensionOf(name);
  if (RAW.has(extension)) return "raw";
  if (VIDEO.has(extension)) return "video";
  if (STILL.has(extension)) return "jpg";
  return null;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}
