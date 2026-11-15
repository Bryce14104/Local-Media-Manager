import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { sanitizeCrop, type CropRect } from "../../studio/develop";

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";

export function CropOverlay({
  crop,
  aspect,
  onChange,
}: {
  crop: CropRect;
  aspect: number | null;
  onChange: (crop: CropRect) => void;
}) {
  const cropRef = useRef(crop);
  cropRef.current = crop;

  function begin(handle: Handle, event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const host = event.currentTarget.closest("[data-crop-stage]") as HTMLElement | null;
    if (!host) return;
    const stage = host;
    const origin = { x: event.clientX, y: event.clientY, crop: cropRef.current };
    event.currentTarget.setPointerCapture(event.pointerId);

    function onMove(next: PointerEvent) {
      const rect = stage.getBoundingClientRect();
      const dx = (next.clientX - origin.x) / rect.width;
      const dy = (next.clientY - origin.y) / rect.height;
      onChange(resizeCrop(origin.crop, handle, dx, dy, aspect));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const handles: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  return (
    <div className="absolute inset-0">
      <div
        className="absolute cursor-move border border-teal shadow-[0_0_0_9999px_rgba(0,0,0,0.48)]"
        style={{
          left: `${crop.x * 100}%`,
          top: `${crop.y * 100}%`,
          width: `${crop.width * 100}%`,
          height: `${crop.height * 100}%`,
        }}
        onPointerDown={(event) => begin("move", event)}
      >
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }).map((_, index) => (
            <span key={index} className="border border-white/20" />
          ))}
        </div>
        {handles.map((id) => (
          <button
            key={id}
            type="button"
            aria-label={`Crop ${id}`}
            className="absolute z-10 h-3 w-3 rounded-[1px] border border-[#0b0d10] bg-teal"
            style={handleStyle(id)}
            onPointerDown={(event) => begin(id, event)}
          />
        ))}
      </div>
    </div>
  );
}

function handleStyle(id: Handle): { left: string; top: string; cursor: string; transform: string } {
  const cursor =
    id === "n" || id === "s" ? "ns-resize" : id === "e" || id === "w" ? "ew-resize" : id === "ne" || id === "sw" ? "nesw-resize" : "nwse-resize";
  const left = id.includes("w") ? "0%" : id.includes("e") ? "100%" : "50%";
  const top = id.includes("n") ? "0%" : id.includes("s") ? "100%" : "50%";
  return { left, top, cursor, transform: "translate(-50%, -50%)" };
}

function resizeCrop(crop: CropRect, handle: Handle, dx: number, dy: number, aspect: number | null): CropRect {
  let { x, y, width, height } = crop;
  if (handle === "move") {
    return sanitizeCrop({ x: x + dx, y: y + dy, width, height }) ?? crop;
  }
  if (handle.includes("e")) width += dx;
  if (handle.includes("s")) height += dy;
  if (handle.includes("w")) {
    x += dx;
    width -= dx;
  }
  if (handle.includes("n")) {
    y += dy;
    height -= dy;
  }
  if (aspect && aspect > 0) {
    if (handle === "n" || handle === "s" || handle === "e" || handle === "w") {
      if (handle === "n" || handle === "s") width = height * aspect;
      else height = width / aspect;
    } else {
      height = width / aspect;
    }
    if (handle.includes("w")) x = crop.x + crop.width - width;
    if (handle.includes("n")) y = crop.y + crop.height - height;
  }
  return sanitizeCrop({ x, y, width, height }) ?? crop;
}
