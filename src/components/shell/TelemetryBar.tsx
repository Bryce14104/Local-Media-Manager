import type { Telemetry } from "../../studio/types";

export function TelemetryBar({ telemetry }: { telemetry: Telemetry }) {
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
      </div>
    </footer>
  );
}
