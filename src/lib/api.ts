import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AlbumRecord,
  ConceptIndex,
  ExportReport,
  InsightSnapshot,
  LibrarySummary,
  MediaRecord,
  ScanReport,
  ImportPreview,
  RelinkReport,
  LibraryHealth,
  VolumeRecord,
  WatchedRoot,
} from "./types";

export class BridgeError extends Error {
  readonly offline: boolean;

  constructor(message: string, offline = false) {
    super(message);
    this.name = "BridgeError";
    this.offline = offline;
  }
}

export function desktopBridgeAvailable(): boolean {
  return isTauri();
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Something went wrong while talking to the local library.";
}

function assertBridge(): void {
  if (!desktopBridgeAvailable()) {
    throw new BridgeError(
      "Desktop bridge is not connected. Run npm run tauri dev to use the library.",
      true,
    );
  }
}

export async function fetchLibrary(): Promise<{
  summary: LibrarySummary;
  media: MediaRecord[];
}> {
  assertBridge();
  const [summary, media] = await Promise.all([
    invoke<LibrarySummary>("library_summary"),
    invoke<MediaRecord[]>("list_media"),
  ]);
  return { summary, media };
}

export async function scanDirectory(root: string): Promise<ScanReport> {
  assertBridge();
  return invoke<ScanReport>("scan_directory", { root });
}

export async function indexPaths(paths: string[]): Promise<ScanReport> {
  assertBridge();
  return invoke<ScanReport>("index_paths", { paths });
}

export async function setFlags(paths: string[], flag: "pick" | "reject" | null): Promise<number> {
  assertBridge();
  return invoke<number>("set_flags", { paths, flag });
}

export async function removeFromLibrary(paths: string[]): Promise<number> {
  assertBridge();
  return invoke<number>("remove_media", { paths });
}

export async function deleteFromDisk(paths: string[]): Promise<{ removed: number; failed: string[] }> {
  assertBridge();
  return invoke<{ removed: number; failed: string[] }>("delete_media", { paths });
}

export async function fetchInsights(): Promise<InsightSnapshot> {
  assertBridge();
  return invoke<InsightSnapshot>("list_insights");
}

export async function fetchConcepts(): Promise<ConceptIndex> {
  assertBridge();
  return invoke<ConceptIndex>("list_concepts");
}

export async function renamePerson(id: number, name: string | null): Promise<void> {
  assertBridge();
  return invoke("rename_person", { id, name });
}

export async function mergePeople(keepId: number, dropId: number): Promise<void> {
  assertBridge();
  return invoke("merge_people", { keepId, dropId });
}

export async function splitFace(faceId: number): Promise<number> {
  assertBridge();
  return invoke<number>("split_face", { faceId });
}

export type EmbeddingHit = {
  mediaId: number;
  path: string;
  score: number;
  label: string;
};

export async function searchEmbeddings(query: string): Promise<EmbeddingHit[]> {
  assertBridge();
  return invoke<EmbeddingHit[]>("ai_search", { query });
}

export async function logSearch(ai: boolean, query: string, summary: string): Promise<void> {
  const line = `Smart Search ${ai ? "on, visual tags" : "off, file names and paths"} | query ${JSON.stringify(query.trim())} | ${summary || "no filter"}`;
  if (!desktopBridgeAvailable()) {
    console.info(`shelf search: ${line}`);
    return;
  }
  try {
    await invoke("log_search", { ai, query, summary });
  } catch {
    console.info(`shelf search: ${line}`);
  }
}

export async function setRating(
  path: string,
  rating: number | null,
): Promise<MediaRecord> {
  assertBridge();
  return invoke<MediaRecord>("set_rating", { path, rating });
}

export async function pickImportPaths(): Promise<string[] | null> {
  assertBridge();
  const selected = await open({
    title: "Browse folders",
    directory: true,
    multiple: true,
    recursive: true,
  });
  if (selected == null) return null;
  const paths = (Array.isArray(selected) ? selected : [selected]).filter(
    (path): path is string => typeof path === "string" && path.trim().length > 0,
  );
  return paths.length > 0 ? paths : null;
}

const playBlobs = new Map<string, string>();

export async function playableUrl(filePath: string | null | undefined, href: string | null | undefined): Promise<string | null> {
  if (filePath && desktopBridgeAvailable()) {
    const cached = playBlobs.get(filePath);
    if (cached) return cached;
    const payload = await invoke<ArrayBuffer | number[]>("read_media", { path: filePath });
    const bytes = payload instanceof ArrayBuffer ? new Uint8Array(payload) : Uint8Array.from(payload);
    const url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
    playBlobs.set(filePath, url);
    return url;
  }
  return href ?? null;
}

export async function setColor(paths: string[], color: string | null): Promise<number> {
  assertBridge();
  return invoke<number>("set_color", { paths, color });
}

export async function setRotation(path: string, rotation: number): Promise<MediaRecord> {
  assertBridge();
  return invoke<MediaRecord>("set_rotation", { path, rotation });
}

