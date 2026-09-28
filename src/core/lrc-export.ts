// What a lyrics document becomes in LRC: a line per line of the song (unlabelled group), with the labelled groups
// sung with it (backing vocals, ad-libs; see hostOf) written into it in parentheses where they fall in time. A
// labelled group with no line to go into gets a line of its own, in parentheses too. Plain LRC, Enhanced LRC,
// LRCLIB and the "What gets saved" panel all go through `exportLines`.

import { hostOf } from "./groups";
import { isLabelled, type LyricsDoc, type Word } from "./lyrics";
import { msToLrc } from "./time-utils";

export interface ExportWord {
  text: string;
  start: number | null;
  end: number | null;
  noSpaceAfter?: boolean;
  /** From a labelled group: written in parentheses. */
  guest: boolean;
  /** Opens / closes the parentheses around a labelled group's words. */
  open: boolean;
  close: boolean;
}

export interface ExportLine {
  /** The group the line is for. */
  group: number;
  start: number | null;
  words: ExportWord[];
  /** When the last word stops sounding, if known. */
  end: number | null;
}

/** A pause of at least this long between a word's end and the next word gets its own tag in Enhanced LRC. */
export const PAUSE_TAG_MS = 150;

export function exportLines(doc: LyricsDoc): ExportLine[] {
  const guests = new Map<number, number[]>();
  const hosted = new Set<number>();
  doc.groups.forEach((g, i) => {
    if (!isLabelled(g) || g.words.length === 0) return;
    const host = hostOf(doc, i);
    if (host < 0) return;
    guests.set(host, [...(guests.get(host) ?? []), i]);
    hosted.add(i);
  });

  const lines: ExportLine[] = [];
  doc.groups.forEach((g, i) => {
    if (g.words.length === 0 || hosted.has(i)) return;
    const labelled = isLabelled(g);
    const words = runOf(g.words, labelled);
    const runs = (guests.get(i) ?? []).map((j) => runOf(doc.groups[j]!.words, true));
    runs.sort((a, b) => (runStart(a) ?? Number.POSITIVE_INFINITY) - (runStart(b) ?? Number.POSITIVE_INFINITY));
    for (const run of runs) {
      const at = runStart(run);
      const before = at === null ? -1 : words.findIndex((w) => w.start !== null && w.start > at);
      words.splice(before === -1 ? words.length : before, 0, ...run);
    }
    lines.push({ group: i, start: lineStart(g.words), words, end: lineEnd(words) });
  });
  return lines;
}

function runOf(words: Word[], guest: boolean): ExportWord[] {
  return words.map((w, i) => {
    const out: ExportWord = { text: w.text, start: w.start, end: w.end, guest, open: guest && i === 0, close: guest && i === words.length - 1 };
    if (w.noSpaceAfter && i < words.length - 1) out.noSpaceAfter = true;
    return out;
  });
}

function runStart(run: ExportWord[]): number | null {
  let min: number | null = null;
  for (const w of run) if (w.start !== null && (min === null || w.start < min)) min = w.start;
  return min;
}

function lineStart(words: Word[]): number | null {
  let min: number | null = null;
  for (const w of words) if (w.start !== null && (min === null || w.start < min)) min = w.start;
  return min;
}

function lineEnd(words: ExportWord[]): number | null {
  let end: number | null = null;
  let last: number | null = null;
  for (const w of words) {
    if (w.end !== null && (end === null || w.end > end)) end = w.end;
    if (w.start !== null && (last === null || w.start > last)) last = w.start;
  }
  return end !== null && (last === null || end > last) ? end : null;
}

const shown = (w: ExportWord) => `${w.open ? "(" : ""}${w.text}${w.close ? ")" : ""}`;

/** The line's text: "Ду-думал о разном, (думал о разном) ду-думал о многом". */
export function lineText(line: ExportLine): string {
  return line.words.map((w, i) => (i < line.words.length - 1 && !w.noSpaceAfter ? `${shown(w)} ` : shown(w))).join("");
}

/** Timings beyond the line start: a later word has a start, or some word has an end. */
export function lineHasWordTimings(line: ExportLine): boolean {
  return line.words.some((w, i) => w.end !== null || (i > 0 && w.start !== null));
}

/** "[00:12.00] Never gonna give you up", or just the text for an untimed line. */
export function formatPlainLine(line: ExportLine): string {
  const text = lineText(line);
  return line.start !== null ? `[${msToLrc(line.start)}] ${text}` : text;
}

/**
 * Enhanced LRC (A2): "[00:12.00]<00:12.00>Never <00:12.48>gonna <00:12.90>give<00:14.20>". Each tag starts the
 * text after it; a tag followed by nothing but a space marks a pause (the word before it ends there); a tag at the
 * end marks when the last word ends. A word without a start rides along with the one before it, since the
 * format can't mark it untimed. Lines without word timings stay plain.
 */
export function formatEnhancedLine(line: ExportLine): string {
  if (!lineHasWordTimings(line) || line.start === null) return formatPlainLine(line);
  let out = `[${msToLrc(line.start)}]`;
  line.words.forEach((w, i) => {
    if (w.start !== null) out += `<${msToLrc(w.start)}>`;
    out += shown(w);
    const next = line.words[i + 1];
    if (!next) return;
    if (w.noSpaceAfter) return;
    if (w.end !== null && next.start !== null && next.start - w.end >= PAUSE_TAG_MS) out += ` <${msToLrc(w.end)}>`;
    out += " ";
  });
  return line.end !== null ? `${out}<${msToLrc(line.end)}>` : out;
}
