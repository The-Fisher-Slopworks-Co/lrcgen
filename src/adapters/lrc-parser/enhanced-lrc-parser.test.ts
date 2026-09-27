import { test, expect, describe } from "bun:test";
import { EnhancedLrcParser } from "./enhanced-lrc-parser";
import { SimpleLrcParser } from "./simple-lrc-parser";
import { parseWordTags, formatWordTags } from "./word-tags";

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

describe("formatWordTags", () => {
  test("writes plain text for lines without word timings", () => {
    expect(formatWordTags({ timestamp: 1000, text: " Hello " })).toBe("Hello");
  });

  test("skips the end when it is not after the last word", () => {
    const line = { timestamp: 1000, text: "Hi there", words: [{ start: 1000, text: "Hi " }, { start: 1500, text: "there" }], end: 1200 };
    expect(formatWordTags(line)).toBe("<00:01.00>Hi <00:01.50>there");
  });

  test("merges unsynced words into the word before", () => {
    const line = { timestamp: 1000, text: "Hi there", words: [{ start: 1000, text: "Hi " }, { start: null, text: "there" }] };
    expect(formatWordTags(line)).toBe("<00:01.00>Hi there");
  });
});

describe("EnhancedLrcParser", () => {
  const input = [
    "[ar:Rick Astley]",
    "[00:12.00]<00:12.00>Never <00:12.48>gonna <00:12.90>give<00:14.20>",
    "[00:15.00] Plain line",
  ].join("\n");

  test("round-trips word timings", () => {
    const doc = enhanced.parse(input);
    const again = enhanced.parse(enhanced.serialize(doc));
    expect(again.lines).toEqual(doc.lines);
    expect(enhanced.serialize(doc)).toContain("[00:12.00]<00:12.00>Never <00:12.48>gonna <00:12.90>give<00:14.20>");
    expect(enhanced.serialize(doc)).toContain("[00:15.00] Plain line");
  });

  test("round-trips joined words: one tag, several parts", () => {
    const line = "[00:01.00]<00:01.00>And all <00:01.60>through <00:02.00>the night<00:03.00>";
    const doc = enhanced.parse(line);
    expect(doc.lines[0]!.words).toEqual([
      { start: 1000, text: "And all " },
      { start: 1600, text: "through " },
      { start: 2000, text: "the night" },
    ]);
    expect(enhanced.serialize(doc)).toContain(line);
  });

  test("an untimed word after a split rides along with the word before and reads back joined", () => {
    const split = {
      timestamp: 1000,
      text: "And all through",
      words: [{ start: 1000, text: "And " }, { start: null, text: "all " }, { start: 1600, text: "through" }],
      end: 2000,
    };
    const output = enhanced.serialize({ ...enhanced.parse(""), lines: [split] });
    expect(output).toContain("[00:01.00]<00:01.00>And all <00:01.60>through<00:02.00>");
    expect(enhanced.parse(output).lines[0]).toEqual({
      timestamp: 1000,
      text: "And all through",
      words: [{ start: 1000, text: "And all " }, { start: 1600, text: "through" }],
      end: 2000,
    });
  });

  test("untimed words before the first timed one stay untimed", () => {
    const line = { timestamp: 1000, text: "Oh yeah", words: [{ start: null, text: "Oh " }, { start: 2000, text: "yeah" }] };
    const output = enhanced.serialize({ ...enhanced.parse(""), lines: [line] });
    expect(output).toContain("[00:01.00]Oh <00:02.00>yeah");
    expect(enhanced.parse(output).lines[0]).toEqual(line);
  });

  test("a line whose words are all untimed is written plain", () => {
    const line = { timestamp: 1000, text: "Oh yeah", words: [{ start: null, text: "Oh " }, { start: null, text: "yeah" }] };
    const output = enhanced.serialize({ ...enhanced.parse(""), lines: [line] });
    expect(output).toContain("[00:01.00] Oh yeah");
    expect(enhanced.parse(output).lines[0]).toEqual({ timestamp: 1000, text: "Oh yeah" });
  });

  test("the plain parser reads the tags but writes plain LRC", () => {
    const doc = simple.parse(input);
    expect(doc.lines[0]!.text).toBe("Never gonna give");
    expect(doc.lines[0]!.words).toHaveLength(3);
    const output = simple.serialize(doc);
    expect(output).toContain("[00:12.00] Never gonna give");
    expect(output).not.toContain("<");
  });
});
