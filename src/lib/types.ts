export type MediaKind = "image" | "video" | "raw";

export type ExifSnapshot = {
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  capturedAt: string | null;
  orientation: string | null;
  width: number | null;
  height: number | null;
  iso: string | null;
  exposureTime: string | null;
  fNumber: string | null;
  focalLength: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type MediaRecord = {
  id: number;
  filePath: string;
  contentHash: string | null;
  fileSize: number;
  createdAt: number | null;
  modifiedAt: number;
  indexedAt: number;
  rating: number | null;
  mediaKind: MediaKind;
  capturedAt: number | null;
  thumbnailPath: string | null;
  proxyPath: string | null;
  playPath: string | null;
  flag: string | null;
  exif: ExifSnapshot | null;
  colorLabel?: string | null;
  rotation?: number;
  notes?: string | null;
  keywords?: string[];
  developJson?: string | null;
  volumeId?: number | null;
  volumeLabel?: string | null;
  volumeMount?: string | null;
  relativePath?: string | null;
  originalOnline?: boolean;
  plugHint?: string | null;
  cullHint?: string | null;
  markInMs?: number | null;
  markOutMs?: number | null;
  video?: { durationMs?: number | null; fpsMilli?: number | null; codec?: string | null } | null;
};

export type VolumeRecord = {
  id: number;
  fingerprint: string;
  label: string;
  lastMount: string;
  lastSeenAt: number;
  online: boolean;
  mediaCount: number;
  mediaBytes: number;
};

export type WatchedRoot = {
  id: number;
  path: string;
  volumeId: number | null;
  relativePath: string | null;
};

export type ExportReport = {
  originals: number;
  proxies: number;
  missing: string[];
};

export type AlbumRecord = {
  id: number;
  name: string;
  count: number;
};

export type LibrarySummary = {
  databasePath: string;
  mediaCount: number;
  schemaVersion: number;
  columns: string[];
};

export type ScanReport = {
  root: string;
  discovered: number;
  indexed: number;
  unchanged: number;
  failed: number;
  errors: string[];
  durationMs: number;
};

export type ImportPreview = {
  root: string;
  volumeLabel: string;
  volumeMount: string;
  newCount: number;
  knownCount: number;
  newFiles: { path: string; name: string; size: number; kind: string }[];
};

export type RelinkReport = {
  relinked: number;
  scanned: number;
};

export type LibraryHealth = {
  mediaCount: number;
  online: number;
  offline: number;
  missing: { id: number; path: string; volumeLabel: string | null; hint: string }[];
};

export type ViewId = "library" | "scan" | "storage";

export type PersonInsight = {
  id: number;
  name: string | null;
  faceCount: number;
};

export type FaceInsight = {
  id: number;
  mediaId: number;
  personId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

export type LabelInsight = {
  mediaId: number;
  kind: string;
  label: string;
  score: number;
};

export type InsightSnapshot = {
  people: PersonInsight[];
  faces: FaceInsight[];
  labels: LabelInsight[];
};

export type ConceptCluster = {
  id: number;
  kind: "burst" | "semantic" | "person" | string;
  label: string;
  summary: string | null;
  score: number;
  sourceId: number | null;
  mediaIds: number[];
};

export type MediaCaption = {
  mediaId: number;
  tag: string;
  caption: string | null;
  score: number;
};

export type ConceptIndex = {
  clusters: ConceptCluster[];
  captions: MediaCaption[];
};
