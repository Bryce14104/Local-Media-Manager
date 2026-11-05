import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatTimestamp } from "../../lib/format";
import type { StudioItem } from "../../studio/types";
import { FrameStill } from "./FrameStill";
import { Stars } from "./Stars";

type LightboxProps = {
  item: StudioItem;
  index: number;
  count: number;
  direction: "open" | "next" | "prev";
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRate: (rating: number | null) => void;
};

export function Lightbox({ item, index, count, direction, onClose, onPrev, onNext, onRate }: LightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragX = useRef<number | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    setNatural(null);
  }, [item.id]);

  const width = item.width ?? natural?.width ?? null;
  const height = item.height ?? natural?.height ?? null;
  const captured = formatCapture(item.capturedAt);
  const atStart = index <= 0;
  const atEnd = index >= count - 1;

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
      role="dialog"
      aria-modal="true"
      aria-label={item.fileName}
      className="fixed inset-0 z-50 flex flex-col bg-[#07080b] text-foam"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(46,224,197,0.07),transparent_58%)]" />
      <header className="relative z-10 flex items-center justify-between gap-3 px-4 py-3 md:px-6">
        <p className="font-mono text-xs tracking-wide text-mute">
          {index + 1} / {count}
        </p>
        <p className="hidden font-mono text-[10px] tracking-[0.16em] text-white/35 sm:block">arrows move · esc closes</p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-foam transition hover:border-teal hover:text-teal"
        >
          Close
        </button>
      </header>

      <div className="relative z-10 min-h-0 flex-1">
        <button
          type="button"
          aria-label="Previous frame"
          disabled={atStart}
          onClick={onPrev}
          className="absolute left-3 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/45 text-foam backdrop-blur-sm transition hover:border-teal hover:text-teal disabled:pointer-events-none disabled:opacity-20 md:grid"
        >
          <Chevron direction="left" />
        </button>
        <button
          type="button"
          aria-label="Next frame"
          disabled={atEnd}
          onClick={onNext}
          className="absolute right-3 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/45 text-foam backdrop-blur-sm transition hover:border-teal hover:text-teal disabled:pointer-events-none disabled:opacity-20 md:grid"
        >
          <Chevron direction="right" />
        </button>

        <div
          key={`${item.id}-${direction}`}
          className={`flex h-full items-center justify-center px-3 md:px-20 ${
            direction === "next" ? "lightbox-next" : direction === "prev" ? "lightbox-prev" : "lightbox-open"
          }`}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragX.current = null;
          }}
        >
          <ViewerStill item={item} onSize={(width, height) => setNatural({ width, height })} />
        </div>
      </div>

      <footer className="relative z-10 bg-gradient-to-t from-black via-black/75 to-transparent px-4 pb-5 pt-12 md:px-8">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-base font-medium tracking-tight">{item.fileName}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute">
              <span>{captured}</span>
              <span className="font-mono">{width && height ? `${width} × ${height}` : "—"}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex md:hidden">
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
            <div className="rounded-full bg-black/40 px-1">
              <Stars rating={item.rating} onChange={onRate} />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ViewerStill({
  item,
  onSize,
}: {
  item: StudioItem;
  onSize: (width: number, height: number) => void;
}) {
  const full = item.inspectUrl ?? null;
  const preview = item.previewUrl ?? null;
  const same = full != null && full === preview;
  const [fullReady, setFullReady] = useState(false);
  const [fullFailed, setFullFailed] = useState(false);

  useEffect(() => {
    setFullReady(false);
    setFullFailed(false);
  }, [item.id, full]);

  if (item.format === "video" && full) {
    return (
      <video
        key={full}
        src={full}
        poster={preview ?? undefined}
        controls
        className="max-h-full max-w-full rounded-md"
        onLoadedMetadata={(event) => onSize(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
      />
    );
  }

  const showFull = Boolean(full) && !same && !fullFailed;
  const base = preview ?? (full && !fullFailed ? full : null);
  if (!base) {
    return (
      <div className="h-[70%] w-full max-w-5xl overflow-hidden rounded-lg">
        <FrameStill id={item.id} fileName={item.fileName} src={null} fit="contain" />
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <img
        src={base}
        alt={showFull ? "" : item.fileName}
        className={`max-h-full max-w-full rounded-md object-contain shadow-[0_24px_80px_rgba(0,0,0,0.45)] transition-opacity duration-300 ${
          showFull && fullReady ? "opacity-0" : "opacity-100"
        }`}
        onLoad={(event) => {
          if (!showFull || !fullReady) onSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
        }}
      />
      {showFull && full ? (
        <img
          src={full}
          alt={item.fileName}
          className={`absolute max-h-full max-w-full rounded-md object-contain shadow-[0_24px_80px_rgba(0,0,0,0.45)] transition-opacity duration-500 ${
            fullReady ? "opacity-100" : "opacity-0"
          }`}
          onLoad={(event) => {
            setFullReady(true);
            onSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
          }}
          onError={() => setFullFailed(true)}
        />
      ) : null}
    </div>
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
