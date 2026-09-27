// What the Refine words lane draws for a line: one block per timed word, from its start to the next start
// in time (or the line's end), the split marks inside joined words, and the untimed words for the ghost strip.

import type { Flag } from "../../../core/flags";
import { hasWordTimings, lineEnd, type LrcDocument, type LrcLine } from "../../../core/lrc-document";
import { wordParts } from "../../../core/word-edit";

export interface WordBlock {
  /** Index of the word in the line. */
  index: number;
  /** The word's parts ("I’m", "here" for a joined word). */
  parts: string[];
  start: number;
  end: number;
  /** Where the dotted marks go inside a joined word, ms (proportional to the parts' lengths). */
  splits: number[];
}

export interface LineBlocks {
  blocks: WordBlock[];
  /** Words without a start yet (a split's second half, a word the tap missed). */
  untimed: { index: number; text: string }[];
}

/** The last word of a line with no end known runs this long at most. */
export const LAST_WORD_MS = 3000;
/** Words sharing a start still get a block this wide, so they can be grabbed. */
export const MIN_BLOCK_MS = 120;

/**
 * Blocks for a line's timed words. `fallbackEnd` is where the line's last word may run to when the line has
 * no end of its own (usually the next line's start).
 */
export function lineBlocks(line: LrcLine | undefined, fallbackEnd: number | null): LineBlocks {
  const words = line?.words ?? [];
  const blocks: WordBlock[] = [];
  const untimed: { index: number; text: string }[] = [];
  const end = line ? lineEnd(line) : null;
  words.forEach((word, index) => {
    if (word.start === null) {
      untimed.push({ index, text: word.text.trim() });
      return;
    }
    const start = word.start;
    // The next start in time, not in word order: an out-of-order word must not cover the one it jumped over.
    const later = words.flatMap((w, j) => (w.start !== null && (w.start > start || (w.start === start && j > index)) ? [w.start] : []));
    const next = later.length > 0 ? Math.min(...later) : null;
    let to = next ?? end ?? Math.min(fallbackEnd ?? Number.POSITIVE_INFINITY, start + LAST_WORD_MS);
    if (!(to > start + MIN_BLOCK_MS)) to = start + MIN_BLOCK_MS;
    const parts = wordParts(word);
    blocks.push({ index, parts, start, end: to, splits: splitMarks(parts, start, to) });
  });
  return { blocks, untimed };
}

function splitMarks(parts: string[], start: number, end: number): number[] {
  if (parts.length < 2) return [];
  const total = parts.reduce((n, p) => n + p.length, 0) + parts.length - 1;
  const marks: number[] = [];
  let chars = 0;
  for (let i = 0; i < parts.length - 1; i++) {
    chars += parts[i]!.length + 1;
    marks.push(start + ((end - start) * chars) / total);
  }
  return marks;
}

/** A dimmed block for a word of a neighbouring line at the edge of the view. */
export interface EdgeWord {
  lineIndex: number;
  text: string;
  start: number;
  end: number;
}

/** The previous line's last timed word and the next line's first one (or those lines as a whole). */
export function edgeWords(doc: LrcDocument, lineIndex: number): { prev: EdgeWord | null; next: EdgeWord | null } {
  const line = doc.lines[lineIndex];
  const prevIndex = findTimed(doc, lineIndex - 1, -1);
  const nextIndex = findTimed(doc, lineIndex + 1, 1);
  let prev: EdgeWord | null = null;
  let next: EdgeWord | null = null;
  if (prevIndex >= 0) {
    const p = doc.lines[prevIndex]!;
    const { blocks } = lineBlocks(p, line?.timestamp ?? null);
    const last = blocks[blocks.length - 1];
    if (last) prev = { lineIndex: prevIndex, text: last.parts.join(" "), start: last.start, end: last.end };
    else prev = { lineIndex: prevIndex, text: p.text.trim(), start: p.timestamp!, end: lineEnd(p) ?? line?.timestamp ?? p.timestamp! + LAST_WORD_MS };
  }
  if (nextIndex >= 0) {
    const n = doc.lines[nextIndex]!;
    const after = findTimed(doc, nextIndex + 1, 1);
    const { blocks } = lineBlocks(n, after >= 0 ? doc.lines[after]!.timestamp : null);
    const first = blocks[0];
    if (first) next = { lineIndex: nextIndex, text: first.parts.join(" "), start: first.start, end: first.end };
    else next = { lineIndex: nextIndex, text: n.text.trim(), start: n.timestamp!, end: n.timestamp! + LAST_WORD_MS };
  }
  return { prev, next };
}

function findTimed(doc: LrcDocument, from: number, dir: 1 | -1): number {
  for (let i = from; i >= 0 && i < doc.lines.length; i += dir) {
    const l = doc.lines[i]!;
    if (l.timestamp !== null && l.text.trim() !== "") return i;
  }
  return -1;
}

/** The line has words to show in the lane (at least one timed word). */
export function hasBlocks(line: LrcLine | undefined): boolean {
  return !!line && hasWordTimings(line);
}

/** Where a flag points in the song: its word's start, else its line's start. */
export function flagTime(doc: LrcDocument, flag: Flag): number | null {
  const line = doc.lines[flag.lineIndex];
  if (!line) return null;
  if (flag.wordIndex !== undefined) return line.words?.[flag.wordIndex]?.start ?? line.timestamp;
  return line.timestamp;
}

/** The short note next to a flagged spot on the timeline: "80 ms before voice", "out of order". */
export function flagNote(doc: LrcDocument, flag: Flag): string {
  switch (flag.kind) {
    case "starts-in-silence": {
      const t = flagTime(doc, flag);
      return t !== null && flag.suggestMs !== undefined ? `${Math.round(flag.suggestMs - t)} ms before voice` : "starts in silence";
    }
    case "words-out-of-order":
      return "out of order";
    case "lines-out-of-order":
      return "before the line above";
  }
}
