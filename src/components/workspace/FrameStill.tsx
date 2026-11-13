import { useEffect, useState } from "react";
import { frameBackground } from "../../studio/catalog";

type FrameStillProps = {
  id: string;
  fileName: string;
  src: string | null | undefined;
  fit?: "cover" | "contain";
  className?: string;
};

export function FrameStill({ id, fileName, src, fit = "cover", className }: FrameStillProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  if (src && !failed) {
    return (
      <img
        key={src}
        src={src}
        alt={fileName}
        className={`h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"} ${className ?? ""}`}
        onError={() => setFailed(true)}
      />
    );
  }
  return <div className={`h-full w-full ${className ?? ""}`} style={{ background: frameBackground(id) }} />;
}
