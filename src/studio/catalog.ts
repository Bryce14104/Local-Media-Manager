import type { FlagStatus, MediaFormat, StudioItem } from "./types";

type Seed = [
  fileName: string,
  format: MediaFormat,
  capturedAt: string,
  camera: string,
  lens: string,
  rating: number | null,
  flag: FlagStatus,
  fileSize: number,
  iso: number | null,
  shutter: string | null,
  aperture: string | null,
  focalLength: string | null,
  width: number | null,
  height: number | null,
  folder: string,
];

const SEED: Seed[] = [
  ["A7_04112.ARW", "raw", "2026-03-12T07:14:00", "Sony A7 IV", "FE 35mm F1.4 GM", 5, "pick", 48211328, 200, "1/250", "f/2.0", "35mm", 7008, 4672, "Archive/2026/Iceland"],
  ["A7_04118.ARW", "raw", "2026-03-12T07:22:00", "Sony A7 IV", "FE 35mm F1.4 GM", 4, "pick", 51022848, 250, "1/320", "f/2.8", "35mm", 7008, 4672, "Archive/2026/Iceland"],
  ["A7_04140.JPG", "jpg", "2026-03-12T09:05:00", "Sony A7 IV", "FE 35mm F1.4 GM", 3, "unflagged", 8401122, 100, "1/800", "f/5.6", "35mm", 7008, 4672, "Archive/2026/Iceland"],
  ["A7_04188.JPG", "jpg", "2026-03-12T16:41:00", "Sony A7 IV", "FE 85mm F1.8", 5, "pick", 6120044, 640, "1/200", "f/1.8", "85mm", 7008, 4672, "Archive/2026/Iceland"],
  ["XT5_2201.RAF", "raw", "2026-03-02T11:18:00", "Fujifilm X-T5", "XF 23mm F1.4 R LM WR", 4, "unflagged", 62884112, 160, "1/500", "f/2.8", "23mm", 7728, 5152, "Archive/2026/Lisbon"],
  ["XT5_2208.RAF", "raw", "2026-03-02T11:26:00", "Fujifilm X-T5", "XF 23mm F1.4 R LM WR", 2, "reject", 60112880, 320, "1/125", "f/4.0", "23mm", 7728, 5152, "Archive/2026/Lisbon"],
  ["XT5_2288.JPG", "jpg", "2026-03-02T18:02:00", "Fujifilm X-T5", "XF 56mm F1.2 R WR", 5, "pick", 9904412, 800, "1/160", "f/1.2", "56mm", 7728, 5152, "Archive/2026/Lisbon"],
  ["Z8_1180.NEF", "raw", "2026-01-19T08:44:00", "Nikon Z8", "NIKKOR Z 24-70mm f/2.8 S", 4, "pick", 55400210, 64, "1/1000", "f/4.0", "35mm", 8256, 5504, "Archive/2026/Kyoto"],
  ["Z8_1194.NEF", "raw", "2026-01-19T09:12:00", "Nikon Z8", "NIKKOR Z 24-70mm f/2.8 S", 3, "unflagged", 57220018, 100, "1/640", "f/2.8", "50mm", 8256, 5504, "Archive/2026/Kyoto"],
  ["Z8_1210.JPG", "jpg", "2026-01-19T15:33:00", "Nikon Z8", "NIKKOR Z 85mm f/1.2 S", 5, "pick", 11028441, 400, "1/250", "f/1.2", "85mm", 8256, 5504, "Archive/2026/Kyoto"],
  ["Z8_1302.MOV", "video", "2026-01-20T10:05:00", "Nikon Z8", "NIKKOR Z 24-70mm f/2.8 S", null, "unflagged", 840112640, null, null, null, "24mm", 7680, 4320, "Archive/2026/Kyoto"],
  ["R5_0881.CR3", "raw", "2025-12-04T13:20:00", "Canon R5", "RF 28-70mm F2 L", 4, "unflagged", 48200112, 125, "1/400", "f/2.8", "40mm", 8192, 5464, "Archive/2025/Atacama"],
  ["R5_0890.CR3", "raw", "2025-12-04T13:28:00", "Canon R5", "RF 28-70mm F2 L", 2, "reject", 47088210, 200, "1/200", "f/4.0", "28mm", 8192, 5464, "Archive/2025/Atacama"],
  ["R5_0904.JPG", "jpg", "2025-12-04T19:47:00", "Canon R5", "RF 85mm F1.2 L", 5, "pick", 7344102, 1600, "1/125", "f/1.2", "85mm", 8192, 5464, "Archive/2025/Atacama"],
  ["R5_0944.MP4", "video", "2025-12-05T06:12:00", "Canon R5", "RF 15-35mm F2.8 L", 3, "unflagged", 1204488122, null, null, null, "16mm", 8192, 4320, "Archive/2025/Atacama"],
  ["Q3_0144.DNG", "raw", "2025-10-18T17:06:00", "Leica Q3", "Summilux 28mm f/1.7", 5, "pick", 81200440, 100, "1/500", "f/2.8", "28mm", 9520, 6336, "Archive/2025/Oslo"],
  ["Q3_0152.DNG", "raw", "2025-10-18T17:11:00", "Leica Q3", "Summilux 28mm f/1.7", 4, "unflagged", 79882110, 125, "1/250", "f/1.7", "28mm", 9520, 6336, "Archive/2025/Oslo"],
  ["Q3_0160.JPG", "jpg", "2025-10-18T21:40:00", "Leica Q3", "Summilux 28mm f/1.7", 3, "unflagged", 5402288, 800, "1/60", "f/1.7", "28mm", 9520, 6336, "Archive/2025/Oslo"],
  ["A7_05002.ARW", "raw", "2026-06-08T05:48:00", "Sony A7 IV", "FE 20mm F1.8 G", 5, "pick", 46882004, 3200, "8s", "f/2.0", "20mm", 7008, 4672, "Archive/2026/Namibia"],
  ["A7_05018.ARW", "raw", "2026-06-08T06:16:00", "Sony A7 IV", "FE 70-200mm F2.8 GM II", 4, "pick", 52330018, 400, "1/2000", "f/2.8", "180mm", 7008, 4672, "Archive/2026/Namibia"],
  ["A7_05040.JPG", "jpg", "2026-06-08T11:02:00", "Sony A7 IV", "FE 70-200mm F2.8 GM II", 2, "unflagged", 9102284, 100, "1/1600", "f/5.6", "200mm", 7008, 4672, "Archive/2026/Namibia"],
  ["XT5_3104.RAF", "raw", "2026-06-21T14:26:00", "Fujifilm X-T5", "XF 33mm F1.4 R LM WR", 4, "unflagged", 64001288, 200, "1/1000", "f/2.0", "33mm", 7728, 5152, "Archive/2026/Namibia"],
  ["Z8_2408.NEF", "raw", "2026-01-21T07:55:00", "Nikon Z8", "NIKKOR Z 14-24mm f/2.8 S", 3, "unflagged", 58812044, 64, "1/200", "f/8.0", "14mm", 8256, 5504, "Archive/2026/Kyoto"],
  ["R5_1022.CR3", "raw", "2025-12-06T12:14:00", "Canon R5", "RF 100-500mm F4.5-7.1 L", 4, "pick", 45102880, 500, "1/2000", "f/7.1", "400mm", 8192, 5464, "Archive/2025/Atacama"],
];

