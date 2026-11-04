import { captureMillis, coordinatesFor, fakeHash, histogram, normalizeCapture } from "./catalog";
import type { MediaFormat, StudioItem } from "./types";

const RAW = new Set(["raw", "cr2", "cr3", "nef", "arw", "dng", "orf", "rw2", "raf", "pef", "srw"]);
const VIDEO = new Set(["mp4", "mov", "m4v", "mkv", "avi", "webm"]);
const STILL = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif", "avif"]);

export async function itemsFromFiles(files: File[]): Promise<StudioItem[]> {
  const items: StudioItem[] = [];
  for (const file of files) {
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
      ...coordinatesFor(folder, id),
    });
    await yieldToUi();
  }
  return items;
}

async function readFileMeta(
  file: File,
  format: MediaFormat,
): Promise<{ capturedAt: string | null; camera: string | null; previewUrl: string | null; inspectUrl: string | null }> {
  if (format === "video") {
    return { capturedAt: null, camera: null, previewUrl: null, inspectUrl: null };
  }
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 32 * 1024 * 1024)).arrayBuffer());
  const capturedAt = findCapture(bytes);
  const camera = findCamera(bytes);
  if (format === "jpg" && STILL.has(extensionOf(file.name))) {
    const inspectUrl = URL.createObjectURL(file);
    const previewUrl = await downscale(file);
    return { capturedAt, camera, previewUrl: previewUrl ?? inspectUrl, inspectUrl };
  }
  const embedded = largestJpeg(bytes);
  if (!embedded) return { capturedAt, camera, previewUrl: null, inspectUrl: null };
  const copy = embedded.slice();
  const blob = new Blob([copy.buffer], { type: "image/jpeg" });
  const inspectUrl = URL.createObjectURL(blob);
  const previewUrl = (await downscale(blob)) ?? inspectUrl;
  return { capturedAt, camera, previewUrl, inspectUrl };
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
