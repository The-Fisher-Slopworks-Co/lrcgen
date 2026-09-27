import { describe, expect, test } from "bun:test";
import { commit, createHistory, redo, redoLabel, undo, undoLabel } from "./history";

describe("history", () => {
  test("undo and redo walk the snapshots", () => {
    let h = createHistory("a", "open", 0);
    h = commit(h, "b", "tap", { now: 1 });
    h = commit(h, "c", "edit text", { now: 2 });
    expect(undoLabel(h)).toBe("edit text");
    h = undo(h);
    expect(h.present.value).toBe("b");
    expect(undoLabel(h)).toBe("tap");
    expect(redoLabel(h)).toBe("edit text");
    h = redo(h);
    expect(h.present.value).toBe("c");
    expect(redoLabel(h)).toBeNull();
  });

  test("nothing to undo at the start", () => {
    const h = createHistory("a");
    expect(undoLabel(h)).toBeNull();
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  test("a commit clears the redo branch", () => {
    let h = createHistory(1, "open", 0);
    h = commit(h, 2, "tap", { now: 1 });
    h = undo(h);
    h = commit(h, 3, "tap", { now: 2 });
    expect(h.future).toEqual([]);
    expect(h.past.map((e) => e.value)).toEqual([1]);
  });

  test("the same value is not a new entry", () => {
    const h = createHistory("a");
    expect(commit(h, "a", "tap")).toBe(h);
  });

  test("coalesces repeated changes with the same label", () => {
    let h = createHistory(0, "open", 0);
    h = commit(h, 10, "nudge", { coalesceMs: 800, now: 100 });
    h = commit(h, 20, "nudge", { coalesceMs: 800, now: 300 });
    h = commit(h, 30, "nudge", { coalesceMs: 800, now: 2000 });
    expect(h.past.map((e) => e.value)).toEqual([0, 20]);
    expect(undo(undo(h)).present.value).toBe(0);
  });

  test("never coalesces into the opening entry", () => {
    let h = createHistory(0, "nudge", 0);
    h = commit(h, 1, "nudge", { coalesceMs: 800, now: 10 });
    expect(undo(h).present.value).toBe(0);
  });
});
