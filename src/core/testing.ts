// Helpers for tests: documents written the short way. Not used by the app.

import { groupsFromLrcLines, type LrcLine } from "./lrc-lines";
import { createDoc, withUniqueIds, type Group, type LyricsDoc, type Word } from "./lyrics";

/** A document from LRC-style lines: `{ timestamp: 1000, text: "Hi there" }` is a group whose first word starts at 1000. */
export function docOf(...lines: LrcLine[]): LyricsDoc {
  return createDoc({}, groupsFromLrcLines(lines));
}

/**
 * A group of `text`'s words (split at spaces; "a_b" is one joined word "a b") with `starts` and `ends` in word
 * order, and `labels`. Ids are filled in by `doc`.
 */
export function group(text: string, starts: (number | null)[] = [], ends: (number | null)[] = [], labels: string[] = []): Group {
  const words: Word[] = text
    .split(/\s+/)
    .filter((t) => t !== "")
    .map((t, i) => ({ id: "", text: t.replace(/_/g, " "), start: starts[i] ?? null, end: ends[i] ?? null }));
  return { id: "", labels, words };
}

/** A document of `groups`, with fresh ids. */
export function doc(...groups: Group[]): LyricsDoc {
  return createDoc({}, withUniqueIds(groups));
}

export const startsOf = (g: Group | undefined) => g?.words.map((w) => w.start) ?? [];
export const endsOf = (g: Group | undefined) => g?.words.map((w) => w.end) ?? [];
export const textsOf = (g: Group | undefined) => g?.words.map((w) => w.text) ?? [];
