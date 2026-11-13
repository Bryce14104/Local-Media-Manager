import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatTimestamp } from "../../lib/format";
import type { StudioItem } from "../../studio/types";
import { ProgressiveMedia } from "./ProgressiveMedia";

type LightboxProps = {
  item: StudioItem;
  before: StudioItem | null;
  after: StudioItem | null;
  index: number;
  count: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
};

export function Lightbox({ item, before, after, index, count, onClose, onPrev, onNext }: LightboxProps) {
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

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    setNatural(null);
  }, [item.id]);

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
        if (!video) return;
        event.stopPropagation();
        event.preventDefault();
        video.muted = false;
        if (video.paused) void video.play().catch(() => undefined);
        else video.pause();
      }
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
        <ProgressiveMedia
          item={item}
          fit="contain"
          playback="play"
          quality={immersive ? "full" : "proxy"}
          onSize={(nextWidth, nextHeight) => setNatural({ width: nextWidth, height: nextHeight })}
        />
      </div>

      <header
        className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 bg-gradient-to-b from-black/55 to-transparent px-3 py-2 md:px-4 ${
          immersive ? "opacity-0 transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100" : ""
        }`}
      >
        <p className="font-mono text-xs tracking-wide text-white/70">
          {index + 1} / {count}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={immersive ? "Exit full screen" : "Full screen"}
            onClick={() => void toggleFullscreen()}
            className="pointer-events-auto grid h-9 w-9 place-items-center rounded-md border border-white/15 bg-black/45 text-foam backdrop-blur-sm transition hover:border-teal hover:text-teal"
          >
            {immersive ? <ExitFullIcon /> : <FullIcon />}
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="pointer-events-auto rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-sm text-foam backdrop-blur-sm transition hover:border-teal hover:text-teal"
          >
            Close
          </button>
        </div>
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
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/60 to-transparent px-4 pb-4 pt-10 md:px-6 ${
          immersive ? "opacity-0 transition-opacity duration-200 hover:opacity-100" : ""
        }`}
      >
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium tracking-tight">{item.fileName}</p>
            <p className="mt-1 font-mono text-[11px] text-white/55">
              {captured}
              {width && height ? ` · ${width} × ${height}` : ""}
            </p>
          </div>
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
