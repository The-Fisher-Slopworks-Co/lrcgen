import { describe, expect, test } from "bun:test";
import { downmix, levels, loudestPeak, maxOf, peaks, summarize, toAudioData } from "./analysis";

const noPause = async () => {};

describe("downmix", () => {
  test("averages channels", async () => {
    const out = await downmix([Float32Array.from([1, 0, -1]), Float32Array.from([0, 0, 1])], noPause);
    expect([...out]).toEqual([0.5, 0, 0]);
  });

  test("a single channel is returned as is", async () => {
    const ch = Float32Array.from([0.1, 0.2]);
    expect(await downmix([ch], noPause)).toBe(ch);
  });
});

describe("summarize", () => {
  test("min and max per block", async () => {
    const s = await summarize(Float32Array.from([0.1, -0.5, 0.3, 0.9, -0.2]), 2, noPause);
    expect([...s.min].map((v) => +v.toFixed(2))).toEqual([-0.5, 0, -0.2]);
    expect([...s.max].map((v) => +v.toFixed(2))).toEqual([0.1, 0.9, 0]);
  });
});

describe("peaks", () => {
  // One second at 1 kHz: silence, then a full-scale burst in the last quarter.
  const samples = new Float32Array(1000);
  for (let i = 750; i < 1000; i++) samples[i] = i % 2 === 0 ? 1 : -1;

  test("whole song in four buckets", async () => {
    const data = await toAudioData([samples], 1000, noPause);
    const p = peaks(data, 4);
    expect([...p.max]).toEqual([0, 0, 0, 1]);
    expect([...p.min]).toEqual([0, 0, 0, -1]);
    expect(loudestPeak(data)).toBe(1);
  });

  test("a zoomed-in range reads the samples", async () => {
    const data = await toAudioData([samples], 1000, noPause);
    const p = peaks(data, 10, 740, 760);
    expect([...p.max].slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect([...p.max].slice(5)).toEqual([1, 1, 1, 1, 1]);
  });

  test("ranges past the end stay silent", async () => {
    const data = await toAudioData([samples], 1000, noPause);
    const p = peaks(data, 2, 1000, 2000);
    expect([...p.max]).toEqual([0, 0]);
  });
});

describe("levels", () => {
  test("RMS per slice", async () => {
    const samples = new Float32Array(2048);
    for (let i = 1024; i < 2048; i++) samples[i] = i % 2 === 0 ? 0.5 : -0.5;
    const data = await toAudioData([samples], 1000, noPause);
    const l = levels(data, 2);
    expect(l[0]).toBe(0);
    expect(l[1]).toBeCloseTo(0.5);
    expect(maxOf(l)).toBeCloseTo(0.5);
  });
});
