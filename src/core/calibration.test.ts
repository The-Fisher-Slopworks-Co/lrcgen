import { test, expect, describe } from "bun:test";
import { analyzeTaps } from "./calibration";

const clicks = [0, 600, 1200, 1800, 2400, 3000];

describe("analyzeTaps", () => {
  test("steady taps give the median offset and a small spread", () => {
    const taps = [120, 710, 1335, 1920, 2515, 3125];
    const result = analyzeTaps(clicks, taps);
    expect(result.pairs.map((p) => p.deltaMs)).toEqual([120, 110, 135, 120, 115, 125]);
    expect(result.offsetMs).toBe(120);
    expect(result.spreadMs).toBe(5);
    expect(result.steady).toBe(true);
  });

  test("pairs each tap with the nearest click, once", () => {
    const result = analyzeTaps(clicks, [100, 130, 690]);
    expect(result.pairs).toEqual([
      { clickMs: 0, tapMs: 100, deltaMs: 100 },
      { clickMs: 600, tapMs: 690, deltaMs: 90 },
    ]);
  });

  test("taps early or unsorted still pair", () => {
    const result = analyzeTaps([...clicks].reverse(), [1180, 570, -20]);
    expect(result.pairs.map((p) => p.deltaMs)).toEqual([-20, -30, -20]);
    expect(result.offsetMs).toBe(-20);
  });

  test("taps too far from any click are left out", () => {
    const result = analyzeTaps(clicks, [120, 3400]);
    expect(result.pairs).toHaveLength(1);
  });

  test("too few taps or a wide spread is not steady", () => {
    expect(analyzeTaps(clicks, [120, 720, 1320, 1920]).steady).toBe(false);
    const scattered = analyzeTaps(clicks, [40, 760, 1250, 2000, 2450, 3200]);
    expect(scattered.pairs).toHaveLength(6);
    expect(scattered.spreadMs).toBeGreaterThan(25);
    expect(scattered.steady).toBe(false);
  });

  test("the median of an even count is the mean of the middle two", () => {
    expect(analyzeTaps(clicks, [100, 700, 1320, 1930]).offsetMs).toBe(110);
  });

  test("no taps or no clicks", () => {
    expect(analyzeTaps(clicks, [])).toEqual({ offsetMs: 0, spreadMs: 0, pairs: [], steady: false });
    expect(analyzeTaps([], [100])).toEqual({ offsetMs: 0, spreadMs: 0, pairs: [], steady: false });
  });

  test("a single click pairs with the nearest tap", () => {
    expect(analyzeTaps([1000], [1150, 1900]).pairs).toEqual([{ clickMs: 1000, tapMs: 1150, deltaMs: 150 }]);
  });
});
