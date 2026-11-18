import { useState, type ReactNode } from "react";
import { formatBytes } from "../../lib/format";
import { formatLatitude, formatLongitude } from "../../studio/geo";
import { TILE_ATTRIBUTION, TILE_BUDGET, cacheRegion, clearAllRegions, clearRegion, planRegion } from "../../studio/mapLibrary";
import { ZOOM_STEPS, type MapZoom } from "../../studio/mapRegions";
import { useMapLibrary } from "../../studio/useMapLibrary";
import type { SlideshowSettings } from "../../studio/slideshow";
import type { GeoBounds } from "../../studio/types";
import { SlideshowControls } from "../workspace/SlideshowControls";
import { Modal } from "./AddMediaModal";

const GROUPS = [
  { id: "library", label: "Library" },
  { id: "playback", label: "Playback" },
  { id: "map", label: "Map" },
] as const;

type PrefGroup = (typeof GROUPS)[number]["id"];

export function PreferencesModal({
  onClose,
  maxZoom,
  onMaxZoom,
  bounds,
  onSelectArea,
  slideshow,
  onSlideshow,
  autoScanOnPlug,
  onAutoScanOnPlug,
  onRelink,
  healthLine,
  ffmpegOk,
  aliases,
  onAliases,
  onOpenLibrary,
  onNewLibrary,
  onExportTravel,
  onRebuildPreviews,
}: {
  onClose: () => void;
  maxZoom: MapZoom;
  onMaxZoom: (zoom: MapZoom) => void;
  bounds: GeoBounds | null;
  onSelectArea: () => void;
  slideshow: SlideshowSettings;
  onSlideshow: (settings: SlideshowSettings) => void;
  autoScanOnPlug: boolean;
  onAutoScanOnPlug: (enabled: boolean) => void;
  onRelink?: () => void;
  healthLine?: string | null;
  ffmpegOk?: boolean | null;
  aliases?: { alias: string; personId: string; name: string }[];
  onAliases?: (aliases: { alias: string; personId: string; name: string }[]) => void;
  onOpenLibrary?: () => void;
  onNewLibrary?: () => void;
  onExportTravel?: () => void;
  onRebuildPreviews?: () => void;
}) {
  const [group, setGroup] = useState<PrefGroup>("library");
  const library = useMapLibrary();
  const plan = bounds ? planRegion(bounds, maxZoom) : null;
  const zoomLabel = ZOOM_STEPS.find((step) => step.zoom === maxZoom)?.label ?? "Detail";

  return (
    <Modal title="Preferences" onClose={onClose} wide>
      <div className="flex gap-1 rounded-full border border-line p-1" role="tablist" aria-label="Preference groups">
        {GROUPS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={group === item.id}
            onClick={() => setGroup(item.id)}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm ${
              group === item.id ? "bg-teal text-teal-ink" : "text-mute hover:text-foam"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4 max-h-[60vh] overflow-auto pr-1">
        {group === "library" ? (
          <div className="space-y-3">
          <PrefCard title="Drives" hint="Previews stay in Shelf when a disk is unplugged. This only indexes new files on a drive you already added.">
            <PrefToggle
              label="Scan when a remembered drive is plugged in"
              checked={autoScanOnPlug}
              onChange={onAutoScanOnPlug}
            />
            {healthLine ? <p className="mt-3 text-xs text-mute">{healthLine}</p> : null}
            {onRelink ? (
              <button
                type="button"
                onClick={onRelink}
                className="mt-3 rounded-full border border-line px-3 py-1.5 text-xs text-foam hover:border-teal"
              >
                Relink files from a folder
              </button>
            ) : null}
            {onRebuildPreviews ? (
              <button
                type="button"
                onClick={onRebuildPreviews}
                className="mt-2 rounded-full border border-line px-3 py-1.5 text-xs text-foam hover:border-teal"
              >
                Rebuild previews
              </button>
            ) : null}
            {ffmpegOk === false ? (
              <p className="mt-3 text-xs text-mute">Install ffmpeg to play video proxies.</p>
            ) : null}
          </PrefCard>
          <PrefCard title="Libraries" hint="The Air can open a travel pack of 720p previews. Originals stay on the archive disk.">
            <div className="flex flex-wrap gap-2">
              {onOpenLibrary ? (
                <button type="button" onClick={onOpenLibrary} className="rounded-full border border-line px-3 py-1.5 text-xs text-foam hover:border-teal">
                  Open library
                </button>
              ) : null}
              {onNewLibrary ? (
                <button type="button" onClick={onNewLibrary} className="rounded-full border border-line px-3 py-1.5 text-xs text-foam hover:border-teal">
                  New library
                </button>
              ) : null}
              {onExportTravel ? (
                <button type="button" onClick={onExportTravel} className="rounded-full border border-line px-3 py-1.5 text-xs text-foam hover:border-teal">
                  Export travel pack
                </button>
              ) : null}
            </div>
          </PrefCard>
          {onAliases ? (
            <PrefCard title="Search aliases" hint="Type mum in search to jump to a named person.">
              <AliasEditor aliases={aliases ?? []} onChange={onAliases} />
            </PrefCard>
          ) : null}
          <PrefCard title="Keyboard" hint="Culling happens in fullscreen. Grid stays viewing-first.">
            <p className="text-xs leading-relaxed text-mute">
              J/K or arrows move · Enter opens · E develops · Z 1:1 hold-to-zoom · C two-up · P pick · X reject · 1–5 rate · I/O video marks · F fullscreen
            </p>
          </PrefCard>
          </div>
        ) : null}

        {group === "playback" ? (
          <PrefCard title="Slideshow" hint="Used when you press Play on a still. Videos can wait until they finish, or follow the same timer.">
            <SlideshowControls settings={slideshow} onChange={onSlideshow} />
          </PrefCard>
        ) : null}

        {group === "map" ? (
          <PrefCard
            title="Offline map tiles"
            hint="Choose the highest zoom to keep, then draw the area on the map. Nothing is requested until you start the download."
          >
            <p className="text-xs text-mute" id="map-zoom-label">
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
          </PrefCard>
        ) : null}
      </div>

      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-full bg-teal px-4 py-2 text-sm font-medium text-teal-ink">
          Done
        </button>
      </div>
    </Modal>
  );
}

function PrefCard({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line px-4 py-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 mb-3 text-sm text-mute">{hint}</p>
      {children}
    </section>
  );
}

function PrefToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`h-6 w-10 shrink-0 rounded-full border ${checked ? "border-teal bg-teal/40" : "border-line bg-studio"}`}
      >
        <span className={`block h-5 w-5 rounded-full bg-foam transition ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
      </button>
    </label>
  );
}

function AliasEditor({
  aliases,
  onChange,
}: {
  aliases: { alias: string; personId: string; name: string }[];
  onChange: (aliases: { alias: string; personId: string; name: string }[]) => void;
}) {
  const [alias, setAlias] = useState("");
  const [name, setName] = useState("");
  const [personId, setPersonId] = useState("");
  return (
    <div className="space-y-2">
      {aliases.map((row) => (
        <div key={`${row.alias}-${row.personId}`} className="flex items-center justify-between gap-2 text-xs">
          <span>
            {row.alias} → {row.name || row.personId}
          </span>
          <button
            type="button"
            className="text-mute hover:text-foam"
            onClick={() => onChange(aliases.filter((item) => item.alias !== row.alias || item.personId !== row.personId))}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="grid grid-cols-3 gap-1">
        <input
          value={alias}
          onChange={(event) => setAlias(event.target.value)}
          placeholder="mum"
          className="rounded-lg border border-line bg-studio px-2 py-1 text-xs outline-none"
        />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name"
          className="rounded-lg border border-line bg-studio px-2 py-1 text-xs outline-none"
        />
        <input
          value={personId}
          onChange={(event) => setPersonId(event.target.value)}
          placeholder="person-1"
          className="rounded-lg border border-line bg-studio px-2 py-1 text-xs outline-none"
        />
      </div>
      <button
        type="button"
        className="rounded-full border border-line px-3 py-1 text-xs text-foam"
        onClick={() => {
          if (!alias.trim() || !personId.trim()) return;
          onChange([...aliases, { alias: alias.trim(), personId: personId.trim(), name: name.trim() || alias.trim() }]);
          setAlias("");
          setName("");
          setPersonId("");
        }}
      >
        Add alias
      </button>
    </div>
  );
}
