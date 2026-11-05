import { formatLatitude, formatLongitude } from "./geo";
import type {
  ActiveFilter,
  Filter,
  FlagStatus,
  MediaFormat,
  StudioAction,
  StudioItem,
  Suggestion,
} from "./types";

const ACTIONS: { action: StudioAction; label: string; hint: string; keywords: string }[] = [
  { action: "add-media", label: "Add media", hint: "Browse a folder into the library", keywords: "add media scan import folder browse" },
  { action: "batch-export", label: "Batch export", hint: "Queue the selection", keywords: "batch export save" },
  { action: "index-status", label: "AI indexing status", hint: "Background jobs", keywords: "ai index indexing status" },
  { action: "preset-browse", label: "Preset: Browse", hint: "Grid only", keywords: "preset browse layout" },
  { action: "preset-inspect", label: "Preset: Inspect", hint: "Dock the info panel", keywords: "preset inspect exif info" },
  { action: "preset-compare", label: "Preset: Compare", hint: "Side by side", keywords: "preset compare split" },
  { action: "preset-map", label: "Preset: Map", hint: "Map with the frame panel", keywords: "preset map geo gps" },
  { action: "view-compact", label: "View: Compact grid", hint: "Tight tiles", keywords: "view compact grid" },
  { action: "view-cards", label: "View: Detailed cards", hint: "Larger frames", keywords: "view card detailed" },
  { action: "view-timeline", label: "View: Timeline", hint: "Group by month", keywords: "view timeline date" },
  { action: "view-map", label: "View: Map", hint: "Pins and the frame panel", keywords: "view map geo gps" },
  { action: "view-people", label: "AI Insights", hint: "People, pets, scenes, and objects", keywords: "ai insights people pets faces animals dogs wildlife scenes objects lighthouse beach" },
  { action: "toggle-inspector", label: "Toggle info panel", hint: "Dock, float, or hide", keywords: "toggle inspector info panel exif" },
  { action: "clear-filters", label: "Clear filters", hint: "Show the full roll", keywords: "clear filters reset" },
  { action: "preferences", label: "Preferences", hint: "Draw a map area to cache, or clear tiles", keywords: "preferences settings map tiles download cache zoom area" },
];

const STOP_WORDS = new Set([
  "photo",
  "photos",
  "picture",
  "pictures",
  "pic",
  "pics",
  "shot",
  "shots",
  "image",
  "images",
  "of",
  "with",
  "and",
  "the",
  "a",
  "an",
  "in",
  "on",
  "my",
  "me",
  "some",
  "for",
  "from",
  "featuring",
  "together",
  "near",
  "at",
  "to",
]);

const SUBJECT_WORDS: { words: string[]; value: string }[] = [
  { words: ["puppies", "puppy", "dogs", "dog"], value: "dog" },
  { words: ["kittens", "kitten", "cats", "cat"], value: "cat" },
  { words: ["wildlife", "fauna", "wild"], value: "wildlife" },
  { words: ["birds", "bird"], value: "bird" },
  { words: ["horses", "horse"], value: "horse" },
  { words: ["sunsets", "sunset"], value: "sunset" },
  { words: ["drones", "drone", "aerials", "aerial"], value: "drone" },
  { words: ["beaches", "beach", "seashore", "shore"], value: "beach" },
  { words: ["boats", "boat", "speedboat", "sailboat"], value: "boat" },
  { words: ["lighthouses", "lighthouse", "beacon"], value: "lighthouse" },
  { words: ["water", "waters", "ocean", "sea", "lake"], value: "water" },
  { words: ["vehicles", "vehicle", "cars", "car"], value: "vehicle" },
  { words: ["architecture", "buildings", "building"], value: "architecture" },
  { words: ["people", "persons", "person"], value: "person" },
];

const STRUCTURED = /\b(?:rating:(?:>=|=)?[0-5]|type:(?:raw|jpg|jpeg|video)|flag:(?:pick|reject|unflagged)|date:\d{4}(?:-\d{2})?|camera:[^\s]+)/gi;

export function parseQuery(input: string, items: StudioItem[] = []): Filter[] {
  return parseSearch(input, items);
}

