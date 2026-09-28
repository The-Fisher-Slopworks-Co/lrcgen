// Word tapping on the Words step (WordSyncEngine semantics on top of the store's undo history): the selected
// word of the selected group is the tap target; a tap times it and moves on to the next word, then the next group.

import { groupEnd, groupStart, hasWordTimings, isSung, lastStart, setWordStart, wordParts, wordsComplete, type Group, type LyricsDoc } from "../../../core/lyrics";
import type { Range } from "../../audio/song-player";
import { lineSpan, timedLineFrom } from "../../lib/timing";

export const PRE_ROLL_MS = 2000;
/** A word without an end plays to the next word's start, but at most this long. */
export const WORD_PLAY_MS = 1500;

export interface Spot {
  line: number;
  word: number;
}

const hasWords = (group: Group | undefined) => !!group && group.words.length > 0;

/** The first word still without a start, leaving out punctuation-only words ("—"), which needn't be tapped; -1 if none. */
export function firstUntimedWord(group: Group): number {
  return group.words.findIndex((w) => w.start === null && isSung(w));
}

/**
 * Where tapping a group begins: its first word while only the line start is known (the Lines step timed that
 * word, and the Words step times it again, slowed down), else its first word still without a start.
 */
export function firstTapWord(group: Group): number {
  const onlyLineStart = !group.words.slice(1).some((w) => w.start !== null);
  return onlyLineStart ? 0 : Math.max(0, firstUntimedWord(group));
}

/** Some words are tapped, but not all of them (e.g. after a split): the group still counts as to do. */
export function partlyTimed(group: Group): boolean {
  return hasWordTimings(group) && !wordsComplete(group);
}

/** The nearest group from `index` in direction `dir` (including `index`) that has words, or -1. */
export function lineWithWords(doc: LyricsDoc, index: number, dir: 1 | -1): number {
  for (let i = index; i >= 0 && i < doc.groups.length; i += dir) if (hasWords(doc.groups[i])) return i;
  return -1;
}

/**
 * Where tapping starts on arrival. A word picked on purpose (Refine, a chip) is kept; otherwise the first group whose
 * words aren't all timed, at its first word to tap; otherwise (all done) the selected group (or the nearest with words).
 */
export function arrivalSpot(doc: LyricsDoc, sel: { line: number; word: number | null }): Spot | null {
  const selGroup = doc.groups[sel.line];
  if (sel.word !== null && selGroup && sel.word >= 0 && sel.word < selGroup.words.length) return { line: sel.line, word: sel.word };
  for (let i = 0; i < doc.groups.length; i++) {
    const group = doc.groups[i]!;
    if (hasWords(group) && !wordsComplete(group)) return { line: i, word: firstTapWord(group) };
  }
  const line = lineWithWords(doc, sel.line, 1) >= 0 ? lineWithWords(doc, sel.line, 1) : lineWithWords(doc, sel.line, -1);
  return line >= 0 ? { line, word: 0 } : null;
}

/** The word after `spot`: the next word of the group, else the first word of the next group with words; null at the end. */
export function nextSpot(doc: LyricsDoc, spot: Spot): Spot | null {
  const group = doc.groups[spot.line];
  if (group && spot.word + 1 < group.words.length) return { line: spot.line, word: spot.word + 1 };
  const next = lineWithWords(doc, spot.line + 1, 1);
  return next >= 0 ? { line: next, word: 0 } : null;
}

/** The word before `spot`, across groups; null at the start. */
export function prevSpot(doc: LyricsDoc, spot: Spot): Spot | null {
  if (spot.word > 0) return { line: spot.line, word: spot.word - 1 };
  const prev = lineWithWords(doc, spot.line - 1, -1);
  return prev >= 0 ? { line: prev, word: doc.groups[prev]!.words.length - 1 } : null;
}

/** The spot on the next/previous group with words, at its first word to tap. */
export function lineSpot(doc: LyricsDoc, from: number, dir: 1 | -1): Spot | null {
  const line = lineWithWords(doc, from + dir, dir);
  if (line < 0) return null;
  return { line, word: firstTapWord(doc.groups[line]!) };
}

