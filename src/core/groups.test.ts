import { describe, expect, test } from "bun:test";
import { countParenRuns, hostOf, mergeIntoLine, moveToNewGroup, parenRuns, splitParentheses } from "./groups";
import { groupText } from "./lyrics";
import { doc, docOf, endsOf, group, startsOf, textsOf } from "./testing";

describe("hostOf", () => {
  test("a labelled group goes with the line that started last before it", () => {
    const d = doc(group("one two three", [1000, 1500, 2000]), group("ooh", [1600], [], ["backing"]), group("next", [4000]));
    expect(hostOf(d, 1)).toBe(0);
  });

  test("not when it comes long after that line", () => {
    const d = doc(group("one two", [1000, 1500], [null, 1800]), group("ooh", [3500], [], ["backing"]), group("next", [6000]));
    expect(hostOf(d, 1)).toBe(-1);
    const noEnd = doc(group("one two", [1000, 1500]), group("ooh", [2400], [], ["backing"]));
    expect(hostOf(noEnd, 1)).toBe(0);
  });

  test("lines, untimed groups and groups before any line have no host", () => {
    const d = doc(group("ooh", [500], [], ["backing"]), group("one", [1000]), group("ah", [], [], ["adlib"]));
    expect(hostOf(d, 0)).toBe(-1);
    expect(hostOf(d, 1)).toBe(-1);
    expect(hostOf(d, 2)).toBe(-1);
  });
});

describe("moveToNewGroup", () => {
  const d = () => doc(group("Ду-думал о_разном думал о_разном ду-думал", [6380, 6820, 7380, 7560, 7940]), group("next", [9340]));

  test("takes the words out into a group next to their line", () => {
    const src = d();
    const ids = src.groups[0]!.words.slice(2, 4).map((w) => w.id);
    const { doc: next, index } = moveToNewGroup(src, ids, ["backing"]);
    expect(index).toBe(1);
    expect(next.groups.map(groupText)).toEqual(["Ду-думал о разном ду-думал", "думал о разном", "next"]);
    expect(next.groups[1]!.labels).toEqual(["backing"]);
    expect(next.groups[1]!.words.map((w) => w.id)).toEqual(ids);
  });

  test("no word gets an end: each lasts until the next word of its group", () => {
    const src = d();
    const ids = src.groups[0]!.words.slice(2, 4).map((w) => w.id);
    const { doc: next } = moveToNewGroup(src, ids);
    expect(endsOf(next.groups[0])).toEqual([null, null, null]);
    expect(endsOf(next.groups[1])).toEqual([null, null]);
  });

  test("goes before its line when it starts earlier; an emptied group goes", () => {
    const src = doc(group("a b", [1000, 1200]), group("c", [2000]));
    const first = moveToNewGroup(src, [src.groups[0]!.words[0]!.id]);
    expect(first.index).toBe(0);
    expect(first.doc.groups.map(groupText)).toEqual(["a", "b", "c"]);
    const whole = moveToNewGroup(src, [src.groups[1]!.words[0]!.id], ["adlib"]);
    expect(whole.doc.groups.map((g) => g.labels)).toEqual([[], ["adlib"]]);
    expect(moveToNewGroup(src, ["nope"])).toEqual({ doc: src, index: -1 });
  });

  test("keeps time order among the labelled groups after its line", () => {
    const src = doc(group("a b c", [1000, 1500, 2500]), group("ooh", [1200], [], ["backing"]), group("next", [4000]));
    const { doc: next, index } = moveToNewGroup(src, [src.groups[0]!.words[2]!.id], ["adlib"]);
    expect(next.groups.map(groupText)).toEqual(["a b", "ooh", "c", "next"]);
    expect(index).toBe(2);
  });
});

describe("mergeIntoLine", () => {
  test("puts the words back where they fall in time", () => {
    const d = doc(group("one three", [1000, 3000]), group("two", [2000], [2500], ["backing"]), group("next", [5000]));
    const { doc: next, index } = mergeIntoLine(d, 1);
    expect(index).toBe(0);
    expect(next.groups.map(groupText)).toEqual(["one two three", "next"]);
    expect(startsOf(next.groups[0])).toEqual([1000, 2000, 3000]);
    expect(endsOf(next.groups[0])).toEqual([null, 2500, null]);
  });

  test("with no host, into the nearest line before it; lines stay as they are", () => {
    const d = doc(group("one", [1000]), group("later", [9000], [], ["adlib"]));
    expect(mergeIntoLine(d, 1).doc.groups.map(groupText)).toEqual(["one later"]);
    expect(mergeIntoLine(d, 0)).toEqual({ doc: d, index: -1 });
  });
});

describe("parentheses", () => {
  const line = () =>
    docOf({
      timestamp: 6380,
      text: "Ду-думал о разном (думал о разном), ду-думал о многом (Эй, а)",
      words: [
        { start: 6380, text: "Ду-думал " },
        { start: 6820, text: "о разном " },
        { start: 7380, text: "(думал " },
        { start: 7560, text: "о разном), " },
        { start: 7940, text: "ду-думал " },
        { start: 8320, text: "о многом " },
        { start: 8870, text: "(Эй, " },
        { start: 9160, text: "а)" },
      ],
      end: 9380,
    });

  test("finds the runs in parentheses", () => {
    expect(parenRuns(line().groups[0]!)).toEqual([[2, 3], [6, 7]]);
    expect(countParenRuns(line())).toBe(2);
  });

  test("splits them out: echoes are backing vocals, the rest ad-libs", () => {
    const { doc: next, backing, adlib } = splitParentheses(line());
    expect([backing, adlib]).toEqual([1, 1]);
    expect(next.groups.map(groupText)).toEqual(["Ду-думал о разном, ду-думал о многом", "думал о разном", "Эй, а"]);
    expect(next.groups.map((g) => g.labels)).toEqual([[], ["backing"], ["adlib"]]);
    expect(countParenRuns(next)).toBe(0);
  });

  test("no word gets an end; the one there was stays with its word", () => {
    const { doc: next } = splitParentheses(line());
    expect(endsOf(next.groups[0])).toEqual([null, null, null, null]);
    expect(endsOf(next.groups[1])).toEqual([null, null]);
    expect(endsOf(next.groups[2])).toEqual([null, 9380]);
  });

  test("a line all in parentheses just gets the label", () => {
    const d = doc(group("one two", [1000, 1500]), group("(one two)", [2000, 2300]));
    const { doc: next } = splitParentheses(d);
    expect(next.groups.map(groupText)).toEqual(["one two", "one two"]);
    expect(next.groups[1]!.labels).toEqual(["backing"]);
    expect(textsOf(next.groups[1])).toEqual(["one", "two"]);
  });
});
