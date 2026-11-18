import { captureMillis } from "./catalog";
import type { StudioItem } from "./types";

export type Trip = {
  id: string;
  label: string;
  summary: string;
  items: StudioItem[];
};

const GAP_MS = 18 * 60 * 60 * 1000;
const MAX_KM = 180;

export function tripGroups(items: StudioItem[]): Trip[] {
  const geotagged = items
    .filter((item) => item.geotagged)
    .slice()
    .sort((left, right) => captureMillis(left.capturedAt) - captureMillis(right.capturedAt));
  const groups: StudioItem[][] = [];
  for (const item of geotagged) {
    const last = groups[groups.length - 1];
    const previous = last?.[last.length - 1];
    if (!last || !previous) {
      groups.push([item]);
      continue;
    }
    const gap = captureMillis(item.capturedAt) - captureMillis(previous.capturedAt);
    const far = haversineKm(previous.latitude, previous.longitude, item.latitude, item.longitude) > MAX_KM;
    if (gap > GAP_MS || far) groups.push([item]);
    else last.push(item);
  }
  return groups
    .filter((group) => group.length >= 2)
    .map((group, index) => {
      const start = group[0]?.capturedAt.slice(0, 10) ?? "";
      const end = group[group.length - 1]?.capturedAt.slice(0, 10) ?? start;
      const label = start === end ? start : `${start} – ${end}`;
      return {
        id: `trip-${index}-${group[0]?.id ?? index}`,
        label,
        summary: `${group.length} frames`,
        items: group,
      };
    });
}

export function shootDay(item: StudioItem): string {
  return item.capturedAt.slice(0, 10);
}

export function formatShootDay(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(
    new Date(year, month - 1, day),
  );
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function aliasResolves(query: string, alias: string): boolean {
  const needle = alias.trim().toLowerCase();
  if (!needle) return false;
  return query.toLowerCase().includes(needle);
}
