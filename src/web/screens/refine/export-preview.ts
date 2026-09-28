// "What gets saved" in the Refine inspector: the group as the lyrics file has it, and its line as LRC export
// writes it (labelled groups go into the line they're sung with, in parentheses).

import { hostOf } from "../../../core/groups";
import { exportLines, formatEnhancedLine, formatPlainLine } from "../../../core/lrc-export";
import { toLyricsFile } from "../../../core/lyrics-file";
import type { LyricsDoc } from "../../../core/lyrics";

/** The group in the lyrics file: one word per line. */
export function groupJson(doc: LyricsDoc, index: number): string {
  const group = doc.groups[index];
  if (!group) return "";
  const file = toLyricsFile({ ...doc, groups: [group] }).groups[0];
  if (!file) return JSON.stringify({ id: group.id, labels: group.labels, words: [] });
  const words = file.words.map((w) => {
    const fields = [`"id": ${JSON.stringify(w.id)}`, `"text": ${JSON.stringify(w.text)}`, `"start": ${w.start}`, `"end": ${w.end}`];
    if (w.noSpaceAfter) fields.push(`"noSpaceAfter": true`);
    return `    { ${fields.join(", ")} }`;
  });
  return `{
  "id": ${JSON.stringify(file.id)},
  "labels": [${file.labels.map((l) => JSON.stringify(l)).join(", ")}],
  "words": [
${words.join(",\n")}
  ]
}`;
}

export interface ExportedLine {
  /** The group whose line it is: the group itself, or the line a labelled group goes into. */
  line: number;
  plain: string;
  enhanced: string;
}

/** The LRC line group `index` ends up in; null for a group without words. */
export function exportedLine(doc: LyricsDoc, index: number): ExportedLine | null {
  const host = hostOf(doc, index);
  const line = host >= 0 ? host : index;
  const found = exportLines(doc).find((l) => l.group === line);
  return found ? { line, plain: formatPlainLine(found), enhanced: formatEnhancedLine(found) } : null;
}
