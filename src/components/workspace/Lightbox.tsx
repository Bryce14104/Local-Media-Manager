import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
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
  onOriginal?: () => void;
  onCopyPath?: () => void;
  onEdit?: () => void;
  onFlag?: (flag: "pick" | "reject" | "unflagged") => void;
  onRate?: (rating: number | null) => void;
  onSimilar?: () => void;
  comparePrevious?: boolean;
  onToggleCompare?: () => void;
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
  onOriginal,
  onCopyPath,
  onEdit,
  onFlag,
  onRate,
  onSimilar,
  comparePrevious = false,
  onToggleCompare,
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
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!showSettings) return;
    function onPointer(event: PointerEvent) {
      if (settingsRef.current?.contains(event.target as Node)) return;
      setShowSettings(false);
    }
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [showSettings]);

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
      if (event.key === "0" && !onRate) setZoom(1);
      if (event.key === "z" || event.key === "Z") {
        event.preventDefault();
        setZoom((current) => (current > 1.05 ? 1 : 3));
      }
      if ((event.key === "c" || event.key === "C") && onToggleCompare) {
        event.preventDefault();
        onToggleCompare();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRate, onToggleCompare]);

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
    if (Math.abs(delta) < 10) {
      if (zoom > 1) {
        setZoom(1);
        return;
      }
      setImmersive((current) => !current);
      return;
    }
    if (zoom > 1) return;
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
        <div
          className={`h-full w-full ${comparePrevious && before ? "grid grid-cols-2" : ""}`}
          style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
        >
          {comparePrevious && before ? (
            <ProgressiveMedia item={before} fit="contain" playback="hold" quality="full" />
          ) : null}
          <ProgressiveMedia
            item={item}
            fit="contain"
            playback="play"
            quality={immersive || zoom > 1.05 ? "full" : "proxy"}
            onSize={(nextWidth, nextHeight) => setNatural({ width: nextWidth, height: nextHeight })}
          />
        </div>
      </div>

      <header
        className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-3 py-3 md:px-4 ${
          immersive ? "bg-transparent" : "bg-gradient-to-b from-black/70 to-transparent"
        }`}
      >
        {immersive ? null : (
          <p className="min-w-0 flex-1 truncate text-sm text-white/80">
            {item.fileName}
            <span className="ml-2 font-mono text-[11px] text-white/45">
              {index + 1} / {count}
              {slideshow ? " · playing" : ""}
            </span>
          </p>
        )}
        <div
          className={`pointer-events-auto flex max-w-full flex-wrap items-center justify-end gap-0.5 rounded-full border border-white/12 bg-black/50 p-1 backdrop-blur-md ${
            immersive ? "ml-auto" : ""
          }`}
        >
          {onEdit && !immersive ? (
            <BarLabel onClick={onEdit} accent>
              Edit
            </BarLabel>
          ) : null}
          {onSimilar && !immersive ? <BarLabel onClick={onSimilar}>Similar</BarLabel> : null}
          <div className="relative" ref={settingsRef}>
            <div className="flex overflow-hidden rounded-full border border-white/10">
              <button
                type="button"
                onClick={() => setSlideshow((current) => !current)}
                className={`px-3 py-1.5 text-xs ${slideshow ? "bg-teal text-teal-ink" : "text-foam hover:bg-white/10"}`}
              >
                {slideshow ? "Pause" : "Slideshow"}
              </button>
              <button
                type="button"
                aria-label="Slideshow settings"
                aria-expanded={showSettings}
                onClick={() => setShowSettings((current) => !current)}
                className="border-l border-white/10 px-2 text-foam hover:bg-white/10"
              >
                <Caret />
              </button>
            </div>
            {showSettings ? (
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-72 rounded-2xl border border-white/12 bg-[#171b22] p-3 text-foam shadow-2xl">
                <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-mute">Slideshow</p>
                <SlideshowControls settings={slideshowSettings} onChange={onSlideshow} />
              </div>
            ) : null}
          </div>
          {immersive ? null : <span className="mx-0.5 hidden h-4 w-px bg-white/15 sm:block" />}
          {immersive ? null : onRotate ? (
            <BarAction label="Rotate" onClick={onRotate}>
              <RotateIcon />
            </BarAction>
          ) : null}
          {immersive ? null : onCopyPath ? (
            <BarAction label="Copy path" onClick={onCopyPath}>
              <CopyIcon />
            </BarAction>
          ) : null}
          {immersive ? null : onReveal ? (
            <BarAction label="Show file" onClick={onReveal}>
              <RevealIcon />
            </BarAction>
          ) : null}
          {immersive ? null : onOriginal ? (
            <BarLabel onClick={onOriginal}>{item.originalOnline ? "Original" : "Full res"}</BarLabel>
          ) : null}
          {!clip ? (
            <BarAction label={immersive ? "Exit fullscreen" : "Full screen"} onClick={() => void toggleFullscreen()}>
              {immersive ? <ExitFullIcon /> : <FullIcon />}
            </BarAction>
          ) : null}
          {immersive ? null : (
            <>
              <span className="mx-0.5 hidden h-4 w-px bg-white/15 sm:block" />
              <BarIcon label="Close" onClick={onClose} buttonRef={closeRef}>
                <CloseIcon />
              </BarIcon>
            </>
          )}
        </div>
      </header>

      {immersive ? null : (
        <>
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
        </>
      )}

      {immersive ? null : (
      <footer
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-3 pt-12 ${
          clip ? "pb-16 md:pb-20" : "pb-3"
        }`}
      >
        {onFlag || onRate ? (
          <div className="pointer-events-auto mb-2 flex justify-center gap-1">
            {onFlag ? (
              <>
                <Hud onClick={() => onFlag("pick")} active={item.flag === "pick"}>
                  Pick
                </Hud>
                <Hud onClick={() => onFlag("reject")} active={item.flag === "reject"}>
                  Reject
                </Hud>
              </>
            ) : null}
            {onRate
              ? [1, 2, 3, 4, 5].map((value) => (
                  <Hud key={value} onClick={() => onRate(item.rating === value ? null : value)} active={item.rating === value}>
                    {value}
                  </Hud>
                ))
              : null}
            {onToggleCompare && before ? (
              <Hud onClick={onToggleCompare} active={comparePrevious}>
                Two-up
              </Hud>
            ) : null}
            <Hud onClick={() => setZoom((current) => (current > 1.05 ? 1 : 3))} active={zoom > 1.05}>
              1:1
            </Hud>
          </div>
        ) : null}
        {item.matchReasons && item.matchReasons.length > 0 ? (
          <p className="mb-1 text-center text-[11px] text-white/55">{item.matchReasons.join(" · ")}</p>
        ) : null}
        <p className="pointer-events-none mb-2 hidden truncate px-1 font-mono text-[11px] text-white/50 md:block">
          {captured}
          {width && height ? ` · ${width} × ${height}` : ""}
          {item.camera && item.camera !== "Unknown camera" ? ` · ${item.camera}` : ""}
        </p>
        {strip.length > 1 ? (
          <Filmstrip items={strip} currentId={item.id} onJump={onJump} />
        ) : null}
        <div className="pointer-events-auto mt-2 flex justify-center md:hidden">
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
      </footer>
      )}
    </div>
  );
}

