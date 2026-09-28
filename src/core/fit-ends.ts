// Where words stop sounding, read off the vocal stem: a word ends where the voice before the next word goes quiet.
// Pauses inside a word ("Ду- думал") stay part of it; only the quiet right before the next word is cut off. Most
// words run right into the next one, and those get no end at all: they last until the next word starts.

import { groupStart, isLabelled, type Group, type LyricsDoc } from "./lyrics";

/** Frames below this (0–1 of the loudest) count as silence, as for voice onsets. */
export const VOICE_THRESHOLD = 0.08;
/** A gap this short before the next word is legato: the word runs right up to it and needs no end. */
export const LEGATO_MS = 60;
/** The last word of a group is looked at this far at most. */
export const LAST_WORD_REACH_MS = 3000;

/**
 * Where a word that starts at `startMs` stops sounding, looking no further than `limitMs`: the end of the last
 * voiced frame before it. Null when the voice runs right up to the limit. Silence at the start (an early tap)
 * doesn't end it; no voice at all gives it 150 ms.
 */
export function voicedUntil(envelope: Float32Array, frameMs: number, startMs: number, limitMs: number): number | null {
  const limit = Math.round(limitMs);
  const first = Math.floor(startMs / frameMs) + Math.ceil(40 / frameMs);
  const last = Math.min(envelope.length, Math.floor(limit / frameMs));
  let end: number | null = null;
  for (let f = last - 1; f >= first; f--) {
    if (envelope[f]! >= VOICE_THRESHOLD) {
      end = (f + 1) * frameMs;
      break;
    }
  }
  if (end === null) end = Math.min(limit, startMs + 150);
  return limit - end < LEGATO_MS ? null : Math.max(Math.round(startMs) + 40, end);
}

/** The earliest start of another line (unlabelled group) after `ms`. */
function nextLineStart(doc: LyricsDoc, ms: number): number | null {
  let next: number | null = null;
  for (const g of doc.groups) {
    if (isLabelled(g)) continue;
    const s = groupStart(g);
    if (s !== null && s > ms && (next === null || s < next)) next = s;
  }
  return next;
}

/** How far a word's end may reach: the next word of its group in time, else the next line, at most LAST_WORD_REACH_MS. */
function reachOf(doc: LyricsDoc, group: Group, start: number): number {
  let next: number | null = null;
  for (const w of group.words) if (w.start !== null && w.start > start && (next === null || w.start < next)) next = w.start;
  if (next !== null) return next;
  const line = nextLineStart(doc, start);
  return Math.min(line ?? Number.POSITIVE_INFINITY, start + LAST_WORD_REACH_MS);
}

/**
 * Fits the ends of the timed words in `groups` (all when omitted), or of the words with `wordIds`, to the voice: an
 * end where it stops before the next word, none where it runs right into it (an end set there goes). Returns the new
 * document and how many ends changed.
 */
export function fitWordEnds(
  doc: LyricsDoc,
  envelope: Float32Array,
  frameMs: number,
  options: { groups?: number[]; wordIds?: string[] } = {},
): { doc: LyricsDoc; changed: number } {
  const groupSet = options.groups ? new Set(options.groups) : null;
  const wordSet = options.wordIds ? new Set(options.wordIds) : null;
  let changed = 0;
  const groups = doc.groups.map((g, gi) => {
    if (groupSet && !groupSet.has(gi)) return g;
    let touched = false;
    const words = g.words.map((w) => {
      if (w.start === null || (wordSet && !wordSet.has(w.id))) return w;
      const end = voicedUntil(envelope, frameMs, w.start, reachOf(doc, g, w.start));
      if (end === w.end || (end !== null && end <= w.start)) return w;
      touched = true;
      changed++;
      return { ...w, end };
    });
    return touched ? { ...g, words } : g;
  });
  return { doc: changed > 0 ? { ...doc, groups } : doc, changed };
}
