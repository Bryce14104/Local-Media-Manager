export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DevelopSettings = {
  crop: CropRect | null;
  straighten: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  vibrance: number;
  saturation: number;
  clarity: number;
  dehaze: number;
  sharpen: number;
  vignette: number;
};

export type FrameStats = {
  mean: number;
  std: number;
  pLow: number;
  pHigh: number;
  meanR: number;
  meanG: number;
  meanB: number;
  chroma: number;
};

export const NEUTRAL_DEVELOP: DevelopSettings = {
  crop: null,
  straighten: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  clarity: 0,
  dehaze: 0,
  sharpen: 0,
  vignette: 0,
};

export function developSourceUrls(item: {
  proxyUrl?: string | null;
  previewUrl?: string | null;
  inspectUrl?: string | null;
}): string[] {
  return [...new Set([item.proxyUrl, item.previewUrl, item.inspectUrl].filter((url): url is string => Boolean(url)))];
}

export async function loadDevelopImage(urls: string[]): Promise<HTMLImageElement> {
  let lastError = "No preview for this file.";
  for (const url of urls) {
    try {
      const resolved = (await blobUrl(url)) ?? url;
      const image = await decodeImage(resolved);
      if (image.naturalWidth > 0) return image;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Could not read this frame.";
    }
  }
  throw new Error(lastError);
}

async function blobUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size < 32) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode this frame."));
    image.src = url;
    if (image.complete && image.naturalWidth > 0) resolve(image);
  });
}

export function parseDevelop(raw: string | null | undefined): DevelopSettings {
  if (!raw) return { ...NEUTRAL_DEVELOP };
  try {
    const parsed = JSON.parse(raw) as Partial<DevelopSettings>;
    return {
      ...NEUTRAL_DEVELOP,
      ...parsed,
      crop: sanitizeCrop(parsed.crop ?? null),
    };
  } catch {
    return { ...NEUTRAL_DEVELOP };
  }
}

const GRADE_KEYS = [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "temperature",
  "tint",
  "vibrance",
  "saturation",
  "clarity",
  "dehaze",
  "sharpen",
  "vignette",
] as const;

/** Copy color grade onto another file without replacing that file's crop. */
export function applyGrade(target: DevelopSettings, grade: DevelopSettings): DevelopSettings {
  const next = { ...target };
  for (const key of GRADE_KEYS) {
    next[key] = grade[key];
  }
  return next;
}

export function gradeHint(item: { format: string; fileName: string }): string {
  const name = item.fileName.toLowerCase();
  if (item.format === "video" || /\.(braw|r3d|ari|mxf)$/.test(name)) {
    return "Grading the 3 fps proxy. The camera file stays on disk.";
  }
  if (item.format === "raw" || /\.(dng|cr2|cr3|nef|arw|orf|rw2|raf|pef|srw)$/.test(name)) {
    return "Grading the JPEG preview. The RAW/DNG stays on disk.";
  }
  return "Non-destructive. Auto reads this frame.";
}

export async function autoGradeFromUrls(
  urls: string[],
  crop: CropRect | null,
  straighten: number,
): Promise<DevelopSettings> {
  const image = await loadDevelopImage(urls);
  const cropRect = crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const sw = Math.max(1, cropRect.width * image.naturalWidth);
  const sh = Math.max(1, cropRect.height * image.naturalHeight);
  const scale = Math.min(1, 720 / Math.max(sw, sh));
  const probe = document.createElement("canvas");
  probe.width = Math.max(1, Math.round(sw * scale));
  probe.height = Math.max(1, Math.round(sh * scale));
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return autoDevelop({ mean: 0.45, std: 0.16, pLow: 0.05, pHigh: 0.95, meanR: 0.45, meanG: 0.45, meanB: 0.45, chroma: 0.12 }, crop, straighten);
  ctx.drawImage(
    image,
    cropRect.x * image.naturalWidth,
    cropRect.y * image.naturalHeight,
    sw,
    sh,
    0,
    0,
    probe.width,
    probe.height,
  );
  return autoDevelop(analyzeFrame(ctx.getImageData(0, 0, probe.width, probe.height)), crop, straighten);
}

export function isNeutralDevelop(settings: DevelopSettings): boolean {
  if (settings.crop && (settings.crop.width < 0.999 || settings.crop.height < 0.999)) return false;
  return (
    settings.straighten === 0 &&
    settings.exposure === 0 &&
    settings.contrast === 0 &&
    settings.highlights === 0 &&
    settings.shadows === 0 &&
    settings.whites === 0 &&
    settings.blacks === 0 &&
    settings.temperature === 0 &&
    settings.tint === 0 &&
    settings.vibrance === 0 &&
    settings.saturation === 0 &&
    settings.clarity === 0 &&
    settings.dehaze === 0 &&
    settings.sharpen === 0 &&
    settings.vignette === 0
  );
}

