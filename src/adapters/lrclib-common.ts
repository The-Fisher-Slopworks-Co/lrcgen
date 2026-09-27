export const LRCLIB_BASE_URL = "https://lrclib.net/api";
export const LRCLIB_USER_AGENT = "lrcgen/0.1.0 (https://github.com/txssu/lrcgen)";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

/** lrclib.net couldn't be reached at all (DNS, connection, proxy) — as opposed to answering with an error. */
export class LrclibUnreachableError extends Error {
  constructor(cause: unknown) {
    super("Couldn't reach lrclib.net — check your internet connection or proxy.", { cause });
  }
}

/** `fetchFn` that turns a network failure into LrclibUnreachableError, logging the raw error. Aborts pass through. */
export async function lrclibFetch(fetchFn: FetchLike, url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (e) {
    if (init.signal?.aborted) throw e;
    console.error(`lrclib.net unreachable (${url}):`, e instanceof Error ? e.message : e);
    throw new LrclibUnreachableError(e);
  }
}
