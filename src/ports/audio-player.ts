export interface AudioPlayer {
  play(fromMs?: number): void;
  playSegment(fromMs: number, toMs: number): void;
  pause(): void;
  resume(): void;
  seek(ms: number): void;
  getCurrentPosition(): number;
  getDuration(): number;
  onPosition(callback: (ms: number) => void): () => void;
  /** Playback rate (1 = normal); positions stay in song time. Players that can't do it leave it out. */
  setSpeed?(rate: number): void;
  dispose(): void;
}
