import { useEffect, useState } from "react";
import type { StudioItem } from "../../studio/types";
import { FrameStill } from "./FrameStill";

type ProgressiveMediaProps = {
  item: StudioItem;
  fit?: "cover" | "contain";
  playback?: "hold" | "play";
  className?: string;
  onSize?: (width: number, height: number) => void;
};

const SETTLE_MS = 90;

export function ProgressiveMedia({ item, fit = "contain", playback = "hold", className, onSize }: ProgressiveMediaProps) {
  const full = item.inspectUrl ?? null;
  const [proxyFailed, setProxyFailed] = useState(false);
  const [settled, setSettled] = useState(false);
  const [fullReady, setFullReady] = useState(false);
  const [fullFailed, setFullFailed] = useState(false);

  useEffect(() => {
    setProxyFailed(false);
    setSettled(false);
    setFullReady(false);
    setFullFailed(false);
    const timer = window.setTimeout(() => setSettled(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [item.id, full]);

  const proxy = proxyFailed ? null : (item.proxyUrl ?? null);
  const preview = item.previewUrl ?? null;
  const video = item.format === "video" && Boolean(full) && full !== preview && full !== proxy;
  const base = proxy ?? preview ?? (video ? null : full);
  const fitClass = fit === "cover" ? "h-full w-full object-cover" : "max-h-full max-w-full object-contain";

  if (!base && !video) {
    return <FrameStill id={item.id} fileName={item.fileName} src={null} fit={fit} className={className} />;
  }

  return (
    <div className={`relative flex h-full w-full items-center justify-center ${className ?? ""}`}>
      {base ? (
        <img
          src={base}
          alt={fullReady ? "" : item.fileName}
          decoding="async"
          fetchPriority="high"
          className={`${fitClass} ${fullReady ? "opacity-0" : "opacity-100"}`}
          onLoad={(event) => {
            if (!fullReady) onSize?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
          }}
          onError={() => {
            if (proxy && base === proxy) setProxyFailed(true);
          }}
        />
      ) : (
        <FrameStill id={item.id} fileName={item.fileName} src={null} fit={fit} />
      )}
      {video && settled && full ? (
        <video
          key={`${item.id}:${full}`}
          src={full}
          poster={base ?? undefined}
          controls
          playsInline
          preload="auto"
          className={`absolute ${fitClass} ${fullReady ? "opacity-100" : "pointer-events-none opacity-0"}`}
          onLoadedMetadata={(event) => onSize?.(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
          onCanPlay={(event) => {
            setFullReady(true);
            onSize?.(event.currentTarget.videoWidth, event.currentTarget.videoHeight);
            if (playback !== "play") return;
            const video = event.currentTarget;
            void video.play().catch(() => {
              video.muted = true;
              void video.play().catch(() => undefined);
            });
          }}
          onError={() => setFullFailed(true)}
        />
      ) : null}
      {!video && settled && full && full !== base && !fullFailed ? (
        <img
          src={full}
          alt={item.fileName}
          decoding="async"
          fetchPriority="low"
          className={`absolute ${fitClass} transition-opacity duration-150 ${fullReady ? "opacity-100" : "opacity-0"}`}
          onLoad={(event) => {
            setFullReady(true);
            onSize?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
          }}
          onError={() => setFullFailed(true)}
        />
      ) : null}
    </div>
  );
}
