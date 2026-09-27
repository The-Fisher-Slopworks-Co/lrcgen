// Small timing questions about a document that several screens ask.

import { hasWordTimings, lineEnd, type LrcDocument } from "../../core/lrc-document";
import type { Range } from "../audio/song-player";

/** How long a line with nothing after it is assumed to last. */
export const LAST_LINE_MS = 8000;

/**
 * Where line `index` plays: from its start to the next timed line's start (or its own end, or
 * `LAST_LINE_MS` later, capped at the song's end). Null when the line has no start yet.
 */
export function lineSpan(doc: LrcDocument, index: number, durationMs: number): Range | null {
  const line = doc.lines[index];
  if (!line || line.timestamp === null) return null;
  const from = line.timestamp;
  for (let i = index + 1; i < doc.lines.length; i++) {
    const t = doc.lines[i]!.timestamp;
    if (t !== null && t > from) return { from, to: t };
  }
  const end = lineEnd(line);
  if (end !== null && end > from) return { from, to: end };
  const cap = durationMs > from ? durationMs : Number.POSITIVE_INFINITY;
  return { from, to: Math.min(from + LAST_LINE_MS, cap) };
}

/** Index of the nearest line in direction `dir` from `index` that has a start time, or -1. */
export function timedLineFrom(doc: LrcDocument, index: number, dir: 1 | -1): number {
  for (let i = index; i >= 0 && i < doc.lines.length; i += dir) if (doc.lines[i]!.timestamp !== null) return i;
  return -1;
}

/** Any line or word has a time. */
export function hasTimings(doc: LrcDocument): boolean {
  return doc.lines.some((l) => l.timestamp !== null || hasWordTimings(l));
}
