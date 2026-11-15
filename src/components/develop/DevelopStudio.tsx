import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopBridgeAvailable, writeBytes } from "../../lib/api";
import {
  analyzeFrame,
  applyDevelop,
  autoDevelop,
  developSourceUrls,
  isNeutralDevelop,
  loadDevelopImage,
  NEUTRAL_DEVELOP,
  sanitizeCrop,
  type CropRect,
  type DevelopSettings,
} from "../../studio/develop";
import type { StudioItem } from "../../studio/types";
import { CropOverlay } from "./CropOverlay";

type Tool = "adjust" | "crop";
type Compare = "after" | "before" | "split";

const ASPECTS: { id: string; label: string; value: number | null }[] = [
  { id: "free", label: "Free", value: null },
  { id: "orig", label: "Original", value: 0 },
  { id: "1-1", label: "1:1", value: 1 },
  { id: "4-5", label: "4:5", value: 4 / 5 },
  { id: "3-2", label: "3:2", value: 3 / 2 },
  { id: "16-9", label: "16:9", value: 16 / 9 },
];

export function DevelopStudio({
  item,
  settings,
  onChange,
  onClose,
}: {
  item: StudioItem;
  settings: DevelopSettings;
  onChange: (settings: DevelopSettings) => void;
  onClose: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>("adjust");
  const [compare, setCompare] = useState<Compare>("after");
  const [aspectId, setAspectId] = useState("free");
  const [busy, setBusy] = useState("Loading frame…");
  const [exportLabel, setExportLabel] = useState<string | null>(null);
  const [hist, setHist] = useState({ r: new Array(32).fill(0), g: new Array(32).fill(0), b: new Array(32).fill(0) });
  const sources = useMemo(
    () => developSourceUrls(item),
    [item.id, item.inspectUrl, item.previewUrl, item.proxyUrl],
  );
  const fallbackSrc = sources[0] ?? null;
  const originalRatio = (item.width && item.height ? item.width / item.height : null) ?? null;
  const aspect = ASPECTS.find((entry) => entry.id === aspectId)?.value ?? null;
  const cropAspect = aspect === 0 ? originalRatio : aspect;
  const crop = settings.crop ?? { x: 0, y: 0, width: 1, height: 1 };

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !image.naturalWidth) return;
    try {
    const cropMode = tool === "crop";
    const showBefore = compare === "before";
    const split = compare === "split";
    const cropRect = cropMode ? { x: 0, y: 0, width: 1, height: 1 } : (settings.crop ?? { x: 0, y: 0, width: 1, height: 1 });
    const sx = cropRect.x * image.naturalWidth;
    const sy = cropRect.y * image.naturalHeight;
    const sw = Math.max(1, cropRect.width * image.naturalWidth);
    const sh = Math.max(1, cropRect.height * image.naturalHeight);
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    const work = document.createElement("canvas");
    work.width = dw;
    work.height = dh;
    const wctx = work.getContext("2d", { willReadFrequently: true });
    if (!wctx) return;
    wctx.drawImage(image, sx, sy, sw, sh, 0, 0, dw, dh);
    try {
      if (!showBefore) {
        const frame = wctx.getImageData(0, 0, dw, dh);
        applyDevelop(frame, { ...settings, crop: null, straighten: 0 });
        wctx.putImageData(frame, 0, 0);
      }
      setHist(histogramFrom(wctx.getImageData(0, 0, dw, dh)));
    } catch {
      // Custom-protocol bitmaps can taint the canvas. The JPEG still draws.
    }
    const stage = stageRef.current;
    const room = stage?.getBoundingClientRect();
    const maxW = Math.max(160, (room?.width ?? 800) - 24);
    const maxH = Math.max(160, (room?.height ?? 600) - 24);
    const fit = Math.min(maxW / dw, maxH / dh);
    canvas.width = dw;
    canvas.height = dh;
    canvas.style.width = `${dw * fit}px`;
    canvas.style.height = `${dh * fit}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, dw, dh);
    if (settings.straighten && !cropMode) {
      ctx.translate(dw / 2, dh / 2);
      ctx.rotate((settings.straighten * Math.PI) / 180);
      ctx.translate(-dw / 2, -dh / 2);
    }
    ctx.drawImage(work, 0, 0);
    if (split) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(image, sx, sy, sw / 2, sh, 0, 0, dw / 2, dh);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillRect(dw / 2 - 1, 0, 2, dh);
      ctx.restore();
    }
    setBusy("");
    } catch (error) {
      setBusy(error instanceof Error ? error.message : "Could not draw this frame.");
    }
  }, [compare, settings, tool]);

  useEffect(() => {
    let cancel = false;
    if (sources.length === 0) {
      setBusy("No JPEG preview yet. Wait for Shelf to finish writing one.");
      return;
    }
    setBusy("Loading frame…");
    void loadDevelopImage(sources)
      .then((image) => {
        if (cancel) return;
        imageRef.current = image;
        paint();
      })
      .catch((error: Error) => {
        if (!cancel) setBusy(error.message || "Could not read this frame.");
      });
    return () => {
      cancel = true;
    };
  }, [item.id, paint, sources]);

  useEffect(() => {
    paint();
  }, [paint]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (typing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "a" || event.key === "A") {
        event.preventDefault();
        runAuto();
      }
      if (event.key === "\\") {
        event.preventDefault();
        setCompare((current) => (current === "after" ? "before" : "after"));
      }
      if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        setTool((current) => (current === "crop" ? "adjust" : "crop"));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, settings.crop, settings.straighten]);

  function patch(partial: Partial<DevelopSettings>) {
    onChange({ ...settings, ...partial });
  }

  function runAuto() {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!image || !canvas) return;
    const probe = document.createElement("canvas");
    const cropRect = settings.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    const sw = Math.max(1, cropRect.width * image.naturalWidth);
    const sh = Math.max(1, cropRect.height * image.naturalHeight);
    const scale = Math.min(1, 720 / Math.max(sw, sh));
    probe.width = Math.max(1, Math.round(sw * scale));
    probe.height = Math.max(1, Math.round(sh * scale));
    const ctx = probe.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
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
    const next = autoDevelop(analyzeFrame(ctx.getImageData(0, 0, probe.width, probe.height)), settings.crop, settings.straighten);
    onChange(next);
  }

  async function exportCopy() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) return;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const fallback = item.fileName.replace(/\.[^.]+$/, "") + "-edit.jpg";
    if (!desktopBridgeAvailable()) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fallback;
      link.click();
      URL.revokeObjectURL(url);
      setExportLabel("Saved a JPEG copy");
      return;
    }
    const { save } = await import("@tauri-apps/plugin-dialog");
    const destination = await save({
      title: "Save edited JPEG",
      defaultPath: fallback,
      filters: [{ name: "JPEG", extensions: ["jpg", "jpeg"] }],
    });
    if (!destination) return;
    await writeBytes(destination, Array.from(bytes));
    setExportLabel(`Wrote ${destination}`);
  }

  const groups = useMemo(() => sliderGroups(settings, patch), [settings]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0b0d10] text-foam">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <p className="mr-auto min-w-0">
          <span className="block truncate text-sm">{item.fileName}</span>
          <span className="text-[11px] text-mute">Develop · non-destructive · Auto reads this frame</span>
        </p>
        <ToolButton label="Crop" pressed={tool === "crop"} onClick={() => setTool("crop")} />
        <ToolButton label="Adjust" pressed={tool === "adjust"} onClick={() => setTool("adjust")} />
        <span className="hidden h-5 w-px bg-white/10 sm:block" />
        <ToolButton label="Auto" onClick={runAuto} accent />
        <ToolButton label="Reset" onClick={() => onChange({ ...NEUTRAL_DEVELOP })} disabled={isNeutralDevelop(settings)} />
        <ToolButton label="Before" pressed={compare === "before"} onClick={() => setCompare("before")} />
        <ToolButton label="Split" pressed={compare === "split"} onClick={() => setCompare("split")} />
        <ToolButton label="After" pressed={compare === "after"} onClick={() => setCompare("after")} />
        <ToolButton label="Save JPEG" onClick={() => void exportCopy()} />
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-teal px-3 py-1.5 text-sm font-medium text-teal-ink"
        >
          Done
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div ref={stageRef} className="relative grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden bg-[#08090c]">
          {busy ? (
            <div className="absolute inset-0 z-10 grid place-items-center">
              {fallbackSrc ? (
                <img
                  src={fallbackSrc}
                  alt=""
                  className="max-h-[calc(100dvh-8rem)] max-w-[calc(100%-1.5rem)] object-contain opacity-80"
                />
              ) : null}
              <p className="absolute bottom-6 rounded-full bg-black/55 px-3 py-1 text-sm text-mute">{busy}</p>
            </div>
          ) : null}
          <div data-crop-stage className="relative max-h-full max-w-full">
            <canvas ref={canvasRef} className="block max-h-[calc(100dvh-8rem)] max-w-full bg-black" />
            {tool === "crop" ? (
              <CropOverlay
                crop={crop}
                aspect={cropAspect}
                onChange={(next) => patch({ crop: sanitizeCrop(next) })}
              />
            ) : null}
          </div>
        </div>

        <aside className="h-[min(46vh,24rem)] shrink-0 overflow-y-auto border-t border-white/10 md:h-auto md:w-[22rem] md:border-l md:border-t-0">
          <div className="px-4 py-3">
            <Histogram bins={hist} />
            {exportLabel ? <p className="mt-2 text-[11px] text-teal">{exportLabel}</p> : null}
          </div>
          {tool === "crop" ? (
            <section className="space-y-3 px-4 pb-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-mute">Crop & straighten</p>
              <div className="flex flex-wrap gap-1">
                {ASPECTS.map((entry) => (
                  <ToolButton
                    key={entry.id}
                    label={entry.label}
                    pressed={aspectId === entry.id}
                    onClick={() => {
                      setAspectId(entry.id);
                      const ratio = entry.value === 0 ? originalRatio : entry.value;
                      if (ratio) patch({ crop: cropToAspect(crop, ratio) });
                    }}
                  />
                ))}
              </div>
              <Slider
                label="Straighten"
                value={settings.straighten}
                min={-15}
                max={15}
                step={0.1}
                onChange={(straighten) => patch({ straighten })}
              />
              <ToolButton label="Reset crop" onClick={() => patch({ crop: null, straighten: 0 })} />
            </section>
          ) : (
            groups.map((group) => (
              <section key={group.title} className="border-t border-white/10 px-4 py-3">
                <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-mute">{group.title}</p>
                <div className="space-y-2.5">
                  {group.sliders.map((slider) => (
                    <Slider key={slider.label} {...slider} />
                  ))}
                </div>
              </section>
            ))
          )}
        </aside>
      </div>
    </div>
  );
}

function sliderGroups(settings: DevelopSettings, patch: (partial: Partial<DevelopSettings>) => void) {
  const tone = (key: keyof DevelopSettings, label: string, min = -100, max = 100, step = 1) => ({
    label,
    value: Number(settings[key]),
    min,
    max,
    step,
    onChange: (value: number) => patch({ [key]: value }),
  });
  return [
    {
      title: "Light",
      sliders: [
        tone("exposure", "Exposure", -4, 4, 0.05),
        tone("contrast", "Contrast"),
        tone("highlights", "Highlights"),
        tone("shadows", "Shadows"),
        tone("whites", "Whites"),
        tone("blacks", "Blacks"),
      ],
    },
    {
      title: "Color",
      sliders: [
        tone("temperature", "Temperature"),
        tone("tint", "Tint"),
        tone("vibrance", "Vibrance"),
        tone("saturation", "Saturation"),
      ],
    },
    {
      title: "Presence",
      sliders: [
        tone("clarity", "Clarity", 0, 100),
        tone("dehaze", "Dehaze", 0, 100),
        tone("sharpen", "Sharpening", 0, 100),
        tone("vignette", "Vignette"),
      ],
    },
  ];
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="text-mute">{label}</span>
        <button type="button" className="font-mono text-foam/80" onDoubleClick={() => onChange(0)}>
          {formatValue(value, step)}
        </button>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onDoubleClick={() => onChange(0)}
        className="develop-slider w-full"
        style={{ ["--fill" as string]: `${fill}%` }}
      />
    </label>
  );
}

function formatValue(value: number, step: number): string {
  if (step < 1) return value.toFixed(2);
  return String(Math.round(value));
}

function ToolButton({
  label,
  onClick,
  pressed,
  disabled,
  accent,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-3 py-1.5 text-xs disabled:opacity-40 ${
        accent
          ? "bg-teal font-medium text-teal-ink"
          : pressed
            ? "border border-teal bg-teal/15 text-teal"
            : "border border-white/15 text-foam/85 hover:border-teal hover:text-teal"
      }`}
    >
      {label}
    </button>
  );
}

