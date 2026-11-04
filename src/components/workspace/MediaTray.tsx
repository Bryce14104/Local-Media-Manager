import { useEffect, useRef } from "react";
import { frameBackground, placeName } from "../../studio/catalog";
import { formatLabel } from "../../studio/query";
import type { StudioItem } from "../../studio/types";

type MediaTrayProps = {
  items: StudioItem[];
  primaryId: string | null;
  onSelect: (id: string) => void;
};

export function MediaTray({ items, primaryId, onSelect }: MediaTrayProps) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = scroller.current;
    if (!primaryId || !box) return;
    const node = box.querySelector(`[data-tray-id="${CSS.escape(primaryId)}"]`);
    if (!(node instanceof HTMLElement)) return;
    const nodeRect = node.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const top = box.scrollTop + (nodeRect.top - boxRect.top) - (boxRect.height - nodeRect.height) / 2;
    box.scrollTo({ top, behavior: "smooth" });
  }, [primaryId, items]);

  return (
    <aside className="flex max-h-[46%] min-h-0 w-full shrink-0 flex-col border-t border-[#2ee0c5]/25 bg-[#0f1115] lg:max-h-none lg:w-[22rem] lg:border-t-0 lg:border-l">
      <div className="px-4 pb-2 pt-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-mute">Library</p>
        <p className="mt-1 text-sm tracking-tight text-foam">
          {items.length === 1 ? "1 frame" : `${items.length} frames`}
        </p>
      </div>
      <div
        ref={scroller}
        role="listbox"
        aria-label="Frames"
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4"
      >
        {items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[#2ee0c5]/25 px-4 py-8 text-center text-sm text-mute">
            No frames in this view.
          </p>
        ) : (
          items.map((item) => {
            const active = item.id === primaryId;
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                data-tray-id={item.id}
                aria-selected={active}
                onClick={() => onSelect(item.id)}
                className={`flex w-full gap-3 rounded-2xl border bg-[#171b22] p-2 text-left transition-colors ${
                  active ? "border-[#2ee0c5]" : "border-[#2ee0c5]/35 hover:border-[#2ee0c5]/70"
                }`}
              >
                <div
                  className="h-[4.5rem] w-[4.5rem] shrink-0 rounded-xl"
                  style={{ background: frameBackground(item.id) }}
                />
                <span className="min-w-0 py-0.5">
                  <span className={`block truncate text-sm font-medium tracking-tight ${active ? "text-[#2ee0c5]" : "text-foam"}`}>
                    {item.fileName}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-mute">
                    {placeName(item.folder)} · {shortDate(item.capturedAt)}
                  </span>
                  <span className="mt-1 block truncate font-mono text-[10px] tracking-wide text-mute">
                    {item.camera} · {formatLabel(item.format)}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}
