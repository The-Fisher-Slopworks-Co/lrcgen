import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { Draft, DraftSummary, TrackInfo } from "../shared/api";
import { draftProgress } from "../core/draft-status";
import { findFlags } from "../core/flags";
import { q, startTestApp, wavBytes, type TestApp } from "./test-helpers";

// Summaries come from core's draftProgress + findFlags.

let t: TestApp;
let first: string;
let second: string;

beforeAll(async () => {
  t = await startTestApp();
  first = path.join(t.music, "first.wav");
  second = path.join(t.music, "second.wav");
  await Bun.write(first, wavBytes({ seconds: 1, tags: { title: "First", artist: "A" } }));
  await Bun.write(second, wavBytes({ seconds: 1 }));
});

afterAll(() => t.close());

const open = async (audioPath: string) => (await t.api("/api/drafts", { method: "POST", json: { audioPath } })).json() as Promise<Draft>;

describe("draft summaries", () => {
  test("GET /api/drafts lists summaries, most recently updated first", async () => {
    const a = await open(first);
    await Bun.sleep(2);
    const b = await open(second);
    // Out-of-order lines make a flag; dismissing it takes it out of the count.
    const doc = { ...b.doc, lines: [{ timestamp: 2000, text: "Later" }, { timestamp: 1000, text: "Earlier" }] };
    await t.api(`/api/drafts/${b.id}`, { method: "PUT", json: { ...b, doc } });

    const summaries = (await (await t.api("/api/drafts")).json()) as DraftSummary[];
    expect(summaries.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(summaries[1]).toMatchObject({ id: a.id, audioPath: first, title: "First", artist: "A", step: "lyrics" });
    expect(summaries[0]).toMatchObject({ title: "second", artist: null });

    const flags = findFlags(doc);
    const expected = draftProgress(doc, { published: false, openFlags: flags.length });
    expect(summaries[0]).toMatchObject({ stepsDone: expected.stepsDone, status: expected.status });

    await t.api(`/api/drafts/${b.id}`, { method: "PUT", json: { ...b, doc, dismissedFlags: flags.map((f) => f.id) } });
    const dismissed = draftProgress(doc, { published: false, openFlags: 0 });
    const [top] = (await (await t.api("/api/drafts")).json()) as DraftSummary[];
    expect(top).toMatchObject({ stepsDone: dismissed.stepsDone, status: dismissed.status });
  });

  test("GET /api/track includes the draft summary", async () => {
    const info = (await (await t.api(`/api/track${q({ path: first })}`)).json()) as TrackInfo;
    expect(info.draft).toMatchObject({ audioPath: first, title: "First", audioMissing: false });
  });

  test("summaries flag drafts whose audio file is gone", async () => {
    const before = (await (await t.api("/api/drafts")).json()) as DraftSummary[];
    expect(before.map((s) => s.audioMissing)).toEqual([false, false]);
    await rm(second);
    const after = (await (await t.api("/api/drafts")).json()) as DraftSummary[];
    expect(Object.fromEntries(after.map((s) => [s.audioPath, s.audioMissing]))).toEqual({ [first]: false, [second]: true });
  });
});
