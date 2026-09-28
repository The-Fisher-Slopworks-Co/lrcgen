// What the Refine timeline draws: a block per timed word from its start to its end — or, for a word without an
// end, to the next word (or its group's end) as a guess — the band behind each group's words, and which row each
// group goes in: lines on the "Lines" rows, labelled groups (backing vocals, ad-libs) on the "Labelled" rows. A
// row is added only where groups around the view overlap in time.

import type { Flag } from "../../../core/flags";
import { flagTime } from "../../../core/flags";
import { groupEnd, isLabelled, wordParts, type Group, type LyricsDoc } from "../../../core/lyrics";
import { lineSpan } from "../../lib/timing";
import type { View } from "./timeline-view";

export interface WordBlock {
  group: number;
  /** Index of the word in its group. */
  word: number;
  id: string;
  /** The word's parts ("I’m", "here" for a joined word). */
  parts: string[];
  start: number;
  end: number;
  /** The word has no end of its own: `end` is where the next word starts (or the group ends). */
  derived: boolean;
  /** Where the dotted marks go inside a joined word, ms (proportional to the parts' lengths). */
  splits: number[];
}

export interface GroupBand {
  group: number;
  start: number;
  end: number;
  row: number;
  labelled: boolean;
}

/** The last word of a group with no end known is drawn this long at most. */
export const LAST_WORD_MS = 3000;
/** Words sharing a start still get a block this wide, so they can be grabbed. */
export const MIN_BLOCK_MS = 120;

/**
 * Blocks for a group's timed words, and its untimed words for the ghost strip. `fallbackEnd` is where the last
 * word may run to when nothing else says (usually the next line's start).
 */
export function groupBlocks(doc: LyricsDoc, index: number, durationMs: number): { blocks: WordBlock[]; untimed: { word: number; text: string }[] } {
  const group = doc.groups[index];
  const blocks: WordBlock[] = [];
  const untimed: { word: number; text: string }[] = [];
  if (!group) return { blocks, untimed };
  const fallback = lineSpan(doc, index, durationMs)?.to ?? null;
  group.words.forEach((w, i) => {
    if (w.start === null) {
      untimed.push({ word: i, text: w.text });
      return;
    }
    const { end, derived } = blockEnd(group, i, fallback);
    const parts = wordParts(w);
    blocks.push({ group: index, word: i, id: w.id, parts, start: w.start, end, derived, splits: splitMarks(parts, w.start, end) });
  });
  return { blocks, untimed };
}

/** Where a timed word's block ends: its own end, or the next start in time (not in word order), or the group's end. */
export function blockEnd(group: Group, wordIndex: number, fallbackEnd: number | null): { end: number; derived: boolean } {
  const word = group.words[wordIndex]!;
  const start = word.start!;
  if (word.end !== null && word.end > start) return { end: word.end, derived: false };
  // The next start in time: an out-of-order word must not cover the one it jumped over.
  let next: number | null = null;
  group.words.forEach((w, j) => {
    if (w.start !== null && (w.start > start || (w.start === start && j > wordIndex)) && (next === null || w.start < next)) next = w.start;
  });
  let to = next ?? groupEnd(group) ?? Math.min(fallbackEnd ?? Number.POSITIVE_INFINITY, start + LAST_WORD_MS);
  if (!(to > start + MIN_BLOCK_MS)) to = start + MIN_BLOCK_MS;
  return { end: to, derived: true };
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

export interface TimelineRows {
  bands: GroupBand[];
  blocks: WordBlock[];
  /** Rows for lines, then rows for labelled groups (always at least one of each). */
  lineRows: number;
  labelledRows: number;
}

/** Groups overlapping by less than this still share a row (a line's last word often runs into the next line). */
export const ROW_OVERLAP_MS = 250;

/** Packs bands into as few rows as possible: each goes in the first row where the one before it has (about) ended. */
function pack(bands: GroupBand[], firstRow: number): number {
  const ends: number[] = [];
  for (const band of bands.sort((a, b) => a.start - b.start)) {
    let row = ends.findIndex((end) => end - ROW_OVERLAP_MS <= band.start);
    if (row < 0) {
      row = ends.length;
      ends.push(band.end);
    } else ends[row] = band.end;
    band.row = firstRow + row;
  }
  return ends.length;
}

/** The groups around `view` (a view's width either side) as bands in rows, with their word blocks. */
export function timelineRows(doc: LyricsDoc, view: View, durationMs: number): TimelineRows {
  const from = view.startMs - view.spanMs;
  const to = view.startMs + view.spanMs * 2;
  const lines: GroupBand[] = [];
  const labelled: GroupBand[] = [];
  const blocks: WordBlock[] = [];
  doc.groups.forEach((g, i) => {
    const own = groupBlocks(doc, i, durationMs).blocks;
    if (own.length === 0) return;
    const start = Math.min(...own.map((b) => b.start));
    const end = Math.max(...own.map((b) => b.end));
    if (end < from || start > to) return;
    blocks.push(...own);
    (isLabelled(g) ? labelled : lines).push({ group: i, start, end, row: 0, labelled: isLabelled(g) });
  });
  const lineRows = Math.max(1, pack(lines, 0));
  const labelledRows = Math.max(1, pack(labelled, lineRows));
  return { bands: [...lines, ...labelled], blocks, lineRows, labelledRows };
}

/** The short note next to a flagged spot on the timeline: "80 ms before voice", "out of order". */
export function flagNote(doc: LyricsDoc, flag: Flag): string {
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
