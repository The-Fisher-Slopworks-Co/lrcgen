// Moving words between groups: a new group from some words (an ad-lib inside a line), a labelled group back
// into its line, and splitting the parts in parentheses out of every line in one go. Words keep their times and get
// no end they didn't have: a word without one lasts until the next word of its new group starts. Also which line a
// labelled group belongs to (its host), which is where LRC export writes it.

import { groupEnd, groupStart, idsFor, isLabelled, lastStart, type Group, type LyricsDoc } from "./lyrics";

/** A labelled group sung this long after its line's last word (or its end) still goes into that line. */
export const HOST_REACH_MS = 1000;

/**
 * The line (unlabelled group) a labelled group is sung with: the one that started last by the time it starts, as
 * long as it's still within reach (HOST_REACH_MS after that line's end, or its last word's start). -1 when there
 * is none, e.g. a backing line in the break between two verses. Untimed groups have no host.
 */
export function hostOf(doc: LyricsDoc, index: number): number {
  const group = doc.groups[index];
  const at = group ? groupStart(group) : null;
  if (!group || !isLabelled(group) || at === null) return -1;
  let host = -1;
  let hostStart = Number.NEGATIVE_INFINITY;
  doc.groups.forEach((g, i) => {
    if (i === index || isLabelled(g)) return;
    const start = groupStart(g);
    if (start !== null && start <= at && start >= hostStart) {
      host = i;
      hostStart = start;
    }
  });
  if (host < 0) return -1;
  const h = doc.groups[host]!;
  const reach = (groupEnd(h) ?? lastStart(h)!) + HOST_REACH_MS;
  return at <= reach ? host : -1;
}

/**
 * Takes the words with `wordIds` out of their groups into a new group with `labels`, next to the group the first
 * of them came from (before it when they start earlier). Groups left empty go. Returns the new group's index,
 * -1 when no word matched.
 */
export function moveToNewGroup(doc: LyricsDoc, wordIds: string[], labels: string[] = []): { doc: LyricsDoc; index: number } {
  const wanted = new Set(wordIds);
  const source = doc.groups.findIndex((g) => g.words.some((w) => wanted.has(w.id)));
  if (source < 0) return { doc, index: -1 };
  const group: Group = { id: idsFor(doc.groups).group(), labels, words: doc.groups.flatMap((g) => g.words.filter((w) => wanted.has(w.id))) };
  const start = groupStart(group);
  const groups: Group[] = [];
  let index = -1;
  doc.groups.forEach((g, i) => {
    const kept = g.words.some((w) => wanted.has(w.id)) ? { ...g, words: g.words.filter((w) => !wanted.has(w.id)) } : g;
    if (kept.words.length > 0) groups.push(kept);
    if (i !== source) return;
    const keptStart = kept.words.length > 0 ? groupStart(kept) : null;
    if (start !== null && keptStart !== null && start < keptStart) groups.splice(groups.length - 1, 0, group);
    else groups.push(group);
  });
  // Past the labelled groups right after it that start earlier, so reading order keeps to time.
  let at = groups.indexOf(group);
  while (start !== null && at + 1 < groups.length && isLabelled(groups[at + 1]!) && (groupStart(groups[at + 1]!) ?? Number.POSITIVE_INFINITY) < start) {
    groups[at] = groups[at + 1]!;
    groups[at + 1] = group;
    at++;
  }
  index = at;
  return { doc: { ...doc, groups }, index };
}

/**
 * Puts a labelled group's words back into its line, each where it falls in time, and removes the group.
 * Uses the host when there is one, else the nearest line before it. Returns the line's index (-1: no change).
 */
