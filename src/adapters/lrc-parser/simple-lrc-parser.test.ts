import { describe, expect, test } from "bun:test";
import { groupEnd, groupText, type LyricsDoc } from "../../core/lyrics";
import { doc as docOfGroups, group, startsOf } from "../../core/testing";
import { SimpleLrcParser } from "./simple-lrc-parser";

const parser = new SimpleLrcParser();
const texts = (doc: LyricsDoc) => doc.groups.map(groupText);
const firstStarts = (doc: LyricsDoc) => doc.groups.map((g) => startsOf(g)[0] ?? null);

describe("SimpleLrcParser.parse", () => {
  test("parses lines with timestamps: the line start is the first word's", () => {
    const doc = parser.parse("[00:12.30]First line\n[00:15.80]Second line");
    expect(texts(doc)).toEqual(["First line", "Second line"]);
    expect(firstStarts(doc)).toEqual([12300, 15800]);
    expect(startsOf(doc.groups[0])).toEqual([12300, null]);
  });
  test("parses metadata tags", () => {
    const doc = parser.parse("[ar:Radiohead]\n[ti:Creep]\n[al:Pablo Honey]\n[00:12.30]Line");
    expect(doc.metadata.artist).toBe("Radiohead");
    expect(doc.metadata.title).toBe("Creep");
    expect(doc.metadata.album).toBe("Pablo Honey");
  });
  test("the tool tag is always lrcgen's", () => {
    expect(parser.parse("[tool:SomeTool]\n[00:01.00]Line").metadata.tool).toBe("https://github.com/txssu/lrcgen");
  });
  test("parses lines without timestamps", () => {
    const doc = parser.parse("Just plain text\nAnother line");
    expect(texts(doc)).toEqual(["Just plain text", "Another line"]);
    expect(firstStarts(doc)).toEqual([null, null]);
  });
  test("handles empty input", () => {
    const doc = parser.parse("");
    expect(doc.groups).toEqual([]);
    expect(doc.metadata.tool).toBe("https://github.com/txssu/lrcgen");
  });
  test("an empty timed line ends the line before it", () => {
    const doc = parser.parse("[00:01.00]Line one\n[00:03.00]\n\n[00:05.00]Line two");
    expect(texts(doc)).toEqual(["Line one", "Line two"]);
    expect(groupEnd(doc.groups[0]!)).toBe(3000);
  });
  test("a line all in parentheses is a backing vocal", () => {
    const doc = parser.parse("[00:01.00]Line\n[00:02.00](one by one)");
    expect(doc.groups[1]!.labels).toEqual(["backing"]);
    expect(groupText(doc.groups[1]!)).toBe("one by one");
  });
  test("trims whitespace from line text", () => {
    expect(texts(parser.parse("[00:01.00]  Song text  \n[00:05.00]   Another  "))).toEqual(["Song text", "Another"]);
  });
});

describe("SimpleLrcParser.serialize", () => {
  test("serializes document with metadata and lines", () => {
    const output = parser.serialize(parser.parse("[ar:Muse]\n[ti:Uprising]\n[00:01.00]Hello\n[00:05.00]World"));
    expect(output).toContain("[ar:Muse]");
    expect(output).toContain("[ti:Uprising]");
    expect(output).toContain("[tool:https://github.com/txssu/lrcgen]");
    expect(output).toContain("[00:01.00] Hello");
    expect(output).toContain("[00:05.00] World");
  });
  test("omits timestamp for unsynced lines", () => {
    const output = parser.serialize(parser.parse("Plain text line"));
    expect(output).toContain("Plain text line");
    expect(output).not.toContain("[00:");
  });
  test("labelled groups go into their line in parentheses", () => {
    const doc = { ...docOfGroups(group("one two three", [1000, 1500, 2500]), group("ooh", [2000], [2400], ["backing"])), metadata: { tool: "t" } };
    expect(parser.serialize(doc)).toContain("[00:01.00] one two (ooh) three");
  });
  test("round-trips", () => {
    const doc = parser.parse("[ar:Radiohead]\n[ti:Creep]\n[00:12.30]First\n[00:15.80]Second");
    const again = parser.parse(parser.serialize(doc));
    expect(again.metadata.artist).toBe("Radiohead");
    expect(again.groups).toEqual(doc.groups);
  });
});
