// Decoded audio as mono samples, plus min/max peaks for drawing waveforms at any zoom.
// Pure (no DOM): the long loops yield to the event loop between chunks so a 5-minute song doesn't freeze the UI.

export interface PeakSummary {
  /** Samples per summary block. */
  blockSize: number;
  min: Float32Array;
  max: Float32Array;
  /** Sum of squared samples per block, for RMS levels. */
  sumSq: Float32Array;
}

export interface AudioData {
  /** Mono, −1…1. */
  samples: Float32Array;
  sampleRate: number;
  durationMs: number;
  summary: PeakSummary;
}

export interface Peaks {
  /** Per bucket, −1…1. */
  min: Float32Array;
  max: Float32Array;
}

const CHUNK = 1 << 20;
export const SUMMARY_BLOCK = 256;

export type Yield = () => Promise<void>;
export const yieldToEventLoop: Yield = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Averages the channels into one. */
export async function downmix(channels: Float32Array[], pause: Yield = yieldToEventLoop): Promise<Float32Array> {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;
  const out = new Float32Array(first.length);
  const scale = 1 / channels.length;
  for (let start = 0; start < out.length; start += CHUNK) {
    const end = Math.min(out.length, start + CHUNK);
    for (const ch of channels) for (let i = start; i < end; i++) out[i]! += ch[i]!;
    for (let i = start; i < end; i++) out[i]! *= scale;
    if (end < out.length) await pause();
  }
  return out;
}

export async function summarize(samples: Float32Array, blockSize = SUMMARY_BLOCK, pause: Yield = yieldToEventLoop): Promise<PeakSummary> {
  const blocks = Math.ceil(samples.length / blockSize);
  const min = new Float32Array(blocks);
  const max = new Float32Array(blocks);
  const sumSq = new Float32Array(blocks);
  const blocksPerChunk = Math.max(1, Math.floor(CHUNK / blockSize));
  for (let b0 = 0; b0 < blocks; b0 += blocksPerChunk) {
    const b1 = Math.min(blocks, b0 + blocksPerChunk);
    for (let b = b0; b < b1; b++) {
      let lo = 0;
      let hi = 0;
      let sq = 0;
      const end = Math.min(samples.length, (b + 1) * blockSize);
      for (let i = b * blockSize; i < end; i++) {
        const v = samples[i]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        sq += v * v;
      }
      min[b] = lo;
      max[b] = hi;
      sumSq[b] = sq;
    }
    if (b1 < blocks) await pause();
  }
  return { blockSize, min, max, sumSq };
}

export async function toAudioData(channels: Float32Array[], sampleRate: number, pause: Yield = yieldToEventLoop): Promise<AudioData> {
  const samples = await downmix(channels, pause);
  const summary = await summarize(samples, SUMMARY_BLOCK, pause);
  return { samples, sampleRate, durationMs: (samples.length / sampleRate) * 1000, summary };
}

/**
 * Min/max of the samples in `buckets` equal slices of `fromMs`–`toMs` (the whole song by default).
 * Wide slices read the precomputed summary; narrow ones (zoomed in) read the samples.
 */
export function peaks(data: AudioData, buckets: number, fromMs = 0, toMs = data.durationMs): Peaks {
  const n = Math.max(0, Math.floor(buckets));
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  if (n === 0 || toMs <= fromMs) return { min, max };
  const { samples, sampleRate, summary } = data;
  const s0 = (fromMs / 1000) * sampleRate;
  const perBucket = (((toMs - fromMs) / 1000) * sampleRate) / n;
  const useSummary = perBucket >= summary.blockSize * 2;
  for (let b = 0; b < n; b++) {
    const a = Math.max(0, Math.floor(s0 + b * perBucket));
    const z = Math.min(samples.length, Math.max(a + 1, Math.floor(s0 + (b + 1) * perBucket)));
    if (a >= samples.length) break;
    let lo = 0;
    let hi = 0;
    if (useSummary) {
      const k0 = Math.floor(a / summary.blockSize);
      const k1 = Math.min(summary.min.length, Math.ceil(z / summary.blockSize));
      for (let k = k0; k < k1; k++) {
        if (summary.min[k]! < lo) lo = summary.min[k]!;
        if (summary.max[k]! > hi) hi = summary.max[k]!;
      }
    } else {
      for (let i = a; i < z; i++) {
        const v = samples[i]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max };
}

/**
 * RMS level of each of `buckets` equal slices of `fromMs`–`toMs`, at summary-block resolution. Loudness
 * varies far more in RMS than in peaks (mastered music peaks near full scale everywhere), so overviews
 * draw these.
 */
export function levels(data: AudioData, buckets: number, fromMs = 0, toMs = data.durationMs): Float32Array {
  const n = Math.max(0, Math.floor(buckets));
  const out = new Float32Array(n);
  if (n === 0 || toMs <= fromMs) return out;
  const { summary, sampleRate } = data;
  const k0 = ((fromMs / 1000) * sampleRate) / summary.blockSize;
  const perBucket = (((toMs - fromMs) / 1000) * sampleRate) / summary.blockSize / n;
  for (let b = 0; b < n; b++) {
    const a = Math.max(0, Math.floor(k0 + b * perBucket));
    const z = Math.min(summary.sumSq.length, Math.max(a + 1, Math.floor(k0 + (b + 1) * perBucket)));
    if (a >= summary.sumSq.length) break;
    let sq = 0;
    for (let k = a; k < z; k++) sq += summary.sumSq[k]!;
    out[b] = Math.sqrt(sq / ((z - a) * summary.blockSize));
  }
  return out;
}

/** The largest value in `values` (e.g. to normalise `levels`), or 0. */
export function maxOf(values: Float32Array): number {
  let m = 0;
  for (const v of values) if (v > m) m = v;
  return m;
}

/** The largest absolute peak, for normalising a waveform's height. */
export function loudestPeak(data: AudioData): number {
  let m = 0;
  const { min, max } = data.summary;
  for (let i = 0; i < min.length; i++) m = Math.max(m, -min[i]!, max[i]!);
  return m;
}
