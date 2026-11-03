import { frameBackground } from "../../studio/catalog";
import { formatLabel } from "../../studio/query";
import type { StudioItem } from "../../studio/types";
import { formatBytes } from "../../lib/format";
import { Stars } from "./Stars";

type MediaCardProps = {
  item: StudioItem;
  density: "compact" | "card";
  selected: boolean;
  primary: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onRate: (rating: number | null) => void;
  onFlag: () => void;
};

export function MediaCard({
  item,
  density,
  selected,
  primary,
  onOpen,
  onToggle,
  onRate,
  onFlag,
}: MediaCardProps) {
  const compact = density === "compact";
  return (
    <article
      className={`relative overflow-hidden rounded-xl border bg-card ${
        primary ? "border-teal" : selected ? "border-teal/50" : "border-line"
      }`}
    >
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div
          className={compact ? "aspect-square" : "aspect-[4/3]"}
          style={{ background: frameBackground(item.id) }}
        />
        {!compact ? (
          <div className="space-y-1 px-3 py-3">
            <p className="truncate text-sm font-medium">{item.fileName}</p>
            <p className="truncate text-xs text-mute">
              {item.camera} · {formatBytes(item.fileSize)}
            </p>
          </div>
        ) : (
          <p className="truncate px-2 py-2 text-xs text-mute">{item.fileName}</p>
        )}
      </button>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-2">
        <span className="pointer-events-auto rounded-md border border-white/15 bg-studio/75 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-foam">
          {formatLabel(item.format)}
        </span>
        <span className="pointer-events-auto flex items-center gap-1">
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onFlag();
            }}
            aria-label={flagTitle(item.flag)}
            title={flagTitle(item.flag)}
            className={`grid h-8 w-8 place-items-center rounded-md border text-sm ${flagClass(item.flag)}`}
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
            className={`grid h-8 w-8 place-items-center rounded-md border text-sm ${
              selected
                ? "border-teal bg-teal text-teal-ink"
                : "border-white/20 bg-studio/80 text-foam"
            }`}
          >
            {selected ? "✓" : "+"}
          </button>
        </span>
      </div>

      <div
        className={`pointer-events-none absolute inset-x-0 flex justify-start px-1.5 ${
          compact ? "bottom-7" : "bottom-[4.4rem]"
        }`}
      >
        <div className="pointer-events-auto rounded-full bg-studio/80 px-1">
          <Stars rating={item.rating} onChange={onRate} compact={compact} />
        </div>
      </div>
    </article>
  );
}

function flagClass(flag: StudioItem["flag"]): string {
  if (flag === "pick") return "border-teal bg-teal text-teal-ink";
  if (flag === "reject") return "border-danger/70 bg-danger/20 text-danger";
  return "border-white/20 bg-studio/75 text-foam";
}

function flagTitle(flag: StudioItem["flag"]): string {
  if (flag === "unflagged") return "Flag as pick";
  if (flag === "pick") return "Flag as reject";
  return "Clear flag";
}
