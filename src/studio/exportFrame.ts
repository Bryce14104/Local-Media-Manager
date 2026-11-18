import { applyDevelop, loadDevelopImage, type DevelopSettings } from "./develop";
import type { StudioItem } from "./types";

export type ExportPreset = {
  format: "JPEG" | "TIFF" | "Original";
  quality: number;
  longEdge: number;
  watermark: string;
  colorSpace: "srgb" | "p3";
};

export const DEFAULT_EXPORT: ExportPreset = {
  format: "JPEG",
  quality: 0.92,
  longEdge: 2560,
  watermark: "",
  colorSpace: "srgb",
};

export async function renderExportBlob(
  item: StudioItem,
  settings: DevelopSettings,
  preset: ExportPreset,
): Promise<Blob> {
  const image = await loadDevelopImage(
    [item.inspectUrl, item.proxyUrl, item.previewUrl, item.originalUrl].filter((url): url is string => Boolean(url)),
  );
  const crop = settings.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const sx = crop.x * image.naturalWidth;
  const sy = crop.y * image.naturalHeight;
  const sw = Math.max(1, crop.width * image.naturalWidth);
  const sh = Math.max(1, crop.height * image.naturalHeight);
  const scale = Math.min(1, preset.longEdge / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { colorSpace: preset.colorSpace === "p3" ? "display-p3" : "srgb" } as CanvasRenderingContext2DSettings);
  if (!ctx) throw new Error("Could not draw this frame.");
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  ctx.putImageData(applyDevelop(pixels, settings), 0, 0);
  const mark = preset.watermark.trim();
  if (mark) {
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = `${Math.max(12, Math.round(canvas.width / 42))}px ui-sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(mark, canvas.width - 16, canvas.height - 18);
  }
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode JPEG."))),
      "image/jpeg",
      preset.quality,
    );
  });
}

export async function blobToBytes(blob: Blob): Promise<number[]> {
  const buffer = await blob.arrayBuffer();
  return [...new Uint8Array(buffer)];
}
