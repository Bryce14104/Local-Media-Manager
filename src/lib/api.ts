import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { InsightSnapshot, LibrarySummary, MediaRecord, ScanReport } from "./types";

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

export async function logSearch(ai: boolean, query: string, summary: string): Promise<void> {
  const line = `AI search ${ai ? "on, visual tags" : "off, file names and paths"} | query ${JSON.stringify(query.trim())} | ${summary || "no filter"}`;
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
