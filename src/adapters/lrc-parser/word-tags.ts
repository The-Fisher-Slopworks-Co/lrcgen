import type { LrcLine, LrcWord } from "../../core/lrc-document";
import { hasWordTimings, lineEnd } from "../../core/lrc-document";
import { LRC_TIME_PATTERN, lrcToMs, msToLrc } from "../../core/time-utils";

// Enhanced LRC (A2) word tags: "[00:12.00]<00:12.00>Never <00:12.48>gonna <00:12.90>give<00:14.20>".
// Each <time> starts the text after it; a trailing <time> marks when the last word ends.
const WORD_TAG = new RegExp(`<(${LRC_TIME_PATTERN})>`);

export function parseWordTags(content: string): Pick<LrcLine, "text" | "words" | "end"> {
  const parts = content.split(WORD_TAG);
  if (parts.length === 1) return { text: content.trim() };

  // split() with a capture group alternates text and times: [text, time, text, time, text, ...]
  const pieces: LrcWord[] = [{ start: null, text: parts[0]! }];
  for (let i = 1; i < parts.length; i += 2) {
    pieces.push({ start: lrcToMs(parts[i]!), text: parts[i + 1]! });
  }

  let end: number | null = null;
  const last = pieces[pieces.length - 1]!;
  if (last.text.trim() === "" && last.start !== null) {
    end = last.start;
    pieces.pop();
  }

  // Collapse whitespace the way the plain text is shown, keeping each separating space on the word before it.
  const words: LrcWord[] = [];
  let text = "";
  for (const piece of pieces) {
    let chunk = piece.text.replace(/\s+/g, " ");
    if (text === "" || text.endsWith(" ")) {
      chunk = chunk.trimStart();
    } else if (chunk.startsWith(" ")) {
      words[words.length - 1]!.text += " ";
      text += " ";
      chunk = chunk.slice(1);
    }
    if (chunk === "") continue;
    words.push({ start: piece.start, text: chunk });
    text += chunk;
  }
  if (words.length > 0) {
    const lastWord = words[words.length - 1]!;
    lastWord.text = lastWord.text.trimEnd();
  }
  text = text.trimEnd();

  if (!words.some((w) => w.start !== null)) return { text };
  return end === null ? { text, words } : { text, words, end };
}

export function formatWordTags(line: LrcLine): string {
  if (!hasWordTimings(line)) return line.text.trim();
  // Enhanced LRC has no way to mark one word as untimed, so a word without a time rides along with the one before it
  // (it lights up with it and reads back as part of that joined word); untimed words before the first timed one stay
  // untagged and read back as untimed. The draft, not the .lrc, keeps the exact split.
  const content = line.words!.map((w) => (w.start !== null ? `<${msToLrc(w.start)}>` : "") + w.text).join("");
  const end = lineEnd(line);
  return end === null ? content : `${content.trimEnd()}<${msToLrc(end)}>`;
}
