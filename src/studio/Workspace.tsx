import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { desktopBridgeAvailable, errorMessage, fetchLibrary, indexPaths, pickImportPaths } from "../lib/api";
import type { MediaKind, MediaRecord } from "../lib/types";
import { AddMediaModal } from "../components/drawers/AddMediaModal";
import { BatchExportModal } from "../components/drawers/BatchExportModal";
import { PreferencesModal } from "../components/drawers/PreferencesModal";
import { InspectorPanel } from "../components/panels/InspectorPanel";
import { TopBar } from "../components/shell/TopBar";
import { TelemetryBar } from "../components/shell/TelemetryBar";
import { ComparePane } from "../components/workspace/ComparePane";
import { MediaStage } from "../components/workspace/MediaStage";
import { captureMillis, createCatalog, itemFromRecord, mergeItems, nextFlag } from "./catalog";
import { itemsFromFiles } from "./previews";
import { clampGridZoom, readGridZoom, writeGridZoom } from "./gridZoom";
import type { MapZoom } from "./mapRegions";
import { matchesFilters, parseQuery, suggestions, upsertFilter } from "./query";
import type {
  ActiveFilter,
  GeoBounds,
  LayoutPreset,
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
  const [items, setItems] = useState<StudioItem[]>(() => createCatalog());
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("compact");
  const [gridZoom, setGridZoom] = useState(readGridZoom);
  const [preset, setPreset] = useState<LayoutPreset>("browse");
  const [panelMode, setPanelMode] = useState<PanelMode>("hidden");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ x: 64, y: 72 });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [modal, setModal] = useState<"add" | "export" | "preferences" | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [cacheZoom, setCacheZoom] = useState<MapZoom>(12);
  const [cacheBounds, setCacheBounds] = useState<GeoBounds | null>(null);
  const [selectingCache, setSelectingCache] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry>(INITIAL_TELEMETRY);

  const visible = useMemo(
    () =>
      items
        .filter((item) => matchesFilters(item, filters))
        .sort(
          (left, right) =>
            captureMillis(right.capturedAt) - captureMillis(left.capturedAt) ||
            left.fileName.localeCompare(right.fileName),
        ),
    [items, filters],
  );
  const palette = useMemo(() => suggestions(query, items), [query, items]);
  const primary = items.find((item) => item.id === primaryId) ?? null;
  const comparePair: [StudioItem | null, StudioItem | null] = [
    items.find((item) => item.id === selectedIds[0]) ?? null,
    items.find((item) => item.id === selectedIds[1]) ?? null,
  ];

  useEffect(() => {
    if (!desktopBridgeAvailable()) return;
    let cancel = false;
    void fetchLibrary()
      .then(({ media }) => {
        if (cancel || media.length === 0) return;
        setItems((current) => mergeItems(media.map(presentRecord), current));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!desktopBridgeAvailable()) return;
    let stop: (() => void) | undefined;
    let cancel = false;
    void listen<ThumbnailReady>("thumbnail-ready", (event) => {
      const ready = event.payload;
      setItems((current) =>
        current.map((item) =>
          item.id === `library-${ready.id}`
            ? withPreview(item, ready.filePath, ready.thumbnailPath, ready.mediaKind)
            : item,
        ),
      );
    }).then((unlisten) => {
      if (cancel) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancel = true;
      stop?.();
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
    if (next === "inspect") {
      setPanelMode("docked");
      setViewMode((mode) => (mode === "map" ? "compact" : mode));
    } else if (next === "map") {
      setPanelMode("hidden");
      setViewMode("map");
    } else {
      setPanelMode("hidden");
      if (next === "browse") setViewMode((mode) => (mode === "map" ? "compact" : mode));
    }
  }

  function chooseView(mode: ViewMode) {
    setViewMode(mode);
    if (mode === "map") {
      setPreset("map");
      setPanelMode("hidden");
      return;
    }
    setPreset((current) => (current === "map" || current === "compare" ? "browse" : current));
  }

  function openAdd() {
    setImportError(null);
    setImportMessage(null);
    setModal("add");
  }

  function openPreferences() {
    setSelectingCache(false);
    setModal("preferences");
  }

  function beginCacheSelect() {
    setSelectingCache(true);
    setModal(null);
    setViewMode("map");
    setPreset("map");
    setPanelMode("hidden");
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
    setViewMode("map");
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
        openAdd();
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

  function inspectItem(id: string) {
    openItem(id);
    applyPreset("inspect");
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

  function revealImported(imported: StudioItem[], label: string) {
    if (imported.length === 0) {
      setImportError("No photos or videos were found.");
      setImportMessage(null);
      return;
    }
    const known = new Set(items.map((item) => item.id));
    const added = imported.filter((item) => !known.has(item.id));
    setItems((current) => mergeItems(imported, current));
    if (added.length > 0) {
      setPrimaryId(added[0]?.id ?? null);
      setSelectedIds(added.map((item) => item.id));
    }
    setImportError(null);
    setImportMessage(null);
    setModal(null);
    applyPreset("browse");
    setTelemetry((current) => ({
      ...current,
      scanLabel: label,
      scanProgress: 1,
      syncLabel: desktopBridgeAvailable() ? "SQLite · ready" : "Browser preview",
    }));
    window.setTimeout(() => {
      setTelemetry((current) => ({ ...current, scanProgress: null }));
    }, 700);
  }

  async function browseFolders() {
    setImportError(null);
    setImportMessage(null);
    try {
      const paths = await pickImportPaths();
      if (!paths) return;
      await ingestPaths(paths);
    } catch (error) {
      setImportError(errorMessage(error));
    }
  }

  async function ingestPaths(paths: string[]) {
    const folderName = paths[0]?.split(/[/\\]/).filter(Boolean).pop() ?? "folder";
    setImportBusy(true);
    setImportError(null);
    setImportMessage(`Indexing ${folderName}…`);
    setTelemetry((current) => ({
      ...current,
      scanLabel: `Indexing ${folderName}`,
      scanProgress: 0.35,
      syncLabel: "SQLite · writing",
    }));
    try {
      const report = await indexPaths(paths);
      if (report.discovered === 0) {
        setImportMessage(null);
        setImportError(report.errors[0] ?? "No photos or videos were found in that selection.");
        setTelemetry((current) => ({
          ...current,
          scanLabel: "Idle · catalog ready",
          scanProgress: null,
          syncLabel: "SQLite · ready",
        }));
        return;
      }
      const { media } = await fetchLibrary();
      revealImported(
        media.map(presentRecord),
        `Indexed ${report.indexed} · ${report.unchanged} already in the library`,
      );
    } catch (error) {
      setImportError(errorMessage(error));
      setImportMessage(null);
      setTelemetry((current) => ({
        ...current,
        scanLabel: "Idle · catalog ready",
        scanProgress: null,
        syncLabel: "SQLite · ready",
      }));
    } finally {
      setImportBusy(false);
    }
  }

  async function ingestFiles(files: File[]) {
    setImportBusy(true);
    setImportError(null);
    setImportMessage("Reading capture dates…");
    try {
      const imported = await itemsFromFiles(files);
      if (imported.length === 0) {
        setImportError("No photos or videos were found in that selection.");
        setImportMessage(null);
        return;
      }
      revealImported(imported, `Added ${imported.length} ${imported.length === 1 ? "frame" : "frames"}`);
    } finally {
      setImportBusy(false);
    }
  }

  function exportSelection(format: string, destination: string) {
    const count = selectedIds.length > 0 ? selectedIds.length : visible.length;
    setModal(null);
    setTelemetry((current) => ({
      ...current,
      exportLabel: `Export queued · ${count} · ${format} · ${destination}`,
    }));
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
        viewMode={viewMode}
        onViewMode={chooseView}
        preset={preset}
        onPreset={applyPreset}
        onAdd={openAdd}
        onExport={() => setModal("export")}
        indexOpen={indexOpen}
        onIndexOpen={setIndexOpen}
        onPreferences={openPreferences}
        inputRef={inputRef}
      />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {preset === "compare" ? (
          <ComparePane pair={comparePair} onClear={() => setSelectedIds([])} />
        ) : (
          <MediaStage
            items={visible}
            total={items.length}
            viewMode={viewMode}
            gridZoom={gridZoom}
            selectedIds={selectedIds}
            primaryId={primaryId}
            onOpen={openItem}
            onInspect={inspectItem}
            onToggle={toggleItem}
            onRate={rate}
            onFlag={flag}
            onClearFilters={() => setFilters([])}
            filteredEmpty={visible.length === 0}
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

      <TelemetryBar
        telemetry={telemetry}
        gridZoom={gridZoom}
        onGridZoom={(zoom) => {
          const next = clampGridZoom(zoom);
          setGridZoom(next);
          writeGridZoom(next);
        }}
        onPreferences={openPreferences}
      />

      {modal === "add" ? (
        <AddMediaModal
          onClose={() => {
            if (importBusy) return;
            setModal(null);
            setImportError(null);
            setImportMessage(null);
          }}
          busy={importBusy}
          message={importMessage}
          error={importError}
          onBrowse={() => void browseFolders()}
          onPaths={(paths) => void ingestPaths(paths)}
          onFiles={ingestFiles}
        />
      ) : null}
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

type ThumbnailReady = {
  id: number;
  filePath: string;
  thumbnailPath: string;
  mediaKind: MediaKind;
};

function presentRecord(record: MediaRecord): StudioItem {
  const item = itemFromRecord(record);
  if (!record.thumbnailPath || !desktopBridgeAvailable()) return item;
  return withPreview(item, record.filePath, record.thumbnailPath, record.mediaKind);
}

function withPreview(item: StudioItem, filePath: string, thumbnailPath: string, kind: MediaKind): StudioItem {
  const previewUrl = convertFileSrc(thumbnailPath);
  const inspectUrl = kind === "image" ? convertFileSrc(filePath) : previewUrl;
  return { ...item, previewUrl, inspectUrl };
}
