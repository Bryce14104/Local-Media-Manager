export type MediaFormat = "raw" | "jpg" | "video";

export type FlagStatus = "unflagged" | "pick" | "reject";

export type ViewMode = "compact" | "cards" | "timeline" | "map";

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
  | "index-status"
  | "preset-browse"
  | "preset-inspect"
  | "preset-compare"
  | "preset-map"
  | "view-compact"
  | "view-cards"
  | "view-timeline"
  | "view-map"
  | "toggle-inspector"
  | "clear-filters"
  | "preferences";

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
  previewUrl?: string | null;
  inspectUrl?: string | null;
};

export type Filter =
  | { kind: "rating"; op: ">=" | "="; value: number }
  | { kind: "type"; value: MediaFormat }
  | { kind: "camera"; value: string }
  | { kind: "date"; value: string }
  | { kind: "flag"; value: Exclude<FlagStatus, "unflagged"> | "unflagged" }
  | { kind: "text"; value: string }
  | ({ kind: "region" } & GeoBounds)
  | { kind: "cluster"; ids: string[]; label: string };

export type ActiveFilter = Filter & { id: string };

export type Suggestion = {
  id: string;
  label: string;
  hint: string;
} & (
  | { type: "action"; action: StudioAction }
  | { type: "filters"; filters: Filter[] }
);

export type Telemetry = {
  scanLabel: string;
  scanProgress: number | null;
  syncLabel: string;
  storageUsed: string;
  storageFree: string;
  exportLabel: string | null;
};

export type IndexJob = {
  name: string;
  detail: string;
  progress: number;
};
