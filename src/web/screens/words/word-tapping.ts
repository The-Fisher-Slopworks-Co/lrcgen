// Word tapping on the Words step (WordSyncEngine semantics on top of the store's undo history): the selected
// word of the selected line is the tap target; a tap times it and moves on to the next word, then the next line.

import { hasWordTimings, lineEnd, setWordStart, wordsComplete, wordsOf, type LrcDocument, type LrcLine } from "../../../core/lrc-document";
import { wordParts } from "../../../core/word-edit";
import type { Range } from "../../audio/song-player";
import { lineSpan, timedLineFrom } from "../../lib/timing";

export const PRE_ROLL_MS = 2000;

export interface Spot {
  line: number;
  word: number;
}

const hasWords = (line: LrcLine | undefined) => !!line && wordsOf(line).length > 0;

/** The first word still without a start, leaving out punctuation-only words ("— "), which needn't be tapped; -1 if none. */
export function firstUntimedWord(line: LrcLine): number {
  return wordsOf(line).findIndex((w) => w.start === null && /[\p{L}\p{N}]/u.test(w.text));
}

/** Some words are tapped, but not all of them (e.g. after a split): the line still counts as to do. */
export function partlyTimed(line: LrcLine): boolean {
  return hasWordTimings(line) && !wordsComplete(line);
}

/** The nearest line from `index` in direction `dir` (including `index`) that has words, or -1. */
export function lineWithWords(doc: LrcDocument, index: number, dir: 1 | -1): number {
  for (let i = index; i >= 0 && i < doc.lines.length; i += dir) if (hasWords(doc.lines[i])) return i;
  return -1;
}

/**
 * Where tapping starts on arrival. A word picked on purpose (Refine, a chip) is kept; otherwise the first line whose
 * words aren't all timed, at its first untimed word; otherwise (all done) the selected line (or the nearest with words).
 */
export function arrivalSpot(doc: LrcDocument, sel: { line: number; word: number | null }): Spot | null {
  const selLine = doc.lines[sel.line];
  if (sel.word !== null && selLine && sel.word >= 0 && sel.word < wordsOf(selLine).length) return { line: sel.line, word: sel.word };
  for (let i = 0; i < doc.lines.length; i++) {
    const line = doc.lines[i]!;
    if (hasWords(line) && !wordsComplete(line)) return { line: i, word: Math.max(0, firstUntimedWord(line)) };
  }
  const line = lineWithWords(doc, sel.line, 1) >= 0 ? lineWithWords(doc, sel.line, 1) : lineWithWords(doc, sel.line, -1);
  return line >= 0 ? { line, word: 0 } : null;
}

/** The word after `spot`: the next word of the line, else the first word of the next line with words; null at the end. */
export function nextSpot(doc: LrcDocument, spot: Spot): Spot | null {
  const line = doc.lines[spot.line];
  if (line && spot.word + 1 < wordsOf(line).length) return { line: spot.line, word: spot.word + 1 };
  const next = lineWithWords(doc, spot.line + 1, 1);
  return next >= 0 ? { line: next, word: 0 } : null;
}

/** The word before `spot`, across lines; null at the start. */
export function prevSpot(doc: LrcDocument, spot: Spot): Spot | null {
  if (spot.word > 0) return { line: spot.line, word: spot.word - 1 };
  const prev = lineWithWords(doc, spot.line - 1, -1);
  return prev >= 0 ? { line: prev, word: wordsOf(doc.lines[prev]!).length - 1 } : null;
}

/** The spot on the next/previous line with words: its first untimed word, else its first word. */
export function lineSpot(doc: LrcDocument, from: number, dir: 1 | -1): Spot | null {
  const line = lineWithWords(doc, from + dir, dir);
  if (line < 0) return null;
  return { line, word: Math.max(0, firstUntimedWord(doc.lines[line]!)) };
}

/** Times the word at `spot`; `next` is the word to tap after it (null after the song's last word). */
export function tapWord(doc: LrcDocument, spot: Spot, ms: number): { doc: LrcDocument; next: Spot | null } {
  const next = setWordStart(doc, spot.line, spot.word, Math.max(0, Math.round(ms)));
  return { doc: next, next: nextSpot(next, spot) };
}

