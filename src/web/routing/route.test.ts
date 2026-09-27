import { describe, expect, test } from "bun:test";
import { formatRoute, parseRoute } from "./route";

describe("parseRoute", () => {
  test("open screen with a folder and a file", () => {
    const hash = formatRoute({ name: "open", dir: "/music/A & B #1", file: "/music/A & B #1/01 ?.flac" });
    expect(parseRoute(hash)).toEqual({ name: "open", dir: "/music/A & B #1", file: "/music/A & B #1/01 ?.flac" });
  });

  test("open screen without parameters", () => {
    expect(parseRoute("#/open")).toEqual({ name: "open", dir: null, file: null });
  });

  test("song step with params", () => {
    expect(parseRoute("#/song/0123abcd/lyrics?transcribe=1")).toEqual({
      name: "song",
      draftId: "0123abcd",
      step: "lyrics",
      params: { transcribe: "1" },
    });
  });

  test("unknown step or path is null", () => {
    expect(parseRoute("#/song/0123/karaoke")).toBeNull();
    expect(parseRoute("#/song/0123")).toBeNull();
    expect(parseRoute("")).toBeNull();
    expect(parseRoute("#/elsewhere")).toBeNull();
  });
});

describe("formatRoute", () => {
  test("round-trips a song route", () => {
    const route = { name: "song" as const, draftId: "ff00", step: "refine" as const, params: {} };
    expect(formatRoute(route)).toBe("#/song/ff00/refine");
    expect(parseRoute(formatRoute(route))).toEqual(route);
  });
});
