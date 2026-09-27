import { test, expect, describe } from "bun:test";
import { createDocument, addLines, linesFromText, setLineText } from "./lrc-document";
import type { LrcDocument, LrcLine } from "./lrc-document";
import { wordParts, joinWithNext, splitWord } from "./word-edit";

const line: LrcLine = {
  timestamp: 1000,
  text: "And all through the night",
  words: [
    { start: 1000, text: "And " },
    { start: 1300, text: "all " },
    { start: 1600, text: "through " },
    { start: 2000, text: "the " },
    { start: 2200, text: "night" },
  ],
  end: 3000,
};

function docOf(...lines: LrcLine[]): LrcDocument {
  return { ...createDocument(), lines };
}

describe("wordParts", () => {
  test("lists the parts of a joined word", () => {
    expect(wordParts({ start: null, text: "And all " })).toEqual(["And", "all"]);
    expect(wordParts({ start: null, text: "night" })).toEqual(["night"]);
    expect(wordParts({ start: null, text: "" })).toEqual([]);
  });
});

describe("joinWithNext", () => {
  test("joins two words into one that keeps the first start", () => {
    const joined = joinWithNext(docOf(line), 0, 0).lines[0]!;
    expect(joined.words).toEqual([
      { start: 1000, text: "And all " },
      { start: 1600, text: "through " },
      { start: 2000, text: "the " },
      { start: 2200, text: "night" },
    ]);
    expect(joined.text).toBe(line.text);
    expect(joined.timestamp).toBe(1000);
    expect(joined.end).toBe(3000);
  });

  test("joins onto an already joined word", () => {
    const doc = joinWithNext(joinWithNext(docOf(line), 0, 0), 0, 0);
    expect(doc.lines[0]!.words![0]).toEqual({ start: 1000, text: "And all through " });
  });

  test("joining the last two words keeps the line without trailing space", () => {
    const words = joinWithNext(docOf(line), 0, 3).lines[0]!.words!;
    expect(words[3]).toEqual({ start: 2000, text: "the night" });
    expect(words.map((w) => w.text).join("")).toBe(line.text);
  });

  test("works on a line that has no words yet", () => {
    const doc = addLines(createDocument(), linesFromText("Hello big world"));
    expect(joinWithNext(doc, 0, 1).lines[0]!.words).toEqual([
      { start: null, text: "Hello " },
      { start: null, text: "big world" },
    ]);
  });

  test("leaves the document alone for the last word or indices out of range", () => {
    const doc = docOf(line);
    expect(joinWithNext(doc, 0, 4)).toBe(doc);
    expect(joinWithNext(doc, 0, -1)).toBe(doc);
    expect(joinWithNext(doc, 1, 0)).toBe(doc);
  });
});

describe("splitWord", () => {
  test("splits after the first part; the second part has no start", () => {
    const doc = joinWithNext(docOf(line), 0, 0);
    expect(splitWord(doc, 0, 0).lines[0]!.words!.slice(0, 3)).toEqual([
      { start: 1000, text: "And " },
      { start: null, text: "all " },
      { start: 1600, text: "through " },
    ]);
  });

  test("a word of three parts splits into one part and a joined rest", () => {
    const doc = joinWithNext(joinWithNext(docOf(line), 0, 2), 0, 2);
    expect(splitWord(doc, 0, 2).lines[0]!.words!.slice(2)).toEqual([
      { start: 1600, text: "through " },
      { start: null, text: "the night" },
    ]);
  });

  test("leaves single words and indices out of range alone", () => {
    const doc = docOf(line);
    expect(splitWord(doc, 0, 1)).toBe(doc);
    expect(splitWord(doc, 0, 9)).toBe(doc);
    expect(splitWord(doc, 3, 0)).toBe(doc);
  });

  test("join then split gives the words back, except the lost start", () => {
    const again = splitWord(joinWithNext(docOf(line), 0, 1), 0, 1).lines[0]!;
    expect(again.words!.map((w) => w.text)).toEqual(line.words!.map((w) => w.text));
    expect(again.words!.map((w) => w.start)).toEqual([1000, 1300, null, 2000, 2200]);
  });
});

describe("editing the text of a line with joined words", () => {
  const joined = joinWithNext(docOf(line), 0, 0);

  test("a typo fix keeps the joins and the timings", () => {
    const edited = setLineText(joined, 0, "And all thru the night").lines[0]!;
    expect(edited.words).toEqual([
      { start: 1000, text: "And all " },
      { start: 1600, text: "thru " },
      { start: 2000, text: "the " },
      { start: 2200, text: "night" },
    ]);
    expect(edited.end).toBe(3000);
  });

  test("a different number of parts drops word timings", () => {
    const edited = setLineText(joined, 0, "And all through the night long").lines[0]!;
    expect(edited.words).toBeUndefined();
    expect(edited.end).toBeUndefined();
    expect(edited.timestamp).toBe(1000);
  });
});
