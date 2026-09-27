// Undo/redo over whole-value snapshots. Each entry remembers the label of the change that produced it
// ("tap", "nudge", "edit text"…), so a screen can ask what `undo` would revert — Backspace on Lines/Words
// undoes only when the last change was a tap.

export interface HistoryEntry<T> {
  value: T;
  label: string;
  at: number;
}

export interface History<T> {
  past: HistoryEntry<T>[];
  present: HistoryEntry<T>;
  future: HistoryEntry<T>[];
}

export interface CommitOptions {
  /** Merge into the previous entry when it has the same label and is younger than this (e.g. held-down nudges). */
  coalesceMs?: number;
  now?: number;
}

export const HISTORY_LIMIT = 300;

export function createHistory<T>(value: T, label = "open", now = Date.now()): History<T> {
  return { past: [], present: { value, label, at: now }, future: [] };
}

export function commit<T>(h: History<T>, value: T, label: string, options: CommitOptions = {}): History<T> {
  if (Object.is(value, h.present.value)) return h;
  const now = options.now ?? Date.now();
  const merge =
    options.coalesceMs !== undefined && h.past.length > 0 && h.present.label === label && now - h.present.at < options.coalesceMs;
  if (merge) return { past: h.past, present: { value, label, at: now }, future: [] };
  const past = [...h.past, h.present];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, present: { value, label, at: now }, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0];
  if (!next) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}

/** The label of the change `undo` would revert, or null when there is nothing to undo. */
export function undoLabel<T>(h: History<T>): string | null {
  return h.past.length > 0 ? h.present.label : null;
}

/** The label of the change `redo` would re-apply, or null. */
export function redoLabel<T>(h: History<T>): string | null {
  return h.future[0]?.label ?? null;
}
