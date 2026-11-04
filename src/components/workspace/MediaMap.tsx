import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { frameBackground, placeName } from "../../studio/catalog";
import {
  clientToWorld,
  frameBounds,
  fitItems,
  fitWorld,
  formatLatitude,
  formatLongitude,
  project,
  worldToLonLat,
  zoomAt,
  clampPan,
  type MapSize,
  type MapView,
} from "../../studio/geo";
import { TILE_ATTRIBUTION, cacheRegion, planRegion, type MapTile } from "../../studio/mapLibrary";
import { useMapLibrary } from "../../studio/useMapLibrary";
import { LAND_PATHS } from "../../studio/land";
import { formatLabel } from "../../studio/query";
import type { GeoBounds, StudioItem } from "../../studio/types";

type MediaMapProps = {
  items: StudioItem[];
  primaryId: string | null;
  onOpen: (id: string) => void;
  onRegion: (bounds: GeoBounds) => void;
  onCluster: (ids: string[], label: string) => void;
  className?: string;
};

type Tool = "pan" | "region" | "cache";

type WorldBox = { x: number; y: number; w: number; h: number };

type CacheDraft = { bounds: GeoBounds; box: WorldBox };

type Preview = {
  id: string;
  x: number;
  y: number;
};

type ScreenPin = {
  item: StudioItem;
  x: number;
  y: number;
};

type Cluster = {
  key: string;
  items: StudioItem[];
  label: string;
  longitude: number;
  latitude: number;
};

const CLUSTER_RADIUS = 36;

