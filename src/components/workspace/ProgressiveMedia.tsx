import { useEffect, useRef, useState } from "react";
import type { StudioItem } from "../../studio/types";
import { FrameStill } from "./FrameStill";

type ProgressiveMediaProps = {
  item: StudioItem;
  fit?: "cover" | "contain";
  playback?: "hold" | "play";
  quality?: "proxy" | "full";
  className?: string;
  onSize?: (width: number, height: number) => void;
};

type Layer = {
  id: string;
  still: string;
  video: string | null;
};

export function ProgressiveMedia({
  item,
  fit = "contain",
  playback = "hold",
  quality = "proxy",
  className,
  onSize,
}: ProgressiveMediaProps) {
  const stillSrc = item.proxyUrl ?? item.previewUrl ?? null;
  const videoSrc = item.format === "video" ? (item.playUrl ?? null) : null;
  const fullSrc = quality === "full" && item.format !== "video" ? (item.inspectUrl ?? null) : null;
  const [layer, setLayer] = useState<Layer | null>(() =>
    stillSrc || videoSrc ? { id: item.id, still: stillSrc ?? "", video: videoSrc } : null,
  );
  const [fullReady, setFullReady] = useState<string | null>(null);
  const [paused, setPaused] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const incoming = useRef(0);
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;

  useEffect(() => {
    const token = incoming.current + 1;
    incoming.current = token;
    setPaused(true);
    setFullReady(null);
    if (!stillSrc) {
      setLayer(videoSrc ? { id: item.id, still: "", video: videoSrc } : null);
      return;
    }
    let cancel = false;
    const image = new Image();
    image.decoding = "sync";
    const commit = (src: string) => {
      if (cancel || incoming.current !== token) return;
      setLayer({ id: item.id, still: src, video: videoSrc });
      if (image.naturalWidth > 0) onSizeRef.current?.(image.naturalWidth, image.naturalHeight);
    };
    image.onload = () => {
      const decoded = image.decode?.();
      if (decoded) void decoded.then(() => commit(stillSrc)).catch(() => commit(stillSrc));
      else commit(stillSrc);
    };
    image.onerror = () => {
      if (cancel || incoming.current !== token) return;
      const fallback = item.previewUrl && item.previewUrl !== stillSrc ? item.previewUrl : null;
      if (fallback) commit(fallback);
      else if (videoSrc) setLayer({ id: item.id, still: "", video: videoSrc });
    };
    image.src = stillSrc;
    if (image.complete && image.naturalWidth > 0) commit(stillSrc);
    return () => {
      cancel = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [item.id, stillSrc, videoSrc, item.previewUrl]);

  useEffect(() => {
    if (!fullSrc || fullSrc === layer?.still) {
      setFullReady(null);
      return;
    }
    let cancel = false;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (cancel) return;
      setFullReady(fullSrc);
      if (image.naturalWidth > 0) onSizeRef.current?.(image.naturalWidth, image.naturalHeight);
    };
    image.onerror = () => {
      if (!cancel) setFullReady(null);
    };
    image.src = fullSrc;
    return () => {
      cancel = true;
    };
  }, [fullSrc, layer?.still, item.id]);

  const fitClass = fit === "cover" ? "h-full w-full object-cover" : "h-full w-full object-contain";
  const shownVideo = layer?.video ?? null;

  async function togglePlay(event?: { stopPropagation: () => void }) {
    event?.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (video.ended || video.currentTime >= Math.max(0, (video.duration || 0) - 0.05)) {
      video.currentTime = 0;
    }
    try {
      video.muted = false;
      await video.play();
    } catch {
      video.muted = true;
      await video.play().catch(() => undefined);
    }
  }

  if (!layer?.still && !shownVideo) {
    return <FrameStill id={item.id} fileName={item.fileName} src={null} fit={fit} className={className} />;
  }

  return (
    <div className={`relative h-full w-full overflow-hidden bg-black ${className ?? ""}`}>
      {layer?.still ? (
        <img src={layer.still} alt={item.fileName} draggable={false} className={`absolute inset-0 ${fitClass}`} />
      ) : null}
      {fullReady && fullReady !== layer?.still ? (
        <img src={fullReady} alt="" draggable={false} className={`absolute inset-0 ${fitClass}`} />
      ) : null}
      {shownVideo ? (
        <div
          className="absolute inset-0"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
        >
          <video
            ref={videoRef}
            key={`${layer?.id}:${shownVideo}`}
            src={shownVideo}
            poster={layer?.still || undefined}
            controls
            playsInline
            preload="auto"
            className={`absolute inset-0 ${fitClass}`}
            onLoadedMetadata={(event) => onSize?.(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onEnded={() => setPaused(true)}
          />
          {playback === "play" && paused ? (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-black/15">
              <button
                type="button"
                aria-label="Play"
                onClick={(event) => void togglePlay(event)}
                className="pointer-events-auto grid h-20 w-20 place-items-center rounded-full bg-black/70 text-white shadow-lg ring-1 ring-white/20"
              >
                <svg width="28" height="32" viewBox="0 0 28 32" aria-hidden>
                  <path d="M4 2.5v27L25 16 4 2.5Z" fill="currentColor" />
                </svg>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
