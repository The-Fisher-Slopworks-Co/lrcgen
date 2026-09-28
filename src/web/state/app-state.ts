// The app's single store: what the server told us (app info, settings, jobs) and the open song
// (draft, track, undo history, selection, autosave status). Change it only through ./actions.

import type { LyricsDoc } from "../../core/lyrics";
import type { AppInfo, Draft, JobState, TrackInfo, Transcript, WebSettings } from "../../shared/api";
import type { SaveStatus } from "./autosave";
import type { History } from "./history";
import { createStore, useSelector } from "./store";

export type DialogKind = "save" | "settings" | "calibrate" | "transcript";

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
  action?: { label: string; run: () => void };
}

export interface Selection {
  /** The selected group (line); its index in the document. */
  line: number;
  /** Selected word within the group (Words/Refine), or null for the whole group. */
  word: number | null;
}

export interface SongState {
  /** The draft as it will be saved; `draft.doc` is always `history.present.value`. */
  draft: Draft;
  /** Null until loaded (or if the audio file went missing). */
  track: TrackInfo | null;
  history: History<LyricsDoc>;
  selection: Selection;
  saveStatus: SaveStatus;
  saveError: string | null;
  /** The last finished transcription; undefined while it's being looked up. */
  transcript: Transcript | null | undefined;
  /** Bumped when a new vocal stem arrives, to bust caches. */
  vocalsVersion: number;
  /** "Loop line" (L) is on: the player loops the selected line and follows the selection. */
  loopLine: boolean;
}

export interface AppState {
  app: AppInfo | null;
  settings: WebSettings | null;
  bootError: string | null;
  song: SongState | null;
  /** A draft being opened (the song workspace shows a loading state). */
  opening: { draftId: string } | null;
  openError: string | null;
  /** Running and recently finished jobs, by id. */
  jobs: Record<string, JobState>;
  /** Open dialogs, topmost last. */
  dialogs: DialogKind[];
  toasts: Toast[];
  /** The transcription the compare dialog offers. */
  pendingTranscript: Transcript | null;
}

export const appStore = createStore<AppState>({
  app: null,
  settings: null,
  bootError: null,
  song: null,
  opening: null,
  openError: null,
  jobs: {},
  dialogs: [],
  toasts: [],
  pendingTranscript: null,
});

/**
 * Reads from the store and re-renders when the selected value changes.
 * Return primitives or existing objects; for a fresh object pass `shallowEqual` from ./store.
 */
export function useStore<S>(selector: (state: AppState) => S, isEqual?: (a: S, b: S) => boolean): S {
  return useSelector(appStore, selector, isEqual);
}
