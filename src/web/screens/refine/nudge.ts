// Refine edits the selected word's start or end, or the group's start when no word is selected (its words move
// along). An end that isn't set yet starts from where the block is drawn: the next word's start.

import { groupStart, setGroupStart, setWordEnd, setWordStart, type LyricsDoc } from "../../../core/lyrics";
import { lineSpan } from "../../lib/timing";
import { blockEnd } from "./blocks";

export interface Target {
  line: number;
  /** Null = the group start. */
  word: number | null;
}

/** When the target starts, or null when it has no time yet. */
export function targetStart(doc: LyricsDoc, target: Target): number | null {
  const group = doc.groups[target.line];
  if (!group) return null;
  if (target.word === null) return groupStart(group);
  return group.words[target.word]?.start ?? null;
}

/** When the target word ends: its own end, or where its block is drawn to. Null for a group or an untimed word. */
export function targetEnd(doc: LyricsDoc, target: Target, durationMs: number): { end: number; derived: boolean } | null {
  const group = doc.groups[target.line];
  const word = target.word === null ? undefined : group?.words[target.word];
  if (!group || !word || word.start === null) return null;
  return blockEnd(group, target.word!, lineSpan(doc, target.line, durationMs)?.to ?? null);
}

const clampSong = (ms: number, durationMs: number) => Math.round(Math.min(durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY, Math.max(0, ms)));

/** Makes the target start at `ms` (clamped to the song), timed or not. Returns `doc` when nothing changes. */
export function moveTarget(doc: LyricsDoc, target: Target, ms: number, durationMs: number): LyricsDoc {
  const group = doc.groups[target.line];
  if (!group) return doc;
  const to = clampSong(ms, durationMs);
  if (target.word === null) return groupStart(group) === to ? doc : setGroupStart(doc, target.line, to);
  const word = group.words[target.word];
  if (!word || word.start === to) return doc;
  return setWordStart(doc, target.line, target.word, to);
}

/** Shifts a timed target by `deltaMs`; an untimed one stays put. */
export function nudgeTarget(doc: LyricsDoc, target: Target, deltaMs: number, durationMs: number): LyricsDoc {
  const start = targetStart(doc, target);
  return start === null ? doc : moveTarget(doc, target, start + deltaMs, durationMs);
}

/** Makes the target word end at `ms`, kept at least 20 ms after its start. */
export function moveEnd(doc: LyricsDoc, target: Target, ms: number, durationMs: number): LyricsDoc {
  const start = targetStart(doc, target);
  if (target.word === null || start === null) return doc;
  return setWordEnd(doc, target.line, target.word, Math.max(start + 20, clampSong(ms, durationMs)));
}

/** Shifts the target word's end by `deltaMs` (from where its block ends when it has no end of its own). */
export function nudgeEnd(doc: LyricsDoc, target: Target, deltaMs: number, durationMs: number): LyricsDoc {
  const end = targetEnd(doc, target, durationMs);
  return end === null ? doc : moveEnd(doc, target, end.end + deltaMs, durationMs);
}

/** Parses a typed time: "00:42.83", "0:42.8", "42.83" or "42". Null when it isn't a time. */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(",", ".");
  const m = t.match(/^(?:(\d+):)?(\d{1,2}|\d+)(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const minutes = m[1] ? parseInt(m[1], 10) : 0;
  const secs = parseInt(m[2]!, 10);
  if (m[1] && secs >= 60) return null;
  const frac = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) : 0;
  return (minutes * 60 + secs) * 1000 + frac;
}