export function mergeIntoLine(doc: LyricsDoc, index: number): { doc: LyricsDoc; index: number } {
  const group = doc.groups[index];
  if (!group || !isLabelled(group)) return { doc, index: -1 };
  let target = hostOf(doc, index);
  if (target < 0) for (let i = index - 1; i >= 0 && target < 0; i--) if (!isLabelled(doc.groups[i]!)) target = i;
  if (target < 0) return { doc, index: -1 };
  const words = [...doc.groups[target]!.words];
  for (const w of group.words) {
    const at = w.start === null ? -1 : words.findIndex((x) => x.start !== null && x.start > w.start!);
    words.splice(at === -1 ? words.length : at, 0, w);
  }
  const groups = doc.groups
    .map((g, i) => (i === target ? { ...g, words } : g))
    .filter((_, i) => i !== index);
  return { doc: { ...doc, groups }, index: target > index ? target - 1 : target };
}

// ---------------------------------------------------------------- parentheses

/** The runs of words in parentheses in a group: "(думал", "о", "разном)," → one run of three word indices. */
export function parenRuns(group: Group): number[][] {
  const runs: number[][] = [];
  let run: number[] | null = null;
  group.words.forEach((w, i) => {
    if (!run && w.text.startsWith("(")) run = [];
    if (!run) return;
    run.push(i);
    if (w.text.includes(")")) {
      runs.push(run);
      run = null;
    }
  });
  return runs;
}

/** Parts in parentheses in lines that aren't labelled yet: what "Split them out" would move. */
export function countParenRuns(doc: LyricsDoc): number {
  return doc.groups.reduce((n, g) => n + (isLabelled(g) ? 0 : parenRuns(g).length), 0);
}

// Stutters ("ду-думал") and dashes split words, so an echo matches whole words.
const normalize = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[-‐‑–—]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()} `;

/**
 * Moves every part in parentheses out of its line into a group of its own, without the parentheses: labelled
 * "backing" when it echoes words of the line ("(думал о разном)"), "adlib" otherwise ("(Эй, а)"). Punctuation
 * after the closing parenthesis stays in the line. A line that is all in parentheses just gets the label.
 */
export function splitParentheses(doc: LyricsDoc): { doc: LyricsDoc; backing: number; adlib: number } {
  const ids = idsFor(doc.groups);
  let backing = 0;
  let adlib = 0;
  const groups: Group[] = [];
  for (const g of doc.groups) {
    const runs = isLabelled(g) ? [] : parenRuns(g);
    if (runs.length === 0) {
      groups.push(g);
      continue;
    }
    const words = g.words.map((w) => ({ ...w }));
    const inRun = new Set(runs.flat());
    for (const run of runs) {
      const first = words[run[0]!]!;
      first.text = first.text.replace(/^\(/, "");
      const last = words[run[run.length - 1]!]!;
      const m = last.text.match(/^(.*)\)([^\p{L}\p{N}]*)$/u);
      if (!m) continue;
      last.text = m[1]!;
      // "разном)," — the comma belongs to the line.
      const before = run[0]! - 1;
      if (m[2]!.trim() && before >= 0 && !inRun.has(before)) words[before]!.text += m[2]!.trim();
    }
    const line = words.filter((_, i) => !inRun.has(i));
    const lineText = normalize(line.map((w) => w.text).join(" "));
    const extracted = runs.map((run) => {
      const runWords = run.map((i) => words[i]!).filter((w) => w.text !== "");
      const echo = normalize(runWords.map((w) => w.text).join(" "));
      // A line all in parentheses is a backing line of its own.
      const label = line.length === 0 || (echo.trim() && lineText.includes(echo)) ? "backing" : "adlib";
      if (label === "backing") backing++;
      else adlib++;
      return { runWords, label };
    });
    if (line.length === 0) {
      groups.push({ ...g, labels: [extracted[0]!.label], words: extracted.flatMap((e) => e.runWords) });
      continue;
    }
    groups.push({ ...g, words: line });
    for (const e of extracted) if (e.runWords.length > 0) groups.push({ id: ids.group(), labels: [e.label], words: e.runWords });
  }
  return { doc: { ...doc, groups }, backing, adlib };
}
