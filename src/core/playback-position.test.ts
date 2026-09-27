import { test, expect, describe } from "bun:test";
import { createDocument } from "./lrc-document";
import type { LrcLine } from "./lrc-document";
import { lineIndexAt, wordIndexAt, wordFill } from "./playback-position";

const line: LrcLine = {
  timestamp: 1000,
  text: "Shine, shine, while I'm here",
  words: [
    { start: 1000, text: "Shine, " },
    { start: 2000, text: "shine, " },
    { start: null, text: "while " },
    { start: 3000, text: "I'm " },
    { start: 3500, text: "here" },
  ],
  end: 4500,
};

describe("lineIndexAt", () => {
  const doc = {
    ...createDocument(),
    lines: [
      { timestamp: 1000, text: "One" },
      { timestamp: null, text: "Two" },
      { timestamp: 5000, text: "Three" },
    ],
  };

  test("finds the last timed line that has started", () => {
    expect(lineIndexAt(doc, 0)).toBe(-1);
    expect(lineIndexAt(doc, 1000)).toBe(0);
    expect(lineIndexAt(doc, 4999)).toBe(0);
    expect(lineIndexAt(doc, 5000)).toBe(2);
    expect(lineIndexAt(doc, 60_000)).toBe(2);
  });

  test("returns -1 for a document without timings", () => {
    expect(lineIndexAt(createDocument(), 1000)).toBe(-1);
  });
});

describe("wordIndexAt", () => {
  test("finds the last timed word that has started, skipping untimed ones", () => {
    expect(wordIndexAt(line, 999)).toBe(-1);
    expect(wordIndexAt(line, 1000)).toBe(0);
    expect(wordIndexAt(line, 2500)).toBe(1);
    expect(wordIndexAt(line, 3000)).toBe(3);
    expect(wordIndexAt(line, 9000)).toBe(4);
  });

  test("returns -1 for a line without words", () => {
    expect(wordIndexAt({ timestamp: 1000, text: "Hello" }, 2000)).toBe(-1);
  });
});

describe("wordFill", () => {
  test("fills from the word's start to the next word's start", () => {
    expect(wordFill(line, 0, 500, null)).toBe(0);
    expect(wordFill(line, 0, 1000, null)).toBe(0);
    expect(wordFill(line, 0, 1250, null)).toBe(0.25);
    expect(wordFill(line, 0, 2000, null)).toBe(1);
    expect(wordFill(line, 0, 9000, null)).toBe(1);
  });

  test("skips untimed words to find the next start; an untimed word fills with the one before it", () => {
    expect(wordFill(line, 1, 2500, null)).toBe(0.5);
    expect(wordFill(line, 2, 2500, null)).toBe(0.5);
    expect(wordFill(line, 2, 1500, null)).toBe(0);
  });

  test("the last word fills up to the line end, else the fallback, else all at once", () => {
    expect(wordFill(line, 4, 4000, null)).toBe(0.5);
    const noEnd: LrcLine = { ...line, end: null };
    expect(wordFill(noEnd, 4, 4000, 5500)).toBe(0.25);
    expect(wordFill(noEnd, 4, 3500, null)).toBe(1);
    expect(wordFill(noEnd, 4, 3499, null)).toBe(0);
  });

  test("words out of range or on a line without words stay empty", () => {
    expect(wordFill(line, 9, 4000, null)).toBe(0);
    expect(wordFill({ timestamp: 1000, text: "Hello" }, 0, 2000, 3000)).toBe(0);
  });
});
