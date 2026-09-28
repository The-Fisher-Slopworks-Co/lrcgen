import { describe, expect, test } from "bun:test";
import type { Flag } from "../../../core/flags";
import { doc, endsOf, group, startsOf } from "../../../core/testing";
import { blockEnd, flagNote, groupBlocks, MIN_BLOCK_MS, timelineRows } from "./blocks";
import { exportedLine, groupJson } from "./export-preview";
import { laneLayout, ROW_H } from "./lanes";
import { moveEnd, moveTarget, nudgeEnd, nudgeTarget, parseTime, targetEnd, targetStart } from "./nudge";
import { beginRetap, currentWord, preRollFor, retapDone, stepBack, tapAt } from "./retap";
import { Fft, colorRamp, hexToRgb, logBandEdges, quantizeMsPerCol, referenceDb, spectrogramColumns, tilesFor } from "./spectrogram";
import { clampView, ensureVisible, msAt, nextPreset, rulerTicks, spanLabel, viewForLine, xOf, zoomAround } from "./timeline-view";
import { barLevels, loudestLevel, voicedBars } from "./waves";

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
  test("one row of groups, then the audio lanes at 512 px", () => {
    const l = laneLayout(512, { vocals: true, spect: true, mix: true }, false);
    expect(l.words).toEqual({ y: 34, h: ROW_H });
    expect(l.vocals!.y).toBe(34 + ROW_H + 6);
    expect(l.mix!.y + l.mix!.h).toBe(512);
  });

  test("more rows take room from the vocals and spectrogram", () => {
    const one = laneLayout(512, { vocals: true, spect: true, mix: true }, false, 1);
    const three = laneLayout(512, { vocals: true, spect: true, mix: true }, false, 3);
    expect(three.words.h).toBe(3 * ROW_H);
    expect(three.vocals!.h).toBeLessThan(one.vocals!.h);
  });

  test("hidden lanes give their room to the others; the ghost strip sits under the rows", () => {
    const l = laneLayout(512, { vocals: true, spect: false, mix: true }, true);
    expect(l.ghost).toEqual({ y: 34 + ROW_H + 6, h: 26 });
    expect(l.spect).toBeNull();
    expect(l.mix!.y + l.mix!.h).toBe(512);
  });

  test("only the mix: it fills the rest", () => {
    const l = laneLayout(400, { vocals: false, spect: false, mix: true }, false);
    expect(l.mix!.y + l.mix!.h).toBe(400);
  });
});

