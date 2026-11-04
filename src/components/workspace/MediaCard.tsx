import { frameBackground } from "../../studio/catalog";
import { gridMetrics } from "../../studio/gridZoom";
import { formatLabel } from "../../studio/query";
import type { StudioItem } from "../../studio/types";
import { formatBytes } from "../../lib/format";
import { Stars } from "./Stars";

type MediaCardProps = {
  item: StudioItem;
  zoom: number;
  detail: "compact" | "card";
  selected: boolean;
  primary: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onRate: (rating: number | null) => void;
  onFlag: () => void;
};

export function MediaCard({
  item,
  zoom,
  detail,
  selected,
  primary,
  onOpen,
  onToggle,
  onRate,
  onFlag,
}: MediaCardProps) {
  const { roomy, dense } = gridMetrics(zoom);
  const showMeta = detail === "card" ? !dense : roomy;
  return (
    <article
      className={`group relative overflow-hidden border bg-card ${dense ? "rounded-lg" : "rounded-xl"} ${
        primary ? "border-teal" : selected ? "border-teal/50" : "border-line"
      }`}
    >
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div
          className={roomy ? "aspect-[4/3]" : "aspect-square"}
          style={{ background: frameBackground(item.id) }}
        />
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

      <div
        className={`pointer-events-none absolute inset-x-0 flex justify-start px-1.5 ${
          showMeta ? (roomy ? "bottom-[4.4rem]" : "bottom-12") : "bottom-7"
        } ${dense ? "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" : ""}`}
      >
        <div className="pointer-events-auto rounded-full bg-studio/80 px-1">
          <Stars rating={item.rating} onChange={onRate} compact={!roomy} />
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
