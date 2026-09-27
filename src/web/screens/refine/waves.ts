// Bar heights for the Refine waveform lanes, read straight from the samples (the view is at most ~30 s),
// and which bars are voiced according to the vocal energy envelope.

/** RMS of `bars` equal slices of `fromMs`–`toMs`; slices outside the signal are 0. Long slices are sampled. */
export function barLevels(samples: Float32Array, sampleRate: number, bars: number, fromMs: number, toMs: number): Float32Array {
  const out = new Float32Array(Math.max(0, bars));
  if (bars <= 0 || toMs <= fromMs) return out;
  const perBar = (((toMs - fromMs) / 1000) * sampleRate) / bars;
  const s0 = (fromMs / 1000) * sampleRate;
  const stride = Math.max(1, Math.floor(perBar / 256));
  for (let b = 0; b < bars; b++) {
    const a = Math.max(0, Math.floor(s0 + b * perBar));
    const z = Math.min(samples.length, Math.floor(s0 + (b + 1) * perBar));
    let sq = 0;
    let n = 0;
    for (let i = a; i < z; i += stride) {
      sq += samples[i]! * samples[i]!;
      n++;
    }
    out[b] = n > 0 ? Math.sqrt(sq / n) : 0;
  }
  return out;
}

/** Whether each bar's slice reaches `threshold` in the envelope (frames of `frameMs`). */
export function voicedBars(envelope: Float32Array, frameMs: number, bars: number, fromMs: number, toMs: number, threshold = 0.08): boolean[] {
  const out: boolean[] = [];
  const per = (toMs - fromMs) / Math.max(1, bars);
  for (let b = 0; b < bars; b++) {
    const f0 = Math.max(0, Math.floor((fromMs + b * per) / frameMs));
    const f1 = Math.min(envelope.length, Math.ceil((fromMs + (b + 1) * per) / frameMs));
    let voiced = false;
    for (let f = f0; f < f1 && !voiced; f++) voiced = envelope[f]! >= threshold;
    out.push(voiced);
  }
  return out;
}

/** A loudness to scale bars against: the loudest 50 ms RMS in the song. */
export function loudestLevel(samples: Float32Array, sampleRate: number): number {
  const win = Math.max(1, Math.round(sampleRate * 0.05));
  let best = 0;
  for (let a = 0; a < samples.length; a += win) {
    const z = Math.min(samples.length, a + win);
    let sq = 0;
    for (let i = a; i < z; i += 4) sq += samples[i]! * samples[i]!;
    const rms = Math.sqrt(sq / Math.ceil((z - a) / 4));
    if (rms > best) best = rms;
  }
  return best;
}
