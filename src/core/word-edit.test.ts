import { describe, expect, test } from "bun:test";
import { groupText } from "./lyrics";
import { doc, endsOf, group, startsOf, textsOf } from "./testing";
import { joinWithNext, splitWord } from "./word-edit";

const line = () => doc(group("And all through the night", [1000, 1300, 1600, 2000, 2200], [null, 1500, null, null, 3000]));

describe("joinWithNext", () => {
  test("joins two words into one with the first start and the second end", () => {
    const g = joinWithNext(line(), 0, 0).groups[0]!;
    expect(textsOf(g)).toEqual(["And all", "through", "the", "night"]);
    expect(startsOf(g)).toEqual([1000, 1600, 2000, 2200]);
    expect(endsOf(g)).toEqual([1500, null, null, 3000]);
    expect(groupText(g)).toBe("And all through the night");
    expect(g.words[0]!.id).toBe(line().groups[0]!.words[0]!.id);
  });

  test("joins onto an already joined word", () => {
    expect(textsOf(joinWithNext(joinWithNext(line(), 0, 0), 0, 0).groups[0])[0]).toBe("And all through");
  });

  test("syllables join without a space", () => {
    const d = doc({ ...group("beau tiful", [1000, 1200]), words: [{ id: "", text: "beau", start: 1000, end: null, noSpaceAfter: true }, { id: "", text: "tiful", start: 1200, end: null }] });
    expect(textsOf(joinWithNext(d, 0, 0).groups[0])).toEqual(["beautiful"]);
  });

  test("leaves the document alone for the last word or out of range", () => {
    const d = line();
    expect(joinWithNext(d, 0, 4)).toBe(d);
    expect(joinWithNext(d, 0, -1)).toBe(d);
    expect(joinWithNext(d, 1, 0)).toBe(d);
  });
});

describe("splitWord", () => {
  test("splits after the first part; the second part has no times yet", () => {
    const g = splitWord(joinWithNext(line(), 0, 0), 0, 0).groups[0]!;
    expect(textsOf(g).slice(0, 3)).toEqual(["And", "all", "through"]);
    expect(startsOf(g).slice(0, 3)).toEqual([1000, null, 1600]);
    expect(endsOf(g).slice(0, 2)).toEqual([null, null]);
    expect(new Set(g.words.map((w) => w.id)).size).toBe(5);
  });

  test("a word of three parts splits into one part and a joined rest", () => {
    const g = splitWord(joinWithNext(joinWithNext(line(), 0, 2), 0, 2), 0, 2).groups[0]!;
    expect(textsOf(g).slice(2)).toEqual(["through", "the night"]);
  });

  test("leaves single words and out of range alone", () => {
    const d = line();
    expect(splitWord(d, 0, 1)).toBe(d);
    expect(splitWord(d, 0, 9)).toBe(d);
    expect(splitWord(d, 3, 0)).toBe(d);
  });
});
