import { useState } from "react";
import { errorMessage, pickFolder, scanDirectory } from "../lib/api";
import { formatDuration } from "../lib/format";
import { primaryButton, secondaryButton, textField } from "../lib/styles";
import type { ScanReport } from "../lib/types";

type ScanViewProps = {
  onIndexed: () => Promise<void>;
};

export function ScanView({ onIndexed }: ScanViewProps) {
  const [folder, setFolder] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);

  async function browse() {
    setError(null);
    try {
      const selected = await pickFolder();
      if (selected) setFolder(selected);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function scan() {
    const root = folder.trim();
    if (!root) {
      setError("Enter a folder path, or browse for one.");
      setReport(null);
      return;
    }

    setRunning(true);
    setError(null);
    try {
      const next = await scanDirectory(root);
      setReport(next);
      await onIndexed();
    } catch (caught) {
      setReport(null);
      setError(errorMessage(caught));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header>
        <h1 className="font-serif text-3xl">Scan a folder</h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          Shelf walks the folder recursively, skips hidden names, and does not follow
          symbolic links. It indexes JPEG, PNG, HEIC, common raw files, and video.
          A later scan skips files whose size and modification time have not changed,
          and it keeps the rating you set.
        </p>
      </header>

      <form
        className="rounded-2xl border border-line bg-white/35 p-4 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void scan();
        }}
      >
        <label className="block text-sm font-medium" htmlFor="folder-path">
          Folder
        </label>
        <input
          id="folder-path"
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
          placeholder="/home/you/Pictures or D:\Photos"
          className={`${textField} mt-2`}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button type="button" className={secondaryButton} onClick={() => void browse()} disabled={running}>
            Browse
          </button>
          <button type="submit" className={primaryButton} disabled={running}>
            {running ? "Reading folder…" : "Scan folder"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="rounded-2xl border border-danger/30 bg-white/40 px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {report ? (
        <div className="rounded-2xl border border-line bg-white/35 px-4 py-4" role="status">
          <h2 className="font-serif text-xl">Scan finished</h2>
          <p className="mt-2 break-all text-sm text-ink-soft">{report.root}</p>
          <p className="mt-3 text-sm leading-6">
            Found {report.discovered}. Indexed {report.indexed}, unchanged {report.unchanged},
            failed {report.failed}. Took {formatDuration(report.durationMs)}.
          </p>
          {report.errors.length > 0 ? (
            <div className="mt-3">
              <h3 className="text-sm font-medium">Notes</h3>
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs leading-5 text-ink-soft">
                {report.errors.map((note, index) => (
                  <li key={`${index}-${note}`} className="break-all">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
