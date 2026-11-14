import { useEffect, useMemo, useRef, useState } from "react";
import { gridMetrics } from "../../studio/gridZoom";
import { formatMonth } from "../../studio/query";
import type { PointerMods } from "../../studio/selection";
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
  onView: (id: string) => void;
  selectMode: boolean;
  onSelectMode: (enabled: boolean) => void;
  onSelect: (id: string, mods: PointerMods) => void;
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
  onView,
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

  function activate(id: string, mods: PointerMods) {
    if (selectMode || mods.shift || mods.toggle) onSelect(id, mods);
    else onView(id);
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

      <div data-media-scroll className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {total === 0 ? (
          <div className="rounded-2xl border border-dashed border-line px-5 py-12 text-center">
            <p className="text-sm">No photos in this library yet</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-mute">
              Add media and choose a folder. Shelf indexes the files where they already are.
            </p>
          </div>
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
        ) : viewMode === "timeline" ? (
          <Timeline
            items={items}
            zoom={gridZoom}
            selectedIds={selectedIds}
            primaryId={primaryId}
            onOpen={activate}
            onToggle={onToggle}
            onRate={onRate}
            onFlag={onFlag}
          />
        ) : (
          <Grid
            items={items}
            zoom={gridZoom}
            selectedIds={selectedIds}
            primaryId={primaryId}
            onOpen={activate}
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
  selectedIds,
  primaryId,
  onOpen,
  onToggle,
  onRate,
  onFlag,
}: {
  items: StudioItem[];
  zoom: number;
  selectedIds: string[];
  primaryId: string | null;
  onOpen: (id: string, mods: PointerMods) => void;
  onToggle: (id: string) => void;
  onRate: (id: string, rating: number | null) => void;
  onFlag: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [windowed, setWindowed] = useState({ width: 0, start: 0, end: items.length, padTop: 0, padBottom: 0, cols: 1 });
  const { minPx, gapPx, roomy, dense } = gridMetrics(zoom);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scroller = host.closest("[data-media-scroll]");
    const measure = () => {
      const width = host.clientWidth;
      if (width <= 0) return;
      const cols = Math.max(1, Math.floor((width + gapPx) / (minPx + gapPx)));
      const cellW = (width - gapPx * (cols - 1)) / cols;
      const imageH = roomy ? cellW * 0.75 : cellW;
      const metaH = roomy ? 64 : dense ? 26 : 40;
      const rowH = imageH + metaH;
      const stride = rowH + gapPx;
      const rows = Math.ceil(items.length / cols);
      const viewH = scroller instanceof HTMLElement ? scroller.clientHeight : window.innerHeight;
      const scrollTop = scroller instanceof HTMLElement ? scroller.scrollTop : 0;
      const hostTop =
        scroller instanceof HTMLElement
          ? host.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scrollTop
          : 0;
      const localStart = scrollTop - hostTop;
      const localEnd = localStart + viewH;
      const startRow = Math.max(0, Math.floor(localStart / stride) - 4);
      const endRow = Math.min(rows, Math.ceil(localEnd / stride) + 4);
      const start = Math.min(items.length, startRow * cols);
      const end = Math.min(items.length, endRow * cols);
      setWindowed({
        width,
        start,
        end,
        padTop: startRow * stride,
        padBottom: Math.max(0, (rows - endRow) * stride),
        cols,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    if (scroller instanceof HTMLElement) {
      scroller.addEventListener("scroll", measure, { passive: true });
      observer.observe(scroller);
    }
    return () => {
      observer.disconnect();
      if (scroller instanceof HTMLElement) scroller.removeEventListener("scroll", measure);
    };
  }, [dense, gapPx, items.length, minPx, roomy, zoom]);

  const slice = items.slice(windowed.start, windowed.end);

  return (
    <div ref={hostRef} style={{ paddingTop: windowed.padTop, paddingBottom: windowed.padBottom }}>
      <div
        className="grid"
        style={{
          gap: gapPx,
          gridTemplateColumns: `repeat(${windowed.cols}, minmax(0, 1fr))`,
        }}
      >
        {slice.map((item) => (
          <MediaCard
            key={item.id}
            item={item}
            zoom={zoom}
            selected={selected.has(item.id)}
            primary={primaryId === item.id}
            onOpen={(mods) => onOpen(item.id, mods)}
            onToggle={() => onToggle(item.id)}
            onRate={(rating) => onRate(item.id, rating)}
            onFlag={() => onFlag(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

function Timeline(props: Parameters<typeof Grid>[0]) {
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
