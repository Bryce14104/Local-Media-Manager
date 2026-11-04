import { formatLatitude, formatLongitude } from "./geo";
import type { GeoBounds } from "./types";

export const TILE_ATTRIBUTION = "Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community";

const TILE_ENDPOINT =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile";
const DB_NAME = "shelf-map-packs";
const DB_VERSION = 2;
const TILE_STORE = "slippy";
const REGION_STORE = "regions";
const MIN_ZOOM = 2;
const MAX_ZOOM = 14;
const MAX_TILES = 48;
const TOP_LEVEL_BUDGET = 32;
const MAX_LAT = 85.05112878;
const FETCH_CONCURRENCY = 4;

export type MapRegion = {
  id: string;
  label: string;
  west: number;
  south: number;
  east: number;
  north: number;
  minZoom: number;
  maxZoom: number;
  bytes: number;
  tileCount: number;
  savedAt: number;
};

export type PlannedTile = {
  z: number;
  x: number;
  y: number;
  west: number;
  south: number;
  east: number;
  north: number;
};

export type TilePlan = {
  tiles: PlannedTile[];
  minZoom: number;
  maxZoom: number;
};

export type MapTile = {
  key: string;
  z: number;
  x: number;
  y: number;
  west: number;
  south: number;
  east: number;
  north: number;
  byteSize: number;
  regionIds: string[];
  url: string;
};

export type MapLibrarySnapshot = {
  ready: boolean;
  error: string | null;
  regions: MapRegion[];
  tiles: MapTile[];
  job: { regionId: string; label: string; done: number; total: number } | null;
};

type TileRow = {
  key: string;
  z: number;
  x: number;
  y: number;
  west: number;
  south: number;
  east: number;
  north: number;
  byteSize: number;
  regionIds: string[];
  blob: Blob;
};

let snapshot: MapLibrarySnapshot = {
  ready: false,
  error: null,
  regions: [],
  tiles: [],
  job: null,
};
const listeners = new Set<(next: MapLibrarySnapshot) => void>();
let loadTask: Promise<void> | null = null;
let libraryGeneration = 0;
let activeAbort: AbortController | null = null;

export function getMapLibrary(): MapLibrarySnapshot {
  return snapshot;
}

export function subscribeMapLibrary(listener: (next: MapLibrarySnapshot) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadMapLibrary(): Promise<void> {
  if (!loadTask) loadTask = readDatabase();
  return loadTask;
}

export function planRegion(bounds: GeoBounds): TilePlan {
  const box = normalizeBounds(bounds);
  if (!box) return { tiles: [], minZoom: 0, maxZoom: 0 };
  const counts = new Map<number, number>();
  for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom += 1) counts.set(zoom, countTiles(box, zoom));
  let maxZoom = highestZoom(counts, TOP_LEVEL_BUDGET);
  if (maxZoom < 0) maxZoom = highestZoom(counts, MAX_TILES);
  if (maxZoom < 0) return { tiles: [], minZoom: 0, maxZoom: 0 };
  const tiles: PlannedTile[] = [];
  let minZoom = maxZoom;
  for (let zoom = maxZoom; zoom >= MIN_ZOOM; zoom -= 1) {
    const level = tilesAtZoom(box, zoom);
    if (tiles.length + level.length > MAX_TILES) break;
    tiles.push(...level);
    minZoom = zoom;
  }
  return { tiles, minZoom, maxZoom };
}

