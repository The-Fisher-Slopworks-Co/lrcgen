// Retapping a group: tap a key as each word starts. Only starts change: a word lasts until the next one, and an end
// set on purpose stays (unless the new start passes it). Works on a copy of the document, which becomes one undo
// step when the retap ends.

import { setWordStart, type LyricsDoc } from "../../../core/lyrics";

export interface Retap {
  group: number;
  /** The words to tap, by index, in order. */
  order: number[];
  /** Position in `order` of the word to tap next. */
  at: number;
  /** Where the word tapped last starts, until the next tap; null before the first tap and after a step back. */
  tapped: number | null;
  /** The document as retapped so far. */
  doc: LyricsDoc;
  /** How many words got new times. */
  done: number;
  /** Playback speed before the retap, put back after it. */
  rate: number;
}

/** How far before a word playback starts, so its start can be caught. */
export const RETAP_PRE_ROLL_MS = 1500;

/** Starts retapping `group` from word `from` (its first word when null). Null when the group has no words. */
export function beginRetap(doc: LyricsDoc, group: number, from: number | null, rate: number): Retap | null {
  const words = doc.groups[group]?.words ?? [];
  if (words.length === 0) return null;
  const first = from !== null && from >= 0 && from < words.length ? from : 0;
  return { group, order: words.map((_, i) => i).slice(first), at: 0, tapped: null, doc, done: 0, rate };
}

/** The word to tap next, by index in its group; null when every word is done. */
export function currentWord(r: Retap): number | null {
  return r.order[r.at] ?? null;
}

/** A tap at `ms`: the current word starts there, and the next one is up. */
export function tapAt(r: Retap, ms: number): Retap {
  const word = currentWord(r);
  if (word === null) return r;
  const start = Math.max(0, Math.round(ms));
  return { ...r, at: r.at + 1, tapped: start, done: r.done + 1, doc: setWordStart(r.doc, r.group, word, start) };
}

/** Back to the word before, to tap it again. */
export function stepBack(r: Retap): Retap {
  if (r.at === 0) return r;
  return { ...r, at: r.at - 1, tapped: null };
}

export function retapDone(r: Retap): boolean {
  return r.at >= r.order.length;
}

/** Where playback goes to (re)tap the current word: a little before where it started (or the group's first start). */
export function preRollFor(r: Retap, fallbackMs: number): number {
  const word = currentWord(r);
  const words = r.doc.groups[r.group]?.words ?? [];
  const known = (word !== null ? words[word]?.start : null) ?? words.find((w) => w.start !== null)?.start ?? fallbackMs;
  return Math.max(0, known - RETAP_PRE_ROLL_MS);
}
