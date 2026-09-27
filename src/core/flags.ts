import type { LrcDocument } from "./lrc-document";
import type { LrcLine } from "./lrc-document";
import { hasWordTimings, lineEnd } from "./lrc-document";
import { msToLrc } from "./time-utils";

// "Worth a look": spots that are probably wrong. lrcgen never fixes them on its own, it only points them out.

export type FlagKind =
  /** A line starts before the line above it. */
  | "lines-out-of-order"
  /** A word starts before the word in front of it. */
  | "words-out-of-order"
  /** A word (or line) starts in silence and the voice comes in shortly after: the tap was probably early. Needs the vocal stem. */
  | "starts-in-silence";

export interface Flag {
  /** Stable across timing edits of the same spot, so "It's intended" can be remembered in the draft. */
  id: string;
  kind: FlagKind;
  lineIndex: number;
  /** Set for word-level flags. */
  wordIndex?: number;
  /** One sentence for the UI, e.g. `“over” starts at 00:49.12 — before the “shine” in front of it (00:49.24).` */
  message: string;
  /** A suggested fix: move the flagged word/line start to this time. */
  suggestMs?: number;
}

export interface FlagOptions {
  /**
   * Where the voice actually comes in, if it does within a short window after `ms` while `ms` itself is silent;
   * null when `ms` is already voiced or nothing starts nearby. Absent when there is no vocal stem.
   */
  voiceOnsetAfter?: (ms: number) => number | null;
  /** Flag ids to leave out. */
  dismissed?: ReadonlySet<string>;
}

// Ids leave the times out, so nudging the flagged spot keeps its id; editing its text makes it a new spot.
function flagId(kind: FlagKind, lineIndex: number, wordIndex: number | undefined, text: string): string {
  return wordIndex === undefined ? `${kind}:${lineIndex}:${text}` : `${kind}:${lineIndex}:${wordIndex}:${text}`;
}

function earlyMessage(subject: string, startMs: number, onsetMs: number): string {
  return `${subject} starts ${Math.round(onsetMs - startMs)} ms before the voice does. The tap may have been early.`;
}

function nextLineStart(lines: LrcLine[], index: number): number | null {
  return lines.slice(index + 1).find((line) => line.timestamp !== null)?.timestamp ?? null;
}

/** The voice onset as a suggestion, unless moving there would reach `limit` (the next start) and put things out of order. */
function safeOnset(onset: number | null, limit: () => number | null): number | null {
  if (onset === null) return null;
  const next = limit();
  return next === null || onset < next ? onset : null;
}

/** All flags in document order. */
export function findFlags(doc: LrcDocument, options: FlagOptions = {}): Flag[] {
  const { voiceOnsetAfter, dismissed } = options;
  const flags: Flag[] = [];
  const add = (flag: Omit<Flag, "id">, text: string) => {
    const id = flagId(flag.kind, flag.lineIndex, flag.wordIndex, text);
    if (!dismissed?.has(id)) flags.push({ id, ...flag });
  };

  let previousLine: { index: number; start: number } | null = null;
  doc.lines.forEach((line, lineIndex) => {
    const lineText = line.text.trim();
    if (line.timestamp !== null) {
      if (previousLine && line.timestamp < previousLine.start) {
        add({
          kind: "lines-out-of-order",
          lineIndex,
          message: `The line starts at ${msToLrc(line.timestamp)} — before line ${previousLine.index + 1} above it (${msToLrc(previousLine.start)}).`,
        }, lineText);
      }
      previousLine = { index: lineIndex, start: line.timestamp };
    }

    const checkSilence = voiceOnsetAfter && lineText !== "";
    if (!hasWordTimings(line)) {
      const onset = checkSilence && line.timestamp !== null
        ? safeOnset(voiceOnsetAfter(line.timestamp), () => nextLineStart(doc.lines, lineIndex))
        : null;
      if (onset !== null) {
        add({ kind: "starts-in-silence", lineIndex, message: earlyMessage("The line", line.timestamp!, onset), suggestMs: onset }, lineText);
      }
      return;
    }

    let previousWord: { text: string; start: number } | null = null;
    const words = line.words!;
    words.forEach((word, wordIndex) => {
      if (word.start === null) return;
      const text = word.text.trim();
      if (previousWord && word.start < previousWord.start) {
        add({
          kind: "words-out-of-order",
          lineIndex,
          wordIndex,
          message: `“${text}” starts at ${msToLrc(word.start)} — before the “${previousWord.text}” in front of it (${msToLrc(previousWord.start)}).`,
        }, text);
      }
      previousWord = { text, start: word.start };
      // The last word must also stay before the line's end and the next line.
      const limit = () => words.slice(wordIndex + 1).find((w) => w.start !== null)?.start
        ?? lineEnd(line) ?? nextLineStart(doc.lines, lineIndex);
      const onset = checkSilence ? safeOnset(voiceOnsetAfter(word.start), limit) : null;
      if (onset !== null) {
        add({ kind: "starts-in-silence", lineIndex, wordIndex, message: earlyMessage(`“${text}”`, word.start, onset), suggestMs: onset }, text);
      }
    });
  });
  return flags;
}
