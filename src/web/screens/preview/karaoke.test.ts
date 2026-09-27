import { describe, expect, test } from "bun:test";
import type { LrcDocument, LrcLine } from "../../../core/lrc-document";
import { currentLineAt, fillBackground, jumpBase, jumpTarget, stageLines, wordFills } from "./karaoke";

const words: LrcLine = {
  timestamp: 1000,
  text: "Shine, shine, while",
  words: [
    { start: 1000, text: "Shine, " },
    { start: 2000, text: "shine, " },
    { start: 3000, text: "while" },
  ],
  end: 4000,
};
const doc: LrcDocument = {
  metadata: { tool: "t" },
  lines: [words, { timestamp: null, text: "" }, { timestamp: 5000, text: "(ooh)" }, { timestamp: 7000, text: "Last" }],
};

describe("stage lines", () => {
  test("three lines: previous, current, next, skipping empty lines", () => {
    expect(stageLines(doc, 2, 3)).toEqual([
      { role: "prev", index: 0 },
      { role: "current", index: 2 },
      { role: "next", index: 3 },
    ]);
  });

  test("before the first line the title card is current", () => {
    expect(currentLineAt(doc, 500)).toBe(-1);
    expect(stageLines(doc, -1, 3)).toEqual([
      { role: "prev", index: -1 },
      { role: "current", index: null },
      { role: "next", index: 0 },
    ]);
  });

  test("one and two lines", () => {
    expect(stageLines(doc, 0, 1)).toEqual([{ role: "current", index: 0 }]);
    expect(stageLines(doc, 3, 2)).toEqual([
      { role: "current", index: 3 },
      { role: "next", index: -1 },
    ]);
  });
});

describe("fills", () => {
  test("by word: sung words full, the current one partly, the rest empty", () => {
    expect(wordFills(words, 2500, "word", null)).toEqual([1, 0.5, 0]);
    expect(wordFills(words, 3500, "word", null)).toEqual([1, 1, 0.5]);
  });

  test("by line, or without word timings, the whole line lights at its start", () => {
    expect(wordFills(words, 1500, "line", null)).toEqual([1, 1, 1]);
    expect(wordFills(words, 900, "line", null)).toEqual([0, 0, 0]);
    expect(wordFills(doc.lines[3]!, 7100, "word", null)).toEqual([1]);
  });

  test("gradient", () => {
    expect(fillBackground(0.58, "A", "B")).toBe("linear-gradient(90deg, A 0%, A 58%, B 58%, B 100%)");
  });
});

describe("jumping between lines", () => {
  test("skips untimed and empty lines", () => {
    expect(jumpTarget(doc, 0, 1)).toBe(2);
    expect(jumpTarget(doc, 2, -1)).toBe(0);
    expect(jumpTarget(doc, -1, 1)).toBe(0);
    expect(jumpTarget(doc, 3, 1)).toBeNull();
  });
});

describe("↑/↓ with lines out of order", () => {
  // Line 4 (index 3) at 17.80, line 5 (index 4) at 16.94: at 17.80 the stage shows index 4.
  const ooo: LrcDocument = {
    metadata: { tool: "t" },
    lines: [
      { timestamp: 10000, text: "a" },
      { timestamp: 12000, text: "b" },
      { timestamp: 14000, text: "c" },
      { timestamp: 17800, text: "d" },
      { timestamp: 16940, text: "e" },
      { timestamp: 20000, text: "f" },
    ],
  };

  test("repeated ↑ keeps going up instead of landing on the same line", () => {
    let cursor = null as { index: number; at: number } | null;
    let ms = 18500;
    const up = () => {
      const target = jumpTarget(ooo, jumpBase(ooo, ms, cursor), -1)!;
      ms = ooo.lines[target]!.timestamp!;
      cursor = { index: target, at: ms };
      return target;
    };
    expect([up(), up(), up(), up()]).toEqual([3, 2, 1, 0]);
  });

  test("the cursor is dropped once playback moves to another line or the line is re-timed", () => {
    const cursor = { index: 3, at: 17800 };
    expect(jumpBase(ooo, 17900, cursor)).toBe(3);
    expect(jumpBase(ooo, 20100, cursor)).toBe(5);
    const retimed = { ...ooo, lines: ooo.lines.map((l, i) => (i === 3 ? { ...l, timestamp: 18000 } : l)) };
    expect(jumpBase(retimed, 18100, cursor)).toBe(currentLineAt(retimed, 18100));
    expect(jumpBase(ooo, 18500, null)).toBe(4);
  });
});
