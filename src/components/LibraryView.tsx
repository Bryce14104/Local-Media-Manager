import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "../lib/api";
import {
  fileName,
  folderPath,
  formatBytes,
  formatKind,
  formatTimestamp,
} from "../lib/format";
import { secondaryButton } from "../lib/styles";
import type { ExifSnapshot, MediaRecord } from "../lib/types";
import { RatingStars } from "./RatingStars";

type LibraryViewProps = {
  media: MediaRecord[];
  loading: boolean;
  error: string | null;
  offline: boolean;
  onRetry: () => void;
  onScan: () => void;
  onRate: (path: string, rating: number | null) => Promise<void>;
};

const RENDER_LIMIT = 400;

export function LibraryView({
  media,
  loading,
  error,
  offline,
  onRetry,
  onScan,
  onRate,
}: LibraryViewProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return media;
    return media.filter((item) => item.filePath.toLowerCase().includes(needle));
  }, [media, query]);

  const visible = filtered.slice(0, RENDER_LIMIT);
  const selected = media.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId != null && !media.some((item) => item.id === selectedId)) {
      setSelectedId(null);
    }
  }, [media, selectedId]);

  async function rate(value: number | null) {
    if (!selected) return;
    setSaving(true);
    setRatingError(null);
    try {
      await onRate(selected.filePath, value);
    } catch (caught) {
      setRatingError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-col gap-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl text-ink">Library</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {loading
              ? "Opening the local library…"
              : media.length === 0
                ? "No files indexed yet."
                : `${media.length} file${media.length === 1 ? "" : "s"} indexed on this machine.`}
          </p>
        </div>
        <label className="block w-full sm:max-w-xs">
          <span className="sr-only">Filter by path</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by path"
            className="w-full rounded-full border border-line bg-white/40 px-4 py-2 text-sm outline-none placeholder:text-ink-soft/70 focus:border-brass"
          />
        </label>
      </header>

      {error ? (
        <div className="rounded-2xl border border-danger/30 bg-white/40 p-5" role="alert">
          <h2 className="font-serif text-xl">The library could not be opened.</h2>
          <p className="mt-2 text-sm text-ink-soft">{error}</p>
          <button type="button" className={`${secondaryButton} mt-4`} onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="rounded-2xl border border-dashed border-line px-5 py-10 text-sm text-ink-soft">
          Reading the SQLite catalog…
        </p>
      ) : null}

      {!loading && !error && media.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white/30 px-5 py-10">
          <h2 className="font-serif text-2xl">Nothing on the shelf yet</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-ink-soft">
            Choose a folder to scan. Shelf records the path, a SHA-256 hash, the size,
            timestamps, and a rating. It does not copy the photos.
          </p>
          {offline ? (
            <p className="mt-3 max-w-xl text-sm leading-6 text-ink-soft">
              This browser tab cannot open the catalog. The desktop window can.
            </p>
          ) : null}
          <button type="button" className={`${secondaryButton} mt-5`} onClick={onScan}>
            Go to scan
          </button>
        </div>
      ) : null}

      {!loading && !error && media.length > 0 ? (
        <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {filtered.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-sm text-ink-soft">
                No indexed files match that search.
              </p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white/30">
                {visible.map((item) => {
                  const active = item.id === selected?.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setSelectedId(item.id);
                          setRatingError(null);
                        }}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brass ${
                          active ? "bg-paper-deep" : "hover:bg-paper/80"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium" title={item.filePath}>
                            {fileName(item.filePath)}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-ink-soft">
                            {formatKind(item.mediaKind)} · {formatBytes(item.fileSize)} ·{" "}
                            {formatTimestamp(item.modifiedAt)}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs tracking-wide text-brass" aria-hidden>
                          {item.rating == null ? "Unrated" : "★".repeat(item.rating)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {filtered.length > RENDER_LIMIT ? (
              <p className="mt-3 text-xs text-ink-soft">
                Showing {RENDER_LIMIT} of {filtered.length}. Narrow the filter to see the rest.
              </p>
            ) : null}
          </div>

          <Inspector
            record={selected}
            saving={saving}
            ratingError={ratingError}
            onRate={rate}
          />
        </div>
      ) : null}
    </section>
  );
}

function Inspector({
  record,
  saving,
  ratingError,
  onRate,
}: {
  record: MediaRecord | null;
  saving: boolean;
  ratingError: string | null;
  onRate: (rating: number | null) => void;
}) {
  if (!record) {
    return (
      <aside className="rounded-2xl border border-dashed border-line px-4 py-6 text-sm leading-6 text-ink-soft">
        Select a file to read its hash, timestamps, and EXIF.
      </aside>
    );
  }

  return (
    <aside className="rounded-2xl border border-line bg-white/35 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
        {formatKind(record.mediaKind)}
      </p>
      <h2 className="mt-2 break-all font-serif text-2xl leading-tight">{fileName(record.filePath)}</h2>
      <p className="mt-2 break-all text-xs leading-5 text-ink-soft">{folderPath(record.filePath)}</p>

      <div className="mt-4">
        <p className="text-xs text-ink-soft">Rating</p>
        <RatingStars rating={record.rating} disabled={saving} onChange={onRate} />
        <p className="text-xs text-ink-soft">Click a star to rate. Click it again to clear.</p>
        {ratingError ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {ratingError}
          </p>
        ) : null}
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        <Fact label="Size" value={formatBytes(record.fileSize)} />
        <Fact label="Modified" value={formatTimestamp(record.modifiedAt)} />
        <Fact label="Created" value={formatTimestamp(record.createdAt)} />
        <Fact label="Indexed" value={formatTimestamp(record.indexedAt)} />
        <Fact label="SHA-256" value={record.contentHash ?? "Not hashed"} mono />
      </dl>

      <ExifDetails exif={record.exif} />
    </aside>
  );
}

function ExifDetails({ exif }: { exif: ExifSnapshot | null }) {
  if (!exif) {
    return (
      <p className="mt-4 text-sm leading-6 text-ink-soft">
        No EXIF block. PNG, video, and many raw files will not have one.
      </p>
    );
  }

  const camera = [exif.cameraMake, exif.cameraModel].filter(Boolean).join(" ");
  const candidates: [string, string | null][] = [
    ["Camera", camera || null],
    ["Lens", exif.lensModel],
    ["Captured", exif.capturedAt],
    ["Orientation", exif.orientation],
    ["Frame", exif.width && exif.height ? `${exif.width} × ${exif.height}` : null],
    ["ISO", exif.iso],
    ["Exposure", exif.exposureTime],
    ["Aperture", exif.fNumber],
    ["Focal length", exif.focalLength],
  ];
  const rows = candidates.filter((row): row is [string, string] => row[1] != null);

  if (rows.length === 0) {
    return (
      <p className="mt-4 text-sm leading-6 text-ink-soft">
        This file has an EXIF block, but not the camera fields Shelf reads.
      </p>
    );
  }

  return (
    <dl className="mt-4 space-y-3 border-t border-line pt-4 text-sm">
      {rows.map(([label, value]) => (
        <Fact key={label} label={label} value={value} />
      ))}
    </dl>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className={`mt-0.5 break-all ${mono ? "font-mono text-xs leading-5" : ""}`}>{value}</dd>
    </div>
  );
}
