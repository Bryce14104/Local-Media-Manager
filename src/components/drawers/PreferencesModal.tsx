import { formatBytes } from "../../lib/format";
import { formatLatitude, formatLongitude } from "../../studio/geo";
import { TILE_ATTRIBUTION, clearAllRegions, clearRegion } from "../../studio/mapLibrary";
import { useMapLibrary } from "../../studio/useMapLibrary";
import { Modal } from "./AddMediaModal";

export function PreferencesModal({ onClose }: { onClose: () => void }) {
  const library = useMapLibrary();
  const cached = library.regions.length;

  return (
    <Modal title="Preferences" onClose={onClose} wide>
      <div className="max-h-[70vh] space-y-4 overflow-auto pr-1">
        <section>
          <h3 className="text-sm font-medium">Download Map Data</h3>
          <p className="mt-1 text-sm text-mute">
            Choose Cache region on the map and drag a box. Shelf requests those tiles once from the Esri dark basemap
            and keeps them in this browser. Nothing is fetched until you confirm, and Shelf does not download tiles
            in the background.
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
          {cached === 0 ? (
            library.job ? null : (
              <p className="mt-3 rounded-2xl border border-dashed border-line px-3 py-4 text-sm text-mute">
                No regions cached yet. Open the map, choose Cache region, and drag a rectangle.
              </p>
            )
          ) : (
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
                      Zoom {region.minZoom === region.maxZoom ? region.minZoom : `${region.minZoom}–${region.maxZoom}`}
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
          )}
          <p className="mt-3 text-[11px] text-mute">{TILE_ATTRIBUTION}</p>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => void clearAllRegions()}
              disabled={cached === 0 && library.job == null}
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
