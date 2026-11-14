import type { ReactNode } from "react";
import type { AlbumRecord } from "../../lib/types";
import type { ActiveFilter, ColorLabel, Filter, SortKey } from "../../studio/types";

const COLORS: { id: ColorLabel; swatch: string }[] = [
  { id: "red", swatch: "#ef4444" },
  { id: "yellow", swatch: "#eab308" },
  { id: "green", swatch: "#22c55e" },
  { id: "blue", swatch: "#3b82f6" },
  { id: "purple", swatch: "#a855f7" },
];

type FilterRailProps = {
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  filters: ActiveFilter[];
  onToggle: (filter: Filter) => void;
  albums: AlbumRecord[];
  onAlbum: (album: AlbumRecord) => void;
  onCreateAlbum: (name: string) => void;
  duplicateCount: number;
};

export function FilterRail({
  sort,
  onSort,
  filters,
  onToggle,
  albums,
  onAlbum,
  onCreateAlbum,
  duplicateCount,
}: FilterRailProps) {
  const active = (kind: Filter["kind"], extra?: string) =>
    filters.some((filter) => {
      if (filter.kind !== kind) return false;
      if (kind === "color" && extra) return filter.kind === "color" && filter.value === extra;
      if (kind === "type" && extra) return filter.kind === "type" && filter.value === extra;
      if (kind === "flag" && extra) return filter.kind === "flag" && filter.value === extra;
      if (kind === "rating" && extra) return filter.kind === "rating" && String(filter.value) === extra;
      return true;
    });

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
      <label className="flex items-center gap-1.5 text-[11px] text-mute">
        Sort
        <select
          value={sort}
          onChange={(event) => onSort(event.target.value as SortKey)}
          className="rounded-full border border-line bg-card px-2 py-1 text-xs text-foam outline-none"
        >
          <option value="captured">Date</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
          <option value="rating">Rating</option>
          <option value="camera">Camera</option>
        </select>
      </label>
      <Chip on={() => onToggle({ kind: "flag", value: "pick" })} pressed={active("flag", "pick")}>
        Picks
      </Chip>
      <Chip on={() => onToggle({ kind: "flag", value: "reject" })} pressed={active("flag", "reject")}>
        Rejects
      </Chip>
      <Chip on={() => onToggle({ kind: "unrated" })} pressed={active("unrated")}>
        Unrated
      </Chip>
      <Chip on={() => onToggle({ kind: "rating", op: ">=", value: 4 })} pressed={active("rating", "4")}>
        ★ 4+
      </Chip>
      <Chip on={() => onToggle({ kind: "type", value: "jpg" })} pressed={active("type", "jpg")}>
        JPG
      </Chip>
      <Chip on={() => onToggle({ kind: "type", value: "raw" })} pressed={active("type", "raw")}>
        RAW
      </Chip>
      <Chip on={() => onToggle({ kind: "type", value: "video" })} pressed={active("type", "video")}>
        Video
      </Chip>
      <Chip on={() => onToggle({ kind: "gps" })} pressed={active("gps")}>
        GPS
      </Chip>
      <Chip on={() => onToggle({ kind: "recent" })} pressed={active("recent")}>
        Recent
      </Chip>
      <Chip
        on={() => onToggle({ kind: "duplicates", ids: [] })}
        pressed={active("duplicates")}
        disabled={duplicateCount === 0}
      >
        Dupes {duplicateCount > 0 ? duplicateCount : ""}
      </Chip>
      <span className="mx-1 h-4 w-px bg-line" />
      {COLORS.map((color) => (
        <button
          key={color.id}
          type="button"
          title={color.id}
          aria-pressed={active("color", color.id)}
          onClick={() => onToggle({ kind: "color", value: color.id })}
          className={`h-4 w-4 rounded-full border ${active("color", color.id) ? "border-foam" : "border-black/40"}`}
          style={{ background: color.swatch }}
        />
      ))}
      {albums.length > 0 ? <span className="mx-1 h-4 w-px bg-line" /> : null}
      {albums.map((album) => (
        <Chip key={album.id} on={() => onAlbum(album)} pressed={filters.some((filter) => filter.kind === "album" && filter.albumId === album.id)}>
          {album.name} {album.count}
        </Chip>
      ))}
      <button
        type="button"
        onClick={() => {
          const name = window.prompt("Album name");
          if (name?.trim()) onCreateAlbum(name.trim());
        }}
        className="rounded-full border border-dashed border-line px-2.5 py-1 text-[11px] text-mute hover:border-teal hover:text-teal"
      >
        New album
      </button>
    </div>
  );
}

function Chip({
  children,
  on,
  pressed,
  disabled,
}: {
  children: ReactNode;
  on: () => void;
  pressed: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={on}
      className={`rounded-full border px-2.5 py-1 text-[11px] disabled:opacity-40 ${
        pressed ? "border-teal bg-teal/15 text-teal" : "border-line text-mute hover:border-teal hover:text-foam"
      }`}
    >
      {children}
    </button>
  );
}
