import { describe, expect, test } from "bun:test";
import { groupsFromLrcLines, type LrcLine } from "../../../core/lrc-lines";
import type { Group, LyricsDoc } from "../../../core/lyrics";
import { doc as build } from "../../../core/testing";
import {
  arrivalSpot,
  changedSpot,
  firstUntimedWord,
  lineSpot,
  messageParts,
  nextSpot,
  partlyTimed,
  preRollStart,
  prevSpot,
  shortWords,
  tapWord,
  wordCounts,
  wordSpan,
} from "./word-tapping";

// Lines written the LRC way; an empty one is an empty group, so indices stay put.
const toGroup = (line: LrcLine): Group => (line.text.trim() === "" ? { id: "", labels: [], words: [] } : groupsFromLrcLines([line])[0]!);
function doc(lines: LrcLine[]): LyricsDoc {
  return build(...lines.map(toGroup));
}
const plain = (text: string, timestamp: number | null = null): LrcLine => ({ timestamp, text });
const timed = (text: string, starts: (number | null)[], end?: number): LrcLine => {
  const parts = text.match(/\S+\s*/g)!;
  return { timestamp: starts[0] ?? null, text, words: parts.map((t, i) => ({ text: t, start: starts[i] ?? null })), ...(end ? { end } : {}) };
};

describe("arrivalSpot", () => {
  test("starts at the first word without a start", () => {
    const d = doc([timed("a b", [1, 2]), plain(""), timed("c d e", [3, 4, null]), plain("e f")]);
    expect(arrivalSpot(d, { line: 3, word: null })).toEqual({ line: 2, word: 2 });
  });

  test("a line with only its start (from the Lines step) starts at its first word", () => {
    const d = doc([timed("a b", [1, 2]), plain("c d", 300)]);
    expect(arrivalSpot(d, { line: 0, word: null })).toEqual({ line: 1, word: 0 });
  });

  test("keeps a word picked on purpose", () => {
    const d = doc([plain("a b"), timed("c d", [3, 4])]);
    expect(arrivalSpot(d, { line: 1, word: 1 })).toEqual({ line: 1, word: 1 });
  });

  test("ignores the line selection left by the Lines step", () => {
    const d = doc([plain("a b", 100), plain("c d", 200)]);
    expect(arrivalSpot(d, { line: 1, word: null })).toEqual({ line: 0, word: 0 });
  });

  test("a line with one untimed word left (after a split) is not done", () => {
    const d = doc([timed("a b", [1, 2]), { timestamp: 3, text: "c d e", words: [{ text: "c ", start: 3 }, { text: "d ", start: null }, { text: "e", start: 5 }] }]);
    expect(arrivalSpot(d, { line: 0, word: null })).toEqual({ line: 1, word: 1 });
  });

  test("an untimed punctuation-only word doesn't hold a line back", () => {
    const d = doc([{ timestamp: 1, text: "a — b", words: [{ text: "a ", start: 1 }, { text: "— ", start: null }, { text: "b", start: 2 }] }, plain("c")]);
    expect(arrivalSpot(d, { line: 0, word: null })).toEqual({ line: 1, word: 0 });
  });

  test("with everything done, the selected line", () => {
    const d = doc([timed("a", [1]), plain(""), timed("b", [2])]);
    expect(arrivalSpot(d, { line: 1, word: null })).toEqual({ line: 2, word: 0 });
    expect(arrivalSpot(doc([]), { line: 0, word: null })).toBeNull();
  });
});

describe("moving between words", () => {
  const d = doc([plain("a b"), plain(""), plain("c")]);
  test("next word, then the next line with words", () => {
    expect(nextSpot(d, { line: 0, word: 0 })).toEqual({ line: 0, word: 1 });
    expect(nextSpot(d, { line: 0, word: 1 })).toEqual({ line: 2, word: 0 });
    expect(nextSpot(d, { line: 2, word: 0 })).toBeNull();
  });

  test("previous word, across lines", () => {
    expect(prevSpot(d, { line: 2, word: 0 })).toEqual({ line: 0, word: 1 });
    expect(prevSpot(d, { line: 0, word: 0 })).toBeNull();
  });

  test("line steps land on the first untimed word", () => {
    const e = doc([plain("a"), timed("b c d", [1, 2, null])]);
    expect(lineSpot(e, 0, 1)).toEqual({ line: 1, word: 2 });
    expect(lineSpot(e, 1, -1)).toEqual({ line: 0, word: 0 });
    expect(lineSpot(e, 1, 1)).toBeNull();
  });
});

describe("tapWord", () => {
  test("times the word and moves on; the first word also starts the line", () => {
    const r = tapWord(doc([plain("a b"), plain("c")]), { line: 0, word: 0 }, 1234.4);
    expect(r.doc.groups[0]!.words.map((w) => w.start)).toEqual([1234, null]);
    expect(r.next).toEqual({ line: 0, word: 1 });
  });

  test("the last word of the song has no next", () => {
    expect(tapWord(doc([plain("a")]), { line: 0, word: 0 }, 5).next).toBeNull();
  });
});

