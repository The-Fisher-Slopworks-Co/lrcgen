import { test, expect, describe } from "bun:test";
import { createDocument } from "./lrc-document";
import type { LrcDocument, LrcLine } from "./lrc-document";
import { draftProgress } from "./draft-status";

const untimed = (text: string): LrcLine => ({ timestamp: null, text });
const timed = (text: string, ms: number): LrcLine => ({ timestamp: ms, text });
const withWords = (text: string, ms: number): LrcLine => ({ timestamp: ms, text, words: [{ start: ms, text }] });

function docOf(...lines: LrcLine[]): LrcDocument {
  return { ...createDocument(), lines };
}

const open = { published: false, openFlags: 0 };

describe("draftProgress", () => {
  test("no lyrics yet", () => {
    expect(draftProgress(createDocument(), open)).toEqual({
      totalLines: 0, linesTimed: 0, linesWithWords: 0, stepsDone: 0, status: "No lyrics yet",
    });
  });

  test("lyrics in", () => {
    const progress = draftProgress(docOf(untimed("A"), untimed("B")), open);
    expect(progress.stepsDone).toBe(1);
    expect(progress.status).toBe("Lyrics in");
  });

  test("some lines timed", () => {
    const progress = draftProgress(docOf(timed("A", 1000), untimed("B"), untimed("C")), open);
    expect(progress.stepsDone).toBe(1);
    expect(progress.linesTimed).toBe(1);
    expect(progress.status).toBe("Lines · 1 of 3");
  });

  test("all lines timed, words in progress", () => {
    const none = draftProgress(docOf(timed("A", 1000), timed("B", 2000)), open);
    expect(none.stepsDone).toBe(2);
    expect(none.status).toBe("Words · 0 of 2 lines");
    const some = draftProgress(docOf(withWords("A", 1000), timed("B", 2000)), open);
    expect(some.stepsDone).toBe(2);
    expect(some.linesWithWords).toBe(1);
    expect(some.status).toBe("Words · 1 of 2 lines");
  });

  test("words done is ready; no open flags makes it refined", () => {
    const doc = docOf(withWords("A", 1000), withWords("B", 2000));
    expect(draftProgress(doc, { published: false, openFlags: 2 })).toMatchObject({ stepsDone: 3, status: "Ready" });
    expect(draftProgress(doc, open)).toMatchObject({ stepsDone: 4, status: "Ready" });
  });

  test("a line counts as done only when every word is timed; punctuation-only words don't count", () => {
    const half: LrcLine = { timestamp: 1000, text: "Hi there", words: [{ start: 1000, text: "Hi " }, { start: null, text: "there" }] };
    const dashed: LrcLine = { timestamp: 2000, text: "Hi — there", words: [{ start: 2000, text: "Hi " }, { start: null, text: "— " }, { start: 2400, text: "there" }] };
    const progress = draftProgress(docOf(half, dashed), open);
    expect(progress).toMatchObject({ linesWithWords: 1, stepsDone: 2, status: "Words · 1 of 2 lines" });
  });

  test("published", () => {
    const doc = docOf(withWords("A", 1000), withWords("B", 2000));
    expect(draftProgress(doc, { published: true, openFlags: 0 })).toMatchObject({ stepsDone: 5, status: "Published" });
  });

  test("empty lines are left out of the counts", () => {
    const progress = draftProgress(docOf(timed("A", 1000), untimed(""), timed("", 1500), timed("B", 2000)), open);
    expect(progress).toMatchObject({ totalLines: 2, linesTimed: 2, stepsDone: 2 });
  });
});
