import { describe, expect, test } from "bun:test";
import { exportLines, formatEnhancedLine, formatPlainLine, lineText } from "./lrc-export";
import { doc, group } from "./testing";

describe("exportLines", () => {
  test("labelled groups go into their line in parentheses, where they fall in time", () => {
    const d = doc(
      group("Ду-думал о_разном, ду-думал о_многом", [6380, 6820, 7940, 8320], [null, 7380, null, 8870]),
      group("думал о_разном", [7380, 7560], [null, 7940], ["backing"]),
      group("Эй, а", [8870, 9160], [null, 9380], ["adlib"]),
      group("С тобою", [9340, 9810]),
    );
    const lines = exportLines(d);
    expect(lines.map((l) => l.group)).toEqual([0, 3]);
    expect(lineText(lines[0]!)).toBe("Ду-думал о разном, (думал о разном) ду-думал о многом (Эй, а)");
    expect(lines[0]!.start).toBe(6380);
    expect(lines[0]!.end).toBe(9380);
  });

  test("a labelled group with no line to go into gets its own, in parentheses", () => {
    const d = doc(group("one two", [1000, 1500], [null, 1800]), group("one by one", [5000], [], ["backing"]), group("(oh)", [], [], ["adlib"]));
    expect(exportLines(d).map(lineText)).toEqual(["one two", "(one by one)", "((oh))"]);
  });

  test("empty groups are left out", () => {
    expect(exportLines(doc(group("a", [1000]), { id: "", labels: [], words: [] }))).toHaveLength(1);
  });
});

describe("plain LRC", () => {
  test("the line start and the text; untimed lines are just text", () => {
    const [timed, untimed] = exportLines(doc(group("Hello world", [1234]), group("Later")));
    expect(formatPlainLine(timed!)).toBe("[00:01.23] Hello world");
    expect(formatPlainLine(untimed!)).toBe("Later");
  });
});

describe("Enhanced LRC", () => {
  test("a tag per word and the end at the end", () => {
    const [line] = exportLines(doc(group("Never gonna give", [12000, 12480, 12900], [null, null, 14200])));
    expect(formatEnhancedLine(line!)).toBe("[00:12.00]<00:12.00>Never <00:12.48>gonna <00:12.90>give<00:14.20>");
  });

  test("a pause gets its own tag", () => {
    const [line] = exportLines(doc(group("Never gonna give", [12000, 12480, 12900], [12300, 12880, null])));
    expect(formatEnhancedLine(line!)).toBe("[00:12.00]<00:12.00>Never <00:12.30> <00:12.48>gonna <00:12.90>give");
  });

  test("syllables have no space between them; an untimed word rides along", () => {
    const syllables = doc({
      id: "",
      labels: [],
      words: [
        { id: "", text: "beau", start: 1000, end: null, noSpaceAfter: true },
        { id: "", text: "tiful", start: 1200, end: null },
        { id: "", text: "day", start: null, end: null },
      ],
    });
    expect(formatEnhancedLine(exportLines(syllables)[0]!)).toBe("[00:01.00]<00:01.00>beau<00:01.20>tiful day");
  });

  test("lines with only a start stay plain", () => {
    expect(formatEnhancedLine(exportLines(doc(group("Hi there", [1000])))[0]!)).toBe("[00:01.00] Hi there");
  });
});
