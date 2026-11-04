export const GRID_ZOOM_DEFAULT = 36;

export function clampGridZoom(value: number): number {
  if (!Number.isFinite(value)) return GRID_ZOOM_DEFAULT;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function readGridZoom(): number {
  try {
    return clampGridZoom(Number(localStorage.getItem("shelf-grid-zoom")));
  } catch {
    return GRID_ZOOM_DEFAULT;
  }
}

export function writeGridZoom(value: number): void {
  try {
    localStorage.setItem("shelf-grid-zoom", String(clampGridZoom(value)));
  } catch {
    /* the grid still updates for this session */
  }
}

export function gridMetrics(zoom: number): { minPx: number; gapPx: number; roomy: boolean; dense: boolean } {
  const t = clampGridZoom(zoom) / 100;
  return {
    minPx: Math.round(120 + t * 200),
    gapPx: Math.round(6 + t * 10),
    roomy: t >= 0.62,
    dense: t < 0.34,
  };
}

export function gridZoomLabel(zoom: number): string {
  const value = clampGridZoom(zoom);
  if (value < 25) return "Dense grid";
  if (value < 50) return "Compact grid";
  if (value < 75) return "Comfortable cards";
  return "Large previews";
}
