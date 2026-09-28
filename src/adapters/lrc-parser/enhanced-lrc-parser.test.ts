import { test, expect, describe } from "bun:test";
import { EnhancedLrcParser } from "./enhanced-lrc-parser";
import { SimpleLrcParser } from "./simple-lrc-parser";
import { groupText, type LyricsDoc } from "../../core/lyrics";
import { doc as docOfGroups, endsOf, group, startsOf, textsOf } from "../../core/testing";
import { parseWordTags } from "./word-tags";

const enhanced = new EnhancedLrcParser();
const simple = new SimpleLrcParser();

describe("parseWordTags", () => {
  test("returns plain text when there are no tags", () => {
    expect(parseWordTags("  Just words  ")).toEqual({ text: "Just words" });
  });

  test("splits compact tags into words and a trailing end", () => {
    expect(parseWordTags("<00:12.00>Never <00:12.48>gonna <00:12.90>give<00:14.20>")).toEqual({
      text: "Never gonna give",
      words: [
        { start: 12000, text: "Never " },
        { start: 12480, text: "gonna " },
        { start: 12900, text: "give" },
      ],
      end: 14200,
    });
  });

  test("reads the spaced A2 style", () => {
    expect(parseWordTags(" <00:01.00> Hello <00:01.50> world <00:02.00>")).toEqual({
      text: "Hello world",
      words: [
        { start: 1000, text: "Hello " },
        { start: 1500, text: "world" },
      ],
      end: 2000,
    });
  });

  test("keeps syllables of one word together", () => {
    expect(parseWordTags("<00:01.00>Hel<00:01.20>lo <00:01.50>you")).toEqual({
      text: "Hello you",
      words: [
        { start: 1000, text: "Hel" },
        { start: 1200, text: "lo " },
        { start: 1500, text: "you" },
      ],
    });
  });

  test("reads millisecond precision", () => {
    expect(parseWordTags("<00:01.234>Hi")).toEqual({ text: "Hi", words: [{ start: 1234, text: "Hi" }] });
  });

  test("a tag before nothing but a space is a pause: the word before it ends there", () => {
    expect(parseWordTags("<00:01.00>Hi <00:01.30> <00:01.50>there<00:02.00>")).toEqual({
      text: "Hi there",
      words: [
        { start: 1000, end: 1300, text: "Hi " },
        { start: 1500, text: "there" },
      ],
      end: 2000,
    });
  });

  test("keeps untagged leading text as an unsynced word", () => {
    expect(parseWordTags("Oh <00:02.00>yeah")).toEqual({
      text: "Oh yeah",
      words: [
        { start: null, text: "Oh " },
        { start: 2000, text: "yeah" },
      ],
    });
  });
});

const withMeta = (d: LyricsDoc): LyricsDoc => ({ ...d, metadata: { tool: "t" } });

describe("EnhancedLrcParser", () => {
  const input = [
    "[ar:Rick Astley]",
    "[00:12.00]<00:12.00>Never <00:12.48>gonna <00:12.90>give<00:14.20>",
    "[00:15.00] Plain line",
  ].join("\n");

  test("round-trips word timings", () => {
    const doc = enhanced.parse(input);
    expect(startsOf(doc.groups[0])).toEqual([12000, 12480, 12900]);
    expect(endsOf(doc.groups[0])).toEqual([null, null, 14200]);
    const again = enhanced.parse(enhanced.serialize(doc));
    expect(again.groups).toEqual(doc.groups);
    expect(enhanced.serialize(doc)).toContain("[00:12.00]<00:12.00>Never <00:12.48>gonna <00:12.90>give<00:14.20>");
    expect(enhanced.serialize(doc)).toContain("[00:15.00] Plain line");
  });

  test("round-trips joined words: one tag, several parts", () => {
    const line = "[00:01.00]<00:01.00>And all <00:01.60>through <00:02.00>the night<00:03.00>";
    const doc = enhanced.parse(line);
    expect(textsOf(doc.groups[0])).toEqual(["And all", "through", "the night"]);
    expect(enhanced.serialize(doc)).toContain(line);
  });

  test("round-trips word ends as pauses", () => {
    const line = "[00:01.00]<00:01.00>Hi <00:01.30> <00:01.50>there<00:02.00>";
    const doc = enhanced.parse(line);
    expect(endsOf(doc.groups[0])).toEqual([1300, 2000]);
    expect(enhanced.serialize(doc)).toContain(line);
  });

  test("an untimed word after a split rides along with the word before and reads back joined", () => {
    const output = enhanced.serialize(withMeta(docOfGroups(group("And all through", [1000, null, 1600], [null, null, 2000]))));
    expect(output).toContain("[00:01.00]<00:01.00>And all <00:01.60>through<00:02.00>");
    expect(textsOf(enhanced.parse(output).groups[0])).toEqual(["And all", "through"]);
  });

  test("untimed words before the first timed one read back with the line start", () => {
    const output = enhanced.serialize(withMeta(docOfGroups(group("Oh yeah", [null, 2000]))));
    expect(output).toContain("[00:02.00]Oh <00:02.00>yeah");
    expect(startsOf(enhanced.parse(output).groups[0])).toEqual([2000, 2000]);
  });

  test("a line with only its start is written plain", () => {
    const output = enhanced.serialize(withMeta(docOfGroups(group("Oh yeah", [1000]))));
    expect(output).toContain("[00:01.00] Oh yeah");
    expect(startsOf(enhanced.parse(output).groups[0])).toEqual([1000, null]);
  });

  test("the plain parser reads the tags but writes plain LRC", () => {
    const doc = simple.parse(input);
    expect(groupText(doc.groups[0]!)).toBe("Never gonna give");
    expect(startsOf(doc.groups[0])).toEqual([12000, 12480, 12900]);
    const output = simple.serialize(doc);
    expect(output).toContain("[00:12.00] Never gonna give");
    expect(output).not.toContain("<");
  });
});
