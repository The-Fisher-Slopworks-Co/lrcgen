import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import type { JobEvent, JobState, Transcript } from "../shared/api";
import type { Transcriber, TranscribeOptions, TranscribeResult } from "../ports/transcriber";
import { draftIdFor } from "./audio-files";
import { q, startTestApp, wavBytes, type TestApp } from "./test-helpers";

interface Pending {
  options: TranscribeOptions;
  resolve: (result: TranscribeResult) => void;
}

class FakeTranscriber implements Transcriber {
  name = "fake";
  pending: Pending[] = [];
  private waiters: ((p: Pending) => void)[] = [];

  async isAvailable() {
    return true;
  }

  transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
    return new Promise((resolve) => {
      options.signal?.addEventListener("abort", () => resolve({ success: false, error: "Cancelled" }));
      const pending = { options, resolve };
      const waiter = this.waiters.shift();
      if (waiter) waiter(pending);
      else this.pending.push(pending);
    });
  }

  /** The next call to transcribe(). */
  next(): Promise<Pending> {
    const ready = this.pending.shift();
    return ready ? Promise.resolve(ready) : new Promise((resolve) => this.waiters.push(resolve));
  }
}

/** Reads SSE `data:` events until the server closes the stream. */
async function readEvents(res: Response, onEvent?: (e: JobEvent) => void): Promise<{ events: JobEvent[]; comments: number }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: JobEvent[] = [];
  let comments = 0;
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (block.startsWith(":")) comments++;
      else if (block.startsWith("data: ")) {
        const event = JSON.parse(block.slice(6)) as JobEvent;
        events.push(event);
        onEvent?.(event);
      }
    }
  }
  return { events, comments };
}

let t: TestApp;
let fake: FakeTranscriber;
let song: string;
let other: string;

beforeAll(async () => {
  fake = new FakeTranscriber();
  t = await startTestApp({ registry: { transcriber: fake }, env: { OPENROUTER_API_KEY: "k" } });
  song = path.join(t.music, "song.wav");
  other = path.join(t.music, "other.wav");
  await Bun.write(song, wavBytes({ seconds: 1 }));
  await Bun.write(other, wavBytes({ seconds: 1 }));
});

afterAll(() => t.close());

const start = async (kind: string, audioPath: string, lyrics?: string) =>
  (await (await t.api("/api/jobs", { method: "POST", json: { kind, audioPath, lyrics } })).json()) as JobState;