export async function cacheRegion(bounds: GeoBounds): Promise<void> {
  await loadMapLibrary();
  if (snapshot.job) await waitForIdle();
  const plan = planRegion(bounds);
  if (plan.tiles.length === 0) {
    publish({ ...snapshot, error: "That box does not cover any map tiles." });
    return;
  }
  const generation = libraryGeneration;
  const id = `region-${Date.now()}`;
  const label = regionLabel(bounds);
  const abort = new AbortController();
  activeAbort = abort;
  publish({
    ...snapshot,
    error: null,
    job: { regionId: id, label, done: 0, total: plan.tiles.length },
  });
  const known = new Set(snapshot.tiles.map((tile) => tile.key));
  const fresh: { tile: PlannedTile; blob: Blob }[] = [];
  const reused: PlannedTile[] = [];
  let done = 0;
  try {
    await mapPool(plan.tiles, FETCH_CONCURRENCY, async (tile) => {
      if (generation !== libraryGeneration) return;
      const key = tileKey(tile.z, tile.x, tile.y);
      if (known.has(key)) reused.push(tile);
      else {
        try {
          const blob = await fetchTile(tile, abort.signal);
          if (blob) fresh.push({ tile, blob });
        } catch {
          /* A missing tile is skipped. The region is kept only if something arrived. */
        }
      }
      if (generation !== libraryGeneration) return;
      done += 1;
      publish({
        ...snapshot,
        job: { regionId: id, label, done, total: plan.tiles.length },
      });
    });
    if (generation !== libraryGeneration) return;
    if (fresh.length + reused.length === 0) {
      publish({
        ...snapshot,
        job: null,
        error: "No tiles could be downloaded for that box.",
      });
      return;
    }
    const reusedTiles = snapshot.tiles.filter((tile) => reused.some((tilePlan) => tileKey(tilePlan.z, tilePlan.x, tilePlan.y) === tile.key));
    const freshRows = fresh.map(({ tile, blob }) => toRow(tile, blob, [id]));
    const bytes =
      freshRows.reduce((sum, row) => sum + row.byteSize, 0) +
      reusedTiles.reduce((sum, tile) => sum + tile.byteSize, 0);
    const region: MapRegion = {
      id,
      label,
      west: bounds.west,
      south: bounds.south,
      east: bounds.east,
      north: bounds.north,
      minZoom: Math.min(...[...freshRows, ...reused].map((tile) => tile.z)),
      maxZoom: Math.max(...[...freshRows, ...reused].map((tile) => tile.z)),
      bytes,
      tileCount: freshRows.length + reusedTiles.length,
      savedAt: Date.now(),
    };
    const db = await openDatabase();
    if (generation !== libraryGeneration) {
      db.close();
      return;
    }
    await writeRegion(db, region, freshRows, reusedTiles.map((tile) => tile.key));
    db.close();
    if (generation !== libraryGeneration) return;
    const freshTiles = freshRows.map(toTile);
    const reusedKeys = new Set(reusedTiles.map((tile) => tile.key));
    publish({
      ...snapshot,
      job: null,
      error: null,
      regions: [region, ...snapshot.regions.filter((item) => item.id !== id)],
      tiles: [
        ...snapshot.tiles.map((tile) =>
          reusedKeys.has(tile.key) && !tile.regionIds.includes(id)
            ? { ...tile, regionIds: [...tile.regionIds, id] }
            : tile,
        ),
        ...freshTiles,
      ],
    });
  } catch (error) {
    if (generation !== libraryGeneration) return;
    publish({
      ...snapshot,
      job: null,
      error: error instanceof Error ? error.message : "Could not store this map region",
    });
  } finally {
    if (activeAbort === abort) activeAbort = null;
  }
}

export async function clearRegion(regionId: string): Promise<void> {
  if (snapshot.job?.regionId === regionId) bumpGeneration();
  await loadMapLibrary();
  const db = await openDatabase();
  await detachRegion(db, regionId);
  db.close();
  const removed = snapshot.tiles.filter(
    (tile) => tile.regionIds.includes(regionId) && tile.regionIds.length === 1,
  );
  for (const tile of removed) URL.revokeObjectURL(tile.url);
  publish({
    ...snapshot,
    job: snapshot.job?.regionId === regionId ? null : snapshot.job,
    regions: snapshot.regions.filter((region) => region.id !== regionId),
    tiles: snapshot.tiles.flatMap((tile) => {
      if (!tile.regionIds.includes(regionId)) return [tile];
      const regionIds = tile.regionIds.filter((id) => id !== regionId);
      if (regionIds.length === 0) return [];
      return [{ ...tile, regionIds }];
    }),
  });
}

