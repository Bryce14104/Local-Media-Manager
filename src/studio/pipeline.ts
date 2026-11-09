import type { PipelineStatus } from "./types";

export function pipelineReadout(job: PipelineStatus): { stage: string; percent: number | null; text: string } {
  const percent =
    job.total > 0 ? Math.min(100, Math.max(0, Math.round((job.done / job.total) * 100))) : null;
  const stage = pipelineStage(job.phase, job.label);
  return { stage, percent, text: percent == null ? stage : `${stage} ${percent}%` };
}

export function pipelineStage(phase: string, label: string): string {
  if (phase === "done") return "Ready";
  const blob = `${phase} ${label}`.toLowerCase();
  if (blob.includes("caption")) return "Captioning";
  if (blob.includes("cluster")) return "Clustering";
  if (
    blob.includes("embed") ||
    blob.includes("onnx") ||
    blob.includes("pixel") ||
    blob.includes("vision") ||
    blob.includes("face")
  ) {
    return "Embedding";
  }
  if (blob.includes("preview") || blob.includes("thumb")) return "Previews";
  if (blob.includes("index") || blob.includes("reading") || blob.includes("scan")) return "Indexing";
  const trimmed = label.trim();
  return trimmed || "Working";
}
