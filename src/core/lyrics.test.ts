import { describe, expect, test } from "bun:test";
import {
  createDoc,
  findWord,
  groupEnd,
  groupsFromText,
  groupStart,
  groupText,
  hasAnyWordTimings,
  hasWordTimings,
  idsFor,
  insertGroup,
  joinWords,
  removeGroup,
  setGroupStart,
  setGroupText,
  setLabels,
  setMetadata,
  setWordEnd,
  setWordStart,
  setWordTimes,
  shiftWords,
  withUniqueIds,
  wordsComplete,
} from "./lyrics";
import { doc, endsOf, group, startsOf, textsOf } from "./testing";

describe("documents", () => {
  test("a new document has the tool and no groups", () => {
    const d = createDoc({ artist: "Radiohead", title: "Creep" });
    expect(d.metadata).toEqual({ artist: "Radiohead", title: "Creep", tool: "https://github.com/txssu/lrcgen" });
    expect(d.groups).toEqual([]);
  });

  test("metadata updates keep the tool", () => {
    const d = setMetadata(createDoc(), { artist: "Muse", album: "Absolution" });
    expect(d.metadata).toMatchObject({ artist: "Muse", album: "Absolution", tool: "https://github.com/txssu/lrcgen" });
  });

  test("text becomes one untimed group per non-empty line", () => {
    const groups = groupsFromText("  Line one \n\nLine  two\n");
    expect(groups.map(groupText)).toEqual(["Line one", "Line two"]);
    expect(groups.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(groups[1]!.words).toEqual([
      { id: "w3", text: "Line", start: null, end: null },
      { id: "w4", text: "two", start: null, end: null },
    ]);
  });
});

describe("ids", () => {
  test("new ids go past the highest there is", () => {
    const ids = idsFor([{ id: "g7", labels: [], words: [{ id: "w12", text: "a", start: null, end: null }, { id: "intro", text: "b", start: null, end: null }] }]);
    expect([ids.group(), ids.word(), ids.word()]).toEqual(["g8", "w13", "w14"]);
  });

  test("clashing and missing ids get fresh ones; the first keeps its id", () => {
    const groups = withUniqueIds([group("a b"), { ...group("c"), id: "g1" }, { ...group("d"), id: "g1" }]);
    expect(groups.map((g) => g.id)).toEqual(["g2", "g1", "g3"]);
    expect(new Set(groups.flatMap((g) => g.words.map((w) => w.id))).size).toBe(4);
  });

  test("finds a word by id", () => {
    const d = doc(group("a b"), group("c d"));
    expect(findWord(d, d.groups[1]!.words[1]!.id)).toEqual({ group: 1, word: 1 });
    expect(findWord(d, "nope")).toBeNull();
  });
});

describe("text", () => {
  test("joins words with spaces, except after syllables", () => {
    expect(joinWords([{ text: "beau", noSpaceAfter: true }, { text: "tiful" }, { text: "day" }])).toBe("beautiful day");
  });

  test("a typo fix keeps ids and timings, joined words too", () => {
    const d = doc(group("And_all through the night", [1000, 1600, 2000, 2200], [null, null, null, 3000]));
    const next = setGroupText(d, 0, "And all thru the night");
    expect(textsOf(next.groups[0])).toEqual(["And all", "thru", "the", "night"]);
    expect(startsOf(next.groups[0])).toEqual([1000, 1600, 2000, 2200]);
    expect(endsOf(next.groups[0])).toEqual([null, null, null, 3000]);
    expect(next.groups[0]!.words.map((w) => w.id)).toEqual(d.groups[0]!.words.map((w) => w.id));
  });

  test("a different number of words drops word timings but keeps the start", () => {
    const d = doc(group("Never gonna give", [1000, 1500, 2000], [null, null, 2500]));
    const g = setGroupText(d, 0, "Never gonna give you up").groups[0]!;
    expect(textsOf(g)).toEqual(["Never", "gonna", "give", "you", "up"]);
    expect(startsOf(g)).toEqual([1000, null, null, null, null]);
    expect(endsOf(g)).toEqual([null, null, null, null, null]);
    expect(new Set(g.words.map((w) => w.id)).size).toBe(5);
  });
});

describe("timing", () => {
  const g = group("Never gonna give", [1500, 1000, 2000], [null, null, 2500]);

  test("a group starts with its earliest word and ends with its latest end", () => {
    expect(groupStart(g)).toBe(1000);
    expect(groupEnd(g)).toBe(2500);
    expect(groupEnd(group("a b", [1000, 2000], [1500, null]))).toBeNull();
  });

  test("word timings are more than the line start", () => {
    expect(hasWordTimings(group("a b", [1000]))).toBe(false);
    expect(hasWordTimings(group("a b", [1000, 1200]))).toBe(true);
    expect(hasWordTimings(group("a", [1000], [1300]))).toBe(true);
    expect(hasAnyWordTimings(doc(group("a b", [1000]), group("c d", [2000, 2300])))).toBe(true);
  });

  test("complete when every sung word has a start; punctuation needn't", () => {
    expect(wordsComplete(group("Раз — 2", [1000, null, 1500]))).toBe(true);
    expect(wordsComplete(group("Раз — 2", [1000, null, null]))).toBe(false);
    expect(wordsComplete(group("Hi there", [1000]))).toBe(false);
    expect(wordsComplete({ id: "g", labels: [], words: [] })).toBe(false);
  });
});

describe("edits", () => {
  test("a group start times its first word when nothing is timed yet", () => {
    const d = doc(group("Hello world"));
    expect(startsOf(setGroupStart(d, 0, 3000).groups[0])).toEqual([3000, null]);
  });

  test("moving a group drags its words and ends along, never below zero", () => {
    const d = doc(group("a b", [1000, 1500], [1400, 2000]));
    const moved = setGroupStart(d, 0, 1200).groups[0]!;
    expect(startsOf(moved)).toEqual([1200, 1700]);
    expect(endsOf(moved)).toEqual([1600, 2200]);
    expect(startsOf(setGroupStart(d, 0, -5000).groups[0])).toEqual([0, 0]);
  });

  test("null clears the group's timings", () => {
    const d = doc(group("a b", [1000, 1500], [1400, 2000]));
    const cleared = setGroupStart(d, 0, null).groups[0]!;
    expect(startsOf(cleared)).toEqual([null, null]);
    expect(endsOf(cleared)).toEqual([null, null]);
  });

  test("a start past the end drops the end; an end before the start is refused", () => {
    const d = doc(group("a", [1000], [1400]));
    expect(endsOf(setWordStart(d, 0, 0, 1500).groups[0])).toEqual([null]);
    expect(endsOf(setWordStart(d, 0, 0, 1200).groups[0])).toEqual([1400]);
    expect(setWordEnd(d, 0, 0, 900)).toBe(d);
    expect(endsOf(setWordEnd(d, 0, 0, 1800).groups[0])).toEqual([1800]);
    expect(setWordTimes(d, 0, 0, 2000, 2600).groups[0]!.words[0]).toMatchObject({ start: 2000, end: 2600 });
  });

  test("shifting picked words moves starts and ends", () => {
    const d = doc(group("a b c", [1000, 1500, 2000], [1400, null, 2500]));
    const ids = new Set([d.groups[0]!.words[0]!.id, d.groups[0]!.words[2]!.id]);
    const next = shiftWords(d, ids, -100).groups[0]!;
    expect(startsOf(next)).toEqual([900, 1500, 1900]);
    expect(endsOf(next)).toEqual([1300, null, 2400]);
  });

  test("groups are inserted, removed and labelled", () => {
    const d = doc(group("A"), group("B"));
    const inserted = insertGroup(d, 1, "(ooh)", ["backing"]);
    expect(inserted.groups.map(groupText)).toEqual(["A", "(ooh)", "B"]);
    expect(inserted.groups[1]!.labels).toEqual(["backing"]);
    expect(new Set(inserted.groups.map((g) => g.id)).size).toBe(3);
    expect(removeGroup(inserted, 1).groups.map(groupText)).toEqual(["A", "B"]);
    expect(removeGroup(d, 5)).toBe(d);
    expect(setLabels(d, 0, [" adlib ", "", "adlib", "singer:A"]).groups[0]!.labels).toEqual(["adlib", "singer:A"]);
  });
});
