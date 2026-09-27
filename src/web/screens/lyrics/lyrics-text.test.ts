import { describe, expect, test } from "bun:test";
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
    const { lines, timing } = parseLyricsText("First line\r\n\r\n  Second line  \n");
    expect(lines).toEqual([
      { timestamp: null, text: "First line" },
      { timestamp: null, text: "Second line" },
    ]);
    expect(timing).toBe("none");
  });

  test("LRC keeps line timings and empty gap lines, drops tags", () => {
    const { lines, timing } = parseLyricsText("[ar:X]\n[00:14.62] One\n[00:19.88]\n[00:20.00] Two");
    expect(lines).toEqual([
      { timestamp: 14620, text: "One" },
      { timestamp: 19880, text: "" },
      { timestamp: 20000, text: "Two" },
    ]);
    expect(timing).toBe("lines");
  });

  test("Enhanced LRC keeps word timings", () => {
    const { lines, timing } = parseLyricsText("[00:12.00]<00:12.00>Never <00:12.48>gonna<00:13.00>");
    expect(timing).toBe("words");
    expect(lines[0]!.words).toEqual([
      { start: 12000, text: "Never " },
      { start: 12480, text: "gonna" },
    ]);
  });

  test("a .lrc file without any time tags still goes through the LRC parser", () => {
    const { lines } = parseLyricsText("[ti:Song]\nOne\nTwo", { lrc: true });
    expect(lines.map((l) => l.text)).toEqual(["One", "Two"]);
  });
});

describe("stripTimings / counts", () => {
  const { lines } = parseLyricsText("[00:14.62] One\n[00:19.88]\n[00:20.00]<00:20.00>Two <00:20.50>words");

  test("stripTimings leaves text only", () => {
    expect(stripTimings(lines)).toEqual([
      { timestamp: null, text: "One" },
      { timestamp: null, text: "Two words" },
    ]);
    expect(timingOf(stripTimings(lines))).toBe("none");
  });

  test("lyricLineCount skips gap lines", () => {
    expect(lyricLineCount(lines)).toBe(2);
  });
});
