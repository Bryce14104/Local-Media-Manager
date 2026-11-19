import { captureMillis } from "./catalog";
import { formatLatitude, formatLongitude } from "./geo";
import { takePlace } from "./gazetteer";
import { readPersonAliases } from "./libraryPrefs";
import type {
  ActiveFilter,
  Filter,
  ColorLabel,
  FlagStatus,
  MediaFormat,
  StudioAction,
  StudioItem,
  Suggestion,
} from "./types";

const ACTIONS: { action: StudioAction; label: string; hint: string; keywords: string }[] = [
  { action: "add-media", label: "Add media", hint: "Browse a folder into the library", keywords: "add media scan import folder browse" },
  { action: "batch-export", label: "Batch export", hint: "Queue the selection", keywords: "batch export save" },
  { action: "preset-browse", label: "Preset: Browse", hint: "Grid only", keywords: "preset browse layout" },
  { action: "preset-inspect", label: "Preset: Inspect", hint: "Dock the info panel", keywords: "preset inspect exif info" },
  { action: "preset-compare", label: "Preset: Compare", hint: "Side by side", keywords: "preset compare split" },
  { action: "preset-map", label: "Preset: Map", hint: "Map with the frame panel", keywords: "preset map geo gps" },
  { action: "view-compact", label: "View: Compact grid", hint: "Tight tiles", keywords: "view compact grid" },
  { action: "view-timeline", label: "View: Timeline", hint: "Group by shoot day", keywords: "view timeline date" },
  { action: "view-map", label: "View: Map", hint: "Pins and the frame panel", keywords: "view map geo gps" },
  { action: "view-people", label: "AI Insights", hint: "Bursts, cameras, scenes, and folders", keywords: "ai insights clusters bursts collections scenes cameras folders" },
  { action: "toggle-inspector", label: "Toggle info panel", hint: "Dock, float, or hide", keywords: "toggle inspector info panel exif" },
  { action: "clear-filters", label: "Clear filters", hint: "Show the full roll", keywords: "clear filters reset" },
  { action: "preferences", label: "Preferences", hint: "Library auto-scan, relink, slideshow, or map tiles", keywords: "preferences settings library drives auto scan plug relink slideshow playback map tiles download cache zoom area keyboard" },
  { action: "help", label: "Help", hint: "Short steps for search, cull, and files", keywords: "help guide how to keyboard burst review" },
  { action: "download", label: "Download originals", hint: "Cloud on a photo copies the full-resolution file onto this computer", keywords: "download copy originals full resolution archive cloud" },
  { action: "slideshow", label: "Slideshow", hint: "Play the current view", keywords: "slideshow play auto" },
  { action: "rotate", label: "Rotate 90°", hint: "Turn the selected frame", keywords: "rotate turn orientation" },
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
  { words: ["puppies", "puppy", "dogs", "dog", "canine", "hound"], value: "dog" },
  { words: ["kittens", "kitten", "cats", "cat", "tabby", "feline"], value: "cat" },
  { words: ["wildlife", "fauna", "wild", "animals", "animal"], value: "wildlife" },
  { words: ["birds", "bird"], value: "bird" },
  { words: ["horses", "horse", "pony"], value: "horse" },
  { words: ["sunsets", "sunset", "sunrise", "dusk"], value: "sunset" },
  { words: ["drones", "drone", "aerials", "aerial"], value: "drone" },
  { words: ["beaches", "beach", "seashore", "shore", "coast", "seaside", "sand"], value: "beach" },
  { words: ["boats", "boat", "speedboat", "sailboat", "ship", "yacht"], value: "boat" },
  { words: ["lighthouses", "lighthouse", "beacon"], value: "lighthouse" },
  { words: ["water", "waters", "ocean", "sea", "lake", "river"], value: "water" },
  { words: ["vehicles", "vehicle", "cars", "car", "auto"], value: "vehicle" },
  { words: ["architecture", "buildings", "building", "church", "castle"], value: "architecture" },
  { words: ["people", "persons", "person", "portrait", "portraits", "faces", "face"], value: "person" },
  { words: ["flowers", "flower", "floral", "bloom"], value: "flower" },
  { words: ["food", "meal", "dinner", "lunch"], value: "food" },
  { words: ["mountains", "mountain", "alps", "alp", "peak", "peaks"], value: "mountain" },
  { words: ["forest", "woods", "trees", "jungle"], value: "forest" },
  { words: ["snow", "snowy", "winter", "ski", "skiing"], value: "snow" },
  { words: ["sky", "clouds", "cloud"], value: "sky" },
  { words: ["airplane", "airplanes", "plane", "planes", "aircraft", "jet"], value: "airplane" },
  { words: ["motorcycle", "motorbike", "scooter"], value: "motorcycle" },
  { words: ["bicycle", "bike", "bikes", "cycling"], value: "bicycle" },
  { words: ["train", "trains", "railway"], value: "train" },
  { words: ["sports", "sport", "soccer", "football", "basketball", "baseball"], value: "sports" },
  { words: ["music", "concert", "guitar", "piano", "band"], value: "music" },
  { words: ["night", "nighttime", "evening"], value: "night" },
];