/** Times the word at `spot`; `next` is the word to tap after it (null after the song's last word). */
export function tapWord(doc: LyricsDoc, spot: Spot, ms: number): { doc: LyricsDoc; next: Spot | null } {
  const next = setWordStart(doc, spot.line, spot.word, Math.max(0, Math.round(ms)));
  return { doc: next, next: nextSpot(next, spot) };
}

/**
 * Where playback starts when tapping begins on a group from a pause: 2 s before it. For a group without a start,
 * 2 s before the end of the timed group above it (or its last word's start), or else that group's start.
 */
export function preRollStart(doc: LyricsDoc, lineIndex: number): number {
  const group = doc.groups[lineIndex];
  const start = group ? groupStart(group) : null;
  if (start !== null) return Math.max(0, start - PRE_ROLL_MS);
  const prev = timedLineFrom(doc, lineIndex - 1, -1);
  if (prev < 0) return 0;
  const prevGroup = doc.groups[prev]!;
  // With only its start known, the group above plays from its start.
  const end = groupEnd(prevGroup) ?? (hasWordTimings(prevGroup) ? lastStart(prevGroup) : null);
  return end === null ? groupStart(prevGroup)! : Math.max(0, end - PRE_ROLL_MS);
}

/** The group and word an undo put back: the first group that differs, then the first word whose start differs. */
export function changedSpot(before: LyricsDoc, after: LyricsDoc): Spot | null {
  const n = Math.max(before.groups.length, after.groups.length);
  for (let i = 0; i < n; i++) {
    const a = before.groups[i];
    const b = after.groups[i];
    if (a === b) continue;
    if (!a || !b) return { line: i, word: 0 };
    const m = Math.max(a.words.length, b.words.length);
    for (let j = 0; j < m; j++) {
      const wa = a.words[j];
      const wb = b.words[j];
      if (wa?.start !== wb?.start || wa?.text !== wb?.text) return { line: i, word: Math.min(j, Math.max(0, b.words.length - 1)) };
    }
    return { line: i, word: 0 };
  }
  return null;
}

/**
 * What W plays: exactly the word, from its start to its end. Without an end, to the next timed word (or the group's
 * end, or the next line), at most WORD_PLAY_MS.
 */
export function wordSpan(doc: LyricsDoc, spot: Spot, durationMs: number): Range | null {
  const group = doc.groups[spot.line];
  const word = group?.words[spot.word];
  const start = word?.start;
  if (!group || !word || start == null) return null;
  if (word.end !== null && word.end > start) return { from: start, to: word.end };
  const after = group.words.slice(spot.word + 1).find((w) => w.start !== null && w.start > start)?.start;
  const end = after ?? groupEnd(group) ?? lineSpan(doc, spot.line, durationMs)?.to ?? null;
  const to = end !== null && end > start ? Math.min(end, start + WORD_PLAY_MS) : start + 800;
  return { from: start, to: durationMs > 0 ? Math.min(to, durationMs) : to };
}

/** "Words done in 9 of 12 lines": groups with words, and those whose words are all timed (as the header counts them). */
export function wordCounts(doc: LyricsDoc): { done: number; total: number } {
  const groups = doc.groups.filter(hasWords);
  return { done: groups.filter(wordsComplete).length, total: groups.length };
}

const SHORT_WORD = 3;

/**
 * Short words ("I'm", "to", "и", "на") in a group that has no joined words yet: often sung as one sound with the
 * next word. The last word is left out, since there is nothing to join it with.
 */
export function shortWords(group: Group | undefined): string[] {
  if (!group) return [];
  if (group.words.some((w) => wordParts(w).length > 1)) return [];
  const found: string[] = [];
  for (const w of group.words.slice(0, -1)) {
    const letters = w.text.replace(/[^\p{L}\p{N}]/gu, "");
    if (letters.length > 0 && letters.length <= SHORT_WORD && !found.includes(w.text)) found.push(w.text);
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
