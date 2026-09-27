import { test, expect, describe } from "bun:test";
import { isBacking, asBacking } from "./backing";

const line = (text: string) => ({ timestamp: null, text });

describe("isBacking", () => {
  test("a line wrapped in parentheses is a backing line", () => {
    expect(isBacking(line("(one by one)"))).toBe(true);
    expect(isBacking(line("  (one by one) "))).toBe(true);
    expect(isBacking(line("((echo))"))).toBe(true);
    expect(isBacking(line("()"))).toBe(true);
  });

  test("parentheses that don't wrap the whole line don't count", () => {
    expect(isBacking(line("one by one"))).toBe(false);
    expect(isBacking(line("(oh) one by one"))).toBe(false);
    expect(isBacking(line("one by one (oh)"))).toBe(false);
    expect(isBacking(line("(oh) and (ah)"))).toBe(false);
    expect(isBacking(line("(oh))"))).toBe(false);
    expect(isBacking(line("("))).toBe(false);
    expect(isBacking(line(""))).toBe(false);
  });
});

describe("asBacking", () => {
  test("wraps text in parentheses", () => {
    expect(asBacking("one by one")).toBe("(one by one)");
    expect(asBacking(" one by one ")).toBe("(one by one)");
    expect(asBacking("(oh) and (ah)")).toBe("((oh) and (ah))");
    expect(asBacking("")).toBe("()");
  });

  test("leaves a backing line as it is", () => {
    expect(asBacking("(one by one)")).toBe("(one by one)");
    expect(asBacking("()")).toBe("()");
  });
});
