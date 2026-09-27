// Turning lyrics text (pasted, loaded from a file, or from LRCLIB) into document lines.

import type { LrcLine } from "../../../core/lrc-document";
import { hasWordTimings, linesFromText } from "../../../core/lrc-document";
import { LRC_TIME_PATTERN } from "../../../core/time-utils";
import { SimpleLrcParser } from "../../../adapters/lrc-parser/simple-lrc-parser";
import type { TimingLevel } from "../../../shared/api";

const TIMED_LINE = new RegExp(String.raw`^\s*\[${LRC_TIME_PATTERN}\]`, "m");

/** True when some line starts with an LRC time tag ("[00:14.62] …"). */
export function looksLikeLrc(text: string): boolean {
  return TIMED_LINE.test(text);
}

export interface ParsedLyrics {
  lines: LrcLine[];
  timing: TimingLevel;
}

/**
 * LRC text keeps its line (and word) timings; anything else is split at line breaks.
 * `lrc` forces the LRC parser (a .lrc file), which also drops [ar:…]-style tags.
 */
export function parseLyricsText(text: string, options: { lrc?: boolean } = {}): ParsedLyrics {
  const lines = options.lrc || looksLikeLrc(text) ? new SimpleLrcParser().parse(text).lines : linesFromText(text);
  return { lines, timing: timingOf(lines) };
}

export function timingOf(lines: LrcLine[]): TimingLevel {
  if (lines.some(hasWordTimings)) return "words";
  if (lines.some((l) => l.timestamp !== null)) return "lines";
  return "none";
}

/** Text only: no timings, and no empty lines (in LRC those only mark where a phrase ends). */
export function stripTimings(lines: LrcLine[]): LrcLine[] {
  return lines.filter((l) => l.text.trim() !== "").map((l) => ({ timestamp: null, text: l.text }));
}

/** Lines with words in them (empty timed lines are gaps, not lyrics). */
export function lyricLineCount(lines: LrcLine[]): number {
  return lines.filter((l) => l.text.trim() !== "").length;
}
