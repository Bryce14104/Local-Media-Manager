import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, formatTimestamp } from "../../lib/format";
import type { AlbumRecord, VolumeRecord, WatchedRoot } from "../../lib/types";
import type { ActiveFilter, StudioItem } from "../../studio/types";

type SourceListProps = {
  volumes: VolumeRecord[];
  watches: WatchedRoot[];
  albums: AlbumRecord[];
  items: StudioItem[];
  filters: ActiveFilter[];
  onFilter: (filter: ActiveFilter) => void;
  onClear: () => void;
  onRescan: () => void;
  onRescanVolume?: (fingerprint: string) => void;
  onAddFolder: () => void;
  importsLocked?: boolean;
  onRemoveVolume?: (volumeId: number) => void;
  onRevealFolder?: (path: string) => void;
  onOpenAlbum: (album: AlbumRecord) => void;
};

export function SourceList({
  volumes,
  watches,
  albums,
  items,
  filters,
  onFilter,
  onClear,
  onRescan,
  onRescanVolume,
  onAddFolder,
  importsLocked = false,
  onRemoveVolume,
  onRevealFolder,
  onOpenAlbum,
}: SourceListProps) {
  const source = filters.find(
    (filter) => filter.kind === "volume" || filter.kind === "folder" || filter.kind === "album",
  );
  const [infoId, setInfoId] = useState<number | null>(null);
  const drives = useMemo(() => buildDrives(volumes, watches, items), [volumes, watches, items]);

  return (
    <aside className="flex max-h-48 w-full shrink-0 flex-col border-b border-line bg-studio md:h-full md:max-h-none md:w-56 md:border-b-0 md:border-r">
      <div className="px-2 pb-1 pt-2">
        <button type="button" onClick={onClear} className={rowClass(!source)}>
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-raised text-teal">
            <LibraryIcon />
          </span>
          <span className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-foam">All photos</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-2 pb-2">
        <section>
          <Header title="Drives" />
          {drives.length === 0 ? (
            <p className="px-1 pt-1 text-[11px] leading-snug text-mute">Add a folder. Shelf remembers the disk.</p>
          ) : (
            <ul className="space-y-0.5">
              {drives.map((drive) => (
                <DriveRow
                  key={drive.key}
                  drive={drive}
                  active={
                    (source?.kind === "volume" && drive.volumeId != null && source.volumeId === drive.volumeId) ||
                    (source?.kind === "folder" && source.path === drive.name)
                  }
                  infoOpen={drive.volumeId != null && infoId === drive.volumeId}
                  onToggleInfo={() => {
                    if (drive.volumeId == null) return;
                    setInfoId((current) => (current === drive.volumeId ? null : drive.volumeId!));
                  }}
                  onCloseInfo={() => setInfoId(null)}
                  onSelect={() => {
                    if (drive.volumeId != null) {
                      onFilter({
                        id: drive.key,
                        kind: "volume",
                        volumeId: drive.volumeId,
                        label: drive.name,
                      });
                      return;
                    }
                    onFilter({ id: drive.key, kind: "folder", path: drive.name, label: drive.name });
                  }}
                  onRevealFolder={
                    drive.mount && onRevealFolder ? () => onRevealFolder(drive.mount!) : undefined
                  }
                  onRescan={
                    drive.fingerprint && onRescanVolume
                      ? () => onRescanVolume(drive.fingerprint!)
                      : undefined
                  }
                  onRemove={
                    drive.volumeId != null && onRemoveVolume
                      ? () => {
                          setInfoId(null);
                          onRemoveVolume(drive.volumeId!);
                        }
                      : undefined
                  }
                  importsLocked={importsLocked}
                />
              ))}
            </ul>
          )}
        </section>

        <section>
          <Header title="Albums" />
          {albums.length === 0 ? (
            <p className="px-1 pt-1 text-[11px] leading-snug text-mute">None yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {albums.map((album) => {
                const active = source?.kind === "album" && source.albumId === album.id;
                return (
                  <li key={album.id}>
                    <button type="button" onClick={() => onOpenAlbum(album)} className={rowClass(active)}>
                      <span className="w-6" />
                      <span className="min-w-0 flex-1 truncate text-left text-[12px]">{album.name}</span>
                      <Count value={album.count} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-auto flex gap-1 border-t border-line p-1.5">
        <button
          type="button"
          onClick={onAddFolder}
          aria-disabled={importsLocked || undefined}
          title={importsLocked ? "Beta ended — imports are locked" : undefined}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] hover:bg-raised ${
            importsLocked ? "text-mute opacity-50" : "text-foam"
          }`}
        >
          <PlusIcon />
          Add
        </button>
        <button
          type="button"
          onClick={onRescan}
          aria-disabled={importsLocked || undefined}
          title={importsLocked ? "Beta ended — imports are locked" : undefined}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] hover:bg-raised ${
            importsLocked ? "text-mute opacity-50" : "text-foam"
          }`}
        >
          <ScanIcon />
          Scan
        </button>
      </div>
    </aside>
  );
}

type DriveData = {
  key: string;
  name: string;
  mount?: string;
  online?: boolean;
  count: number;
  bytes?: number;
  lastSeenAt?: number;
  fingerprint?: string;
  volumeId?: number;
  watchCount: number;
  watchPaths: string[];
};

function DriveRow({
  drive,
  active,
  infoOpen,
  onToggleInfo,
  onCloseInfo,
  onSelect,
  onRevealFolder,
  onRescan,
  onRemove,
  importsLocked,
}: {
  drive: DriveData;
  active: boolean;
  infoOpen: boolean;
  onToggleInfo: () => void;
  onCloseInfo: () => void;
  onSelect: () => void;
  onRevealFolder?: () => void;
  onRescan?: () => void;
  onRemove?: () => void;
  importsLocked: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!infoOpen) return;
    function onPointer(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) onCloseInfo();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseInfo();
    }
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [infoOpen, onCloseInfo]);

  return (
    <li className="relative">
      <div className={rowClass(active)}>
        <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="relative grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-raised/80">
            <DriveIcon />
            {drive.online != null ? (
              <span
                className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-studio ${
                  drive.online ? "bg-teal" : "bg-mute"
                }`}
              />
            ) : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] text-foam">{drive.name}</span>
            <span className="block truncate text-[10px] text-mute">
              {drive.online == null
                ? `${drive.count} items`
                : drive.online
                  ? "Online"
                  : "Offline"}
            </span>
          </span>
          <Count value={drive.count} />
        </button>
        {drive.volumeId != null ? (
          <button
            type="button"
            aria-label={`Disk info for ${drive.name}`}
            aria-expanded={infoOpen}
            onClick={(event) => {
              event.stopPropagation();
              onToggleInfo();
            }}
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-medium ${
              infoOpen ? "bg-teal/15 text-teal" : "text-mute hover:bg-raised hover:text-foam"
            }`}
          >
            i
          </button>
        ) : null}
      </div>

      {infoOpen ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`${drive.name} disk info`}
          className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-40 rounded-xl border border-line bg-card p-2.5 shadow-2xl shadow-black/40"
        >
          <p className="text-[12px] font-medium text-foam">{drive.name}</p>
          <dl className="mt-2 space-y-1.5 text-[10px] leading-snug">
            <InfoRow label="Status" value={drive.online ? "Online" : "Offline"} />
            <InfoRow label="Mount" value={drive.mount ?? "—"} mono />
            <InfoRow
              label="Indexed"
              value={`${drive.count} photo${drive.count === 1 ? "" : "s"}${
                drive.bytes && drive.bytes > 0 ? ` · ${formatBytes(drive.bytes)}` : ""
              }`}
            />
            <InfoRow label="Last scan" value={formatTimestamp(drive.lastSeenAt ?? null)} />
            <InfoRow
              label="Watched"
              value={
                drive.watchCount === 0
                  ? "No folders"
                  : drive.watchCount === 1
                    ? drive.watchPaths[0] ?? "1 folder"
                    : `${drive.watchCount} folders`
              }
              mono={drive.watchCount === 1}
            />
          </dl>
          <div className="mt-2.5 flex flex-col gap-1">
            {onRevealFolder ? (
              <button
                type="button"
                disabled={!drive.online}
                title={drive.online ? "Reveal in Finder / Files" : "Plug the drive in to open its folder"}
                onClick={onRevealFolder}
                className="rounded-lg border border-line px-2 py-1.5 text-left text-[11px] text-foam hover:border-mute disabled:cursor-not-allowed disabled:opacity-40"
              >
                View folder
              </button>
            ) : null}
            {onRescan ? (
              <button
                type="button"
                disabled={importsLocked || !drive.online}
                title={
                  importsLocked
                    ? "Beta ended — imports are locked"
                    : drive.online
                      ? "Rescan this drive"
                      : "Plug the drive in to scan"
                }
                onClick={onRescan}
                className="rounded-lg border border-line px-2 py-1.5 text-left text-[11px] text-foam hover:border-mute disabled:cursor-not-allowed disabled:opacity-40"
              >
                Scan now
              </button>
            ) : null}
            {onRemove ? (
              <button
                type="button"
                onClick={onRemove}
                className="rounded-lg border border-danger/30 px-2 py-1.5 text-left text-[11px] text-danger hover:bg-danger/10"
              >
                Remove & forget drive
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-mute">{label}</dt>
      <dd className={`min-w-0 truncate text-foam ${mono ? "font-mono text-[9px]" : ""}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

function Header({ title }: { title: string }) {
  return <p className="px-1 pb-1.5 text-[9px] font-medium uppercase tracking-[0.16em] text-mute/80">{title}</p>;
}

function Count({ value }: { value: number }) {
  return <span className="shrink-0 font-mono text-[10px] tabular-nums text-mute">{value}</span>;
}

function rowClass(active: boolean, extra = "") {
  return `flex w-full items-center gap-1 rounded-xl px-1 py-1 text-mute ${extra} ${
    active ? "bg-raised text-foam" : "hover:bg-raised/70 hover:text-foam"
  }`;
}

function buildDrives(volumes: VolumeRecord[], watches: WatchedRoot[], items: StudioItem[]): DriveData[] {
  if (volumes.length === 0) {
    const byFolder = new Map<string, number>();
    for (const item of items) {
      const folder = item.folder || "Library";
      byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1);
    }
    return [...byFolder.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, count]) => ({
        key: `folder:${name}`,
        name,
        count,
        watchCount: 0,
        watchPaths: [],
      }));
  }

  return volumes.map((volume) => {
    const volumeWatches = watches.filter((watch) => watch.volumeId === volume.id);
    return {
      key: `volume-${volume.id}`,
      name: volume.label,
      mount: volume.lastMount,
      online: volume.online,
      count: volume.mediaCount,
      bytes: volume.mediaBytes,
      lastSeenAt: volume.lastSeenAt,
      fingerprint: volume.fingerprint,
      volumeId: volume.id,
      watchCount: volumeWatches.length,
      watchPaths: volumeWatches.map((watch) => watch.path),
    };
  });
}

function LibraryIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="5" height="10" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="3" width="5" height="10" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function DriveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden className="text-foam">
      <rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="11" cy="8" r="0.9" fill="currentColor" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ScanIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2 4V2h2M8 2h2v2M10 8v2H8M4 10H2V8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
