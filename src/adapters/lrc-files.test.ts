import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readLrcFile, writeLrcFiles } from "./lrc-files";
import { SimpleLrcParser } from "./lrc-parser/simple-lrc-parser";
import { EnhancedLrcParser } from "./lrc-parser/enhanced-lrc-parser";
import { type LyricsDoc } from "../core/lyrics";
import { docOf } from "../core/testing";

const plain = new SimpleLrcParser();
const enhanced = new EnhancedLrcParser();

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "lrcgen-files-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const withWords: LyricsDoc = docOf(
  { timestamp: 1000, text: "Hello world", words: [{ start: 1000, text: "Hello " }, { start: 1500, text: "world" }], end: 2000 },
  { timestamp: 3000, text: "Plain" },
);

describe("writeLrcFiles", () => {
  test("writes only the plain file when there are no word timings", async () => {
    const file = path.join(dir, "song.lrc");
    const written = await writeLrcFiles(file, docOf({ timestamp: 1000, text: "Hi" }), plain, enhanced);
    expect(written).toEqual([file]);
    expect(existsSync(path.join(dir, "song.enhanced.lrc"))).toBe(false);
  });

  test("writes the plain file and an enhanced companion", async () => {
    const file = path.join(dir, "song.lrc");
    const written = await writeLrcFiles(file, withWords, plain, enhanced);
    const companion = path.join(dir, "song.enhanced.lrc");
    expect(written).toEqual([file, companion]);
    expect(await Bun.file(file).text()).toContain("[00:01.00] Hello world");
    expect(await Bun.file(file).text()).not.toContain("<");
    expect(await Bun.file(companion).text()).toContain("[00:01.00]<00:01.00>Hello <00:01.50>world<00:02.00>");
  });

  test("keeps an existing companion in sync after word timings are gone", async () => {
    const file = path.join(dir, "song.lrc");
    await writeLrcFiles(file, withWords, plain, enhanced);
    const written = await writeLrcFiles(file, docOf({ timestamp: 1000, text: "New" }), plain, enhanced);
    expect(written).toHaveLength(2);
    expect(await Bun.file(path.join(dir, "song.enhanced.lrc")).text()).toContain("[00:01.00] New");
  });
});

describe("readLrcFile", () => {
  test("picks up word timings from the companion", async () => {
    const file = path.join(dir, "song.lrc");
    await writeLrcFiles(file, withWords, plain, enhanced);
    const doc = await readLrcFile(file, plain);
    expect(doc.groups).toEqual(withWords.groups);
  });

  test("reads a plain file without a companion", async () => {
    const file = path.join(dir, "song.lrc");
    await Bun.write(file, "[00:01.00] Hi");
    const doc = await readLrcFile(file, plain);
    expect(doc.groups).toEqual(docOf({ timestamp: 1000, text: "Hi" }).groups);
  });

  test("reads the enhanced file directly", async () => {
    const file = path.join(dir, "song.lrc");
    await writeLrcFiles(file, withWords, plain, enhanced);
    const doc = await readLrcFile(path.join(dir, "song.enhanced.lrc"), plain);
    expect(doc.groups).toEqual(withWords.groups);
  });
});
