import type { ConceptIndex } from "../lib/types";
import { placeName, captureMillis } from "./catalog";
import { numericSuffix } from "./insights";
import type { StudioItem } from "./types";

const BURST_GAP_MS = 10 * 60 * 1000;

export type InsightGroup = {
  id: string;
  kind: "burst" | "semantic" | "person";
  label: string;
  summary: string;
  raw: string;
  personId: string | null;
  name: string | null;
  items: StudioItem[];
};

export type CaptionChip = {
  tag: string;
  label: string;
  caption: string;
  count: number;
  items: StudioItem[];
};

export type PresentedConcepts = {
  bursts: InsightGroup[];
  semantic: InsightGroup[];
  people: InsightGroup[];
  captions: CaptionChip[];
};

export function presentConcepts(items: StudioItem[], index: ConceptIndex | null): PresentedConcepts {
  if (index == null) return deriveConcepts(items);
  return conceptsFromIndex(items, index);
}

function conceptsFromIndex(items: StudioItem[], index: ConceptIndex): PresentedConcepts {
  const byMedia = new Map<number, StudioItem>();
  for (const item of items) {
    const id = numericSuffix(item.id, "library-");
    if (id != null) byMedia.set(id, item);
  }
  const resolve = (ids: number[]) => ids.flatMap((id) => {
    const item = byMedia.get(id);
    return item ? [item] : [];
  });

  const bursts: InsightGroup[] = [];
  const semantic: InsightGroup[] = [];
  const people: InsightGroup[] = [];
  for (const cluster of index.clusters) {
    const members = resolve(cluster.mediaIds);
    if (members.length === 0) continue;
    const summary = cluster.summary?.trim() || frameSummary(members.length);
    if (cluster.kind === "burst") {
      bursts.push(group("burst", cluster.label, summary, cluster.label, null, null, members));
    } else if (cluster.kind === "person") {
      continue;
    }
  }

  const captions = chipsFromCaptions(index, byMedia);
  return { bursts, semantic, people, captions };
}

function chipsFromCaptions(index: ConceptIndex, byMedia: Map<number, StudioItem>): CaptionChip[] {
  const grouped = new Map<string, { items: StudioItem[]; captions: Map<string, number> }>();
  for (const row of index.captions) {
    const tag = row.tag.trim().toLowerCase();
    if (!tag) continue;
    const item = byMedia.get(row.mediaId);
    if (!item) continue;
    const entry = grouped.get(tag) ?? { items: [] as StudioItem[], captions: new Map<string, number>() };
    if (!entry.items.some((current) => current.id === item.id)) entry.items.push(item);
    const sentence = row.caption?.trim();
    if (sentence) entry.captions.set(sentence, (entry.captions.get(sentence) ?? 0) + 1);
    grouped.set(tag, entry);
  }
  return [...grouped.entries()]
    .map(([tag, entry]) => ({
      tag,
      label: titleCase(tag),
      caption: topCaption(entry.captions) || titleCase(tag),
      count: entry.items.length,
      items: entry.items,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function deriveConcepts(items: StudioItem[]): PresentedConcepts {
  return {
    bursts: burstGroups(items),
    semantic: [],
    people: [],
    captions: captionChips(items),
  };
}

function burstGroups(items: StudioItem[]): InsightGroup[] {
  const ordered = items
    .filter((item) => Number.isFinite(captureMillis(item.capturedAt)))
    .slice()
    .sort((a, b) => captureMillis(a.capturedAt) - captureMillis(b.capturedAt) || a.id.localeCompare(b.id));
  const byFolder = new Map<string, StudioItem[]>();
  for (const item of ordered) {
    const list = byFolder.get(item.folder) ?? [];
    list.push(item);
    byFolder.set(item.folder, list);
  }
  const groups: InsightGroup[] = [];
  for (const folderItems of byFolder.values()) {
    let index = 0;
    while (index < folderItems.length) {
      let end = index + 1;
      while (
        end < folderItems.length &&
        captureMillis(folderItems[end].capturedAt) - captureMillis(folderItems[end - 1].capturedAt) <= BURST_GAP_MS
      ) {
        end += 1;
      }
      const run = folderItems.slice(index, end);
      if (run.length >= 2) {
        const start = captureMillis(run[0].capturedAt);
        const span = Math.max(0, Math.round((captureMillis(run[run.length - 1].capturedAt) - start) / 1000));
        const place = titleCase(placeName(run[0].folder));
        const label = `${place} · ${clock(run[0].capturedAt)}`;
        groups.push(group("burst", label, burstSummary(run.length, span), label, null, null, run));
      }
      index = end;
    }
  }
  return groups.sort(
    (a, b) => captureMillis(b.items[0].capturedAt) - captureMillis(a.items[0].capturedAt) || a.label.localeCompare(b.label),
  );
}

function captionChips(items: StudioItem[]): CaptionChip[] {
  const grouped = new Map<string, { items: StudioItem[]; captions: Map<string, number> }>();
  for (const item of items) {
    const tags = uniqueTags(item);
    if (tags.length === 0) continue;
    const sentence = captionSentence(tags);
    for (const tag of tags) {
      const entry = grouped.get(tag) ?? { items: [] as StudioItem[], captions: new Map<string, number>() };
      if (!entry.items.some((current) => current.id === item.id)) entry.items.push(item);
      entry.captions.set(sentence, (entry.captions.get(sentence) ?? 0) + 1);
      grouped.set(tag, entry);
    }
  }
  return [...grouped.entries()]
    .map(([tag, entry]) => ({
      tag,
      label: titleCase(tag),
      caption: topCaption(entry.captions) || titleCase(tag),
      count: entry.items.length,
      items: entry.items,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function uniqueTags(item: StudioItem): string[] {
  const tags: { tag: string; score: number }[] = [];
  for (const subject of item.subjects) {
    const tag = subject.label.trim().toLowerCase();
    if (!tag || tags.some((entry) => entry.tag === tag)) continue;
    tags.push({ tag, score: subject.score });
  }
  return tags.sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag)).map((entry) => entry.tag);
}

export function captionSentence(tags: string[]): string {
  const words = [...new Set(tags.map((tag) => titleCase(tag.trim())).filter(Boolean))];
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}

export function titleCase(value: string): string {
  return value.replace(/\b[\p{L}\p{N}]+/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function group(
  kind: InsightGroup["kind"],
  label: string,
  summary: string,
  raw: string,
  personId: string | null,
  name: string | null,
  items: StudioItem[],
): InsightGroup {
  const anchor = items[0]?.id ?? label;
  const id = kind === "person" && personId ? personId : `${kind}:${label}:${anchor}`;
  return { id, kind, label, summary, raw, personId, name, items };
}

function frameSummary(count: number): string {
  return count === 1 ? "1 frame" : `${count} frames`;
}

function burstSummary(count: number, spanSeconds: number): string {
  const frames = frameSummary(count);
  if (spanSeconds < 90) return `${frames} · sequence`;
  const minutes = Math.floor(spanSeconds / 60);
  if (minutes < 1) return `${frames} · sequence`;
  return `${frames} · ${minutes} min`;
}

function clock(capturedAt: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(capturedAt);
  if (!match) return capturedAt.slice(11, 16) || "";
  return `${match[1]}:${match[2]}`;
}

function topCaption(captions: Map<string, number>): string {
  return [...captions.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}
