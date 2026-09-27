import { describe, expect, test } from "bun:test";
import type { Flag } from "../../../core/flags";
import type { LrcDocument, LrcLine } from "../../../core/lrc-document";
import { laneLayout } from "./lanes";
import { moveTarget, nudgeTarget, parseTime, stepWord, targetStart } from "./nudge";
import { Fft, colorRamp, hexToRgb, logBandEdges, quantizeMsPerCol, referenceDb, spectrogramColumns, tilesFor } from "./spectrogram";
import { clampView, ensureVisible, msAt, nextPreset, rulerTicks, spanLabel, viewForLine, xOf, zoomAround } from "./timeline-view";
import { barLevels, loudestLevel, voicedBars } from "./waves";
import { edgeWords, flagNote, flagTime, lineBlocks, MIN_BLOCK_MS } from "./word-blocks";

const doc = (lines: LrcLine[]): LrcDocument => ({ metadata: { tool: "t" }, lines });

describe("timeline view", () => {
  test("maps time to pixels and back", () => {
    const v = { startMs: 41200, spanMs: 4000 };
    expect(xOf(v, 1000, 41460)).toBeCloseTo(65);
    expect(msAt(v, 1000, 65)).toBeCloseTo(41460);
  });

  test("zooming keeps the anchor in place", () => {
    const v = zoomAround({ startMs: 0, spanMs: 4000 }, 2000, 1000);
    expect(v.spanMs).toBe(2000);
    expect(xOf(v, 1000, 1000)).toBeCloseTo(250);
  });

  test("presets step in and out and clamp at the ends", () => {
    expect(nextPreset(4000, -1)).toBe(2000);
    expect(nextPreset(4000, 1)).toBe(8000);
    expect(nextPreset(3000, 1)).toBe(4000);
    expect(nextPreset(3000, -1)).toBe(2000);
    expect(nextPreset(16000, 1)).toBe(16000);
    expect(nextPreset(2000, -1)).toBe(2000);
    expect(nextPreset(1500, -1)).toBe(1500);
  });

  test("labels the span", () => {
    expect(spanLabel(4000)).toBe("4 s view");
    expect(spanLabel(2500)).toBe("2.5 s view");
  });

  test("clamps to the song with a little overscroll", () => {
    expect(clampView({ startMs: -1000, spanMs: 4000 }, 60000).startMs).toBe(-200);
    expect(clampView({ startMs: 59000, spanMs: 4000 }, 60000).startMs).toBe(56200);
    expect(clampView({ startMs: 59000, spanMs: 4000 }, 0).startMs).toBe(59000);
  });

  test("a line view starts just before the line", () => {
    const v = viewForLine(41460, 4000);
    expect(xOf(v, 1000, 41460)).toBeCloseTo(65);
  });

  test("ensureVisible leaves visible times alone and scrolls to hidden ones", () => {
    const v = { startMs: 0, spanMs: 4000 };
    expect(ensureVisible(v, 2000)).toBe(v);
    expect(ensureVisible(v, 10000).startMs).toBeLessThan(10000);
    expect(ensureVisible(v, 10000).startMs + 4000).toBeGreaterThan(10000);
  });

  test("ruler ticks match the board at 4 s over 1000 px", () => {
    const { minor, major } = rulerTicks({ startMs: 41200, spanMs: 4000 }, 1000);
    expect(major.map((m) => m.label)).toEqual(["41.50", "42.00", "42.50", "43.00", "43.50", "44.00", "44.50", "45.00"]);
    expect(minor[0]).toBe(41200);
    expect(minor.length + major.length).toBe(41);
  });
});

describe("lanes", () => {
  test("the board's layout at 512 px", () => {
    const l = laneLayout(512, { vocals: true, spect: true, mix: true }, false);
    expect(l.words).toEqual({ y: 34, h: 64 });
    expect(l.vocals).toEqual({ y: 104, h: 180 });
    expect(l.spect).toEqual({ y: 290, h: 160 });
    expect(l.mix).toEqual({ y: 456, h: 56 });
  });

  test("hidden lanes give their room to the others; the ghost strip sits under the words", () => {
    const l = laneLayout(512, { vocals: true, spect: false, mix: true }, true);
    expect(l.ghost).toEqual({ y: 104, h: 26 });
    expect(l.spect).toBeNull();
    expect(l.vocals!.y).toBe(136);
    expect(l.mix!.y + l.mix!.h).toBe(512);
  });

  test("only the mix: it fills the rest", () => {
    const l = laneLayout(400, { vocals: false, spect: false, mix: true }, false);
    expect(l.mix!.y + l.mix!.h).toBe(400);
  });
});

