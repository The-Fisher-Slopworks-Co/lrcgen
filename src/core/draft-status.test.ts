import { describe, expect, test } from "bun:test";
import { draftProgress } from "./draft-status";
import { createDoc } from "./lyrics";
import { doc, group } from "./testing";

const open = { published: false, openFlags: 0 };

describe("draftProgress", () => {
  test("no lyrics yet", () => {
    expect(draftProgress(createDoc(), open)).toEqual({
      totalLines: 0, linesTimed: 0, linesWithWords: 0, stepsDone: 0, status: "No lyrics yet",
    });
  });

  test("lyrics in", () => {
    const progress = draftProgress(doc(group("A a"), group("B b")), open);
    expect(progress.stepsDone).toBe(1);
    expect(progress.status).toBe("Lyrics in");
  });

  test("some lines timed", () => {
    const progress = draftProgress(doc(group("A a", [1000]), group("B b"), group("C c")), open);
    expect(progress.stepsDone).toBe(1);
    expect(progress.linesTimed).toBe(1);
    expect(progress.status).toBe("Lines · 1 of 3");
  });

  test("all lines timed, words in progress", () => {
    const none = draftProgress(doc(group("A a", [1000]), group("B b", [2000])), open);
    expect(none.stepsDone).toBe(2);
    expect(none.status).toBe("Words · 0 of 2 lines");
    const some = draftProgress(doc(group("A a", [1000, 1200]), group("B b", [2000])), open);
    expect(some.linesWithWords).toBe(1);
    expect(some.status).toBe("Words · 1 of 2 lines");
  });

  test("words done is ready; no open flags makes it refined", () => {
    const d = doc(group("A a", [1000, 1200]), group("B b", [2000, 2200]));
    expect(draftProgress(d, { published: false, openFlags: 2 })).toMatchObject({ stepsDone: 3, status: "Ready" });
    expect(draftProgress(d, open)).toMatchObject({ stepsDone: 4, status: "Ready" });
  });

  test("a line counts as done only when every word is timed; punctuation-only words don't count", () => {
    const d = doc(group("Hi there", [1000]), group("Hi — there", [2000, null, 2400]));
    expect(draftProgress(d, open)).toMatchObject({ linesWithWords: 1, stepsDone: 2, status: "Words · 1 of 2 lines" });
  });

  test("backing vocals aren't lines, but their words need timing too", () => {
    const d = doc(group("A a", [1000, 1200]), group("ooh yeah", [1100], [], ["backing"]));
    expect(draftProgress(d, open)).toMatchObject({ totalLines: 1, linesWithWords: 1, stepsDone: 2 });
  });

  test("published", () => {
    const d = doc(group("A a", [1000, 1200]));
    expect(draftProgress(d, { published: true, openFlags: 0 })).toMatchObject({ stepsDone: 5, status: "Published" });
  });
});
