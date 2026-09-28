// What the karaoke stage shows at a moment: which lines (previous / current / next, or the title card before the
// first line), the backing vocals and ad-libs sounding over the current line, and how far each word has filled.

import { groupStart, hasWordTimings, isLabelled, type Group, type LyricsDoc } from "../../../core/lyrics";
import { lineIndexAt, wordFill } from "../../../core/playback-position";
import { lineSpan } from "../../lib/timing";

export type LinesOnScreen = 1 | 2 | 3;
export type Highlight = "word" | "line";

export interface StageLine {
  role: "prev" | "current" | "next";
  /** Group index; null for the title card shown before the first line; -1 for an empty slot. */
  index: number | null;
}

/** A line of the song: an unlabelled group with words. Labelled groups show under the current line instead. */
const isLine = (group: Group | undefined) => !!group && group.words.length > 0 && !isLabelled(group);

function neighbour(doc: LyricsDoc, from: number, dir: 1 | -1): number | null {
  for (let i = from + dir; i >= 0 && i < doc.groups.length; i += dir) if (isLine(doc.groups[i])) return i;
  return null;
}

/** The line on stage at `ms`: the last line started, or -1 before the first. */
export function currentLineAt(doc: LyricsDoc, ms: number): number {
  return lineIndexAt(doc, ms);
}

/** The lines to show for `current` (from `currentLineAt`) with `count` lines on screen. */
export function stageLines(doc: LyricsDoc, current: number, count: LinesOnScreen): StageLine[] {
  const cur: StageLine = { role: "current", index: current >= 0 ? current : null };
  const nextIndex = neighbour(doc, current, 1);
  const next: StageLine | null = nextIndex !== null ? { role: "next", index: nextIndex } : null;
  const prevIndex = current >= 0 ? neighbour(doc, current, -1) : null;
  const prev: StageLine | null = prevIndex !== null ? { role: "prev", index: prevIndex } : null;
  const out: StageLine[] = [];
  if (count === 3) out.push(prev ?? { role: "prev", index: -1 });
  out.push(cur);
  if (count >= 2) out.push(next ?? { role: "next", index: -1 });
  return out;
}

/** The labelled groups (backing vocals, ad-libs) sounding at `ms`, in document order. */
export function overlaysAt(doc: LyricsDoc, ms: number, durationMs: number): number[] {
  const out: number[] = [];
  doc.groups.forEach((g, i) => {
    if (!isLabelled(g) || g.words.length === 0) return;
    const span = lineSpan(doc, i, durationMs);
    if (span && ms >= span.from && ms < span.to) out.push(i);
  });
  return out;
}

/**
 * How far each word of `group` has filled at `ms`, 0–1. "line" highlight, or a group without word timings, fills
 * the whole line at once when it starts. `lineEndMs` is where the last word ends when nothing else says (the next
 * line's start).
 */
export function wordFills(group: Group, ms: number, highlight: Highlight, lineEndMs: number | null): number[] {
  if (highlight === "line" || !hasWordTimings(group)) {
    const start = groupStart(group);
    const on = start !== null && ms >= start ? 1 : 0;
    return group.words.map(() => on);
  }
  return group.words.map((_, i) => wordFill(group, i, ms, lineEndMs));
}

/** The board's fill: sung colour up to `fill`, the rest in `rest`; clipped to the text. */
export function fillBackground(fill: number, sungColor: string, restColor: string): string {
  const pct = Math.round(Math.min(1, Math.max(0, fill)) * 1000) / 10;
  return `linear-gradient(90deg, ${sungColor} 0%, ${sungColor} ${pct}%, ${restColor} ${pct}%, ${restColor} 100%)`;
}

/** Where ↑/↓ last landed: the group index and the time it was sent to. */
export interface JumpCursor {
  index: number;
  at: number;
}

/**
 * The line ↑/↓ steps from. Normally the line on stage; but right after a jump it's the line jumped to, for as
 * long as the stage still shows what it showed then. Lines out of order would otherwise trap ↑: jumping to
 * line 4 (17.80) puts line 5 (16.94) on stage, and ↑ from line 5 is line 4 again.
 */
export function jumpBase(doc: LyricsDoc, ms: number, cursor: JumpCursor | null): number {
  const onStage = currentLineAt(doc, ms);
  const group = cursor ? doc.groups[cursor.index] : undefined;
  if (!cursor || !group || groupStart(group) !== cursor.at) return onStage;
  return onStage === currentLineAt(doc, cursor.at) ? cursor.index : onStage;
}

/** The previous / next timed line by index from `current` (↑ / ↓), skipping untimed lines and labelled groups; or null. */
export function jumpTarget(doc: LyricsDoc, current: number, dir: 1 | -1): number | null {
  for (let i = current + dir; i >= 0 && i < doc.groups.length; i += dir) {
    const group = doc.groups[i]!;
    if (isLine(group) && groupStart(group) !== null) return i;
  }
  return null;
}
