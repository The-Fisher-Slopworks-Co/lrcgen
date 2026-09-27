import { describe, expect, test } from "bun:test";
import { Autosaver, type SaveStatus, type Timers } from "./autosave";

class FakeTimers implements Timers {
  now = 0;
  private queue: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.queue.push({ at: this.now + ms, fn, id });
    return id;
  }
  clearTimeout(id: unknown) {
    this.queue = this.queue.filter((t) => t.id !== id);
  }
  async advance(ms: number) {
    const until = this.now + ms;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at);
      const next = this.queue[0];
      if (!next || next.at > until) break;
      this.queue.shift();
      this.now = next.at;
      next.fn();
      await flushMicrotasks();
    }
    this.now = until;
  }
}

const flushMicrotasks = () => new Promise<void>((r) => setImmediate(r));

function setup(saveImpl: (v: number) => Promise<void>) {
  const timers = new FakeTimers();
  const saved: number[] = [];
  const statuses: SaveStatus[] = [];
  const saver = new Autosaver<number>({
    save: async (v) => {
      await saveImpl(v);
      saved.push(v);
    },
    onStatus: (s) => statuses.push(s),
    delayMs: 800,
    retryDelaysMs: [2000, 5000],
    timers,
  });
  return { timers, saved, statuses, saver };
}

describe("Autosaver", () => {
  test("saves the latest value once changes settle", async () => {
    const { timers, saved, statuses, saver } = setup(async () => {});
    saver.schedule(1);
    await timers.advance(500);
    saver.schedule(2);
    await timers.advance(500);
    expect(saved).toEqual([]);
    await timers.advance(400);
    expect(saved).toEqual([2]);
    expect(statuses.at(-1)).toBe("saved");
    expect(saver.dirty).toBe(false);
  });

  test("retries a failed save with backoff", async () => {
    let fail = 2;
    const { timers, saved, statuses, saver } = setup(async () => {
      if (fail-- > 0) throw new Error("offline");
    });
    saver.schedule(7);
    await timers.advance(800);
    expect(statuses.at(-1)).toBe("error");
    await timers.advance(2000);
    expect(statuses.at(-1)).toBe("error");
    expect(saved).toEqual([]);
    await timers.advance(5000);
    expect(saved).toEqual([7]);
    expect(statuses.at(-1)).toBe("saved");
  });

  test("a change made during a save is saved after it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const { timers, saved, saver } = setup(async () => {
      if (first) {
        first = false;
        await gate;
      }
    });
    saver.schedule(1);
    await timers.advance(800);
    saver.schedule(2);
    await timers.advance(800);
    expect(saved).toEqual([]);
    release();
    await flushMicrotasks();
    expect(saved).toEqual([1]);
    await timers.advance(800);
    expect(saved).toEqual([1, 2]);
  });

  test("flush saves right away", async () => {
    const { saved, saver } = setup(async () => {});
    saver.schedule(3);
    await saver.flush();
    expect(saved).toEqual([3]);
  });
});
