import type { DevelopSettings } from "./develop";

export type MediaFormat = "raw" | "jpg" | "video";

export type FlagStatus = "unflagged" | "pick" | "reject";

export type ColorLabel = "red" | "yellow" | "green" | "blue" | "purple";

export type SortKey = "captured" | "name" | "size" | "camera";

export type ViewMode = "compact" | "timeline" | "map" | "insights";

export type LayoutPreset = "browse" | "inspect" | "compare" | "map";

export type GeoBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type PanelMode = "docked" | "floating" | "hidden";

export type StudioAction =
  | "add-media"
  | "batch-export"
  | "preset-browse"
  | "preset-inspect"
  | "preset-compare"
  | "preset-map"
  | "view-compact"
  | "view-timeline"
  | "view-map"
  | "view-people"
  | "toggle-inspector"
  | "clear-filters"
  | "preferences"
  | "slideshow"
  | "rotate";

export type StudioItem = {
  id: string;
  fileName: string;
  folder: string;
  capturedAt: string;
  camera: string;
  lens: string;
  rating: number | null;
  flag: FlagStatus;
  format: MediaFormat;
  fileSize: number;
  iso: number | null;
  shutter: string | null;
  aperture: string | null;
  focalLength: string | null;
  width: number | null;
  height: number | null;
  hash: string;
  histogram: number[];
  latitude: number;
  longitude: number;
  geotagged: boolean;
  sourcePath?: string | null;
  previewUrl?: string | null;
  proxyUrl?: string | null;
  playUrl?: string | null;
  playFile?: string | null;
  inspectUrl?: string | null;
  originalUrl?: string | null;
  originalOnline: boolean;
  plugHint: string | null;
  volumeId: number | null;
  volumeLabel: string | null;
  faces: FaceMark[];
  subjects: SubjectTag[];
  colorLabel: ColorLabel | null;
  rotation: number;
  notes: string;
  keywords: string[];
  indexedAt: number | null;
  develop: DevelopSettings;
};

export type FaceMark = {
  id: string;
  personId: string;
  name: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
};

export type SubjectTag = {
  kind: "pet" | "wildlife" | "scene" | "animal" | "object";
  label: string;
  score: number;
};

export type Filter =
  | { kind: "rating"; op: ">=" | "="; value: number }
  | { kind: "type"; value: MediaFormat }
  | { kind: "camera"; value: string }
  | { kind: "date"; value: string }
  | { kind: "flag"; value: Exclude<FlagStatus, "unflagged"> | "unflagged" }
  | { kind: "text"; value: string }
  | ({ kind: "region" } & GeoBounds)
  | { kind: "cluster"; ids: string[]; label: string }
  | { kind: "visual"; ids: string[]; label: string }
  | { kind: "person"; personId: string; name: string }
  | { kind: "subject"; value: string }
  | { kind: "color"; value: ColorLabel }
  | { kind: "gps" }
  | { kind: "unrated" }
  | { kind: "duplicates"; ids: string[] }
  | { kind: "recent" }
  | { kind: "keyword"; value: string }
  | { kind: "album"; albumId: number; ids: string[]; label: string }
  | { kind: "volume"; volumeId: number; label: string }
  | { kind: "folder"; path: string; label: string }
  | { kind: "offline" };

export type ActiveFilter = Filter & { id: string };

export type Suggestion = {
  id: string;
  label: string;
  hint: string;
} & (
  | { type: "action"; action: StudioAction }
  | { type: "filters"; filters: Filter[] }
);

export type PipelineStatus = {
  phase: string;
  label: string;
  done: number;
  total: number;
};

export type Telemetry = {
  scanLabel: string;
  scanProgress: number | null;
  syncLabel: string;
  storageUsed: string;
  storageFree: string;
  exportLabel: string | null;
  pipeline: PipelineStatus | null;
};
