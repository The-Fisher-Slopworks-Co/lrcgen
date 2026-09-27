// Everything that changes the store, apart from opening/closing songs (./session) and jobs (./jobs).
// Document edits go through `commit(doc, label)` so they land in undo history and get autosaved:
//   commit(setTimestamp(doc, i, player.tapPosition()), "tap");
//   if (undoLabel() === "tap") undo();   // Backspace on Lines/Words

import type { LrcDocument } from "../../core/lrc-document";
import type { Draft, WebSettings } from "../../shared/api";
import * as api from "../api/client";
import { errorMessage } from "../api/client";
import { appStore, type DialogKind, type Selection, type SongState, type Toast } from "./app-state";
import type { Autosaver } from "./autosave";
import * as H from "./history";

// ---------------------------------------------------------------- song state plumbing

let saver: Autosaver<Draft> | null = null;

/** Used by ./session when a song opens or closes. */
export function setAutosaver(next: Autosaver<Draft> | null): Autosaver<Draft> | null {
  const prev = saver;
  saver = next;
  return prev;
}

export function currentAutosaver(): Autosaver<Draft> | null {
  return saver;
}

export function currentSong(): SongState | null {
  return appStore.get().song;
}

/** Updates the open song; `persist` schedules an autosave of the draft. */
export function patchSong(update: Partial<SongState> | ((song: SongState) => Partial<SongState>), persist = false): void {
  const song = appStore.get().song;
  if (!song) return;
  const patch = typeof update === "function" ? update(song) : update;
  appStore.set({ song: { ...song, ...patch } });
  if (persist) saver?.schedule(appStore.get().song!.draft);
}

/** Like `patchSong`, but only if that draft is still the open one (for async results). */
export function patchSongIf(draftId: string, update: Partial<SongState> | ((song: SongState) => Partial<SongState>)): void {
  if (appStore.get().song?.draft.id === draftId) patchSong(update);
}

function clampSelection(sel: Selection, doc: LrcDocument): Selection {
  const lines = doc.lines.length;
  const line = lines === 0 ? 0 : Math.min(Math.max(0, sel.line), lines - 1);
  return line === sel.line ? sel : { line, word: null };
}

function setHistory(history: H.History<LrcDocument>): void {
  patchSong(
    (s) => ({
      history,
      draft: { ...s.draft, doc: history.present.value },
      selection: clampSelection(s.selection, history.present.value),
    }),
    true,
  );
}

// ---------------------------------------------------------------- document

/** The open song's document (or null). */
export function currentDoc(): LrcDocument | null {
  return appStore.get().song?.history.present.value ?? null;
}

/**
 * Makes `doc` the current document as one undo step labelled `label` ("tap", "nudge", "edit text"…).
 * `coalesceMs` merges it into the previous step when that has the same label and is recent (held keys).
 */
export function commit(doc: LrcDocument, label: string, options: { coalesceMs?: number } = {}): void {
  const song = currentSong();
  if (!song) return;
  setHistory(H.commit(song.history, doc, label, options));
}

/** `commit(fn(currentDoc), label)`. */
export function updateDoc(fn: (doc: LrcDocument) => LrcDocument, label: string, options: { coalesceMs?: number } = {}): void {
  const doc = currentDoc();
  if (doc) commit(fn(doc), label, options);
}

export function undo(): void {
  const song = currentSong();
  if (song && song.history.past.length > 0) setHistory(H.undo(song.history));
}

export function redo(): void {
  const song = currentSong();
  if (song && song.history.future.length > 0) setHistory(H.redo(song.history));
}

/** The label of the change `undo()` would revert ("tap", …), or null. */
export function undoLabel(): string | null {
  const song = currentSong();
  return song ? H.undoLabel(song.history) : null;
}

// ---------------------------------------------------------------- selection

/** Selects a line (clamped to the document), and optionally a word in it. */
export function select(line: number, word: number | null = null): void {
  const song = currentSong();
  if (!song) return;
  const sel = clampSelection({ line, word }, song.history.present.value);
  const next = sel.line === line ? { line, word } : sel;
  if (next.line !== song.selection.line || next.word !== song.selection.word) patchSong({ selection: next });
}

export function selectWord(word: number | null): void {
  const song = currentSong();
  if (song) select(song.selection.line, word);
}

// ---------------------------------------------------------------- draft fields

