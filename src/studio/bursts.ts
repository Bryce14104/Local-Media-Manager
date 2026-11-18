import { captureMillis } from "./catalog";
import type { StudioItem } from "./types";

const GAP_MS = 10 * 60 * 1000;

export type BurstGroup = {
  id: string;
  items: StudioItem[];
};

export function burstGroups(items: StudioItem[]): BurstGroup[] {
  const ordered = [...items].sort((left, right) => captureMillis(left.capturedAt) - captureMillis(right.capturedAt));
  const groups: BurstGroup[] = [];
  for (const item of ordered) {
    const last = groups[groups.length - 1];
    const stamp = captureMillis(item.capturedAt);
    if (
      last &&
      stamp - captureMillis(last.items[last.items.length - 1]?.capturedAt ?? item.capturedAt) <= GAP_MS
    ) {
      last.items.push(item);
      continue;
    }
    groups.push({ id: `burst-${item.id}`, items: [item] });
  }
  return groups;
}

export function collapseBursts(items: StudioItem[]): StudioItem[] {
  const groups = burstGroups(items);
  return groups.map((group) => {
    if (group.items.length === 1) return group.items[0] as StudioItem;
    const hero =
      group.items.find((item) => item.flag === "pick") ??
      group.items.find((item) => (item.rating ?? 0) >= 4) ??
      group.items[0];
    if (!hero) return group.items[0] as StudioItem;
    return { ...hero, burstSize: group.items.length, burstIds: group.items.map((item) => item.id) };
  });
}

export function burstStrip(items: StudioItem[], current: StudioItem): StudioItem[] {
  const group = burstGroups(items).find((entry) => entry.items.some((item) => item.id === current.id));
  return group?.items ?? [current];
}
