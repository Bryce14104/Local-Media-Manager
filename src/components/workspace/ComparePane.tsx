import { FrameStill } from "./FrameStill";
import { formatLabel } from "../../studio/query";
import type { StudioItem } from "../../studio/types";
import { formatBytes, formatTimestamp } from "../../lib/format";

type ComparePaneProps = {
  pair: [StudioItem | null, StudioItem | null];
  onClear: () => void;
};

export function ComparePane({ pair, onClear }: ComparePaneProps) {
  const ready = pair[0] && pair[1];
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between px-4 py-3">
        <div>
          <h1 className="text-sm font-medium">Compare</h1>
          <p className="text-xs text-mute">The first two selected frames, side by side.</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded-full border border-line px-3 py-1 text-xs text-mute hover:text-foam"
        >
          Clear selection
        </button>
      </header>
      {ready ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto px-4 pb-4 md:grid-cols-2 md:overflow-hidden">
          {pair.map((item) =>
            item ? <CompareFrame key={item.id} item={item} /> : null,
          )}
        </div>
      ) : (
        <div className="mx-4 rounded-2xl border border-dashed border-line px-5 py-16 text-center text-sm text-mute">
          Use the + mark on two frames. Compare keeps that pair side by side.
        </div>
      )}
    </section>
  );
}

function CompareFrame({ item }: { item: StudioItem }) {
  const captured = Math.floor(new Date(item.capturedAt).getTime() / 1000);
  return (
    <article className="flex h-full min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-line bg-card md:min-h-0">
      <div className="min-h-0 flex-1 basis-0 bg-studio">
        <FrameStill
          id={item.id}
          fileName={item.fileName}
          src={item.inspectUrl ?? item.previewUrl}
          fit="contain"
        />
      </div>
      <div className="shrink-0 space-y-2 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="truncate text-sm font-medium">{item.fileName}</h2>
          <span className="font-mono text-[10px] text-teal">{formatLabel(item.format)}</span>
        </div>
        <p className="text-xs text-mute">{item.camera}</p>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <Meta label="Lens" value={item.lens} />
          <Meta label="Size" value={formatBytes(item.fileSize)} />
          <Meta label="ISO" value={item.iso == null ? "—" : String(item.iso)} />
          <Meta label="Shutter" value={item.shutter ?? "—"} />
          <Meta label="Aperture" value={item.aperture ?? "—"} />
          <Meta label="Captured" value={formatTimestamp(captured)} />
        </dl>
      </div>
    </article>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-mute">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-foam">{value}</dd>
    </div>
  );
}