describe("word blocks", () => {
  const line: LrcLine = {
    timestamp: 41460,
    text: "Shine, shine, while I’m here",
    words: [
      { start: 41460, text: "Shine, " },
      { start: 42100, text: "shine, " },
      { start: 42830, text: "while " },
      { start: 43210, text: "I’m here" },
    ],
    end: 44400,
  };

  test("a block runs from its start to the next start, the last to the line end", () => {
    const { blocks, untimed } = lineBlocks(line, 45020);
    expect(blocks.map((b) => [b.start, b.end])).toEqual([
      [41460, 42100],
      [42100, 42830],
      [42830, 43210],
      [43210, 44400],
    ]);
    expect(untimed).toEqual([]);
  });

  test("joined words get split marks, untimed words go to the ghost strip", () => {
    const l: LrcLine = { ...line, end: null, words: [{ start: 1000, text: "I’m here " }, { start: null, text: "now" }] };
    const { blocks, untimed } = lineBlocks(l, 9000);
    expect(blocks[0]!.parts).toEqual(["I’m", "here"]);
    expect(blocks[0]!.splits).toHaveLength(1);
    expect(blocks[0]!.splits[0]!).toBeGreaterThan(1000);
    expect(blocks[0]!.end).toBe(4000);
    expect(untimed).toEqual([{ index: 1, text: "now" }]);
  });

  test("blocks follow time order, so an out-of-order word doesn't cover the one it jumped over", () => {
    const l: LrcLine = { timestamp: 1000, text: "a b c", words: [{ start: 1000, text: "a " }, { start: 2000, text: "b " }, { start: 1500, text: "c" }] };
    expect(lineBlocks(l, 3000).blocks.map((b) => [b.start, b.end])).toEqual([
      [1000, 1500],
      [2000, 3000],
      [1500, 2000],
    ]);
    const same: LrcLine = { timestamp: 1000, text: "a b", words: [{ start: 1000, text: "a " }, { start: 1000, text: "b" }] };
    expect(lineBlocks(same, null).blocks[0]!.end).toBe(1000 + MIN_BLOCK_MS);
  });

  test("edge words come from the neighbouring timed lines", () => {
    const d = doc([
      { timestamp: 30000, text: "Summer never ends", words: [{ start: 30000, text: "Summer " }, { start: 30500, text: "never " }, { start: 31000, text: "ends" }] },
      { timestamp: null, text: "" },
      line,
      { timestamp: 45020, text: "I don’t need anything more" },
    ]);
    const { prev, next } = edgeWords(d, 2);
    expect(prev).toEqual({ lineIndex: 0, text: "ends", start: 31000, end: 34000 });
    expect(next!.lineIndex).toBe(3);
    expect(next!.start).toBe(45020);
  });

  test("flag time and note", () => {
    const d = doc([line]);
    const flag: Flag = { id: "x", kind: "starts-in-silence", lineIndex: 0, wordIndex: 1, message: "", suggestMs: 42180 };
    expect(flagTime(d, flag)).toBe(42100);
    expect(flagNote(d, flag)).toBe("80 ms before voice");
    expect(flagNote(d, { ...flag, kind: "words-out-of-order" })).toBe("out of order");
  });
});

