import { test, expect, describe } from "bun:test";
import { durationMatch } from "./lrclib-match";

describe("durationMatch", () => {
  test("within two seconds matches the track", () => {
    expect(durationMatch(204_000, 204_000)).toEqual({ diffMs: 0, matches: true, label: "matches the track" });
    expect(durationMatch(204_000, 206_000)).toEqual({ diffMs: 2000, matches: true, label: "matches the track" });
    expect(durationMatch(204_000, 202_500).matches).toBe(true);
  });

  test("a few seconds off says how many, rounded", () => {
    expect(durationMatch(204_000, 211_000)).toEqual({ diffMs: 7000, matches: false, label: "7 s longer" });
    expect(durationMatch(204_000, 191_600)).toEqual({ diffMs: -12400, matches: false, label: "12 s shorter" });
    expect(durationMatch(204_000, 206_400).label).toBe("2 s longer");
    expect(durationMatch(204_000, 224_000).label).toBe("20 s longer");
  });

  test("way off is a different version", () => {
    expect(durationMatch(204_000, 242_000)).toEqual({ diffMs: 38000, matches: false, label: "different version" });
    expect(durationMatch(204_000, 183_000).label).toBe("different version");
  });
});
