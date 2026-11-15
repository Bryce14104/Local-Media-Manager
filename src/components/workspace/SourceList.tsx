import type { ReactNode } from "react";
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
  const selected = filters[0];
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-line bg-card md:h-full md:w-56 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-mute">Library</p>
        <button type="button" onClick={onClear} className="text-[11px] text-mute hover:text-foam">
          All
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-2 pb-3">
        <Section title="Smart">
          <Row
            label="Picks"
            active={selected?.kind === "flag" && selected.value === "pick"}
            onClick={() => onFilter({ id: "picks", kind: "flag", value: "pick" })}
          />
          <Row
            label="Videos"
            active={selected?.kind === "type" && selected.value === "video"}
            onClick={() => onFilter({ id: "videos", kind: "type", value: "video" })}
          />
          <Row
            label="Original offline"
            active={selected?.kind === "offline"}
            onClick={() => onFilter({ id: "offline", kind: "offline" })}
          />
        </Section>
        <Section title="Drives">
          {volumes.length === 0 ? <Empty>Connect a folder on a disk to remember it.</Empty> : null}
          {volumes.map((volume) => (
            <Row
              key={volume.id}
              label={volume.label}
              hint={volume.online ? "Connected" : "Unplugged"}
              count={volume.mediaCount}
              active={selected?.kind === "volume" && selected.volumeId === volume.id}
              onClick={() =>
                onFilter({
                  id: `volume-${volume.id}`,
                  kind: "volume",
                  volumeId: volume.id,
                  label: volume.label,
                })
              }
            />
          ))}
        </Section>
        <Section title="Folders">
          <Row label="Add folder" onClick={onAddFolder} />
          <Row label="Rescan remembered" onClick={onRescan} />
          {watches.map((watch) => {
            const name = watch.path.split(/[/\\]/).filter(Boolean).pop() ?? watch.path;
            return (
              <Row
                key={watch.id}
                label={name}
                hint={watch.path}
                active={selected?.kind === "folder" && selected.path === watch.path}
                onClick={() =>
                  onFilter({
                    id: `folder-${watch.id}`,
                    kind: "folder",
                    path: watch.path,
                    label: name,
                  })
                }
              />
            );
          })}
        </Section>
        <Section title="Albums">
          {albums.length === 0 ? <Empty>Create albums from the selection later.</Empty> : null}
          {albums.map((album) => (
            <Row
              key={album.id}
              label={album.name}
              count={album.count}
              active={selected?.kind === "album" && selected.albumId === album.id}
              onClick={() => onOpenAlbum(album)}
            />
          ))}
        </Section>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.14em] text-mute">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({
  label,
  hint,
  count,
  active,
  onClick,
}: {
  label: string;
  hint?: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={hint}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
        active ? "bg-line text-foam" : "text-mute hover:bg-line/60 hover:text-foam"
      }`}
    >
      <span className="min-w-0 truncate">{label}</span>
      {count != null ? <span className="shrink-0 text-[10px] text-mute">{count}</span> : null}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2 text-[11px] text-mute">{children}</p>;
}
