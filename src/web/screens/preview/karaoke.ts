// What the karaoke stage shows at a moment: which lines (previous / current / next, or the title card
// before the first line) and how far each word of the current line has filled.

import { hasWordTimings, wordsOf, type LrcDocument, type LrcLine } from "../../../core/lrc-document";
import { lineIndexAt, wordFill } from "../../../core/playback-position";

export type LinesOnScreen = 1 | 2 | 3;
export type Highlight = "word" | "line";

export interface StageLine {
  role: "prev" | "current" | "next";
  /** Line index; null for the title card shown before the first line; -1 for an empty slot. */
  index: number | null;
}

const sung = (line: LrcLine | undefined) => !!line && line.text.trim() !== "";

function neighbour(doc: LrcDocument, from: number, dir: 1 | -1): number | null {
  for (let i = from + dir; i >= 0 && i < doc.lines.length; i += dir) if (sung(doc.lines[i])) return i;
  return null;
}

/** The line on stage at `ms`: the last timed line started, or -1 before the first. */
export function currentLineAt(doc: LrcDocument, ms: number): number {
  return lineIndexAt(doc, ms);
}

/** The lines to show for `current` (from `currentLineAt`) with `count` lines on screen. */
export function stageLines(doc: LrcDocument, current: number, count: LinesOnScreen): StageLine[] {
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

/**
 * How far each word of `line` has filled at `ms`, 0–1. "line" highlight, or a line without word timings,
 * fills the whole line at once when it starts. `lineEndMs` is where the last word ends when the line has no
 * end of its own (the next line's start).
 */
export function wordFills(line: LrcLine, ms: number, highlight: Highlight, lineEndMs: number | null): number[] {
  const words = wordsOf(line);
  if (highlight === "line" || !hasWordTimings(line)) {
    const on = line.timestamp !== null && ms >= line.timestamp ? 1 : 0;
    return words.map(() => on);
  }
  return words.map((_, i) => wordFill(line, i, ms, lineEndMs));
}

/** The board's fill: sung colour up to `fill`, the rest in `rest`; clipped to the text. */
export function fillBackground(fill: number, sungColor: string, restColor: string): string {
  const pct = Math.round(Math.min(1, Math.max(0, fill)) * 1000) / 10;
  return `linear-gradient(90deg, ${sungColor} 0%, ${sungColor} ${pct}%, ${restColor} ${pct}%, ${restColor} 100%)`;
}

/** Where ↑/↓ last landed: the line index and the time it was sent to. */
export interface JumpCursor {
  index: number;
  at: number;
}

/**
 * The line ↑/↓ steps from. Normally the line on stage; but right after a jump it's the line jumped to, for as
 * long as the stage still shows what it showed then. Lines out of order would otherwise trap ↑: jumping to
 * line 4 (17.80) puts line 5 (16.94) on stage, and ↑ from line 5 is line 4 again.
 */
export function jumpBase(doc: LrcDocument, ms: number, cursor: JumpCursor | null): number {
  const onStage = currentLineAt(doc, ms);
  if (!cursor || doc.lines[cursor.index]?.timestamp !== cursor.at) return onStage;
  return onStage === currentLineAt(doc, cursor.at) ? cursor.index : onStage;
}

/** The previous / next timed line by index from `current` (↑ / ↓), skipping untimed and empty lines; or null. */
export function jumpTarget(doc: LrcDocument, current: number, dir: 1 | -1): number | null {
  for (let i = current + dir; i >= 0 && i < doc.lines.length; i += dir) {
    const line = doc.lines[i]!;
    if (line.timestamp !== null && sung(line)) return i;
  }
  return null;
}
