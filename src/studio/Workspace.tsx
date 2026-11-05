import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  deleteFromDisk,
  desktopBridgeAvailable,
  errorMessage,
  logSearch,
  fetchInsights,
  fetchLibrary,
  indexPaths,
  searchEmbeddings,
  mergePeople,
  pickImportPaths,
  removeFromLibrary,
  renamePerson,
  setFlags,
  splitFace,
} from "../lib/api";
import type { MediaKind, MediaRecord } from "../lib/types";
import { AddMediaModal, Modal } from "../components/drawers/AddMediaModal";
import { BatchExportModal } from "../components/drawers/BatchExportModal";
import { PreferencesModal } from "../components/drawers/PreferencesModal";
import { InspectorPanel } from "../components/panels/InspectorPanel";
import { TopBar } from "../components/shell/TopBar";
import { TelemetryBar } from "../components/shell/TelemetryBar";
import { ComparePane } from "../components/workspace/ComparePane";
import { Lightbox } from "../components/workspace/Lightbox";
import { MediaStage } from "../components/workspace/MediaStage";
import { PeopleBoard } from "../components/workspace/PeopleBoard";
import { SelectionBar } from "../components/workspace/SelectionBar";
import { captureMillis, createCatalog, itemFromRecord, mergeItems, nextFlag } from "./catalog";
import { itemsFromFiles } from "./previews";
import { clampGridZoom, readGridZoom, writeGridZoom } from "./gridZoom";
import { applyInsights, mergeFaces, moveFace, numericSuffix, renameFaces } from "./insights";
import { applySelection, type PointerMods } from "./selection";
import type { MapZoom } from "./mapRegions";
import { applySearchMode, filterLabel, matchesFilters, parseQuery, suggestions, upsertFilter } from "./query";
import type {
  ActiveFilter,
  GeoBounds,
  FlagStatus,
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
  const [aiSearch, setAiSearch] = useState(storedAiSearch);
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
  const [selectMode, setSelectMode] = useState(false);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [lightboxMotion, setLightboxMotion] = useState<"open" | "next" | "prev">("open");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const anchorRef = useRef<string | null>(null);
  const jobToken = useRef(0);
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [cacheZoom, setCacheZoom] = useState<MapZoom>(12);
  const [cacheBounds, setCacheBounds] = useState<GeoBounds | null>(null);
  const [selectingCache, setSelectingCache] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
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
  const palette = useMemo(() => suggestions(query, items, aiSearch), [query, items, aiSearch]);
  const primary = items.find((item) => item.id === primaryId) ?? null;
  const lightboxItem = visible.find((item) => item.id === lightboxId) ?? null;
  const comparePair: [StudioItem | null, StudioItem | null] = [
    items.find((item) => item.id === selectedIds[0]) ?? null,
    items.find((item) => item.id === selectedIds[1]) ?? null,
  ];

  useEffect(() => {
    if (!desktopBridgeAvailable()) return;
    let cancel = false;
    void fetchLibrary()
      .then(async ({ media }) => {
        if (cancel || media.length === 0) return;
        const snapshot = await fetchInsights().catch(() => null);
        if (cancel) return;
        setItems((current) => {
          const merged = mergeItems(media.map(presentRecord), current);
          return snapshot ? applyInsights(merged, snapshot) : merged;
        });
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
    if (!desktopBridgeAvailable()) return;
    let stop: (() => void) | undefined;
    let cancel = false;
    void listen<JobProgress>("library-progress", (event) => {
      const job = event.payload;
      if (job.phase === "done") {
        void fetchInsights()
          .then((snapshot) => {
            setItems((current) => applyInsights(current, snapshot));
          })
          .catch(() => undefined);
        const token = jobToken.current;
        setTelemetry((current) => ({
          ...current,
          scanLabel: job.label,
          scanProgress: 1,
          syncLabel: "SQLite · ready",
        }));
        window.setTimeout(() => {
          if (jobToken.current !== token) return;
          setTelemetry((current) => ({
            ...current,
            scanLabel: "Idle · catalog ready",
            scanProgress: null,
          }));
          setImportMessage(null);
          setImportBusy(false);
        }, 1200);
        return;
      }
      const ratio = job.total > 0 ? Math.min(1, job.done / job.total) : 0;
      const percent = Math.round(ratio * 100);
      setTelemetry((current) => ({
        ...current,
        scanLabel: job.total > 0 ? `${job.label} · ${job.done} of ${job.total}` : job.label,
        scanProgress: ratio,
        syncLabel: "SQLite · writing",
      }));
      setImportMessage(job.total > 0 ? `${job.label} · ${percent}%` : job.label);
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
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "a") {
        if (typing || modal || confirmDelete || lightboxId || viewMode === "map" || viewMode === "people" || preset === "compare") return;
        event.preventDefault();
        const ids = visible.map((item) => item.id);
        setSelectedIds(ids);
        if (ids[0]) {
          anchorRef.current = ids[0];
          setPrimaryId((current) => current ?? ids[0]);
        }
        return;
      }
      if (event.key === "Escape") {
        if (selectingCache) return;
        if (lightboxId) {
          event.preventDefault();
          closeLightbox();
          return;
        }
        if (confirmDelete) {
          setConfirmDelete(false);
          return;
        }
        if (modal) {
          setModal(null);
          return;
        }
        if (typing) return;
        if (selectedIds.length > 0) {
          setSelectedIds([]);
          return;
        }
        if (panelMode === "floating") setPanelMode("hidden");
        return;
      }
      if (typing || modal || confirmDelete) return;
      if (lightboxId) {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          stepLightbox(1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          stepLightbox(-1);
        } else if (/^[1-5]$/.test(event.key)) {
          rate(lightboxId, Number(event.key));
        }
        return;
      }
      if (/^[1-5]$/.test(event.key) && primaryId) {
        rate(primaryId, Number(event.key));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete, lightboxId, modal, panelMode, preset, primaryId, selectedIds, selectingCache, viewMode, visible]);

  useEffect(() => {
    if (lightboxId && !visible.some((item) => item.id === lightboxId)) setLightboxId(null);
  }, [lightboxId, visible]);

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
      case "view-people":
        setInsightsOpen(true);
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
      if (aiSearch && desktopBridgeAvailable()) {
        const typed = query.trim();
        void runEmbeddingSearch(typed || suggestion.label);
        return;
      }
      setFilters((current) => suggestion.filters.reduce(upsertFilter, current));
      if (viewMode === "people") chooseView("compact");
      void logSearch(
        aiSearch,
        suggestion.label,
        suggestion.filters.map((filter) => filterLabel({ ...filter, id: "logged" })).join(", "),
      );
    }
    setQuery("");
  }

  function submitQuery() {
    if (aiSearch && desktopBridgeAvailable()) {
      void runEmbeddingSearch(query);
      return;
    }
    const parsed = parseQuery(query, items, aiSearch);
    if (parsed.length === 0) {
      void logSearch(aiSearch, query, "no filter");
      return;
    }
    setFilters((current) => parsed.reduce(upsertFilter, current));
    void logSearch(
      aiSearch,
      query,
      parsed.map((filter) => filterLabel({ ...filter, id: "logged" })).join(", "),
    );
    setQuery("");
    if (viewMode === "people") chooseView("compact");
  }

  async function runEmbeddingSearch(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setQuery("");
    const parsed = parseQuery(trimmed, items, true);
    const structured = parsed.filter(
      (filter) => filter.kind !== "subject" && filter.kind !== "person" && filter.kind !== "text",
    );
    try {
      const hits = await searchEmbeddings(trimmed);
      const visual = {
        kind: "visual" as const,
        ids: hits.map((hit) => `library-${hit.mediaId}`),
        label: `AI “${trimmed}”`,
      };
      setFilters((current) => {
        const kept = current.filter(
          (filter) =>
            filter.kind !== "visual" &&
            filter.kind !== "subject" &&
            filter.kind !== "text" &&
            filter.kind !== "person",
        );
        return [...structured, visual].reduce(upsertFilter, kept);
      });
      void logSearch(true, trimmed, hits.length === 0 ? "no embedding match" : `${hits.length} embedding matches`);
      const snapshot = await fetchInsights().catch(() => null);
      if (snapshot) setItems((current) => applyInsights(current, snapshot));
    } catch {
      setFilters((current) => parsed.reduce(upsertFilter, current));
      void logSearch(true, trimmed, "embedding search unavailable, using stored tags");
    }
    if (viewMode === "people") chooseView("compact");
  }

  function changeAiSearch(next: boolean) {
    setAiSearch(next);
    try {
      localStorage.setItem("shelf-ai-search", next ? "1" : "0");
    } catch {
      // The choice still applies for this visit when storage is blocked.
    }
    if (!next) {
      const nextFilters = applySearchMode(filters, false, items);
      setFilters(nextFilters);
      void logSearch(false, query, nextFilters.map((filter) => filterLabel(filter)).join(", ") || "file names and paths");
      return;
    }
    const words = filters.flatMap((filter) => {
      if (filter.kind === "subject" || filter.kind === "text") return [filter.value];
      if (filter.kind === "person") return [filter.name];
      if (filter.kind === "visual") return [filter.label];
      return [];
    });
    const text = [query, ...words].map((word) => word.trim()).filter(Boolean).join(" ");
    if (desktopBridgeAvailable() && text) {
      void runEmbeddingSearch(text);
      return;
    }
    const nextFilters = applySearchMode(filters, true, items);
    setFilters(nextFilters);
    void logSearch(true, query, nextFilters.map((filter) => filterLabel(filter)).join(", ") || "visual tags");
  }

  function openItem(id: string) {
    setPrimaryId(id);
    setSelectedIds((current) => (current.includes(id) ? current : [id]));
    if (preset === "inspect") setPanelMode("docked");
  }

  function viewItem(id: string) {
    setPrimaryId(id);
    anchorRef.current = id;
    setSelectedIds([id]);
    setLightboxMotion("open");
    setLightboxId(id);
  }

  function closeLightbox() {
    const id = lightboxId;
    if (!id) return;
    setLightboxId(null);
    requestAnimationFrame(() => {
      const card = document.getElementById(`frame-${id}`);
      card?.scrollIntoView({ block: "nearest", inline: "nearest" });
      card?.querySelector<HTMLElement>("[data-open-frame]")?.focus({ preventScroll: true });
    });
  }

  function stepLightbox(delta: number) {
    const index = visible.findIndex((item) => item.id === lightboxId);
    const next = visible[index + delta];
    if (!next) return;
    setLightboxMotion(delta > 0 ? "next" : "prev");
    setLightboxId(next.id);
    setPrimaryId(next.id);
    anchorRef.current = next.id;
    setSelectedIds([next.id]);
  }

  function toggleItem(id: string) {
    setPrimaryId(id);
    anchorRef.current = id;
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

  function selectItem(id: string, mods: PointerMods) {
    setPrimaryId(id);
    setSelectedIds((current) => {
      const result = applySelection(
        current,
        visible.map((item) => item.id),
        anchorRef.current,
        id,
        mods,
        selectMode,
      );
      anchorRef.current = result.anchor;
      return result.selected;
    });
  }

  function selectVisible() {
    setSelectMode(true);
    const ids = visible.map((item) => item.id);
    setSelectedIds(ids);
    if (ids[0]) anchorRef.current = ids[0];
  }

  async function flagSelection(flag: FlagStatus) {
    const chosen = new Set(selectedIds);
    setItems((current) => current.map((item) => (chosen.has(item.id) ? { ...item, flag } : item)));
    const paths = items
      .filter((item) => chosen.has(item.id) && item.sourcePath)
      .map((item) => item.sourcePath as string);
    if (!desktopBridgeAvailable() || paths.length === 0) return;
    try {
      await setFlags(paths, flag === "unflagged" ? null : flag);
    } catch (error) {
      setTelemetry((current) => ({ ...current, scanLabel: errorMessage(error) }));
    }
  }

  async function removeSelected() {
    const drop = new Set(selectedIds);
    const paths = items
      .filter((item) => drop.has(item.id) && item.sourcePath)
      .map((item) => item.sourcePath as string);
    if (desktopBridgeAvailable() && paths.length > 0) {
      try {
        await removeFromLibrary(paths);
      } catch (error) {
        setTelemetry((current) => ({ ...current, scanLabel: errorMessage(error) }));
        return;
      }
    }
    setItems((current) => current.filter((item) => !drop.has(item.id)));
    setSelectedIds([]);
    setPrimaryId((current) => (current && drop.has(current) ? null : current));
  }

  async function deleteSelected() {
    const chosen = items.filter((item) => selectedIds.includes(item.id) && item.sourcePath);
    const paths = chosen.map((item) => item.sourcePath as string);
    setConfirmDelete(false);
    if (!desktopBridgeAvailable() || paths.length === 0) return;
    try {
      const report = await deleteFromDisk(paths);
      const removed = new Set(chosen.map((item) => item.id));
      setItems((current) => current.filter((item) => !removed.has(item.id)));
      setSelectedIds([]);
      setPrimaryId((current) => (current && removed.has(current) ? null : current));
      if (report.failed.length > 0) {
        setTelemetry((current) => ({ ...current, scanLabel: report.failed[0] ?? "Some files stayed on disk" }));
      }
    } catch (error) {
      setTelemetry((current) => ({ ...current, scanLabel: errorMessage(error) }));
    }
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
    }
    setImportError(null);
    setModal(null);
    applyPreset("browse");
    setTelemetry((current) => ({
      ...current,
      syncLabel: desktopBridgeAvailable() ? "SQLite · ready" : "Browser preview",
      scanLabel: label,
    }));
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
    jobToken.current += 1;
    setImportMessage(`Indexing ${folderName} · 0%`);
    setTelemetry((current) => ({
      ...current,
      scanLabel: `Indexing ${folderName}`,
      scanProgress: 0,
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
        setImportBusy(false);
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
    const token = (jobToken.current += 1);
    setImportBusy(true);
    setImportError(null);
    setImportMessage("Reading files · 0%");
    setTelemetry((current) => ({
      ...current,
      scanLabel: "Reading files",
      scanProgress: 0,
      syncLabel: "Browser preview",
    }));
    try {
      const imported = await itemsFromFiles(files, (done, total) => {
        if (jobToken.current !== token) return;
        const ratio = total > 0 ? done / total : 0;
        const percent = Math.round(ratio * 100);
        setTelemetry((current) => ({
          ...current,
          scanLabel: `Reading files · ${done} of ${total}`,
          scanProgress: ratio,
        }));
        setImportMessage(`Reading files · ${percent}%`);
      });
      if (imported.length === 0) {
        setImportError("No photos or videos were found in that selection.");
        setImportMessage(null);
        setTelemetry((current) => ({
          ...current,
          scanLabel: "Idle · catalog ready",
          scanProgress: null,
        }));
        return;
      }
      revealImported(imported, `Added ${imported.length} ${imported.length === 1 ? "frame" : "frames"}`);
      setTelemetry((current) => ({ ...current, scanProgress: 1 }));
      window.setTimeout(() => {
        if (jobToken.current !== token) return;
        setTelemetry((current) => ({
          ...current,
          scanLabel: "Idle · catalog ready",
          scanProgress: null,
        }));
        setImportMessage(null);
      }, 1200);
    } finally {
      setImportBusy(false);
    }
  }

  function renameCluster(personId: string, name: string) {
    setItems((current) => renameFaces(current, personId, name));
    const id = numericSuffix(personId, "person-");
    if (id != null && desktopBridgeAvailable()) {
      void renamePerson(id, name.trim() || null).catch(() => undefined);
    }
  }

  function mergeClusters(keepId: string, dropId: string) {
    setItems((current) => mergeFaces(current, keepId, dropId));
    const keep = numericSuffix(keepId, "person-");
    const drop = numericSuffix(dropId, "person-");
    if (keep != null && drop != null && desktopBridgeAvailable()) {
      void mergePeople(keep, drop).catch(() => undefined);
    }
  }

  function splitClusterFace(faceId: string) {
    const face = numericSuffix(faceId, "face-");
    if (face != null && desktopBridgeAvailable()) {
      void splitFace(face)
        .then((id) => {
          setItems((current) => moveFace(current, faceId, `person-${id}`));
        })
        .catch(() => undefined);
      return;
    }
    setItems((current) => moveFace(current, faceId, `person-local-${Date.now()}`));
  }

  function showSubject(label: string) {
    setFilters((current) => upsertFilter(current, { kind: "subject", value: label }));
    chooseView("compact");
    setInsightsOpen(false);
  }

  function showPerson(personId: string, name: string) {
    setFilters((current) => upsertFilter(current, { kind: "person", personId, name }));
    chooseView("compact");
    setInsightsOpen(false);
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
    <div className="relative flex h-dvh flex-col overflow-hidden bg-studio text-foam">
      <TopBar
        query={query}
        onQuery={setQuery}
        aiSearch={aiSearch}
        onAiSearch={changeAiSearch}
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
        items={items}
        insightsOpen={insightsOpen}
        onInsightsOpen={setInsightsOpen}
        onInsightSubject={showSubject}
        onInsightPerson={showPerson}
        onRenamePerson={renameCluster}
        onMergePeople={mergeClusters}
        onSplitFace={splitClusterFace}
      />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {preset === "compare" ? (
          <ComparePane pair={comparePair} onClear={() => setSelectedIds([])} />
        ) : viewMode === "people" ? (
          <PeopleBoard
            items={visible}
            onRename={renameCluster}
            onMerge={mergeClusters}
            onSplit={splitClusterFace}
            onOpen={(item) => viewItem(item.id)}
            onSubject={showSubject}
          />
        ) : (
          <MediaStage
            items={visible}
            total={items.length}
            viewMode={viewMode}
            gridZoom={gridZoom}
            selectedIds={selectedIds}
            primaryId={primaryId}
            onOpen={openItem}
            onView={viewItem}
            selectMode={selectMode}
            onSelectMode={setSelectMode}
            onSelect={selectItem}
            onSelectVisible={selectVisible}
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

      {selectedIds.length > 0 && !lightboxId ? (
        <SelectionBar
          count={selectedIds.length}
          canDelete={desktopBridgeAvailable() && items.some((item) => selectedIds.includes(item.id) && item.sourcePath)}
          onFlag={(flag) => void flagSelection(flag)}
          onRemove={() => void removeSelected()}
          onDelete={() => setConfirmDelete(true)}
          onClear={() => setSelectedIds([])}
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
          progress={importBusy ? telemetry.scanProgress : null}
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
      {confirmDelete ? (
        <Modal title="Delete from disk" onClose={() => setConfirmDelete(false)}>
          <p className="text-sm text-mute">
            Permanently delete{" "}
            {items.filter((item) => selectedIds.includes(item.id) && item.sourcePath).length} files from disk? Shelf
            drops those catalog rows too. The originals cannot be restored.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-full px-3 py-2 text-sm text-mute">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void deleteSelected()}
              className="rounded-full bg-danger px-3 py-2 text-sm text-white"
            >
              Delete files
            </button>
          </div>
        </Modal>
      ) : null}
      {modal === "export" ? (
        <BatchExportModal
          count={selectedIds.length}
          onClose={() => setModal(null)}
          onExport={exportSelection}
        />
      ) : null}
      {lightboxItem ? (
        <Lightbox
          item={lightboxItem}
          index={Math.max(0, visible.findIndex((item) => item.id === lightboxItem.id))}
          count={visible.length}
          direction={lightboxMotion}
          onClose={closeLightbox}
          onPrev={() => stepLightbox(-1)}
          onNext={() => stepLightbox(1)}
          onRate={(rating) => rate(lightboxItem.id, rating)}
        />
      ) : null}
    </div>
  );
}

type JobProgress = {
  phase: string;
  done: number;
  total: number;
  label: string;
};

type ThumbnailReady = {
  id: number;
  filePath: string;
  thumbnailPath: string;
  mediaKind: MediaKind;
};

function storedAiSearch(): boolean {
  try {
    return localStorage.getItem("shelf-ai-search") !== "0";
  } catch {
    return true;
  }
}

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