/** Where "Save next to the track" writes (a plain .lrc path); saved with the draft. */
export function updateDraft(patch: Partial<Pick<Draft, "lrcPath">>): void {
  patchSong((s) => ({ draft: { ...s.draft, ...patch } }), true);
}

/**
 * Re-reads what only the server sets (`savedAt`, `publishedAt`, `updatedAt`) after a save or publish.
 * PUT ignores those fields, so this is the only way they change here.
 */
export async function refreshDraftMeta(): Promise<void> {
  const song = currentSong();
  if (!song) return;
  try {
    const fresh = await api.getDraft(song.draft.id);
    patchSongIf(fresh.id, (s) => ({
      draft: { ...s.draft, savedAt: fresh.savedAt, publishedAt: fresh.publishedAt, updatedAt: fresh.updatedAt },
    }));
  } catch {
    // Only status text depends on it.
  }
}

/** Records the step on the draft (the Recent list shows it). The route is the source of truth; see ./session. */
export function setDraftStep(step: Draft["step"]): void {
  const song = currentSong();
  if (song && song.draft.step !== step) patchSong((s) => ({ draft: { ...s.draft, step } }), true);
}

/** "It's intended": hides a flag for good (stored in the draft). */
export function dismissFlag(id: string): void {
  const song = currentSong();
  if (!song || song.draft.dismissedFlags.includes(id)) return;
  patchSong((s) => ({ draft: { ...s.draft, dismissedFlags: [...s.draft.dismissedFlags, id] } }), true);
}

export function restoreFlag(id: string): void {
  patchSong((s) => ({ draft: { ...s.draft, dismissedFlags: s.draft.dismissedFlags.filter((f) => f !== id) } }), true);
}

/** Saves the draft now (e.g. before leaving); resolves when it's on disk or the attempt failed. */
export async function flushDraft(): Promise<void> {
  await saver?.flush();
}

// ---------------------------------------------------------------- dialogs

export function openDialog(kind: DialogKind): void {
  const { dialogs } = appStore.get();
  if (dialogs[dialogs.length - 1] === kind) return;
  appStore.set({ dialogs: [...dialogs.filter((d) => d !== kind), kind] });
}

/** Closes `kind`, or the topmost dialog. */
export function closeDialog(kind?: DialogKind): void {
  const { dialogs } = appStore.get();
  if (dialogs.length === 0) return;
  appStore.set({ dialogs: kind ? dialogs.filter((d) => d !== kind) : dialogs.slice(0, -1) });
}

// ---------------------------------------------------------------- toasts

let nextToastId = 1;

export function toast(message: string, options: { kind?: Toast["kind"]; action?: Toast["action"]; durationMs?: number } = {}): number {
  const id = nextToastId++;
  const kind = options.kind ?? "info";
  appStore.set((s) => ({ toasts: [...s.toasts, { id, message, kind, action: options.action }] }));
  setTimeout(() => dismissToast(id), options.durationMs ?? (kind === "error" ? 8000 : 4500));
  return id;
}

export function toastError(prefix: string, err: unknown): void {
  toast(`${prefix}: ${errorMessage(err)}`, { kind: "error" });
}

export function dismissToast(id: number): void {
  appStore.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

// ---------------------------------------------------------------- settings & folders

/** Saves settings; the store updates right away and rolls back if the server refuses. */
export async function saveSettings(next: WebSettings): Promise<boolean> {
  const prev = appStore.get().settings;
  appStore.set({ settings: next });
  try {
    appStore.set({ settings: await api.putSettings(next) });
    return true;
  } catch (err) {
    appStore.set({ settings: prev });
    toastError("Settings not saved", err);
    return false;
  }
}

/** Stores the output latency (ms, positive = heard late) for an output device. */
export function setLatency(deviceKey: string, ms: number): Promise<boolean> {
  const settings = appStore.get().settings;
  if (!settings) return Promise.resolve(false);
  return saveSettings({ ...settings, latency: { ...settings.latency, [deviceKey]: Math.round(ms) } });
}

export async function addFolder(path: string): Promise<boolean> {
  try {
    const folders = await api.addFolder(path);
    appStore.set((s) => ({ app: s.app && { ...s.app, folders } }));
    return true;
  } catch (err) {
    toastError("Couldn't add the folder", err);
    return false;
  }
}

export async function removeFolder(path: string): Promise<void> {
  try {
    const folders = await api.removeFolder(path);
    appStore.set((s) => ({ app: s.app && { ...s.app, folders } }));
  } catch (err) {
    toastError("Couldn't remove the folder", err);
  }
}
