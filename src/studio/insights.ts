import type { InsightSnapshot } from "../lib/types";
import type { FaceMark, StudioItem, SubjectTag } from "./types";

export function applyInsights(items: StudioItem[], snapshot: InsightSnapshot): StudioItem[] {
  const names = new Map(snapshot.people.map((person) => [person.id, person.name]));
  const faces = groupBy(snapshot.faces, (face) => face.mediaId);
  const labels = groupBy(snapshot.labels, (label) => label.mediaId);
  return items.map((item) => {
    const mediaId = libraryMediaId(item.id);
    if (mediaId == null) return item;
    return {
      ...item,
      faces: (faces.get(mediaId) ?? []).map((face) => ({
        id: `face-${face.id}`,
        personId: `person-${face.personId}`,
        name: names.get(face.personId) ?? null,
        x: face.x,
        y: face.y,
        width: face.width,
        height: face.height,
        score: face.confidence,
      })),
      subjects: (labels.get(mediaId) ?? []).map((label) => ({
        kind: subjectKind(label.kind),
        label: label.label,
        score: label.score,
      })),
    };
  });
}

export function renameFaces(items: StudioItem[], personId: string, name: string): StudioItem[] {
  const next = name.trim() || null;
  return items.map((item) => ({
    ...item,
    faces: item.faces.map((face) => (face.personId === personId ? { ...face, name: next } : face)),
  }));
}

export function mergeFaces(items: StudioItem[], keepId: string, dropId: string): StudioItem[] {
  const keepName = items.flatMap((item) => item.faces).find((face) => face.personId === keepId)?.name ?? null;
  return items.map((item) => ({
    ...item,
    faces: item.faces.map((face) =>
      face.personId === dropId ? { ...face, personId: keepId, name: keepName } : face,
    ),
  }));
}

export function moveFace(items: StudioItem[], faceId: string, personId: string): StudioItem[] {
  return items.map((item) => ({
    ...item,
    faces: item.faces.map((face) => (face.id === faceId ? { ...face, personId, name: null } : face)),
  }));
}

export function numericSuffix(value: string, prefix: string): number | null {
  if (!value.startsWith(prefix)) return null;
  const rest = value.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}

function libraryMediaId(id: string): number | null {
  return numericSuffix(id, "library-");
}

function subjectKind(kind: string): SubjectTag["kind"] {
  if (kind === "pet" || kind === "wildlife" || kind === "scene" || kind === "animal" || kind === "object") return kind;
  return "animal";
}

function groupBy<T>(rows: T[], key: (row: T) => number): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const id = key(row);
    const list = grouped.get(id) ?? [];
    list.push(row);
    grouped.set(id, list);
  }
  return grouped;
}

export type { FaceMark };
