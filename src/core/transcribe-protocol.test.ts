import { test, expect, describe } from "bun:test";
import { parseProtocolLine, validateLrcLines } from "./transcribe-protocol";

describe("parseProtocolLine", () => {
  test("parses stage lines", () => {
    expect(parseProtocolLine('{"type":"stage","stage":"demucs","message":"separating ..."}')).toEqual({
      type: "stage",
      stage: "demucs",
      message: "separating ...",
    });
  });

  test("parses error lines", () => {
    expect(parseProtocolLine('{"type":"error","stage":"init","message":"no API key"}')).toEqual({
      type: "error",
      stage: "init",
      message: "no API key",
    });
  });

  test("parses result lines into groups with word starts; ends, even if sent, are left out", () => {
    const raw =
      '{"type":"result","lines":[{"timestamp":1690,"text":"Hello you","words":[{"start":1690,"end":1900,"text":"Hello "},{"start":2000,"text":"you"}],"end":2400},{"timestamp":null,"text":"World"}],"rawLyrics":"Hello\\nWorld"}';
    const parsed = parseProtocolLine(raw);
    if (parsed?.type !== "result") throw new Error("not a result");
    expect(parsed.rawLyrics).toBe("Hello\nWorld");
    expect(parsed.groups.map((g) => g.words.map((w) => [w.text, w.start, w.end]))).toEqual([
      [["Hello", 1690, null], ["you", 2000, null]],
      [["World", null, null]],
    ]);
  });

  test("defaults rawLyrics to empty string when missing", () => {
    const parsed = parseProtocolLine('{"type":"result","lines":[]}');
    expect(parsed).toEqual({ type: "result", groups: [], rawLyrics: "" });
  });

  test("rejects garbage and non-protocol lines", () => {
    expect(parseProtocolLine("")).toBeNull();
    expect(parseProtocolLine("not json")).toBeNull();
    expect(parseProtocolLine("42")).toBeNull();
    expect(parseProtocolLine('"string"')).toBeNull();
    expect(parseProtocolLine('{"type":"unknown"}')).toBeNull();
    expect(parseProtocolLine('{"type":"stage","stage":"weird","message":"x"}')).toBeNull();
    expect(parseProtocolLine('{"type":"stage","stage":"api"}')).toBeNull();
    expect(parseProtocolLine('{"type":"result","lines":[{"timestamp":"soon","text":"x"}]}')).toBeNull();
    expect(parseProtocolLine('{"type":"result","lines":[{"timestamp":1}]}')).toBeNull();
  });
});

describe("validateLrcLines", () => {
  test("accepts an empty array", () => {
    expect(validateLrcLines([])).toEqual([]);
  });

  test("accepts joined words", () => {
    const lines = [{ timestamp: 1000, text: "And all through", words: [{ start: 1000, text: "And all " }, { start: 1600, text: "through" }] }];
    expect(validateLrcLines(lines)).toEqual(lines);
  });

  test("rejects non-arrays and malformed entries", () => {
    expect(validateLrcLines(null)).toBeNull();
    expect(validateLrcLines({})).toBeNull();
    expect(validateLrcLines([null])).toBeNull();
    expect(validateLrcLines([{ timestamp: "1", text: "x" }])).toBeNull();
    expect(validateLrcLines([{ timestamp: 1, text: 2 }])).toBeNull();
  });

  test("keeps extra fields out of the result", () => {
    expect(validateLrcLines([{ timestamp: 5, text: "x", extra: true }])).toEqual([{ timestamp: 5, text: "x" }]);
  });

  test("takes word starts and leaves word and line ends out", () => {
    const words = [{ start: 5, end: 8, text: "Hi " }, { start: 9, end: "soon", text: "there" }];
    expect(validateLrcLines([{ timestamp: 5, text: "Hi there", words, end: 12 }])).toEqual([
      { timestamp: 5, text: "Hi there", words: [{ start: 5, text: "Hi " }, { start: 9, text: "there" }] },
    ]);
  });

  test("drops words that do not spell out the line", () => {
    const words = [{ start: 5, text: "Something " }, { start: 9, text: "else" }];
    expect(validateLrcLines([{ timestamp: 5, text: "Hi there", words, end: 12 }])).toEqual([{ timestamp: 5, text: "Hi there" }]);
  });

  test("rejects malformed words", () => {
    expect(validateLrcLines([{ timestamp: 5, text: "Hi", words: "Hi" }])).toBeNull();
    expect(validateLrcLines([{ timestamp: 5, text: "Hi", words: [{ start: "5", text: "Hi" }] }])).toBeNull();
    expect(validateLrcLines([{ timestamp: 5, text: "Hi", words: [{ start: 5 }] }])).toBeNull();
  });
});
