import { idsFor, joinWords, updateGroup, type LyricsDoc, type Word } from "./lyrics";

// A joined word is one Word whose text holds several whitespace-separated parts ("And all"). It has one timing,
// so the parts light up together in karaoke and share one tag in Enhanced LRC.

/** Joins word `wordIndex` with the next word of the same group: the first word's start, the second's end. */
export function joinWithNext(doc: LyricsDoc, groupIndex: number, wordIndex: number): LyricsDoc {
  return updateGroup(doc, groupIndex, (g) => {
    const word = g.words[wordIndex];
    const next = g.words[wordIndex + 1];
    if (wordIndex < 0 || !word || !next) return g;
    const joined: Word = { id: word.id, text: joinWords([word, next]), start: word.start, end: next.end };
    if (next.noSpaceAfter) joined.noSpaceAfter = true;
    return { ...g, words: [...g.words.slice(0, wordIndex), joined, ...g.words.slice(wordIndex + 2)] };
  });
}

/** Splits a joined word after its first part. The new second word has no times until it is tapped or dragged. */
export function splitWord(doc: LyricsDoc, groupIndex: number, wordIndex: number): LyricsDoc {
  const ids = idsFor(doc.groups);
  return updateGroup(doc, groupIndex, (g) => {
    const word = g.words[wordIndex];
    const match = word?.text.match(/^(\S+)\s+(\S[\s\S]*)$/);
    if (wordIndex < 0 || !word || !match) return g;
    const { noSpaceAfter: _, ...rest } = word;
    const first: Word = { ...rest, text: match[1]!, end: null };
    const second: Word = { id: ids.word(), text: match[2]!, start: null, end: null };
    if (word.noSpaceAfter) second.noSpaceAfter = true;
    return { ...g, words: [...g.words.slice(0, wordIndex), first, second, ...g.words.slice(wordIndex + 1)] };
  });
}
