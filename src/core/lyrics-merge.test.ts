import { test, expect, describe } from "bun:test";
import { createDocument, linesFromText } from "./lrc-document";
import type { LrcDocument, LrcLine } from "./lrc-document";
import { replaceLyrics, adoptWordTimings, applyAlignment } from "./lyrics-merge";

function docOf(...lines: LrcLine[]): LrcDocument {
  return { ...createDocument({ title: "Song" }), lines };
}

const wordTimed: LrcLine = {
  timestamp: 1000,
  text: "Never gonna give",
  words: [
    { start: 1000, text: "Never " },
    { start: 1500, text: "gonna " },
    { start: 2000, text: "give" },
  ],
  end: 2500,
};

describe("replaceLyrics", () => {
  test("keeps line and word timings for lines that still match, in order", () => {
    const doc = docOf(
      { timestamp: 500, text: "Intro" },
      wordTimed,
      { timestamp: 3000, text: "Old line" },
    );
    const { doc: next, kept } = replaceLyrics(doc, linesFromText("Intro\nNew line\nNever gonna give"));
    expect(kept).toBe(2);
    expect(next.metadata.title).toBe("Song");
    expect(next.lines).toEqual([
      { timestamp: 500, text: "Intro" },
      { timestamp: null, text: "New line" },
      wordTimed,
    ]);
  });

  test("compares trimmed text and takes the new text", () => {
    const { doc, kept } = replaceLyrics(docOf({ timestamp: 500, text: " Hello " }), [{ timestamp: null, text: "Hello" }]);
    expect(kept).toBe(1);
    expect(doc.lines[0]).toEqual({ timestamp: 500, text: "Hello" });
  });

  test("matches only forward: a repeated line takes the next occurrence", () => {
    const doc = docOf({ timestamp: 1000, text: "La" }, { timestamp: 2000, text: "Mid" }, { timestamp: 3000, text: "La" });
    const { doc: next } = replaceLyrics(doc, linesFromText("La\nLa\nMid"));
    expect(next.lines.map((l) => l.timestamp)).toEqual([1000, 3000, null]);
  });

  test("untimed old lines keep nothing and are not counted; new timings stay", () => {
    const { doc, kept } = replaceLyrics(docOf({ timestamp: null, text: "Hello" }), [{ timestamp: 4000, text: "Hello" }]);
    expect(kept).toBe(0);
    expect(doc.lines[0]).toEqual({ timestamp: 4000, text: "Hello" });
  });

  test("old timings win over the new lines' own", () => {
    const { doc } = replaceLyrics(docOf({ timestamp: 1000, text: "Hello" }), [{ timestamp: 4000, text: "Hello" }]);
    expect(doc.lines[0]!.timestamp).toBe(1000);
  });

  test("matches despite case and punctuation, keeping word timings when the parts still line up", () => {
    const old: LrcLine = {
      timestamp: 1000,
      text: "Я не могу иначе",
      words: [{ start: 1000, text: "Я " }, { start: 1200, text: "не " }, { start: 1400, text: "могу " }, { start: 1800, text: "иначе" }],
      end: 2500,
    };
    const { doc, kept } = replaceLyrics(docOf(old), [{ timestamp: null, text: "я не могу иначе," }]);
    expect(kept).toBe(1);
    expect(doc.lines[0]).toEqual({
      timestamp: 1000,
      text: "я не могу иначе,",
      words: [{ start: 1000, text: "я " }, { start: 1200, text: "не " }, { start: 1400, text: "могу " }, { start: 1800, text: "иначе," }],
      end: 2500,
    });
  });

  test("keeps joined words when the text changes but the parts line up", () => {
    const joined: LrcLine = { ...wordTimed, words: [{ start: 1000, text: "Never gonna " }, { start: 2000, text: "give" }] };
    const { doc } = replaceLyrics(docOf(joined), [{ timestamp: null, text: "Never, gonna give!" }]);
    expect(doc.lines[0]!.words).toEqual([{ start: 1000, text: "Never, gonna " }, { start: 2000, text: "give!" }]);
  });

  test("keeps only the line start when the number of parts differs", () => {
    const { doc, kept } = replaceLyrics(docOf(wordTimed), [{ timestamp: null, text: "Never-gonna give" }]);
    expect(kept).toBe(1);
    expect(doc.lines[0]).toEqual({ timestamp: 1000, text: "Never-gonna give" });
  });

  test("a line timing survives a punctuation change", () => {
    const { doc, kept } = replaceLyrics(docOf({ timestamp: 500, text: "Don't stop" }), [{ timestamp: null, text: "don’t stop..." }]);
    expect(kept).toBe(1);
    expect(doc.lines[0]).toEqual({ timestamp: 500, text: "don’t stop..." });
  });

  test("empty lines never match", () => {
    const doc = docOf({ timestamp: 1000, text: "" }, { timestamp: 2000, text: "A" });
    const { doc: next, kept } = replaceLyrics(doc, [{ timestamp: null, text: "" }, { timestamp: null, text: "A" }]);
    expect(kept).toBe(1);
    expect(next.lines.map((l) => l.timestamp)).toEqual([null, 2000]);
  });
});

