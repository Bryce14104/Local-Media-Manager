import { TILE_COLUMNS, TILE_ROWS, packById, tileBounds, type MapPack } from "./mapPacks";

export const MAP_PROMPT_KEY = "shelf.mapPromptSeen";

export type PackRecord = {
  id: string;
  bytes: number;
  tileCount: number;
  savedAt: number;
};

export type MapTile = {
  key: string;
  packId: string;
  column: number;
  row: number;
  west: number;
  south: number;
  east: number;
  north: number;
  url: string;
};

export type MapLibrarySnapshot = {
  ready: boolean;
  error: string | null;
  records: Record<string, PackRecord>;
  tiles: MapTile[];
  job: { packId: string; done: number; total: number } | null;
};

const DB_NAME = "shelf-map-packs";
const DB_VERSION = 1;
const TILE_STORE = "tiles";
const META_STORE = "packs";

type TileRow = {
  key: string;
  packId: string;
  column: number;
  row: number;
  blob: Blob;
};

let snapshot: MapLibrarySnapshot = {
  ready: false,
  error: null,
  records: {},
  tiles: [],
  job: null,
};
const listeners = new Set<(next: MapLibrarySnapshot) => void>();
let loadTask: Promise<void> | null = null;
let libraryGeneration = 0;

export function getMapLibrary(): MapLibrarySnapshot {
  return snapshot;
}

export function subscribeMapLibrary(listener: (next: MapLibrarySnapshot) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function mapPromptSeen(): boolean {
  try {
    return localStorage.getItem(MAP_PROMPT_KEY) === "1";
  } catch {
    return true;
  }
}

export function markMapPromptSeen(): void {
  try {
    localStorage.setItem(MAP_PROMPT_KEY, "1");
  } catch {
    /* Private mode can block storage; the prompt just will not persist. */
  }
}

export function loadMapLibrary(): Promise<void> {
  if (!loadTask) loadTask = readDatabase();
  return loadTask;
}

export async function downloadPack(packId: string): Promise<void> {
  const pack = packById(packId);
  if (!pack) return;
  await loadMapLibrary();
  if (snapshot.records[packId]) return;
  if (snapshot.job) await waitForIdle();
  const generation = libraryGeneration;
  const total = TILE_COLUMNS * TILE_ROWS;
  publish({ ...snapshot, error: null, job: { packId, done: 0, total } });
  const rows: TileRow[] = [];
  try {
    for (let row = 0; row < TILE_ROWS; row += 1) {
      for (let column = 0; column < TILE_COLUMNS; column += 1) {
        if (generation !== libraryGeneration) return;
        const blob = await renderTile(pack, column, row);
        if (generation !== libraryGeneration) return;
        rows.push({ key: tileKey(pack.id, column, row), packId: pack.id, column, row, blob });
        publish({
          ...snapshot,
          job: { packId, done: rows.length, total },
        });
        await pause(30);
      }
    }
    if (generation !== libraryGeneration) return;
    const db = await openDatabase();
    await putRows(db, rows);
    if (generation !== libraryGeneration) return;
    const bytes = rows.reduce((sum, row) => sum + row.blob.size, 0);
    const record: PackRecord = { id: pack.id, bytes, tileCount: rows.length, savedAt: Date.now() };
    await putRecord(db, record);
    if (generation !== libraryGeneration) return;
    publish({
      ...snapshot,
      job: null,
      records: { ...snapshot.records, [pack.id]: record },
      tiles: [...snapshot.tiles.filter((tile) => tile.packId !== pack.id), ...rows.map(toTile)],
    });
  } catch (error) {
    if (generation !== libraryGeneration) return;
    publish({
      ...snapshot,
      job: null,
      error: error instanceof Error ? error.message : "Could not store this map pack",
    });
  }
}

export async function clearPack(packId: string): Promise<void> {
  if (snapshot.job?.packId === packId) libraryGeneration += 1;
  await loadMapLibrary();
  const db = await openDatabase();
  await deletePackRows(db, packId);
  revokePack(packId);
  const records = { ...snapshot.records };
  delete records[packId];
  publish({
    ...snapshot,
    job: snapshot.job?.packId === packId ? null : snapshot.job,
    records,
    tiles: snapshot.tiles.filter((tile) => tile.packId !== packId),
  });
}

export async function clearAllPacks(): Promise<void> {
  libraryGeneration += 1;
  await loadMapLibrary();
  const db = await openDatabase();
  await clearStores(db);
  for (const tile of snapshot.tiles) URL.revokeObjectURL(tile.url);
  publish({ ...snapshot, job: null, records: {}, tiles: [], error: null });
}

function publish(next: MapLibrarySnapshot) {
  snapshot = next;
  for (const listener of listeners) listener(snapshot);
}

async function readDatabase(): Promise<void> {
  try {
    const db = await openDatabase();
    const records = await readRecords(db);
    const rows = await readTiles(db);
    publish({
      ready: true,
      error: null,
      records: Object.fromEntries(records.map((record) => [record.id, record])),
      tiles: rows.map(toTile),
      job: null,
    });
  } catch (error) {
    publish({
      ready: true,
      error: error instanceof Error ? error.message : "Map storage is unavailable",
      records: {},
      tiles: [],
      job: null,
    });
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TILE_STORE)) {
        const tiles = db.createObjectStore(TILE_STORE, { keyPath: "key" });
        tiles.createIndex("packId", "packId");
      }
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open map storage"));
  });
}

