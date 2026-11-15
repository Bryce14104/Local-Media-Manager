import type { VolumeRecord } from "../lib/types";

const AUTO_SCAN_KEY = "shelf-auto-scan-on-plug";

export const AUTO_SCAN_POLL_MS = 2500;

export function readAutoScanOnPlug(): boolean {
  try {
    return localStorage.getItem(AUTO_SCAN_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeAutoScanOnPlug(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_SCAN_KEY, enabled ? "1" : "0");
  } catch {
    // The toggle still applies for this visit.
  }
}

/** Drives that were remembered while unplugged and are connected again. */
export function newlyPlugged(previous: VolumeRecord[], current: VolumeRecord[]): VolumeRecord[] {
  const wasOnline = new Map(previous.map((volume) => [volume.fingerprint, volume.online]));
  return current.filter((volume) => volume.online && wasOnline.get(volume.fingerprint) === false);
}
