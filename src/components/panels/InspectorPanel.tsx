import type { PointerEvent as ReactPointerEvent } from "react";
import { ProgressiveMedia } from "../workspace/ProgressiveMedia";
import { formatLatitude, formatLongitude } from "../../studio/geo";
import { formatLabel, isoFill, shutterFill } from "../../studio/query";
import type { PanelMode, StudioItem } from "../../studio/types";
import { formatBytes, formatTimestamp } from "../../lib/format";
import { Stars } from "../workspace/Stars";

type InspectorPanelProps = {
  item: StudioItem | null;
  mode: Exclude<PanelMode, "hidden">;
  collapsed: boolean;
  position: { x: number; y: number };
  onPosition: (position: { x: number; y: number }) => void;
  onCollapse: () => void;
  onMode: (mode: PanelMode) => void;
  onRate: (rating: number | null) => void;
  onColor?: (color: StudioItem["colorLabel"]) => void;
  onRotate?: () => void;
  onNotes?: (notes: string) => void;
  onKeywords?: (keywords: string[]) => void;
  onReveal?: () => void;
  onCopyPath?: () => void;
  onEdit?: () => void;
};

export function InspectorPanel({
  item,
  mode,
  collapsed,
  position,
  onPosition,
  onCollapse,
  onMode,
  onRate,
  onColor,
  onRotate,
  onNotes,
  onKeywords,
  onReveal,
  onCopyPath,
  onEdit,
}: InspectorPanelProps) {
  const floating = mode === "floating";
  return (
    <aside
      className={`flex flex-col border-line bg-card ${
        floating
          ? "fixed z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border shadow-2xl shadow-black/40"
          : "w-full shrink-0 border-t md:w-80 md:border-t-0 md:border-l"
      }`}
      style={floating ? { left: position.x, top: position.y } : undefined}
    >
      <header
        className={`flex items-center justify-between gap-2 border-b border-line px-3 py-2 ${
          floating ? "cursor-grab" : ""
        }`}
        onPointerDown={floating ? (event) => startDrag(event, position, onPosition) : undefined}
      >
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-mute">Info</p>
          <p className="truncate text-sm">{item ? item.fileName : "No frame"}</p>
        </div>
        <div className="flex items-center gap-1">
          <PanelButton label={collapsed ? "Expand" : "Collapse"} onClick={onCollapse} />
          <PanelButton label={floating ? "Dock" : "Float"} onClick={() => onMode(floating ? "docked" : "floating")} />
          <PanelButton label="Hide" onClick={() => onMode("hidden")} />
        </div>
      </header>
      {!collapsed ? (
        item ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
            <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-studio">
              <ProgressiveMedia item={item} fit="contain" playback="hold" />
            </div>
            {onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="w-full rounded-full bg-teal px-3 py-2 text-sm font-medium text-teal-ink"
              >
                {item.format === "video" ? "Grade clip" : "Develop"}
              </button>
            ) : !item.originalOnline ? (
              <p className="rounded-xl bg-raised px-3 py-2 text-xs text-mute">
                {item.plugHint ?? "Plug the drive back in to develop this photo."}
              </p>
            ) : null}
            {item.matchReasons && item.matchReasons.length > 0 ? (
              <p className="text-xs text-mute">{item.matchReasons.join(" · ")}</p>
            ) : null}
            {item.virtualCopy ? <p className="text-xs text-teal">Virtual copy</p> : null}
            <Stars rating={item.rating} onChange={onRate} />
            <div className="flex flex-wrap gap-1.5">
              {(["red", "yellow", "green", "blue", "purple"] as const).map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={color}
                  onClick={() => onColor?.(item.colorLabel === color ? null : color)}
                  className={`h-5 w-5 rounded-full border ${item.colorLabel === color ? "border-foam" : "border-line"}`}
                  style={{
                    background:
                      color === "red"
                        ? "#ef4444"
                        : color === "yellow"
                          ? "#eab308"
                          : color === "green"
                            ? "#22c55e"
                            : color === "blue"
                              ? "#3b82f6"
                              : "#a855f7",
                  }}
                />
              ))}
              {onRotate ? (
                <button type="button" onClick={onRotate} className="rounded-full border border-line px-2 text-[11px]">
                  Rotate
                </button>
              ) : null}
            </div>
            {onNotes ? (
              <label className="block text-xs text-mute">
                Notes
                <textarea
                  defaultValue={item.notes}
                  key={item.id}
                  onBlur={(event) => onNotes(event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-line bg-studio px-2 py-1.5 text-sm text-foam outline-none focus:border-teal"
                />
              </label>
            ) : null}
            {onKeywords ? (
              <label className="block text-xs text-mute">
                Keywords
                <input
                  defaultValue={item.keywords.join(", ")}
                  key={`${item.id}-kw`}
                  onBlur={(event) =>
                    onKeywords(
                      event.target.value
                        .split(",")
                        .map((word) => word.trim())
                        .filter(Boolean),
                    )
                  }
                  placeholder="gold coast, drone"
                  className="mt-1 w-full rounded-xl border border-line bg-studio px-2 py-1.5 text-sm text-foam outline-none focus:border-teal"
                />
              </label>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {onCopyPath ? (
                <button type="button" onClick={onCopyPath} className="rounded-full border border-line px-2 py-1 text-[11px]">
                  Copy path
                </button>
              ) : null}
              {onReveal ? (
                <button type="button" onClick={onReveal} className="rounded-full border border-line px-2 py-1 text-[11px]">
                  Reveal in Finder
                </button>
              ) : null}
            </div>
            {item.volumeLabel ? (
              <p className="text-xs text-mute">
                {item.originalOnline
                  ? `${item.volumeLabel} is connected`
                  : item.plugHint ?? `Plug in ${item.volumeLabel} for the original`}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <Tag>{formatLabel(item.format)}</Tag>
              <Tag>{item.camera}</Tag>
              {item.focalLength ? <Tag>{item.focalLength}</Tag> : null}
              {item.aperture ? <Tag>{item.aperture}</Tag> : null}
            </div>
            <Histogram bins={item.histogram} />
            <div className="grid gap-3">
              <Gauge label="ISO" value={item.iso == null ? "—" : String(item.iso)} fill={isoFill(item.iso)} />
              <Gauge label="Shutter" value={item.shutter ?? "—"} fill={shutterFill(item.shutter)} />
            </div>
            <dl className="space-y-2 text-xs">
              <Fact label="Path" value={`${item.folder}/${item.fileName}`} />
              {item.geotagged ? (
                <Fact label="GPS" value={`${formatLatitude(item.latitude)} ${formatLongitude(item.longitude)}`} />
              ) : null}
              {item.subjects.length > 0 ? (
                <Fact
                  label="Subjects"
                  value={[...new Set(item.subjects.map((tag) => tag.label))].join(", ")}
                />
              ) : null}
              <Fact label="Lens" value={item.lens} />
              <Fact label="Size" value={formatBytes(item.fileSize)} />
              <Fact
                label="Frame"
                value={item.width && item.height ? `${item.width} × ${item.height}` : "—"}
              />
              <Fact
                label="Captured"
                value={formatTimestamp(Math.floor(new Date(item.capturedAt).getTime() / 1000))}
              />
              <Fact label="SHA-256" value={item.hash} mono />
            </dl>
          </div>
        ) : (
          <p className="p-4 text-sm text-mute">Select a frame to read its EXIF, histogram, and meters.</p>
        )
      ) : null}
    </aside>
  );
}

function startDrag(
  event: ReactPointerEvent<HTMLElement>,
  position: { x: number; y: number },
  onPosition: (position: { x: number; y: number }) => void,
) {
  if ((event.target as HTMLElement).closest("button")) return;
  const origin = { dx: event.clientX - position.x, dy: event.clientY - position.y };
  const target = event.currentTarget;
  target.setPointerCapture(event.pointerId);
  function move(next: PointerEvent) {
    onPosition({
      x: Math.max(8, next.clientX - origin.dx),
      y: Math.max(8, next.clientY - origin.dy),
    });
  }
  function up() {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
  }
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
}

function Histogram({ bins }: { bins: number[] }) {
  return (
    <div>
      <p className="text-xs text-mute">Luminance</p>
      <div className="mt-2 flex h-16 items-end gap-0.5 rounded-lg bg-studio px-2 py-2" aria-hidden>
        {bins.map((bin, index) => (
          <div
            key={index}
            className="flex-1 rounded-sm bg-teal"
            style={{ height: `${Math.max(6, Math.round(bin * 100))}%`, opacity: 0.45 + bin * 0.55 }}
          />
        ))}
      </div>
    </div>
  );
}

function Gauge({ label, value, fill }: { label: string; value: string; fill: number }) {
  const percent = Math.round(fill * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-mute">{label}</span>
        <span className="font-mono text-foam">{value}</span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-studio"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="h-full rounded-full bg-teal" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function Tag({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-line bg-raised px-2 py-0.5 text-[11px] text-mute">{children}</span>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-mute">{label}</dt>
      <dd className={`mt-0.5 break-all ${mono ? "font-mono text-[11px] leading-5" : "text-foam"}`}>{value}</dd>
    </div>
  );
}

function PanelButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-2 py-1 text-[11px] text-mute hover:bg-raised hover:text-foam"
    >
      {label}
    </button>
  );
}
