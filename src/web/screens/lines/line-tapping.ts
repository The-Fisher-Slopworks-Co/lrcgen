// Line tapping on the Lines step (SyncEngine semantics on top of the store's undo history):
// the selected line is the tap target, a tap times it and moves on to the next line.

import { setTimestamp, type LrcDocument } from "../../../core/lrc-document";
import { lineSpan } from "../../lib/timing";

/** How far before a line playback backs up when Enter starts it from a pause, so its start can still be caught. */
export const PRE_ROLL_MS = 2000;

/** Index of the first line without a start time, or -1. */
export function firstUntimedLine(doc: LrcDocument): number {
  return doc.lines.findIndex((l) => l.timestamp === null);
}

/** Times line `index` at `ms`; `next` is the line to tap after it, null after the last one. */
export function tapLine(doc: LrcDocument, index: number, ms: number): { doc: LrcDocument; next: number | null } {
  const next = index + 1 < doc.lines.length ? index + 1 : null;
  return { doc: setTimestamp(doc, index, Math.max(0, Math.round(ms))), next };
}

/** Moves a timed line (and its words) by `deltaMs`, not before 0; null when the line has no start. */
export function nudgeLine(doc: LrcDocument, index: number, deltaMs: number): LrcDocument | null {
  const ts = doc.lines[index]?.timestamp;
  if (ts == null) return null;
  const to = Math.max(0, ts + deltaMs);
  return to === ts ? null : setTimestamp(doc, index, to);
}

/** The first line that differs between two versions of a document (by identity), or -1. */
export function changedLine(before: LrcDocument, after: LrcDocument): number {
  const n = Math.max(before.lines.length, after.lines.length);
  for (let i = 0; i < n; i++) if (before.lines[i] !== after.lines[i]) return i;
  return -1;
}

/** The line heard at `ms`: the latest-starting timed line at or before it, while its span lasts. -1 if none. */
export function lineAt(doc: LrcDocument, ms: number, durationMs: number): number {
  let best = -1;
  let bestStart = -1;
  doc.lines.forEach((line, i) => {
    const t = line.timestamp;
    if (t !== null && t <= ms && t >= bestStart) {
      best = i;
      bestStart = t;
    }
  });
  if (best < 0) return -1;
  const span = lineSpan(doc, best, durationMs);
  return span && ms < span.to ? best : -1;
}

/** "Lines 7 / 12": lines with text, and how many of them have a start (empty lines are gaps, not lyrics). */
export function lineCounts(doc: LrcDocument): { timed: number; total: number } {
  const lines = doc.lines.filter((l) => l.text.trim() !== "");
  return { timed: lines.filter((l) => l.timestamp !== null).length, total: lines.length };
}

/**
 * Where Enter starts playback from a pause: from the current position, unless the target line already has a
 * start at or before it (after ↑/↓, which seek to the line's start) — then a little before that start.
 */
export function pausedStart(doc: LrcDocument, target: number, positionMs: number): number {
  const ts = doc.lines[target]?.timestamp;
  if (ts == null || positionMs < ts - 300) return positionMs;
  return Math.max(0, ts - PRE_ROLL_MS);
}

export interface RowBox {
  top: number;
  bottom: number;
}

/**
 * The scrollTop that keeps `rows` (most important first) inside a viewport of `height` scrolled to `scrollTop`,
 * moving as little as possible and leaving `margin` px around them. Rows that can't all fit give way to the first.
 */
export function keepInView(scrollTop: number, height: number, rows: RowBox[], margin = 0): number {
  let wanted: RowBox | null = null;
  for (const row of rows) {
    const next: RowBox = wanted ? { top: Math.min(wanted.top, row.top), bottom: Math.max(wanted.bottom, row.bottom) } : row;
    if (wanted && next.bottom - next.top + 2 * margin > height) break;
    wanted = next;
  }
  if (!wanted) return scrollTop;
  const top = wanted.top - margin;
  const bottom = wanted.bottom + margin;
  if (bottom - top > height) return Math.max(0, top);
  if (top < scrollTop) return Math.max(0, top);
  if (bottom > scrollTop + height) return Math.max(0, bottom - height);
  return scrollTop;
}
