import { groupEnd, groupStart, isLabelled, type Group, type LyricsDoc } from "./lyrics";

/** The line playing at `ms`: the last line (unlabelled group) that started at or before it, or -1. */
export function lineIndexAt(doc: LyricsDoc, ms: number): number {
  let found = -1;
  doc.groups.forEach((g, i) => {
    if (isLabelled(g)) return;
    const start = groupStart(g);
    if (start !== null && start <= ms) found = i;
  });
  return found;
}

/** The word playing at `ms` within a group: the last timed word that started at or before it, or -1. */
export function wordIndexAt(group: Group, ms: number): number {
  let found = -1;
  group.words.forEach((word, i) => {
    if (word.start !== null && word.start <= ms) found = i;
  });
  return found;
}

/**
 * How much of word `wordIndex` has been sung at `ms`, 0–1: it fills from its start to its end, or without an end
 * to the next word's start (or the group's end, or `fallbackEndMs` for the last word). Untimed words are skipped
 * when looking for the next start; an untimed word fills along with the timed word before it, as it does in
 * Enhanced LRC. With no end known at all, a word is full as soon as it starts.
 */
export function wordFill(group: Group, wordIndex: number, ms: number, fallbackEndMs: number | null): number {
  const words = group.words;
  let index = wordIndex;
  while (index >= 0 && words[index]?.start === null) index--;
  const word = words[index];
  const start = word?.start;
  if (!word || start == null || ms < start) return 0;
  const next = words.slice(index + 1).find((w) => w.start !== null)?.start;
  const end = word.end ?? next ?? groupEnd(group) ?? fallbackEndMs;
  if (end === null || end <= start) return 1;
  return Math.min(1, Math.max(0, (ms - start) / (end - start)));
}