export async function clearAllRegions(): Promise<void> {
  bumpGeneration();
  await loadMapLibrary();
  const db = await openDatabase();
  await clearStores(db);
  db.close();
  for (const tile of snapshot.tiles) URL.revokeObjectURL(tile.url);
  publish({ ...snapshot, job: null, regions: [], tiles: [], error: null });
}

function publish(next: MapLibrarySnapshot) {
  snapshot = next;
  for (const listener of listeners) listener(snapshot);
}

function bumpGeneration() {
  libraryGeneration += 1;
  activeAbort?.abort();
}

async function readDatabase(): Promise<void> {
  try {
    const db = await openDatabase();
    const regions = await readRegions(db);
    const rows = await readTiles(db);
    db.close();
    regions.sort((a, b) => b.savedAt - a.savedAt);
    publish({
      ready: true,
      error: null,
      regions,
      tiles: rows.map(toTile),
      job: snapshot.job,
    });
  } catch (error) {
    publish({
      ready: true,
      error: error instanceof Error ? error.message : "Map storage is unavailable",
      regions: [],
      tiles: [],
      job: null,
    });
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 2) {
        if (db.objectStoreNames.contains("tiles")) db.deleteObjectStore("tiles");
        if (db.objectStoreNames.contains("packs")) db.deleteObjectStore("packs");
      }
      if (!db.objectStoreNames.contains(TILE_STORE)) db.createObjectStore(TILE_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(REGION_STORE)) db.createObjectStore(REGION_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open map storage"));
  });
}

function readRegions(db: IDBDatabase): Promise<MapRegion[]> {
  return requestToPromise(db.transaction(REGION_STORE, "readonly").objectStore(REGION_STORE).getAll()) as Promise<
    MapRegion[]
  >;
}

function readTiles(db: IDBDatabase): Promise<TileRow[]> {
  return requestToPromise(db.transaction(TILE_STORE, "readonly").objectStore(TILE_STORE).getAll()) as Promise<TileRow[]>;
}

function writeRegion(db: IDBDatabase, region: MapRegion, fresh: TileRow[], reusedKeys: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([TILE_STORE, REGION_STORE], "readwrite");
    const tiles = tx.objectStore(TILE_STORE);
    for (const row of fresh) tiles.put(row);
    if (reusedKeys.length > 0) {
      const request = tiles.getAll();
      request.onsuccess = () => {
        const wanted = new Set(reusedKeys);
        for (const row of request.result as TileRow[]) {
          if (!wanted.has(row.key) || row.regionIds.includes(region.id)) continue;
          tiles.put({ ...row, regionIds: [...row.regionIds, region.id] });
        }
      };
    }
    tx.objectStore(REGION_STORE).put(region);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not write map tiles"));
  });
}

function detachRegion(db: IDBDatabase, regionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([TILE_STORE, REGION_STORE], "readwrite");
    const tiles = tx.objectStore(TILE_STORE);
    const request = tiles.getAll();
    request.onsuccess = () => {
      for (const row of request.result as TileRow[]) {
        if (!row.regionIds.includes(regionId)) continue;
        const regionIds = row.regionIds.filter((id) => id !== regionId);
        if (regionIds.length === 0) tiles.delete(row.key);
        else tiles.put({ ...row, regionIds });
      }
    };
    tx.objectStore(REGION_STORE).delete(regionId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not clear map region"));
  });
}

function clearStores(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([TILE_STORE, REGION_STORE], "readwrite");
    tx.objectStore(TILE_STORE).clear();
    tx.objectStore(REGION_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not clear map data"));
  });
}

function requestToPromise(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Map storage request failed"));
  });
}

function toRow(tile: PlannedTile, blob: Blob, regionIds: string[]): TileRow {
  return {
    key: tileKey(tile.z, tile.x, tile.y),
    z: tile.z,
    x: tile.x,
    y: tile.y,
    west: tile.west,
    south: tile.south,
    east: tile.east,
    north: tile.north,
    byteSize: blob.size,
    regionIds,
    blob,
  };
}

