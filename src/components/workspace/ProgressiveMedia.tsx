import { useEffect, useRef, useState } from "react";
import { playableUrl } from "../../lib/api";
import { stageStyle } from "../../studio/develop";
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
  const wantsVideo = item.format === "video";
  const fullSrc = quality === "full" && item.format !== "video" ? (item.inspectUrl ?? null) : null;
  const [layer, setLayer] = useState<Layer | null>(() => (stillSrc ? { id: item.id, still: stillSrc } : null));
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [fullReady, setFullReady] = useState<string | null>(null);
  const [paused, setPaused] = useState(true);
  const [showingVideo, setShowingVideo] = useState(false);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wantPlay = useRef(false);
  const incoming = useRef(0);
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;

  useEffect(() => {
    const token = incoming.current + 1;
    incoming.current = token;
    setPaused(true);
    setShowingVideo(false);
    setFullReady(null);
    setBlobSrc(null);
    if (!stillSrc) {
      setLayer(null);
    } else {
      let cancel = false;
      const image = new Image();
      image.decoding = "sync";
      const commit = (src: string) => {
        if (cancel || incoming.current !== token) return;
        setLayer({ id: item.id, still: src });
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
        else setLayer(null);
      };
      image.src = stillSrc;
      if (image.complete && image.naturalWidth > 0) commit(stillSrc);
      return () => {
        cancel = true;
        image.onload = null;
        image.onerror = null;
      };
    }
    return undefined;
  }, [item.id, stillSrc, item.previewUrl]);

  useEffect(() => {
    if (!wantsVideo) {
      setBlobSrc(null);
      return;
    }
    let cancel = false;
    void playableUrl(item.playFile, item.playUrl).then((url) => {
      if (!cancel) setBlobSrc(url);
    });
    return () => {
      cancel = true;
    };
  }, [item.id, item.playFile, item.playUrl, wantsVideo]);

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

  async function startVideo(video: HTMLVideoElement) {
    if (video.ended || video.currentTime >= Math.max(0, (video.duration || 0) - 0.05)) {
      video.currentTime = 0;
    }
    try {
      video.muted = false;
      await video.play();
    } catch {
      video.muted = true;
      await video.play().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!blobSrc || !wantPlay.current) return;
    const video = videoRef.current;
    if (video) void startVideo(video);
  }, [blobSrc]);

  async function togglePlay(event?: { stopPropagation: () => void }) {
    event?.stopPropagation();
    const video = videoRef.current;
    if (video && !video.paused && showingVideo) {
      wantPlay.current = false;
      video.pause();
      return;
    }
    wantPlay.current = true;
    setBusy(true);
    if (!blobSrc) {
      const url = await playableUrl(item.playFile, item.playUrl);
      if (url) setBlobSrc(url);
      return;
    }
    if (video) await startVideo(video);
    else setBusy(false);
  }

  if (!layer?.still && !wantsVideo) {
    return <FrameStill id={item.id} fileName={item.fileName} src={null} fit={fit} className={className} />;
  }

  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-black ${className ?? ""}`}
      style={stageStyle(item.rotation, item.develop)}
    >
      {layer?.still ? (
        <img src={layer.still} alt={item.fileName} draggable={false} className={`absolute inset-0 ${fitClass}`} />
      ) : (
        <FrameStill id={item.id} fileName={item.fileName} src={null} fit={fit} />
      )}
      {fullReady && fullReady !== layer?.still ? (
        <img src={fullReady} alt="" draggable={false} className={`absolute inset-0 ${fitClass}`} />
      ) : null}
      {wantsVideo ? (
        <div
          className="absolute inset-0"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
        >
          {blobSrc ? (
            <video
              ref={videoRef}
              key={`${item.id}:${blobSrc}`}
              src={blobSrc}
              playsInline
              preload="auto"
              controls={showingVideo}
              className={`absolute inset-0 ${fitClass} ${showingVideo ? "opacity-100" : "opacity-0"}`}
              onLoadedMetadata={(event) => onSize?.(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
              onPlaying={() => {
                setShowingVideo(true);
                setPaused(false);
                setBusy(false);
              }}
              onPlay={() => {
                setPaused(false);
                setBusy(false);
              }}
              onPause={() => setPaused(true)}
              onEnded={() => {
                setPaused(true);
                setShowingVideo(false);
              }}
            />
          ) : null}
          {playback === "play" && paused && !showingVideo ? (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
              <button
                type="button"
                aria-label="Play"
                disabled={busy && !blobSrc}
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
