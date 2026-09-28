// Small timing questions about a document that several screens ask.

import { groupEnd, groupStart, isLabelled, isTimed, lastStart, type LyricsDoc } from "../../core/lyrics";
import type { Range } from "../audio/song-player";

/** How long a line with nothing after it is assumed to last. */
export const LAST_LINE_MS = 8000;
/** How long a backing vocal or ad-lib without an end is assumed to last after its last word starts. */
export const LAST_WORD_MS = 1500;

/**
 * Where group `index` plays: exactly from its start to its end when its words know where it ends. Otherwise a
 * line (unlabelled group) plays to the next line's start (or `LAST_LINE_MS` later, capped at the song's end), and
 * a labelled group to `LAST_WORD_MS` after its last word starts. Null when the group has no start yet.
 */
export function lineSpan(doc: LyricsDoc, index: number, durationMs: number): Range | null {
  const group = doc.groups[index];
  const from = group ? groupStart(group) : null;
  if (!group || from === null) return null;
  const cap = durationMs > from ? durationMs : Number.POSITIVE_INFINITY;
  const end = groupEnd(group);
  if (end !== null && end > from) return { from, to: end };
  if (isLabelled(group)) return { from, to: Math.min(lastStart(group)! + LAST_WORD_MS, cap) };
  for (let i = index + 1; i < doc.groups.length; i++) {
    const g = doc.groups[i]!;
    const t = isLabelled(g) ? null : groupStart(g);
    if (t !== null && t > from) return { from, to: t };
  }
  return { from, to: Math.min(from + LAST_LINE_MS, cap) };
}

/** Index of the nearest group in direction `dir` from `index` that has a start time, or -1. */
export function timedLineFrom(doc: LyricsDoc, index: number, dir: 1 | -1): number {
  for (let i = index; i >= 0 && i < doc.groups.length; i += dir) if (isTimed(doc.groups[i]!)) return i;
  return -1;
}

/** Any word has a time. */
export function hasTimings(doc: LyricsDoc): boolean {
  return doc.groups.some(isTimed);
}
