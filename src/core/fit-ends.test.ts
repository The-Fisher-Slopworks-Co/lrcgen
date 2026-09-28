import { describe, expect, test } from "bun:test";
import { fitWordEnds, voicedUntil } from "./fit-ends";
import { doc, endsOf, group } from "./testing";

// 10 ms frames: voice 1000–1300 and 1500–1700, silence elsewhere.
const env = new Float32Array(400);
env.fill(0.5, 100, 130);
env.fill(0.5, 150, 170);

describe("voicedUntil", () => {
  test("ends where the voice stops before the next word", () => {
    expect(voicedUntil(env, 10, 1000, 1500)).toBe(1300);
  });

  test("a pause inside the word stays part of it", () => {
    expect(voicedUntil(env, 10, 1000, 2000)).toBe(1700);
  });

  test("no end when the voice runs right up to the next word; 150 ms when there's no voice at all", () => {
    expect(voicedUntil(env, 10, 1500, 1720)).toBeNull();
    expect(voicedUntil(env, 10, 2000, 3000)).toBe(2150);
  });
});

describe("fitWordEnds", () => {
  test("fits the timed words where the voice stops before the next one", () => {
    const d = doc(group("a b c", [1000, 1500, null], [null, 1600, null]));
    const fitted = fitWordEnds(d, env, 10);
    expect(endsOf(fitted.doc.groups[0])).toEqual([1300, 1700, null]);
    expect(fitted.changed).toBe(2);
  });

  test("a word that runs right into the next one gets no end, and loses the one it had", () => {
    const d = doc(group("a b", [1500, 1720], [1650, null]), group("next", [1900]));
    const fitted = fitWordEnds(d, env, 10, { groups: [0] });
    expect(endsOf(fitted.doc.groups[0])).toEqual([null, null]);
    expect(fitted.changed).toBe(1);
    expect(fitWordEnds(fitted.doc, env, 10, { groups: [0] }).changed).toBe(0);
  });

  test("only the words asked for", () => {
    const d = doc(group("a b", [1000, 1500]));
    const fitted = fitWordEnds(d, env, 10, { wordIds: [d.groups[0]!.words[1]!.id] });
    expect(endsOf(fitted.doc.groups[0])).toEqual([null, 1700]);
  });

  test("the last word of a line reaches no further than the next line", () => {
    const d = doc(group("a", [1000]), group("b", [1400]));
    expect(endsOf(fitWordEnds(d, env, 10).doc.groups[0])).toEqual([1300]);
  });
});
