import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Draft } from "../shared/api";
import { draftIdFor } from "./audio-files";
import { startTestApp, wavBytes, type TestApp } from "./test-helpers";

let t: TestApp;
let dir: string;
let song: string;
let bare: string;

beforeAll(async () => {
  t = await startTestApp();
  dir = path.join(t.music, "Drafts");
  await mkdir(dir, { recursive: true });
  song = path.join(dir, "song.wav");
  bare = path.join(dir, "bare.wav");
  await Bun.write(song, wavBytes({ seconds: 1, tags: { title: "From Tags", artist: "Tag Artist", album: "Tag Album" } }));
  await Bun.write(bare, wavBytes({ seconds: 1 }));
  await Bun.write(path.join(dir, "words.lrc"), "[ar:File Artist]\n[ti:File Title]\n[00:01.00] One\n[00:02.00] Two\n");
});

afterAll(() => t.close());

const open = async (body: object) => (await t.api("/api/drafts", { method: "POST", json: body })).json() as Promise<Draft>;

describe("drafts", () => {
  test("POST creates a draft from the tags, next to the audio", async () => {
    const draft = await open({ audioPath: bare });
    expect(draft).toMatchObject({
      id: draftIdFor(bare),
      audioPath: bare,
      step: "lyrics",
      lrcPath: path.join(dir, "bare.lrc"),
      dismissedFlags: [],
      savedAt: null,
      publishedAt: null,
    });
    expect(draft.doc.lines).toEqual([]);
    expect(await Bun.file(path.join(t.dirs.dataDir, "drafts", `${draft.id}.json`)).exists()).toBe(true);
  });

  test("POST with a lyrics file starts from it; its metadata wins, tags fill the gaps", async () => {
    const draft = await open({ audioPath: song, lyricsPath: path.join(dir, "words.lrc") });
    expect(draft.step).toBe("lines");
    expect(draft.doc.metadata).toMatchObject({ artist: "File Artist", title: "File Title", album: "Tag Album" });
    expect(draft.doc.lines).toEqual([
      { timestamp: 1000, text: "One" },
      { timestamp: 2000, text: "Two" },
    ]);
  });

  test("POST returns the existing draft", async () => {
    const first = await open({ audioPath: song });
    const again = await open({ audioPath: song, lyricsPath: path.join(dir, "words.lrc") });
    expect(again).toEqual(first);
  });

  test("POST validates its paths", async () => {
    expect((await t.api("/api/drafts", { method: "POST", json: { audioPath: "song.wav" } })).status).toBe(400);
    expect((await t.api("/api/drafts", { method: "POST", json: { audioPath: path.join(dir, "gone.wav") } })).status).toBe(404);
    const badLyrics = await t.api("/api/drafts", { method: "POST", json: { audioPath: bare, lyricsPath: song } });
    expect(badLyrics.status).toBe(400);
  });

  test("GET /:id and 404", async () => {
    const draft = (await (await t.api(`/api/drafts/${draftIdFor(song)}`)).json()) as Draft;
    expect(draft.audioPath).toBe(song);
    expect((await t.api("/api/drafts/0123456789abcdef")).status).toBe(404);
  });

  test("PUT keeps the fields the server owns", async () => {
    const id = draftIdFor(song);
    const before = (await (await t.api(`/api/drafts/${id}`)).json()) as Draft;
    const save = await t.api("/api/save", {
      method: "POST",
      json: { draftId: id, path: before.lrcPath, format: "lines", doc: before.doc },
    });
    expect(save.status).toBe(200);
    const saved = (await (await t.api(`/api/drafts/${id}`)).json()) as Draft;
    expect(saved.savedAt).toBeNumber();

    // A late autosave still carries the old savedAt: null.
    const edited: Draft = {
      ...before,
      audioPath: "/somewhere/else.wav",
      createdAt: 1,
      step: "words",
      dismissedFlags: ["f1"],
      doc: { ...before.doc, lines: [{ timestamp: 500, text: "Changed" }] },
    };
    const res = await t.api(`/api/drafts/${id}`, { method: "PUT", json: edited });
    expect(res.status).toBe(200);
    const { updatedAt } = (await res.json()) as { updatedAt: number };
    expect(updatedAt).toBeGreaterThan(before.updatedAt);

    const after = (await (await t.api(`/api/drafts/${id}`)).json()) as Draft;
    expect(after).toMatchObject({
      audioPath: song,
      createdAt: before.createdAt,
      savedAt: saved.savedAt,
      publishedAt: null,
      step: "words",
      dismissedFlags: ["f1"],
      updatedAt,
    });
    expect(after.doc.lines).toEqual([{ timestamp: 500, text: "Changed" }]);
  });

  test("PUT validates the body", async () => {
    const id = draftIdFor(song);
    const draft = (await (await t.api(`/api/drafts/${id}`)).json()) as Draft;
    const put = (body: object) => t.api(`/api/drafts/${id}`, { method: "PUT", json: body });
    expect((await put({ ...draft, step: "nope" })).status).toBe(400);
    expect((await put({ ...draft, doc: { lines: "x" } })).status).toBe(400);
    expect((await put({ ...draft, lrcPath: path.join(dir, "x.txt") })).status).toBe(400);
    expect((await put({ ...draft, id: "other" })).status).toBe(400);
    expect((await t.api("/api/drafts/0123456789abcdef", { method: "PUT", json: draft })).status).toBe(400);
    expect((await t.api("/api/drafts/0123456789abcdef", { method: "PUT", json: { ...draft, id: undefined } })).status).toBe(404);
  });

  test("DELETE removes it, and is idempotent", async () => {
    const id = draftIdFor(bare);
    expect(await (await t.api(`/api/drafts/${id}`, { method: "DELETE" })).json()).toEqual({ ok: true });
    expect((await t.api(`/api/drafts/${id}`)).status).toBe(404);
    expect((await t.api(`/api/drafts/${id}`, { method: "DELETE" })).status).toBe(200);
  });
});
