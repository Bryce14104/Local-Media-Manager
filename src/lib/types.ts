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
  exif: ExifSnapshot | null;
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

export type ViewId = "library" | "scan" | "storage";
