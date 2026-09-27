import { describe, expect, test } from "bun:test";
import { keyLabel, layoutHint, matchesKey, parseKeySpec, type KeyEventLike } from "./key-spec";

const ev = (key: string, code: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

const matches = (spec: string, e: KeyEventLike) => matchesKey(parseKeySpec(spec), e);

describe("parseKeySpec", () => {
  test("modifiers and aliases", () => {
    expect(parseKeySpec("Ctrl+Shift+Z")).toEqual({ key: "z", ctrl: true, shift: true, alt: false });
    expect(parseKeySpec("Esc").key).toBe("Escape");
    expect(parseKeySpec("Space").key).toBe(" ");
    expect(parseKeySpec("Del").key).toBe("Delete");
    expect(parseKeySpec("f2").key).toBe("F2");
    expect(parseKeySpec("+").key).toBe("+");
    expect(parseKeySpec("Ctrl++")).toEqual({ key: "+", ctrl: true, shift: false, alt: false });
  });

  test("rejects nonsense", () => {
    expect(() => parseKeySpec("Hyper+Z")).toThrow();
    expect(() => parseKeySpec("")).toThrow();
  });
});

describe("matchesKey", () => {
  test("letters go by the physical key, so a Russian layout works", () => {
    expect(matches("V", ev("м", "KeyV"))).toBe(true);
    expect(matches("V", ev("v", "KeyV"))).toBe(true);
    expect(matches("V", ev("V", "KeyV", { shiftKey: true }))).toBe(false);
    expect(matches("Shift+V", ev("V", "KeyV", { shiftKey: true }))).toBe(true);
  });

  test("modifiers must match exactly; Ctrl also means ⌘", () => {
    expect(matches("Ctrl+Z", ev("z", "KeyZ", { ctrlKey: true }))).toBe(true);
    expect(matches("Ctrl+Z", ev("z", "KeyZ", { metaKey: true }))).toBe(true);
    expect(matches("Ctrl+Z", ev("Z", "KeyZ", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matches("Ctrl+Shift+Z", ev("Z", "KeyZ", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matches("Z", ev("z", "KeyZ", { ctrlKey: true }))).toBe(false);
  });

  test("named keys", () => {
    expect(matches("Enter", ev("Enter", "Enter"))).toBe(true);
    expect(matches("Ctrl+Enter", ev("Enter", "Enter", { ctrlKey: true }))).toBe(true);
    expect(matches("Enter", ev("Enter", "Enter", { ctrlKey: true }))).toBe(false);
    expect(matches("Space", ev(" ", "Space"))).toBe(true);
    expect(matches("Shift+ArrowLeft", ev("ArrowLeft", "ArrowLeft", { shiftKey: true }))).toBe(true);
    expect(matches("ArrowLeft", ev("ArrowLeft", "ArrowLeft", { shiftKey: true }))).toBe(false);
    expect(matches("Esc", ev("Escape", "Escape"))).toBe(true);
  });

  test("punctuation by character, ignoring the Shift a layout needs", () => {
    expect(matches("/", ev("/", "Slash"))).toBe(true);
    expect(matches("/", ev("/", "Digit7", { shiftKey: true }))).toBe(true); // German layout
    expect(matches("?", ev("?", "Slash", { shiftKey: true }))).toBe(true);
    expect(matches("/", ev("-", "Slash"))).toBe(false); // German layout: that key is "-"
  });

  test("punctuation on a non-Latin layout goes by the physical key", () => {
    const ru = { nonLatinLayout: true };
    expect(matchesKey(parseKeySpec("/"), ev(".", "Slash"), ru)).toBe(true); // the "/" key types "." in Russian
    expect(matchesKey(parseKeySpec("/"), ev("ю", "Period"), ru)).toBe(false);
    expect(matchesKey(parseKeySpec("?"), ev(",", "Slash", { shiftKey: true }), ru)).toBe(true);
    expect(matchesKey(parseKeySpec("/"), ev(",", "Slash", { shiftKey: true }), ru)).toBe(false);
  });

  test("digits", () => {
    expect(matches("1", ev("1", "Digit1"))).toBe(true);
    expect(matches("1", ev("!", "Digit1", { shiftKey: true }))).toBe(false);
  });
});

test("keyLabel", () => {
  expect(keyLabel("Ctrl+Shift+Z")).toBe("Ctrl Shift Z");
  expect(keyLabel("ArrowLeft")).toBe("←");
  expect(keyLabel("Space")).toBe("Space");
  expect(keyLabel("Esc")).toBe("Esc");
  expect(keyLabel("/")).toBe("/");
});

test("layoutHint", () => {
  expect(layoutHint(ev("ф", "KeyA"))).toBe(true);
  expect(layoutHint(ev("a", "KeyA"))).toBe(false);
  expect(layoutHint(ev("Enter", "Enter"))).toBeNull();
});
