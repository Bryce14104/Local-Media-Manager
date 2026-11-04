import { useEffect, useMemo, useRef, useState } from "react";
import { AddMediaModal } from "../components/drawers/AddMediaModal";
import { BatchExportModal } from "../components/drawers/BatchExportModal";
import { PreferencesModal } from "../components/drawers/PreferencesModal";
import { InspectorPanel } from "../components/panels/InspectorPanel";
import { TopBar } from "../components/shell/TopBar";
import { TelemetryBar } from "../components/shell/TelemetryBar";
import { ComparePane } from "../components/workspace/ComparePane";
import { MediaMap } from "../components/workspace/MediaMap";
import { MediaStage } from "../components/workspace/MediaStage";
import { createCatalog, inventItems, nextFlag } from "./catalog";
import type { MapZoom } from "./mapRegions";
import { matchesFilters, parseQuery, suggestions, upsertFilter } from "./query";
import type {
  ActiveFilter,
  GeoBounds,
  LayoutPreset,
  MediaFormat,
  PanelMode,
  StudioAction,
  StudioItem,
  Suggestion,
  Telemetry,
  ViewMode,
} from "./types";

const INITIAL_TELEMETRY: Telemetry = {
  scanLabel: "Idle · catalog ready",
  scanProgress: null,
  syncLabel: "SQLite · ready",
  storageUsed: "18.4 GB",
  storageFree: "1.2 TB",
  exportLabel: null,
};

