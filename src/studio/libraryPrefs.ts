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

export type PersonAlias = { alias: string; personId: string; name: string };

const ALIAS_KEY = "shelf-person-aliases";

export function readPersonAliases(): PersonAlias[] {
  try {
    const raw = localStorage.getItem(ALIAS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersonAlias[];
    return Array.isArray(parsed) ? parsed.filter((row) => row.alias && row.personId) : [];
  } catch {
    return [];
  }
}

export function writePersonAliases(aliases: PersonAlias[]): void {
  try {
    localStorage.setItem(ALIAS_KEY, JSON.stringify(aliases));
  } catch {
    // Local only.
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
