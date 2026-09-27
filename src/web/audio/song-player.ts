// Plays the open song in the browser: two <audio> elements, the mix and (when separated) the vocal stem,
// sample-aligned so "Vocals only" swaps between them at the same position. Pitch is preserved at 0.5×/0.75×.
//
// Positions are song time in ms. While playing, the position is interpolated per animation frame between
// the element's (coarse) `currentTime` updates.
//
// Latency convention: `latencyMs` is how late the user hears the audio (settings store +184 for a Bluetooth
// headset; the UI shows the correction as −184 ms). What the user hears right now, and where a tap lands, is
//   position − latencyMs × rate
// (`heardPosition()` / `tapPosition()`).

import type { AudioPlayer } from "../../ports/audio-player";

export type TrackKind = "mix" | "vocals";

export interface Range {
  from: number;
  to: number;
}

export interface PlayerState {
  /** Audio file path loaded, or null. */
  path: string | null;
  /** Metadata loaded: duration known, seeking works. */
  ready: boolean;
  durationMs: number;
  playing: boolean;
  rate: number;
  track: TrackKind;
  /** A vocal stem is loaded (so `setTrack("vocals")` works). */
  hasVocals: boolean;
  /** A–B loop: playback jumps back to `from` on reaching `to`. */
  loop: Range | null;
  /** End of the segment `playSegment` is playing, else null. */
  segmentEnd: number | null;
  latencyMs: number;
  error: string | null;
}

export interface LoadOptions {
  mixUrl: string;
  /** Null when there is no stem. */
  vocalsUrl: string | null;
  /** Used until the element reports the real duration. */
  durationMs?: number | null;
}

type PositionListener = (positionMs: number, heardMs: number) => void;

const JUMP_MS = 120;

export class SongPlayer implements AudioPlayer {
  private readonly els: Record<TrackKind, HTMLAudioElement>;
  private state: PlayerState = {
    path: null,
    ready: false,
    durationMs: 0,
    playing: false,
    rate: 1,
    track: "mix",
    hasVocals: false,
    loop: null,
    segmentEnd: null,
    latencyMs: 0,
    error: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly positionListeners = new Set<PositionListener>();
  /** Position when paused; while playing, the last value handed out (keeps it monotonic). */
  private pos = 0;
  /** Where the current run of playback started, so `heardPosition` never goes before it. */
  private runStart = 0;
  private anchor = { media: 0, perf: 0 };
  private lastRaw = -1;
  private frame = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.els = { mix: this.createElement("mix"), vocals: this.createElement("vocals") };
  }

  // ---------------------------------------------------------------- state

