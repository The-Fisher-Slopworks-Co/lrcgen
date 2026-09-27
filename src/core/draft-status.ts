import type { LrcDocument } from "./lrc-document";
import { wordsComplete } from "./lrc-document";

export interface DraftProgress {
  totalLines: number;
  linesTimed: number;
  linesWithWords: number;
  /** 0–5: lyrics in, lines timed, words timed, refined (no open flags), published. */
  stepsDone: number;
  /** Short status for the Recent list: "Lyrics in", "Lines · 12 of 21", "Words · 9 of 30 lines", "Ready", "Published". */
  status: string;
}

export function draftProgress(doc: LrcDocument, state: { published: boolean; openFlags: number }): DraftProgress {
  // Empty lines are gaps between verses, not lyrics.
  const lines = doc.lines.filter((line) => line.text.trim() !== "");
  const totalLines = lines.length;
  const linesTimed = lines.filter((line) => line.timestamp !== null).length;
  const linesWithWords = lines.filter(wordsComplete).length;

  let stepsDone = 0;
  if (totalLines > 0) {
    stepsDone = 1;
    if (linesTimed === totalLines) stepsDone = 2;
    if (stepsDone === 2 && linesWithWords === totalLines) stepsDone = 3;
    if (stepsDone === 3 && state.openFlags === 0) stepsDone = 4;
  }
  if (state.published) stepsDone = 5;

  let status: string;
  if (state.published) status = "Published";
  else if (stepsDone >= 3) status = "Ready";
  else if (stepsDone === 2) status = `Words · ${linesWithWords} of ${totalLines} lines`;
  else if (linesTimed > 0) status = `Lines · ${linesTimed} of ${totalLines}`;
  else status = totalLines > 0 ? "Lyrics in" : "No lyrics yet";

  return { totalLines, linesTimed, linesWithWords, stepsDone, status };
}