const PLACES: Record<string, { name: string; latitude: number; longitude: number }> = {
  "Archive/2026/Iceland": { name: "Iceland", latitude: 63.53, longitude: -19.02 },
  "Archive/2026/Lisbon": { name: "Lisbon", latitude: 38.722, longitude: -9.139 },
  "Archive/2026/Kyoto": { name: "Kyoto", latitude: 35.011, longitude: 135.768 },
  "Archive/2026/Namibia": { name: "Namibia", latitude: -24.729, longitude: 15.292 },
  "Archive/2025/Atacama": { name: "Atacama", latitude: -23.863, longitude: -69.132 },
  "Archive/2025/Oslo": { name: "Oslo", latitude: 59.913, longitude: 10.752 },
};

const INBOX = { name: "Inbox", latitude: -27.469, longitude: 153.026 };

export function placeName(folder: string): string {
  return PLACES[folder]?.name ?? folder.split("/").filter(Boolean).pop() ?? INBOX.name;
}

export function coordinatesFor(folder: string, id: string): { latitude: number; longitude: number } {
  const place = PLACES[folder] ?? INBOX;
  let state = 0;
  for (const char of id) state = (Math.imul(state, 33) + char.charCodeAt(0)) >>> 0;
  const latitude = place.latitude + ((state % 1000) / 1000 - 0.5) * 0.16;
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  const longitude = place.longitude + ((state % 1000) / 1000 - 0.5) * 0.2;
  return {
    latitude: Math.round(latitude * 10000) / 10000,
    longitude: Math.round(longitude * 10000) / 10000,
  };
}