export function parseSearch(input: string, items: StudioItem[]): Filter[] {
  const filters: Filter[] = [];
  const structured = input.match(STRUCTURED) ?? [];
  for (const token of structured) {
    const filter = parseToken(token);
    if (filter) filters.push(filter);
  }
  let rest = input.replace(STRUCTURED, " ");
  const people = namedPeople(items).sort((left, right) => right.name.length - left.name.length);
  for (const person of people) {
    const taken = takePhrase(rest, person.name);
    if (!taken.found) continue;
    rest = taken.rest;
    filters.push({ kind: "person", personId: person.personId, name: person.name });
  }
  const phrases = [
    ...SUBJECT_WORDS.flatMap((entry) => entry.words.map((word) => ({ phrase: word, value: entry.value }))),
    ...subjectLabels(items).map((label) => ({ phrase: label, value: label })),
  ].sort((left, right) => right.phrase.length - left.phrase.length);
  const seenSubjects = new Set<string>();
  for (const entry of phrases) {
    if (entry.phrase.length < 3 || seenSubjects.has(entry.value)) continue;
    const taken = takePhrase(rest, entry.phrase);
    if (!taken.found) continue;
    rest = taken.rest;
    seenSubjects.add(entry.value);
    filters.push({ kind: "subject", value: entry.value });
  }
  for (const word of rest.split(/\s+/)) {
    const token = word.trim();
    if (token.length < 2 || STOP_WORDS.has(token.toLowerCase()) || token.includes(":")) continue;
    filters.push({ kind: "text", value: token });
  }
  return filters;
}

export function suggestions(query: string, items: StudioItem[]): Suggestion[] {
  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();
  if (!needle) return emptySuggestions(items);

  const ranked: { score: number; suggestion: Suggestion }[] = [];
  for (const action of ACTIONS) {
    const score = matchScore(`${action.keywords} ${action.label}`, needle);
    if (score > 0) {
      ranked.push({
        score,
        suggestion: {
          id: `action-${action.action}`,
          type: "action",
          action: action.action,
          label: action.label,
          hint: action.hint,
        },
      });
    }
  }

  for (const idea of filterIdeas(items)) {
    const score = matchScore(`${idea.keywords} ${idea.label} ${idea.hint}`, needle);
    if (score > 0) ranked.push({ score, suggestion: idea.suggestion });
  }

  ranked.sort((left, right) => right.score - left.score);
  const list = ranked.map((entry) => entry.suggestion).slice(0, 8);
  const parsed = parseSearch(trimmed, items);
  if (parsed.length === 1 && parsed[0]?.kind === "text") {
    list.unshift({
      id: `text-${needle}`,
      type: "filters",
      filters: parsed,
      label: `Filename contains “${trimmed}”`,
      hint: "Plain text",
    });
  } else if (parsed.length > 0) {
    list.unshift({
      id: "apply-search",
      type: "filters",
      filters: parsed,
      label: parsed.map((filter) => filterLabel({ ...filter, id: "preview" })).join(" · "),
      hint: trimmed,
    });
  }
  return list.slice(0, 8);
}

export function upsertFilter(current: ActiveFilter[], filter: Filter): ActiveFilter[] {
  const id = filterKey(filter);
  const kept = current.filter((item) =>
    filter.kind === "text" || filter.kind === "subject" || filter.kind === "person"
      ? item.id !== id
      : item.kind !== filter.kind,
  );
  return [...kept, { ...filter, id }];
}

export function matchesFilters(item: StudioItem, filters: ActiveFilter[]): boolean {
  return filters.every((filter) => matchesOne(item, filter));
}

export function filterLabel(filter: ActiveFilter): string {
  switch (filter.kind) {
    case "rating":
      return filter.op === ">=" ? `Rating ≥ ${filter.value}` : `Rating ${filter.value}`;
    case "type":
      return formatLabel(filter.value);
    case "camera":
      return filter.value;
    case "date":
      return formatMonth(filter.value);
    case "flag":
      return flagLabel(filter.value);
    case "text":
      return `“${filter.value}”`;
    case "region": {
      const latitude = (filter.south + filter.north) / 2;
      const longitude = (filter.west + filter.east) / 2;
      return `Region ${formatLatitude(latitude, 1)} ${formatLongitude(longitude, 1)}`;
    }
    case "cluster":
      return filter.label;
    case "person":
      return filter.name;
    case "subject":
      return subjectTitle(filter.value);
  }
}

