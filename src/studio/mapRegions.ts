export const ZOOM_STEPS = [
  { zoom: 6, label: "Overview" },
  { zoom: 8, label: "Regional" },
  { zoom: 10, label: "City" },
  { zoom: 12, label: "Neighborhood" },
  { zoom: 14, label: "Street" },
] as const;

export type MapZoom = (typeof ZOOM_STEPS)[number]["zoom"];