export function createCatalog(): StudioItem[] {
  return SEED.map((row) => attachSeed(seedItem(row, row[0])));
}

export function itemFromRecord(record: {
  id: number;
  filePath: string;
  contentHash: string | null;
  fileSize: number;
  createdAt: number | null;
  modifiedAt: number;
  rating: number | null;
  mediaKind: "image" | "video" | "raw";
  capturedAt: number | null;
  exif: {
    cameraMake: string | null;
    cameraModel: string | null;
    lensModel: string | null;
    capturedAt: string | null;
    width: number | null;
    height: number | null;
    iso: string | null;
    exposureTime: string | null;
    fNumber: string | null;
    focalLength: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  flag: string | null;
}): StudioItem {
  const fileName = record.filePath.split(/[/\\]/).filter(Boolean).pop() ?? record.filePath;
  const folder = parentFolder(record.filePath);
  const exif = record.exif;
  const format = formatForKind(record.mediaKind);
  const fromExif = exif?.capturedAt ? normalizeCapture(exif.capturedAt) : null;
  const captured = isCapture(fromExif)
    ? fromExif
    : (unixToIso(record.capturedAt) ?? unixToIso(record.modifiedAt) ?? "1970-01-01T00:00:00");
  const id = `library-${record.id}`;
  const camera = [exif?.cameraMake, exif?.cameraModel].filter(Boolean).join(" ");
  return {
    id,
    fileName,
    folder,
    capturedAt: captured,
    camera: camera || "Unknown camera",
    lens: exif?.lensModel || "Unknown lens",
    rating: record.rating != null && record.rating > 0 ? record.rating : null,
    format,
    fileSize: record.fileSize,
    iso: leadingNumber(exif?.iso ?? null),
    shutter: exif?.exposureTime ?? null,
    aperture: exif?.fNumber ?? null,
    focalLength: exif?.focalLength ?? null,
    width: exif?.width ?? null,
    height: exif?.height ?? null,
    hash: record.contentHash ?? fakeHash(id),
    histogram: histogram(id),
    sourcePath: record.filePath,
    flag: record.flag === "pick" || record.flag === "reject" ? record.flag : "unflagged",
    faces: [],
    subjects: [],
    ...placed(folder, id, exif?.latitude, exif?.longitude),
  };
}

export function mergeItems(incoming: StudioItem[], current: StudioItem[]): StudioItem[] {
  const replacements = new Map(incoming.map((item) => [item.id, item]));
  const seen = new Set(current.map((item) => item.id));
  const added = incoming.filter((item) => !seen.has(item.id));
  const updated = current.map((item) => replacements.get(item.id) ?? item);
  return [...added, ...updated];
}

function parentFolder(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  parts.pop();
  return parts.join("/") || "Inbox";
}

function unixToIso(seconds: number | null): string | null {
  if (seconds == null) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function leadingNumber(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeCapture(value: string): string {
  const match = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return value;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
}

export function captureMillis(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(normalizeCapture(value));
  if (!match) return Number.NEGATIVE_INFINITY;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

function isCapture(value: string | null): value is string {
  return value != null && captureMillis(value) !== Number.NEGATIVE_INFINITY;
}

function formatForKind(kind: "image" | "video" | "raw"): MediaFormat {
  if (kind === "video") return "video";
  if (kind === "raw") return "raw";
  return "jpg";
}

export function inventItems(folder: string, format: MediaFormat): StudioItem[] {
  const stamp = Date.now();
  const captured = new Date().toISOString().slice(0, 19);
  const names =
    format === "raw"
      ? ["FRAME_001.ARW", "FRAME_002.ARW", "FRAME_003.ARW"]
      : format === "jpg"
        ? ["FRAME_001.JPG", "FRAME_002.JPG", "FRAME_003.JPG"]
        : ["CLIP_001.MP4", "CLIP_002.MOV", "CLIP_003.MP4"];

  return names.map((fileName, index) => {
    const id = `added-${stamp}-${index}`;
    return {
      id,
      fileName,
      folder: folder.trim() || "Inbox",
      capturedAt: captured,
      camera: "Unknown camera",
      lens: format === "video" ? "Unknown lens" : "35mm",
      rating: null,
      flag: "unflagged",
      format,
      fileSize: format === "video" ? 220_000_000 + index * 12_000_000 : 18_000_000 + index * 1_400_000,
      iso: format === "video" ? null : 200,
      shutter: format === "video" ? null : "1/250",
      aperture: format === "video" ? null : "f/2.8",
      focalLength: format === "video" ? null : "35mm",
      width: format === "video" ? 3840 : 6000,
      height: format === "video" ? 2160 : 4000,
      hash: fakeHash(id),
      histogram: histogram(id),
      sourcePath: null,
      geotagged: false,
      faces: [],
      subjects: [],
      ...coordinatesFor(folder.trim() || "Inbox", id),
    };
  });
}

export function frameBackground(seed: string): string {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const hue = Math.abs(hash) % 360;
  const second = (hue + 32) % 360;
  return `linear-gradient(160deg, hsl(${hue} 24% 24%) 0%, hsl(${second} 30% 12%) 68%, #0f1115 100%)`;
}

export function nextFlag(flag: FlagStatus): FlagStatus {
  if (flag === "unflagged") return "pick";
  if (flag === "pick") return "reject";
  return "unflagged";
}

function seedItem(row: Seed, id: string): StudioItem {
  const [
    fileName,
    format,
    capturedAt,
    camera,
    lens,
    rating,
    flag,
    fileSize,
    iso,
    shutter,
    aperture,
    focalLength,
    width,
    height,
    folder,
  ] = row;
  return {
    id,
    fileName,
    format,
    capturedAt,
    camera,
    lens,
    rating,
    flag,
    fileSize,
    iso,
    shutter,
    aperture,
    focalLength,
    width,
    height,
    folder,
    hash: fakeHash(id),
    histogram: histogram(id),
    sourcePath: null,
    geotagged: true,
    faces: [],
    subjects: [],
    ...coordinatesFor(folder, id),
  };
}

const SEED_FACES: Record<string, { personId: string; name: string | null; x: number; y: number; width: number; height: number }[]> = {
  "A7_04188.JPG": [{ personId: "person-bryce", name: "Bryce", x: 0.33, y: 0.12, width: 0.28, height: 0.36 }],
  "XT5_2288.JPG": [{ personId: "person-bryce", name: "Bryce", x: 0.4, y: 0.1, width: 0.26, height: 0.34 }],
  "Z8_1210.JPG": [{ personId: "person-bryce", name: "Bryce", x: 0.36, y: 0.14, width: 0.3, height: 0.38 }],
  "A7_05040.JPG": [{ personId: "person-bryce", name: "Bryce", x: 0.22, y: 0.16, width: 0.24, height: 0.32 }],
  "A7_04140.JPG": [{ personId: "person-amina", name: "Amina", x: 0.38, y: 0.18, width: 0.27, height: 0.34 }],
  "Q3_0160.JPG": [{ personId: "person-amina", name: "Amina", x: 0.34, y: 0.12, width: 0.3, height: 0.36 }],
  "R5_0904.JPG": [{ personId: "person-guest", name: null, x: 0.42, y: 0.15, width: 0.25, height: 0.33 }],
};

const SEED_SUBJECTS: Record<string, { kind: "pet" | "wildlife" | "scene" | "object"; label: string }[]> = {
  "A7_05040.JPG": [{ kind: "pet", label: "dog" }],
  "A7_04112.ARW": [
    { kind: "pet", label: "dog" },
    { kind: "scene", label: "beach" },
  ],
  "A7_04118.ARW": [
    { kind: "object", label: "lighthouse" },
    { kind: "scene", label: "beach" },
    { kind: "scene", label: "water" },
  ],
  "A7_04140.JPG": [
    { kind: "scene", label: "beach" },
    { kind: "scene", label: "water" },
  ],
  "Q3_0152.DNG": [{ kind: "pet", label: "cat" }],
  "Q3_0144.DNG": [
    { kind: "object", label: "boat" },
    { kind: "scene", label: "water" },
    { kind: "object", label: "architecture" },
  ],
  "A7_05018.ARW": [
    { kind: "wildlife", label: "oryx" },
    { kind: "wildlife", label: "wildlife" },
    { kind: "scene", label: "drone" },
  ],
  "A7_05002.ARW": [{ kind: "wildlife", label: "wildlife" }],
  "A7_04188.JPG": [{ kind: "scene", label: "sunset" }],
  "XT5_2288.JPG": [{ kind: "scene", label: "sunset" }],
  "R5_0904.JPG": [{ kind: "scene", label: "sunset" }],
  "Q3_0160.JPG": [
    { kind: "scene", label: "sunset" },
    { kind: "scene", label: "water" },
  ],
  "XT5_2201.RAF": [
    { kind: "object", label: "boat" },
    { kind: "scene", label: "water" },
  ],
  "XT5_2208.RAF": [{ kind: "object", label: "architecture" }],
  "Z8_1180.NEF": [{ kind: "object", label: "architecture" }],
  "Z8_1194.NEF": [{ kind: "object", label: "architecture" }],
  "Z8_2408.NEF": [{ kind: "object", label: "architecture" }],
  "R5_0890.CR3": [{ kind: "object", label: "vehicle" }],
  "R5_1022.CR3": [
    { kind: "wildlife", label: "bird" },
    { kind: "wildlife", label: "wildlife" },
  ],
};

function attachSeed(item: StudioItem): StudioItem {
  const faces = SEED_FACES[item.fileName] ?? [];
  const subjects = SEED_SUBJECTS[item.fileName] ?? [];
  return {
    ...item,
    faces: faces.map((face, index) => ({
      id: `face-${face.personId}-${item.fileName}-${index}`,
      personId: face.personId,
      name: face.name,
      x: face.x,
      y: face.y,
      width: face.width,
      height: face.height,
      score: 0.94,
    })),
    subjects: subjects.map((tag) => ({ ...tag, score: 0.86 })),
  };
}

function placed(
  folder: string,
  id: string,
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): { latitude: number; longitude: number; geotagged: boolean } {
  if (latitude != null && longitude != null && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { latitude: latitude / 1_000_000, longitude: longitude / 1_000_000, geotagged: true };
  }
  return { ...coordinatesFor(folder, id), geotagged: false };
}

export function fakeHash(seed: string): string {
  let hash = 2166136261;
  let out = "";
  for (let index = 0; index < seed.length + 8; index += 1) {
    const code = seed.charCodeAt(index % seed.length);
    hash ^= code + index;
    hash = Math.imul(hash, 16777619);
    out += (hash >>> 0).toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
}

export function histogram(seed: string): number[] {
  let state = 0;
  for (const char of seed) state = (Math.imul(state, 33) + char.charCodeAt(0)) >>> 0;
  return Array.from({ length: 16 }, (_, index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const wave = Math.sin((index / 15) * Math.PI) * 0.55 + 0.3;
    return Math.min(1, wave * (((state % 70) + 30) / 100));
  });
}
