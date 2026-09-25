import { test, expect, describe } from "bun:test";
import { msToLrc, lrcToMs, formatPosition } from "./time-utils";

describe("msToLrc", () => {
  test("converts 0ms", () => {
    expect(msToLrc(0)).toBe("00:00.00");
  });
  test("converts simple seconds", () => {
    expect(msToLrc(5000)).toBe("00:05.00");
  });
  test("converts minutes and seconds", () => {
    expect(msToLrc(83450)).toBe("01:23.45");
  });
  test("converts with hundredths", () => {
    expect(msToLrc(12300)).toBe("00:12.30");
  });
  test("converts large values", () => {
    expect(msToLrc(600000)).toBe("10:00.00");
  });
  test("rounds to hundredths", () => {
    expect(msToLrc(12345)).toBe("00:12.35");
  });
});

describe("lrcToMs", () => {
  test("parses 00:00.00", () => {
    expect(lrcToMs("00:00.00")).toBe(0);
  });
  test("parses minutes and seconds", () => {
    expect(lrcToMs("01:23.45")).toBe(83450);
  });
  test("parses seconds only", () => {
    expect(lrcToMs("00:12.30")).toBe(12300);
  });
  test("returns null for invalid format", () => {
    expect(lrcToMs("invalid")).toBeNull();
  });
  test("returns null for empty string", () => {
    expect(lrcToMs("")).toBeNull();
  });
  test("parses single-digit hundredths", () => {
    expect(lrcToMs("00:05.03")).toBe(5030);
  });
  test("parses milliseconds", () => {
    expect(lrcToMs("00:05.034")).toBe(5034);
  });
  test("parses tenths", () => {
    expect(lrcToMs("00:05.3")).toBe(5300);
  });
});

describe("formatPosition", () => {
  test("formats 0ms", () => {
    expect(formatPosition(0)).toBe("00:00.00");
  });
  test("formats minutes and seconds", () => {
    expect(formatPosition(83450)).toBe("01:23.45");
  });
});