export function MediaMap({ items, primaryId, onOpen, onRegion, onCluster, className }: MediaMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const fitted = useRef<string | null>(null);
  const [size, setSize] = useState<MapSize>({ width: 0, height: 0 });
  const [view, setView] = useState<MapView>(() => fitWorld({ width: 16, height: 9 }));
  const [tool, setTool] = useState<Tool>("pan");
  const [rubber, setRubber] = useState<WorldBox | null>(null);
  const [draft, setDraft] = useState<CacheDraft | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const library = useMapLibrary();
  const jobRegion = useRef<string | null>(null);
  const viewRef = useRef(view);
  const sizeRef = useRef(size);
  viewRef.current = view;
  sizeRef.current = size;

  const drag = useRef<{
    mode: Tool;
    startX: number;
    startY: number;
    startWorld: { x: number; y: number };
    origin: MapView;
    moved: boolean;
    box: WorldBox | null;
  } | null>(null);

  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      setSize((current) => {
        if (Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5) {
          return current;
        }
        return { width: rect.width, height: rect.height };
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = element?.getBoundingClientRect();
      if (!rect) return;
      const cursor = clientToWorld(event.clientX, event.clientY, viewRef.current, rect);
      if (!cursor) return;
      const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
      setView(zoomAt(viewRef.current, cursor, factor, sizeRef.current));
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setPreview(null);
      setDraft(null);
      setRubber(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ids = items.map((item) => item.id).join("|");
  useEffect(() => {
    if (size.width < 10 || size.height < 10) return;
    setView((current) => {
      const aspect = size.width / size.height;
      const h = current.w / aspect;
      if (Math.abs(h - current.h) < 0.001) return current;
      const cy = current.y + current.h / 2;
      return { ...current, y: cy - h / 2, h };
    });
  }, [size]);

  useEffect(() => {
    if (size.width < 10 || size.height < 10) return;
    if (fitted.current === ids) return;
    fitted.current = ids;
    if (items.length === 0) return;
    setView(fitItems(items, size));
  }, [ids, items, size]);

  useEffect(() => {
    if (library.job) {
      jobRegion.current = library.job.regionId;
      return;
    }
    const finished = jobRegion.current;
    if (!finished) return;
    jobRegion.current = null;
    const region = library.regions.find((item) => item.id === finished);
    const box = sizeRef.current;
    if (!region || box.width < 10 || box.height < 10) return;
    fitted.current = ids;
    setView(frameBounds(region, box));
  }, [ids, library.job, library.regions]);

  const unit = size.width > 0 ? view.w / size.width : 1;
  const detailTiles = useMemo(() => visibleTiles(library.tiles, view, size), [library.tiles, view, size]);
  const detailNames = [
    ...new Set(
      detailTiles.flatMap((tile) =>
        tile.regionIds.map((id) => library.regions.find((region) => region.id === id)?.label ?? "Cached region"),
      ),
    ),
  ];
  const plan = draft ? planRegion(draft.bounds) : null;
  const groups = useMemo(() => groupPins(items, view, size), [items, view, size]);
  const previewItem = preview ? items.find((item) => item.id === preview.id) ?? null : null;

  function focusItems(list: StudioItem[]) {
    const box = sizeRef.current;
    if (box.width < 10 || list.length === 0) return;
    fitted.current = list.map((item) => item.id).join("|");
    setView(fitItems(list, box));
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest("[data-pin]")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const startWorld = clientToWorld(event.clientX, event.clientY, view, rect);
    if (!startWorld) return;
    drag.current = {
      mode: tool === "region" || event.shiftKey ? "region" : tool,
      startX: event.clientX,
      startY: event.clientY,
      startWorld,
      origin: view,
      moved: false,
      box: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current || size.width < 1) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (dx * dx + dy * dy > 16) current.moved = true;
    if (current.mode === "pan") {
      setView(
        clampPan({
          ...current.origin,
          x: current.origin.x - dx * (current.origin.w / size.width),
          y: current.origin.y - dy * (current.origin.h / size.height),
        }),
      );
      return;
    }
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = clientToWorld(event.clientX, event.clientY, current.origin, rect);
    if (!point) return;
    const box = {
      x: Math.min(current.startWorld.x, point.x),
      y: Math.min(current.startWorld.y, point.y),
      w: Math.abs(point.x - current.startWorld.x),
      h: Math.abs(point.y - current.startWorld.y),
    };
    current.box = box;
    setRubber(box);
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const current = drag.current;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!current) return;
    if (!current.moved || !current.box || current.box.w <= 0.2 || current.box.h <= 0.2) {
      if (!current.moved) setPreview(null);
      setRubber(draft?.box ?? null);
      return;
    }
    const box = current.box;
    if (current.mode === "region") {
      onRegion(boundsFromBox(box));
      setRubber(draft?.box ?? null);
      return;
    }
    if (current.mode === "cache" && !library.job) {
      setDraft({ bounds: boundsFromBox(box), box });
      setRubber(box);
      return;
    }
    setRubber(draft?.box ?? null);
  }

  function zoomBy(factor: number) {
    const box = sizeRef.current;
    const current = viewRef.current;
    setView(zoomAt(current, { x: current.x + current.w / 2, y: current.y + current.h / 2 }, factor, box));
  }

  const card = previewItem && preview ? placeCard(preview, size) : null;

  return (
    <div className={`relative min-h-0 min-w-0 bg-studio ${className ?? ""}`}>
      <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Map tool" className="flex rounded-full border border-line bg-card/95 p-0.5">
          {(
            [
              ["pan", "Pan", "Pan the map"],
              ["region", "Region", "Drag a box to filter the grid"],
              ["cache", "Cache region", "Select region to cache"],
            ] as const
          ).map(([mode, label, description]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={tool === mode}
              aria-label={description}
              title={description}
              onClick={() => setTool(mode)}
              className={`rounded-full px-3 py-1 text-xs ${
                tool === mode ? "bg-teal text-teal-ink" : "text-mute hover:text-foam"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => zoomBy(1.4)} className="rounded-full border border-line bg-card/95 px-2.5 py-1 text-xs text-foam" aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.4)} className="rounded-full border border-line bg-card/95 px-2.5 py-1 text-xs text-foam" aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          onClick={() => {
            fitted.current = ids;
            setView(items.length ? fitItems(items, sizeRef.current) : fitWorld(sizeRef.current));
          }}
          className="rounded-full border border-line bg-card/95 px-3 py-1 text-xs text-mute hover:text-foam"
        >
          Fit
        </button>
        </div>
        <p className="pointer-events-none max-w-xs text-xs text-mute">
          {tool === "region"
            ? "Drag a box to filter the grid."
            : tool === "cache"
              ? "Drag a box to download map tiles."
              : "Click a cluster to filter. Shift-drag selects a region."}
        </p>
      </div>
      {detailNames.length > 0 && !draft && !library.job ? (
        <p className="pointer-events-none absolute bottom-3 left-3 z-20 max-w-[14rem] rounded-full border border-teal/40 bg-studio/80 px-2.5 py-1 text-xs text-teal">
          Offline tiles · {detailNames.join(", ")}
        </p>
      ) : null}
      {detailTiles.length > 0 && !draft && !library.job ? (
        <p className="pointer-events-none absolute bottom-3 right-3 z-20 max-w-[12rem] text-right text-[10px] leading-snug text-mute">{TILE_ATTRIBUTION}</p>
      ) : null}
      {library.error && !draft && !library.job ? (
        <p className="absolute bottom-3 left-1/2 z-30 w-[min(24rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-line bg-card/95 px-3 py-2 text-sm text-danger">
          {library.error}
        </p>
      ) : null}
      {draft && plan ? (
        <div
          role="dialog"
          aria-label="Download bounding box"
          className="absolute bottom-3 left-1/2 z-30 w-[min(24rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-line bg-card/95 p-3 shadow-2xl shadow-black/40"
        >
          <h2 className="text-sm font-medium">Download bounding box</h2>
          <p className="mt-1 text-xs text-mute">
            {formatLatitude(draft.bounds.south)}–{formatLatitude(draft.bounds.north)}, {formatLongitude(draft.bounds.west)}–
            {formatLongitude(draft.bounds.east)}
          </p>
          <p className="mt-1 text-xs text-mute">
            {plan.tiles.length === 0
              ? "That box does not cover any map tiles."
              : `${plan.tiles.length} tiles · zoom ${plan.minZoom === plan.maxZoom ? plan.maxZoom : `${plan.minZoom}–${plan.maxZoom}`}`}
          </p>
          <p className="mt-2 text-xs text-mute">
            Shelf requests these tiles once from the Esri dark basemap and stores them in this browser.
          </p>
          <p className="mt-1 text-[10px] text-mute">{TILE_ATTRIBUTION}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setRubber(null);
              }}
              className="rounded-full px-3 py-1.5 text-xs text-mute hover:text-foam"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={plan.tiles.length === 0 || library.job != null}
              onClick={() => {
                const bounds = draft.bounds;
                setDraft(null);
                setRubber(null);
                void cacheRegion(bounds);
              }}
              className="rounded-full bg-teal px-3 py-1.5 text-xs font-medium text-teal-ink disabled:opacity-40"
            >
              Download tiles
            </button>
          </div>
        </div>
      ) : null}
      {library.job ? (
        <div
          role="status"
          className="absolute bottom-3 left-1/2 z-30 w-[min(24rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-line bg-card/95 p-3 shadow-2xl shadow-black/40"
        >
          <p className="text-sm">Downloading {library.job.label}</p>
          <p className="mt-1 font-mono text-[10px] text-teal">
            {library.job.done}/{library.job.total}
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-teal" style={{ width: `${Math.round((library.job.done / Math.max(library.job.total, 1)) * 100)}%` }} />
          </div>
          <p className="mt-2 text-[10px] text-mute">{TILE_ATTRIBUTION}</p>
        </div>
      ) : null}

      <svg
        ref={svgRef}
        className={`h-full w-full touch-none ${tool === "pan" ? "cursor-grab" : "cursor-crosshair"}`}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="application"
        aria-label="Media map"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => zoomBy(1.8)}
      >
        <rect x={-20} y={-20} width={400} height={220} fill="#0f1115" />
        {graticule()}
        {LAND_PATHS.map((path, index) => (
          <path key={index} d={path} fill="#1c222c" stroke="#2c3340" strokeWidth={0.45 * unit} />
        ))}
        {detailTiles.map((tile) => {
          const origin = project(tile.west, tile.north);
          const end = project(tile.east, tile.south);
          return (
            <image
              key={tile.key}
              href={tile.url}
              x={origin.x}
              y={origin.y}
              width={Math.max(0.01, end.x - origin.x)}
              height={Math.max(0.01, end.y - origin.y)}
              preserveAspectRatio="none"
              style={{ pointerEvents: "none" }}
            />
          );
        })}
        {rubber ? (
          <rect
            x={rubber.x}
            y={rubber.y}
            width={rubber.w}
            height={rubber.h}
            fill="#2ee0c5"
            fillOpacity={0.16}
            stroke="#2ee0c5"
            strokeWidth={1.25 * unit}
          />
        ) : null}
        {groups.clusters.map((cluster) => {
          const point = project(cluster.longitude, cluster.latitude);
          const radius = (cluster.items.length > 9 ? 16 : 14) * unit;
          return (
            <g
              key={cluster.key}
              data-pin="cluster"
              className="cursor-pointer"
              style={{ pointerEvents: tool === "pan" ? "auto" : "none" }}
              onClick={(event) => {
                event.stopPropagation();
                focusItems(cluster.items);
                onCluster(
                  cluster.items.map((item) => item.id),
                  cluster.label,
                );
                setPreview(null);
              }}
            >
              <circle cx={point.x} cy={point.y} r={radius} fill="#2ee0c5" />
              <text
                x={point.x}
                y={point.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#06221d"
                fontSize={11 * unit}
                fontFamily="Outfit, sans-serif"
                style={{ pointerEvents: "none" }}
              >
                {cluster.items.length}
              </text>
            </g>
          );
        })}
        {groups.singles.map((pin) => {
          const point = project(pin.item.longitude, pin.item.latitude);
          const active = pin.item.id === primaryId || pin.item.id === preview?.id;
          return (
            <g
              key={pin.item.id}
              data-pin="item"
              className="cursor-pointer"
              style={{ pointerEvents: tool === "pan" ? "auto" : "none" }}
              onClick={(event) => {
                event.stopPropagation();
                setPreview({ id: pin.item.id, x: pin.x, y: pin.y });
                onOpen(pin.item.id);
              }}
            >
              <circle
                cx={point.x}
                cy={point.y}
                r={(active ? 7.5 : 5.5) * unit}
                fill={active ? "#2ee0c5" : "#0f1115"}
                stroke="#2ee0c5"
                strokeWidth={1.6 * unit}
              />
            </g>
          );
        })}
      </svg>

      {previewItem && card ? (
        <article
          className="absolute z-30 w-60 overflow-hidden rounded-xl border border-line bg-card shadow-2xl shadow-black/40"
          style={{ left: card.left, top: card.top }}
        >
          <div className="h-16" style={{ background: frameBackground(previewItem.id) }} />
          <div className="space-y-1 px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <h2 className="truncate text-sm font-medium">{previewItem.fileName}</h2>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="text-xs text-mute hover:text-foam"
                aria-label="Close preview"
              >
                ×
              </button>
            </div>
            <p className="truncate text-xs text-mute">{previewItem.camera}</p>
            <p className="truncate text-xs text-mute">{placeName(previewItem.folder)}</p>
            <p className="font-mono text-[10px] text-teal">
              {formatLatitude(previewItem.latitude)} {formatLongitude(previewItem.longitude)}
              <span className="ml-2 text-mute">{formatLabel(previewItem.format)}</span>
            </p>
          </div>
        </article>
      ) : null}
    </div>
  );
}

function groupPins(items: StudioItem[], view: MapView, size: MapSize): { singles: ScreenPin[]; clusters: Cluster[] } {
  if (size.width < 10 || size.height < 10) return { singles: [], clusters: [] };
  const pins: ScreenPin[] = items.map((item) => {
    const point = project(item.longitude, item.latitude);
    return {
      item,
      x: ((point.x - view.x) / view.w) * size.width,
      y: ((point.y - view.y) / view.h) * size.height,
    };
  });
  const used = new Set<number>();
  const singles: ScreenPin[] = [];
  const clusters: Cluster[] = [];
  for (let index = 0; index < pins.length; index += 1) {
    if (used.has(index)) continue;
    used.add(index);
    const group = [pins[index]];
    const queue = [index];
    while (queue.length > 0) {
      const current = queue.pop() ?? 0;
      for (let other = 0; other < pins.length; other += 1) {
        if (used.has(other)) continue;
        const dx = pins[other].x - pins[current].x;
        const dy = pins[other].y - pins[current].y;
        if (dx * dx + dy * dy <= CLUSTER_RADIUS * CLUSTER_RADIUS) {
          used.add(other);
          group.push(pins[other]);
          queue.push(other);
        }
      }
    }
    if (group.length === 1) {
      singles.push(group[0]);
      continue;
    }
    const longitude = average(group.map((pin) => pin.item.longitude));
    const latitude = average(group.map((pin) => pin.item.latitude));
    const names = new Set(group.map((pin) => placeName(pin.item.folder)));
    const label = names.size === 1 ? `${[...names][0]} · ${group.length}` : `${group.length} frames`;
    clusters.push({
      key: group.map((pin) => pin.item.id).join("-"),
      items: group.map((pin) => pin.item),
      label,
      longitude,
      latitude,
    });
  }
  return { singles, clusters };
}

function graticule() {
  const lines: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
  for (let longitude = -120; longitude <= 150; longitude += 30) {
    const x = longitude + 180;
    lines.push({ x1: x, y1: 0, x2: x, y2: 180, key: `lon-${longitude}` });
  }
  for (let latitude = -60; latitude <= 60; latitude += 30) {
    const y = 90 - latitude;
    lines.push({ x1: 0, y1: y, x2: 360, y2: y, key: `lat-${latitude}` });
  }
  return lines.map((line) => (
    <line
      key={line.key}
      x1={line.x1}
      y1={line.y1}
      x2={line.x2}
      y2={line.y2}
      stroke="#2c3340"
      strokeWidth={0.15}
    />
  ));
}

function placeCard(preview: Preview, size: MapSize): { left: number; top: number } {
  const width = 240;
  const height = 148;
  let left = preview.x + 14;
  let top = preview.y - 24;
  if (left + width > size.width - 8) left = preview.x - width - 14;
  if (top + height > size.height - 8) top = Math.max(8, size.height - height - 8);
  if (top < 8) top = 8;
  if (left < 8) left = 8;
  return { left, top };
}

function boundsFromBox(box: WorldBox): GeoBounds {
  const start = worldToLonLat(box.x, box.y + box.h);
  const end = worldToLonLat(box.x + box.w, box.y);
  return {
    west: Math.min(start.longitude, end.longitude),
    east: Math.max(start.longitude, end.longitude),
    south: Math.min(start.latitude, end.latitude),
    north: Math.max(start.latitude, end.latitude),
  };
}

function visibleTiles(tiles: MapTile[], view: MapView, size: MapSize): MapTile[] {
  if (size.width < 10 || size.height < 10 || view.w >= 96) return [];
  const intersecting = tiles.filter((tile) => intersectsView(view, tile));
  const zoom = chooseTileZoom(intersecting, view, size);
  if (zoom == null) return [];
  return intersecting.filter((tile) => tile.z === zoom);
}

function chooseTileZoom(tiles: MapTile[], view: MapView, size: MapSize): number | null {
  let best: number | null = null;
  let bestScore = Infinity;
  const seen = new Set<number>();
  for (const tile of tiles) {
    if (seen.has(tile.z)) continue;
    seen.add(tile.z);
    const px = ((360 / 2 ** tile.z) / view.w) * size.width;
    if (px < 48) continue;
    const score = Math.abs(px - 220);
    if (score < bestScore) {
      best = tile.z;
      bestScore = score;
    }
  }
  return best;
}

function intersectsView(
  view: MapView,
  tile: { west: number; south: number; east: number; north: number },
): boolean {
  const west = view.x - 180;
  const east = west + view.w;
  const north = 90 - view.y;
  const south = north - view.h;
  return tile.west < east && tile.east > west && tile.south < north && tile.north > south;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
