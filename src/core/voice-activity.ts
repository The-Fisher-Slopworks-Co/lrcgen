// Finding where singing starts in a separated vocal stem.

/** RMS energy per frame of `frameMs`, normalised so the loudest frame is 1. */
export function energyEnvelope(samples: Float32Array, sampleRate: number, frameMs: number = 10): Float32Array {
  const frameSize = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const envelope = new Float32Array(Math.ceil(samples.length / frameSize));
  let max = 0;
  for (let f = 0; f < envelope.length; f++) {
    const from = f * frameSize;
    const to = Math.min(from + frameSize, samples.length);
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
    const rms = Math.sqrt(sum / (to - from));
    envelope[f] = rms;
    if (rms > max) max = rms;
  }
  if (max > 0) for (let f = 0; f < envelope.length; f++) envelope[f]! /= max;
  return envelope;
}

export interface OnsetOptions {
  /** Frames below this (0–1) count as silence. */
  threshold?: number;
  /** How far after `ms` to look for the voice coming in. */
  windowMs?: number;
  /** A voice coming in closer than this after `ms` counts as on time: taps are never that precise. */
  minGapMs?: number;
}

/**
 * If the envelope is silent at `ms` and the voice comes in within the window after it, the time it comes in;
 * otherwise null. This is `FlagOptions.voiceOnsetAfter`.
 */
export function voiceOnsetAfter(envelope: Float32Array, frameMs: number, ms: number, options: OnsetOptions = {}): number | null {
  const { threshold = 0.08, windowMs = 400, minGapMs = 50 } = options;
  const frame = Math.floor(ms / frameMs);
  if (frame < 0 || frame >= envelope.length || envelope[frame]! >= threshold) return null;
  const last = Math.min(envelope.length - 1, frame + Math.ceil(windowMs / frameMs));
  for (let f = frame + 1; f <= last; f++) {
    if (envelope[f]! >= threshold) return f * frameMs - ms >= minGapMs ? f * frameMs : null;
  }
  return null;
}
