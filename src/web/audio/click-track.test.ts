import { describe, expect, test } from "bun:test";
import { clickTimes, clickTrack, encodeWav, renderClicks } from "./click-track";

describe("click track", () => {
  test("eight evenly spaced clicks after a lead-in", () => {
    expect(clickTimes(3, 500, 1000)).toEqual([1000, 1500, 2000]);
    expect(clickTimes()).toHaveLength(8);
  });

  test("each click starts on its sample and the rest is silent", () => {
    const samples = renderClicks([100], 300, 1000);
    expect(samples[99]).toBe(0);
    expect(samples[100]).toBeCloseTo(0.8);
    expect(samples[250]).toBe(0);
  });

  test("WAV header describes 16-bit mono PCM", () => {
    const wav = new DataView(encodeWav(Float32Array.from([0, 1, -1]), 8000));
    const text = (o: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => wav.getUint8(o + i)));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(wav.getUint16(22, true)).toBe(1);
    expect(wav.getUint32(24, true)).toBe(8000);
    expect(wav.getUint32(40, true)).toBe(6);
    expect(wav.getInt16(46, true)).toBe(0x7fff);
    expect(wav.getInt16(48, true)).toBe(-0x8000);
  });

  test("the track lasts past the last click", () => {
    const t = clickTrack();
    expect(t.durationMs).toBeGreaterThan(t.clicksMs.at(-1)!);
    expect(t.wav.byteLength).toBe(44 + Math.ceil((t.durationMs / 1000) * 44100) * 2);
  });
});
