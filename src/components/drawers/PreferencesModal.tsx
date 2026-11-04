import { useMemo, useState } from "react";
import { formatBytes } from "../../lib/format";
import { formatLatitude, formatLongitude } from "../../studio/geo";
import { TILE_ATTRIBUTION, TILE_BUDGET, cacheRegion, clearAllRegions, clearRegion, planRegion } from "../../studio/mapLibrary";
import { DOWNLOAD_REGIONS, ZOOM_STEPS } from "../../studio/mapRegions";
import { useMapLibrary } from "../../studio/useMapLibrary";
import type { GeoBounds } from "../../studio/types";
import { Modal } from "./AddMediaModal";

type Edges = { west: string; south: string; east: string; north: string };

export function PreferencesModal({ onClose }: { onClose: () => void }) {
  const library = useMapLibrary();
  const initial = DOWNLOAD_REGIONS.find((region) => region.id === "kyoto") ?? DOWNLOAD_REGIONS[0];
  const [regionId, setRegionId] = useState(initial.id);
  const [maxZoom, setMaxZoom] = useState<(typeof ZOOM_STEPS)[number]["zoom"]>(12);
  const [edges, setEdges] = useState<Edges>(() => edgeText(initial));
  const preset = DOWNLOAD_REGIONS.find((region) => region.id === regionId) ?? DOWNLOAD_REGIONS[0];
  const bounds = useMemo(() => readBounds(edges), [edges]);
  const plan = bounds ? planRegion(bounds, maxZoom) : null;
  const zoomLabel = ZOOM_STEPS.find((step) => step.zoom === maxZoom)?.label ?? "Detail";

  return (
    <Modal title="Preferences" onClose={onClose} wide>
      <div className="max-h-[70vh] space-y-4 overflow-auto pr-1">
        <section>
          <h3 className="text-sm font-medium">Download Map Data</h3>
          <p className="mt-1 text-sm text-mute">
            Choose a region and the highest zoom to keep. Higher settings fetch smaller, more detailed tiles from the
            Esri dark basemap and store them in this browser. Nothing is requested until you start the download.
          </p>
          <label className="mt-3 block text-xs text-mute" htmlFor="map-region">
            Region
          </label>
          <select
            id="map-region"
            value={regionId}
            onChange={(event) => {
              const next = DOWNLOAD_REGIONS.find((region) => region.id === event.target.value) ?? DOWNLOAD_REGIONS[0];
              setRegionId(next.id);
              setEdges(edgeText(next));
            }}
            className="mt-1 w-full rounded-xl border border-line bg-studio px-3 py-2 text-sm outline-none focus:border-teal"
          >
            {DOWNLOAD_REGIONS.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-mute">{preset.detail}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <EdgeField label="West" value={edges.west} onChange={(west) => setEdges((current) => ({ ...current, west }))} />
            <EdgeField label="North" value={edges.north} onChange={(north) => setEdges((current) => ({ ...current, north }))} />
            <EdgeField label="East" value={edges.east} onChange={(east) => setEdges((current) => ({ ...current, east }))} />
            <EdgeField label="South" value={edges.south} onChange={(south) => setEdges((current) => ({ ...current, south }))} />
          </div>
          <p className="mt-3 text-xs text-mute" id="map-zoom-label">
            Maximum zoom · {zoomLabel}
          </p>
          <div role="radiogroup" aria-labelledby="map-zoom-label" className="mt-1 grid grid-cols-5 gap-1">
            {ZOOM_STEPS.map((step) => (
              <button
                key={step.zoom}
                type="button"
                role="radio"
                aria-checked={maxZoom === step.zoom}
                onClick={() => setMaxZoom(step.zoom)}
                className={`rounded-xl border px-1 py-2 text-center ${
                  maxZoom === step.zoom ? "border-teal bg-teal text-teal-ink" : "border-line text-mute hover:text-foam"
                }`}
              >
                <span className="block font-mono text-xs">{step.zoom}</span>
                <span className="block text-[10px] leading-tight">{step.label}</span>
              </button>
            ))}
          </div>
          <p className={`mt-2 text-xs ${plan?.overBudget ? "text-danger" : "text-mute"}`}>
            {!bounds
              ? "Enter a west edge left of the east edge, and a south edge below the north edge."
              : plan?.overBudget
                ? `Zoom ${maxZoom} needs ${plan.needed} tiles. The limit is ${TILE_BUDGET}. Lower the maximum zoom or shrink the region.`
                : plan && plan.tiles.length > 0
                  ? `${plan.tiles.length} tiles · zoom ${plan.minZoom === plan.maxZoom ? plan.maxZoom : `${plan.minZoom}–${plan.maxZoom}`} · up to ${TILE_BUDGET}`
                  : "Those edges do not cover any map tiles."}
          </p>
          {library.error ? <p className="mt-2 text-sm text-danger">{library.error}</p> : null}
          {library.job ? (
            <div className="mt-3 rounded-2xl border border-line px-3 py-3">
              <p className="text-sm">Downloading {library.job.label}</p>
              <p className="mt-1 font-mono text-[10px] text-teal">
                {library.job.done}/{library.job.total}
              </p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full bg-teal"
                  style={{ width: `${Math.round((library.job.done / library.job.total) * 100)}%` }}
                />
              </div>
            </div>
          ) : null}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={!bounds || !plan || plan.tiles.length === 0 || plan.overBudget || library.job != null}
              onClick={() => {
                if (!bounds) return;
                void cacheRegion(bounds, {
                  maxZoom,
                  label: preset.id === "custom" ? undefined : preset.name,
                });
              }}
              className="rounded-full bg-teal px-4 py-2 text-sm font-medium text-teal-ink disabled:opacity-40"
            >
              Download region
            </button>
          </div>
          {library.regions.length === 0 && !library.job ? (
            <p className="mt-3 rounded-2xl border border-dashed border-line px-3 py-4 text-sm text-mute">
              No regions cached yet. Choose a region and a maximum zoom, then download.
            </p>
          ) : library.regions.length > 0 ? (
            <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
              {library.regions.map((region) => (
                <li key={region.id} className="flex items-center gap-3 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{region.label}</p>
                    <p className="truncate text-xs text-mute">
                      {formatLatitude(region.south)}–{formatLatitude(region.north)}, {formatLongitude(region.west)}–
                      {formatLongitude(region.east)}
                    </p>
                    <p className="truncate text-xs text-mute">
                      Zoom {region.minZoom === region.maxZoom ? region.maxZoom : `${region.minZoom}–${region.maxZoom}`}
                      {" · "}
                      {region.tileCount} tiles · {formatBytes(region.bytes)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void clearRegion(region.id)}
                    className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-mute hover:text-foam"
                  >
                    Clear
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-[11px] text-mute">{TILE_ATTRIBUTION}</p>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => void clearAllRegions()}
              disabled={library.regions.length === 0 && library.job == null}
              className="rounded-full border border-line px-3 py-1.5 text-xs text-mute hover:text-foam disabled:opacity-40"
            >
              Clear all map data
            </button>
          </div>
        </section>
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-full bg-teal px-4 py-2 text-sm font-medium text-teal-ink">
          Done
        </button>
      </div>
    </Modal>
  );
}

function EdgeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = `map-edge-${label.toLowerCase()}`;
  return (
    <label className="block text-xs text-mute" htmlFor={id}>
      {label}
      <input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-line bg-studio px-3 py-2 font-mono text-sm text-foam outline-none focus:border-teal"
      />
    </label>
  );
}

function edgeText(region: { west: number; south: number; east: number; north: number }): Edges {
  return {
    west: String(region.west),
    south: String(region.south),
    east: String(region.east),
    north: String(region.north),
  };
}

function readBounds(edges: Edges): GeoBounds | null {
  const west = Number(edges.west);
  const south = Number(edges.south);
  const east = Number(edges.east);
  const north = Number(edges.north);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (east - west < 0.02 || north - south < 0.02) return null;
  if (west < -180 || east > 180 || south < -85 || north > 85) return null;
  return { west, south, east, north };
}
