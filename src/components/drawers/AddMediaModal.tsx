import { useEffect, useRef, useState, type ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { desktopBridgeAvailable } from "../../lib/api";

type AddMediaModalProps = {
  onClose: () => void;
  busy: boolean;
  message: string | null;
  progress: number | null;
  error: string | null;
  preview?: { volumeLabel: string; newCount: number; knownCount: number; names: string[] } | null;
  onBrowse: () => void;
  onPaths: (paths: string[]) => void;
  onFiles: (files: File[]) => void;
  onIndexAnyway?: () => void;
  onCopyThenIndex?: () => void;
  onEject?: () => void;
};

export function AddMediaModal({
  onClose,
  busy,
  message,
  progress,
  error,
  preview,
  onBrowse,
  onPaths,
  onFiles,
  onIndexAnyway,
  onCopyThenIndex,
  onEject,
}: AddMediaModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onPathsRef = useRef(onPaths);
  onPathsRef.current = onPaths;
  const [over, setOver] = useState(false);
  const desktop = desktopBridgeAvailable();

  useEffect(() => {
    inputRef.current?.setAttribute("webkitdirectory", "");
    inputRef.current?.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (!desktop) return;
    let unlisten: (() => void) | undefined;
    let cancel = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop" && event.payload.paths.length > 0) {
          onPathsRef.current(event.payload.paths);
        }
        if (event.payload.type === "leave") setOver(false);
        if (event.payload.type === "enter" || event.payload.type === "over") setOver(true);
      })
      .then((stop) => {
        if (cancel) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
      unlisten?.();
    };
  }, [desktop]);

  return (
    <Modal title="Add media" onClose={busy ? () => undefined : onClose}>
      <p className="text-sm text-mute">
        Choose a card or folder. Shelf shows what is new versus already indexed, then writes previews in the background.
      </p>
      {preview ? (
        <div className="mt-3 rounded-2xl border border-line px-3 py-2 text-sm">
          <p>
            {preview.volumeLabel}: <span className="text-teal">{preview.newCount} new</span>
            {preview.knownCount ? ` · ${preview.knownCount} already in the library` : ""}
          </p>
          {preview.names.length > 0 ? (
            <p className="mt-1 truncate text-xs text-mute">{preview.names.slice(0, 4).join(" · ")}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {onIndexAnyway ? (
              <button
                type="button"
                disabled={busy}
                onClick={onIndexAnyway}
                className="rounded-full bg-teal px-3 py-1.5 text-xs font-medium text-teal-ink disabled:opacity-40"
              >
                Index in place
              </button>
            ) : null}
            {onCopyThenIndex ? (
              <button
                type="button"
                disabled={busy}
                onClick={onCopyThenIndex}
                className="rounded-full border border-line px-3 py-1.5 text-xs text-foam hover:border-teal disabled:opacity-40"
              >
                Copy new files to a folder
              </button>
            ) : null}
            {onEject ? (
              <button
                type="button"
                disabled={busy}
                onClick={onEject}
                className="rounded-full border border-line px-3 py-1.5 text-xs text-mute hover:text-foam disabled:opacity-40"
              >
                Eject this volume
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div
        className={`mt-4 rounded-2xl border border-dashed px-4 py-8 text-center ${
          over ? "border-teal bg-teal/10" : "border-line"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          if (desktop) return;
          const files = [...event.dataTransfer.files];
          if (files.length > 0) onFiles(files);
        }}
      >
        <p className="text-sm">{over ? "Drop to index" : "Drop a folder or files"}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (desktop) {
              onBrowse();
              return;
            }
            inputRef.current?.click();
          }}
          className="mt-4 rounded-full bg-teal px-4 py-2 text-sm font-medium text-teal-ink disabled:opacity-40"
        >
          {busy ? "Indexing…" : "Browse Folders"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length > 0) onFiles(files);
          }}
        />
      </div>
      {message ? <p className="mt-3 text-sm text-mute">{message}</p> : null}
      {progress != null ? (
        <div className="mt-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-teal" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="mt-1 text-right font-mono text-xs text-teal">{Math.round(progress * 100)}%</p>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} disabled={busy} className="rounded-full px-3 py-2 text-sm text-mute disabled:opacity-40">
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
  layer = "default",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  layer?: "default" | "top";
}) {
  return (
    <div
      className={`fixed inset-0 grid place-items-center bg-black/60 p-4 ${layer === "top" ? "z-[70]" : "z-50"}`}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full rounded-2xl border border-line bg-card p-5 ${wide ? "max-w-2xl" : "max-w-md"}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-medium">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