export function Workspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const scanTimer = useRef<number | null>(null);
  const [items, setItems] = useState<StudioItem[]>(() => createCatalog());
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("compact");
  const [preset, setPreset] = useState<LayoutPreset>("browse");
  const [panelMode, setPanelMode] = useState<PanelMode>("hidden");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ x: 64, y: 72 });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [modal, setModal] = useState<"add" | "export" | "preferences" | null>(null);
  const [cacheZoom, setCacheZoom] = useState<MapZoom>(12);
  const [cacheBounds, setCacheBounds] = useState<GeoBounds | null>(null);
  const [selectingCache, setSelectingCache] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry>(INITIAL_TELEMETRY);

  const visible = useMemo(
    () => items.filter((item) => matchesFilters(item, filters)),
    [items, filters],
  );
  const palette = useMemo(() => suggestions(query, items), [query, items]);
  const primary = items.find((item) => item.id === primaryId) ?? null;
  const comparePair: [StudioItem | null, StudioItem | null] = [
    items.find((item) => item.id === selectedIds[0]) ?? null,
    items.find((item) => item.id === selectedIds[1]) ?? null,
  ];

  useEffect(() => {
    return () => {
      if (scanTimer.current != null) window.clearInterval(scanTimer.current);
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (event.key === "Escape") {
        if (selectingCache) return;
        setModal(null);
        if (panelMode === "floating") setPanelMode("hidden");
        return;
      }
      if (typing || modal) return;
      if (/^[1-5]$/.test(event.key) && primaryId) {
        rate(primaryId, Number(event.key));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, panelMode, primaryId, selectingCache]);

  function applyPreset(next: LayoutPreset) {
    setPreset(next);
    setPanelCollapsed(false);
    if (next === "inspect") setPanelMode("docked");
    else setPanelMode("hidden");
    if (next === "map") setViewMode("map");
  }

  function chooseView(mode: ViewMode) {
    setViewMode(mode);
  }

  function openPreferences() {
    setSelectingCache(false);
    setModal("preferences");
  }

  function beginCacheSelect() {
    setSelectingCache(true);
    setModal(null);
    setViewMode("map");
    setPanelMode("hidden");
    if (preset === "compare") setPreset("browse");
  }

  function finishCacheSelect(bounds: GeoBounds) {
    setCacheBounds(bounds);
    setSelectingCache(false);
    setModal("preferences");
  }

  function cancelCacheSelect() {
    setSelectingCache(false);
    setModal("preferences");
  }

  function revealMapGrid() {
    setPreset("map");
    setPanelMode("hidden");
    setPanelCollapsed(false);
  }

  function applyRegion(bounds: GeoBounds) {
    setFilters((current) => {
      const withoutCluster = current.filter((filter) => filter.kind !== "cluster");
      return upsertFilter(withoutCluster, { kind: "region", ...bounds });
    });
    revealMapGrid();
  }

  function applyCluster(ids: string[], label: string) {
    setFilters((current) => {
      const withoutRegion = current.filter((filter) => filter.kind !== "region");
      return upsertFilter(withoutRegion, { kind: "cluster", ids, label });
    });
    revealMapGrid();
  }

  function applyAction(action: StudioAction) {
    switch (action) {
      case "add-media":
        setModal("add");
        break;
      case "batch-export":
        setModal("export");
        break;
      case "index-status":
        setIndexOpen(true);
        inputRef.current?.blur();
        break;
      case "preset-browse":
        applyPreset("browse");
        break;
      case "preset-inspect":
        applyPreset("inspect");
        break;
      case "preset-compare":
        applyPreset("compare");
        break;
      case "preset-map":
        applyPreset("map");
        break;
      case "view-compact":
        chooseView("compact");
        break;
      case "view-cards":
        chooseView("cards");
        break;
      case "view-timeline":
        chooseView("timeline");
        break;
      case "view-map":
        chooseView("map");
        break;
      case "preferences":
        openPreferences();
        break;
      case "toggle-inspector":
        setPanelMode((current) => (current === "hidden" ? "docked" : "hidden"));
        break;
      case "clear-filters":
        setFilters([]);
        break;
    }
  }

  function applySuggestion(suggestion: Suggestion) {
    if (suggestion.type === "action") {
      if (suggestion.action === "index-status") {
        document.getElementById("ai-index-toggle")?.click();
      }
      applyAction(suggestion.action);
    } else {
      setFilters((current) => suggestion.filters.reduce(upsertFilter, current));
    }
    setQuery("");
  }

  function submitQuery() {
    const parsed = parseQuery(query);
    if (parsed.length === 0) return;
    setFilters((current) => parsed.reduce(upsertFilter, current));
    setQuery("");
  }

  function openItem(id: string) {
    setPrimaryId(id);
    setSelectedIds((current) => (current.includes(id) ? current : [id]));
    if (preset === "inspect") setPanelMode("docked");
  }

  function toggleItem(id: string) {
    setPrimaryId(id);
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function rate(id: string, rating: number | null) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, rating } : item)));
    setPrimaryId(id);
  }

  function flag(id: string) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, flag: nextFlag(item.flag) } : item)),
    );
    setPrimaryId(id);
  }

  function addMedia(folder: string, format: MediaFormat) {
    const created = inventItems(folder, format);
    setItems((current) => [...created, ...current]);
    setModal(null);
    applyPreset("browse");
    setPrimaryId(created[0]?.id ?? null);
    setSelectedIds(created.map((item) => item.id));
    runScan(`Reading ${folder}`);
  }

  function exportSelection(format: string, destination: string) {
    const count = selectedIds.length > 0 ? selectedIds.length : visible.length;
    setModal(null);
    setTelemetry((current) => ({
      ...current,
      exportLabel: `Export queued · ${count} · ${format} · ${destination}`,
    }));
  }

  function runScan(label: string) {
    if (scanTimer.current != null) window.clearInterval(scanTimer.current);
    let step = 0;
    setTelemetry((current) => ({
      ...current,
      scanLabel: label,
      scanProgress: 0.08,
      syncLabel: "SQLite · writing",
    }));
    scanTimer.current = window.setInterval(() => {
      step += 1;
      const progress = Math.min(1, step / 10);
      setTelemetry((current) => ({
        ...current,
        scanLabel: progress < 1 ? label : "Idle · catalog ready",
        scanProgress: progress < 1 ? progress : 1,
        syncLabel: progress < 1 ? "SQLite · writing" : "SQLite · ready",
      }));
      if (progress >= 1 && scanTimer.current != null) {
        window.clearInterval(scanTimer.current);
        scanTimer.current = null;
        window.setTimeout(() => {
          setTelemetry((current) => ({ ...current, scanProgress: null }));
        }, 700);
      }
    }, 140);
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-studio text-foam">
      <TopBar
        query={query}
        onQuery={setQuery}
        suggestions={palette}
        filters={filters}
        onRemoveFilter={(id) => setFilters((current) => current.filter((filter) => filter.id !== id))}
        onApplySuggestion={applySuggestion}
        onSubmitQuery={submitQuery}
        preset={preset}
        onPreset={applyPreset}
        onAdd={() => setModal("add")}
        onExport={() => setModal("export")}
        indexOpen={indexOpen}
        onIndexOpen={setIndexOpen}
        onPreferences={openPreferences}
        inputRef={inputRef}
      />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {preset === "compare" ? (
          <ComparePane pair={comparePair} onClear={() => setSelectedIds([])} />
        ) : preset === "map" && viewMode === "map" ? (
          <MediaStage
            items={visible}
            total={items.length}
            viewMode={viewMode}
            onViewMode={chooseView}
            selectedIds={selectedIds}
            primaryId={primaryId}
            onOpen={openItem}
            onToggle={toggleItem}
            onRate={rate}
            onFlag={flag}
            onClearFilters={() => setFilters([])}
            filteredEmpty={visible.length === 0}
            onShowInfo={() => {
              setPanelMode("docked");
              setPanelCollapsed(false);
            }}
            onRegion={applyRegion}
            onCluster={applyCluster}
            selectingCache={selectingCache}
            onCacheBounds={finishCacheSelect}
            onCancelCache={cancelCacheSelect}
          />
        ) : preset === "map" ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <MediaMap
              items={visible}
              primaryId={primaryId}
              onOpen={openItem}
              onRegion={applyRegion}
              onCluster={applyCluster}
              selectingCache={selectingCache}
              onCacheBounds={finishCacheSelect}
              onCancelCache={cancelCacheSelect}
              className="min-h-[220px] flex-[1.4]"
            />
            <MediaStage
              className={
                viewMode === "map"
                  ? "shrink-0 border-t border-line"
                  : "min-h-0 flex-1 border-t border-line"
              }
              items={visible}
              total={items.length}
              viewMode={viewMode}
              onViewMode={chooseView}
              selectedIds={selectedIds}
              primaryId={primaryId}
              onOpen={openItem}
              onToggle={toggleItem}
              onRate={rate}
              onFlag={flag}
              onClearFilters={() => setFilters([])}
              filteredEmpty={visible.length === 0}
              onShowInfo={() => {
                setPanelMode("docked");
                setPanelCollapsed(false);
              }}
              onRegion={applyRegion}
              onCluster={applyCluster}
              mapDocked
            />
          </div>
        ) : (
          <MediaStage
            items={visible}
            total={items.length}
            viewMode={viewMode}
            onViewMode={chooseView}
            selectedIds={selectedIds}
            primaryId={primaryId}
            onOpen={openItem}
            onToggle={toggleItem}
            onRate={rate}
            onFlag={flag}
            onClearFilters={() => setFilters([])}
            filteredEmpty={visible.length === 0}
            onShowInfo={() => {
              setPanelMode("docked");
              setPanelCollapsed(false);
            }}
            onRegion={applyRegion}
            onCluster={applyCluster}
            selectingCache={selectingCache}
            onCacheBounds={finishCacheSelect}
            onCancelCache={cancelCacheSelect}
          />
        )}
        {panelMode === "docked" ? (
          <InspectorPanel
            item={primary}
            mode="docked"
            collapsed={panelCollapsed}
            position={panelPosition}
            onPosition={setPanelPosition}
            onCollapse={() => setPanelCollapsed((current) => !current)}
            onMode={setPanelMode}
            onRate={(rating) => {
              if (primary) rate(primary.id, rating);
            }}
          />
        ) : null}
      </div>

      {panelMode === "floating" ? (
        <InspectorPanel
          item={primary}
          mode="floating"
          collapsed={panelCollapsed}
          position={panelPosition}
          onPosition={setPanelPosition}
          onCollapse={() => setPanelCollapsed((current) => !current)}
          onMode={setPanelMode}
          onRate={(rating) => {
            if (primary) rate(primary.id, rating);
          }}
        />
      ) : null}

      <TelemetryBar telemetry={telemetry} onPreferences={openPreferences} />

      {modal === "add" ? <AddMediaModal onClose={() => setModal(null)} onAdd={addMedia} /> : null}
      {modal === "preferences" ? (
        <PreferencesModal
          onClose={() => setModal(null)}
          maxZoom={cacheZoom}
          onMaxZoom={setCacheZoom}
          bounds={cacheBounds}
          onSelectArea={beginCacheSelect}
        />
      ) : null}
      {modal === "export" ? (
        <BatchExportModal
          count={selectedIds.length}
          onClose={() => setModal(null)}
          onExport={exportSelection}
        />
      ) : null}
    </div>
  );
}
