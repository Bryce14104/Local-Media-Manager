import type { IndexJob } from "../../studio/types";

export const INDEX_JOBS: IndexJob[] = [
  { name: "Embeddings", detail: "Frame vectors for similarity", progress: 0.72 },
  { name: "Faces", detail: "Local face groups", progress: 0.41 },
  { name: "Duplicates", detail: "Exact hash matches", progress: 1 },
];

export function IndexStatusPopover() {
  return (
    <div className="absolute right-0 top-[calc(100%+0.4rem)] z-40 w-72 rounded-2xl border border-line bg-card p-3 shadow-2xl shadow-black/40">
      <p className="text-xs uppercase tracking-[0.16em] text-mute">AI indexing</p>
      <ul className="mt-3 space-y-3">
        {INDEX_JOBS.map((job) => (
          <li key={job.name}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{job.name}</span>
              <span className="font-mono text-xs text-teal">{Math.round(job.progress * 100)}%</span>
            </div>
            <p className="text-[11px] text-mute">{job.detail}</p>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-studio">
              <div className="h-full rounded-full bg-teal" style={{ width: `${job.progress * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-4 text-mute">Jobs stay on this machine. Nothing is uploaded.</p>
    </div>
  );
}
