import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import type { Draft, LrclibResult } from "../shared/api";
import type { LrcDocument } from "../core/lrc-document";
import type { LyricsPublisher } from "../ports/lyrics-publisher";
import type { LyricsSearch, LyricsSearchQuery } from "../ports/lyrics-search";
import { q, startTestApp, wavBytes, type TestApp } from "./test-helpers";

const result: LrclibResult = {
  id: 1,
  trackName: "Song",
  artistName: "Artist",
  albumName: null,
  durationMs: 180000,
  instrumental: false,
  plainLyrics: "Hi",
  syncedLyrics: null,
};

const queries: LyricsSearchQuery[] = [];
const search: LyricsSearch = {
  name: "fake",
  async search(query) {
    queries.push(query);
    if (query.title === "fail") throw new Error("LRCLIB search failed (503)");
    return [result];
  },
};

const published: { doc: LrcDocument; ms: number }[] = [];
const publisher: LyricsPublisher = {
  name: "fake",
  async publish(doc, ms) {
    published.push({ doc, ms });
    return doc.lines.length ? { success: true } : { success: false, error: "Nothing to publish" };
  },
};

let t: TestApp;
let draft: Draft;

beforeAll(async () => {
  t = await startTestApp({ registry: { lyricsSearch: search, lyricsPublisher: publisher } });
  const song = path.join(t.music, "song.wav");
  await Bun.write(song, wavBytes({ seconds: 1 }));
  draft = (await (await t.api("/api/drafts", { method: "POST", json: { audioPath: song } })).json()) as Draft;
});

afterAll(() => t.close());

describe("LRCLIB routes", () => {
  test("search passes the query through", async () => {
    const res = await t.api(`/api/lrclib/search${q({ artist: "Artist", title: "Song", album: "" })}`);
    expect(await res.json()).toEqual([result]);
    expect(queries.at(-1)).toEqual({ title: "Song", artist: "Artist", album: undefined });
  });

  test("search failures are 502s", async () => {
    const res = await t.api(`/api/lrclib/search${q({ title: "fail" })}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "LRCLIB search failed (503)" });
  });

  test("publish marks the draft published on success only", async () => {
    const doc: LrcDocument = { metadata: { tool: "x" }, lines: [{ timestamp: 0, text: "Hi" }] };
    const failed = await t.api("/api/lrclib/publish", {
      method: "POST",
      json: { draftId: draft.id, doc: { ...doc, lines: [] }, durationMs: 1000 },
    });
    expect(await failed.json()).toEqual({ success: false, error: "Nothing to publish" });
    expect(((await (await t.api(`/api/drafts/${draft.id}`)).json()) as Draft).publishedAt).toBeNull();

    const ok = await t.api("/api/lrclib/publish", { method: "POST", json: { draftId: draft.id, doc, durationMs: 1000 } });
    expect(await ok.json()).toEqual({ success: true });
    expect(published.at(-1)).toEqual({ doc, ms: 1000 });
    expect(((await (await t.api(`/api/drafts/${draft.id}`)).json()) as Draft).publishedAt).toBeNumber();

    const bad = await t.api("/api/lrclib/publish", { method: "POST", json: { draftId: draft.id, doc, durationMs: 0 } });
    expect(bad.status).toBe(400);
  });
});
