// Swapping in new lyrics: one undo step, timings kept for lines that still match, then on to Lines.

import type { LrcLine } from "../../../core/lrc-document";
import { replaceLyrics } from "../../../core/lyrics-merge";
import { plural } from "../../lib/format";
import { commit, currentDoc, goToStep, toast } from "../../state";

export function applyLyrics(lines: LrcLine[]): void {
  const doc = currentDoc();
  if (!doc || lines.length === 0) return;
  const { doc: next, kept } = replaceLyrics(doc, lines);
  commit(next, "lyrics");
  if (kept > 0) toast(`Kept the timings of ${plural(kept, "matching line")}`);
  goToStep("lines");
}
