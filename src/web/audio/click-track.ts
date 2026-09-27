// The calibration click track: evenly spaced clicks rendered to a WAV. Calibrate plays it through a SongPlayer
// — the same <audio> path songs use — so the measured lag is exactly what taps on a song suffer.

export const CLICK_COUNT = 8;
export const CLICK_INTERVAL_MS = 600;
export const CLICK_LEAD_IN_MS = 1200;
const CLICK_LENGTH_MS = 40;

/** Click times in ms from the start of the track. */
export function clickTimes(count = CLICK_COUNT, intervalMs = CLICK_INTERVAL_MS, leadInMs = CLICK_LEAD_IN_MS): number[] {
  return Array.from({ length: count }, (_, i) => leadInMs + i * intervalMs);
}

/** Short decaying 1.5 kHz blips at `clicksMs`; each starts at full level on its exact sample. */
export function renderClicks(clicksMs: number[], durationMs: number, sampleRate = 44100): Float32Array {
  const out = new Float32Array(Math.ceil((durationMs / 1000) * sampleRate));
  const len = Math.round((CLICK_LENGTH_MS / 1000) * sampleRate);
  for (const t of clicksMs) {
    const start = Math.round((t / 1000) * sampleRate);
    for (let i = 0; i < len && start + i < out.length; i++) {
      const s = i / sampleRate;
      out[start + i] = 0.8 * Math.exp(-s / 0.006) * Math.cos(2 * Math.PI * 1500 * s);
    }
  }
  return out;
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** The whole track: click times and the WAV bytes. */
export function clickTrack(): { clicksMs: number[]; durationMs: number; wav: ArrayBuffer } {
  const clicksMs = clickTimes();
  const durationMs = clicksMs[clicksMs.length - 1]! + 1500;
  return { clicksMs, durationMs, wav: encodeWav(renderClicks(clicksMs, durationMs), 44100) };
}