function Histogram({ bins }: { bins: { r: number[]; g: number[]; b: number[] } }) {
  const max = Math.max(1, ...bins.r, ...bins.g, ...bins.b);
  return (
    <div className="relative h-16 overflow-hidden rounded-lg bg-black/50">
      <svg viewBox="0 0 32 32" preserveAspectRatio="none" className="h-full w-full">
        {(["r", "g", "b"] as const).map((channel) => (
          <polyline
            key={channel}
            fill="none"
            stroke={channel === "r" ? "#f87171" : channel === "g" ? "#4ade80" : "#60a5fa"}
            strokeWidth="1"
            points={bins[channel].map((value, index) => `${index},${32 - (value / max) * 30}`).join(" ")}
          />
        ))}
      </svg>
    </div>
  );
}

function histogramFrom(data: ImageData): { r: number[]; g: number[]; b: number[] } {
  const r = new Array(32).fill(0);
  const g = new Array(32).fill(0);
  const b = new Array(32).fill(0);
  const px = data.data;
  for (let i = 0; i < px.length; i += 32) {
    r[px[i] >> 3] += 1;
    g[px[i + 1] >> 3] += 1;
    b[px[i + 2] >> 3] += 1;
  }
  return { r, g, b };
}

function cropToAspect(crop: CropRect, aspect: number): CropRect {
  const current = crop.width / crop.height;
  let { x, y, width, height } = crop;
  if (current > aspect) {
    width = height * aspect;
    x += (crop.width - width) / 2;
  } else {
    height = width / aspect;
    y += (crop.height - height) / 2;
  }
  return sanitizeCrop({ x, y, width, height }) ?? crop;
}
