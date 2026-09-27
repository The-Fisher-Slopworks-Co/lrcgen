// Spectrogram tiles for the Refine lane: each tile is TILE_COLS columns at one (quantised) zoom level,
// rendered to a small canvas once and kept. Missing tiles are computed one per event-loop turn, visible
// ones first, so scrolling never blocks the UI.

import { loudestPeak, yieldToEventLoop, type AudioData } from "../../audio/analysis";
import { Fft, FFT_SIZE, logBandEdges, referenceDb, spectrogramColumns } from "./spectrogram";

export const TILE_COLS = 128;
export const ROWS = 128;
const CACHE_LIMIT = 160;

export interface TileRequest {
  msPerCol: number;
  index: number;
}

export class SpectrogramCache {
  private readonly tiles = new Map<string, HTMLCanvasElement>();
  private queue: TileRequest[] = [];
  private running = false;
  private disposed = false;
  private readonly fft = new Fft(FFT_SIZE);
  private readonly edges: Float32Array;
  private readonly refDb: number;
  /** Called after a tile is ready (to redraw). */
  onReady: (() => void) | null = null;

  constructor(
    private readonly data: AudioData,
    private readonly lut: Uint8ClampedArray,
  ) {
    this.edges = logBandEdges(ROWS, data.sampleRate, FFT_SIZE);
    this.refDb = referenceDb(FFT_SIZE, loudestPeak(data));
  }

  /** The tile if it's ready. */
  get(req: TileRequest): HTMLCanvasElement | null {
    const hit = this.tiles.get(key(req));
    if (hit) {
      // Most recently used goes last.
      this.tiles.delete(key(req));
      this.tiles.set(key(req), hit);
    }
    return hit ?? null;
  }

  /** Replaces the queue with the tiles in `wanted` that aren't ready yet. */
  request(wanted: TileRequest[]): void {
    this.queue = wanted.filter((r) => !this.tiles.has(key(r)));
    if (this.queue.length > 0 && !this.running) void this.run();
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    this.tiles.clear();
    this.onReady = null;
  }

  private async run(): Promise<void> {
    this.running = true;
    while (this.queue.length > 0 && !this.disposed) {
      const req = this.queue.shift()!;
      if (!this.tiles.has(key(req))) {
        this.tiles.set(key(req), this.render(req));
        while (this.tiles.size > CACHE_LIMIT) this.tiles.delete(this.tiles.keys().next().value!);
        this.onReady?.();
      }
      await yieldToEventLoop();
    }
    this.running = false;
  }

  private render({ msPerCol, index }: TileRequest): HTMLCanvasElement {
    const { samples, sampleRate } = this.data;
    const startMs = index * TILE_COLS * msPerCol;
    const levels = spectrogramColumns(samples, sampleRate, startMs, msPerCol, TILE_COLS, this.edges, this.refDb, this.fft);
    const canvas = document.createElement("canvas");
    canvas.width = TILE_COLS;
    canvas.height = ROWS;
    const g = canvas.getContext("2d")!;
    const img = g.createImageData(TILE_COLS, ROWS);
    for (let i = 0; i < levels.length; i++) {
      const v = levels[i]!;
      const c = Math.round(v * 255) * 3;
      img.data[i * 4] = this.lut[c]!;
      img.data[i * 4 + 1] = this.lut[c + 1]!;
      img.data[i * 4 + 2] = this.lut[c + 2]!;
      // Quiet parts stay see-through so the lane's own background shows.
      img.data[i * 4 + 3] = Math.round(Math.min(1, v * 2.2) * 255);
    }
    g.putImageData(img, 0, 0);
    return canvas;
  }
}

function key({ msPerCol, index }: TileRequest): string {
  return `${msPerCol}|${index}`;
}
