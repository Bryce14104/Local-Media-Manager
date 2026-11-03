import type { LibrarySummary } from "../lib/types";

type StorageViewProps = {
  summary: LibrarySummary | null;
  offline: boolean;
  error: string | null;
};

const COLUMN_NOTES: { name: string; detail: string }[] = [
  { name: "file_path", detail: "Absolute path on this machine" },
  { name: "content_hash", detail: "Lowercase SHA-256 of the file bytes" },
  { name: "file_size", detail: "Size in bytes" },
  { name: "created_at", detail: "Creation time, unix seconds, when the OS has one" },
  { name: "modified_at", detail: "Modification time, unix seconds" },
  { name: "indexed_at", detail: "When Shelf last wrote this row, unix seconds" },
  { name: "rating", detail: "0 to 5, or empty when unrated" },
  { name: "media_kind", detail: "image, video, or raw" },
  { name: "exif_json", detail: "Selected EXIF fields as JSON" },
];

export function StorageView({ summary, offline, error }: StorageViewProps) {
  const liveColumns = summary?.columns ?? [];
  const rows = COLUMN_NOTES.filter(
    (column) => liveColumns.length === 0 || liveColumns.includes(column.name),
  );
  const extras = liveColumns.filter((name) => !COLUMN_NOTES.some((column) => column.name === name));

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <header>
        <h1 className="font-serif text-3xl">On this machine</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">
          The catalog is a SQLite file in the app data directory. Shelf creates it on
          startup from the schema.sql script. Photo bytes are not stored in the database,
          and nothing is uploaded.
        </p>
      </header>

      {error ? (
        <p className="rounded-2xl border border-danger/30 bg-white/40 px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Database"
          value={
            summary
              ? summary.databasePath
              : offline
                ? "Created when the desktop app opens"
                : "Not open yet"
          }
        />
        <Stat
          label="Schema"
          value={summary ? `Version ${summary.schemaVersion}` : "Version 1 in schema.sql"}
        />
        <Stat
          label="Indexed files"
          value={summary ? String(summary.mediaCount) : offline ? "Unavailable in the browser" : "—"}
        />
      </dl>

      <div className="overflow-hidden rounded-2xl border border-line bg-white/35">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-serif text-xl">media_files</h2>
          <p className="mt-1 text-xs text-ink-soft">
            {summary
              ? "Columns reported by the open database."
              : "Columns defined in the initialization script."}
          </p>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-4 py-2 font-medium">Column</th>
              <th className="px-4 py-2 font-medium">Stores</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((column) => (
              <tr key={column.name} className="border-t border-line">
                <th className="px-4 py-2.5 font-mono text-xs font-medium">{column.name}</th>
                <td className="px-4 py-2.5 text-ink-soft">{column.detail}</td>
              </tr>
            ))}
            {extras.map((name) => (
              <tr key={name} className="border-t border-line">
                <th className="px-4 py-2.5 font-mono text-xs font-medium">{name}</th>
                <td className="px-4 py-2.5 text-ink-soft">Present in the open database.</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white/35 px-4 py-3">
      <dt className="text-xs uppercase tracking-[0.14em] text-ink-soft">{label}</dt>
      <dd className="mt-2 text-sm leading-6 break-words">{value}</dd>
    </div>
  );
}