/**
 * Where playback starts when tapping begins on a line from a pause: 2 s before the line. For a line without a
 * start, 2 s before the end of the line above it (its end tag or last word), or else that line's start.
 */
export function preRollStart(doc: LrcDocument, lineIndex: number): number {
  const line = doc.lines[lineIndex];
  if (line?.timestamp != null) return Math.max(0, line.timestamp - PRE_ROLL_MS);
  const prev = timedLineFrom(doc, lineIndex - 1, -1);
  if (prev < 0) return 0;
  const prevLine = doc.lines[prev]!;
  const lastWord = Math.max(...wordsOf(prevLine).map((w) => w.start ?? -1));
  const end = lineEnd(prevLine) ?? (lastWord >= 0 ? lastWord : null);
  return end === null ? prevLine.timestamp! : Math.max(0, end - PRE_ROLL_MS);
}

/** The line and word an undo put back: the first line that differs, then the first word whose start differs. */
export function changedSpot(before: LrcDocument, after: LrcDocument): Spot | null {
  const n = Math.max(before.lines.length, after.lines.length);
  for (let i = 0; i < n; i++) {
    const a = before.lines[i];
    const b = after.lines[i];
    if (a === b) continue;
    if (!a || !b) return { line: i, word: 0 };
    const wa = wordsOf(a);
    const wb = wordsOf(b);
    const m = Math.max(wa.length, wb.length);
    for (let j = 0; j < m; j++) {
      if (wa[j]?.start !== wb[j]?.start || wa[j]?.text !== wb[j]?.text) return { line: i, word: Math.min(j, Math.max(0, wb.length - 1)) };
    }
    return { line: i, word: 0 };
  }
  return null;
}

/** What W plays: the word from its start to the next timed word (or the line's end, or the next line), at most 1.5 s. */
export function wordSpan(doc: LrcDocument, spot: Spot, durationMs: number): Range | null {
  const line = doc.lines[spot.line];
  if (!line) return null;
  const words = wordsOf(line);
  const start = words[spot.word]?.start;
  if (start == null) return null;
  const after = words.slice(spot.word + 1).find((w) => w.start !== null && w.start > start)?.start;
  const end = after ?? lineEnd(line) ?? lineSpan(doc, spot.line, durationMs)?.to ?? null;
  const to = end !== null && end > start ? Math.min(end, start + 1500) : start + 800;
  return { from: start, to: durationMs > 0 ? Math.min(to, durationMs) : to };
}

/** "Words done in 9 of 12 lines": lines with text, and those whose words are all timed (as the header counts them). */
export function wordCounts(doc: LrcDocument): { done: number; total: number } {
  const lines = doc.lines.filter((l) => l.text.trim() !== "");
  return { done: lines.filter(wordsComplete).length, total: lines.length };
}

const SHORT_WORD = 3;

/**
 * Short words ("I'm", "to", "и", "на") in a line that has no joined words yet: often sung as one sound with the
 * next word. The last word is left out, since there is nothing to join it with.
 */
export function shortWords(line: LrcLine | undefined): string[] {
  if (!line) return [];
  const words = wordsOf(line);
  if (words.some((w) => wordParts(w).length > 1)) return [];
  const found: string[] = [];
  for (const w of words.slice(0, -1)) {
    const text = w.text.trim();
    const letters = text.replace(/[^\p{L}\p{N}]/gu, "");
    if (letters.length > 0 && letters.length <= SHORT_WORD && !found.includes(text)) found.push(text);
  }
  return found;
}

/** Splits a flag message so times ("00:49.12") and durations ("80 ms") can be set in mono. */
export function messageParts(message: string): { text: string; mono: boolean }[] {
  const parts: { text: string; mono: boolean }[] = [];
  const re = /\d{2}:\d{2}\.\d{2}|\d+ ms/g;
  let last = 0;
  for (const m of message.matchAll(re)) {
    if (m.index > last) parts.push({ text: message.slice(last, m.index), mono: false });
    parts.push({ text: m[0], mono: true });
    last = m.index + m[0].length;
  }
  if (last < message.length) parts.push({ text: message.slice(last), mono: false });
  return parts;
}