function Filmstrip({
  items,
  currentId,
  onJump,
}: {
  items: StudioItem[];
  currentId: string;
  onJump?: (id: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = scroller.current?.querySelector(`[data-strip="${CSS.escape(currentId)}"]`);
    if (node instanceof HTMLElement) {
      node.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }
  }, [currentId]);
  return (
    <div ref={scroller} className="pointer-events-auto flex gap-1 overflow-x-auto">
      {items.map((frame) => (
        <button
          key={frame.id}
          type="button"
          data-strip={frame.id}
          onClick={() => onJump?.(frame.id)}
          className={`h-14 w-14 shrink-0 overflow-hidden rounded-md ${
            frame.id === currentId ? "ring-2 ring-teal ring-offset-1 ring-offset-black" : "opacity-65 hover:opacity-100"
          }`}
        >
          {frame.previewUrl ? (
            <img src={frame.previewUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </button>
      ))}
    </div>
  );
}

function Hud({
  children,
  onClick,
  active,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] ${active ? "bg-teal text-teal-ink" : "border border-white/15 bg-black/40 text-white/80"}`}
    >
      {children}
    </button>
  );
}

function BarLabel({
  children,
  onClick,
  accent,
}: {
  children: ReactNode;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium ${
        accent ? "bg-teal text-teal-ink" : "text-foam hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function BarAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs text-foam/90 hover:bg-white/10 hover:text-teal"
    >
      <span className="opacity-80">{children}</span>
      {label}
    </button>
  );
}

function BarIcon({
  label,
  onClick,
  children,
  buttonRef,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-full text-foam hover:bg-white/10 hover:text-teal"
    >
      {children}
    </button>
  );
}

function Caret() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function RotateIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M3.5 8A4.5 4.5 0 1 0 8 3.5h1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M7 1.5 9.5 3.5 7 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <rect x="4.5" y="4.5" width="7" height="8" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 9.5V2.8A1.3 1.3 0 0 1 3.8 1.5H9" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function RevealIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M2 11.5V4.2L6.2 2.5H12v9H2z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 6.5h10" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
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
