import { describe, expect, test } from "bun:test";
import { doc, group } from "../../core/testing";
import { hasTimings, LAST_LINE_MS, LAST_WORD_MS, lineSpan, timedLineFrom } from "./timing";

const lines = (times: (number | null)[]) => doc(...times.map((t, i) => group(`line ${i}`, [t])));

describe("lineSpan", () => {
  test("a line without an end runs to the next line", () => {
    expect(lineSpan(lines([1000, null, 5000]), 0, 60000)).toEqual({ from: 1000, to: 5000 });
  });

  test("a line whose words know its end plays exactly that", () => {
    expect(lineSpan(doc(group("a b", [1000, 1500], [null, 2500]), group("c", [5000])), 0, 60000)).toEqual({ from: 1000, to: 2500 });
  });

  test("labelled groups don't cut a line short", () => {
    const d = doc(group("one two", [1000, 3000]), group("ooh", [2000], [], ["backing"]), group("next", [5000]));
    expect(lineSpan(d, 0, 60000)).toEqual({ from: 1000, to: 5000 });
    expect(lineSpan(d, 1, 60000)).toEqual({ from: 2000, to: 2000 + LAST_WORD_MS });
  });

  test("an untimed line has no span", () => {
    expect(lineSpan(lines([1000, null]), 1, 60000)).toBeNull();
  });

  test("the last line uses a default length capped at the song's end", () => {
    expect(lineSpan(lines([1000]), 0, 60000)).toEqual({ from: 1000, to: 1000 + LAST_LINE_MS });
    expect(lineSpan(lines([58000]), 0, 60000)).toEqual({ from: 58000, to: 60000 });
  });
});

describe("timedLineFrom", () => {
  test("finds the nearest timed line in a direction", () => {
    const d = lines([null, 1000, null, 3000]);
    expect(timedLineFrom(d, 2, 1)).toBe(3);
    expect(timedLineFrom(d, 2, -1)).toBe(1);
    expect(timedLineFrom(d, 0, -1)).toBe(-1);
  });
});

test("hasTimings", () => {
  expect(hasTimings(lines([null, null]))).toBe(false);
  expect(hasTimings(lines([null, 5]))).toBe(true);
});