function readRecords(db: IDBDatabase): Promise<PackRecord[]> {
  return requestToPromise(db.transaction(META_STORE, "readonly").objectStore(META_STORE).getAll()) as Promise<PackRecord[]>;
}

function readTiles(db: IDBDatabase): Promise<TileRow[]> {
  return requestToPromise(db.transaction(TILE_STORE, "readonly").objectStore(TILE_STORE).getAll()) as Promise<TileRow[]>;
}

function putRows(db: IDBDatabase, rows: TileRow[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TILE_STORE, "readwrite");
    const store = tx.objectStore(TILE_STORE);
    for (const row of rows) store.put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not write map tiles"));
  });
}

function putRecord(db: IDBDatabase, record: PackRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not write map pack"));
  });
}

function deletePackRows(db: IDBDatabase, packId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([TILE_STORE, META_STORE], "readwrite");
    const index = tx.objectStore(TILE_STORE).index("packId");
    const request = index.openCursor(IDBKeyRange.only(packId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    tx.objectStore(META_STORE).delete(packId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not clear map pack"));
  });
}

function clearStores(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([TILE_STORE, META_STORE], "readwrite");
    tx.objectStore(TILE_STORE).clear();
    tx.objectStore(META_STORE).clear();
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

function toTile(row: TileRow): MapTile {
  const pack = packById(row.packId);
  const bounds = pack
    ? tileBounds(pack, row.column, row.row)
    : { west: 0, south: 0, east: 0, north: 0 };
  return {
    key: row.key,
    packId: row.packId,
    column: row.column,
    row: row.row,
    ...bounds,
    url: URL.createObjectURL(row.blob),
  };
}

function revokePack(packId: string) {
  for (const tile of snapshot.tiles) {
    if (tile.packId === packId) URL.revokeObjectURL(tile.url);
  }
}

function tileKey(packId: string, column: number, row: number): string {
  return `${packId}/${column}/${row}`;
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

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function renderTile(pack: MapPack, column: number, row: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not draw a map tile");
  const bounds = tileBounds(pack, column, row);
  const random = mulberry(hash(`${pack.id}:${column}:${row}`));
  context.fillStyle = "#12161c";
  context.fillRect(0, 0, 256, 256);

  const gradient = context.createLinearGradient(0, 0, 256, 256);
  const shade = 18 + Math.floor(random() * 18);
  gradient.addColorStop(0, `rgb(${shade}, ${shade + 4}, ${shade + 10})`);
  gradient.addColorStop(1, "#0f1115");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);

  context.strokeStyle = "rgba(44, 51, 64, 0.9)";
  context.lineWidth = 1;
  for (let line = 1; line < 4; line += 1) {
    context.beginPath();
    context.moveTo((256 / 4) * line, 0);
    context.lineTo((256 / 4) * line, 256);
    context.moveTo(0, (256 / 4) * line);
    context.lineTo(256, (256 / 4) * line);
    context.stroke();
  }

  context.strokeStyle = "rgba(46, 224, 197, 0.35)";
  context.lineWidth = 1.25;
  for (let ridge = 0; ridge < 5; ridge += 1) {
    context.beginPath();
    let x = random() * 256;
    let y = random() * 256;
    context.moveTo(x, y);
    for (let step = 0; step < 6; step += 1) {
      x = Math.min(256, Math.max(0, x + (random() - 0.5) * 90));
      y = Math.min(256, Math.max(0, y + (random() - 0.5) * 70));
      context.lineTo(x, y);
    }
    context.stroke();
  }

  context.fillStyle = "rgba(46, 224, 197, 0.8)";
  context.font = "600 18px Outfit, sans-serif";
  context.fillText(pack.name, 16, 36);
  context.fillStyle = "rgba(141, 149, 166, 0.95)";
  context.font = "12px Outfit, sans-serif";
  context.fillText(`${column + 1}.${row + 1}  offline detail`, 16, 56);
  context.font = "11px ui-monospace, monospace";
  context.fillText(`${bounds.north.toFixed(2)}°, ${bounds.west.toFixed(2)}°`, 16, 240);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode a map tile");
  return blob;
}

function hash(value: string): number {
  let state = 2166136261;
  for (const char of value) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return state >>> 0;
}

function mulberry(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}
