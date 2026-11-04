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
  { action: "add-media", label: "Add media", hint: "Index a folder", keywords: "add media scan import folder" },
  { action: "batch-export", label: "Batch export", hint: "Queue the selection", keywords: "batch export save" },
  { action: "index-status", label: "AI indexing status", hint: "Background jobs", keywords: "ai index indexing status" },
  { action: "preset-browse", label: "Preset: Browse", hint: "Grid only", keywords: "preset browse layout" },
  { action: "preset-inspect", label: "Preset: Inspect", hint: "Dock the info panel", keywords: "preset inspect exif info" },
  { action: "preset-compare", label: "Preset: Compare", hint: "Side by side", keywords: "preset compare split" },
  { action: "preset-map", label: "Preset: Map", hint: "Map above the grid", keywords: "preset map geo gps" },
  { action: "view-compact", label: "View: Compact grid", hint: "Tight tiles", keywords: "view compact grid" },
  { action: "view-cards", label: "View: Detailed cards", hint: "Larger frames", keywords: "view card detailed" },
  { action: "view-timeline", label: "View: Timeline", hint: "Group by month", keywords: "view timeline date" },
  { action: "view-map", label: "View: Map", hint: "Pins for the roll", keywords: "view map geo gps" },
  { action: "toggle-inspector", label: "Toggle info panel", hint: "Dock, float, or hide", keywords: "toggle inspector info panel exif" },
  { action: "clear-filters", label: "Clear filters", hint: "Show the full roll", keywords: "clear filters reset" },
  { action: "preferences", label: "Preferences", hint: "Review or clear cached map regions", keywords: "preferences settings map tiles download cache" },
];

export function parseQuery(input: string): Filter[] {
  return input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(parseToken)
    .filter((filter): filter is Filter => filter !== null);
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
  const parsed = parseQuery(trimmed);
  if (parsed.length > 0 && trimmed.includes(":")) {
    list.unshift({
      id: "apply-typed",
      type: "filters",
      filters: parsed,
      label: parsed.length === 1 ? "Apply filter" : `Apply ${parsed.length} filters`,
      hint: trimmed,
    });
  } else if (parsed.length === 1 && parsed[0]?.kind === "text" && !trimmed.includes(":")) {
    const already = list.some((item) => item.type === "filters" && item.filters[0]?.kind === "text");
    if (!already) {
      list.unshift({
        id: `text-${needle}`,
        type: "filters",
        filters: parsed,
        label: `Filename contains “${trimmed}”`,
        hint: "Plain text",
      });
    }
  }
  return list.slice(0, 8);
}

export function upsertFilter(current: ActiveFilter[], filter: Filter): ActiveFilter[] {
  const id = filterKey(filter);
  const kept = current.filter((item) =>
    filter.kind === "text" ? item.id !== id : item.kind !== filter.kind,
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
  }
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
