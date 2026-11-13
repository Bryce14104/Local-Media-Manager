import { useEffect, useRef, useState } from "react";
import type { StudioItem } from "../../studio/types";
import { FrameStill } from "./FrameStill";

type ProgressiveMediaProps = {
  item: StudioItem;
  fit?: "cover" | "contain";
  playback?: "hold" | "play";
  className?: string;
  onSize?: (width: number, height: number) => void;
};

type Layer = {
  id: string;
  still: string;
  video: string | null;
  autoplay: boolean;
};

export function ProgressiveMedia({ item, fit = "contain", playback = "hold", className, onSize }: ProgressiveMediaProps) {
  const stillSrc = item.proxyUrl ?? item.previewUrl ?? (item.format === "video" ? null : item.inspectUrl) ?? null;
  const videoSrc = item.format === "video" ? (item.playUrl ?? item.inspectUrl ?? null) : null;
  const [layer, setLayer] = useState<Layer | null>(() => (stillSrc ? { id: item.id, still: stillSrc, video: videoSrc, autoplay: playback === "play" } : null));
  const [videoFailed, setVideoFailed] = useState(false);
  const incoming = useRef(0);
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;

  useEffect(() => {
    const token = incoming.current + 1;
    incoming.current = token;
    setVideoFailed(false);
    if (!stillSrc) {
      setLayer(
        videoSrc
          ? { id: item.id, still: "", video: videoSrc, autoplay: playback === "play" }
          : null,
      );
      return;
    }
    let cancel = false;
    const image = new Image();
    image.decoding = "sync";
    const commit = () => {
      if (cancel || incoming.current !== token) return;
      setLayer({ id: item.id, still: stillSrc, video: videoSrc, autoplay: playback === "play" });
      if (image.naturalWidth > 0) onSizeRef.current?.(image.naturalWidth, image.naturalHeight);
    };
    image.onload = () => {
      const decoded = image.decode?.();
      if (decoded) void decoded.then(commit).catch(commit);
      else commit();
    };
    image.onerror = () => {
      if (cancel || incoming.current !== token) return;
      const fallback = item.previewUrl && item.previewUrl !== stillSrc ? item.previewUrl : null;
      if (fallback) {
        setLayer({ id: item.id, still: fallback, video: videoSrc, autoplay: playback === "play" });
        return;
      }
      if (videoSrc) setLayer({ id: item.id, still: "", video: videoSrc, autoplay: playback === "play" });
    };
    image.src = stillSrc;
    if (image.complete && image.naturalWidth > 0) commit();
    return () => {
      cancel = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [item.id, stillSrc, videoSrc, playback, item.previewUrl]);

  const fitClass = fit === "cover" ? "h-full w-full object-cover" : "h-full w-full object-contain";
  const shownVideo = layer?.video && !videoFailed ? layer.video : null;

  if (!layer?.still && !shownVideo) {
    return <FrameStill id={item.id} fileName={item.fileName} src={null} fit={fit} className={className} />;
  }

  return (
    <div className={`relative h-full w-full overflow-hidden bg-black ${className ?? ""}`}>
      {layer?.still ? (
        <img src={layer.still} alt={item.fileName} draggable={false} className={`absolute inset-0 ${fitClass}`} />
      ) : null}
      {shownVideo ? (
        <video
          key={`${layer?.id}:${shownVideo}`}
          src={shownVideo}
          poster={layer?.still || undefined}
          controls
          playsInline
          preload="auto"
          autoPlay={layer?.autoplay}
          muted={layer?.autoplay}
          className={`absolute inset-0 ${fitClass}`}
          onLoadedMetadata={(event) => onSize?.(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
          onLoadedData={(event) => {
            if (layer?.autoplay) void event.currentTarget.play().catch(() => undefined);
          }}
          onError={() => {
            const fallback = item.inspectUrl;
            if (fallback && fallback !== shownVideo) {
              setLayer((current) => (current ? { ...current, video: fallback } : current));
              return;
            }
            setVideoFailed(true);
          }}
        />
      ) : null}
    </div>
  );
}
