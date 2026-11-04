import { useEffect, useRef } from "react";
import { frameBackground, placeName } from "../../studio/catalog";
import type { StudioItem } from "../../studio/types";

type MediaTrayProps = {
  items: StudioItem[];
  primaryId: string | null;
  onSelect: (id: string) => void;
};

export function MediaTray({ items, primaryId, onSelect }: MediaTrayProps) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!primaryId || !scroller.current) return;
    const node = scroller.current.querySelector(`[data-tray-id="${CSS.escape(primaryId)}"]`);
    if (node instanceof HTMLElement) node.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [primaryId, items]);

  return (
    <div className="shrink-0 border-t border-line bg-card/95">
      <div
        ref={scroller}
        role="listbox"
        aria-label="Media tray"
        className="flex gap-2 overflow-x-auto px-3 py-2"
      >
        {items.length === 0 ? (
          <p className="px-1 py-5 text-xs text-mute">No frames in this view.</p>
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
                title={`${item.fileName} · ${placeName(item.folder)}`}
                onClick={() => onSelect(item.id)}
                className={`w-24 shrink-0 overflow-hidden rounded-lg border text-left ${
                  active ? "border-teal ring-1 ring-teal" : "border-line hover:border-mute"
                }`}
              >
                <div className="aspect-[4/3]" style={{ background: frameBackground(item.id) }} />
                <p className={`truncate px-1.5 py-1 text-[10px] ${active ? "text-teal" : "text-mute"}`}>{item.fileName}</p>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
