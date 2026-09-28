// Line tapping on the Lines step (SyncEngine semantics on top of the store's undo history):
// the selected line is the tap target, a tap times it and moves on to the next line.

import { groupStart, isLabelled, isTimed, setGroupStart, type LyricsDoc } from "../../../core/lyrics";
import { lineSpan } from "../../lib/timing";

/** How far before a line playback backs up when Enter starts it from a pause, so its start can still be caught. */
export const PRE_ROLL_MS = 2000;

/** Index of the first group (with words) without a start time, or -1. */
export function firstUntimedLine(doc: LyricsDoc): number {
  return doc.groups.findIndex((g) => g.words.length > 0 && !isTimed(g));
}

/** Times group `index` at `ms` (its words move along); `next` is the group to tap after it, null after the last one. */
export function tapLine(doc: LyricsDoc, index: number, ms: number): { doc: LyricsDoc; next: number | null } {
  const next = index + 1 < doc.groups.length ? index + 1 : null;
  return { doc: setGroupStart(doc, index, Math.max(0, Math.round(ms))), next };
}

/** Moves a timed group (and its words) by `deltaMs`, not before 0; null when the group has no start. */
export function nudgeLine(doc: LyricsDoc, index: number, deltaMs: number): LyricsDoc | null {
  const group = doc.groups[index];
  const ts = group ? groupStart(group) : null;
  if (ts === null) return null;
  const to = Math.max(0, ts + deltaMs);
  return to === ts ? null : setGroupStart(doc, index, to);
}

/** The first group that differs between two versions of a document (by identity), or -1. */
export function changedLine(before: LyricsDoc, after: LyricsDoc): number {
  const n = Math.max(before.groups.length, after.groups.length);
  for (let i = 0; i < n; i++) if (before.groups[i] !== after.groups[i]) return i;
  return -1;
}

/**
 * The line heard at `ms`: the latest-starting line (unlabelled group) at or before it, while its span lasts; -1 if
 * none. Backing vocals and ad-libs over it don't take the highlight away.
 */
export function lineAt(doc: LyricsDoc, ms: number, durationMs: number): number {
  let best = -1;
  let bestStart = -1;
  doc.groups.forEach((g, i) => {
    const t = isLabelled(g) ? null : groupStart(g);
    if (t !== null && t <= ms && t >= bestStart) {
      best = i;
      bestStart = t;
    }
  });
  if (best < 0) return -1;
  const span = lineSpan(doc, best, durationMs);
  return span && ms < span.to ? best : -1;
}

/** "Lines 7 / 12": groups with words, and how many of them have a start. */
export function lineCounts(doc: LyricsDoc): { timed: number; total: number } {
  const groups = doc.groups.filter((g) => g.words.length > 0);
  return { timed: groups.filter(isTimed).length, total: groups.length };
}

/**
 * Where Enter starts playback from a pause: from the current position, unless the target line already has a
 * start at or before it (after ↑/↓, which seek to the line's start) — then a little before that start.
 */
export function pausedStart(doc: LyricsDoc, target: number, positionMs: number): number {
  const group = doc.groups[target];
  const ts = group ? groupStart(group) : null;
  if (ts === null || positionMs < ts - 300) return positionMs;
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
