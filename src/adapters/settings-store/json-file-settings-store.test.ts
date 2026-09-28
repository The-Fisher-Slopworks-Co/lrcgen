import { test, expect, describe } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { JsonFileSettingsStore } from "./json-file-settings-store";

function withTempDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lrcgen-test-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

describe("JsonFileSettingsStore", () => {
  test("load returns empty object when file is missing", withTempDir(async (dir) => {
    const store = new JsonFileSettingsStore(dir);
    expect(await store.load()).toEqual({});
  }));

  test("save then load round-trips", withTempDir(async (dir) => {
    const store = new JsonFileSettingsStore(dir);
    const settings = {
      transcription: { apiKey: "k", baseUrl: "https://x", model: "m" },
    };
    await store.save(settings);
    expect(await store.load()).toEqual(settings);
  }));

  test("save creates the config directory", withTempDir(async (dir) => {
    const store = new JsonFileSettingsStore(path.join(dir, "nested", "lrcgen"));
    await store.save({ transcription: { apiKey: "k" } });
    expect((await store.load()).transcription?.apiKey).toBe("k");
  }));

  test("load swallows corrupt JSON", withTempDir(async (dir) => {
    await Bun.write(path.join(dir, "config.json"), "{not json");
    const store = new JsonFileSettingsStore(dir);
    expect(await store.load()).toEqual({});
  }));
});
