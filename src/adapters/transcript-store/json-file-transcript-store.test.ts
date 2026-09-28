import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonFileTranscriptStore } from "./json-file-transcript-store";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lrcgen-transcripts-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("a transcript from before groups comes back as groups with word starts, without its line ends", async () => {
  const legacy = {
    draftId: "d1",
    rawLyrics: "Hello you",
    createdAt: 1,
    lines: [{ timestamp: 1000, text: "Hello you", words: [{ start: 1000, text: "Hello " }, { start: 1500, text: "you" }], end: 2400 }],
  };
  await Bun.write(path.join(dir, "transcripts", "d1.json"), JSON.stringify(legacy));
  const transcript = await new JsonFileTranscriptStore(dir).get("d1");
  expect(transcript?.rawLyrics).toBe("Hello you");
  expect(transcript?.groups.map((g) => g.words.map((w) => [w.text, w.start, w.end]))).toEqual([
    [
      ["Hello", 1000, null],
      ["you", 1500, null],
    ],
  ]);
  expect(transcript).not.toHaveProperty("lines");
});
