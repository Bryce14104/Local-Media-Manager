import { useMemo, useState } from "react";
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
  onAddFolder: () => void;
  importsLocked?: boolean;
  onOpenAlbum: (album: AlbumRecord) => void;
  onOpen: (id: string) => void;
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
  onAddFolder,
  importsLocked = false,
  onOpenAlbum,
  onOpen,
}: SourceListProps) {
  const source = filters.find(
    (filter) => filter.kind === "volume" || filter.kind === "folder" || filter.kind === "album",
  );
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildTree(volumes, watches, items), [volumes, watches, items]);

  function toggle(key: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expanded(key: string) {
    return open.has(key);
  }

  function reveal(key: string) {
    setOpen((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }

  return (
    <aside className="flex max-h-40 w-full shrink-0 flex-col border-b border-line bg-studio md:h-full md:max-h-none md:w-44 md:border-b-0 md:border-r">
      <div className="px-1.5 pb-1 pt-1.5">
        <button type="button" onClick={onClear} className={rowClass(!source)}>
          <span className="grid h-5 w-5 place-items-center rounded-md bg-raised text-teal">
            <LibraryIcon />
          </span>
          <span className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-foam">All photos</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-1.5 pb-2">
        <section>
          <Header title="Drives" />
          {tree.length === 0 ? (
            <p className="px-1 pt-0.5 text-[11px] leading-snug text-mute">Add a folder. Shelf remembers the disk.</p>
          ) : (
            <ul>
              {tree.map((node) => (
                <DriveNode
                  key={node.key}
                  node={node}
                  source={source}
                  expanded={expanded}
                  onToggle={toggle}
                  onReveal={reveal}
                  onFilter={onFilter}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          )}
        </section>

        <section>
          <Header title="Albums" />
          {albums.length === 0 ? (
            <p className="px-1 pt-0.5 text-[11px] leading-snug text-mute">None yet.</p>
          ) : (
            <ul>
              {albums.map((album) => {
                const active = source?.kind === "album" && source.albumId === album.id;
                return (
                  <li key={album.id}>
                    <button type="button" onClick={() => onOpenAlbum(album)} className={rowClass(active)}>
                      <span className="w-3" />
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
          aria-disabled={importsLocked || undefined}
          title={importsLocked ? "Beta ended — imports are locked" : undefined}
          className={`flex flex-1 items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[11px] hover:bg-raised ${
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
          className={`flex flex-1 items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[11px] hover:bg-raised ${
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

type FileLeaf = { id: string; name: string; previewUrl: string | null };
type FolderNode = { key: string; name: string; path: string; files: FileLeaf[] };
type DriveNodeData = {
  key: string;
  name: string;
  hint: string;
  online?: boolean;
  count: number;
  volumeId?: number;
  folders: FolderNode[];
  files: FileLeaf[];
};

function DriveNode({
  node,
  source,
  expanded,
  onToggle,
  onReveal,
  onFilter,
  onOpen,
}: {
  node: DriveNodeData;
  source: ActiveFilter | undefined;
  expanded: (key: string) => boolean;
  onToggle: (key: string) => void;
  onReveal: (key: string) => void;
  onFilter: (filter: ActiveFilter) => void;
  onOpen: (id: string) => void;
}) {
  const open = expanded(node.key);
  const hasChildren = node.folders.length > 0 || node.files.length > 0;
  const active = source?.kind === "volume" && node.volumeId != null && source.volumeId === node.volumeId;
  return (
    <li>
      <div className={rowClass(Boolean(active))}>
        <Chevron open={open} disabled={!hasChildren} onClick={() => hasChildren && onToggle(node.key)} />
        <button
          type="button"
          title={node.hint}
          onClick={() => {
            onReveal(node.key);
            if (node.volumeId != null) {
              onFilter({
                id: node.key,
                kind: "volume",
                volumeId: node.volumeId,
                label: node.name,
              });
            } else {
              onFilter({ id: node.key, kind: "folder", path: node.name, label: node.name });
            }
          }}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          <span className="relative grid h-4 w-4 shrink-0 place-items-center">
            <DriveIcon />
            {node.online != null ? (
              <span
                className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${node.online ? "bg-teal" : "bg-mute"}`}
              />
            ) : null}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-foam">{node.name}</span>
          <Count value={node.count} />
        </button>
      </div>
      {open ? (
        <ul className="ml-2 border-l border-line pl-1">
          {node.folders.map((folder) => (
            <FolderRow
              key={folder.key}
              folder={folder}
              source={source}
              expanded={expanded}
              onToggle={onToggle}
              onReveal={onReveal}
              onFilter={onFilter}
              onOpen={onOpen}
            />
          ))}
          {node.files.map((file) => (
            <FileRow key={file.id} file={file} onOpen={onOpen} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function FolderRow({
  folder,
  source,
  expanded,
  onToggle,
  onReveal,
  onFilter,
  onOpen,
}: {
  folder: FolderNode;
  source: ActiveFilter | undefined;
  expanded: (key: string) => boolean;
  onToggle: (key: string) => void;
  onReveal: (key: string) => void;
  onFilter: (filter: ActiveFilter) => void;
  onOpen: (id: string) => void;
}) {
  const open = expanded(folder.key);
  const active = source?.kind === "folder" && source.path === folder.path;
  return (
    <li>
      <div className={rowClass(Boolean(active), "py-0.5")}>
        <Chevron open={open} disabled={folder.files.length === 0} onClick={() => onToggle(folder.key)} />
        <button
          type="button"
          title={folder.path}
          onClick={() => {
            onReveal(folder.key);
            onFilter({
              id: folder.key,
              kind: "folder",
              path: folder.path,
              label: folder.name,
            });
          }}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[11px]">{folder.name}</span>
          <Count value={folder.files.length} />
        </button>
      </div>
      {open ? (
        <ul className="ml-2 border-l border-line pl-1">
          {folder.files.slice(0, 80).map((file) => (
            <FileRow key={file.id} file={file} onOpen={onOpen} />
          ))}
          {folder.files.length > 80 ? (
            <li className="px-1 py-0.5 text-[10px] text-mute">+{folder.files.length - 80} more</li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function FileRow({ file, onOpen }: { file: FileLeaf; onOpen: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        title={file.name}
        onClick={() => onOpen(file.id)}
        className="flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-raised"
      >
        {file.previewUrl ? (
          <img src={file.previewUrl} alt="" className="h-4 w-4 shrink-0 rounded-sm object-cover" />
        ) : (
          <span className="h-4 w-4 shrink-0 rounded-sm bg-raised" />
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] text-mute">{file.name}</span>
      </button>
    </li>
  );
}

function Chevron({ open, disabled, onClick }: { open: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={open ? "Collapse" : "Expand"}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`grid h-4 w-4 shrink-0 place-items-center rounded text-mute ${disabled ? "opacity-20" : "hover:text-foam"}`}
    >
      <svg
        width="8"
        height="8"
        viewBox="0 0 8 8"
        className={`transition-transform ${open ? "rotate-90" : ""}`}
        aria-hidden
      >
        <path d="M2.2 1.2 5.8 4 2.2 6.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function Header({ title }: { title: string }) {
  return <p className="px-1 pb-1 text-[9px] font-medium uppercase tracking-[0.16em] text-mute/80">{title}</p>;
}

function Count({ value }: { value: number }) {
  return <span className="shrink-0 font-mono text-[10px] tabular-nums text-mute">{value}</span>;
}

function rowClass(active: boolean, extra = "") {
  return `flex w-full items-center gap-0.5 rounded-lg px-0.5 py-0.5 text-mute ${extra} ${
    active ? "bg-raised text-foam" : "hover:bg-raised/70 hover:text-foam"
  }`;
}

function leaf(item: StudioItem): FileLeaf {
  return { id: item.id, name: item.fileName, previewUrl: item.previewUrl ?? null };
}

function folderOf(item: StudioItem) {
  if (item.sourcePath) {
    const parts = item.sourcePath.split(/[/\\]/).filter(Boolean);
    parts.pop();
    return parts.join("/") || item.folder;
  }
  return item.folder;
}

function buildTree(volumes: VolumeRecord[], watches: WatchedRoot[], items: StudioItem[]): DriveNodeData[] {
  if (volumes.length === 0) {
    const byFolder = new Map<string, FileLeaf[]>();
    for (const item of items) {
      const folder = item.folder || "Library";
      const list = byFolder.get(folder) ?? [];
      list.push(leaf(item));
      byFolder.set(folder, list);
    }
    return [...byFolder.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, files]) => ({
        key: `folder:${name}`,
        name,
        hint: name,
        count: files.length,
        folders: [],
        files,
      }));
  }

  const known = new Set(volumes.map((volume) => volume.id));
  return volumes.map((volume) => {
    const owned = items.filter((item) => item.volumeId === volume.id);
    const byFolder = new Map<string, FileLeaf[]>();
    const loose: FileLeaf[] = [];
    for (const item of owned) {
      const path = folderOf(item);
      if (!path) {
        loose.push(leaf(item));
        continue;
      }
      const list = byFolder.get(path) ?? [];
      list.push(leaf(item));
      byFolder.set(path, list);
    }
    for (const watch of watches) {
      if (watch.volumeId !== volume.id || !known.has(watch.volumeId ?? -1)) continue;
      const path = watch.path.replace(/\\/g, "/");
      if (!byFolder.has(path)) byFolder.set(path, []);
    }
    const folders: FolderNode[] = [...byFolder.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, files]) => ({
        key: `folder:${path}`,
        name: folderName(path),
        path,
        files,
      }));
    return {
      key: `volume-${volume.id}`,
      name: volume.label,
      hint: volume.online ? volume.lastMount : `Unplugged · last seen as ${volume.lastMount}`,
      online: volume.online,
      count: volume.mediaCount,
      volumeId: volume.id,
      folders,
      files: loose,
    };
  });
}

function folderName(path: string) {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
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
