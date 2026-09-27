import type { LrcDocument, LrcLine, LrcWord } from "./lrc-document";
import { hasWordTimings, splitWords, withText } from "./lrc-document";

function hasTimings(line: LrcLine): boolean {
  return line.timestamp !== null || hasWordTimings(line);
}

/** For each line of `lines`, the index of the line in `candidates` it matches; matching only moves forward. Empty lines never match. */
function matchInOrder(lines: LrcLine[], candidates: LrcLine[], key: (line: LrcLine) => string): (number | null)[] {
  const keys = candidates.map(key);
  let next = 0;
  return lines.map((line) => {
    const k = key(line);
    if (k === "") return null;
    const j = keys.indexOf(k, next);
    if (j === -1) return null;
    next = j + 1;
    return j;
  });
}

/** The line's timings (start, words, end) with `text`, which must spell out the same words. */
function timingsWithText(timed: LrcLine, line: LrcLine): LrcLine {
  const { words: _words, end: _end, ...rest } = line;
  const result: LrcLine = { ...rest, timestamp: timed.timestamp };
  if (timed.words) result.words = timed.words;
  if (timed.end != null) result.end = timed.end;
  return result;
}

/**
 * Swaps in new lyrics, keeping timings (line and word) for lines whose text still matches
 * one of the old lines, matched in order. Returns how many lines kept their timings.
 * Lines match ignoring case, punctuation and extra whitespace; the new text wins, and word timings survive
 * a changed text the way they survive a typo fix (same number of parts), otherwise only the line start does.
 */
export function replaceLyrics(doc: LrcDocument, lines: LrcLine[]): { doc: LrcDocument; kept: number } {
  const matches = matchInOrder(lines, doc.lines, (line) => normalize(line.text));
  let kept = 0;
  const merged = lines.map((line, i) => {
    const old = matches[i] == null ? undefined : doc.lines[matches[i]!];
    if (!old || !hasTimings(old)) return line;
    kept++;
    return old.text.trim() === line.text.trim() ? timingsWithText(old, line) : withText(old, line.text);
  });
  return { doc: { ...doc, lines: merged }, kept };
}

// Transcriptions and lyrics sites disagree on case, punctuation and quotes; "ё" is often written as "е".
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/['’‘`´ʼ]/g, "")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How many whitespace-separated parts of the word are more than punctuation. */
function partsOf(word: LrcWord): number {
  return (word.text.match(/\S+/g) ?? []).filter((part) => normalize(part) !== "").length;
}

/**
 * The words of `shape` with starts taken from `source` part by part (punctuation-only parts like "—" don't count):
 * a word gets the start of the source word its first part lines up with, or null if that part sits inside a joined
 * source word or the word is only punctuation. Null if the parts don't line up.
 */
function mapStarts(shape: LrcWord[], source: LrcWord[]): LrcWord[] | null {
  const starts = source.flatMap((w) => Array.from({ length: partsOf(w) }, (_, k) => (k === 0 ? w.start : null)));
  const sizes = shape.map(partsOf);
  if (sizes.reduce((a, b) => a + b, 0) !== starts.length) return null;
  let part = 0;
  return shape.map((w, i) => {
    const start = sizes[i] === 0 ? null : (starts[part] ?? null);
    part += sizes[i]!;
    return { start, text: w.text };
  });
}

function adoptedWords(line: LrcLine, source: LrcLine): LrcWord[] | null {
  const words = source.words!;
  if (words.map((w) => w.text).join("") === line.text.trim()) return words;
  // Keep the line's own joins if it has them, else split its text afresh.
  const shapes = line.words ? [line.words, splitWords(line.text)] : [splitWords(line.text)];
  for (const shape of shapes) {
    const mapped = mapStarts(shape, words);
    if (mapped) return mapped;
  }
  return null;
}

/**
 * Copies word timings (and the line start) from `source` onto the lines of `doc` whose text matches,
 * ignoring case, punctuation and extra whitespace; lines are matched in order. The text of `doc` wins.
 * Used for "Use transcription" on the Words step. Returns how many lines got word timings.
 */
export function adoptWordTimings(doc: LrcDocument, source: LrcLine[]): { doc: LrcDocument; adopted: number } {
  const matches = matchInOrder(doc.lines, source, (line) => normalize(line.text));
  let adopted = 0;
  const lines = doc.lines.map((line, i) => {
    const from = matches[i] == null ? undefined : source[matches[i]!];
    if (!from || !hasWordTimings(from)) return line;
    const words = adoptedWords(line, from);
    if (!words) return line;
    adopted++;
    return timingsWithText({ ...from, timestamp: from.timestamp ?? line.timestamp, words }, line);
  });
  return { doc: { ...doc, lines }, adopted };
}

/**
 * Puts the timings of a lyrics sync ("align" job) onto the lines of `doc`, which the sync was run on.
 * Lines are matched like adoptWordTimings (so edits made while it ran don't shift anything). A matched line
 * takes the new start and word timings; if only its start was found, its old word timings go too, as they'd
 * no longer fit. Returns how many lines got a start.
 */
export function applyAlignment(doc: LrcDocument, source: LrcLine[]): { doc: LrcDocument; synced: number } {
  const matches = matchInOrder(doc.lines, source, (line) => normalize(line.text));
  let synced = 0;
  const lines = doc.lines.map((line, i) => {
    const from = matches[i] == null ? undefined : source[matches[i]!];
    if (!from || from.timestamp === null) return line;
    synced++;
    const words = hasWordTimings(from) ? adoptedWords(line, from) : null;
    if (words) return timingsWithText({ ...from, words }, line);
    const { words: _words, end: _end, ...rest } = line;
    return { ...rest, timestamp: from.timestamp };
  });
  return { doc: { ...doc, lines }, synced };
}