export function formatMonth(value: string): string {
  const [year, month] = value.split("-");
  if (!year || !month) return value;
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}

export function formatLabel(format: MediaFormat): string {
  if (format === "raw") return "RAW";
  if (format === "jpg") return "JPG";
  return "VIDEO";
}

export function flagLabel(flag: FlagStatus): string {
  if (flag === "pick") return "Picks";
  if (flag === "reject") return "Rejects";
  return "Unflagged";
}

export function shutterFill(shutter: string | null): number {
  const seconds = shutterSeconds(shutter);
  if (seconds == null) return 0;
  const log = Math.log2(seconds);
  const min = Math.log2(1 / 8000);
  const max = Math.log2(8);
  return clamp((max - log) / (max - min));
}

export function isoFill(iso: number | null): number {
  if (iso == null || iso <= 0) return 0;
  const min = Math.log2(50);
  const max = Math.log2(12800);
  return clamp((Math.log2(iso) - min) / (max - min));
}

function emptySuggestions(items: StudioItem[]): Suggestion[] {
  const camera = items[0]?.camera;
  const ideas = filterIdeas(items);
  const curated = [
    actionSuggestion(ACTIONS[0]),
    actionSuggestion(ACTIONS[1]),
    actionSuggestion(ACTIONS[4]),
    actionSuggestion(ACTIONS[5]),
    ideas.find((idea) => idea.suggestion.id === "filter-type-raw")?.suggestion,
    ideas.find((idea) => idea.suggestion.id === "filter-rating-4")?.suggestion,
    ideas.find((idea) => idea.suggestion.id === "filter-flag-pick")?.suggestion,
    camera
      ? ideas.find((idea) => idea.suggestion.id === `filter-camera-${slug(camera)}`)?.suggestion
      : undefined,
  ];
  return curated.filter((item): item is Suggestion => item !== undefined);
}

function actionSuggestion(action: (typeof ACTIONS)[number]): Suggestion {
  return {
    id: `action-${action.action}`,
    type: "action",
    action: action.action,
    label: action.label,
    hint: action.hint,
  };
}

function filterIdeas(items: StudioItem[]): { keywords: string; hint: string; label: string; suggestion: Suggestion }[] {
  const ideas: { keywords: string; hint: string; label: string; suggestion: Suggestion }[] = [
    idea("filter-type-raw", "RAW files", "type:raw", "raw type file", { kind: "type", value: "raw" }),
    idea("filter-type-jpg", "JPEG files", "type:jpg", "jpg jpeg type file", { kind: "type", value: "jpg" }),
    idea("filter-type-video", "Video", "type:video", "video type movie", { kind: "type", value: "video" }),
    idea("filter-rating-4", "Rating 4 and up", "rating:>=4", "rating 4 5 star", {
      kind: "rating",
      op: ">=",
      value: 4,
    }),
    idea("filter-rating-5", "Rating 5", "rating:5", "rating 5 star", { kind: "rating", op: "=", value: 5 }),
    idea("filter-flag-pick", "Picks", "flag:pick", "flag pick", { kind: "flag", value: "pick" }),
    idea("filter-flag-reject", "Rejects", "flag:reject", "flag reject", { kind: "flag", value: "reject" }),
  ];

  for (const camera of unique(items.map((item) => item.camera))) {
    ideas.push(
      idea(`filter-camera-${slug(camera)}`, camera, `camera:${camera}`, `camera ${camera}`, {
        kind: "camera",
        value: camera,
      }),
    );
  }

  for (const month of unique(items.map((item) => item.capturedAt.slice(0, 7))).sort().reverse()) {
    ideas.push(
      idea(`filter-date-${month}`, formatMonth(month), `date:${month}`, `date ${month} ${formatMonth(month)}`, {
        kind: "date",
        value: month,
      }),
    );
  }
  return ideas;
}

function idea(
  id: string,
  label: string,
  hint: string,
  keywords: string,
  filter: Filter,
): { keywords: string; hint: string; label: string; suggestion: Suggestion } {
  return {
    keywords,
    hint,
    label,
    suggestion: { id, type: "filters", filters: [filter], label, hint },
  };
}

