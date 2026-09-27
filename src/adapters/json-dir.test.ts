import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonDir } from "./json-dir";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lrcgen-jsondir-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("JsonDir", () => {
  test("writes, reads, lists and removes", async () => {
    const store = new JsonDir<{ n: number }>(path.join(dir, "things"));
    expect(await store.read("a")).toBeNull();
    expect(await store.readAll()).toEqual([]);

    await store.write("a", { n: 1 });
    await store.write("b", { n: 2 });
    expect(await store.read("a")).toEqual({ n: 1 });
    expect((await store.readAll()).map((v) => v.n).sort()).toEqual([1, 2]);
    // No temp files left behind.
    expect((await readdir(path.join(dir, "things"))).sort()).toEqual(["a.json", "b.json"]);

    expect(await store.remove("a")).toBe(true);
    expect(await store.remove("a")).toBe(false);
    expect(await store.read("a")).toBeNull();
  });

  test("rejects ids that could escape the directory", async () => {
    const store = new JsonDir<{ n: number }>(dir);
    expect(await store.read("../etc")).toBeNull();
    await expect(store.write("../x", { n: 1 })).rejects.toThrow();
    expect(await store.remove("../x")).toBe(false);
  });

  test("skips unreadable files", async () => {
    await Bun.write(path.join(dir, "bad.json"), "{nope");
    const store = new JsonDir<{ n: number }>(dir);
    expect(await store.readAll()).toEqual([]);
  });
});
