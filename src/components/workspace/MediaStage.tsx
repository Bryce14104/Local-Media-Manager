import { useState } from "react";
import { gridMetrics } from "../../studio/gridZoom";
import { formatMonth } from "../../studio/query";
import type { GeoBounds, StudioItem, ViewMode } from "../../studio/types";
import { MediaCard } from "./MediaCard";
import { MediaMap } from "./MediaMap";
import { MediaTray } from "./MediaTray";

type MediaStageProps = {
  items: StudioItem[];
  total: number;
  viewMode: ViewMode;
  gridZoom: number;
  selectedIds: string[];
  primaryId: string | null;
  onOpen: (id: string) => void;
  onInspect: (id: string) => void;
  selectMode: boolean;
  onSelectMode: (enabled: boolean) => void;
  onSelect: (id: string, shift: boolean) => void;
  onSelectVisible: () => void;
  onToggle: (id: string) => void;
  onRate: (id: string, rating: number | null) => void;
  onFlag: (id: string) => void;
  onClearFilters: () => void;
  filteredEmpty: boolean;
  onRegion: (bounds: GeoBounds) => void;
  onCluster: (ids: string[], label: string) => void;
  selectingCache?: boolean;
  onCacheBounds?: (bounds: GeoBounds) => void;
  onCancelCache?: () => void;
  className?: string;
};

export function MediaStage({
  items,
  total,
  viewMode,
  gridZoom,
  selectedIds,
  primaryId,
  onOpen,
  onInspect,
  selectMode,
  onSelectMode,
  onSelect,
  onSelectVisible,
  onToggle,
  onRate,
  onFlag,
  onClearFilters,
  filteredEmpty,
  onRegion,
  onCluster,
  selectingCache = false,
  onCacheBounds,
  onCancelCache,
  className,
}: MediaStageProps) {
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);

  function selectOnMap(id: string) {
    onOpen(id);
    setFocus({ id, nonce: Date.now() });
  }

  if (viewMode === "map") {
    return (
      <section className={`flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row ${className ?? ""}`}>
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
          className="min-h-[240px] min-w-0 flex-1"
        />
        <MediaTray items={items} primaryId={primaryId} onSelect={selectOnMap} />
      </section>
    );
  }

  return (
    <section className={`flex min-h-0 min-w-0 flex-1 flex-col ${className ?? ""}`}>
      <header className="flex items-center gap-3 px-4 py-3">
        <p className="text-xs text-mute">
          {items.length === total ? `${total} frames on this machine` : `${items.length} of ${total} frames`}
        </p>
        <button
          type="button"
          aria-pressed={selectMode}
          onClick={() => onSelectMode(!selectMode)}
          className={`rounded-full px-3 py-1 text-xs ${
            selectMode ? "bg-teal text-teal-ink" : "border border-line text-foam hover:border-teal"
          }`}
        >
          {selectMode ? "Selecting" : "Select"}
        </button>
        {selectMode ? (
          <button type="button" onClick={onSelectVisible} className="text-xs text-teal hover:underline">
            Select visible
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {filteredEmpty ? (
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
        ) : viewMode === "timeline" ? (
          <Timeline
            items={items}
            zoom={gridZoom}
            detail="compact"
            selectedIds={selectedIds}
            primaryId={primaryId}
            onOpen={selectMode ? onSelect : onInspect}
            onToggle={onToggle}
            onRate={onRate}
            onFlag={onFlag}
          />
        ) : (
          <Grid
            items={items}
            zoom={gridZoom}
            detail={viewMode === "cards" ? "card" : "compact"}
            selectedIds={selectedIds}
            primaryId={primaryId}
            onOpen={selectMode ? onSelect : onInspect}
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
  zoom,
  detail,
  selectedIds,
  primaryId,
  onOpen,
  onToggle,
  onRate,
  onFlag,
}: {
  items: StudioItem[];
  zoom: number;
  detail: "compact" | "card";
  selectedIds: string[];
  primaryId: string | null;
  onOpen: (id: string, shift: boolean) => void;
  onToggle: (id: string) => void;
  onRate: (id: string, rating: number | null) => void;
  onFlag: (id: string) => void;
}) {
  const { minPx, gapPx } = gridMetrics(zoom);
  return (
    <div
      className="grid"
      style={{
        gap: gapPx,
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minPx}px), 1fr))`,
      }}
    >
      {items.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          zoom={zoom}
          detail={detail}
          selected={selectedIds.includes(item.id)}
          primary={primaryId === item.id}
          onOpen={(shift) => onOpen(item.id, shift)}
          onToggle={() => onToggle(item.id)}
          onRate={(rating) => onRate(item.id, rating)}
          onFlag={() => onFlag(item.id)}
        />
      ))}
    </div>
  );
}

function Timeline(props: Omit<Parameters<typeof Grid>[0], "detail"> & { detail: "compact" | "card" }) {
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
          <Grid {...props} items={groups.get(month) ?? []} />
        </section>
      ))}
    </div>
  );
}
