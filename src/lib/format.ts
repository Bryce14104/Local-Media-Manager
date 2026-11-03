export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "Unknown size";
  if (size < 1024) return `${Math.round(size)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatTimestamp(seconds: number | null): string {
  if (seconds == null) return "Unknown";
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

export function fileName(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function folderPath(path: string): string {
  const parts = path.split(/[/\\]/);
  parts.pop();
  const folder = parts.join(path.includes("\\") ? "\\" : "/");
  return folder || path;
}

export function formatKind(kind: string): string {
  if (kind === "video") return "Video";
  if (kind === "raw") return "Raw";
  return "Image";
}
