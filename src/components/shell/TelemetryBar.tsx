import { gridZoomLabel } from "../../studio/gridZoom";
import type { Telemetry } from "../../studio/types";

export function TelemetryBar({
  telemetry,
  gridZoom,
  onGridZoom,
  onPreferences,
}: {
  telemetry: Telemetry;
  gridZoom: number;
  onGridZoom: (zoom: number) => void;
  onPreferences: () => void;
}) {
  const scanning = telemetry.scanProgress != null && telemetry.scanProgress < 1;
  return (
    <footer className="relative border-t border-line bg-card">
      {telemetry.scanProgress != null ? (
        <div className="absolute inset-x-0 top-0 h-px bg-line">
          <div className="h-full bg-teal" style={{ width: `${Math.round(telemetry.scanProgress * 100)}%` }} />
        </div>
      ) : null}
      <div className="flex items-center gap-4 overflow-hidden px-4 py-2 text-[11px] text-mute">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${scanning ? "bg-teal" : "bg-mute/50"}`} />
          <span className="truncate">{telemetry.scanLabel}</span>
        </span>
        <span className="hidden truncate sm:inline">{telemetry.syncLabel}</span>
        <span className="ml-auto hidden truncate md:inline">
          {telemetry.storageUsed} indexed · {telemetry.storageFree} free
        </span>
        {telemetry.exportLabel ? <span className="truncate text-teal">{telemetry.exportLabel}</span> : null}
        <label className="ml-auto flex shrink-0 items-center gap-2 text-mute md:ml-0">
          <span className="sr-only">Grid size</span>
          <span aria-hidden className="grid h-3 w-3 grid-cols-3 gap-px">
            {Array.from({ length: 9 }, (_, index) => (
              <span key={index} className="rounded-[1px] bg-current" />
            ))}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={gridZoom}
            aria-valuetext={gridZoomLabel(gridZoom)}
            title={gridZoomLabel(gridZoom)}
            onChange={(event) => onGridZoom(Number(event.target.value))}
            className="grid-zoom w-20 sm:w-28"
          />
          <span aria-hidden className="h-3.5 w-3.5 rounded-[3px] border border-current" />
        </label>
        <button
          type="button"
          onClick={onPreferences}
          className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-[11px] text-foam hover:border-teal hover:text-teal"
        >
          Preferences
        </button>
      </div>
    </footer>
  );
}
