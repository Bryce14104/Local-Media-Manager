import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { mediaSrc } from "../lib/mediaSrc";
import {
  deleteFromDisk,
  desktopBridgeAvailable,
  errorMessage,
  logSearch,
  fetchConcepts,
  fetchInsights,
  fetchLibrary,
  indexPaths,
  searchEmbeddings,
  pickImportPaths,
  pickDirectory,
  removeFromLibrary,
  revealPath,
  setColor,
  setFlags,
  setKeywords,
  setNotes,
  setRating,
  setRotation,
  copyOriginals,
} from "../lib/api";
import type { ConceptIndex, MediaKind, MediaRecord } from "../lib/types";
import { AddMediaModal, Modal } from "../components/drawers/AddMediaModal";
import { BatchExportModal } from "../components/drawers/BatchExportModal";
import { PreferencesModal } from "../components/drawers/PreferencesModal";
import { InspectorPanel } from "../components/panels/InspectorPanel";
import { TopBar } from "../components/shell/TopBar";
import { TelemetryBar } from "../components/shell/TelemetryBar";
import { ComparePane } from "../components/workspace/ComparePane";
import { Lightbox } from "../components/workspace/Lightbox";
import { FilterRail } from "../components/workspace/FilterRail";
import { InsightsView } from "../components/workspace/InsightsView";
import { MediaStage } from "../components/workspace/MediaStage";
import { SelectionBar } from "../components/workspace/SelectionBar";
import { createCatalog, duplicateIds, itemFromRecord, mergeItems, nextFlag, sortItems } from "./catalog";
import { itemsFromFiles } from "./previews";
import { clampGridZoom, readGridZoom, writeGridZoom } from "./gridZoom";
import { applyInsights } from "./insights";
import { applySelection, type PointerMods } from "./selection";
import { readSlideshowSettings, writeSlideshowSettings, type SlideshowSettings } from "./slideshow";
import type { MapZoom } from "./mapRegions";
import { applySearchMode, filterLabel, matchesFilters, parseQuery, suggestions, upsertFilter } from "./query";
import type {
  ActiveFilter,
  GeoBounds,
  ColorLabel,
  FlagStatus,
  LayoutPreset,
  SortKey,
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
  pipeline: null,
};

