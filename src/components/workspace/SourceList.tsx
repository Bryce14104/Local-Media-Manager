import type { AlbumRecord, VolumeRecord, WatchedRoot } from "../../lib/types";
import type { ActiveFilter } from "../../studio/types";

type SourceListProps = {
  volumes: VolumeRecord[];
  watches: WatchedRoot[];
  albums: AlbumRecord[];
  filters: ActiveFilter[];
  onFilter: (filter: ActiveFilter) => void;
  onClear: () => void;
  onRescan: () => void;
  onAddFolder: () => void;
  onOpenAlbum: (album: AlbumRecord) => void;
};

export function SourceList({
  volumes,
  watches,
  albums,
  filters,
  onFilter,
  onClear,
  onRescan,
  onAddFolder,
  onOpenAlbum,
}: SourceListProps) {
  const source = filters.find(
    (filter) => filter.kind === "volume" || filter.kind === "folder" || filter.kind === "album",
  );
  const grouped = groupWatches(volumes, watches);

  return (
    <aside className="flex max-h-40 w-full shrink-0 flex-col border-b border-line bg-studio md:h-full md:max-h-none md:w-44 md:border-b-0 md:border-r">
      <div className="px-1.5 pb-1 pt-1.5">
        <button
          type="button"
          onClick={onClear}
          className={rowClass(!source)}
        >
          <span className="grid h-5 w-5 place-items-center rounded-md bg-raised text-teal">
            <LibraryIcon />
          </span>
          <span className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-foam">All photos</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-1.5 pb-2">
        <section>
          <Header title="Drives" />
          {volumes.length === 0 ? (
            <p className="px-1 pt-0.5 text-[11px] leading-snug text-mute">
              Add a folder. Shelf remembers the disk.
            </p>
          ) : (
            <ul className="space-y-1">
              {volumes.map((volume) => {
                const folders = grouped.get(volume.id) ?? [];
                const active = source?.kind === "volume" && source.volumeId === volume.id;
                return (
                  <li key={volume.id}>
                    <button
                      type="button"
                      title={volume.online ? volume.lastMount : `Unplugged · last seen as ${volume.lastMount}`}
                      onClick={() =>
                        onFilter({
                          id: `volume-${volume.id}`,
                          kind: "volume",
                          volumeId: volume.id,
                          label: volume.label,
                        })
                      }
                      className={rowClass(active)}
                    >
                      <span className="relative grid h-5 w-5 place-items-center rounded-md bg-raised">
                        <DriveIcon />
                        <span
                          className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${
                            volume.online ? "bg-teal" : "bg-mute"
                          }`}
                        />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-left text-[12px] text-foam">{volume.label}</span>
                      <Count value={volume.mediaCount} />
                    </button>
                    {folders.length > 0 ? (
                      <ul className="ml-3 border-l border-line pl-1.5">
                        {folders.map((watch) => {
                          const name = folderName(watch.path);
                          const folderActive = source?.kind === "folder" && source.path === watch.path;
                          return (
                            <li key={watch.id}>
                              <button
                                type="button"
                                title={watch.path}
                                onClick={() =>
                                  onFilter({
                                    id: `folder-${watch.id}`,
                                    kind: "folder",
                                    path: watch.path,
                                    label: name,
                                  })
                                }
                                className={rowClass(folderActive, "py-1")}
                              >
                                <span className="min-w-0 flex-1 truncate pl-0.5 text-left text-[11px]">{name}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {orphanFolders(volumes, watches).length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {orphanFolders(volumes, watches).map((watch) => {
                const name = folderName(watch.path);
                const active = source?.kind === "folder" && source.path === watch.path;
                return (
                  <li key={watch.id}>
                    <button
                      type="button"
                      title={watch.path}
                      onClick={() =>
                        onFilter({
                          id: `folder-${watch.id}`,
                          kind: "folder",
                          path: watch.path,
                          label: name,
                        })
                      }
                      className={rowClass(active)}
                    >
                      <span className="grid h-5 w-5 place-items-center rounded-md bg-raised text-mute">
                        <FolderIcon />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-left text-[12px]">{name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        <section>
          <Header title="Albums" />
          {albums.length === 0 ? (
            <p className="px-1 pt-0.5 text-[11px] leading-snug text-mute">None yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {albums.map((album) => {
                const active = source?.kind === "album" && source.albumId === album.id;
                return (
                  <li key={album.id}>
                    <button type="button" onClick={() => onOpenAlbum(album)} className={rowClass(active)}>
                      <span className="grid h-5 w-5 place-items-center rounded-md bg-raised text-mute">
                        <AlbumIcon />
                      </span>
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

      <div className="mt-auto flex gap-0.5 border-t border-line p-1">
        <button
          type="button"
          onClick={onAddFolder}
          className="flex flex-1 items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[11px] text-foam hover:bg-raised"
        >
          <PlusIcon />
          Add
        </button>
        <button
          type="button"
          onClick={onRescan}
          className="flex flex-1 items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[11px] text-foam hover:bg-raised"
        >
          <ScanIcon />
          Scan
        </button>
      </div>
    </aside>
  );
}

function Header({ title }: { title: string }) {
  return (
    <p className="px-1 pb-1 text-[9px] font-medium uppercase tracking-[0.16em] text-mute/80">{title}</p>
  );
}

function Count({ value }: { value: number }) {
  return <span className="shrink-0 font-mono text-[10px] tabular-nums text-mute">{value}</span>;
}

function rowClass(active: boolean, extra = "") {
  return `flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-mute transition-colors ${extra} ${
    active ? "bg-raised text-foam" : "hover:bg-raised/70 hover:text-foam"
  }`;
}

function folderName(path: string) {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

function groupWatches(volumes: VolumeRecord[], watches: WatchedRoot[]) {
  const known = new Set(volumes.map((volume) => volume.id));
  const grouped = new Map<number, WatchedRoot[]>();
  for (const watch of watches) {
    if (watch.volumeId == null || !known.has(watch.volumeId)) continue;
    const list = grouped.get(watch.volumeId) ?? [];
    list.push(watch);
    grouped.set(watch.volumeId, list);
  }
  return grouped;
}

function orphanFolders(volumes: VolumeRecord[], watches: WatchedRoot[]) {
  const known = new Set(volumes.map((volume) => volume.id));
  return watches.filter((watch) => watch.volumeId == null || !known.has(watch.volumeId));
}

function LibraryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="5" height="10" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="3" width="5" height="10" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function DriveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="text-foam">
      <rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="11" cy="8" r="0.9" fill="currentColor" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 5.5v6A1.5 1.5 0 0 0 4 13h8a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 12 5H8L7 3.5H4A1.5 1.5 0 0 0 2.5 5v.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlbumIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="3.5" y="3" width="9" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 7.5h4M6 10h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
