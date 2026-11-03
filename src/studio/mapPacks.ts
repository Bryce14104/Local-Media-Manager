export type MapPack = {
  id: string;
  name: string;
  detail: string;
  west: number;
  south: number;
  east: number;
  north: number;
  inRoll: boolean;
};

export const TILE_COLUMNS = 4;
export const TILE_ROWS = 3;

export const MAP_PACKS: MapPack[] = [
  { id: "iceland", name: "Iceland", detail: "South coast and highlands", west: -24.6, south: 63.1, east: -13.2, north: 66.6, inRoll: true },
  { id: "lisbon", name: "Lisbon", detail: "City and the Tagus", west: -9.55, south: 38.55, east: -8.85, north: 38.95, inRoll: true },
  { id: "kyoto", name: "Kyoto", detail: "Basin and eastern hills", west: 135.55, south: 34.9, east: 135.95, north: 35.18, inRoll: true },
  { id: "namibia", name: "Namibia", detail: "Sossusvlei and the dune belt", west: 14.7, south: -25.15, east: 16.1, north: -24.25, inRoll: true },
  { id: "atacama", name: "Atacama", detail: "Salt flats and the cordillera", west: -69.6, south: -24.25, east: -68.6, north: -23.4, inRoll: true },
  { id: "oslo", name: "Oslo", detail: "Fjord and the city", west: 10.45, south: 59.8, east: 11.05, north: 60.05, inRoll: true },
  { id: "australia", name: "Australia", detail: "Continent overview", west: 112, south: -44, east: 154, north: -10, inRoll: false },
  { id: "new-zealand", name: "New Zealand", detail: "North and South Islands", west: 166, south: -47.5, east: 179, north: -34, inRoll: false },
];

export function packById(id: string): MapPack | undefined {
  return MAP_PACKS.find((pack) => pack.id === id);
}

export function tileBounds(pack: MapPack, column: number, row: number) {
  const lonStep = (pack.east - pack.west) / TILE_COLUMNS;
  const latStep = (pack.north - pack.south) / TILE_ROWS;
  return {
    west: pack.west + column * lonStep,
    east: pack.west + (column + 1) * lonStep,
    north: pack.north - row * latStep,
    south: pack.north - (row + 1) * latStep,
  };
}
