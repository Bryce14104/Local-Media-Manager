import type { SortKey } from "../../studio/types";

type FilterRailProps = {
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  collapseBursts?: boolean;
  onCollapseBursts?: (value: boolean) => void;
  needsLook?: boolean;
  onNeedsLook?: (value: boolean) => void;
};

export function FilterRail({
  sort,
  onSort,
  collapseBursts = false,
  onCollapseBursts,
  needsLook = false,
  onNeedsLook,
}: FilterRailProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
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
          <option value="camera">Camera</option>
        </select>
      </label>
      {onCollapseBursts ? (
        <button
          type="button"
          aria-pressed={collapseBursts}
          onClick={() => onCollapseBursts(!collapseBursts)}
          className={`rounded-full px-2.5 py-1 text-[11px] ${collapseBursts ? "bg-teal text-teal-ink" : "text-mute hover:text-foam"}`}
        >
          Collapse bursts
        </button>
      ) : null}
      {onNeedsLook ? (
        <button
          type="button"
          aria-pressed={needsLook}
          onClick={() => onNeedsLook(!needsLook)}
          className={`rounded-full px-2.5 py-1 text-[11px] ${needsLook ? "bg-teal text-teal-ink" : "text-mute hover:text-foam"}`}
        >
          Needs a look
        </button>
      ) : null}
    </div>
  );
}
