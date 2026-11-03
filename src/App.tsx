import { useCallback, useEffect, useState } from "react";
import { LibraryView } from "./components/LibraryView";
import { ScanView } from "./components/ScanView";
import { Sidebar } from "./components/Sidebar";
import { StorageView } from "./components/StorageView";
import {
  desktopBridgeAvailable,
  errorMessage,
  fetchLibrary,
  setRating,
} from "./lib/api";
import type { LibrarySummary, MediaRecord, ViewId } from "./lib/types";

type BridgeState =
  | { status: "browser" }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

export default function App() {
  const [view, setView] = useState<ViewId>("library");
  const [bridge, setBridge] = useState<BridgeState>(
    desktopBridgeAvailable() ? { status: "loading" } : { status: "browser" },
  );
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [media, setMedia] = useState<MediaRecord[]>([]);

  const refresh = useCallback(async () => {
    if (!desktopBridgeAvailable()) {
      setBridge({ status: "browser" });
      setSummary(null);
      setMedia([]);
      return;
    }

    setBridge((current) => (current.status === "ready" ? current : { status: "loading" }));
    try {
      const next = await fetchLibrary();
      setSummary(next.summary);
      setMedia(next.media);
      setBridge({ status: "ready" });
    } catch (caught) {
      setBridge({ status: "error", message: errorMessage(caught) });
    }
  }, []);

  useEffect(() => {
    if (!desktopBridgeAvailable()) return;
    void refresh();
  }, [refresh]);

  async function rate(path: string, rating: number | null) {
    const updated = await setRating(path, rating);
    setMedia((current) =>
      current.map((item) => (item.filePath === updated.filePath ? updated : item)),
    );
  }

  const offline = bridge.status === "browser";
  const loading = bridge.status === "loading";
  const error = bridge.status === "error" ? bridge.message : null;

  return (
    <div className="min-h-screen bg-paper text-ink md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <Sidebar
        view={view}
        onView={setView}
        mediaCount={summary ? summary.mediaCount : null}
      />
      <main className="min-w-0 px-4 py-5 sm:px-6 sm:py-6">
        {offline ? (
          <p className="mb-5 rounded-2xl border border-line bg-paper-deep/80 px-4 py-3 text-sm leading-6 text-ink-soft">
            Preview in the browser. Scanning and the SQLite library run inside the
            desktop window. Start that with{" "}
            <code className="text-ink">npm run tauri dev</code>.
          </p>
        ) : null}

        {view === "library" ? (
          <LibraryView
            media={media}
            loading={loading}
            error={error}
            offline={offline}
            onRetry={() => void refresh()}
            onScan={() => setView("scan")}
            onRate={rate}
          />
        ) : null}
        {view === "scan" ? <ScanView onIndexed={refresh} /> : null}
        {view === "storage" ? (
          <StorageView summary={summary} offline={offline} error={error} />
        ) : null}
      </main>
    </div>
  );
}
