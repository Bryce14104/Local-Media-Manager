import { useEffect, useMemo, useRef, useState } from "react";
import { collapseBursts as collapseBurstItems } from "../../studio/bursts";
import { gridMetrics } from "../../studio/gridZoom";
import { formatMonth } from "../../studio/query";
import { formatShootDay, shootDay } from "../../studio/trips";
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
  collapseBursts?: boolean;
  className?: string;
};

export function MediaStage({
  items,
  total,
  viewMode,
  gridZoom,
  selectedIds,
  primaryId,
  onView,
  selectMode,
  onSelectMode,
  onSelect,
  onSelectVisible,
  onToggle,
  onClearFilters,
  filteredEmpty,
  onRegion,
  onCluster,
  selectingCache = false,
  onCacheBounds,
  onCancelCache,
  collapseBursts = false,
  className,
}: MediaStageProps) {
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const shown = collapseBursts && viewMode !== "map" ? collapseBurstItems(items) : items;

  function selectOnMap(id: string) {
    onView(id);
    setFocus({ id, nonce: Date.now() });
  }

  function activate(id: string, mods: PointerMods) {
    if (selectMode || mods.shift || mods.toggle) {
      onSelect(id, mods);
      return;
    }
    onView(id);
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
      <header className="flex items-center gap-3 px-3 py-2">
        <p className="text-xs text-mute">
          {shown.length === total ? `${total} photos` : `${shown.length} of ${total}${collapseBursts ? " · one per burst" : ""}`}
        </p>
        <button
          type="button"
          aria-pressed={selectMode}
          onClick={() => onSelectMode(!selectMode)}
          className={`ml-auto rounded-full px-2.5 py-1 text-[11px] ${
            selectMode ? "bg-teal text-teal-ink" : "text-mute hover:text-foam"
          }`}
        >
          {selectMode ? "Done" : "Select"}
        </button>
        {selectMode ? (
          <button type="button" onClick={onSelectVisible} className="text-[11px] text-mute hover:text-foam">
            All visible
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
            items={shown}
            zoom={gridZoom}
            selectedIds={selectedIds}
            primaryId={primaryId}
            selectMode={selectMode}
            onOpen={activate}
            onToggle={onToggle}
          />
        ) : (
          <Grid
            items={shown}
            zoom={gridZoom}
            selectedIds={selectedIds}
            primaryId={primaryId}
            selectMode={selectMode}
            onOpen={activate}
            onToggle={onToggle}
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
  selectMode,
  onOpen,
  onToggle,
}: {
  items: StudioItem[];
  zoom: number;
  selectedIds: string[];
  primaryId: string | null;
  selectMode: boolean;
  onOpen: (id: string, mods: PointerMods) => void;
  onToggle: (id: string) => void;
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
      const startRow = Math.max(0, Math.floor(localStart / stride) - 2);
      const endRow = Math.min(rows, Math.ceil(localEnd / stride) + 2);
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
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    measure();
    const observer = new ResizeObserver(onScroll);
    observer.observe(host);
    if (scroller instanceof HTMLElement) {
      scroller.addEventListener("scroll", onScroll, { passive: true });
      observer.observe(scroller);
    }
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (scroller instanceof HTMLElement) scroller.removeEventListener("scroll", onScroll);
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
            focused={primaryId === item.id && !selected.has(item.id) && selectedIds.length === 0}
            selectMode={selectMode}
            onOpen={(mods) => onOpen(item.id, mods)}
            onToggle={() => onToggle(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

function Timeline(props: Parameters<typeof Grid>[0]) {
  const first = props.items[0];
  const last = props.items[props.items.length - 1];
  const heading = first
    ? `${formatShootDay(shootDay(first))}${last && shootDay(last) !== shootDay(first) ? ` – ${formatShootDay(shootDay(last))}` : ""}`
    : formatMonth("1970-01");
  return (
    <div>
      <h2 className="sticky top-0 z-10 mb-3 bg-studio/90 py-2 text-xs uppercase tracking-[0.16em] text-mute backdrop-blur-sm">
        {heading}
      </h2>
      <Grid {...props} />
    </div>
  );
}
