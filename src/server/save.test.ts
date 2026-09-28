import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Draft, SaveCheck, SaveResponse } from "../shared/api";
import type { LyricsDoc } from "../core/lyrics";
import { parseLyricsFile } from "../core/lyrics-file";
import { q, startTestApp, wavBytes, type TestApp } from "./test-helpers";

let t: TestApp;
let dir: string;
let draft: Draft;

const doc: LyricsDoc = {
  metadata: { title: "Song", tool: "https://github.com/txssu/lrcgen" },
  groups: [
    { id: "g1", labels: [], words: [{ id: "w1", text: "Hello", start: 1000, end: 1300 }, { id: "w2", text: "world", start: 1500, end: 2000 }] },
    { id: "g2", labels: ["backing"], words: [{ id: "w3", text: "ooh", start: 1600, end: 1900 }] },
    { id: "g3", labels: [], words: [{ id: "w4", text: "Second", start: 3000, end: null }] },
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
const lyrics = () => path.join(dir, "song.lyrics.json");
const save = (body: object) => t.api("/api/save", { method: "POST", json: { draftId: draft.id, doc, ...body } });

describe("save", () => {
  test("check lists the lyrics file, the LRC targets and what already exists", async () => {
    const check = (await (await t.api(`/api/save/check${q({ path: lrc() })}`)).json()) as SaveCheck;
    expect(check).toEqual({
      lyricsPath: lyrics(),
      targets: [
        { format: "enhanced", paths: [lrc(), companion()] },
        { format: "lines", paths: [lrc()] },
        { format: "none", paths: [] },
      ],
      existing: [],
    });
  });

  test("enhanced writes the lyrics file and both LRC files; a second save backs them up first", async () => {
    const first = (await (await save({ path: lrc(), format: "enhanced" })).json()) as SaveResponse;
    expect(first).toEqual({ written: [lyrics(), lrc(), companion()], backups: [] });
    expect(await Bun.file(lrc()).text()).toContain("[00:01.00] Hello world (ooh)");
    expect(await Bun.file(companion()).text()).toContain("[00:01.00]<00:01.00>Hello <00:01.30> <00:01.50>world <00:01.60>(ooh)<00:02.00>");
    const back = parseLyricsFile(await Bun.file(lyrics()).text());
    expect(back.groups).toEqual(doc.groups);

    const saved = (await (await t.api(`/api/drafts/${draft.id}`)).json()) as Draft;
    expect(saved.savedAt).toBeNumber();

    const firstLrc = await Bun.file(lrc()).text();
    const again = { ...doc, groups: [{ id: "g1", labels: [], words: [{ id: "w1", text: "New", start: 0, end: null }] }] };
    const second = (await (await save({ path: lrc(), format: "enhanced", doc: again })).json()) as SaveResponse;
    expect(second.backups).toEqual([`${lyrics()}.bak`, `${lrc()}.bak`, `${companion()}.bak`]);
    expect(await Bun.file(`${lrc()}.bak`).text()).toBe(firstLrc);
    expect(await Bun.file(lrc()).text()).toContain("[00:00.00] New");

    const check = (await (await t.api(`/api/save/check${q({ path: lrc() })}`)).json()) as SaveCheck;
    expect(check.existing).toEqual([lyrics(), lrc(), companion()]);
  });

  test("lines-only writes the .lrc and backs up and removes the stale companion", async () => {
    const result = (await (await save({ path: lrc(), format: "lines" })).json()) as SaveResponse;
    expect(result.written).toEqual([lyrics(), lrc()]);
    expect(result.backups).toEqual([`${lyrics()}.bak`, `${lrc()}.bak`, `${companion()}.bak`]);
    expect(await Bun.file(companion()).exists()).toBe(false);
    expect(await Bun.file(`${companion()}.bak`).exists()).toBe(true);
    const text = await Bun.file(lrc()).text();
    expect(text).toContain("[00:01.00] Hello world");
    expect(text).not.toContain("<00:01.50>");
  });

  test("no LRC writes the lyrics file only and leaves the LRC files alone", async () => {
    const before = await Bun.file(lrc()).text();
    const result = (await (await save({ path: lrc(), format: "none" })).json()) as SaveResponse;
    expect(result).toEqual({ written: [lyrics()], backups: [`${lyrics()}.bak`] });
    expect(await Bun.file(lrc()).text()).toBe(before);
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
