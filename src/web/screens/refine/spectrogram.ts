// Spectrogram maths for the Refine lane (pure, no DOM): a radix-2 FFT with a Hann window, log-spaced
// frequency rows, dB columns for a stretch of samples, and the colour ramp. Tiles of columns are computed
// on demand and cached by the lane (see SpectrogramCache).

export const FFT_SIZE = 1024;
export const F_MIN = 80;
export const F_MAX = 11000;
/** dB below the reference that maps to the darkest colour. */
export const RANGE_DB = 62;

export class Fft {
  readonly size: number;
  private readonly bits: number;
  private readonly window: Float32Array;
  private readonly rev: Uint32Array;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;

  constructor(size = FFT_SIZE) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error("FFT size must be a power of two");
    this.size = size;
    this.bits = Math.log2(size);
    this.window = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
    this.rev = Uint32Array.from({ length: size }, (_, i) => {
      let r = 0;
      for (let b = 0; b < this.bits; b++) r |= ((i >> b) & 1) << (this.bits - 1 - b);
      return r;
    });
    this.cos = Float32Array.from({ length: size / 2 }, (_, i) => Math.cos((-2 * Math.PI * i) / size));
    this.sin = Float32Array.from({ length: size / 2 }, (_, i) => Math.sin((-2 * Math.PI * i) / size));
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
  }

  /** Magnitudes of the windowed frame centred on sample `center` (zero outside the signal) into `out` (size/2). */
  magnitudes(samples: Float32Array, center: number, out: Float32Array): void {
    const n = this.size;
    const { re, im, rev, window } = this;
    const s0 = center - n / 2;
    for (let i = 0; i < n; i++) {
      const j = s0 + i;
      const r = rev[i]!;
      re[r] = j >= 0 && j < samples.length ? samples[j]! * window[i]! : 0;
      im[r] = 0;
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const c = this.cos[k * step]!;
          const s = this.sin[k * step]!;
          const a = i + k;
          const b = a + half;
          const tr = re[b]! * c - im[b]! * s;
          const ti = re[b]! * s + im[b]! * c;
          re[b] = re[a]! - tr;
          im[b] = im[a]! - ti;
          re[a] = re[a]! + tr;
          im[a] = im[a]! + ti;
        }
      }
    }
    for (let k = 0; k < n / 2; k++) out[k] = Math.sqrt(re[k]! * re[k]! + im[k]! * im[k]!);
  }
}

/**
 * FFT bin edges of `rows` log-spaced frequency bands from `fMax` (row 0, the top) down to `fMin`:
 * row `y` covers bins [edges[y + 1], edges[y]).
 */
export function logBandEdges(rows: number, sampleRate: number, fftSize = FFT_SIZE, fMin = F_MIN, fMax = F_MAX): Float32Array {
  const top = Math.min(fMax, sampleRate / 2);
  const binHz = sampleRate / fftSize;
  return Float32Array.from({ length: rows + 1 }, (_, y) => (fMin * Math.pow(top / fMin, 1 - y / rows)) / binHz);
}

/** The dB a full-scale sine reaches with this FFT (Hann window), scaled by the source's loudest peak. */
export function referenceDb(fftSize: number, peak: number): number {
  return 20 * Math.log10((fftSize / 4) * Math.max(1e-4, peak));
}

/**
 * Levels (0–1, row-major, row 0 = highest band) for `cols` columns starting at `startMs`, one every `msPerCol`.
 * Each column is the FFT of the frame centred on that column's middle.
 */
export function spectrogramColumns(
  samples: Float32Array,
  sampleRate: number,
  startMs: number,
  msPerCol: number,
  cols: number,
  edges: Float32Array,
  refDb: number,
  fft: Fft,
): Float32Array {
  const rows = edges.length - 1;
  const half = fft.size / 2;
  const mag = new Float32Array(half);
  const out = new Float32Array(rows * cols);
  for (let x = 0; x < cols; x++) {
    const center = Math.round(((startMs + (x + 0.5) * msPerCol) / 1000) * sampleRate);
    if (center + half < 0 || center - half >= samples.length) continue;
    fft.magnitudes(samples, center, mag);
    for (let y = 0; y < rows; y++) {
      const b0 = Math.floor(edges[y + 1]!);
      const b1 = Math.max(b0 + 1, Math.ceil(edges[y]!));
      let m = 0;
      for (let b = b0; b < b1 && b < half; b++) if (mag[b]! > m) m = mag[b]!;
      const db = 20 * Math.log10(m + 1e-9);
      out[y * cols + x] = Math.min(1, Math.max(0, (db - (refDb - RANGE_DB)) / RANGE_DB));
    }
  }
  return out;
}

/** Column widths come in steps of √2 so nearby zoom levels share cached tiles. */
export function quantizeMsPerCol(msPerCol: number): number {
  const k = Math.round(2 * Math.log2(Math.max(0.25, msPerCol)));
  return Math.pow(2, k / 2);
}

/** Indices of the tiles (of `tileCols` columns each) that cover `fromMs`–`toMs`. */
export function tilesFor(fromMs: number, toMs: number, msPerCol: number, tileCols: number): number[] {
  const tileMs = msPerCol * tileCols;
  const first = Math.floor(Math.max(0, fromMs) / tileMs);
  const last = Math.floor(Math.max(0, toMs) / tileMs);
  const out: number[] = [];
  for (let i = first; i <= last; i++) out.push(i);
  return out;
}

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A 256-entry RGB lookup table interpolating the stops (positions 0–1, ascending). */
export function colorRamp(stops: [number, Rgb][]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const u = i / 255;
    let k = stops.findIndex(([s]) => s >= u);
    if (k <= 0) k = k === 0 ? 1 : stops.length - 1;
    const [s0, c0] = stops[k - 1]!;
    const [s1, c1] = stops[k]!;
    const f = s1 > s0 ? Math.min(1, Math.max(0, (u - s0) / (s1 - s0))) : 1;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(c0[c]! + (c1[c]! - c0[c]!) * f);
  }
  return lut;
}
