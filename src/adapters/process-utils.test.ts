import { test, expect, describe } from "bun:test";
import { commandExists } from "./process-utils";

describe("commandExists", () => {
  test("finds a command that exists", async () => {
    expect(await commandExists("sh")).toBe(true);
  });

  test("returns false for a missing command", async () => {
    expect(await commandExists("definitely-not-a-real-command-xyz")).toBe(false);
  });
});