function toTile(row: TileRow): MapTile {
  return {
    key: row.key,
    z: row.z,
    x: row.x,
    y: row.y,
    west: row.west,
    south: row.south,
    east: row.east,
    north: row.north,
    byteSize: row.byteSize,
    regionIds: row.regionIds,
    url: URL.createObjectURL(row.blob),
  };
}

async function fetchTile(tile: PlannedTile, signal: AbortSignal): Promise<Blob | null> {
  const response = await fetch(`${TILE_ENDPOINT}/${tile.z}/${tile.y}/${tile.x}`, {
    signal,
    mode: "cors",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) return null;
  const blob = await response.blob();
  if (blob.size === 0) return null;
  const type = blob.type || response.headers.get("content-type") || "";
  if (type && !type.startsWith("image/")) return null;
  return blob;
}

async function mapPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(runners);
}

function waitForIdle(): Promise<void> {
  if (!snapshot.job) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = subscribeMapLibrary((next) => {
      if (!next.job) {
        stop();
        resolve();
      }
    });
  });
}

function regionLabel(bounds: GeoBounds): string {
  const latitude = (bounds.south + bounds.north) / 2;
  const longitude = (bounds.west + bounds.east) / 2;
  return `${formatLatitude(latitude, 1)} ${formatLongitude(longitude, 1)}`;
}

function normalizeBounds(bounds: GeoBounds): GeoBounds | null {
  const west = clamp(Math.min(bounds.west, bounds.east), -180, 180);
  const east = clamp(Math.max(bounds.west, bounds.east), -180, 180);
  const south = clamp(Math.min(bounds.south, bounds.north), -MAX_LAT, MAX_LAT);
  const north = clamp(Math.max(bounds.south, bounds.north), -MAX_LAT, MAX_LAT);
  if (east - west < 0.01 || north - south < 0.01) return null;
  return { west, south, east, north };
}

function highestZoom(counts: Map<number, number>, limit: number): number {
  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom -= 1) {
    const count = counts.get(zoom) ?? 0;
    if (count > 0 && count <= limit) return zoom;
  }
  return -1;
}

function countTiles(bounds: GeoBounds, zoom: number): number {
  const range = tileRange(bounds, zoom);
  if (!range) return 0;
  return range.xCount * range.yCount;
}

function tilesAtZoom(bounds: GeoBounds, zoom: number): PlannedTile[] {
  const range = tileRange(bounds, zoom);
  if (!range || range.xCount * range.yCount > MAX_TILES) return [];
  const tiles: PlannedTile[] = [];
  for (let x = range.x0; x <= range.x1; x += 1) {
    for (let y = range.y0; y <= range.y1; y += 1) {
      tiles.push({
        z: zoom,
        x,
        y,
        west: xToLon(x, zoom),
        east: xToLon(x + 1, zoom),
        north: yToLat(y, zoom),
        south: yToLat(y + 1, zoom),
      });
    }
  }
  return tiles;
}

function tileRange(bounds: GeoBounds, zoom: number): { x0: number; x1: number; y0: number; y1: number; xCount: number; yCount: number } | null {
  const n = 2 ** zoom;
  const x0 = clamp(Math.floor(lonToX(bounds.west, zoom)), 0, n - 1);
  const x1 = clamp(Math.ceil(lonToX(Math.min(bounds.east, 180), zoom)) - 1, 0, n - 1);
  const y0 = clamp(Math.floor(latToY(bounds.north, zoom)), 0, n - 1);
  const y1 = clamp(Math.ceil(latToY(bounds.south, zoom)) - 1, 0, n - 1);
  if (x1 < x0 || y1 < y0) return null;
  return { x0, x1, y0, y1, xCount: x1 - x0 + 1, yCount: y1 - y0 + 1 };
}

function lonToX(longitude: number, zoom: number): number {
  return ((longitude + 180) / 360) * 2 ** zoom;
}

function latToY(latitude: number, zoom: number): number {
  const rad = (clamp(latitude, -MAX_LAT, MAX_LAT) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom;
}

function xToLon(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}

function yToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
