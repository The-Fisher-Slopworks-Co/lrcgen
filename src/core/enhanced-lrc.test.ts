import { describe, expect, test } from "bun:test";
import { enhancedLrcPath, isEnhancedLrcPath, mergeWordTimings, plainLrcPath } from "./enhanced-lrc";
import { groupText } from "./lyrics";
import { docOf, startsOf } from "./testing";

const timed = { timestamp: 1000, text: "Never gonna give", words: [{ start: 1000, text: "Never " }, { start: 1500, text: "gonna " }, { start: 2000, text: "give" }], end: 2500 };

describe("enhanced file paths", () => {
  test("maps between plain and enhanced names", () => {
    expect(enhancedLrcPath("/music/song.lrc")).toBe("/music/song.enhanced.lrc");
    expect(enhancedLrcPath("/music/song.enhanced.lrc")).toBe("/music/song.enhanced.lrc");
    expect(enhancedLrcPath("/music/v1.0/song")).toBe("/music/v1.0/song.enhanced.lrc");
    expect(enhancedLrcPath("/music/.lrc")).toBe("/music/.lrc.enhanced.lrc");
    expect(enhancedLrcPath("song.flac.lrc")).toBe("song.flac.enhanced.lrc");
    expect(plainLrcPath("/music/song.enhanced.lrc")).toBe("/music/song.lrc");
    expect(plainLrcPath("/music/song.lrc")).toBe("/music/song.lrc");
    expect(isEnhancedLrcPath("song.enhanced.lrc")).toBe(true);
    expect(isEnhancedLrcPath("song.lrc")).toBe(false);
  });
});

describe("mergeWordTimings", () => {
  test("attaches word timings to lines with the same text, in order", () => {
    const merged = mergeWordTimings(docOf({ timestamp: 500, text: "Intro" }, { timestamp: 1000, text: "Never gonna give" }), docOf(timed));
    expect(startsOf(merged.groups[0])).toEqual([500]);
    expect(startsOf(merged.groups[1])).toEqual([1000, 1500, 2000]);
    expect(merged.groups[1]!.words[2]!.end).toBe(2500);
    const ids = merged.groups.flatMap((g) => g.words.map((w) => w.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("edited lines lose word timings and re-timed lines drag them along", () => {
    const base = docOf({ timestamp: 1100, text: "Never gonna give" }, { timestamp: 3000, text: "Changed line" });
    const enhanced = docOf(timed, { timestamp: 3000, text: "Old line", words: [{ start: 3000, text: "Old " }, { start: 3300, text: "line" }] });
    const merged = mergeWordTimings(base, enhanced);
    expect(startsOf(merged.groups[0])).toEqual([1100, 1600, 2100]);
    expect(groupText(merged.groups[1]!)).toBe("Changed line");
    expect(startsOf(merged.groups[1])).toEqual([3000, null]);
  });
});