describe("jobs", () => {
  test("transcribe: progress streams over SSE, the result lands in the transcripts", async () => {
    const job = await start("transcribe", song);
    expect(job).toMatchObject({ kind: "transcribe", audioPath: song, draftId: draftIdFor(song), status: "running", stage: "init", firstRun: true });

    // A second start for the same track returns the running job.
    expect((await start("transcribe", song)).id).toBe(job.id);

    const call = await fake.next();
    expect(call.options).toMatchObject({
      audioPath: song,
      separateOnly: false,
      vocalsPath: path.join(t.dirs.cacheDir, "stems", draftIdFor(song), "vocals.flac"),
    });
    expect(call.options.settings.apiKey).toBe("k");

    const res = await t.api(`/api/jobs/${job.id}/events`);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reading = readEvents(res);
    await Bun.sleep(120); // long enough for a heartbeat
    call.options.onProgress?.({ stage: "demucs", message: "separating", progress: 0.5 });
    call.options.onProgress?.({ stage: "align", message: "aligning" });
    call.resolve({ success: true, lines: [{ timestamp: 1000, text: "Hi" }], rawLyrics: "Hi" });

    const { events, comments } = await reading;
    expect(comments).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({ type: "state", job: { id: job.id, status: "running" } });
    expect(events).toContainEqual(expect.objectContaining({ type: "state", job: expect.objectContaining({ stage: "demucs", progress: 0.5 }) }));
    expect(events).toContainEqual(expect.objectContaining({ type: "state", job: expect.objectContaining({ stage: "align", progress: null }) }));
    const done = events.at(-1)!;
    expect(done).toMatchObject({ type: "done", job: { status: "done", error: null } });
    expect(done.job.finishedAt).toBeNumber();

    const transcript = (await (await t.api(`/api/transcripts/${draftIdFor(song)}`)).json()) as Transcript;
    expect(transcript).toMatchObject({ draftId: draftIdFor(song), lines: [{ timestamp: 1000, text: "Hi" }], rawLyrics: "Hi" });

    // Getting past "init" means the dependencies are installed.
    expect(await Bun.file(path.join(t.dirs.cacheDir, "deps-ready")).exists()).toBe(true);
    const second = await start("transcribe", other);
    expect(second.firstRun).toBe(false);
    (await fake.next()).resolve({ success: false, error: "boom" });
    await Bun.sleep(5);
    const listed = (await (await t.api(`/api/jobs${q({ audioPath: other })}`)).json()) as JobState[];
    expect(listed).toEqual([expect.objectContaining({ id: second.id, status: "error", error: "boom" })]);
  });

  test("the event stream of a finished job is its final state", async () => {
    const [finished] = (await (await t.api(`/api/jobs${q({ audioPath: song })}`)).json()) as JobState[];
    const { events } = await readEvents(await t.api(`/api/jobs/${finished!.id}/events`));
    expect(events.map((e) => e.type)).toEqual(["state", "done"]);
    expect(events[1]!.job.status).toBe("done");
  });

  test("cancel stops a running job", async () => {
    const job = await start("separate", song);
    const call = await fake.next();
    expect(call.options.separateOnly).toBe(true);

    const reading = readEvents(await t.api(`/api/jobs/${job.id}/events`));
    const cancelled = (await (await t.api(`/api/jobs/${job.id}`, { method: "DELETE" })).json()) as JobState;
    expect(cancelled.status).toBe("cancelled");
    expect(call.options.signal?.aborted).toBe(true);
    const { events } = await reading;
    expect(events.at(-1)).toMatchObject({ type: "done", job: { status: "cancelled" } });
  });

  test("align syncs the given lyrics and returns the lines on the job, leaving the transcript alone", async () => {
    const before = await (await t.api(`/api/transcripts/${draftIdFor(song)}`)).json();
    const job = await start("align", song, "One\nTwo");
    expect(job).toMatchObject({ kind: "align", status: "running", lines: null });
    const call = await fake.next();
    expect(call.options).toMatchObject({ separateOnly: false, lyrics: "One\nTwo" });
    const lines = [{ timestamp: 500, text: "One" }, { timestamp: 1500, text: "Two" }];
    call.resolve({ success: true, lines, rawLyrics: "One\nTwo" });
    await Bun.sleep(5);
    const [state] = (await (await t.api(`/api/jobs${q({ audioPath: song })}`)).json()) as JobState[];
    expect(state).toMatchObject({ id: job.id, status: "done", lines });
    expect(await (await t.api(`/api/transcripts/${draftIdFor(song)}`)).json()).toEqual(before);
  });

  test("separate finishes at once when the stem is cached", async () => {
    await Bun.write(path.join(t.dirs.cacheDir, "stems", draftIdFor(other), "vocals.flac"), "stem");
    const job = await start("separate", other);
    await Bun.sleep(5);
    const [state] = (await (await t.api(`/api/jobs${q({ audioPath: other })}`)).json()) as JobState[];
    expect(state).toMatchObject({ id: job.id, status: "done", progress: 1 });
    expect(fake.pending).toEqual([]);
  });

  test("validates requests", async () => {
    expect((await t.api("/api/jobs", { method: "POST", json: { kind: "dance", audioPath: song } })).status).toBe(400);
    expect((await t.api("/api/jobs", { method: "POST", json: { kind: "align", audioPath: song } })).status).toBe(400);
    expect((await t.api("/api/jobs", { method: "POST", json: { kind: "align", audioPath: song, lyrics: "  " } })).status).toBe(400);
    expect((await t.api("/api/jobs", { method: "POST", json: { kind: "separate", audioPath: path.join(t.music, "x.wav") } })).status).toBe(404);
    expect((await t.api("/api/jobs/nope/events")).status).toBe(404);
    expect((await t.api("/api/jobs/nope", { method: "DELETE" })).status).toBe(404);
    expect((await t.api("/api/transcripts/0123456789abcdef")).status).toBe(404);
  });
});
