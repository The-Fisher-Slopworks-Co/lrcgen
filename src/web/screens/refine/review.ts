// "Review" / "line 9 →" from Preview and the Save dialog: open Refine on a flagged spot.

import type { Flag } from "../../../core/flags";
import { player } from "../../audio/player";
import { closeDialog, currentDoc, goToStep, select } from "../../state";
import { flagTime } from "./word-blocks";

export function reviewFlag(flag: Flag): void {
  const doc = currentDoc();
  select(flag.lineIndex, flag.wordIndex ?? null);
  const t = doc ? flagTime(doc, flag) : null;
  if (t !== null) player.seek(t);
  closeDialog("save");
  goToStep("refine");
}
