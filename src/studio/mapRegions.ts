export type DownloadRegion = {
  id: string;
  name: string;
  detail: string;
  west: number;
  south: number;
  east: number;
  north: number;
};

export const DOWNLOAD_REGIONS: DownloadRegion[] = [
  { id: "iceland", name: "Iceland", detail: "South coast and highlands", west: -24.6, south: 63.1, east: -13.2, north: 66.6 },
  { id: "lisbon", name: "Lisbon", detail: "City and the Tagus", west: -9.55, south: 38.55, east: -8.85, north: 38.95 },
  { id: "kyoto", name: "Kyoto", detail: "Basin and eastern hills", west: 135.55, south: 34.9, east: 135.95, north: 35.18 },
  { id: "namibia", name: "Namibia", detail: "Sossusvlei and the dune belt", west: 14.7, south: -25.15, east: 16.1, north: -24.25 },
  { id: "atacama", name: "Atacama", detail: "Salt flats and the cordillera", west: -69.6, south: -24.25, east: -68.6, north: -23.4 },
  { id: "oslo", name: "Oslo", detail: "Fjord and the city", west: 10.45, south: 59.8, east: 11.05, north: 60.05 },
  { id: "australia", name: "Australia", detail: "Continent overview", west: 112, south: -44, east: 154, north: -10 },
  { id: "new-zealand", name: "New Zealand", detail: "North and South Islands", west: 166, south: -47.5, east: 179, north: -34 },
  { id: "custom", name: "Custom bounds", detail: "Set the west, south, east, and north edges", west: -24.6, south: 63.1, east: -13.2, north: 66.6 },
];

export const ZOOM_STEPS = [
  { zoom: 6, label: "Overview" },
  { zoom: 8, label: "Regional" },
  { zoom: 10, label: "City" },
  { zoom: 12, label: "Neighborhood" },
  { zoom: 14, label: "Street" },
] as const;
