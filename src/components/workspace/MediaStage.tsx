import { useState } from "react";
import { formatMonth } from "../../studio/query";
import type { GeoBounds, StudioItem, ViewMode } from "../../studio/types";
import { MediaCard } from "./MediaCard";
import { MediaMap } from "./MediaMap";
import { MediaTray } from "./MediaTray";

type MediaStageProps = {
  items: StudioItem[];
  total: number;
  viewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
  selectedIds: string[];
  primaryId: string | null;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onRate: (id: string, rating: number | null) => void;
  onFlag: (id: string) => void;
  onClearFilters: () => void;
  filteredEmpty: boolean;
  onShowInfo: () => void;
  onRegion: (bounds: GeoBounds) => void;
  onCluster: (ids: string[], label: string) => void;
  selectingCache?: boolean;
  onCacheBounds?: (bounds: GeoBounds) => void;
  onCancelCache?: () => void;
  mapDocked?: boolean;
  className?: string;
};

const MODES: { id: ViewMode; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "cards", label: "Cards" },
  { id: "timeline", label: "Timeline" },
  { id: "map", label: "Map" },
];

export function MediaStage({
  items,
  total,
  viewMode,
  onViewMode,
  selectedIds,
  primaryId,
  onOpen,
  onToggle,
  onRate,
  onFlag,
  onClearFilters,
  filteredEmpty,
  onShowInfo,
  onRegion,
  onCluster,
  selectingCache = false,
  onCacheBounds,
  onCancelCache,
  mapDocked = false,
  className,
}: MediaStageProps) {
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const showMap = viewMode === "map" && !mapDocked;

  function selectOnMap(id: string) {
    onOpen(id);
    setFocus({ id, nonce: Date.now() });
  }
  return (
    <section className={`flex min-h-0 min-w-0 flex-1 flex-col ${className ?? ""}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <h1 className="text-sm font-medium">Workspace</h1>
          <p className="text-xs text-mute">
            {items.length === total
              ? `${total} frames on this machine`
              : `${items.length} of ${total} frames`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="View mode" className="flex rounded-full border border-line bg-card p-0.5">
            {MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={viewMode === mode.id}
                onClick={() => onViewMode(mode.id)}
                className={`rounded-full px-3 py-1 text-xs ${
                  viewMode === mode.id ? "bg-raised text-foam" : "text-mute hover:text-foam"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onShowInfo}
            className="rounded-full border border-line px-3 py-1 text-xs text-mute hover:text-foam"
          >
            Info
          </button>
        </div>
      </header>

      <div className={showMap ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "min-h-0 flex-1 overflow-auto px-4 pb-4"}>
        {showMap ? (
          <>
            <MediaMap
              items={items}
              primaryId={primaryId}
              focusRequest={focus}
              onOpen={selectOnMap}
              onRegion={onRegion}
              onCluster={onCluster}
              selectingCache={selectingCache}
              onCacheBounds={onCacheBounds}
              onCancelCache={onCancelCache}
              className="min-h-0 flex-1"
            />
            <MediaTray items={items} primaryId={primaryId} onSelect={selectOnMap} />
          </>
        ) : filteredEmpty ? (
          <div className="rounded-2xl border border-dashed border-line px-5 py-12 text-center">
            <p className="text-sm">No frames match these filters.</p>
            <button
              type="button"
              onClick={onClearFilters}
              className="mt-4 rounded-full bg-teal px-4 py-2 text-sm font-medium text-teal-ink"
            >
              Clear filters
            </button>
          </div>
        ) : viewMode === "map" ? (
          <Filmstrip
            items={items}
            selectedIds={selectedIds}
            primaryId={primaryId}
            onOpen={onOpen}
            onToggle={onToggle}
            onRate={onRate}
            onFlag={onFlag}
          />
        ) : viewMode === "timeline" ? (
          <Timeline
            items={items}
            selectedIds={selectedIds}
            primaryId={primaryId}
            onOpen={onOpen}
            onToggle={onToggle}
            onRate={onRate}
            onFlag={onFlag}
          />
        ) : (
          <Grid
            items={items}
            density={viewMode === "compact" ? "compact" : "card"}
            selectedIds={selectedIds}
            primaryId={primaryId}
            onOpen={onOpen}
            onToggle={onToggle}
            onRate={onRate}
            onFlag={onFlag}
          />
        )}
      </div>
    </section>
  );
}

function Grid({
  items,
  density,
  selectedIds,
  primaryId,
  onOpen,
  onToggle,
  onRate,
  onFlag,
}: {
  items: StudioItem[];
  density: "compact" | "card";
  selectedIds: string[];
  primaryId: string | null;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onRate: (id: string, rating: number | null) => void;
  onFlag: (id: string) => void;
}) {
  const columns =
    density === "compact"
      ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6"
      : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";
  return (
    <div className={`grid gap-3 ${columns}`}>
      {items.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          density={density}
          selected={selectedIds.includes(item.id)}
          primary={primaryId === item.id}
          onOpen={() => onOpen(item.id)}
          onToggle={() => onToggle(item.id)}
          onRate={(rating) => onRate(item.id, rating)}
          onFlag={() => onFlag(item.id)}
        />
      ))}
    </div>
  );
}

function Filmstrip(props: Omit<Parameters<typeof Grid>[0], "density">) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {props.items.map((item) => (
        <div key={item.id} className="w-36 shrink-0">
          <MediaCard
            item={item}
            density="compact"
            selected={props.selectedIds.includes(item.id)}
            primary={props.primaryId === item.id}
            onOpen={() => props.onOpen(item.id)}
            onToggle={() => props.onToggle(item.id)}
            onRate={(rating) => props.onRate(item.id, rating)}
            onFlag={() => props.onFlag(item.id)}
          />
        </div>
      ))}
    </div>
  );
}

function Timeline(props: Omit<Parameters<typeof Grid>[0], "density">) {
  const groups = new Map<string, StudioItem[]>();
  for (const item of props.items) {
    const key = item.capturedAt.slice(0, 7);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const months = [...groups.keys()].sort().reverse();
  return (
    <div className="space-y-8">
      {months.map((month) => (
        <section key={month}>
          <h2 className="mb-3 text-xs uppercase tracking-[0.16em] text-mute">{formatMonth(month)}</h2>
          <Grid {...props} items={groups.get(month) ?? []} density="compact" />
        </section>
      ))}
    </div>
  );
}