export function sanitizeCrop(crop: CropRect | null): CropRect | null {
  if (!crop) return null;
  const width = clamp(crop.width, 0.08, 1);
  const height = clamp(crop.height, 0.08, 1);
  const x = clamp(crop.x, 0, 1 - width);
  const y = clamp(crop.y, 0, 1 - height);
  if (width > 0.995 && height > 0.995 && x < 0.005 && y < 0.005) return null;
  return { x, y, width, height };
}

export function analyzeFrame(data: ImageData): FrameStats {
  const { data: px, width, height } = data;
  const bins = new Uint32Array(256);
  let mean = 0;
  let meanR = 0;
  let meanG = 0;
  let meanB = 0;
  let chroma = 0;
  let count = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 40_000)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = px[i] / 255;
      const g = px[i + 1] / 255;
      const b = px[i + 2] / 255;
      const yL = luma(r, g, b);
      mean += yL;
      meanR += r;
      meanG += g;
      meanB += b;
      chroma += Math.max(r, g, b) - Math.min(r, g, b);
      bins[Math.max(0, Math.min(255, Math.round(yL * 255)))] += 1;
      count += 1;
    }
  }
  mean /= count || 1;
  meanR /= count || 1;
  meanG /= count || 1;
  meanB /= count || 1;
  chroma /= count || 1;
  let variance = 0;
  let seen = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const d = luma(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255) - mean;
      variance += d * d;
      seen += 1;
    }
  }
  const total = bins.reduce((sum, n) => sum + n, 0) || 1;
  return {
    mean,
    std: Math.sqrt(variance / (seen || 1)),
    pLow: percentile(bins, total, 0.01),
    pHigh: percentile(bins, total, 0.99),
    meanR,
    meanG,
    meanB,
    chroma,
  };
}

export function autoDevelop(stats: FrameStats, crop: CropRect | null, straighten: number): DevelopSettings {
  const exposure = clamp((0.46 - stats.mean) * 1.85, -1.35, 1.35);
  const contrast = clamp((0.18 - stats.std) * 140 + 10, 4, 28);
  const highlights = stats.pHigh > 0.92 ? clamp((stats.pHigh - 0.88) * -180, -70, 0) : clamp((0.9 - stats.pHigh) * 40, 0, 18);
  const shadows = stats.pLow < 0.08 ? clamp((0.1 - stats.pLow) * 220, 0, 55) : clamp((stats.pLow - 0.12) * -80, -25, 0);
  const whites = clamp((0.97 - stats.pHigh) * 90, -20, 35);
  const blacks = clamp((0.04 - stats.pLow) * 160, -28, 22);
  const temperature = clamp((stats.meanR - stats.meanB) * -90, -28, 32);
  const tint = clamp((stats.meanG - (stats.meanR + stats.meanB) / 2) * -70, -12, 12);
  const vibrance = clamp((0.22 - stats.chroma) * 140, 6, 42);
  const saturation = clamp(vibrance * 0.28, 0, 12);
  const clarity = stats.std < 0.14 ? 16 : 8;
  const dehaze = stats.mean > 0.58 && stats.std < 0.16 ? 10 : 0;
  return {
    crop,
    straighten,
    exposure: round(exposure),
    contrast: round(contrast),
    highlights: round(highlights),
    shadows: round(shadows),
    whites: round(whites),
    blacks: round(blacks),
    temperature: round(temperature),
    tint: round(tint),
    vibrance: round(vibrance),
    saturation: round(saturation),
    clarity,
    dehaze,
    sharpen: 12,
    vignette: stats.mean > 0.62 ? 8 : 0,
  };
}

