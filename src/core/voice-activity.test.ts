import { test, expect, describe } from "bun:test";
import { energyEnvelope, voiceOnsetAfter } from "./voice-activity";

describe("energyEnvelope", () => {
  test("RMS per frame, the loudest frame is 1", () => {
    // 1000 Hz, 10 ms frames of 10 samples: silence, a quiet frame, a loud frame, a short tail.
    const samples = new Float32Array(35);
    samples.fill(0.25, 10, 20);
    samples.fill(-0.5, 20, 30);
    samples.fill(0.5, 30, 35);
    const envelope = energyEnvelope(samples, 1000, 10);
    expect(Array.from(envelope)).toEqual([0, 0.5, 1, 1]);
  });

  test("silent or empty input gives zeros", () => {
    expect(Array.from(energyEnvelope(new Float32Array(30), 1000, 10))).toEqual([0, 0, 0]);
    expect(energyEnvelope(new Float32Array(0), 44100)).toHaveLength(0);
  });

  test("defaults to 10 ms frames", () => {
    expect(energyEnvelope(new Float32Array(44100), 44100)).toHaveLength(100);
  });
});

describe("voiceOnsetAfter", () => {
  // 10 ms frames: silent until 100 ms, voiced from 100 ms to 200 ms, silent after.
  const envelope = new Float32Array(100);
  envelope.fill(0.02, 0, 10);
  envelope.fill(0.6, 10, 20);

  test("finds where the voice comes in after a silent moment", () => {
    expect(voiceOnsetAfter(envelope, 10, 20)).toBe(100);
    expect(voiceOnsetAfter(envelope, 10, 50)).toBe(100);
  });

  test("a voice coming in less than 50 ms later counts as on time", () => {
    expect(voiceOnsetAfter(envelope, 10, 51)).toBeNull();
    expect(voiceOnsetAfter(envelope, 10, 95)).toBeNull();
    expect(voiceOnsetAfter(envelope, 10, 95, { minGapMs: 0 })).toBe(100);
  });

  test("null when the moment is already voiced", () => {
    expect(voiceOnsetAfter(envelope, 10, 100)).toBeNull();
    expect(voiceOnsetAfter(envelope, 10, 150)).toBeNull();
  });

  test("null when nothing comes in within the window", () => {
    expect(voiceOnsetAfter(envelope, 10, 250)).toBeNull();
    expect(voiceOnsetAfter(envelope, 10, 20, { windowMs: 50 })).toBeNull();
  });

  test("respects the threshold", () => {
    expect(voiceOnsetAfter(envelope, 10, 20, { threshold: 0.7 })).toBeNull();
    expect(voiceOnsetAfter(envelope, 10, 20, { threshold: 0.01 })).toBeNull();
  });

  test("null outside the envelope", () => {
    expect(voiceOnsetAfter(envelope, 10, -50)).toBeNull();
    expect(voiceOnsetAfter(envelope, 10, 5000)).toBeNull();
  });
});
