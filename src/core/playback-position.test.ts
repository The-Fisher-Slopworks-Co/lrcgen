import { describe, expect, test } from "bun:test";
import { lineIndexAt, wordFill, wordIndexAt } from "./playback-position";
import { doc, group } from "./testing";

const line = group("Shine, shine, while I'm here", [1000, 2000, null, 3000, 3500], [null, null, null, null, 4500]);

describe("lineIndexAt", () => {
  const d = doc(group("One", [1000]), group("Two"), group("ooh", [2000], [], ["backing"]), group("Three", [5000]));

  test("finds the last line that has started; labelled groups aren't lines", () => {
    expect(lineIndexAt(d, 0)).toBe(-1);
    expect(lineIndexAt(d, 1000)).toBe(0);
    expect(lineIndexAt(d, 4999)).toBe(0);
    expect(lineIndexAt(d, 5000)).toBe(3);
    expect(lineIndexAt(d, 60_000)).toBe(3);
  });

  test("returns -1 for a document without timings", () => {
    expect(lineIndexAt(doc(group("a")), 1000)).toBe(-1);
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
});

describe("wordFill", () => {
  test("fills from the word's start to the next word's start", () => {
    expect(wordFill(line, 0, 500, null)).toBe(0);
    expect(wordFill(line, 0, 1000, null)).toBe(0);
    expect(wordFill(line, 0, 1250, null)).toBe(0.25);
    expect(wordFill(line, 0, 2000, null)).toBe(1);
  });

  test("a word with an end is full when it ends", () => {
    const g = group("a b", [1000, 2000], [1400, null]);
    expect(wordFill(g, 0, 1200, null)).toBe(0.5);
    expect(wordFill(g, 0, 1400, null)).toBe(1);
  });

  test("skips untimed words to find the next start; an untimed word fills with the one before it", () => {
    expect(wordFill(line, 1, 2500, null)).toBe(0.5);
    expect(wordFill(line, 2, 2500, null)).toBe(0.5);
    expect(wordFill(line, 2, 1500, null)).toBe(0);
  });

  test("the last word fills up to its end, else the fallback, else all at once", () => {
    expect(wordFill(line, 4, 4000, null)).toBe(0.5);
    const noEnd = group("a b", [1000, 3500]);
    expect(wordFill(noEnd, 1, 4000, 5500)).toBe(0.25);
    expect(wordFill(noEnd, 1, 3500, null)).toBe(1);
    expect(wordFill(noEnd, 1, 3499, null)).toBe(0);
  });

  test("words out of range stay empty", () => {
    expect(wordFill(line, 9, 4000, null)).toBe(0);
  });
});
