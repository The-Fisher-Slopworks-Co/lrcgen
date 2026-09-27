import type { LrcDocument, LrcLine, LrcWord } from "./lrc-document";
import { wordsOf } from "./lrc-document";

// A joined word is one LrcWord whose text holds several whitespace-separated parts ("And all ").
// It gets one timing tag in Enhanced LRC, so the parts light up together in karaoke.

/** The parts a (possibly joined) word is made of: "And all " → ["And", "all"]. */
export function wordParts(word: LrcWord): string[] {
  return word.text.match(/\S+/g) ?? [];
}

function updateWords(doc: LrcDocument, lineIndex: number, update: (words: LrcWord[]) => LrcWord[] | null): LrcDocument {
  const line = doc.lines[lineIndex];
  if (!line) return doc;
  const words = update(wordsOf(line));
  if (!words) return doc;
  const updated: LrcLine = { ...line, words };
  return { ...doc, lines: doc.lines.map((l, i) => (i === lineIndex ? updated : l)) };
}

/** Joins word `wordIndex` with the next word of the same line; the joined word keeps the first word's start. */
export function joinWithNext(doc: LrcDocument, lineIndex: number, wordIndex: number): LrcDocument {
  return updateWords(doc, lineIndex, (words) => {
    const word = words[wordIndex];
    const next = words[wordIndex + 1];
    if (wordIndex < 0 || !word || !next) return null;
    const joined: LrcWord = { start: word.start, text: word.text + next.text };
    return [...words.slice(0, wordIndex), joined, ...words.slice(wordIndex + 2)];
  });
}

/** Splits a joined word after its first part; the new second word has no start (null) until it is tapped or dragged. */
export function splitWord(doc: LrcDocument, lineIndex: number, wordIndex: number): LrcDocument {
  return updateWords(doc, lineIndex, (words) => {
    const word = words[wordIndex];
    const match = word?.text.match(/^(\s*\S+\s+)(\S[\s\S]*)$/);
    if (wordIndex < 0 || !word || !match) return null;
    const first: LrcWord = { start: word.start, text: match[1]! };
    const second: LrcWord = { start: null, text: match[2]! };
    return [...words.slice(0, wordIndex), first, second, ...words.slice(wordIndex + 1)];
  });
}
