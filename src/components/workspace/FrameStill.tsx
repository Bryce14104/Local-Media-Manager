import { useState } from "react";
import { frameBackground } from "../../studio/catalog";

type FrameStillProps = {
  id: string;
  fileName: string;
  src: string | null | undefined;
  fit?: "cover" | "contain";
  className?: string;
};

export function FrameStill({ id, fileName, src, fit = "cover", className }: FrameStillProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt={fileName}
        className={`h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"} ${className ?? ""}`}
        onError={() => setFailedSrc(src)}
      />
    );
  }
  return <div className={`h-full w-full ${className ?? ""}`} style={{ background: frameBackground(id) }} />;
}