export async function setNotes(path: string, notes: string | null): Promise<void> {
  assertBridge();
  return invoke("set_notes", { path, notes });
}

export async function setKeywords(path: string, keywords: string[]): Promise<void> {
  assertBridge();
  return invoke("set_keywords", { path, keywords });
}

export async function listAlbums(): Promise<AlbumRecord[]> {
  assertBridge();
  return invoke<AlbumRecord[]>("list_albums");
}

export async function createAlbum(name: string): Promise<AlbumRecord> {
  assertBridge();
  return invoke<AlbumRecord>("create_album", { name });
}

export async function addToAlbum(albumId: number, mediaIds: number[]): Promise<number> {
  assertBridge();
  return invoke<number>("add_to_album", { albumId, mediaIds });
}

export async function albumMediaIds(albumId: number): Promise<number[]> {
  assertBridge();
  return invoke<number[]>("album_media_ids", { albumId });
}

export async function revealPath(path: string): Promise<void> {
  assertBridge();
  return invoke("reveal_path", { path });
}

export async function pickDirectory(title = "Choose a folder"): Promise<string | null> {
  assertBridge();
  const selected = await open({ title, directory: true, multiple: false });
  return typeof selected === "string" && selected.trim() ? selected : null;
}

export async function setDevelop(path: string, develop: string | null): Promise<void> {
  assertBridge();
  return invoke("set_develop", { path, develop });
}

export async function writeBytes(path: string, bytes: number[]): Promise<void> {
  assertBridge();
  return invoke("write_bytes", { path, bytes });
}

export async function copyOriginals(paths: string[], destination: string): Promise<number> {
  assertBridge();
  return invoke<number>("copy_originals", { paths, destination });
}

export async function downloadOriginals(
  paths: string[],
  destination: string,
): Promise<{ copied: number; missing: string[] }> {
  assertBridge();
  return invoke("download_originals", { paths, destination });
}

export async function exportMedia(paths: string[], destination: string): Promise<ExportReport> {
  assertBridge();
  return invoke<ExportReport>("export_media", { paths, destination });
}

export async function listVolumes(): Promise<VolumeRecord[]> {
  assertBridge();
  return invoke<VolumeRecord[]>("list_volumes");
}

export async function listWatches(): Promise<WatchedRoot[]> {
  assertBridge();
  return invoke<WatchedRoot[]>("list_watches");
}

export async function rescanWatched(volumeFingerprint?: string): Promise<ScanReport> {
  assertBridge();
  return invoke<ScanReport>("rescan_watched", {
    volumeFingerprint: volumeFingerprint ?? null,
  });
}

export async function previewImport(root: string): Promise<ImportPreview> {
  assertBridge();
  return invoke<ImportPreview>("preview_import", { root });
}

export async function relinkFolder(root: string): Promise<RelinkReport> {
  assertBridge();
  return invoke<RelinkReport>("relink_folder", { root });
}

export async function libraryHealth(): Promise<LibraryHealth> {
  assertBridge();
  return invoke<LibraryHealth>("library_health");
}

export async function similarTo(path: string): Promise<EmbeddingHit[]> {
  assertBridge();
  return invoke<EmbeddingHit[]>("similar_to", { path });
}

export async function cloneVirtual(path: string): Promise<MediaRecord> {
  assertBridge();
  return invoke<MediaRecord>("clone_virtual", { path });
}

export async function workingPreview(path: string): Promise<string> {
  assertBridge();
  return invoke<string>("working_preview", { path });
}

export async function pauseCatalog(paused: boolean): Promise<void> {
  assertBridge();
  return invoke("pause_catalog", { paused });
}

export async function stopCatalog(): Promise<void> {
  assertBridge();
  return invoke("stop_catalog");
}

export async function ejectVolume(mount: string): Promise<void> {
  assertBridge();
  return invoke("eject_volume", { mount });
}

export async function exportTravelLibrary(destination: string, ids: number[]): Promise<{ destination: string; mediaCount: number; previews: number }> {
  assertBridge();
  return invoke("export_travel_library", { destination, ids });
}

export async function openLibrary(path: string): Promise<LibrarySummary> {
  assertBridge();
  return invoke<LibrarySummary>("open_library", { path });
}

export async function newLibrary(destination: string): Promise<LibrarySummary> {
  assertBridge();
  return invoke<LibrarySummary>("new_library", { destination });
}

export async function writeXmp(path: string): Promise<{ path: string; wrote: boolean }> {
  assertBridge();
  return invoke("write_xmp", { path });
}

export async function setMarks(path: string, markInMs: number | null, markOutMs: number | null): Promise<MediaRecord> {
  assertBridge();
  return invoke<MediaRecord>("set_marks", { path, markInMs, markOutMs });
}

export async function exportSubclip(path: string, destination: string): Promise<string> {
  assertBridge();
  return invoke<string>("export_subclip", { path, destination });
}

export async function rebuildPreviews(): Promise<void> {
  assertBridge();
  return invoke("rebuild_previews");
}

export async function ffmpegStatus(): Promise<boolean> {
  assertBridge();
  return invoke<boolean>("ffmpeg_status");
}
