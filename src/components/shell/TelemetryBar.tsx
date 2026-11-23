import { gridZoomLabel } from "../../studio/gridZoom";
import { pipelineReadout } from "../../studio/pipeline";
import type { PipelineStatus, Telemetry } from "../../studio/types";

export function TelemetryBar({
  telemetry,
  gridZoom,
  onGridZoom,
  onPreferences,
  onPause,
  onStop,
  paused = false,
  betaLabel,
  onBetaClick,
}: {
  telemetry: Telemetry;
  gridZoom: number;
  onGridZoom: (zoom: number) => void;
  onPreferences: () => void;
  onPause?: () => void;
  onStop?: () => void;
  paused?: boolean;
  betaLabel?: string | null;
  onBetaClick?: () => void;
}) {
  const scanning = telemetry.scanProgress != null && telemetry.scanProgress < 1;
  const percent = telemetry.scanProgress == null ? null : Math.round(telemetry.scanProgress * 100);
  return (
    <footer className="relative border-t border-line bg-card">
      {percent != null ? (
        <div
          className="absolute inset-x-0 top-0 h-1.5 bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={telemetry.scanLabel}
        >
          <div className="h-full bg-teal transition-[width] duration-150" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      <div className="flex items-center gap-4 overflow-hidden px-4 py-2 text-[11px] text-mute">
        {betaLabel ? (
          <button
            type="button"
            onClick={onBetaClick}
            disabled={!onBetaClick}
            className="shrink-0 rounded-full border border-line/80 bg-raised/60 px-2.5 py-0.5 text-[10px] font-medium tracking-wide text-mute hover:border-mute hover:text-foam disabled:cursor-default disabled:hover:border-line/80 disabled:hover:text-mute"
          >
            {betaLabel}
          </button>
        ) : null}
        <span className="flex min-w-0 items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${scanning ? "bg-teal" : "bg-mute/50"}`} />
          <span className="truncate">{telemetry.scanLabel}</span>
          {percent != null ? <span className="font-mono text-teal">{percent}%</span> : null}
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
        {telemetry.pipeline ? <PipelineMeter pipeline={telemetry.pipeline} /> : null}
        {onPause && scanning ? (
          <button type="button" onClick={onPause} className="shrink-0 text-[11px] text-mute hover:text-foam">
            {paused ? "Resume" : "Pause"}
          </button>
        ) : null}
        {onStop && scanning ? (
          <button type="button" onClick={onStop} className="shrink-0 text-[11px] text-mute hover:text-foam">
            Stop
          </button>
        ) : null}
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

function PipelineMeter({ pipeline }: { pipeline: PipelineStatus }) {
  const { text, percent, stage } = pipelineReadout(pipeline);
  return (
    <div
      data-pipeline={stage}
      className="flex shrink-0 items-center gap-2 text-[11px] text-foam"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={text}
      aria-label={text}
    >
      <span className="max-w-[9.5rem] truncate">{text}</span>
      <span className="relative h-1 w-14 overflow-hidden rounded-full bg-line" aria-hidden>
        {percent == null ? (
          <span className="pipeline-indeterminate absolute inset-y-0 left-0 rounded-full bg-teal" />
        ) : (
          <span className="absolute inset-y-0 left-0 rounded-full bg-teal transition-[width] duration-150" style={{ width: `${percent}%` }} />
        )}
      </span>
    </div>
  );
}