function parseToken(token: string): Filter | null {
  const rating = /^rating:(>=|=)?([0-5])$/i.exec(token);
  if (rating) {
    return { kind: "rating", op: rating[1] === ">=" ? ">=" : "=", value: Number(rating[2]) };
  }
  const type = /^type:(raw|jpg|jpeg|video)$/i.exec(token);
  if (type) {
    const value = type[1].toLowerCase();
    return { kind: "type", value: value === "jpeg" ? "jpg" : (value as MediaFormat) };
  }
  const camera = /^camera:(.+)$/i.exec(token);
  if (camera?.[1]?.trim()) return { kind: "camera", value: camera[1].trim() };
  const date = /^date:(\d{4}(?:-\d{2})?)$/.exec(token);
  if (date) return { kind: "date", value: date[1] };
  const flag = /^flag:(pick|reject|unflagged)$/i.exec(token);
  if (flag) return { kind: "flag", value: flag[1].toLowerCase() as FlagStatus };
  if (token.includes(":")) return null;
  return { kind: "text", value: token };
}

function matchesOne(item: StudioItem, filter: Filter): boolean {
  switch (filter.kind) {
    case "rating":
      if (item.rating == null) return false;
      return filter.op === ">=" ? item.rating >= filter.value : item.rating === filter.value;
    case "type":
      return item.format === filter.value;
    case "camera":
      return item.camera.toLowerCase().includes(filter.value.toLowerCase());
    case "date":
      return item.capturedAt.startsWith(filter.value);
    case "flag":
      return item.flag === filter.value;
    case "text": {
      const haystack = `${item.fileName} ${item.folder} ${item.camera}`.toLowerCase();
      return haystack.includes(filter.value.toLowerCase());
    }
    case "region":
      return (
        item.longitude >= filter.west &&
        item.longitude <= filter.east &&
        item.latitude >= filter.south &&
        item.latitude <= filter.north
      );
    case "cluster":
      return filter.ids.includes(item.id);
    case "person":
      return item.faces.some((face) => face.personId === filter.personId);
    case "subject": {
      const value = filter.value.toLowerCase();
      if (value === "person") return item.faces.length > 0;
      return item.subjects.some(
        (tag) =>
          tag.label.toLowerCase() === value ||
          (value === "wildlife" && tag.kind === "wildlife") ||
          (value === "pet" && tag.kind === "pet"),
      );
    }
  }
}

function filterKey(filter: Filter): string {
  switch (filter.kind) {
    case "rating":
      return `rating:${filter.op}${filter.value}`;
    case "type":
      return `type:${filter.value}`;
    case "camera":
      return `camera:${filter.value.toLowerCase()}`;
    case "date":
      return `date:${filter.value}`;
    case "flag":
      return `flag:${filter.value}`;
    case "text":
      return `text:${filter.value.toLowerCase()}`;
    case "region":
      return "region";
    case "cluster":
      return "cluster";
    case "person":
      return `person:${filter.personId}`;
    case "subject":
      return `subject:${filter.value.toLowerCase()}`;
  }
}

function namedPeople(items: StudioItem[]): { personId: string; name: string }[] {
  const people = new Map<string, string>();
  for (const item of items) {
    for (const face of item.faces) {
      if (face.name && face.name.trim()) people.set(face.personId, face.name.trim());
    }
  }
  return [...people.entries()].map(([personId, name]) => ({ personId, name }));
}

function subjectLabels(items: StudioItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.subjects.map((tag) => tag.label.toLowerCase())))];
}

function takePhrase(haystack: string, phrase: string): { found: boolean; rest: string } {
  const pattern = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i");
  if (!pattern.test(haystack)) return { found: false, rest: haystack };
  return { found: true, rest: haystack.replace(pattern, " ") };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function subjectTitle(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function matchScore(haystack: string, needle: string): number {
  const text = haystack.toLowerCase();
  if (text.startsWith(needle)) return 3;
  if (text.includes(needle)) return 2;
  return 0;
}

function shutterSeconds(shutter: string | null): number | null {
  if (!shutter) return null;
  const fraction = /^1\/(\d+(?:\.\d+)?)$/.exec(shutter);
  if (fraction) return 1 / Number(fraction[1]);
  const seconds = /^(\d+(?:\.\d+)?)s$/.exec(shutter);
  if (seconds) return Number(seconds[1]);
  return null;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
