import { formatBytes } from "../../lib/format";
import { formatLatitude, formatLongitude } from "../../studio/geo";
import { TILE_ATTRIBUTION, TILE_BUDGET, cacheRegion, clearAllRegions, clearRegion, planRegion } from "../../studio/mapLibrary";
import { ZOOM_STEPS, type MapZoom } from "../../studio/mapRegions";
import { useMapLibrary } from "../../studio/useMapLibrary";
import type { GeoBounds } from "../../studio/types";
import { Modal } from "./AddMediaModal";

export function PreferencesModal({
  onClose,
  maxZoom,
  onMaxZoom,
  bounds,
  onSelectArea,
}: {
  onClose: () => void;
  maxZoom: MapZoom;
  onMaxZoom: (zoom: MapZoom) => void;
  bounds: GeoBounds | null;
  onSelectArea: () => void;
}) {
  const library = useMapLibrary();
  const plan = bounds ? planRegion(bounds, maxZoom) : null;
  const zoomLabel = ZOOM_STEPS.find((step) => step.zoom === maxZoom)?.label ?? "Detail";

  return (
    <Modal title="Preferences" onClose={onClose} wide>
      <div className="max-h-[70vh] space-y-4 overflow-auto pr-1">
        <section>
          <h3 className="text-sm font-medium">Download Map Data</h3>
          <p className="mt-1 text-sm text-mute">
            Choose the highest zoom to keep, then draw the area on the map. Higher settings fetch smaller, more
            detailed tiles from the Esri dark basemap and store them in this browser. Nothing is requested until you
            start the download.
          </p>
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
                onClick={() => onMaxZoom(step.zoom)}
                className={`rounded-xl border px-1 py-2 text-center ${
                  maxZoom === step.zoom ? "border-teal bg-teal text-teal-ink" : "border-line text-mute hover:text-foam"
                }`}
              >
                <span className="block font-mono text-xs">{step.zoom}</span>
                <span className="block text-[10px] leading-tight">{step.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={onSelectArea}
              className="rounded-full border border-teal px-4 py-2 text-sm font-medium text-teal hover:bg-teal/10"
            >
              Select area to cache
            </button>
            {bounds ? (
              <p className="min-w-0 text-xs text-mute">
                {formatLatitude(bounds.south)}–{formatLatitude(bounds.north)}, {formatLongitude(bounds.west)}–
                {formatLongitude(bounds.east)}
              </p>
            ) : (
              <p className="text-xs text-mute">No area selected.</p>
            )}
          </div>
          <p className={`mt-2 text-xs ${plan?.overBudget ? "text-danger" : "text-mute"}`}>
            {!bounds
              ? "Select an area on the map. The zoom above is used for that box."
              : plan?.overBudget
                ? `Zoom ${maxZoom} needs ${plan.needed} tiles. The limit is ${TILE_BUDGET}. Lower the maximum zoom or draw a smaller box.`
                : plan && plan.tiles.length > 0
                  ? `${plan.tiles.length} tiles · zoom ${plan.minZoom === plan.maxZoom ? plan.maxZoom : `${plan.minZoom}–${plan.maxZoom}`} · up to ${TILE_BUDGET}`
                  : "That box does not cover any map tiles."}
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
                void cacheRegion(bounds, { maxZoom });
              }}
              className="rounded-full bg-teal px-4 py-2 text-sm font-medium text-teal-ink disabled:opacity-40"
            >
              Download region
            </button>
          </div>
          {library.regions.length === 0 && !library.job ? (
            <p className="mt-3 rounded-2xl border border-dashed border-line px-3 py-4 text-sm text-mute">
              No regions cached yet. Choose a maximum zoom, select an area on the map, then download.
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