describe("word blocks", () => {
  const line = group("Shine, shine, while I’m_here", [41460, 42100, 42830, 43210], [null, 42600, null, 44400]);

  test("a block runs to its end, or without one to the next start", () => {
    const d = doc(line, group("next", [45020]));
    const { blocks, untimed } = groupBlocks(d, 0, 60000);
    expect(blocks.map((b) => [b.start, b.end, b.derived])).toEqual([
      [41460, 42100, true],
      [42100, 42600, false],
      [42830, 43210, true],
      [43210, 44400, false],
    ]);
    expect(untimed).toEqual([]);
  });

  test("joined words get split marks; untimed words go to the ghost strip; the last word runs to the next line", () => {
    const d = doc(group("I’m_here now", [1000, null]), group("next", [9000]));
    const { blocks, untimed } = groupBlocks(d, 0, 60000);
    expect(blocks[0]!.parts).toEqual(["I’m", "here"]);
    expect(blocks[0]!.splits).toHaveLength(1);
    expect(blocks[0]!.end).toBe(4000);
    expect(untimed).toEqual([{ word: 1, text: "now" }]);
  });

  test("blocks follow time order, so an out-of-order word doesn't cover the one it jumped over", () => {
    const g = group("a b c", [1000, 2000, 1500]);
    expect([0, 1, 2].map((i) => blockEnd(g, i, 3000).end)).toEqual([1500, 3000, 2000]);
    expect(blockEnd(group("a b", [1000, 1000]), 0, null).end).toBe(1000 + MIN_BLOCK_MS);
  });

  test("rows: lines on the first, labelled groups below, a row more only where they overlap", () => {
    const d = doc(
      group("one two", [1000, 1500], [null, 2000]),
      group("ooh", [1200], [1700], ["backing"]),
      group("yeah", [1300], [1800], ["adlib"]),
      group("three", [2100], [2500]),
    );
    const rows = timelineRows(d, { startMs: 0, spanMs: 4000 }, 60000);
    expect(rows.lineRows).toBe(1);
    expect(rows.labelledRows).toBe(2);
    expect(rows.bands.map((b) => [b.group, b.row])).toEqual([
      [0, 0],
      [3, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  test("flag notes", () => {
    const d = doc(group("Shine, shine", [41460, 42100]));
    const flag: Flag = { id: "x", kind: "starts-in-silence", lineIndex: 0, wordIndex: 1, message: "", suggestMs: 42180 };
    expect(flagNote(d, flag)).toBe("80 ms before voice");
    expect(flagNote(d, { ...flag, kind: "words-out-of-order" })).toBe("out of order");
  });
});

describe("nudging", () => {
  const d = doc(group("a b", [1000, 1500], [null, 1800]), group("c d", [3000]));

  test("a word's start moves on its own; the group start drags its words along", () => {
    expect(startsOf(nudgeTarget(d, { line: 0, word: 1 }, 10, 60000).groups[0])).toEqual([1000, 1510]);
    const moved = nudgeTarget(d, { line: 0, word: null }, 100, 60000).groups[0]!;
    expect(startsOf(moved)).toEqual([1100, 1600]);
    expect(endsOf(moved)).toEqual([null, 1900]);
  });

  test("an end moves from where its block ends, and never before the start", () => {
    expect(targetEnd(d, { line: 0, word: 0 }, 60000)).toEqual({ end: 1500, derived: true });
    expect(endsOf(nudgeEnd(d, { line: 0, word: 0 }, -100, 60000).groups[0])).toEqual([1400, 1800]);
    expect(endsOf(moveEnd(d, { line: 0, word: 1 }, 1000, 60000).groups[0])).toEqual([null, 1520]);
    expect(nudgeEnd(d, { line: 0, word: null }, 10, 60000)).toBe(d);
  });

  test("clamps to the song and leaves untimed targets alone", () => {
    expect(startsOf(moveTarget(d, { line: 0, word: 0 }, -500, 60000).groups[0])[0]).toBe(0);
    expect(startsOf(moveTarget(d, { line: 1, word: null }, 99999, 60000).groups[1])[0]).toBe(60000);
    const untimed = doc(group("x"));
    expect(nudgeTarget(untimed, { line: 0, word: null }, 10, 60000)).toBe(untimed);
    expect(startsOf(moveTarget(untimed, { line: 0, word: null }, 4200, 60000).groups[0])).toEqual([4200]);
    expect(targetStart(d, { line: 1, word: 1 })).toBeNull();
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

describe("retap", () => {
  const d = doc(group("a b c", [1000, 1500, 2000]));

  test("a tap starts a word, then the next is up; no word gets an end", () => {
    let r = beginRetap(d, 0, null, 1)!;
    expect(currentWord(r)).toBe(0);
    r = tapAt(r, 1100.4);
    expect(r.tapped).toBe(1100);
    r = tapAt(r, 1600);
    expect(currentWord(r)).toBe(2);
    expect(startsOf(r.doc.groups[0])).toEqual([1100, 1600, 2000]);
    expect(endsOf(r.doc.groups[0])).toEqual([null, null, null]);
    expect(r.done).toBe(2);
    r = tapAt(r, 2100);
    expect(retapDone(r)).toBe(true);
    expect(tapAt(r, 2500)).toBe(r);
    expect(d.groups[0]!.words[0]!.start).toBe(1000);
  });

  test("an end set on purpose stays, unless the new start passes it", () => {
    const ended = doc(group("a b", [1000, 1500], [1300, 1900]));
    const r = tapAt(tapAt(beginRetap(ended, 0, null, 1)!, 1050), 1950);
    expect(startsOf(r.doc.groups[0])).toEqual([1050, 1950]);
    expect(endsOf(r.doc.groups[0])).toEqual([1300, null]);
  });

  test("from a picked word; back one word; playback starts a little before it", () => {
    let r = beginRetap(d, 0, 1, 0.75)!;
    expect(r.order).toEqual([1, 2]);
    expect(preRollFor(r, 0)).toBe(0);
    r = tapAt(r, 1500);
    r = stepBack(r);
    expect(currentWord(r)).toBe(1);
    expect(r.tapped).toBeNull();
    expect(preRollFor(beginRetap(doc(group("x y", [5000])), 0, null, 1)!, 0)).toBe(3500);
    expect(beginRetap(doc({ id: "", labels: [], words: [] }), 0, null, 1)).toBeNull();
  });
});

describe("what gets saved", () => {
  const d = doc(group("one two three", [1000, 1500, 2700], [null, null, 3000]), group("ooh", [2000], [2400], ["backing"]));

  test("the group as the lyrics file has it", () => {
    const json = groupJson(d, 1);
    expect(JSON.parse(json)).toEqual({ id: d.groups[1]!.id, labels: ["backing"], words: [{ id: d.groups[1]!.words[0]!.id, text: "ooh", start: 2000, end: 2400 }] });
    expect(json).toContain('{ "id": "w4", "text": "ooh", "start": 2000, "end": 2400 }');
  });

  test("a labelled group's line is the line it goes into", () => {
    const line = exportedLine(d, 1)!;
    expect(line.line).toBe(0);
    expect(line.plain).toBe("[00:01.00] one two (ooh) three");
    expect(line.enhanced).toBe("[00:01.00]<00:01.00>one <00:01.50>two <00:02.00>(ooh) <00:02.40> <00:02.70>three<00:03.00>");
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
