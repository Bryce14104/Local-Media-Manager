import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

/** URL the webview can actually load. Camera originals are never passed through here. */
export function mediaSrc(path: string | null | undefined): string | null {
  if (!path) return null;
  if (!isTauri()) return path;
  return convertFileSrc(path, "shelf");
}
