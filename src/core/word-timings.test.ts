import { test, expect, describe } from "bun:test";
import {
  createDocument, addLines, linesFromText, setTimestamp, setLineText, setWordStart,
  splitWords, lineEnd, hasAnyWordTimings,
} from "./lrc-document";
import type { LrcDocument, LrcLine } from "./lrc-document";
import { enhancedLrcPath, plainLrcPath, isEnhancedLrcPath, mergeWordTimings } from "./enhanced-lrc";
import { WordSyncEngine } from "./word-sync-engine";

const timedLine: LrcLine = {
  timestamp: 1000,
  text: "Never gonna give",
  words: [
    { start: 1000, text: "Never " },
    { start: 1500, text: "gonna " },
    { start: 2000, text: "give" },
  ],
  end: 2500,
};

function docOf(...lines: LrcLine[]): LrcDocument {
  return { ...createDocument(), lines };
}

describe("word timings in the document", () => {
  test("splitWords keeps the spacing on the word before", () => {
    expect(splitWords(" Hello  big world ")).toEqual([
      { start: null, text: "Hello  " },
      { start: null, text: "big " },
      { start: null, text: "world" },
    ]);
  });

  test("moving a line drags its words and end along", () => {
    const line = setTimestamp(docOf(timedLine), 0, 1200).lines[0]!;
    expect(line.timestamp).toBe(1200);
    expect(line.words!.map((w) => w.start)).toEqual([1200, 1700, 2200]);
    expect(line.end).toBe(2700);
  });

  test("a typo fix keeps word timings", () => {
    const line = setLineText(docOf(timedLine), 0, "Never gona give").lines[0]!;
    expect(line.words!.map((w) => w.text)).toEqual(["Never ", "gona ", "give"]);
    expect(line.words!.map((w) => w.start)).toEqual([1000, 1500, 2000]);
    expect(line.end).toBe(2500);
  });

  test("changing the number of words drops word timings", () => {
    const line = setLineText(docOf(timedLine), 0, "Never gonna give you up").lines[0]!;
    expect(line.words).toBeUndefined();
    expect(line.end).toBeUndefined();
    expect(line.timestamp).toBe(1000);
  });

  test("setWordStart creates words and the first word sets the line start", () => {
    const doc = addLines(createDocument(), linesFromText("Hello world"));
    const updated = setWordStart(doc, 0, 0, 3000);
    expect(updated.lines[0]!.timestamp).toBe(3000);
    expect(updated.lines[0]!.words).toEqual([
      { start: 3000, text: "Hello " },
      { start: null, text: "world" },
    ]);
    expect(hasAnyWordTimings(updated)).toBe(true);
    expect(hasAnyWordTimings(doc)).toBe(false);
  });

  test("lineEnd ignores an end that is not after the last word", () => {
    expect(lineEnd(timedLine)).toBe(2500);
    expect(lineEnd({ ...timedLine, end: 1800 })).toBeNull();
  });
});

describe("enhanced file paths", () => {
  test("maps between plain and enhanced names", () => {
    expect(enhancedLrcPath("/music/song.lrc")).toBe("/music/song.enhanced.lrc");
    expect(enhancedLrcPath("/music/song.enhanced.lrc")).toBe("/music/song.enhanced.lrc");
    expect(enhancedLrcPath("/music/v1.0/song")).toBe("/music/v1.0/song.enhanced.lrc");
    expect(plainLrcPath("/music/song.enhanced.lrc")).toBe("/music/song.lrc");
    expect(plainLrcPath("/music/song.lrc")).toBe("/music/song.lrc");
    expect(isEnhancedLrcPath("song.enhanced.lrc")).toBe(true);
    expect(isEnhancedLrcPath("song.lrc")).toBe(false);
  });
});

describe("mergeWordTimings", () => {
  test("attaches words to lines with the same text, in order", () => {
    const base = docOf(
      { timestamp: 500, text: "Intro" },
      { timestamp: 1000, text: "Never gonna give" },
    );
    const merged = mergeWordTimings(base, docOf(timedLine));
    expect(merged.lines[0]).toEqual({ timestamp: 500, text: "Intro" });
    expect(merged.lines[1]!.words).toEqual(timedLine.words);
  });

  test("edited lines lose word timings and re-timed lines drag them along", () => {
    const base = docOf(
      { timestamp: 1100, text: "Never gonna give" },
      { timestamp: 3000, text: "Changed line" },
    );
    const enhanced = docOf(timedLine, { ...timedLine, timestamp: 3000, text: "Old line", words: [{ start: 3000, text: "Old " }, { start: 3300, text: "line" }] });
    const merged = mergeWordTimings(base, enhanced);
    expect(merged.lines[0]!.words!.map((w) => w.start)).toEqual([1100, 1600, 2100]);
    expect(merged.lines[1]).toEqual({ timestamp: 3000, text: "Changed line" });
  });
});

describe("WordSyncEngine", () => {
  const doc = () => addLines(createDocument(), linesFromText("Hello world\nBye"));

  test("marks every word, moving on to the next line", () => {
    const engine = new WordSyncEngine(doc());
    engine.mark(1000);
    engine.mark(1500);
    expect(engine.lineIndex).toBe(1);
    expect(engine.wordIndex).toBe(0);
    engine.mark(3000);
    expect(engine.isComplete).toBe(true);
    const lines = engine.document.lines;
    expect(lines[0]!.timestamp).toBe(1000);
    expect(lines[0]!.words!.map((w) => w.start)).toEqual([1000, 1500]);
    expect(lines[1]!.timestamp).toBe(3000);
  });

  test("skips lines without words", () => {
    const withBlank = { ...createDocument(), lines: [{ timestamp: null, text: "" }, ...doc().lines] };
    const engine = new WordSyncEngine(withBlank);
    expect(engine.lineIndex).toBe(1);
  });

  test("undo restores the word and the line start", () => {
    const engine = new WordSyncEngine(doc());
    engine.mark(1000);
    engine.skip();
    engine.undo();
    expect(engine.lineIndex).toBe(0);
    expect(engine.wordIndex).toBe(1);
    engine.undo();
    expect(engine.wordIndex).toBe(0);
    expect(engine.document.lines[0]).toEqual({ timestamp: null, text: "Hello world" });
  });

  test("starts at the given line", () => {
    const engine = new WordSyncEngine(doc(), 1);
    engine.mark(3000);
    expect(engine.isComplete).toBe(true);
    expect(engine.document.lines[0]!.words).toBeUndefined();
  });
});
