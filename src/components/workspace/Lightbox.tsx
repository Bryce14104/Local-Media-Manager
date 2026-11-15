import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatTimestamp } from "../../lib/format";
import type { SlideshowSettings } from "../../studio/slideshow";
import type { StudioItem } from "../../studio/types";
import { ProgressiveMedia } from "./ProgressiveMedia";
import { SlideshowControls } from "./SlideshowControls";

type LightboxProps = {
  item: StudioItem;
  before: StudioItem | null;
  after: StudioItem | null;
  index: number;
  count: number;
  strip?: StudioItem[];
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onJump?: (id: string) => void;
  onRotate?: () => void;
  onReveal?: () => void;
  onCopyPath?: () => void;
  onEdit?: () => void;
  poolIds?: string[];
  slideshow: SlideshowSettings;
  onSlideshow: (settings: SlideshowSettings) => void;
};

export function Lightbox({
  item,
  before,
  after,
  index,
  count,
  strip = [],
  onClose,
  onPrev,
  onNext,
  onJump,
  onRotate,
  onReveal,
  onCopyPath,
  onEdit,
  poolIds = [],
  slideshow: slideshowSettings,
  onSlideshow,
}: LightboxProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragX = useRef<number | null>(null);
  const wheel = useRef({ at: 0, carry: 0 });
  const onNextRef = useRef(onNext);
  const onPrevRef = useRef(onPrev);
  onNextRef.current = onNext;
  onPrevRef.current = onPrev;
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [slideshow, setSlideshow] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    setNatural(null);
    setZoom(1);
  }, [item.id]);

  useEffect(() => {
    if (!slideshow) return;
    const ids = poolIds.length > 0 ? poolIds : [item.id];

    function advance() {
      if (slideshowSettings.shuffle && ids.length > 1) {
        const others = ids.filter((id) => id !== item.id);
        const pick = others[Math.floor(Math.random() * others.length)];
        if (pick) onJump?.(pick);
        return;
      }
      if (index + 1 < count) {
        onNext();
        return;
      }
      if (slideshowSettings.loop && ids[0]) {
        onJump?.(ids[0]);
        return;
      }
      setSlideshow(false);
    }

    const video = rootRef.current?.querySelector("video");
    if (slideshowSettings.waitForVideo && video && item.format === "video") {
      video.muted = false;
      void video.play().catch(() => undefined);
      const onEnded = () => advance();
      video.addEventListener("ended", onEnded);
      return () => video.removeEventListener("ended", onEnded);
    }
    const timer = window.setTimeout(advance, slideshowSettings.intervalMs);
    return () => window.clearTimeout(timer);
  }, [count, index, item.format, item.id, onJump, onNext, poolIds, slideshow, slideshowSettings]);

  useEffect(() => {
    const sync = () => setImmersive(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    const urls = [before, after, item].flatMap((neighbor) =>
      neighbor ? [neighbor.proxyUrl ?? neighbor.previewUrl ?? null] : [],
    );
    const images = urls.filter((url): url is string => Boolean(url)).map((url) => {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      return img;
    });
    return () => {
      for (const img of images) img.src = "";
    };
  }, [before, after, item]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (typing) return;
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        void toggleFullscreen();
      }
      if (event.key === " ") {
        const video = rootRef.current?.querySelector("video");
        if (video) {
          event.stopPropagation();
          event.preventDefault();
          video.muted = false;
          if (video.paused) void video.play().catch(() => undefined);
          else video.pause();
          return;
        }
        event.preventDefault();
        setSlideshow((current) => !current);
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((current) => Math.min(4, current + 0.25));
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoom((current) => Math.max(1, current - 0.25));
      }
      if (event.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (delta === 0) return;
      const now = performance.now();
      if (now - wheel.current.at > 160) wheel.current.carry = 0;
      wheel.current.at = now;
      wheel.current.carry += delta;
      if (wheel.current.carry >= 40) {
        wheel.current.carry = 0;
        onNextRef.current();
      } else if (wheel.current.carry <= -40) {
        wheel.current.carry = 0;
        onPrevRef.current();
      }
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const width = item.width ?? natural?.width ?? null;
  const height = item.height ?? natural?.height ?? null;
  const captured = formatCapture(item.capturedAt);
  const atStart = index <= 0;
  const atEnd = index >= count - 1;
  const clip = item.format === "video";

  async function toggleFullscreen() {
    const node = rootRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await node.requestFullscreen();
    } catch {
      setImmersive((current) => !current);
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    dragX.current = event.clientX;
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragX.current == null) return;
    const delta = event.clientX - dragX.current;
    dragX.current = null;
    if (zoom > 1) return;
    if (Math.abs(delta) < 10) {
      if (onEdit && item.format !== "video") onEdit();
      return;
    }
    if (delta > 72) onPrev();
    else if (delta < -72) onNext();
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={item.fileName}
      className="fixed inset-0 z-50 bg-black text-foam"
    >
      <div
        className="absolute inset-0"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragX.current = null;
        }}
      >
        <div className="h-full w-full" style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}>
          <ProgressiveMedia
            item={item}
            fit="contain"
            playback="play"
            quality={immersive ? "full" : "proxy"}
            onSize={(nextWidth, nextHeight) => setNatural({ width: nextWidth, height: nextHeight })}
          />
        </div>
      </div>

      <header
        className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-center justify-end gap-2 bg-gradient-to-b from-black/55 to-transparent px-3 py-2 md:px-4 ${
          immersive ? "opacity-0 transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100" : ""
        }`}
      >
        <p className="mr-auto font-mono text-xs tracking-wide text-white/70">
          {index + 1} / {count}
          {slideshow ? " · slideshow" : ""}
          {zoom > 1 ? ` · ${Math.round(zoom * 100)}%` : ""}
        </p>
        {onEdit && item.format !== "video" ? (
          <button
            type="button"
            onClick={onEdit}
            className="pointer-events-auto rounded-full bg-teal px-3 py-1.5 text-sm font-medium text-teal-ink"
          >
            Edit
          </button>
        ) : null}
        <button
          type="button"
          aria-label={slideshow ? "Stop slideshow" : "Slideshow"}
          onClick={() => setSlideshow((current) => !current)}
          className="pointer-events-auto rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-sm text-foam backdrop-blur-sm transition hover:border-teal hover:text-teal"
        >
          {slideshow ? "Pause" : "Play"}
        </button>
        <div className="relative pointer-events-auto">
          <button
            type="button"
            aria-expanded={showSettings}
            aria-label="Slideshow settings"
            onClick={() => setShowSettings((current) => !current)}
            className="rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-sm text-foam backdrop-blur-sm transition hover:border-teal hover:text-teal"
          >
            Timing
          </button>
          {showSettings ? (
            <div className="absolute right-0 top-[calc(100%+0.4rem)] z-30 w-72 rounded-2xl border border-white/15 bg-card p-3 text-foam shadow-2xl">
              <SlideshowControls settings={slideshowSettings} onChange={onSlideshow} />
            </div>
          ) : null}
        </div>
        {onRotate ? (
          <button
            type="button"
            aria-label="Rotate"
            onClick={onRotate}
            className="pointer-events-auto rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-sm text-foam backdrop-blur-sm transition hover:border-teal hover:text-teal"
          >
            Rotate
          </button>
        ) : null}
        {onCopyPath ? (
          <button
            type="button"
            onClick={onCopyPath}
            className="pointer-events-auto rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-sm text-foam backdrop-blur-sm transition hover:border-teal hover:text-teal"
          >
            Copy path
          </button>
        ) : null}
        {onReveal ? (
          <button
            type="button"
            onClick={onReveal}
            className="pointer-events-auto rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-sm text-foam backdrop-blur-sm transition hover:border-teal hover:text-teal"
          >
            Reveal
          </button>
        ) : null}
        {!clip ? (
          <button
            type="button"
            aria-label={immersive ? "Exit full screen" : "Full screen"}
            onClick={() => void toggleFullscreen()}
            className="pointer-events-auto grid h-9 w-9 place-items-center rounded-md border border-white/15 bg-black/45 text-foam backdrop-blur-sm transition hover:border-teal hover:text-teal"
          >
            {immersive ? <ExitFullIcon /> : <FullIcon />}
          </button>
        ) : null}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="pointer-events-auto rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-sm text-foam backdrop-blur-sm transition hover:border-teal hover:text-teal"
        >
          Close
        </button>
      </header>

      <button
        type="button"
        aria-label="Previous frame"
        disabled={atStart}
        onClick={onPrev}
        className="absolute left-2 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/35 text-foam backdrop-blur-sm transition hover:border-teal hover:text-teal disabled:pointer-events-none disabled:opacity-20 md:grid"
      >
        <Chevron direction="left" />
      </button>
      <button
        type="button"
        aria-label="Next frame"
        disabled={atEnd}
        onClick={onNext}
        className="absolute right-2 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/35 text-foam backdrop-blur-sm transition hover:border-teal hover:text-teal disabled:pointer-events-none disabled:opacity-20 md:grid"
      >
        <Chevron direction="right" />
      </button>

      <footer
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/60 to-transparent px-4 pt-10 md:px-6 ${
          clip ? "pb-20 md:pb-24" : "pb-4"
        } ${immersive ? "opacity-0 transition-opacity duration-200 hover:opacity-100" : ""}`}
      >
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0 max-w-[min(100%,42rem)] rounded-md bg-black/45 px-3 py-2 backdrop-blur-sm">
            <p className="truncate text-sm font-medium tracking-tight">{item.fileName}</p>
            <p className="mt-1 font-mono text-[11px] text-white/55">
              {captured}
              {width && height ? ` · ${width} × ${height}` : ""}
              {item.format !== "video" ? " · click to develop" : ""}
            </p>
          </div>
          {strip.length > 1 ? (
            <div className="pointer-events-auto hidden max-w-[min(52rem,55vw)] gap-1 overflow-x-auto md:flex">
              {strip.map((frame) => (
                <button
                  key={frame.id}
                  type="button"
                  onClick={() => onJump?.(frame.id)}
                  className={`h-12 w-12 shrink-0 overflow-hidden rounded border ${
                    frame.id === item.id ? "border-teal" : "border-white/20"
                  }`}
                >
                  {frame.previewUrl ? (
                    <img src={frame.previewUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          <div className="pointer-events-auto flex md:hidden">
            <button
              type="button"
              aria-label="Previous frame"
              disabled={atStart}
              onClick={onPrev}
              className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-foam disabled:opacity-20"
            >
              <Chevron direction="left" />
            </button>
            <button
              type="button"
              aria-label="Next frame"
              disabled={atEnd}
              onClick={onNext}
              className="ml-2 grid h-10 w-10 place-items-center rounded-full border border-white/10 text-foam disabled:opacity-20"
            >
              <Chevron direction="right" />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FullIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M2.5 6.5V2.5h4M13.5 6.5V2.5h-4M2.5 9.5v4h4M13.5 9.5v4h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ExitFullIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M6.5 2.5v4h-4M9.5 2.5v4h4M6.5 13.5v-4h-4M9.5 13.5v-4h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden className={direction === "left" ? "rotate-180" : ""}>
      <path d="M6.5 3.5 12 9l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function formatCapture(value: string): string {
  const millis = Date.parse(value);
  if (Number.isNaN(millis)) return value;
  return formatTimestamp(Math.floor(millis / 1000));
}
