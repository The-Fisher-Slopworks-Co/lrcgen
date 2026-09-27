import { describe, expect, test } from "bun:test";
import type { LrcDocument, LrcLine } from "../../../core/lrc-document";
import { changedLine, firstUntimedLine, keepInView, lineAt, lineCounts, nudgeLine, pausedStart, tapLine } from "./line-tapping";

function doc(lines: LrcLine[]): LrcDocument {
  return { metadata: { tool: "t" }, lines };
}
const line = (timestamp: number | null, text = "la la"): LrcLine => ({ timestamp, text });

describe("tapLine", () => {
  test("times the line and moves on to the next", () => {
    const d = doc([line(1000), line(null), line(null)]);
    const r = tapLine(d, 1, 2345.6);
    expect(r.doc.lines[1]!.timestamp).toBe(2346);
    expect(r.next).toBe(2);
    expect(r.doc.lines[0]).toBe(d.lines[0]!);
  });

  test("has no next line after the last one", () => {
    expect(tapLine(doc([line(null)]), 0, 10).next).toBeNull();
  });

  test("keeps a tap that lands before the line above (the flag points it out)", () => {
    expect(tapLine(doc([line(5000), line(null)]), 1, 4000).doc.lines[1]!.timestamp).toBe(4000);
  });

  test("re-timing a line with words moves the words along", () => {
    const d = doc([{ timestamp: 1000, text: "a b", words: [{ start: 1000, text: "a " }, { start: 1500, text: "b" }], end: 2000 }]);
    const moved = tapLine(d, 0, 1200).doc.lines[0]!;
    expect(moved.words!.map((w) => w.start)).toEqual([1200, 1700]);
    expect(moved.end).toBe(2200);
  });
});

describe("nudgeLine", () => {
  test("moves a timed line and never below zero", () => {
    expect(nudgeLine(doc([line(1000)]), 0, 10)!.lines[0]!.timestamp).toBe(1010);
    expect(nudgeLine(doc([line(50)]), 0, -100)!.lines[0]!.timestamp).toBe(0);
  });

  test("does nothing to an untimed line or at zero", () => {
    expect(nudgeLine(doc([line(null)]), 0, 10)).toBeNull();
    expect(nudgeLine(doc([line(0)]), 0, -10)).toBeNull();
  });
});

describe("changedLine", () => {
  test("finds the line an undo put back", () => {
    const before = doc([line(1), line(2), line(3)]);
    const after = { ...before, lines: before.lines.map((l, i) => (i === 1 ? line(null) : l)) };
    expect(changedLine(before, after)).toBe(1);
    expect(changedLine(before, before)).toBe(-1);
  });

  test("notices an added line at the end", () => {
    const before = doc([line(1)]);
    expect(changedLine(before, { ...before, lines: [...before.lines, line(null)] })).toBe(1);
  });
});

test("firstUntimedLine", () => {
  expect(firstUntimedLine(doc([line(1), line(null), line(null)]))).toBe(1);
  expect(firstUntimedLine(doc([line(1)]))).toBe(-1);
});

describe("lineAt", () => {
  const d = doc([line(1000), line(null), line(3000), line(6000)]);
  test("is the latest line started", () => {
    expect(lineAt(d, 500, 60_000)).toBe(-1);
    expect(lineAt(d, 1000, 60_000)).toBe(0);
    expect(lineAt(d, 2999, 60_000)).toBe(0);
    expect(lineAt(d, 3000, 60_000)).toBe(2);
  });

  test("ends after the last line's span", () => {
    expect(lineAt(d, 6000 + 7999, 60_000)).toBe(3);
    expect(lineAt(d, 6000 + 8000, 60_000)).toBe(-1);
  });

  test("goes by time when lines are out of order", () => {
    expect(lineAt(doc([line(5000), line(4000)]), 5100, 60_000)).toBe(0);
  });
});

test("lineCounts leaves out empty lines", () => {
  expect(lineCounts(doc([line(1), line(null), line(null, "  "), line(4, "")]))).toEqual({ timed: 1, total: 2 });
});

describe("pausedStart", () => {
  const d = doc([line(1000), line(10_000), line(null)]);
  test("plays from where you are before the target line", () => {
    expect(pausedStart(d, 1, 4000)).toBe(4000);
    expect(pausedStart(d, 2, 12_000)).toBe(12_000);
  });

  test("backs up when sitting on (or past) the target's start", () => {
    expect(pausedStart(d, 1, 10_000)).toBe(8000);
    expect(pausedStart(d, 1, 15_000)).toBe(8000);
    expect(pausedStart(d, 0, 1000)).toBe(0);
  });
});

describe("keepInView", () => {
  test("leaves a visible row alone", () => {
    expect(keepInView(100, 300, [{ top: 150, bottom: 190 }])).toBe(100);
  });

  test("scrolls up or down just enough", () => {
    expect(keepInView(100, 300, [{ top: 50, bottom: 90 }], 10)).toBe(40);
    expect(keepInView(100, 300, [{ top: 420, bottom: 460 }], 10)).toBe(170);
  });

  test("keeps both rows when they fit, else the first", () => {
    expect(keepInView(0, 300, [{ top: 400, bottom: 440 }, { top: 300, bottom: 340 }])).toBe(140);
    expect(keepInView(0, 300, [{ top: 900, bottom: 940 }, { top: 100, bottom: 140 }])).toBe(640);
  });
});
