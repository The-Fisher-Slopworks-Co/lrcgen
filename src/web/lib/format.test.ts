import { describe, expect, test } from "bun:test";
import { clock, latencyCorrection, percent, plural, relativeDay, seconds, shortClock, signedMs } from "./format";

describe("format", () => {
  test("clock", () => {
    expect(clock(44310)).toBe("00:44.31");
    expect(clock(null)).toBe("––:––.––");
    expect(clock(-5)).toBe("00:00.00");
  });

  test("shortClock", () => {
    expect(shortClock(204100)).toBe("03:24");
    expect(shortClock(null)).toBe("––:––");
  });

  test("seconds", () => {
    expect(seconds(41460)).toBe("41.46");
    expect(seconds(68400)).toBe("1:08.40");
  });

  test("signed milliseconds use a real minus", () => {
    expect(signedMs(-184)).toBe("−184 ms");
    expect(signedMs(12.4)).toBe("+12 ms");
    expect(signedMs(0)).toBe("0 ms");
    expect(latencyCorrection(184)).toBe("−184 ms");
  });

  test("relativeDay", () => {
    const now = new Date(2026, 8, 26, 12).getTime();
    expect(relativeDay(new Date(2026, 8, 26, 1).getTime(), now)).toBe("today");
    expect(relativeDay(new Date(2026, 8, 25, 23).getTime(), now)).toBe("yesterday");
    expect(relativeDay(new Date(2026, 8, 23).getTime(), now)).toBe("3 days ago");
    expect(relativeDay(new Date(2026, 8, 14).getTime(), now)).toBe("Sep 14");
    expect(relativeDay(new Date(2025, 11, 31).getTime(), now)).toBe("Dec 31, 2025");
  });

  test("percent and plural", () => {
    expect(percent(0.623)).toBe("62%");
    expect(percent(2)).toBe("100%");
    expect(plural(1, "line")).toBe("1 line");
    expect(plural(12, "line")).toBe("12 lines");
  });
});
