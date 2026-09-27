import { describe, expect, test } from "bun:test";
import type { LrcDocument } from "../../core/lrc-document";
import { hasTimings, LAST_LINE_MS, lineSpan, timedLineFrom } from "./timing";

const doc = (times: (number | null)[]): LrcDocument => ({
  metadata: { tool: "t" },
  lines: times.map((timestamp, i) => ({ timestamp, text: `line ${i}` })),
});

describe("lineSpan", () => {
  test("runs to the next timed line", () => {
    expect(lineSpan(doc([1000, null, 5000]), 0, 60000)).toEqual({ from: 1000, to: 5000 });
  });

  test("an untimed line has no span", () => {
    expect(lineSpan(doc([1000, null]), 1, 60000)).toBeNull();
  });

  test("the last line uses its end, else a default length capped at the song's end", () => {
    const withEnd: LrcDocument = { metadata: { tool: "t" }, lines: [{ timestamp: 1000, text: "a", words: [{ start: 1000, text: "a" }], end: 2500 }] };
    expect(lineSpan(withEnd, 0, 60000)).toEqual({ from: 1000, to: 2500 });
    expect(lineSpan(doc([1000]), 0, 60000)).toEqual({ from: 1000, to: 1000 + LAST_LINE_MS });
    expect(lineSpan(doc([58000]), 0, 60000)).toEqual({ from: 58000, to: 60000 });
  });
});

describe("timedLineFrom", () => {
  test("finds the nearest timed line in a direction", () => {
    const d = doc([null, 1000, null, 3000]);
    expect(timedLineFrom(d, 2, 1)).toBe(3);
    expect(timedLineFrom(d, 2, -1)).toBe(1);
    expect(timedLineFrom(d, 0, -1)).toBe(-1);
  });
});

test("hasTimings", () => {
  expect(hasTimings(doc([null, null]))).toBe(false);
  expect(hasTimings(doc([null, 5]))).toBe(true);
});
