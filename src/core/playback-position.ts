import type { LrcDocument, LrcLine } from "./lrc-document";
import { lineEnd } from "./lrc-document";

/** The line playing at `ms`: the last timed line that started at or before it, or -1. */
export function lineIndexAt(doc: LrcDocument, ms: number): number {
  let found = -1;
  doc.lines.forEach((line, i) => {
    if (line.timestamp !== null && line.timestamp <= ms) found = i;
  });
  return found;
}

/** The word playing at `ms` within a line: the last timed word that started at or before it, or -1. */
export function wordIndexAt(line: LrcLine, ms: number): number {
  let found = -1;
  line.words?.forEach((word, i) => {
    if (word.start !== null && word.start <= ms) found = i;
  });
  return found;
}

/**
 * How much of word `wordIndex` has been sung at `ms`, 0–1: it fills from its start to the next word's start
 * (or the line's end, or `fallbackEndMs` for the last word). Untimed words are skipped when looking for the next
 * start; an untimed word itself fills along with the timed word before it, as it does in Enhanced LRC.
 * With no end known at all, a word is full as soon as it starts.
 */
export function wordFill(line: LrcLine, wordIndex: number, ms: number, fallbackEndMs: number | null): number {
  const words = line.words ?? [];
  let index = wordIndex;
  while (index >= 0 && words[index]?.start === null) index--;
  const start = words[index]?.start;
  if (start == null || ms < start) return 0;
  const next = words.slice(index + 1).find((w) => w.start !== null)?.start;
  const end = next ?? lineEnd(line) ?? fallbackEndMs;
  if (end === null || end <= start) return 1;
  return Math.min(1, Math.max(0, (ms - start) / (end - start)));
}
