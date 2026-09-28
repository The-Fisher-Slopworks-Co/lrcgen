import { describe, expect, test } from "bun:test";
import { groupText } from "../../../core/lyrics";
import { endsOf, startsOf } from "../../../core/testing";
import { looksLikeLrc, lyricLineCount, parseLyricsText, stripTimings, timingOf } from "./lyrics-text";

describe("looksLikeLrc", () => {
  test("a time tag at the start of any line", () => {
    expect(looksLikeLrc("[ar:Someone]\n[00:14.62] Lanterns on Linden")).toBe(true);
    expect(looksLikeLrc("  [01:02.5]x")).toBe(true);
  });

  test("plain text, brackets elsewhere, metadata only", () => {
    expect(looksLikeLrc("Lanterns on Linden\n(come on)")).toBe(false);
    expect(looksLikeLrc("Chorus [00:14.62]")).toBe(false);
    expect(looksLikeLrc("[ar:Someone]\n[ti:Song]")).toBe(false);
  });
});

describe("parseLyricsText", () => {
  test("plain text splits at line breaks and drops blank lines", () => {
    const { groups, timing } = parseLyricsText("First line\r\n\r\n  Second line  \n");
    expect(groups.map(groupText)).toEqual(["First line", "Second line"]);
    expect(timing).toBe("none");
  });

  test("LRC keeps line timings; an empty gap line ends the line before it; tags go", () => {
    const { groups, timing } = parseLyricsText("[ar:X]\n[00:14.62] One\n[00:19.88]\n[00:20.00] Two");
    expect(groups.map(groupText)).toEqual(["One", "Two"]);
    expect(startsOf(groups[0])).toEqual([14620]);
    expect(endsOf(groups[0])).toEqual([19880]);
    expect(timing).toBe("words");
  });

  test("Enhanced LRC keeps word timings", () => {
    const { groups, timing } = parseLyricsText("[00:12.00]<00:12.00>Never <00:12.48>gonna<00:13.00>");
    expect(timing).toBe("words");
    expect(startsOf(groups[0])).toEqual([12000, 12480]);
    expect(endsOf(groups[0])).toEqual([null, 13000]);
  });

  test("a .lrc file without any time tags still goes through the LRC parser", () => {
    const { groups } = parseLyricsText("[ti:Song]\nOne\nTwo", { lrc: true });
    expect(groups.map(groupText)).toEqual(["One", "Two"]);
  });

  test("lrcgen's lyrics file keeps its groups and labels", () => {
    const file = JSON.stringify({
      format: "lrcgen-lyrics",
      version: 1,
      metadata: {},
      groups: [
        { id: "g1", labels: [], words: [{ id: "w1", text: "One", start: 1000, end: 1500 }] },
        { id: "g2", labels: ["adlib"], words: [{ id: "w2", text: "yeah", start: 1200, end: null }] },
      ],
    });
    const { groups, timing } = parseLyricsText(file, { name: "Song.lyrics.json" });
    expect(timing).toBe("words");
    expect(groups.map((g) => g.labels)).toEqual([[], ["adlib"]]);
    expect(parseLyricsText("{", { name: "Song.lyrics.json" }).groups).toEqual([]);
  });
});

describe("stripTimings / counts", () => {
  const { groups } = parseLyricsText("[00:14.62] One\n[00:19.88]\n[00:20.00]<00:20.00>Two <00:20.50>words");

  test("stripTimings leaves text only", () => {
    const stripped = stripTimings(groups);
    expect(stripped.map(groupText)).toEqual(["One", "Two words"]);
    expect(timingOf(stripped)).toBe("none");
  });

  test("lyricLineCount counts groups with words", () => {
    expect(lyricLineCount(groups)).toBe(2);
  });
});
