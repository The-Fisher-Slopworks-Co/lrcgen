// Background jobs (transcription, lyrics sync, vocal separation): start/cancel, follow their event streams into
// the store, and act when they finish — a new stem reloads the vocals; a transcription is applied directly to an
// empty document, otherwise the compare dialog asks what to keep; a lyrics sync puts its timings on the lines.

import { adoptWordTimings, applyAlignment } from "../../core/lyrics-merge";
import type { LrcDocument, LrcLine } from "../../core/lrc-document";
import type { JobKind, JobState, Transcript } from "../../shared/api";
import * as api from "../api/client";
import { player } from "../audio/player";
import { plural } from "../lib/format";
import { commit, currentDoc, currentSong, openDialog, patchSongIf, toast, toastError } from "./actions";
import { appStore } from "./app-state";

const subscriptions = new Map<string, () => void>();

const JOB_NAMES: Record<JobKind, string> = { transcribe: "Transcription", align: "Lyrics sync", separate: "Vocal separation" };

function putJob(job: JobState): void {
  appStore.set((s) => ({ jobs: { ...s.jobs, [job.id]: job } }));
}

/** Follows a job until it finishes (no-op if already followed or not running). */
export function trackJob(job: JobState): void {
  putJob(job);
  if (job.status !== "running" || subscriptions.has(job.id)) return;
  const unsubscribe = api.subscribeJob(
    job.id,
    (event) => {
      putJob(event.job);
      if (event.type === "done") {
        subscriptions.delete(job.id);
        void onJobDone(event.job);
      }
    },
    {
      onLost: () => {
        subscriptions.delete(job.id);
        void resumeJobs(job.audioPath);
      },
    },
  );
  subscriptions.set(job.id, unsubscribe);
}

/** Picks up jobs already running on the server (all of them, or one track's). */
export async function resumeJobs(audioPath?: string): Promise<void> {
  try {
    for (const job of await api.listJobs(audioPath)) trackJob(job);
  } catch {
    // The header just won't show the chip; nothing to tell the user.
  }
}

/** Starts a job for the open song. Returns the job (an already running one of that kind, if any). */
export async function startJob(kind: JobKind): Promise<JobState | null> {
  const song = currentSong();
  if (!song) return null;
  try {
    const doc = currentDoc();
    const lyrics = kind === "align" && doc ? lyricsToSync(doc) : undefined;
    const job = await api.startJob({ kind, audioPath: song.draft.audioPath, lyrics });
    trackJob(job);
    return job;
  } catch (err) {
    toastError(`${JOB_NAMES[kind]} didn't start`, err);
    return null;
  }
}

export async function cancelJob(id: string): Promise<void> {
  try {
    putJob(await api.cancelJob(id));
  } catch (err) {
    toastError("Couldn't cancel", err);
  }
}

/** What a lyrics sync aligns: the document's lines as text. */
function lyricsToSync(doc: LrcDocument): string {
  return doc.lines.map((line) => line.text).join("\n");
}

/** The open song's running job of a kind, if any. */
export function runningJob(kind: JobKind): JobState | null {
  const song = currentSong();
  if (!song) return null;
  return Object.values(appStore.get().jobs).find((j) => j.kind === kind && j.draftId === song.draft.id && j.status === "running") ?? null;
}

async function onJobDone(job: JobState): Promise<void> {
  const song = currentSong();
  const isOpen = song?.draft.id === job.draftId;
  if (job.status === "error") {
    toast(`${JOB_NAMES[job.kind]} failed: ${job.error ?? job.message}`, { kind: "error" });
    return;
  }
  if (job.status !== "done") return;
  if (!isOpen) {
    toast(`${JOB_NAMES[job.kind]} finished for ${fileName(job.audioPath)}`);
    return;
  }
  // Both kinds leave a vocal stem behind.
  await refreshTrack();
  if (job.kind === "separate") {
    toast("Vocals separated — press V to hear them");
    return;
  }
  if (job.kind === "align") {
    applySync(job.lines ?? []);
    return;
  }
  try {
    const transcript = await api.getTranscript(job.draftId);
    patchSongIf(job.draftId, { transcript });
    if (transcript) offerTranscript(transcript);
  } catch (err) {
    toastError("Couldn't load the transcription", err);
  }
}

/** Reloads the open track's info; picks up a new vocal stem. */
export async function refreshTrack(): Promise<void> {
  const song = currentSong();
  if (!song) return;
  try {
    const track = await api.getTrack(song.draft.audioPath);
    const vocalsVersion = track.hasVocals ? song.vocalsVersion + 1 : song.vocalsVersion;
    patchSongIf(song.draft.id, { track, vocalsVersion });
    player.setVocalsUrl(track.hasVocals ? api.vocalsUrl(track.path, vocalsVersion) : null);
  } catch {
    // Keep the old info.
  }
}

/** An empty document takes the transcription straight away; otherwise the user chooses. */
export function offerTranscript(transcript: Transcript): void {
  const doc = currentDoc();
  if (!doc) return;
  if (doc.lines.length === 0) {
    applyTranscript(transcript, "replace");
    return;
  }
  appStore.set({ pendingTranscript: transcript });
  openDialog("transcript");
}

export type TranscriptChoice = "keep" | "replace" | "words";

/** Applies the compare dialog's answer. */
export function applyTranscript(transcript: Transcript, choice: TranscriptChoice): void {
  appStore.set({ pendingTranscript: null });
  const doc = currentDoc();
  if (!doc || choice === "keep") return;
  if (choice === "replace") {
    const next: LrcDocument = { ...doc, lines: transcript.lines };
    commit(next, "use transcription");
    toast(`Transcription applied · ${plural(transcript.lines.length, "line")}`);
    return;
  }
  const { doc: next, adopted } = adoptWordTimings(doc, transcript.lines);
  commit(next, "adopt word timings");
  toast(adopted ? `Word timings taken for ${plural(adopted, "line")}` : "No lines matched the transcription");
}

/** Puts a finished lyrics sync's timings on the open song's lines. */
export function applySync(lines: LrcLine[]): void {
  const doc = currentDoc();
  if (!doc) return;
  const { doc: next, synced } = applyAlignment(doc, lines);
  if (synced === 0) {
    toast("The sync found no timings for these lines", { kind: "error" });
    return;
  }
  commit(next, "sync lyrics");
  toast(`Lyrics synced · ${plural(synced, "line")}`);
}

/** Called by ./session when a song opens: the last transcript and any running jobs. */
export async function loadSongExtras(draftId: string, audioPath: string): Promise<void> {
  void resumeJobs(audioPath);
  try {
    const transcript = await api.getTranscript(draftId);
    patchSongIf(draftId, { transcript });
  } catch {
    patchSongIf(draftId, { transcript: null });
  }
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
