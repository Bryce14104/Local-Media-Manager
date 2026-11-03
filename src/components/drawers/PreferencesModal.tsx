import { useState } from "react";
import { formatBytes } from "../../lib/format";
import { clearAllPacks, clearPack, downloadPack, getMapLibrary } from "../../studio/mapLibrary";
import { MAP_PACKS } from "../../studio/mapPacks";
import { useMapLibrary } from "../../studio/useMapLibrary";
import { Modal } from "./AddMediaModal";

export function PreferencesModal({ onClose }: { onClose: () => void }) {
  const library = useMapLibrary();
  const cached = Object.keys(library.records).length;

  return (
    <Modal title="Preferences" onClose={onClose} wide>
      <div className="max-h-[70vh] space-y-4 overflow-auto pr-1">
        <section>
          <h3 className="text-sm font-medium">Download Map Data</h3>
          <p className="mt-1 text-sm text-mute">
            High-zoom packs are prepared on this machine and kept in this browser. Shelf does not contact a map
            server, and it does not record which packs you cache.
          </p>
          {library.error ? <p className="mt-2 text-sm text-danger">{library.error}</p> : null}
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
            {MAP_PACKS.map((pack) => {
              const record = library.records[pack.id];
              const job = library.job?.packId === pack.id ? library.job : null;
              return (
                <li key={pack.id} className="flex items-center gap-3 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{pack.name}</p>
                    <p className="truncate text-xs text-mute">
                      {pack.detail}
                      {record ? ` · ${record.tileCount} tiles · ${formatBytes(record.bytes)}` : " · not cached"}
                    </p>
                    {job ? (
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                        <div
                          className="h-full bg-teal"
                          style={{ width: `${Math.round((job.done / job.total) * 100)}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                  {job ? (
                    <span className="shrink-0 font-mono text-[10px] text-teal">
                      {job.done}/{job.total}
                    </span>
                  ) : record ? (
                    <button
                      type="button"
                      onClick={() => void clearPack(pack.id)}
                      className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-mute hover:text-foam"
                    >
                      Clear
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void downloadPack(pack.id)}
                      disabled={library.job != null}
                      className="shrink-0 rounded-full bg-teal px-3 py-1 text-xs font-medium text-teal-ink disabled:opacity-40"
                    >
                      Download
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => void clearAllPacks()}
              disabled={cached === 0 && library.job == null}
              className="rounded-full border border-line px-3 py-1.5 text-xs text-mute hover:text-foam disabled:opacity-40"
            >
              Clear all map data
            </button>
          </div>
        </section>
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-full bg-teal px-4 py-2 text-sm font-medium text-teal-ink">
          Done
        </button>
      </div>
    </Modal>
  );
}

export function MapPackPrompt({
  onClose,
  onOpenPreferences,
}: {
  onClose: () => void;
  onOpenPreferences: () => void;
}) {
  const library = useMapLibrary();
  const [selected, setSelected] = useState<string[]>(() => MAP_PACKS.filter((pack) => pack.inRoll).map((pack) => pack.id));
  const [running, setRunning] = useState(false);
  const queued = selected.filter((id) => !library.records[id]);

  return (
    <Modal title="Offline map detail" onClose={onClose} wide>
      <p className="text-sm text-mute">
        The world outline is already on this machine. You can cache regional packs for closer zoom. They are built
        locally, stored only in this browser, and never sent anywhere.
      </p>
      <ul className="mt-3 max-h-64 space-y-1 overflow-auto">
        {MAP_PACKS.map((pack) => {
          const checked = selected.includes(pack.id);
          return (
            <li key={pack.id}>
              <label className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-raised">
                <input
                  type="checkbox"
                  className="accent-teal"
                  checked={checked}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(pack.id) ? current.filter((id) => id !== pack.id) : [...current, pack.id],
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="block text-sm">{pack.name}</span>
                  <span className="block truncate text-xs text-mute">{pack.detail}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {library.job ? (
        <p className="mt-3 font-mono text-xs text-teal">
          Preparing {MAP_PACKS.find((pack) => pack.id === library.job?.packId)?.name ?? "pack"} · {library.job.done}/{library.job.total}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onOpenPreferences} className="rounded-full px-3 py-2 text-sm text-mute">
          Manage packs
        </button>
        <button type="button" onClick={onClose} className="rounded-full px-3 py-2 text-sm text-mute">
          Not now
        </button>
        <button
          type="button"
          disabled={queued.length === 0 || running || library.job != null}
          onClick={() => {
            setRunning(true);
            void downloadSelected(queued).finally(() => onClose());
          }}
          className="rounded-full bg-teal px-4 py-2 text-sm font-medium text-teal-ink disabled:opacity-40"
        >
          Download selected
        </button>
      </div>
    </Modal>
  );
}

async function downloadSelected(ids: string[]) {
  for (const id of ids) {
    if (getMapLibrary().records[id]) continue;
    await downloadPack(id);
  }
}
