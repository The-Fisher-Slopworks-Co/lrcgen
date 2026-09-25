import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { detectMatchingAudio } from "./auto-detect-audio";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const TEST_DIR = "/tmp/lrcgen-test-autodetect";

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(`${TEST_DIR}/song.lrc`, "[00:01.00]test");
  writeFileSync(`${TEST_DIR}/song.mp3`, "fake mp3");
  writeFileSync(`${TEST_DIR}/alone.lrc`, "[00:01.00]no match");
  writeFileSync(`${TEST_DIR}/multi.lrc`, "[00:01.00]multi");
  writeFileSync(`${TEST_DIR}/multi.flac`, "fake flac");
  writeFileSync(`${TEST_DIR}/multi.wav`, "fake wav");
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("detectMatchingAudio", () => {
  test("finds mp3 with same name as lrc", async () => {
    const result = await detectMatchingAudio(`${TEST_DIR}/song.lrc`);
    expect(result).toBe(`${TEST_DIR}/song.mp3`);
  });

  test("finds audio for an enhanced lrc companion", async () => {
    const result = await detectMatchingAudio(`${TEST_DIR}/song.enhanced.lrc`);
    expect(result).toBe(`${TEST_DIR}/song.mp3`);
  });

  test("returns null when no matching audio exists", async () => {
    const result = await detectMatchingAudio(`${TEST_DIR}/alone.lrc`);
    expect(result).toBeNull();
  });

  test("returns first match when multiple audio formats exist", async () => {
    const result = await detectMatchingAudio(`${TEST_DIR}/multi.lrc`);
    expect(result).not.toBeNull();
    // Should find one of the available formats
    expect([`${TEST_DIR}/multi.flac`, `${TEST_DIR}/multi.wav`]).toContain(result);
  });

  test("returns null for non-existent lrc path", async () => {
    const result = await detectMatchingAudio(`${TEST_DIR}/nope.lrc`);
    expect(result).toBeNull();
  });
});
