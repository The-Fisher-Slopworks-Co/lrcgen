// Swapping in new lyrics: one undo step, timings kept for groups that still match, then on to Lines.

import type { Group } from "../../../core/lyrics";
import { replaceLyrics } from "../../../core/lyrics-merge";
import { plural } from "../../lib/format";
import { commit, currentDoc, goToStep, toast } from "../../state";

export function applyLyrics(groups: Group[]): void {
  const doc = currentDoc();
  if (!doc || groups.length === 0) return;
  const { doc: next, kept } = replaceLyrics(doc, groups);
  commit(next, "lyrics");
  if (kept > 0) toast(`Kept the timings of ${plural(kept, "matching line")}`);
  goToStep("lines");
}
