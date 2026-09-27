import { describe, expect, test } from "bun:test";
import type { LrclibResult } from "../../../shared/api";
import { describeResult, resultLyrics, sortResults } from "./search-results";

const result = (id: number, over: Partial<LrclibResult> = {}): LrclibResult => ({
  id,
  trackName: "Song",
  artistName: "Artist",
  albumName: null,
  durationMs: 204_000,
  instrumental: false,
  plainLyrics: "One\nTwo",
  syncedLyrics: null,
  ...over,
});

describe("sortResults", () => {
  test("matching lengths first, then the rest, instrumental last; stable otherwise", () => {
    const track = 204_000;
    const results = [
      result(1, { durationMs: 211_000 }),
      result(2, { instrumental: true }),
      result(3),
      result(4, { durationMs: null }),
      result(5, { durationMs: 205_500 }),
    ];
    expect(sortResults(results, track).map((r) => r.id)).toEqual([3, 5, 1, 4, 2]);
  });

  test("without a track length only instrumental ones move", () => {
    const results = [result(1, { instrumental: true }), result(2), result(3)];
    expect(sortResults(results, null).map((r) => r.id)).toEqual([2, 3, 1]);
  });
});

describe("describeResult", () => {
  test("synced result with an album that matches", () => {
    const view = describeResult(result(1, { albumName: "Short Waves", syncedLyrics: "[00:01.00] One" }), 204_000);
    expect(view.meta).toBe("Artist · Short Waves");
    expect(view.duration).toBe("03:24");
    expect(view.match?.matches).toBe(true);
    expect(view.match?.label).toBe("matches the track");
    expect(view.badge).toBe("line timings");
  });

  test("plain result without album, off by 7 s", () => {
    const view = describeResult(result(1, { durationMs: 211_000 }), 204_000);
    expect(view.meta).toBe("Artist · no album");
    expect(view.match?.label).toBe("7 s longer");
    expect(view.badge).toBe("plain lyrics");
  });

  test("instrumental; unknown lengths", () => {
    const view = describeResult(result(1, { instrumental: true, durationMs: null }), 204_000);
    expect(view.badge).toBe("instrumental");
    expect(view.match).toBeNull();
    expect(view.duration).toBe("––:––");
  });
});

describe("resultLyrics", () => {
  test("synced lyrics keep their times", () => {
    const { lines, timing } = resultLyrics(result(1, { syncedLyrics: "[00:14.62] One\n[00:19.88] Two" }));
    expect(timing).toBe("lines");
    expect(lines.map((l) => l.timestamp)).toEqual([14620, 19880]);
  });

  test("plain lyrics split at line breaks", () => {
    const { lines, timing } = resultLyrics(result(1));
    expect(timing).toBe("none");
    expect(lines.map((l) => l.text)).toEqual(["One", "Two"]);
  });

  test("instrumental has no lines", () => {
    expect(resultLyrics(result(1, { instrumental: true })).lines).toEqual([]);
  });
});
