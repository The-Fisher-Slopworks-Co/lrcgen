import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { JobEvent, JobKind, JobState } from "../shared/api";
import type { TranscriptionSettings } from "../core/settings-defaults";
import type { Transcriber } from "../ports/transcriber";
import type { TranscriptStore } from "../ports/transcript-store";
import { draftIdFor } from "./audio-files";

/** Finished jobs stay listed this long, so a reopened tab can still see how they ended. */
const KEEP_FINISHED_MS = 30 * 60 * 1000;

export interface JobManagerDeps {
  transcriber: Transcriber;
  transcripts: TranscriptStore;
  transcriptionSettings: () => Promise<TranscriptionSettings>;
  vocalsPath: (draftId: string) => string;
  /** Written once a job gets past the "init" stage: uv and the ML dependencies are installed. */
  depsMarkerPath: string;
  now?: () => number;
}

type Listener = (event: JobEvent) => void;

const DONE_MESSAGES: Record<JobKind, string> = {
  transcribe: "Transcription finished",
  align: "Lyrics synced",
  separate: "Vocals separated",
};

interface Job {
  state: JobState;
  /** What an "align" job syncs. */
  lyrics?: string;
  controller: AbortController;
  listeners: Set<Listener>;
  settled: Promise<void>;
}

/** Transcription, lyrics sync and vocal separation jobs; at most one running job per (kind, track). */
export class JobManager {
  private jobs = new Map<string, Job>();
  private now: () => number;

  constructor(private deps: JobManagerDeps) {
    this.now = deps.now ?? Date.now;
  }

  private prune(): void {
    const cutoff = this.now() - KEEP_FINISHED_MS;
    for (const [id, job] of this.jobs) {
      if (job.state.finishedAt !== null && job.state.finishedAt < cutoff) this.jobs.delete(id);
    }
  }

  list(audioPath?: string): JobState[] {
    this.prune();
    return [...this.jobs.values()]
      .map((j) => j.state)
      .filter((s) => audioPath === undefined || s.audioPath === audioPath)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): JobState | null {
    return this.jobs.get(id)?.state ?? null;
  }

  /** `lyrics` is what an "align" job syncs. */
  start(kind: JobKind, audioPath: string, lyrics?: string): JobState {
    this.prune();
    for (const job of this.jobs.values()) {
      const s = job.state;
      if (s.kind === kind && s.audioPath === audioPath && s.status === "running") return s;
    }
    const job: Job = {
      state: {
        id: crypto.randomUUID(),
        kind,
        audioPath,
        draftId: draftIdFor(audioPath),
        status: "running",
        stage: "init",
        message: "Starting…",
        progress: null,
        firstRun: !existsSync(this.deps.depsMarkerPath),
        error: null,
        startedAt: this.now(),
        finishedAt: null,
        groups: null,
      },
      lyrics: kind === "align" ? lyrics : undefined,
      controller: new AbortController(),
      listeners: new Set(),
      settled: Promise.resolve(),
    };
    this.jobs.set(job.state.id, job);
    job.settled = this.run(job);
    return job.state;
  }

  cancel(id: string): JobState | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.state.status === "running") {
      job.controller.abort();
      this.finish(job, "cancelled", null, { message: "Cancelled" });
    }
    return job.state;
  }

  /** Calls `listener` on every change of the job until it finishes. Null if there is no such job. */
  subscribe(id: string, listener: Listener): (() => void) | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.listeners.add(listener);
    return () => job.listeners.delete(listener);
  }

  /** Cancels every running job and waits for them to wind down. */
  async shutdown(): Promise<void> {
    const running = [...this.jobs.values()].filter((j) => j.state.status === "running");
    for (const job of running) this.cancel(job.state.id);
    await Promise.all(running.map((j) => j.settled));
  }

  private emit(job: Job, event: JobEvent): void {
    for (const listener of [...job.listeners]) listener(event);
  }

  private update(job: Job, changes: Partial<JobState>): void {
    if (job.state.status !== "running") return;
    job.state = { ...job.state, ...changes };
    this.emit(job, { type: "state", job: job.state });
  }

  private finish(job: Job, status: Exclude<JobState["status"], "running">, error: string | null, changes: Partial<JobState> = {}): void {
    if (job.state.status !== "running") return;
    job.state = { ...job.state, ...changes, status, error, finishedAt: this.now() };
    this.emit(job, { type: "state", job: job.state });
    this.emit(job, { type: "done", job: job.state });
    job.listeners.clear();
  }

  private async markDepsReady(): Promise<void> {
    const marker = this.deps.depsMarkerPath;
    if (existsSync(marker)) return;
    await mkdir(path.dirname(marker), { recursive: true });
    await Bun.write(marker, `${new Date(this.now()).toISOString()}\n`);
  }

  private async run(job: Job): Promise<void> {
    const { kind, audioPath, draftId } = job.state;
    const vocalsPath = this.deps.vocalsPath(draftId);
    const signal = job.controller.signal;
    try {
      if (kind === "separate" && (await Bun.file(vocalsPath).exists())) {
        this.finish(job, "done", null, { stage: "demucs", message: "Vocals already separated", progress: 1 });
        return;
      }
      const result = await this.deps.transcriber.transcribe({
        audioPath,
        vocalsPath,
        separateOnly: kind === "separate",
        lyrics: job.lyrics,
        settings: await this.deps.transcriptionSettings(),
        signal,
        onProgress: (event) => {
          this.update(job, { stage: event.stage, message: event.message, progress: event.progress ?? null });
          if (event.stage !== "init") this.markDepsReady().catch(() => {});
        },
      });
      if (signal.aborted) return;
      if (!result.success) {
        this.finish(job, "error", result.error ?? "Failed");
        return;
      }
      if (kind === "transcribe") {
        await this.deps.transcripts.put({
          draftId,
          groups: result.groups ?? [],
          rawLyrics: result.rawLyrics ?? "",
          createdAt: this.now(),
        });
      }
      this.finish(job, "done", null, {
        message: DONE_MESSAGES[kind],
        progress: 1,
        groups: kind === "align" ? (result.groups ?? []) : null,
      });
    } catch (e) {
      if (signal.aborted) return;
      this.finish(job, "error", e instanceof Error ? e.message : String(e));
    }
  }
}
