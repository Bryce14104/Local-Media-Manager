import { stageStyle } from "../../studio/develop";
import { gridMetrics } from "../../studio/gridZoom";
import { formatLabel } from "../../studio/query";
import type { PointerMods } from "../../studio/selection";
import type { StudioItem } from "../../studio/types";
import { formatBytes } from "../../lib/format";
import { FrameStill } from "./FrameStill";

type MediaCardProps = {
  item: StudioItem;
  zoom: number;
  selected: boolean;
  primary: boolean;
  onOpen: (mods: PointerMods) => void;
  onToggle: () => void;
  onRate: (rating: number | null) => void;
  onFlag: () => void;
};

export function MediaCard({
  item,
  zoom,
  selected,
  primary,
  onOpen,
  onToggle,
  onFlag,
}: MediaCardProps) {
  const { roomy, dense } = gridMetrics(zoom);
  const showMeta = roomy;
  return (
    <article
      id={`frame-${item.id}`}
      data-filename={item.fileName}
      className={`group relative overflow-hidden border bg-card select-none [content-visibility:auto] [contain-intrinsic-size:240px] ${dense ? "rounded-lg" : "rounded-xl"} ${
        primary ? "border-teal" : selected ? "border-teal/50" : "border-line"
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
              className="absolute left-0 top-0 z-10 h-full w-1.5"
              style={{ background: colorSwatch(item.colorLabel) }}
            />
          ) : null}
          <div className="h-full w-full" style={stageStyle(item.rotation, item.develop)}>
            <FrameStill id={item.id} fileName={item.fileName} src={item.previewUrl} />
          </div>
          {item.format === "video" ? <PlayMark /> : null}
          {item.originalOnline ? null : (
            <span className="pointer-events-none absolute right-1 top-1 z-10 rounded bg-black/60 px-1 text-[10px] text-white/80">
              720p
            </span>
          )}
          {item.rating ? (
            <span className="pointer-events-none absolute bottom-1 left-1 z-10 rounded bg-black/55 px-1 font-mono text-[10px] text-gold">
              {"★".repeat(item.rating)}
            </span>
          ) : null}
        </div>
        {showMeta ? (
          <div className={roomy ? "space-y-1 px-3 py-3" : "space-y-0.5 px-2 py-2"}>
            <p className={`truncate font-medium ${roomy ? "text-sm" : "text-xs"}`}>{item.fileName}</p>
            <p className="truncate text-xs text-mute">
              {item.camera} · {formatBytes(item.fileSize)}
            </p>
          </div>
        ) : (
          <p className={`truncate text-mute ${dense ? "px-1.5 py-1 text-[10px]" : "px-2 py-2 text-xs"}`}>{item.fileName}</p>
        )}
      </button>

      <div className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between ${dense ? "gap-1 p-1" : "gap-2 p-2"}`}>
        {dense ? null : (
          <span className="pointer-events-auto rounded-md border border-white/15 bg-studio/75 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-foam">
            {formatLabel(item.format)}
          </span>
        )}
        <span className="pointer-events-auto ml-auto flex items-center gap-1">
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onFlag();
            }}
            aria-label={flagTitle(item.flag)}
            title={flagTitle(item.flag)}
            className={`grid place-items-center rounded-md border ${dense ? "h-5 w-5 text-[10px]" : "h-8 w-8 text-sm"} ${flagClass(item.flag)}`}
          >
            {item.flag === "reject" ? "×" : "⚑"}
          </button>
          <button
            type="button"
            aria-pressed={selected}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            aria-label={selected ? "Remove from selection" : "Add to selection"}
            className={`grid place-items-center rounded-md border ${dense ? "h-5 w-5 text-[10px]" : "h-8 w-8 text-sm"} ${
              selected
                ? "border-teal bg-teal text-teal-ink"
                : "border-white/20 bg-studio/80 text-foam"
            }`}
          >
            {selected ? "✓" : "+"}
          </button>
        </span>
      </div>

    </article>
  );
}

function PlayMark() {
  return (
    <span className="pointer-events-none absolute bottom-2 right-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white shadow-sm">
      <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden>
        <path d="M1.2 1.1v9.8L8.8 6 1.2 1.1Z" fill="currentColor" />
      </svg>
    </span>
  );
}

function flagClass(flag: StudioItem["flag"]): string {
  if (flag === "pick") return "border-teal bg-teal text-teal-ink";
  if (flag === "reject") return "border-danger/70 bg-danger/20 text-danger";
  return "border-white/20 bg-studio/75 text-foam";
}

function colorSwatch(color: StudioItem["colorLabel"]): string {
  if (color === "red") return "#ef4444";
  if (color === "yellow") return "#eab308";
  if (color === "green") return "#22c55e";
  if (color === "blue") return "#3b82f6";
  if (color === "purple") return "#a855f7";
  return "transparent";
}

function flagTitle(flag: StudioItem["flag"]): string {
  if (flag === "unflagged") return "Flag as pick";
  if (flag === "pick") return "Flag as reject";
  return "Clear flag";
}
