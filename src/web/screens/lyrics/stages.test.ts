import { describe, expect, test } from "bun:test";
import { elapsed, segmentFill, stageIndex, stageState } from "./stages";

describe("stageState", () => {
  test("before, at and after the running stage", () => {
    const job = { status: "running" as const, stage: "api" as const };
    expect([0, 1, 2, 3].map((i) => stageState(job, i))).toEqual(["done", "done", "current", "later"]);
  });

  test("a failed job marks its stage", () => {
    const job = { status: "error" as const, stage: "demucs" as const };
    expect([0, 1, 2, 3].map((i) => stageState(job, i))).toEqual(["done", "failed", "later", "later"]);
  });

  test("done: all done; no job: all later", () => {
    expect([0, 3].map((i) => stageState({ status: "done", stage: "align" }, i))).toEqual(["done", "done"]);
    expect([0, 3].map((i) => stageState(null, i))).toEqual(["later", "later"]);
  });

  test("stageIndex maps init/demucs/api/align to 0–3", () => {
    expect(["init", "demucs", "api", "align"].map((s) => stageIndex(s as never))).toEqual([0, 1, 2, 3]);
  });
});

describe("segmentFill", () => {
  test("done segments full, current one at its progress, later ones empty", () => {
    expect(segmentFill({ status: "running", stage: "demucs", progress: 0.62 })).toEqual([1, 0.62, 0, 0]);
    expect(segmentFill({ status: "running", stage: "init", progress: null })).toEqual([null, 0, 0, 0]);
    expect(segmentFill({ status: "done", stage: "align", progress: 1 })).toEqual([1, 1, 1, 1]);
    expect(segmentFill(null)).toEqual([0, 0, 0, 0]);
  });
});

test("elapsed", () => {
  expect(elapsed(0, 0)).toBe("0:00");
  expect(elapsed(0, 72_400)).toBe("1:12");
  expect(elapsed(1000, 0)).toBe("0:00");
});
