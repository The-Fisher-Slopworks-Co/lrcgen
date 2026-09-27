// The transcription pipeline as the Recognize view shows it: four stages, each done / current / later.

import type { TranscribeStage } from "../../../core/transcribe-protocol";
import type { JobState } from "../../../shared/api";

export const STAGE_ORDER: TranscribeStage[] = ["init", "demucs", "api", "align"];

export type StageState = "done" | "current" | "failed" | "later";

/** 0–3; the stage the job is in. */
export function stageIndex(stage: TranscribeStage): number {
  return Math.max(0, STAGE_ORDER.indexOf(stage));
}

/**
 * How stage `i` looks for `job` (null = not started: everything is later).
 * A finished job has every stage done; a failed one marks its stage failed; a cancelled one leaves its stage current.
 */
export function stageState(job: Pick<JobState, "status" | "stage"> | null, i: number): StageState {
  if (!job) return "later";
  if (job.status === "done") return "done";
  const current = stageIndex(job.stage);
  if (i < current) return "done";
  if (i > current) return "later";
  return job.status === "error" ? "failed" : "current";
}

/** How much of each segment of the overall bar is filled (0–1); null for the current stage without a measure. */
export function segmentFill(job: Pick<JobState, "status" | "stage" | "progress"> | null): (number | null)[] {
  return STAGE_ORDER.map((_, i) => {
    const state = stageState(job, i);
    if (state === "done") return 1;
    if (state === "current") return job?.progress ?? null;
    return 0;
  });
}

/** "about N min left" is left out on purpose: the stages vary too much (a model download, a network call) to guess. */
export function elapsed(startedAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
