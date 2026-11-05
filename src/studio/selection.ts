export type PointerMods = {
  shift: boolean;
  toggle: boolean;
};

export function applySelection(
  current: string[],
  order: string[],
  anchor: string | null,
  id: string,
  mods: PointerMods,
  selectMode: boolean,
): { selected: string[]; anchor: string | null } {
  if (mods.shift && anchor) {
    const start = order.indexOf(anchor);
    const end = order.indexOf(id);
    if (start >= 0 && end >= 0) {
      const [from, to] = start < end ? [start, end] : [end, start];
      const range = order.slice(from, to + 1);
      const selected = mods.toggle ? [...new Set([...current, ...range])] : range;
      return { selected, anchor };
    }
  }
  if (mods.toggle || (selectMode && !mods.shift)) {
    const selected = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    return { selected, anchor: id };
  }
  return { selected: [id], anchor: id };
}
