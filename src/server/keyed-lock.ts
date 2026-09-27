/** Runs async work one at a time per key; different keys run concurrently. */
export class KeyedLock {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(work, work);
    const tail = result.catch(() => {});
    this.tails.set(key, tail);
    tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}

/** At most `limit` tasks at a time. */
export class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(private limit: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