describe("changedSpot", () => {
  test("finds the word an undone tap was on", () => {
    const before = doc([plain("x", 1), timed("a b c", [10, 20, 30])]);
    const after = { ...before, groups: [before.groups[0]!, { ...toGroup(timed("a b c", [10, 20, null])), id: before.groups[1]!.id }] };
    expect(changedSpot(before, after)).toEqual({ line: 1, word: 2 });
    expect(changedSpot(before, before)).toBeNull();
  });

  test("works for the first tap on a line without word data", () => {
    const after = doc([plain("a b")]);
    const before = tapWord(after, { line: 0, word: 0 }, 100).doc;
    expect(changedSpot(before, after)).toEqual({ line: 0, word: 0 });
  });

  test("points at a split or joined word", () => {
    const joined = doc([timed("a b c", [1, 2, 3])]);
    const split = doc([{ timestamp: 1, text: "a b c", words: [{ text: "a b ", start: 1 }, { text: "c", start: 3 }] }]);
    expect(changedSpot(split, joined)).toEqual({ line: 0, word: 0 });
  });
});

describe("preRollStart", () => {
  test("two seconds before the line", () => {
    expect(preRollStart(doc([plain("a", 5000)]), 0)).toBe(3000);
    expect(preRollStart(doc([plain("a", 500)]), 0)).toBe(0);
  });

  test("an untimed line starts before the end of the line above, or at its start", () => {
    expect(preRollStart(doc([timed("a b", [1000, 2000], 4000), plain("c")]), 1)).toBe(2000);
    expect(preRollStart(doc([timed("a b", [1000, 3500]), plain("c")]), 1)).toBe(1500);
    expect(preRollStart(doc([plain("a", 1000), plain("b"), plain("c", 9000)]), 1)).toBe(1000);
    expect(preRollStart(doc([plain("a"), plain("b")]), 1)).toBe(0);
  });
});

describe("wordSpan", () => {
  const d = doc([timed("a b c", [1000, 1400, null]), plain("d", 9000)]);
  test("without an end, runs to the next timed word, capped at 1.5 s", () => {
    expect(wordSpan(d, { line: 0, word: 0 }, 60_000)).toEqual({ from: 1000, to: 1400 });
    expect(wordSpan(d, { line: 0, word: 1 }, 60_000)).toEqual({ from: 1400, to: 2900 });
  });

  test("with an end, exactly the word", () => {
    const e = doc([{ timestamp: 1000, text: "a b", words: [{ start: 1000, end: 1180, text: "a " }, { start: 1400, text: "b" }] }]);
    expect(wordSpan(e, { line: 0, word: 0 }, 60_000)).toEqual({ from: 1000, to: 1180 });
  });

  test("nothing for an untimed word", () => {
    expect(wordSpan(d, { line: 0, word: 2 }, 60_000)).toBeNull();
  });
});

test("wordCounts counts lines whose words are all timed, leaving out empty lines", () => {
  expect(wordCounts(doc([timed("a b", [1, 2]), timed("c d", [3, null]), plain(""), plain("e")]))).toEqual({ done: 1, total: 3 });
});

test("partlyTimed and firstUntimedWord skip punctuation-only words", () => {
  const dash = toGroup({ timestamp: 1, text: "a — b c", words: [{ text: "a ", start: 1 }, { text: "— ", start: null }, { text: "b ", start: 2 }, { text: "c", start: null }] });
  expect(firstUntimedWord(dash)).toBe(3);
  expect(partlyTimed(dash)).toBe(true);
  expect(partlyTimed(toGroup(timed("a b", [1, 2])))).toBe(false);
  expect(partlyTimed(toGroup(plain("a b")))).toBe(false);
});

describe("shortWords", () => {
  test("lists short words but not the last one", () => {
    expect(shortWords(toGroup(plain("Tonight I’m yours to keep")))).toEqual(["I’m", "to"]);
    expect(shortWords(toGroup(plain("И твой голос так красив, он")))).toEqual(["И", "так"]);
  });

  test("none once the line has a joined word", () => {
    expect(shortWords(toGroup({ timestamp: 1, text: "I am here", words: [{ text: "I am ", start: 1 }, { text: "here", start: null }] }))).toEqual([]);
  });
});

test("messageParts sets times in mono", () => {
  expect(messageParts("“over” starts at 00:49.12 — before (00:49.24).")).toEqual([
    { text: "“over” starts at ", mono: false },
    { text: "00:49.12", mono: true },
    { text: " — before (", mono: false },
    { text: "00:49.24", mono: true },
    { text: ").", mono: false },
  ]);
  expect(messageParts("The line starts 80 ms before")[1]).toEqual({ text: "80 ms", mono: true });
});
