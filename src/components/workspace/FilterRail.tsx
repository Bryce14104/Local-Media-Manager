import type { SortKey } from "../../studio/types";

type FilterRailProps = {
  sort: SortKey;
  onSort: (sort: SortKey) => void;
};

export function FilterRail({ sort, onSort }: FilterRailProps) {
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
    </div>
  );
}