export function applyDevelop(data: ImageData, settings: DevelopSettings): ImageData {
  const { data: px, width, height } = data;
  const exp = 2 ** settings.exposure;
  const contrast = 1 + settings.contrast / 110;
  const clarity = settings.clarity / 140;
  const dehaze = settings.dehaze / 140;
  const sat = 1 + settings.saturation / 100;
  const vib = settings.vibrance / 100;
  const temp = settings.temperature / 100;
  const tint = settings.tint / 100;
  const hi = settings.highlights / 100;
  const sh = settings.shadows / 100;
  const white = 1 + settings.whites / 250;
  const black = settings.blacks / 250;
  const vig = settings.vignette / 100;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const maxD = Math.sqrt(cx * cx + cy * cy) || 1;

  for (let i = 0; i < px.length; i += 4) {
    let r = px[i] / 255;
    let g = px[i + 1] / 255;
    let b = px[i + 2] / 255;
    r += temp * 0.12;
    b -= temp * 0.14;
    g += tint * 0.08;
    r *= exp;
    g *= exp;
    b *= exp;
    r = (r - 0.5) * contrast + 0.5;
    g = (g - 0.5) * contrast + 0.5;
    b = (b - 0.5) * contrast + 0.5;
    let y = luma(r, g, b);
    if (y > 0.52 && hi !== 0) {
      const t = (y - 0.52) / 0.48;
      const lift = hi < 0 ? y + (1 - y) * hi * t : y + (1 - y) * hi * t * 0.35;
      const scale = y === 0 ? 1 : lift / y;
      r *= scale;
      g *= scale;
      b *= scale;
      y = lift;
    }
    if (y < 0.48 && sh !== 0) {
      const t = 1 - y / 0.48;
      const lift = y + (0.48 - y) * sh * t * (sh > 0 ? 0.85 : 0.45);
      const scale = y === 0 ? 1 : lift / Math.max(y, 1e-4);
      r *= scale;
      g *= scale;
      b *= scale;
      y = lift;
    }
    const span = Math.max(0.15, white - black);
    r = (r - black) / span;
    g = (g - black) / span;
    b = (b - black) / span;
    y = luma(r, g, b);
    r += (r - y) * (sat - 1);
    g += (g - y) * (sat - 1);
    b += (b - y) * (sat - 1);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const vibe = vib * (1 - clamp(chroma * 1.6, 0, 1));
    r += (r - y) * vibe;
    g += (g - y) * vibe;
    b += (b - y) * vibe;
    y = luma(r, g, b);
    const mid = 1 - Math.abs(y - 0.5) * 2;
    r += (r - 0.5) * clarity * mid;
    g += (g - 0.5) * clarity * mid;
    b += (b - 0.5) * clarity * mid;
    r = (r - 0.5) * (1 + dehaze) + 0.5 - dehaze * 0.04;
    g = (g - 0.5) * (1 + dehaze) + 0.5 - dehaze * 0.04;
    b = (b - 0.5) * (1 + dehaze) + 0.5 - dehaze * 0.04;
    if (vig !== 0) {
      const p = i / 4;
      const x = p % width;
      const yy = (p / width) | 0;
      const d = Math.sqrt((x - cx) ** 2 + (yy - cy) ** 2) / maxD;
      const fall = vig > 0 ? 1 - vig * d * d * 0.95 : 1 - vig * (1 - d) * 0.4;
      r *= fall;
      g *= fall;
      b *= fall;
    }
    px[i] = clamp(r, 0, 1) * 255;
    px[i + 1] = clamp(g, 0, 1) * 255;
    px[i + 2] = clamp(b, 0, 1) * 255;
  }
  if (settings.sharpen > 0) sharpen(px, width, height, settings.sharpen / 140);
  return data;
}

export function stageStyle(rotation: number, settings: DevelopSettings | undefined) {
  const current = settings ?? NEUTRAL_DEVELOP;
  const preview = developPreviewStyle(current);
  const angle = rotation + current.straighten;
  return {
    filter: preview.filter,
    clipPath: preview.clipPath,
    transform: angle ? `rotate(${angle}deg)` : undefined,
  };
}

export function developPreviewStyle(settings: DevelopSettings): { filter: string; clipPath?: string; transform?: string } {
  const brightness = 2 ** (settings.exposure * 0.65);
  const contrast = 1 + settings.contrast / 140 + settings.clarity / 220;
  const saturate = 1 + settings.saturation / 120 + settings.vibrance / 180;
  const sepia = Math.max(0, settings.temperature) / 280;
  const hue = settings.temperature * -0.35 + settings.tint * 0.2;
  const filter = [
    `brightness(${brightness})`,
    `contrast(${contrast})`,
    `saturate(${saturate})`,
    sepia > 0.01 ? `sepia(${sepia})` : "",
    Math.abs(hue) > 0.4 ? `hue-rotate(${hue}deg)` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const crop = settings.crop;
  const clipPath = crop
    ? `inset(${crop.y * 100}% ${(1 - crop.x - crop.width) * 100}% ${(1 - crop.y - crop.height) * 100}% ${crop.x * 100}%)`
    : undefined;
  const transform = settings.straighten ? `rotate(${settings.straighten}deg)` : undefined;
  return { filter, clipPath, transform };
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function percentile(bins: Uint32Array, total: number, fraction: number): number {
  const target = total * fraction;
  let acc = 0;
  for (let i = 0; i < bins.length; i++) {
    acc += bins[i];
    if (acc >= target) return i / 255;
  }
  return 1;
}

function sharpen(px: Uint8ClampedArray, width: number, height: number, amount: number) {
  const copy = new Uint8ClampedArray(px);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = copy[i + c];
        const blur =
          (copy[i + c] * 4 +
            copy[i - 4 + c] +
            copy[i + 4 + c] +
            copy[i - width * 4 + c] +
            copy[i + width * 4 + c]) /
          8;
        px[i + c] = clamp(center + (center - blur) * amount * 2.2, 0, 255);
      }
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
