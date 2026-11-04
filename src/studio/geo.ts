import type { GeoBounds } from "./types";

export type MapView = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type MapSize = {
  width: number;
  height: number;
};

export function project(longitude: number, latitude: number): { x: number; y: number } {
  return { x: longitude + 180, y: 90 - latitude };
}

export function formatLatitude(value: number, digits = 2): string {
  return `${Math.abs(value).toFixed(digits)}°${value >= 0 ? "N" : "S"}`;
}

export function formatLongitude(value: number, digits = 2): string {
  return `${Math.abs(value).toFixed(digits)}°${value >= 0 ? "E" : "W"}`;
}

export function fitWorld(size: MapSize): MapView {
  const aspect = aspectOf(size);
  if (aspect >= 2) {
    const w = 180 * aspect;
    return { x: 180 - w / 2, y: 0, w, h: 180 };
  }
  const h = 360 / aspect;
  return { x: 0, y: 90 - h / 2, w: 360, h };
}

export function fitBounds(bounds: GeoBounds, size: MapSize): MapView {
  const aspect = aspectOf(size);
  const lonSpan = Math.max(1.6, (bounds.east - bounds.west) * 1.7);
  const latSpan = Math.max(1.6 / aspect, (bounds.north - bounds.south) * 1.7);
  const w = Math.max(lonSpan, latSpan * aspect);
  const h = w / aspect;
  const cx = (bounds.west + bounds.east) / 2 + 180;
  const cy = 90 - (bounds.south + bounds.north) / 2;
  return clampPan({ x: cx - w / 2, y: cy - h / 2, w, h });
}

export function fitItems(
  points: { latitude: number; longitude: number }[],
  size: MapSize,
): MapView {
  if (points.length === 0) return fitWorld(size);
  let west = 180;
  let east = -180;
  let south = 90;
  let north = -90;
  let nearest = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    west = Math.min(west, point.longitude);
    east = Math.max(east, point.longitude);
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
    for (let other = index + 1; other < points.length; other += 1) {
      const next = points[other];
      const distance = Math.hypot(point.longitude - next.longitude, point.latitude - next.latitude);
      if (distance > 0) nearest = Math.min(nearest, distance);
    }
  }
  const aspect = size.width > 1 && size.height > 1 ? size.width / size.height : 2;
  const span = Math.max(east - west, (north - south) * aspect, 0.05);
  let w = span * (span > 12 ? 1.25 : 2.2);
  if (span < 12 && nearest < Infinity && size.width > 0) {
    const separated = (nearest * size.width) / 64;
    w = Math.min(w, Math.max(0.08, separated));
  }
  const h = w / aspect;
  const cx = (west + east) / 2 + 180;
  const cy = 90 - (south + north) / 2;
  return clampPan({ x: cx - w / 2, y: cy - h / 2, w, h });
}

export function clampPan(view: MapView): MapView {
  const margin = 12;
  return {
    ...view,
    x: Math.min(360 - margin, Math.max(margin - view.w, view.x)),
    y: Math.min(180 - margin, Math.max(margin - view.h, view.y)),
  };
}

export function frameBounds(bounds: GeoBounds, size: MapSize): MapView {
  const aspect = aspectOf(size);
  const lonSpan = Math.max(0.04, (bounds.east - bounds.west) * 1.35);
  const latSpan = Math.max(0.04 / aspect, (bounds.north - bounds.south) * 1.35);
  const w = Math.max(lonSpan, latSpan * aspect);
  const h = w / aspect;
  const cx = (bounds.west + bounds.east) / 2 + 180;
  const cy = 90 - (bounds.south + bounds.north) / 2;
  return clampPan({ x: cx - w / 2, y: cy - h / 2, w, h });
}

export function zoomAt(view: MapView, cursor: { x: number; y: number }, factor: number, size: MapSize): MapView {
  const aspect = aspectOf(size);
  const street = (360 / 16384) * (Math.max(size.width, 1) / 420);
  const w = clamp(view.w / factor, Math.max(0.03, street), 460);
  const h = w / aspect;
  const px = (cursor.x - view.x) / view.w;
  const py = (cursor.y - view.y) / view.h;
  return clampPan({ x: cursor.x - px * w, y: cursor.y - py * h, w, h });
}

export function clientToWorld(
  clientX: number,
  clientY: number,
  view: MapView,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } | null {
  if (rect.width < 1 || rect.height < 1) return null;
  const px = (clientX - rect.left) / rect.width;
  const py = (clientY - rect.top) / rect.height;
  if (px < 0 || py < 0 || px > 1 || py > 1) return null;
  return { x: view.x + px * view.w, y: view.y + py * view.h };
}

export function worldToLonLat(x: number, y: number): { longitude: number; latitude: number } {
  return {
    longitude: clamp(x - 180, -180, 180),
    latitude: clamp(90 - y, -90, 90),
  };
}

function aspectOf(size: MapSize): number {
  if (size.width < 1 || size.height < 1) return 2;
  return size.width / size.height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
