// Read-only hooks over the store for screens and components. Each re-renders only when its value changes.

import { useMemo } from "react";
import { draftProgress, type DraftProgress } from "../../core/draft-status";
import type { LyricsDoc } from "../../core/lyrics";
import type { AppInfo, Draft, JobKind, JobState, Step, TrackInfo, Transcript, WebSettings } from "../../shared/api";
import { useRoute } from "../routing/router";
import { useStore, type Selection, type SongState } from "./app-state";
import { redoLabel, undoLabel } from "./history";
import { shallowEqual } from "./store";

export function useApp(): AppInfo | null {
  return useStore((s) => s.app);
}

export function useSettings(): WebSettings | null {
  return useStore((s) => s.settings);
}

/** The open song's state, or null outside a song. Prefer the narrower hooks below. */
export function useSong(): SongState | null {
  return useStore((s) => s.song);
}

/** The open song's current document. Throws outside a song: screens only render inside one. */
export function useDoc(): LyricsDoc {
  const doc = useStore((s) => s.song?.history.present.value ?? null);
  if (!doc) throw new Error("useDoc() outside an open song");
  return doc;
}

export function useDraft(): Draft {
  const draft = useStore((s) => s.song?.draft ?? null);
  if (!draft) throw new Error("useDraft() outside an open song");
  return draft;
}

/** Track info (tags, duration, whether a vocal stem exists); null if the audio file couldn't be read. */
export function useTrack(): TrackInfo | null {
  return useStore((s) => s.song?.track ?? null);
}

export function useSelection(): Selection {
  return useStore((s) => s.song?.selection ?? NO_SELECTION);
}
const NO_SELECTION: Selection = { line: 0, word: null };

/** The current step, from the route (null outside a song). Route params (e.g. `transcribe`) come along. */
export function useStep(): { step: Step; params: Record<string, string> } | null {
  const route = useRoute();
  return route?.name === "song" ? { step: route.step, params: route.params } : null;
}

export function useHistoryInfo(): { canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null } {
  return useStore((s) => {
    const h = s.song?.history;
    return {
      canUndo: !!h && h.past.length > 0,
      canRedo: !!h && h.future.length > 0,
      undoLabel: h ? undoLabel(h) : null,
      redoLabel: h ? redoLabel(h) : null,
    };
  }, shallowEqual);
}

export function useSaveStatus(): { status: SongState["saveStatus"]; error: string | null } {
  return useStore((s) => ({ status: s.song?.saveStatus ?? "saved", error: s.song?.saveError ?? null }), shallowEqual);
}

/** The last finished transcription for the open song: undefined while loading, null if there is none. */
export function useTranscript(): Transcript | null | undefined {
  return useStore((s) => s.song?.transcript);
}

/** The open song's jobs, newest first; `kind` narrows it. */
export function useSongJobs(kind?: JobKind): JobState[] {
  return useStore(
    (s) =>
      Object.values(s.jobs)
        .filter((j) => j.draftId === s.song?.draft.id && (!kind || j.kind === kind))
        .sort((a, b) => b.startedAt - a.startedAt),
    arrayShallowEqual,
  );
}

/** The open song's running job of a kind, or null. */
export function useRunningJob(kind: JobKind): JobState | null {
  const jobs = useSongJobs(kind);
  return jobs.find((j) => j.status === "running") ?? null;
}

/** Progress summary (steps done, status line) for the open song. `openFlags` comes from `useFlags().length`. */
export function useDraftProgress(openFlags: number): DraftProgress | null {
  const doc = useStore((s) => s.song?.history.present.value ?? null);
  const published = useStore((s) => s.song?.draft.publishedAt != null);
  return useMemo(() => (doc ? draftProgress(doc, { published, openFlags }) : null), [doc, published, openFlags]);
}

function arrayShallowEqual<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}
