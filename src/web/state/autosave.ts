// Debounced saving with retry. `schedule(value)` after every change; the latest value is saved once changes
// settle for `delayMs`. A failed save is retried with backoff until it succeeds or a newer value supersedes it.

export type SaveStatus = "saved" | "saving" | "error";

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface AutosaverOptions<T> {
  save: (value: T, options: { keepalive: boolean }) => Promise<void>;
  onStatus: (status: SaveStatus, error: string | null) => void;
  delayMs?: number;
  /** Waits between retries; the last one repeats. */
  retryDelaysMs?: number[];
  timers?: Timers;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export class Autosaver<T> {
  private latest: { value: T } | null = null;
  private timer: unknown = null;
  private inFlight: Promise<void> | null = null;
  private failures = 0;
  private disposed = false;
  private readonly delayMs: number;
  private readonly retryDelaysMs: number[];
  private readonly timers: Timers;

  constructor(private readonly options: AutosaverOptions<T>) {
    this.delayMs = options.delayMs ?? 800;
    this.retryDelaysMs = options.retryDelaysMs ?? [2000, 5000, 10000, 30000];
    this.timers = options.timers ?? realTimers;
  }

  /** There are changes that have not been saved yet. */
  get dirty(): boolean {
    return this.latest !== null || this.inFlight !== null;
  }

  schedule(value: T): void {
    if (this.disposed) return;
    this.latest = { value };
    this.failures = 0;
    this.options.onStatus("saving", null);
    this.arm(this.delayMs);
  }

  /** Saves pending changes now and resolves once everything is saved (or the attempt failed). */
  async flush(): Promise<void> {
    this.clearTimer();
    if (this.inFlight) await this.inFlight;
    this.clearTimer();
    if (this.latest) await this.run(false);
  }

  /** For page unload: fires the pending save with `keepalive` and does not wait. */
  flushOnUnload(): void {
    this.clearTimer();
    const pending = this.latest;
    if (!pending) return;
    this.latest = null;
    void this.options.save(pending.value, { keepalive: true }).catch(() => {});
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private arm(ms: number): void {
    this.clearTimer();
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      if (this.inFlight) return; // run() re-arms when the current save finishes
      void this.run(false);
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private async run(keepalive: boolean): Promise<void> {
    const pending = this.latest;
    if (!pending) return;
    this.latest = null;
    const attempt = this.options.save(pending.value, { keepalive });
    this.inFlight = attempt.then(
      () => {
        this.inFlight = null;
        if (this.disposed) return;
        this.failures = 0;
        if (this.latest) this.arm(this.delayMs);
        else this.options.onStatus("saved", null);
      },
      (err: unknown) => {
        this.inFlight = null;
        if (this.disposed) return;
        // A newer value wins over the failed one; otherwise retry the same value.
        if (!this.latest) this.latest = pending;
        const wait = this.retryDelaysMs[Math.min(this.failures, this.retryDelaysMs.length - 1)] ?? 5000;
        this.failures++;
        this.options.onStatus("error", err instanceof Error ? err.message : String(err));
        this.arm(wait);
      },
    );
    await this.inFlight;
  }
}