describe("nudging", () => {
  const d = doc([
    { timestamp: 1000, text: "a b", words: [{ start: 1000, text: "a " }, { start: 1500, text: "b" }] },
    { timestamp: 3000, text: "c d" },
  ]);

  test("a word moves on its own; the first word moves the line start too", () => {
    const moved = nudgeTarget(d, { line: 0, word: 1 }, 10, 60000);
    expect(moved.lines[0]!.words![1]!.start).toBe(1510);
    expect(moved.lines[0]!.timestamp).toBe(1000);
    const first = nudgeTarget(d, { line: 0, word: 0 }, -100, 60000);
    expect(first.lines[0]!.timestamp).toBe(900);
    expect(first.lines[0]!.words![1]!.start).toBe(1500);
  });

  test("the line start drags its words along", () => {
    const moved = nudgeTarget(d, { line: 0, word: null }, 100, 60000);
    expect(moved.lines[0]!.timestamp).toBe(1100);
    expect(moved.lines[0]!.words!.map((w) => w.start)).toEqual([1100, 1600]);
  });

  test("clamps to the song and leaves untimed targets alone", () => {
    expect(moveTarget(d, { line: 0, word: 0 }, -500, 60000).lines[0]!.timestamp).toBe(0);
    expect(moveTarget(d, { line: 1, word: null }, 99999, 60000).lines[1]!.timestamp).toBe(60000);
    const untimed = doc([{ timestamp: null, text: "x" }]);
    expect(nudgeTarget(untimed, { line: 0, word: null }, 10, 60000)).toBe(untimed);
    expect(moveTarget(untimed, { line: 0, word: null }, 4200, 60000).lines[0]!.timestamp).toBe(4200);
    expect(targetStart(d, { line: 1, word: 0 })).toBeNull();
  });

  test("Tab walks the words, with the line start before the first", () => {
    expect(stepWord(4, null, 1)).toBe(0);
    expect(stepWord(4, 0, 1)).toBe(1);
    expect(stepWord(4, 3, 1)).toBe(3);
    expect(stepWord(4, 0, -1)).toBeNull();
    expect(stepWord(4, null, -1)).toBe(3);
    expect(stepWord(0, null, 1)).toBeNull();
  });

  test("parses typed times", () => {
    expect(parseTime("00:42.83")).toBe(42830);
    expect(parseTime("1:02.5")).toBe(62500);
    expect(parseTime("42.83")).toBe(42830);
    expect(parseTime("42")).toBe(42000);
    expect(parseTime("1:75.00")).toBeNull();
    expect(parseTime("abc")).toBeNull();
  });
});

describe("spectrogram", () => {
  test("a sine peaks in the band holding its frequency", () => {
    const rate = 22050;
    const hz = 1000;
    const samples = Float32Array.from({ length: rate }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));
    const rows = 48;
    const edges = logBandEdges(rows, rate);
    const levels = spectrogramColumns(samples, rate, 400, 10, 1, edges, referenceDb(1024, 1), new Fft());
    let best = 0;
    for (let y = 1; y < rows; y++) if (levels[y]! > levels[best]!) best = y;
    const binHz = rate / 1024;
    expect(edges[best + 1]! * binHz).toBeLessThanOrEqual(hz + binHz);
    expect(edges[best]! * binHz).toBeGreaterThanOrEqual(hz - binHz);
    expect(levels[best]!).toBeGreaterThan(0.9);
  });

  test("silence is dark; frames outside the signal stay zero", () => {
    const edges = logBandEdges(16, 22050);
    const levels = spectrogramColumns(new Float32Array(22050), 22050, -5000, 10, 2, edges, referenceDb(1024, 1), new Fft());
    expect(Math.max(...levels)).toBe(0);
  });

  test("band edges run from the top frequency down to 80 Hz", () => {
    const edges = logBandEdges(10, 22050);
    const binHz = 22050 / 1024;
    expect(edges[0]! * binHz).toBeCloseTo(11000, 0);
    expect(edges[10]! * binHz).toBeCloseTo(80, 3);
  });

  test("column widths snap to √2 steps; tiles cover a range", () => {
    expect(quantizeMsPerCol(4)).toBe(4);
    expect(quantizeMsPerCol(4.3)).toBe(4);
    expect(quantizeMsPerCol(5.4)).toBeCloseTo(5.657, 2);
    expect(tilesFor(0, 1999, 4, 128)).toEqual([0, 1, 2, 3]);
    expect(tilesFor(-100, 100, 4, 128)).toEqual([0]);
  });

  test("colour ramp interpolates between stops", () => {
    const lut = colorRamp([
      [0, hexToRgb("#000000")],
      [1, hexToRgb("#fff")],
    ]);
    expect([lut[0], lut[1], lut[2]]).toEqual([0, 0, 0]);
    expect([lut[765], lut[766], lut[767]]).toEqual([255, 255, 255]);
    expect(lut[128 * 3]).toBe(128);
  });
});

describe("wave bars", () => {
  test("RMS per bar, silence outside the signal", () => {
    const samples = new Float32Array(1000).fill(0.5);
    const bars = barLevels(samples, 1000, 4, -500, 1500);
    expect([...bars].map((v) => Math.round(v * 100) / 100)).toEqual([0, 0.5, 0.5, 0]);
    expect(loudestLevel(samples, 1000)).toBeCloseTo(0.5);
  });

  test("voiced bars follow the envelope threshold", () => {
    const env = Float32Array.from([0, 0, 0.5, 0.5, 0.01, 0]);
    expect(voicedBars(env, 10, 3, 0, 60)).toEqual([false, true, false]);
  });
});