export function Workspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const desktop = desktopBridgeAvailable();
  const [items, setItems] = useState<StudioItem[]>(() => (desktop ? [] : createCatalog()));
  const [query, setQuery] = useState("");
  const [aiSearch, setAiSearch] = useState(storedAiSearch);
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("compact");
  const [gridZoom, setGridZoom] = useState(readGridZoom);
  const [sort, setSort] = useState<SortKey>("captured");
  const [slideshow, setSlideshow] = useState(readSlideshowSettings);
  const [preset, setPreset] = useState<LayoutPreset>("browse");
  const [panelMode, setPanelMode] = useState<PanelMode>("hidden");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ x: 64, y: 72 });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [modal, setModal] = useState<"add" | "export" | "preferences" | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const lightboxIdRef = useRef<string | null>(null);
  lightboxIdRef.current = lightboxId;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const anchorRef = useRef<string | null>(null);
  const jobToken = useRef(0);
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [cacheZoom, setCacheZoom] = useState<MapZoom>(12);
  const [cacheBounds, setCacheBounds] = useState<GeoBounds | null>(null);
  const [selectingCache, setSelectingCache] = useState(false);
  const [conceptIndex, setConceptIndex] = useState<ConceptIndex | null>(null);
  const [conceptsLive, setConceptsLive] = useState(() => desktopBridgeAvailable());
  const [telemetry, setTelemetry] = useState<Telemetry>(INITIAL_TELEMETRY);

  const dupes = useMemo(() => duplicateIds(items), [items]);
  const resolvedFilters = useMemo(
    () =>
      filters.map((filter) =>
        filter.kind === "duplicates" ? { ...filter, ids: dupes } : filter,
      ),
    [dupes, filters],
  );
  const visible = useMemo(
    () => sortItems(items.filter((item) => matchesFilters(item, resolvedFilters)), sort),
    [items, resolvedFilters, sort],
  );
  const palette = useMemo(() => suggestions(query, items, aiSearch), [query, items, aiSearch]);
  const primary = items.find((item) => item.id === primaryId) ?? null;
  const lightboxPool = visible.some((item) => item.id === lightboxId) ? visible : items;
  const lightboxIndex = lightboxPool.findIndex((item) => item.id === lightboxId);
  const lightboxItem = lightboxIndex >= 0 ? (lightboxPool[lightboxIndex] ?? null) : null;
  const comparePair: [StudioItem | null, StudioItem | null] = [
    items.find((item) => item.id === selectedIds[0]) ?? null,
    items.find((item) => item.id === selectedIds[1]) ?? null,
  ];

  useEffect(() => {
    if (!desktopBridgeAvailable()) return;
    let cancel = false;
    void fetchLibrary()
      .then(async ({ media }) => {
        if (cancel) return;
        const [snapshot, concepts] = await Promise.all([
          fetchInsights().catch(() => null),
          fetchConcepts().catch(() => null),
        ]);
        if (cancel) return;
        if (concepts) {
          setConceptIndex(concepts);
          setConceptsLive(true);
        } else {
          setConceptsLive(false);
        }
        const library = media.map(presentRecord);
        setItems(snapshot ? applyInsights(library, snapshot) : library);
      })
      .catch(() => {
        if (!cancel) setConceptsLive(false);
      });
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
            ? withPreview(item, ready.thumbnailPath, ready.proxyPath, ready.playPath, ready.filePath)
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
        void fetchLibrary()
          .then(async ({ media }) => {
            const snapshot = await fetchInsights().catch(() => null);
            const library = media.map(presentRecord);
            setItems(snapshot ? applyInsights(library, snapshot) : library);
          })
          .catch(() => undefined);
        void fetchConcepts()
          .then((concepts) => {
            setConceptIndex(concepts);
            setConceptsLive(true);
          })
          .catch(() => setConceptsLive(false));
        const token = jobToken.current;
        setTelemetry((current) => ({
          ...current,
          scanLabel: job.label,
          scanProgress: 1,
          syncLabel: "SQLite · ready",
          pipeline: current.pipeline
            ? { phase: job.phase, label: job.label, done: job.done, total: Math.max(job.total, 1) }
            : null,
        }));
        window.setTimeout(() => {
          if (jobToken.current !== token) return;
          setTelemetry((current) => ({
            ...current,
            scanLabel: "Idle · catalog ready",
            scanProgress: null,
            pipeline: null,
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
        scanProgress: job.total > 0 ? ratio : null,
        syncLabel: "SQLite · writing",
        pipeline: { phase: job.phase, label: job.label, done: job.done, total: job.total },
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
        if (typing || modal || confirmDelete || lightboxId || viewMode === "map" || viewMode === "insights" || preset === "compare") return;
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
          if (document.fullscreenElement) {
            event.preventDefault();
            void document.exitFullscreen();
            return;
          }
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
      const focusId = lightboxId ?? primaryId;
      if (lightboxId) {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          stepLightbox(1);
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          stepLightbox(-1);
          return;
        }
      } else {
        if (event.key === "j" || event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          movePrimary(1);
        }
        if (event.key === "k" || event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          movePrimary(-1);
        }
        if (event.key === "Enter" && primaryId) {
          event.preventDefault();
          viewItem(primaryId);
        }
        if (event.key === "i") {
          event.preventDefault();
          setPanelMode((current) => (current === "hidden" ? "docked" : "hidden"));
        }
      }
      if (/^[1-5]$/.test(event.key) && focusId) {
        event.preventDefault();
        rate(focusId, Number(event.key));
      }
      if (event.key === "0" && focusId) {
        event.preventDefault();
        rate(focusId, null);
      }
      if ((event.key === "p" || event.key === "P") && focusId) {
        event.preventDefault();
        void applyFlag(focusId, "pick");
      }
      if ((event.key === "x" || event.key === "X") && focusId) {
        event.preventDefault();
        void applyFlag(focusId, "reject");
      }
      if ((event.key === "u" || event.key === "U") && focusId) {
        event.preventDefault();
        void applyFlag(focusId, "unflagged");
      }
      if ((event.key === "r" || event.key === "R") && focusId) {
        event.preventDefault();
        void rotateItem(focusId);
      }
      if (event.key === "6" && focusId) void colorItem(focusId, "red");
      if (event.key === "7" && focusId) void colorItem(focusId, "yellow");
      if (event.key === "8" && focusId) void colorItem(focusId, "green");
      if (event.key === "9" && focusId) void colorItem(focusId, "blue");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete, lightboxId, modal, panelMode, preset, primaryId, selectedIds, selectingCache, viewMode, visible]);

  useEffect(() => {
    if (lightboxId && !items.some((item) => item.id === lightboxId)) setLightboxId(null);
  }, [lightboxId, items]);

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
      case "view-timeline":
        chooseView("timeline");
        break;
      case "view-map":
        chooseView("map");
        break;
      case "view-people":
        chooseView("insights");
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
      case "slideshow":
        if (primaryId) viewItem(primaryId);
        break;
      case "rotate":
        if (primaryId) void rotateItem(primaryId);
        break;
    }
  }

  function applySuggestion(suggestion: Suggestion) {
    if (suggestion.type === "action") {
      applyAction(suggestion.action);
    } else {
      if (aiSearch) {
        const typed = query.trim();
        void runEmbeddingSearch(typed || suggestion.label);
        return;
      }
      setFilters((current) => suggestion.filters.reduce(upsertFilter, current));
      if (viewMode === "insights") chooseView("compact");
      void logSearch(
        aiSearch,
        suggestion.label,
        suggestion.filters.map((filter) => filterLabel({ ...filter, id: "logged" })).join(", "),
      );
    }
    setQuery("");
  }

  function submitQuery() {
    if (aiSearch) {
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
    if (viewMode === "insights") chooseView("compact");
  }

  async function runEmbeddingSearch(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setQuery("");
    if (!desktopBridgeAvailable()) {
      setFilters((current) =>
        upsertFilter(
          current.filter((filter) => filter.kind !== "subject" && filter.kind !== "text" && filter.kind !== "person"),
          { kind: "visual", ids: [], label: `AI “${trimmed}”` },
        ),
      );
      setTelemetry((current) => ({
        ...current,
        scanLabel: "AI search scores ONNX embeddings in the desktop app.",
      }));
      void logSearch(true, trimmed, "no ort session in this browser preview");
      return;
    }
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
      setTelemetry((current) => ({
        ...current,
        scanLabel: hits.length === 0 ? `No ONNX match for “${trimmed}”` : `ONNX matched ${hits.length}`,
      }));
      void logSearch(true, trimmed, hits.length === 0 ? "no embedding match" : `${hits.length} embedding matches`);
      const snapshot = await fetchInsights().catch(() => null);
      if (snapshot) setItems((current) => applyInsights(current, snapshot));
    } catch (error) {
      setFilters((current) =>
        upsertFilter(
          current.filter((filter) => filter.kind !== "subject" && filter.kind !== "text" && filter.kind !== "person"),
          { kind: "visual", ids: [], label: `AI “${trimmed}”` },
        ),
      );
      setTelemetry((current) => ({
        ...current,
        scanLabel: "ONNX search failed. The model did not return embeddings.",
      }));
      void logSearch(true, trimmed, errorMessage(error));
    }
    if (viewMode === "insights") chooseView("compact");
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
    lightboxIdRef.current = id;
    setLightboxId(id);
  }

  function closeLightbox() {
    const id = lightboxId;
    if (!id) return;
    lightboxIdRef.current = null;
    setLightboxId(null);
    requestAnimationFrame(() => {
      const card = document.getElementById(`frame-${id}`);
      card?.scrollIntoView({ block: "nearest", inline: "nearest" });
      card?.querySelector<HTMLElement>("[data-open-frame]")?.focus({ preventScroll: true });
    });
  }

  function stepLightbox(delta: number) {
    const id = lightboxIdRef.current;
    const pool = visible.some((item) => item.id === id) ? visible : items;
    const index = pool.findIndex((item) => item.id === id);
    const next = pool[index + delta];
    if (!next) return;
    lightboxIdRef.current = next.id;
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
    const path = items.find((item) => item.id === id)?.sourcePath;
    if (path && desktopBridgeAvailable()) {
      void setRating(path, rating).catch(() => undefined);
    }
  }

  function flag(id: string) {
    const current = items.find((item) => item.id === id);
    if (!current) return;
    void applyFlag(id, nextFlag(current.flag));
  }

  function applyFlag(id: string, next: FlagStatus) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, flag: next } : item)));
    setPrimaryId(id);
    const path = items.find((item) => item.id === id)?.sourcePath;
    if (path && desktopBridgeAvailable()) {
      void setFlags([path], next === "unflagged" ? null : next).catch(() => undefined);
    }
  }

  function rotateItem(id: string) {
    const current = items.find((item) => item.id === id);
    if (!current) return;
    const rotation = (current.rotation + 90) % 360;
    setItems((list) => list.map((item) => (item.id === id ? { ...item, rotation } : item)));
    if (current.sourcePath && desktopBridgeAvailable()) {
      void setRotation(current.sourcePath, rotation).catch(() => undefined);
    }
  }

  function colorItem(id: string, color: ColorLabel | null) {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, colorLabel: color } : item)));
    const path = items.find((item) => item.id === id)?.sourcePath;
    if (path && desktopBridgeAvailable()) {
      void setColor([path], color).catch(() => undefined);
    }
  }

  function movePrimary(delta: number) {
    if (visible.length === 0) return;
    const index = Math.max(0, visible.findIndex((item) => item.id === primaryId));
    const next = visible[(index + delta + visible.length) % visible.length];
    if (!next) return;
    setPrimaryId(next.id);
    anchorRef.current = next.id;
    setSelectedIds([next.id]);
  }

  function changeSlideshow(next: SlideshowSettings) {
    setSlideshow(next);
    writeSlideshowSettings(next);
  }

  async function exportCopies() {
    const paths = items
      .filter((item) => (selectedIds.length > 0 ? selectedIds.includes(item.id) : visible.some((row) => row.id === item.id)) && item.sourcePath)
      .map((item) => item.sourcePath as string);
    if (!desktopBridgeAvailable() || paths.length === 0) {
      setModal("export");
      return;
    }
    try {
      const destination = await pickDirectory("Export copies");
      if (!destination) return;
      const copied = await copyOriginals(paths, destination);
      setTelemetry((current) => ({ ...current, exportLabel: `Copied ${copied} originals to ${destination}` }));
    } catch (error) {
      setTelemetry((current) => ({ ...current, scanLabel: errorMessage(error) }));
    }
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
      pipeline: { phase: "index", label: "Indexing", done: 0, total: 0 },
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
          pipeline: null,
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
        pipeline: null,
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
      pipeline: { phase: "index", label: "Reading files", done: 0, total: files.length },
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
          pipeline: { phase: "index", label: "Reading files", done, total },
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
          pipeline: null,
        }));
        return;
      }
      revealImported(imported, `Added ${imported.length} ${imported.length === 1 ? "frame" : "frames"}`);
      setTelemetry((current) => ({
        ...current,
        scanProgress: 1,
        pipeline: { phase: "done", label: "Catalog ready", done: 1, total: 1 },
      }));
      window.setTimeout(() => {
        if (jobToken.current !== token) return;
        setTelemetry((current) => ({
          ...current,
          scanLabel: "Idle · catalog ready",
          scanProgress: null,
          pipeline: null,
        }));
        setImportMessage(null);
      }, 1200);
    } finally {
      setImportBusy(false);
    }
  }

  function showFrames(ids: string[], label: string) {
    setFilters((current) => upsertFilter(current.filter((filter) => filter.kind !== "region"), { kind: "cluster", ids, label }));
    chooseView("compact");
  }

  function showSubject(label: string) {
    setFilters((current) => upsertFilter(current, { kind: "subject", value: label }));
    chooseView("compact");
  }

  function saveNotes(id: string, notes: string) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, notes } : item)));
    const path = items.find((item) => item.id === id)?.sourcePath;
    if (path && desktopBridgeAvailable()) void setNotes(path, notes || null).catch(() => undefined);
  }

  function saveKeywords(id: string, keywords: string[]) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, keywords } : item)));
    const path = items.find((item) => item.id === id)?.sourcePath;
    if (path && desktopBridgeAvailable()) void setKeywords(path, keywords).catch(() => undefined);
  }

  function copyItemPath(item: StudioItem) {
    const path = item.sourcePath ?? `${item.folder}/${item.fileName}`;
    void navigator.clipboard?.writeText(path);
    setTelemetry((current) => ({ ...current, scanLabel: "Copied path" }));
  }

  function rateSelected(rating: number | null) {
    const chosen = new Set(selectedIds);
    setItems((current) => current.map((item) => (chosen.has(item.id) ? { ...item, rating } : item)));
    for (const item of items) {
      if (chosen.has(item.id) && item.sourcePath && desktopBridgeAvailable()) {
        void setRating(item.sourcePath, rating).catch(() => undefined);
      }
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
        onExport={() => void exportCopies()}
        onPreferences={openPreferences}
        inputRef={inputRef}
      />

      {viewMode !== "insights" && preset !== "compare" ? (
        <FilterRail sort={sort} onSort={setSort} />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {preset === "compare" ? (
          <ComparePane pair={comparePair} onClear={() => setSelectedIds([])} />
        ) : viewMode === "insights" ? (
          <InsightsView
            items={items}
            index={conceptsLive ? conceptIndex : null}
            pending={conceptsLive && conceptIndex == null}
            onOpen={(id) => viewItem(id)}
            onShowFrames={showFrames}
            onShowSubject={showSubject}
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
            onColor={(color) => primary && colorItem(primary.id, color)}
            onRotate={() => primary && rotateItem(primary.id)}
            onNotes={(notes) => primary && saveNotes(primary.id, notes)}
            onKeywords={(keywords) => primary && saveKeywords(primary.id, keywords)}
            onCopyPath={() => primary && copyItemPath(primary)}
            onReveal={() => primary?.sourcePath && void revealPath(primary.sourcePath).catch(() => undefined)}
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
          onColor={(color) => primary && colorItem(primary.id, color)}
          onRotate={() => primary && rotateItem(primary.id)}
          onNotes={(notes) => primary && saveNotes(primary.id, notes)}
          onKeywords={(keywords) => primary && saveKeywords(primary.id, keywords)}
          onCopyPath={() => primary && copyItemPath(primary)}
          onReveal={() => primary?.sourcePath && void revealPath(primary.sourcePath).catch(() => undefined)}
        />
      ) : null}

      {selectedIds.length > 0 && !lightboxId ? (
        <SelectionBar
          count={selectedIds.length}
          canDelete={desktopBridgeAvailable() && items.some((item) => selectedIds.includes(item.id) && item.sourcePath)}
          onFlag={(flag) => void flagSelection(flag)}
          onRate={(rating) => rateSelected(rating)}
          onRotate={() => selectedIds.forEach((id) => rotateItem(id))}
          onExport={() => void exportCopies()}
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
          slideshow={slideshow}
          onSlideshow={changeSlideshow}
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
          before={lightboxIndex > 0 ? (lightboxPool[lightboxIndex - 1] ?? null) : null}
          after={lightboxPool[lightboxIndex + 1] ?? null}
          index={Math.max(0, lightboxIndex)}
          count={lightboxPool.length}
          onClose={closeLightbox}
          onPrev={() => stepLightbox(-1)}
          onNext={() => stepLightbox(1)}
          strip={lightboxPool.slice(Math.max(0, lightboxIndex - 8), lightboxIndex + 9)}
          onJump={(id) => {
            setLightboxId(id);
            setPrimaryId(id);
          }}
          onRotate={() => rotateItem(lightboxItem.id)}
          onCopyPath={() => copyItemPath(lightboxItem)}
          onReveal={() =>
            lightboxItem.sourcePath
              ? void revealPath(lightboxItem.sourcePath).catch(() => undefined)
              : undefined
          }
          poolIds={lightboxPool.map((frame) => frame.id)}
          slideshow={slideshow}
          onSlideshow={changeSlideshow}
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
  proxyPath: string | null;
  playPath: string | null;
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
  if (!desktopBridgeAvailable()) return item;
  if (record.thumbnailPath) {
    return withPreview(item, record.thumbnailPath, record.proxyPath, record.playPath, record.filePath);
  }
  return item;
}

function withPreview(
  item: StudioItem,
  thumbnailPath: string,
  proxyPath: string | null | undefined,
  playPath: string | null | undefined,
  filePath: string,
): StudioItem {
  const previewUrl = mediaSrc(thumbnailPath);
  const proxyUrl = mediaSrc(proxyPath) ?? previewUrl;
  const playUrl = mediaSrc(playPath);
  const original = mediaSrc(filePath);
  return {
    ...item,
    previewUrl,
    proxyUrl,
    playUrl,
    playFile: playPath ?? null,
    inspectUrl: item.format === "video" ? playUrl : (original ?? proxyUrl ?? previewUrl),
  };
}
