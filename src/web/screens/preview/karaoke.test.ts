import { describe, expect, test } from "bun:test";
import { groupStart, type LyricsDoc } from "../../../core/lyrics";
import { doc as build, group } from "../../../core/testing";
import { currentLineAt, fillBackground, jumpBase, jumpTarget, overlaysAt, stageLines, wordFills } from "./karaoke";

const words = group("Shine, shine, while", [1000, 2000, 3000], [null, null, 4000]);
const doc: LyricsDoc = build(words, { id: "", labels: [], words: [] }, group("Middle", [5000]), group("ooh", [5200], [5800], ["backing"]), group("Last", [7000]));

describe("stage lines", () => {
  test("three lines: previous, current, next, skipping empty and labelled groups", () => {
    expect(stageLines(doc, 2, 3)).toEqual([
      { role: "prev", index: 0 },
      { role: "current", index: 2 },
      { role: "next", index: 4 },
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
    expect(stageLines(doc, 4, 2)).toEqual([
      { role: "current", index: 4 },
      { role: "next", index: -1 },
    ]);
  });

  test("a backing vocal is not the current line; it shows while it sounds", () => {
    expect(currentLineAt(doc, 5500)).toBe(2);
    expect(overlaysAt(doc, 5500, 60_000)).toEqual([3]);
    expect(overlaysAt(doc, 5900, 60_000)).toEqual([]);
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
    expect(wordFills(doc.groups[4]!, 7100, "word", null)).toEqual([1]);
  });

  test("gradient", () => {
    expect(fillBackground(0.58, "A", "B")).toBe("linear-gradient(90deg, A 0%, A 58%, B 58%, B 100%)");
  });
});

describe("jumping between lines", () => {
  test("skips untimed, empty and labelled groups", () => {
    expect(jumpTarget(doc, 0, 1)).toBe(2);
    expect(jumpTarget(doc, 2, 1)).toBe(4);
    expect(jumpTarget(doc, 2, -1)).toBe(0);
    expect(jumpTarget(doc, -1, 1)).toBe(0);
    expect(jumpTarget(doc, 4, 1)).toBeNull();
  });
});

describe("↑/↓ with lines out of order", () => {
  // Line 4 (index 3) at 17.80, line 5 (index 4) at 16.94: at 17.80 the stage shows index 4.
  const ooo = build(...[10000, 12000, 14000, 17800, 16940, 20000].map((t, i) => group("abcdef"[i]!, [t])));

  test("repeated ↑ keeps going up instead of landing on the same line", () => {
    let cursor = null as { index: number; at: number } | null;
    let ms = 18500;
    const up = () => {
      const target = jumpTarget(ooo, jumpBase(ooo, ms, cursor), -1)!;
      ms = groupStart(ooo.groups[target]!)!;
      cursor = { index: target, at: ms };
      return target;
    };
    expect([up(), up(), up(), up()]).toEqual([3, 2, 1, 0]);
  });

  test("the cursor is dropped once playback moves to another line or the line is re-timed", () => {
    const cursor = { index: 3, at: 17800 };
    expect(jumpBase(ooo, 17900, cursor)).toBe(3);
    expect(jumpBase(ooo, 20100, cursor)).toBe(5);
    const retimed = { ...ooo, groups: ooo.groups.map((g, i) => (i === 3 ? { ...g, words: g.words.map((w) => ({ ...w, start: 18000 })) } : g)) };
    expect(jumpBase(retimed, 18100, cursor)).toBe(currentLineAt(retimed, 18100));
    expect(jumpBase(ooo, 18500, null)).toBe(4);
  });
});
