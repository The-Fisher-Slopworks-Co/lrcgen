import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { draftIdFor } from "./audio-files";
import { resolveLaunch } from "./launch";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lrcgen-launch-"));
  await Bun.write(path.join(dir, "song.mp3"), "x");
  await Bun.write(path.join(dir, "notes.txt"), "x");
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe("resolveLaunch", () => {
  test("an audio file opens its draft", async () => {
    const song = path.join(dir, "song.mp3");
    expect(await resolveLaunch("song.mp3", dir)).toEqual({ kind: "audio", path: song, draftId: draftIdFor(song) });
  });

  test("a folder opens in the browser", async () => {
    expect(await resolveLaunch(".", dir)).toEqual({ kind: "folder", path: dir });
  });

  test("anything else is an error", async () => {
    await expect(resolveLaunch("notes.txt", dir)).rejects.toThrow("Not an audio file");
    await expect(resolveLaunch("missing", dir)).rejects.toThrow("No such file");
  });
});
