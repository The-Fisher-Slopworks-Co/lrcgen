// Turning lyrics text (pasted, loaded from a file, or from LRCLIB) into document groups.

import { SimpleLrcParser } from "../../../adapters/lrc-parser/simple-lrc-parser";
import { groupsFromText, hasWordTimings, isTimed, withStart, type Group } from "../../../core/lyrics";
import { isLyricsFilePath, parseLyricsFile } from "../../../core/lyrics-file";
import { LRC_TIME_PATTERN } from "../../../core/time-utils";
import type { TimingLevel } from "../../../shared/api";

const TIMED_LINE = new RegExp(String.raw`^\s*\[${LRC_TIME_PATTERN}\]`, "m");

/** True when some line starts with an LRC time tag ("[00:14.62] …"). */
export function looksLikeLrc(text: string): boolean {
  return TIMED_LINE.test(text);
}

export interface ParsedLyrics {
  groups: Group[];
  timing: TimingLevel;
}

/**
 * An lrcgen lyrics file keeps everything; LRC text keeps its line (and word) timings; anything else is split at line
 * breaks. `lrc` forces the LRC parser (a .lrc file), which also drops [ar:…]-style tags. `name` is the file's name.
 */
export function parseLyricsText(text: string, options: { lrc?: boolean; name?: string } = {}): ParsedLyrics {
  if (options.name && isLyricsFilePath(options.name)) {
    try {
      const groups = parseLyricsFile(text).groups;
      return { groups, timing: timingOf(groups) };
    } catch {
      return { groups: [], timing: "none" };
    }
  }
  const groups = options.lrc || looksLikeLrc(text) ? new SimpleLrcParser().parse(text).groups : groupsFromText(text);
  return { groups, timing: timingOf(groups) };
}

export function timingOf(groups: Group[]): TimingLevel {
  if (groups.some(hasWordTimings)) return "words";
  if (groups.some(isTimed)) return "lines";
  return "none";
}

/** Text only: the same groups (and labels) with no timings. */
export function stripTimings(groups: Group[]): Group[] {
  return groups.filter((g) => g.words.length > 0).map((g) => withStart(g, null));
}

/** Groups with words in them. */
export function lyricLineCount(groups: Group[]): number {
  return groups.filter((g) => g.words.length > 0).length;
}