  getState(): PlayerState {
    return this.state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private patch(update: Partial<PlayerState>): void {
    this.state = { ...this.state, ...update };
    for (const l of [...this.listeners]) l();
  }

  // ---------------------------------------------------------------- loading

  load(path: string, options: LoadOptions): void {
    this.pause();
    this.pos = 0;
    this.lastRaw = -1;
    this.els.mix.src = options.mixUrl;
    this.els.mix.load();
    this.setVocalsUrl(options.vocalsUrl, false);
    this.patch({
      path,
      ready: false,
      durationMs: options.durationMs ?? 0,
      track: "mix",
      loop: null,
      segmentEnd: null,
      error: null,
    });
    this.emitPosition();
  }

  /** Swaps the vocal stem source (e.g. after separation, with a cache-busting URL). */
  setVocalsUrl(url: string | null, notify = true): void {
    const el = this.els.vocals;
    if (url) {
      el.src = url;
      el.load();
    } else {
      el.removeAttribute("src");
      el.load();
    }
    const update: Partial<PlayerState> = { hasVocals: url !== null };
    if (!url && this.state.track === "vocals") {
      const wasPlaying = this.state.playing;
      const p = this.getCurrentPosition();
      this.pause();
      update.track = "mix";
      this.els.mix.currentTime = p / 1000;
      if (wasPlaying) queueMicrotask(() => this.resume());
    }
    if (notify) this.patch(update);
    else this.state = { ...this.state, ...update };
  }

  unload(): void {
    this.pause();
    for (const el of Object.values(this.els)) {
      el.removeAttribute("src");
      el.load();
    }
    this.pos = 0;
    this.patch({ path: null, ready: false, durationMs: 0, hasVocals: false, track: "mix", loop: null, segmentEnd: null, error: null });
  }

  dispose(): void {
    this.unload();
    this.listeners.clear();
    this.positionListeners.clear();
  }

  // ---------------------------------------------------------------- transport

  get active(): HTMLAudioElement {
    return this.els[this.state.track];
  }

  play(fromMs?: number): void {
    if (!this.state.path) return;
    this.patch({ segmentEnd: null });
    this.start(fromMs ?? this.pos);
  }

  /** Plays `fromMs`–`toMs` once and stops exactly at `toMs` (loop is ignored meanwhile). */
  playSegment(fromMs: number, toMs: number): void {
    if (!this.state.path || toMs <= fromMs) return;
    this.patch({ segmentEnd: toMs });
    this.start(fromMs);
  }

  pause(): void {
    this.clearStopTimer();
    if (this.state.playing) this.pos = this.currentEstimate();
    for (const el of Object.values(this.els)) el.pause();
    cancelAnimationFrame(this.frame);
    if (this.state.playing || this.state.segmentEnd !== null) this.patch({ playing: false, segmentEnd: null });
    this.emitPosition();
  }

  resume(): void {
    this.play();
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  seek(ms: number): void {
    // A stop armed for the old position's segment/loop end must not fire after moving away from it.
    this.clearStopTimer();
    const target = this.clamp(ms);
    this.pos = target;
    this.runStart = target;
    this.active.currentTime = target / 1000;
    this.anchor = { media: target, perf: performance.now() };
    this.lastRaw = -1;
    this.emitPosition();
  }

  setSpeed(rate: number): void {
    const p = this.getCurrentPosition();
    for (const el of Object.values(this.els)) el.playbackRate = rate;
    this.anchor = { media: p, perf: performance.now() };
    this.patch({ rate });
  }

  /** Switches between the mix and the vocal stem at the current position. */
  setTrack(track: TrackKind): void {
    if (track === this.state.track) return;
    if (track === "vocals" && !this.state.hasVocals) return;
    const wasPlaying = this.state.playing;
    const segmentEnd = this.state.segmentEnd;
    const p = this.getCurrentPosition();
    this.active.pause();
    this.patch({ track });
    this.pos = p;
    this.active.currentTime = p / 1000;
    this.anchor = { media: p, perf: performance.now() };
    this.lastRaw = -1;
    if (wasPlaying) {
      void this.active.play().catch((err: unknown) => this.fail(err));
      if (segmentEnd !== null) this.patch({ segmentEnd });
    }
  }

  setLoop(loop: Range | null): void {
    this.patch({ loop: loop && loop.to > loop.from ? loop : null });
    if (loop && this.state.playing && this.state.segmentEnd === null) {
      const p = this.getCurrentPosition();
      if (p < loop.from || p >= loop.to) this.seek(loop.from);
    }
  }

  setLatency(ms: number): void {
    if (ms !== this.state.latencyMs) this.patch({ latencyMs: ms });
  }

  // ---------------------------------------------------------------- positions

  getCurrentPosition(): number {
    return this.state.playing ? this.currentEstimate() : this.pos;
  }

  getDuration(): number {
    return this.state.durationMs;
  }

  /** What the user hears right now (song ms): position minus the output latency, while playing. */
  heardPosition(): number {
    if (!this.state.playing) return this.pos;
    const p = this.currentEstimate();
    return Math.max(this.runStart, p - this.state.latencyMs * this.state.rate);
  }

  /** Where a tap made right now belongs in the song (latency-corrected). */
  tapPosition(): number {
    const p = this.getCurrentPosition();
    if (!this.state.playing) return p;
    return Math.max(0, Math.round(p - this.state.latencyMs * this.state.rate));
  }

  /** Called every animation frame while playing, and on seek/pause. */
  onPosition(callback: (ms: number) => void): () => void {
    const listener: PositionListener = (p) => callback(p);
    this.positionListeners.add(listener);
    return () => this.positionListeners.delete(listener);
  }

  /** Like `onPosition`, also passing the heard position. */
  onFrame(callback: PositionListener): () => void {
    this.positionListeners.add(callback);
    return () => this.positionListeners.delete(callback);
  }

  // ---------------------------------------------------------------- internals

  private createElement(kind: TrackKind): HTMLAudioElement {
    const el = new Audio();
    el.preload = "auto";
    el.preservesPitch = true;
    el.addEventListener("loadedmetadata", () => {
      if (kind !== "mix") return;
      const durationMs = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : this.state.durationMs;
      this.patch({ ready: true, durationMs });
    });
    el.addEventListener("error", () => {
      if (!el.getAttribute("src")) return;
      if (kind === "mix") this.patch({ error: "Couldn't load the audio file.", ready: false });
      else this.patch({ hasVocals: false, track: "mix" });
    });
    el.addEventListener("ended", () => {
      if (kind !== this.state.track) return;
      this.pos = this.state.durationMs;
      cancelAnimationFrame(this.frame);
      this.patch({ playing: false, segmentEnd: null });
      this.emitPosition();
    });
    // A backup tick for hidden tabs, where animation frames stop.
    el.addEventListener("timeupdate", () => {
      if (kind === this.state.track && this.state.playing && document.hidden) this.tick();
    });
    return el;
  }

  private start(fromMs: number): void {
    this.clearStopTimer();
    const loop = this.state.loop;
    let from = this.clamp(fromMs);
    if (loop && this.state.segmentEnd === null && (from < loop.from || from >= loop.to)) from = loop.from;
    if (from >= this.state.durationMs - 10 && this.state.durationMs > 0) from = 0;
    for (const el of Object.values(this.els)) if (el !== this.active) el.pause();
    const el = this.active;
    el.playbackRate = this.state.rate;
    el.currentTime = from / 1000;
    this.pos = from;
    this.runStart = from;
    this.anchor = { media: from, perf: performance.now() };
    this.lastRaw = -1;
    void el.play().catch((err: unknown) => this.fail(err));
    if (!this.state.playing) this.patch({ playing: true });
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.loopFrame);
  }

  private fail(err: unknown): void {
    // pause() interrupting play() is not an error.
    if (err instanceof DOMException && err.name === "AbortError") return;
    this.pos = this.currentEstimate();
    cancelAnimationFrame(this.frame);
    this.patch({ playing: false, segmentEnd: null, error: err instanceof Error ? err.message : String(err) });
  }

  private loopFrame = (): void => {
    if (!this.state.playing) return;
    this.tick();
    if (this.state.playing) this.frame = requestAnimationFrame(this.loopFrame);
  };

  private tick(): void {
    const p = this.currentEstimate();
    const end = this.state.segmentEnd ?? this.state.loop?.to ?? null;
    if (end !== null) {
      const remainingWallMs = (end - p) / this.state.rate;
      if (remainingWallMs <= 0) {
        this.reachEnd();
        return;
      }
      if (remainingWallMs < 40 && !this.stopTimer) this.stopTimer = setTimeout(() => this.reachEnd(), remainingWallMs);
    }
    this.pos = p;
    this.emitPosition();
  }

  private reachEnd(): void {
    this.clearStopTimer();
    if (!this.state.playing) return;
    const segmentEnd = this.state.segmentEnd;
    if (segmentEnd !== null) {
      for (const el of Object.values(this.els)) el.pause();
      cancelAnimationFrame(this.frame);
      this.pos = segmentEnd;
      this.active.currentTime = segmentEnd / 1000;
      this.patch({ playing: false, segmentEnd: null });
      this.emitPosition();
      return;
    }
    const loop = this.state.loop;
    if (loop) {
      this.active.currentTime = loop.from / 1000;
      this.pos = loop.from;
      this.runStart = loop.from;
      this.anchor = { media: loop.from, perf: performance.now() };
      this.lastRaw = -1;
      this.emitPosition();
    }
  }

  private clearStopTimer(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
  }

  /** Interpolated position: the element's time only moves in steps, so extrapolate from the last step. */
  private currentEstimate(): number {
    if (!this.state.playing) return this.pos;
    const now = performance.now();
    const raw = this.active.currentTime * 1000;
    if (raw !== this.lastRaw) {
      this.lastRaw = raw;
      this.anchor = { media: raw, perf: now };
    }
    let est = this.anchor.media + (now - this.anchor.perf) * this.state.rate;
    // Small backward corrections are jitter; hold still instead of jumping back. Big ones are seeks.
    if (est < this.pos && this.pos - est < JUMP_MS) est = this.pos;
    return this.clamp(est);
  }

  private clamp(ms: number): number {
    const max = this.state.durationMs > 0 ? this.state.durationMs : Number.MAX_SAFE_INTEGER;
    return Math.min(Math.max(0, ms), max);
  }

  private emitPosition(): void {
    const p = this.pos;
    const heard = this.heardPosition();
    for (const l of [...this.positionListeners]) l(p, heard);
  }
}