const STRUCTURED = /\b(?:rating:(?:>=|=)?[0-5]|type:(?:raw|jpg|jpeg|video)|flag:(?:pick|reject|unflagged)|date:\d{4}(?:-\d{2})?|camera:[^\s]+|color:(?:red|yellow|green|blue|purple)|keyword:[^\s]+|unrated|gps|duplicates|recent)/gi;

export function parseQuery(input: string, items: StudioItem[] = [], aiSearch = true): Filter[] {
  return parseSearch(input, items, aiSearch);
}

/** Map a typed alias such as `mum` onto a named person filter. */
export function filterFromAlias(
  query: string,
  aliases: { alias: string; personId: string; name: string }[],
): Filter | null {
  const rest = ` ${query} `;
  for (const alias of aliases) {
    const taken = takePhrase(rest, alias.alias);
    if (taken.found) return { kind: "person", personId: alias.personId, name: alias.name || alias.alias };
  }
  return null;
}

export function parseSearch(input: string, items: StudioItem[], aiSearch = true): Filter[] {
  const filters: Filter[] = [];
  const structured = input.match(STRUCTURED) ?? [];
  for (const token of structured) {
    const filter = parseToken(token);
    if (filter) filters.push(filter);
  }
  let rest = input.replace(STRUCTURED, " ");
  if (aiSearch) {
    const people = namedPeople(items).sort((left, right) => right.name.length - left.name.length);
    for (const person of people) {
      const taken = takePhrase(rest, person.name);
      if (!taken.found) continue;
      rest = taken.rest;
      filters.push({ kind: "person", personId: person.personId, name: person.name });
    }
    for (const alias of readPersonAliases()) {
      const taken = takePhrase(rest, alias.alias);
      if (!taken.found) continue;
      rest = taken.rest;
      filters.push({ kind: "person", personId: alias.personId, name: alias.name || alias.alias });
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
    const placed = takePlace(rest);
    rest = placed.rest;
    if (placed.filter) filters.push(placed.filter);
  }
  for (const word of rest.split(/\s+/)) {
    const token = word.trim();
    if (token.length < 2 || STOP_WORDS.has(token.toLowerCase()) || token.includes(":")) continue;
    if (aiSearch) {
      const visual = subjectValueForToken(token, items);
      if (visual) {
        filters.push({ kind: "subject", value: visual });
        continue;
      }
    }
    filters.push({ kind: "text", value: token });
  }
  return filters;
}

export function applySearchMode(filters: ActiveFilter[], aiSearch: boolean, items: StudioItem[]): ActiveFilter[] {
  const next: ActiveFilter[] = [];
  const seen = new Set<string>();
  for (const filter of filters) {
    if (!aiSearch && filter.kind === "visual") continue;
    const mapped = retargetFilter(filter, aiSearch, items);
    if (seen.has(mapped.id)) continue;
    seen.add(mapped.id);
    next.push(mapped);
  }
  return next;
}

export function suggestions(query: string, items: StudioItem[], aiSearch = true): Suggestion[] {
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
  const parsed = parseSearch(trimmed, items, aiSearch);
  if (parsed.length === 1 && parsed[0]?.kind === "text") {
    list.unshift({
      id: `text-${needle}`,
      type: "filters",
      filters: parsed,
      label: `Filename contains “${trimmed}”`,
      hint: "File name and path",
    });
  } else if (parsed.length > 0) {
    list.unshift({
      id: "apply-search",
      type: "filters",
      filters: parsed,
      label: parsed.map((filter) => filterLabel({ ...filter, id: "preview" })).join(" · "),
      hint: aiSearch ? "Image embeddings" : "File name and path",
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
  return filters
    .filter((filter) => !(filter.kind === "visual" && filter.ids.length === 0))
    .every((filter) => matchesOne(item, filter));
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
      return `File “${filter.value}”`;
    case "region": {
      const latitude = (filter.south + filter.north) / 2;
      const longitude = (filter.west + filter.east) / 2;
      return `Region ${formatLatitude(latitude, 1)} ${formatLongitude(longitude, 1)}`;
    }
    case "cluster":
      return filter.label;
    case "visual":
      return filter.label;
    case "person":
      return filter.name;
    case "subject":
      return subjectTitle(filter.value);
    case "color":
      return `${filter.value[0].toUpperCase()}${filter.value.slice(1)}`;
    case "gps":
      return "Has GPS";
    case "unrated":
      return "Unrated";
    case "duplicates":
      return "Duplicates";
    case "recent":
      return "Added recently";
    case "keyword":
      return `#${filter.value}`;
    case "album":
      return filter.label;
    case "volume":
      return filter.label;
    case "folder":
      return filter.label;
    case "offline":
      return "Original offline";
    case "cull":
      return "Review";
  }
}

export function formatMonth(value: string): string {
  const [year, month] = value.split("-");
  if (!year || !month) return value;
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}

export function cullHintLabel(hint: string | null | undefined): string | null {
  if (!hint) return null;
  return "Review";
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
    actionSuggestion(ACTIONS[3]),
    actionSuggestion(ACTIONS[4]),
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
  const color = /^color:(red|yellow|green|blue|purple)$/i.exec(token);
  if (color) return { kind: "color", value: color[1].toLowerCase() as ColorLabel };
  const keyword = /^keyword:(.+)$/i.exec(token);
  if (keyword?.[1]?.trim()) return { kind: "keyword", value: keyword[1].trim() };
  if (/^unrated$/i.test(token)) return { kind: "unrated" };
  if (/^gps$/i.test(token)) return { kind: "gps" };
  if (/^duplicates$/i.test(token)) return { kind: "duplicates", ids: [] };
  if (/^recent$/i.test(token)) return { kind: "recent" };
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
      const haystack = `${item.fileName} ${item.folder} ${item.sourcePath ?? ""}`.toLowerCase();
      return haystack.includes(filter.value.toLowerCase());
    }
    case "region":
      return (
        item.geotagged &&
        item.longitude >= filter.west &&
        item.longitude <= filter.east &&
        item.latitude >= filter.south &&
        item.latitude <= filter.north
      );
    case "cluster":
      return filter.ids.includes(item.id);
    case "visual":
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
    case "color":
      return item.colorLabel === filter.value;
    case "gps":
      return item.geotagged;
    case "unrated":
      return item.rating == null;
    case "duplicates":
      return filter.ids.includes(item.id);
    case "recent": {
      const stamp = (item.indexedAt ?? Math.floor(captureMillis(item.capturedAt) / 1000)) * 1000;
      return Date.now() - stamp < 14 * 24 * 60 * 60 * 1000;
    }
    case "keyword":
      return item.keywords.some((word) => word.toLowerCase() === filter.value.toLowerCase())
        || item.notes.toLowerCase().includes(filter.value.toLowerCase());
    case "album":
      return filter.ids.includes(item.id);
    case "volume":
      return item.volumeId === filter.volumeId;
    case "folder":
      return (item.sourcePath ?? item.folder).replace(/\\/g, "/").startsWith(filter.path.replace(/\\/g, "/"));
    case "offline":
      return !item.originalOnline;
    case "cull":
      return Boolean(item.cullHint);
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
    case "visual":
      return "visual";
    case "person":
      return `person:${filter.personId}`;
    case "subject":
      return `subject:${filter.value.toLowerCase()}`;
    case "color":
      return `color:${filter.value}`;
    case "gps":
      return "gps";
    case "unrated":
      return "unrated";
    case "duplicates":
      return "duplicates";
    case "recent":
      return "recent";
    case "keyword":
      return `keyword:${filter.value.toLowerCase()}`;
    case "album":
      return `album:${filter.albumId}`;
    case "volume":
      return `volume:${filter.volumeId}`;
    case "folder":
      return `folder:${filter.path}`;
    case "offline":
      return "offline";
    case "cull":
      return "cull";
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

function wordForms(word: string): string[] {
  const lower = word.toLowerCase();
  const forms = [lower];
  if (lower.endsWith("ies") && lower.length > 4) forms.push(`${lower.slice(0, -3)}y`);
  if (lower.endsWith("s") && lower.length > 3) forms.push(lower.slice(0, -1));
  if (lower.endsWith("es") && lower.length > 4) forms.push(lower.slice(0, -2));
  return forms;
}

function retargetFilter(filter: ActiveFilter, aiSearch: boolean, items: StudioItem[]): ActiveFilter {
  if (!aiSearch && filter.kind === "subject") {
    return { kind: "text", value: filter.value, id: `text:${filter.value.toLowerCase()}` };
  }
  if (!aiSearch && filter.kind === "person") {
    return { kind: "text", value: filter.name, id: `text:${filter.name.toLowerCase()}` };
  }
  if (aiSearch && filter.kind === "text") {
    const visual = subjectValueForToken(filter.value, items);
    if (visual) return { kind: "subject", value: visual, id: `subject:${visual.toLowerCase()}` };
    const person = namedPeople(items).find((entry) => entry.name.toLowerCase() === filter.value.toLowerCase());
    if (person) return { kind: "person", personId: person.personId, name: person.name, id: `person:${person.personId}` };
  }
  return filter;
}

function subjectValueForToken(token: string, items: StudioItem[]): string | null {
  const labels = subjectLabels(items);
  const known = new Set<string>([
    ...SUBJECT_WORDS.flatMap((entry) => [entry.value, ...entry.words]),
    ...labels,
  ]);
  const hit = wordForms(token).find((form) => known.has(form)) ?? closestWord(token, known);
  if (!hit) return null;
  const entry = SUBJECT_WORDS.find((candidate) => candidate.value === hit || candidate.words.includes(hit));
  return entry ? entry.value : hit;
}

function closestWord(token: string, known: Set<string>): string | null {
  const needle = token.toLowerCase();
  const budget = needle.length <= 3 ? 0 : needle.length <= 6 ? 1 : 2;
  if (budget === 0) return null;
  let best: { word: string; distance: number } | null = null;
  for (const word of known) {
    if (Math.abs(word.length - needle.length) > budget) continue;
    if (word[0] !== needle[0]) continue;
    const distance = editDistance(needle, word);
    if (distance === 0) return word;
    if (distance <= budget && (!best || distance < best.distance)) best = { word, distance };
  }
  return best?.word ?? null;
}

function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) grid[i][0] = i;
  for (let j = 0; j < cols; j += 1) grid[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      grid[i][j] = Math.min(grid[i - 1][j] + 1, grid[i][j - 1] + 1, grid[i - 1][j - 1] + cost);
    }
  }
  return grid[left.length][right.length];
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
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((word) => closestWord(needle, new Set([word])) === word)) return 1;
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
