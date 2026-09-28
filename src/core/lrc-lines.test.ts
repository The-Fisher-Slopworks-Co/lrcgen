import { describe, expect, test } from "bun:test";
import { groupsFromLrcLines } from "./lrc-lines";
import { groupText } from "./lyrics";
import { endsOf, startsOf, textsOf } from "./testing";

describe("groupsFromLrcLines", () => {
  test("a line start becomes its first word's start", () => {
    const [g] = groupsFromLrcLines([{ timestamp: 1000, text: "Hello big world" }]);
    expect(textsOf(g)).toEqual(["Hello", "big", "world"]);
    expect(startsOf(g)).toEqual([1000, null, null]);
    expect(g!.id).toBe("g1");
    expect(g!.words.map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
  });

  test("word starts, joined words, syllables and the line end", () => {
    const [g] = groupsFromLrcLines([
      {
        timestamp: 1000,
        text: "And all through beautiful",
        words: [
          { start: 1000, text: "And all " },
          { start: 1600, text: "through " },
          { start: 2000, text: "beau" },
          { start: 2200, text: "tiful" },
        ],
        end: 2600,
      },
    ]);
    expect(textsOf(g)).toEqual(["And all", "through", "beau", "tiful"]);
    expect(startsOf(g)).toEqual([1000, 1600, 2000, 2200]);
    expect(endsOf(g)).toEqual([null, null, null, 2600]);
    expect(g!.words[2]!.noSpaceAfter).toBe(true);
    expect(groupText(g!)).toBe("And all through beautiful");
  });

  test("word ends from the source are kept; untimed words before the first tag get the line start", () => {
    const [g] = groupsFromLrcLines([{ timestamp: 900, text: "Oh yeah", words: [{ start: null, text: "Oh " }, { start: 1000, end: 1400, text: "yeah" }] }]);
    expect(startsOf(g)).toEqual([900, 1000]);
    expect(endsOf(g)).toEqual([null, 1400]);
  });

  test("an empty timed line ends the line before it", () => {
    const groups = groupsFromLrcLines([
      { timestamp: 1000, text: "Hi there", words: [{ start: 1000, text: "Hi " }, { start: 1500, text: "there" }] },
      { timestamp: 2300, text: "" },
      { timestamp: null, text: "  " },
      { timestamp: 3000, text: "Next" },
    ]);
    expect(groups.map(groupText)).toEqual(["Hi there", "Next"]);
    expect(endsOf(groups[0])).toEqual([null, 2300]);
  });

  test("a line all in parentheses is a backing vocal", () => {
    const [g] = groupsFromLrcLines([{ timestamp: 5000, text: "(one by one)" }]);
    expect(g!.labels).toEqual(["backing"]);
    expect(groupText(g!)).toBe("one by one");
    expect(startsOf(g)).toEqual([5000, null, null]);
    expect(groupsFromLrcLines([{ timestamp: null, text: "(oh) and (ah)" }])[0]!.labels).toEqual([]);
  });
});
