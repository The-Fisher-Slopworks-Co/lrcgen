import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Draft, SaveCheck, SaveResponse } from "../shared/api";
import type { LrcDocument } from "../core/lrc-document";
import { q, startTestApp, wavBytes, type TestApp } from "./test-helpers";

let t: TestApp;
let dir: string;
let draft: Draft;

const doc: LrcDocument = {
  metadata: { title: "Song", tool: "lrcgen" },
  lines: [
    { timestamp: 1000, text: "Hello world", words: [{ start: 1000, text: "Hello " }, { start: 1500, text: "world" }], end: 2000 },
    { timestamp: 3000, text: "Second" },
  ],
};

beforeAll(async () => {
  t = await startTestApp();
  dir = path.join(t.music, "Save");
  await mkdir(dir, { recursive: true });
  await Bun.write(path.join(dir, "song.wav"), wavBytes({ seconds: 1 }));
  draft = (await (await t.api("/api/drafts", { method: "POST", json: { audioPath: path.join(dir, "song.wav") } })).json()) as Draft;
});

afterAll(() => t.close());

const lrc = () => path.join(dir, "song.lrc");
const companion = () => path.join(dir, "song.enhanced.lrc");
const save = (body: object) => t.api("/api/save", { method: "POST", json: { draftId: draft.id, doc, ...body } });

describe("save", () => {
  test("check lists targets and what already exists", async () => {
    const check = (await (await t.api(`/api/save/check${q({ path: lrc() })}`)).json()) as SaveCheck;
    expect(check).toEqual({
      targets: [
        { format: "enhanced", paths: [lrc(), companion()] },
        { format: "lines", paths: [lrc()] },
      ],
      existing: [],
    });
  });

  test("enhanced writes both files; a second save backs them up first", async () => {
    const first = (await (await save({ path: lrc(), format: "enhanced" })).json()) as SaveResponse;
    expect(first).toEqual({ written: [lrc(), companion()], backups: [] });
    expect(await Bun.file(lrc()).text()).toContain("[00:01.00] Hello world");
    expect(await Bun.file(companion()).text()).toContain("<00:01.50>world");

    const saved = (await (await t.api(`/api/drafts/${draft.id}`)).json()) as Draft;
    expect(saved.savedAt).toBeNumber();

    const firstLrc = await Bun.file(lrc()).text();
    const second = (await (await save({ path: lrc(), format: "enhanced", doc: { ...doc, lines: [{ timestamp: 0, text: "New" }] } })).json()) as SaveResponse;
    expect(second.backups).toEqual([`${lrc()}.bak`, `${companion()}.bak`]);
    expect(await Bun.file(`${lrc()}.bak`).text()).toBe(firstLrc);
    expect(await Bun.file(lrc()).text()).toContain("[00:00.00] New");

    const check = (await (await t.api(`/api/save/check${q({ path: lrc() })}`)).json()) as SaveCheck;
    expect(check.existing).toEqual([lrc(), companion()]);
  });

  test("lines-only writes the .lrc and backs up and removes the stale companion", async () => {
    const result = (await (await save({ path: lrc(), format: "lines" })).json()) as SaveResponse;
    expect(result.written).toEqual([lrc()]);
    expect(result.backups).toEqual([`${lrc()}.bak`, `${companion()}.bak`]);
    expect(await Bun.file(companion()).exists()).toBe(false);
    expect(await Bun.file(`${companion()}.bak`).exists()).toBe(true);
    const text = await Bun.file(lrc()).text();
    expect(text).toContain("[00:01.00] Hello world");
    expect(text).not.toContain("<00:01.50>");
  });

  test("only writes plain .lrc files into existing folders", async () => {
    expect((await save({ path: companion(), format: "enhanced" })).status).toBe(400);
    expect((await save({ path: path.join(dir, "song.txt"), format: "lines" })).status).toBe(400);
    expect((await save({ path: "song.lrc", format: "lines" })).status).toBe(400);
    expect((await save({ path: lrc(), format: "karaoke" })).status).toBe(400);
    expect((await save({ path: lrc(), format: "lines", doc: { nope: true } })).status).toBe(400);
    expect((await save({ path: path.join(dir, "missing", "song.lrc"), format: "lines" })).status).toBe(404);
    expect((await t.api(`/api/save/check${q({ path: path.join(dir, "song.mp3") })}`)).status).toBe(400);
  });
});
