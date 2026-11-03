import type { ViewId } from "../lib/types";

type SidebarProps = {
  view: ViewId;
  onView: (view: ViewId) => void;
  mediaCount: number | null;
};

const NAV: { id: ViewId; label: string; hint: string }[] = [
  { id: "library", label: "Library", hint: "Indexed files" },
  { id: "scan", label: "Scan", hint: "Read a folder" },
  { id: "storage", label: "Storage", hint: "The SQLite file" },
];

export function Sidebar({ view, onView, mediaCount }: SidebarProps) {
  return (
    <aside className="border-b border-line bg-paper-deep/70 md:border-b-0 md:border-r">
      <div className="flex items-center gap-3 px-4 py-4 md:px-5 md:py-6">
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-moss text-paper"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 8h16M4 12h16M4 16h16" strokeLinecap="round" />
          </svg>
        </span>
        <div>
          <p className="font-serif text-xl leading-none text-ink">Shelf</p>
          <p className="mt-1 text-xs text-ink-soft">Files stay here.</p>
        </div>
      </div>

      <nav className="flex gap-2 overflow-x-auto px-4 pb-4 md:flex-col md:px-3 md:pb-0" aria-label="Sections">
        {NAV.map((item) => {
          const selected = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={selected ? "page" : undefined}
              onClick={() => onView(item.id)}
              className={`min-w-28 rounded-xl px-3 py-2 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass md:min-w-0 ${
                selected ? "bg-paper text-ink shadow-sm" : "text-ink-soft hover:bg-paper/70 hover:text-ink"
              }`}
            >
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="mt-0.5 hidden text-xs text-ink-soft md:block">{item.hint}</span>
            </button>
          );
        })}
      </nav>

      <p className="hidden px-5 py-6 text-xs leading-5 text-ink-soft md:block">
        {mediaCount == null
          ? "The catalog opens with the desktop app."
          : `${mediaCount} file${mediaCount === 1 ? "" : "s"} in the local catalog.`}
      </p>
    </aside>
  );
}
