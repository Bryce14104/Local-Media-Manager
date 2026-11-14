import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { filterLabel } from "../../studio/query";
import type { ActiveFilter, LayoutPreset, Suggestion, ViewMode } from "../../studio/types";

type TopBarProps = {
  query: string;
  onQuery: (value: string) => void;
  aiSearch: boolean;
  onAiSearch: (value: boolean) => void;
  suggestions: Suggestion[];
  filters: ActiveFilter[];
  onRemoveFilter: (id: string) => void;
  onApplySuggestion: (suggestion: Suggestion) => void;
  onSubmitQuery: () => void;
  viewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
  preset: LayoutPreset;
  onPreset: (preset: LayoutPreset) => void;
  onAdd: () => void;
  onExport: () => void;
  onPreferences: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
};

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "timeline", label: "Timeline" },
  { id: "map", label: "Map" },
  { id: "insights", label: "AI Insights" },
];

const PRESETS: { id: LayoutPreset; label: string }[] = [
  { id: "browse", label: "Browse" },
  { id: "inspect", label: "Inspect" },
  { id: "compare", label: "Compare" },
];

export function TopBar({
  query,
  onQuery,
  aiSearch,
  onAiSearch,
  suggestions,
  filters,
  onRemoveFilter,
  onApplySuggestion,
  onSubmitQuery,
  viewMode,
  onViewMode,
  preset,
  onPreset,
  onAdd,
  onExport,
  onPreferences,
  inputRef,
}: TopBarProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inputRef]);

  function choose(suggestion: Suggestion) {
    onApplySuggestion(suggestion);
    setOpen(false);
    setMenuOpen(false);
  }

  function onInputKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((current) => Math.min(suggestions.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const suggestion = suggestions[highlight];
      if (open && suggestion) choose(suggestion);
      else onSubmitQuery();
      setOpen(false);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <header className="relative z-30 border-b border-line bg-studio/95">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="hidden items-center gap-2 pr-1 sm:flex">
          <span className="grid h-7 w-7 place-items-center rounded-md border border-teal/40 text-teal" aria-hidden>
            <span className="h-px w-3 bg-teal" />
          </span>
          <span className="text-sm font-medium tracking-wide">Shelf</span>
        </div>

        <div className="relative min-w-0 flex-1">
          <label className="sr-only" htmlFor="command-palette">
            Search and commands
          </label>
          <input
            id="command-palette"
            ref={inputRef}
            value={query}
            role="combobox"
            aria-expanded={open}
            aria-controls="command-suggestions"
            aria-activedescendant={open ? suggestions[highlight]?.id : undefined}
            placeholder={aiSearch ? "Search objects, scenes, or a command" : "Search file names and paths"}
            onChange={(event) => {
              onQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setOpen(false), 150);
            }}
            onKeyDown={onInputKey}
            className="w-full rounded-full border border-line bg-card py-2 pl-4 pr-[5.6rem] text-sm outline-none placeholder:text-mute focus:border-teal min-[420px]:pr-[8rem] md:pr-[12rem]"
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
            <AiSearchSwitch checked={aiSearch} onChange={onAiSearch} />
            <span className="pointer-events-none hidden rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-mute md:inline">
              Ctrl K
            </span>
          </div>
          {open && suggestions.length > 0 ? (
            <ul
              id="command-suggestions"
              role="listbox"
              className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-40 overflow-hidden rounded-2xl border border-line bg-card shadow-2xl shadow-black/40"
            >
              {suggestions.map((suggestion, index) => (
                <li key={suggestion.id} id={suggestion.id} role="option" aria-selected={index === highlight}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(suggestion)}
                    className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm ${
                      index === highlight ? "bg-raised" : ""
                    }`}
                  >
                    <span>{suggestion.label}</span>
                    <span className="truncate font-mono text-[10px] text-mute">{suggestion.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="hidden items-center gap-1 lg:flex">
          <Action label="Add media" onClick={onAdd} />
          <Action label="Batch export" onClick={onExport} />
        </div>

        <div className="relative lg:hidden">
          <Action label="Menu" pressed={menuOpen} onClick={() => setMenuOpen((current) => !current)} />
          {menuOpen ? (
            <div className="absolute right-0 top-[calc(100%+0.4rem)] z-40 w-52 rounded-2xl border border-line bg-card p-2">
              {VIEWS.map((item) => (
                <MenuRow
                  key={item.id}
                  label={item.label}
                  onClick={() => {
                    onViewMode(item.id);
                    setMenuOpen(false);
                  }}
                />
              ))}
              {PRESETS.map((item) => (
                <MenuRow
                  key={item.id}
                  label={item.label}
                  onClick={() => {
                    onPreset(item.id);
                    setMenuOpen(false);
                  }}
                />
              ))}
              <MenuRow label="Add media" onClick={() => { onAdd(); setMenuOpen(false); }} />
              <MenuRow label="Batch export" onClick={() => { onExport(); setMenuOpen(false); }} />
              <MenuRow
                label="Preferences"
                onClick={() => {
                  onPreferences();
                  setMenuOpen(false);
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          <ViewSwitch viewMode={viewMode} preset={preset} onViewMode={onViewMode} />
        </div>
        <PresetSwitch preset={preset} onPreset={onPreset} />
      </div>

      {filters.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto px-3 pb-2">
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => onRemoveFilter(filter.id)}
              className="shrink-0 rounded-full border border-teal/40 bg-teal/10 px-2.5 py-1 text-xs text-teal"
            >
              {filterLabel(filter)}
              <span className="sr-only">, remove filter</span>
              <span aria-hidden> ×</span>
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}

function AiSearchSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="AI Search"
      data-ai-search={checked ? "on" : "off"}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onChange(!checked)}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-1.5 py-1 text-[11px] leading-none ${
        checked ? "border-teal/50 bg-teal/15 text-teal" : "border-line bg-studio text-mute hover:text-foam"
      }`}
    >
      <span aria-hidden className={`relative h-3.5 w-7 shrink-0 rounded-full ${checked ? "bg-teal" : "bg-line"}`}>
        <span
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-studio shadow transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </span>
      <span className="pr-0.5 font-medium tracking-wide">
        <span className="hidden min-[420px]:inline">AI Search</span>
        <span className="min-[420px]:hidden">AI</span>
      </span>
    </button>
  );
}

function ViewSwitch({
  viewMode,
  preset,
  onViewMode,
}: {
  viewMode: ViewMode;
  preset: LayoutPreset;
  onViewMode: (mode: ViewMode) => void;
}) {
  return (
    <div role="radiogroup" aria-label="View" className="flex rounded-full border border-line p-0.5">
      {VIEWS.map((item) => {
        const active = preset !== "compare" && viewMode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onViewMode(item.id)}
            className={`rounded-full px-2.5 py-1 text-xs ${
              active ? "bg-teal text-teal-ink" : "text-mute hover:text-foam"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function PresetSwitch({
  preset,
  onPreset,
}: {
  preset: LayoutPreset;
  onPreset: (preset: LayoutPreset) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Layout preset" className="flex rounded-full border border-line p-0.5">
      {PRESETS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={preset === item.id}
          onClick={() => onPreset(item.id)}
          className={`rounded-full px-2.5 py-1 text-xs ${
            preset === item.id ? "bg-teal text-teal-ink" : "text-mute hover:text-foam"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Action({
  label,
  onClick,
  pressed = false,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs ${
        pressed ? "border-teal text-teal" : "border-line text-foam hover:border-mute"
      }`}
    >
      {label}
    </button>
  );
}

function MenuRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-raised">
      {label}
    </button>
  );
}
