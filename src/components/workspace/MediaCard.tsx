import { stageStyle } from "../../studio/develop";
import { gridMetrics } from "../../studio/gridZoom";
import type { PointerMods } from "../../studio/selection";
import type { StudioItem } from "../../studio/types";
import { FrameStill } from "./FrameStill";

type MediaCardProps = {
  item: StudioItem;
  zoom: number;
  selected: boolean;
  focused: boolean;
  selectMode: boolean;
  onOpen: (mods: PointerMods) => void;
  onToggle: () => void;
};

export function MediaCard({
  item,
  zoom,
  selected,
  focused,
  selectMode,
  onOpen,
  onToggle,
}: MediaCardProps) {
  const { roomy, dense } = gridMetrics(zoom);
  const showMeta = roomy;
  return (
    <article
      id={`frame-${item.id}`}
      data-filename={item.fileName}
      className={`group relative overflow-hidden border bg-card select-none [content-visibility:auto] [contain-intrinsic-size:240px] hover:[&_.js-check]:opacity-100 ${dense ? "rounded-md" : "rounded-xl"} ${
        selected ? "border-teal" : focused ? "border-foam/50" : "border-transparent hover:border-line"
      }`}
    >
      <button
        type="button"
        data-open-frame
        onMouseDown={(event) => {
          if (event.shiftKey) event.preventDefault();
        }}
        onContextMenu={(event) => {
          if (event.ctrlKey) event.preventDefault();
        }}
        onClick={(event) => {
          const mods = { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey };
          if (mods.shift || mods.toggle) event.preventDefault();
          onOpen(mods);
        }}
        className="block w-full text-left"
      >
        <div className={`relative ${roomy ? "aspect-[4/3]" : "aspect-square"}`}>
          {item.colorLabel ? (
            <span
              className="absolute left-0 top-0 z-10 h-full w-1"
              style={{ background: colorSwatch(item.colorLabel) }}
            />
          ) : null}
          <div className="h-full w-full [color-gamut:p3]" style={stageStyle(item.rotation, item.develop)}>
            <FrameStill id={item.id} fileName={item.fileName} src={item.previewUrl} />
          </div>
          {item.format === "video" ? <PlayMark /> : null}
          {item.burstSize && item.burstSize > 1 ? (
            <span className="pointer-events-none absolute left-1 top-1 z-10 rounded bg-black/60 px-1 text-[10px] text-white/85">
              {item.burstSize}
            </span>
          ) : null}
          {item.originalOnline ? null : (
            <span className="pointer-events-none absolute bottom-1 right-1 z-10 rounded bg-black/55 px-1 text-[10px] text-white/75">
              720p
            </span>
          )}
        </div>
        {showMeta ? (
          <div className="px-2 py-1.5">
            <p className="truncate text-xs text-foam">{item.fileName}</p>
          </div>
        ) : dense ? null : (
          <p className="truncate px-2 py-1 text-[11px] text-mute">{item.fileName}</p>
        )}
      </button>

      <button
        type="button"
        aria-pressed={selected}
        aria-label={selected ? "Deselect" : "Select"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        className={`js-check absolute right-1.5 top-1.5 z-20 grid h-6 w-6 place-items-center rounded-full border text-[11px] shadow-sm transition ${
          selected
            ? "border-teal bg-teal text-teal-ink opacity-100"
            : `border-white/80 bg-black/45 text-white ${selectMode ? "opacity-100" : "opacity-0"}`
        }`}
      >
        {selected ? "✓" : ""}
      </button>
    </article>
  );
}

function PlayMark() {
  return (
    <span className="pointer-events-none absolute bottom-2 left-2 z-10 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white">
      <svg width="9" height="11" viewBox="0 0 10 12" aria-hidden>
        <path d="M1.2 1.1v9.8L8.8 6 1.2 1.1Z" fill="currentColor" />
      </svg>
    </span>
  );
}

function colorSwatch(color: StudioItem["colorLabel"]): string {
  if (color === "red") return "#ef4444";
  if (color === "yellow") return "#eab308";
  if (color === "green") return "#22c55e";
  if (color === "blue") return "#3b82f6";
  if (color === "purple") return "#a855f7";
  return "transparent";
}
