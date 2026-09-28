import { describe, expect, test } from "bun:test";
import { isWrapped } from "./backing";

describe("isWrapped", () => {
  test("a line wrapped in parentheses", () => {
    expect(isWrapped("(one by one)")).toBe(true);
    expect(isWrapped("  (one by one) ")).toBe(true);
    expect(isWrapped("((echo))")).toBe(true);
    expect(isWrapped("()")).toBe(true);
  });

  test("parentheses that don't wrap the whole line don't count", () => {
    expect(isWrapped("one by one")).toBe(false);
    expect(isWrapped("(oh) one by one")).toBe(false);
    expect(isWrapped("one by one (oh)")).toBe(false);
    expect(isWrapped("(oh) and (ah)")).toBe(false);
    expect(isWrapped("(oh))")).toBe(false);
    expect(isWrapped("(")).toBe(false);
    expect(isWrapped("")).toBe(false);
  });
});
