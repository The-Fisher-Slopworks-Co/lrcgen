// Refine edits the selected word's start, or the line's start when no word is selected. Moving a line start
// drags its words along (core `setTimestamp`); moving the first word also moves the line start (`setWordStart`).

import { setTimestamp, setWordStart, wordsOf, type LrcDocument } from "../../../core/lrc-document";

export interface Target {
  line: number;
  /** Null = the line start. */
  word: number | null;
}

/** When the target starts, or null when it has no time yet. */
export function targetStart(doc: LrcDocument, target: Target): number | null {
  const line = doc.lines[target.line];
  if (!line) return null;
  if (target.word === null) return line.timestamp;
  return line.words?.[target.word]?.start ?? null;
}

/** Makes the target start at `ms` (clamped to the song), timed or not. Returns `doc` when nothing changes. */
export function moveTarget(doc: LrcDocument, target: Target, ms: number, durationMs: number): LrcDocument {
  const line = doc.lines[target.line];
  if (!line) return doc;
  const to = Math.round(Math.min(durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY, Math.max(0, ms)));
  if (target.word === null) {
    if (line.timestamp === to) return doc;
    return setTimestamp(doc, target.line, to);
  }
  const word = wordsOf(line)[target.word];
  if (!word || word.start === to) return doc;
  return setWordStart(doc, target.line, target.word, to);
}

/** Shifts a timed target by `deltaMs`; an untimed one stays put. */
export function nudgeTarget(doc: LrcDocument, target: Target, deltaMs: number, durationMs: number): LrcDocument {
  const start = targetStart(doc, target);
  return start === null ? doc : moveTarget(doc, target, start + deltaMs, durationMs);
}

/** Tab / Shift+Tab: the next or previous word; before the first word comes the line start (null). */
export function stepWord(wordCount: number, word: number | null, dir: 1 | -1): number | null {
  if (wordCount === 0) return null;
  if (word === null) return dir > 0 ? 0 : wordCount - 1;
  const next = word + dir;
  if (next < 0) return null;
  return Math.min(next, wordCount - 1);
}

/** Parses a typed start time: "00:42.83", "0:42.8", "42.83" or "42". Null when it isn't a time. */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(",", ".");
  const m = t.match(/^(?:(\d+):)?(\d{1,2}|\d+)(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const minutes = m[1] ? parseInt(m[1], 10) : 0;
  const secs = parseInt(m[2]!, 10);
  if (m[1] && secs >= 60) return null;
  const frac = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) : 0;
  return (minutes * 60 + secs) * 1000 + frac;
}