describe("adoptWordTimings", () => {
  const source: LrcLine[] = [
    { timestamp: 900, text: "never gonna give", words: [{ start: 900, text: "never " }, { start: 1400, text: "gonna " }, { start: 1900, text: "give" }], end: 2400 },
    { timestamp: 3000, text: "dont stop", words: [{ start: 3000, text: "dont " }, { start: 3400, text: "stop" }], end: 3900 },
  ];

  test("copies word timings, line start and end, keeping the document's text", () => {
    const doc = docOf({ timestamp: 1000, text: "Never gonna give!" }, { timestamp: null, text: "Don’t stop" });
    const { doc: next, adopted } = adoptWordTimings(doc, source);
    expect(adopted).toBe(2);
    expect(next.lines[0]).toEqual({
      timestamp: 900,
      text: "Never gonna give!",
      words: [{ start: 900, text: "Never " }, { start: 1400, text: "gonna " }, { start: 1900, text: "give!" }],
      end: 2400,
    });
    expect(next.lines[1]!.text).toBe("Don’t stop");
    expect(next.lines[1]!.words).toEqual([{ start: 3000, text: "Don’t " }, { start: 3400, text: "stop" }]);
  });

  test("takes the source words as they are when the text is identical", () => {
    const joined: LrcLine = { timestamp: 900, text: "Hi there you", words: [{ start: 900, text: "Hi there " }, { start: 1500, text: "you" }] };
    const { doc } = adoptWordTimings(docOf({ timestamp: null, text: "Hi there you" }), [joined]);
    expect(doc.lines[0]!.words).toEqual(joined.words);
  });

  test("keeps the document's joined words", () => {
    const line: LrcLine = { timestamp: 1000, text: "Never, gonna give", words: [{ start: 1000, text: "Never, gonna " }, { start: 2000, text: "give" }] };
    const { doc } = adoptWordTimings(docOf(line), source);
    expect(doc.lines[0]!.words).toEqual([{ start: 900, text: "Never, gonna " }, { start: 1900, text: "give" }]);
  });

  test("ignores case, quotes and punctuation in Russian too", () => {
    const ru: LrcLine = { timestamp: 500, text: "ещё раз", words: [{ start: 500, text: "ещё " }, { start: 900, text: "раз" }] };
    const { doc, adopted } = adoptWordTimings(docOf({ timestamp: null, text: "«Еще — раз!»" }), [ru]);
    expect(adopted).toBe(1);
    expect(doc.lines[0]!.words).toEqual([{ start: 500, text: "«Еще " }, { start: null, text: "— " }, { start: 900, text: "раз!»" }]);
  });

  test("skips lines whose words don't line up, and lines without word timings", () => {
    const doc = docOf({ timestamp: 1000, text: "Never-gonna give" }, { timestamp: 2000, text: "dont stop" });
    const lineOnly: LrcLine[] = [source[0]!, { timestamp: 3000, text: "dont stop" }];
    const { doc: next, adopted } = adoptWordTimings(doc, lineOnly);
    expect(adopted).toBe(0);
    expect(next.lines).toEqual(doc.lines);
  });

  test("matches in order and leaves unmatched lines alone", () => {
    const doc = docOf({ timestamp: 100, text: "Intro" }, { timestamp: null, text: "dont stop" }, { timestamp: null, text: "never gonna give" });
    const { doc: next, adopted } = adoptWordTimings(doc, source);
    expect(adopted).toBe(1);
    expect(next.lines[0]).toEqual({ timestamp: 100, text: "Intro" });
    expect(next.lines[1]!.timestamp).toBe(3000);
    expect(next.lines[2]).toEqual({ timestamp: null, text: "never gonna give" });
  });
});

describe("applyAlignment", () => {
  test("takes line starts and word timings, keeping the document's text and leaving unmatched lines alone", () => {
    const doc = docOf(
      { timestamp: 100, text: "Never gonna give" },
      { timestamp: null, text: "" },
      { timestamp: null, text: "[Chorus]" },
      wordTimed,
      { timestamp: 7000, text: "Edited while syncing" },
    );
    const source: LrcLine[] = [
      { timestamp: 900, text: "Never gonna give", words: [{ start: 900, text: "Never " }, { start: 1400, text: "gonna " }, { start: 1900, text: "give" }], end: 2400 },
      { timestamp: null, text: "[Chorus]" },
      { timestamp: 3000, text: "Never gonna give" },
      { timestamp: 5000, text: "Original line" },
    ];
    const { doc: next, synced } = applyAlignment(doc, source);
    expect(synced).toBe(2);
    expect(next.lines[0]).toEqual(source[0]!);
    expect(next.lines[1]).toEqual({ timestamp: null, text: "" });
    expect(next.lines[2]).toEqual({ timestamp: null, text: "[Chorus]" });
    // Only the start was found: the old word timings would no longer fit.
    expect(next.lines[3]).toEqual({ timestamp: 3000, text: "Never gonna give" });
    expect(next.lines[4]).toEqual({ timestamp: 7000, text: "Edited while syncing" });
  });
});
