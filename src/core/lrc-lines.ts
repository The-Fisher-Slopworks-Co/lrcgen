// Lines the way LRC has them: a start, the text, and optionally word starts with the text between them. That's
// what LRC files, transcribe.py and drafts from before groups hold; here they become groups (./lyrics).

import { isWrapped } from "./backing";
import { idsFor, splitText, type Group, type Ids, type Word } from "./lyrics";

export interface LrcWord {
  start: number | null;
  /** The text up to the next word, including the whitespace after it (none between syllables). */
  text: string;
  /** Where it stops sounding, when the source says (a pause tag in Enhanced LRC). */
  end?: number | null;
}

export interface LrcLine {
  timestamp: number | null;
  text: string;
  /** Word timings; their texts spell out the line. */
  words?: LrcWord[];
  /** When the last word ends. */
  end?: number | null;
}

/**
 * Groups for LRC lines. The line start becomes the first word's start. An empty timed line (in LRC, the end of
 * the line before it) becomes that line's end, and a line all in parentheses ("(one by one)") a "backing" group.
 */
export function groupsFromLrcLines(lines: LrcLine[], ids: Ids = idsFor()): Group[] {
  const groups: Group[] = [];
  for (const line of lines) {
    if (line.text.trim() === "") {
      const prev = groups[groups.length - 1];
      if (line.timestamp !== null && prev) endAt(prev, line.timestamp);
      continue;
    }
    const words = wordsOf(line, ids);
    if (words.length === 0) continue;
    const first = words[0]!;
    const earliest = Math.min(...words.map((w) => w.start ?? Number.POSITIVE_INFINITY));
    if (first.start === null && line.timestamp !== null && line.timestamp <= earliest) first.start = line.timestamp;
    if (line.end != null) endAt({ id: "", labels: [], words }, line.end);
    groups.push(isWrapped(line.text) ? asBackingGroup(ids.group(), words) : { id: ids.group(), labels: [], words });
  }
  return groups;
}

function wordsOf(line: LrcLine, ids: Ids): Word[] {
  if (!line.words?.some((w) => w.start !== null)) {
    return splitText(line.text).map((text) => ({ id: ids.word(), text, start: null, end: null }));
  }
  const words: Word[] = [];
  line.words.forEach((w, i) => {
    const text = w.text.trim().replace(/\s+/g, " ");
    if (text === "") return;
    const word: Word = { id: ids.word(), text, start: w.start, end: w.end != null && (w.start === null || w.end > w.start) ? w.end : null };
    if (i < line.words!.length - 1 && !/\s$/.test(w.text)) word.noSpaceAfter = true;
    words.push(word);
  });
  const last = words[words.length - 1];
  if (last?.noSpaceAfter) delete last.noSpaceAfter;
  return words;
}

/** Gives the word that starts last an end at `ms`, unless it has one or `ms` isn't after its start. */
function endAt(group: Group, ms: number): void {
  let last: Word | null = null;
  for (const w of group.words) if (w.start !== null && (!last || w.start >= last.start!)) last = w;
  if (last && last.end === null && ms > last.start!) last.end = ms;
}

function asBackingGroup(id: string, words: Word[]): Group {
  const first = words[0]!;
  const last = words[words.length - 1]!;
  first.text = first.text.replace(/^\(\s*/, "");
  last.text = last.text.replace(/\s*\)$/, "");
  return { id, labels: ["backing"], words: words.filter((w) => w.text !== "") };
}
