import { test, expect, describe } from "bun:test";
import { createDocument } from "./lrc-document";
import type { LrcDocument, LrcLine } from "./lrc-document";
import { findFlags } from "./flags";
import { voiceOnsetAfter as onsetIn } from "./voice-activity";

function docOf(...lines: LrcLine[]): LrcDocument {
  return { ...createDocument(), lines };
}

const shineLine: LrcLine = {
  timestamp: 48600,
  text: "Shine, shine over the street",
  words: [
    { start: 48600, text: "Shine, " },
    { start: 49240, text: "shine " },
    { start: 49120, text: "over " },
    { start: null, text: "the " },
    { start: 50300, text: "street" },
  ],
};

describe("findFlags", () => {
  test("nothing to flag in a tidy document", () => {
    expect(findFlags(docOf({ timestamp: 1000, text: "A" }, { timestamp: null, text: "B" }, { timestamp: 2000, text: "C" }))).toEqual([]);
  });

  test("a word that starts before the word in front of it", () => {
    expect(findFlags(docOf(shineLine))).toEqual([{
      id: "words-out-of-order:0:2:over",
      kind: "words-out-of-order",
      lineIndex: 0,
      wordIndex: 2,
      message: "“over” starts at 00:49.12 — before the “shine” in front of it (00:49.24).",
    }]);
  });

  test("untimed words are skipped when comparing", () => {
    const line: LrcLine = { ...shineLine, words: [{ start: 1000, text: "a " }, { start: null, text: "b " }, { start: 1200, text: "c" }], text: "a b c" };
    expect(findFlags(docOf(line))).toEqual([]);
  });

  test("a line that starts before the timed line above it", () => {
    const doc = docOf({ timestamp: 5000, text: "A" }, { timestamp: null, text: "B" }, { timestamp: 4000, text: "C" }, { timestamp: 6000, text: "D" });
    expect(findFlags(doc)).toEqual([{
      id: "lines-out-of-order:2:C",
      kind: "lines-out-of-order",
      lineIndex: 2,
      message: "The line starts at 00:04.00 — before line 1 above it (00:05.00).",
    }]);
  });

  test("ids stay the same when the flagged spot is re-timed", () => {
    const moved: LrcLine = { ...shineLine, words: shineLine.words!.map((w, i) => (i === 2 ? { ...w, start: 49000 } : w)) };
    expect(findFlags(docOf(moved))[0]!.id).toBe(findFlags(docOf(shineLine))[0]!.id);
  });

  test("dismissed flags are left out", () => {
    expect(findFlags(docOf(shineLine), { dismissed: new Set(["words-out-of-order:0:2:over"]) })).toEqual([]);
  });

  describe("starts in silence", () => {
    // Silence before 49300 and between 50000 and 50400, voice elsewhere.
    const voiceOnsetAfter = (ms: number) => {
      if (ms >= 49000 && ms < 49300) return 49300;
      if (ms >= 50000 && ms < 50400) return 50400;
      return null;
    };

    test("is only checked with a vocal stem", () => {
      expect(findFlags(docOf(shineLine)).map((f) => f.kind)).toEqual(["words-out-of-order"]);
    });

    test("flags early words with a suggested start, in document order", () => {
      const flags = findFlags(docOf(shineLine), { voiceOnsetAfter });
      // “shine” (49.24) is early too, but moving it to 49.30 would pass the “over” after it (49.12).
      expect(flags.map((f) => [f.kind, f.wordIndex, f.suggestMs])).toEqual([
        ["words-out-of-order", 2, undefined],
        ["starts-in-silence", 2, 49300],
        ["starts-in-silence", 4, 50400],
      ]);
      expect(flags[1]!.message).toBe("“over” starts 180 ms before the voice does. The tap may have been early.");
      expect(flags[1]!.id).toBe("starts-in-silence:0:2:over");
    });

    test("with a real envelope, a 30 ms gap is not flagged and an 80 ms gap is", () => {
      // 10 ms frames, silent until 1000 ms, then the voice.
      const envelope = new Float32Array(200).fill(0.6);
      envelope.fill(0, 0, 100);
      const line: LrcLine = { timestamp: 970, text: "Hi there", words: [{ start: 970, text: "Hi " }, { start: 1500, text: "there" }] };
      const bound = { voiceOnsetAfter: (ms: number) => onsetIn(envelope, 10, ms) };
      expect(findFlags(docOf(line), bound)).toEqual([]);
      const early = findFlags(docOf({ ...line, timestamp: 920, words: [{ start: 920, text: "Hi " }, { start: 1500, text: "there" }] }), bound);
      expect(early.map((f) => [f.kind, f.wordIndex, f.suggestMs])).toEqual([["starts-in-silence", 0, 1000]]);
      expect(early[0]!.message).toBe("“Hi” starts 80 ms before the voice does. The tap may have been early.");
    });

    test("no suggestion that would move a word to or past the next word", () => {
      // “Если” at 12.16, voice at 12.42, “б” already at 12.41.
      const line: LrcLine = { timestamp: 12160, text: "Если б", words: [{ start: 12160, text: "Если " }, { start: 12410, text: "б" }] };
      const onset = (ms: number) => (ms === 12160 ? 12420 : null);
      expect(findFlags(docOf(line), { voiceOnsetAfter: onset })).toEqual([]);
      const room: LrcLine = { ...line, words: [{ start: 12160, text: "Если " }, { start: 12500, text: "б" }] };
      expect(findFlags(docOf(room), { voiceOnsetAfter: onset }).map((f) => f.suggestMs)).toEqual([12420]);
    });

    test("the last word stays before the line end and the next line", () => {
      const onset = (ms: number) => (ms === 2000 ? 2300 : null);
      const words = [{ start: 1000, text: "Hi " }, { start: 2000, text: "there" }];
      expect(findFlags(docOf({ timestamp: 1000, text: "Hi there", words, end: 2200 }), { voiceOnsetAfter: onset })).toEqual([]);
      expect(findFlags(docOf({ timestamp: 1000, text: "Hi there", words }, { timestamp: 2300, text: "" }), { voiceOnsetAfter: onset })).toEqual([]);
      expect(findFlags(docOf({ timestamp: 1000, text: "Hi there", words }, { timestamp: 2400, text: "Next" }), { voiceOnsetAfter: onset })).toHaveLength(1);
    });

    test("no suggestion that would move a line to or past the next timed line", () => {
      const onset = (ms: number) => (ms === 1000 ? 1300 : null);
      const doc = (next: number) => docOf({ timestamp: 1000, text: "A" }, { timestamp: null, text: "B" }, { timestamp: next, text: "C" });
      expect(findFlags(doc(1300), { voiceOnsetAfter: onset })).toEqual([]);
      expect(findFlags(doc(1301), { voiceOnsetAfter: onset }).map((f) => f.suggestMs)).toEqual([1300]);
    });

    test("checks the line start of lines without word timings, but not empty lines", () => {
      const doc = docOf({ timestamp: 49100, text: "Hello" }, { timestamp: 50100, text: "" });
      expect(findFlags(doc, { voiceOnsetAfter })).toEqual([{
        id: "starts-in-silence:0:Hello",
        kind: "starts-in-silence",
        lineIndex: 0,
        message: "The line starts 200 ms before the voice does. The tap may have been early.",
        suggestMs: 49300,
      }]);
    });
  });
});
