import type { LrclibResult } from "../../shared/api";
import type { LyricsProvider } from "../../ports/lyrics-provider";
import type { LyricsSearch, LyricsSearchQuery } from "../../ports/lyrics-search";
import { LRCLIB_BASE_URL, LRCLIB_USER_AGENT, defaultFetch, lrclibFetch, type FetchLike } from "../lrclib-common";

interface LrclibResponse {
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

/** A record as LRCLIB returns it; `duration` is in seconds. */
export interface LrclibRecord {
  id: number;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  duration?: number | null;
  instrumental?: boolean | null;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export function parseLrclibResponse(response: { syncedLyrics: string | null; plainLyrics: string | null }): string {
  return response.syncedLyrics ?? response.plainLyrics ?? "";
}

export function toLrclibResult(record: LrclibRecord): LrclibResult {
  return {
    id: record.id,
    trackName: record.trackName ?? "",
    artistName: record.artistName ?? "",
    albumName: record.albumName || null,
    durationMs: typeof record.duration === "number" ? Math.round(record.duration * 1000) : null,
    instrumental: record.instrumental ?? false,
    plainLyrics: record.plainLyrics || null,
    syncedLyrics: record.syncedLyrics || null,
  };
}

export class LrclibLyricsProvider implements LyricsProvider, LyricsSearch {
  name = "LRCLIB";

  constructor(private fetchFn: FetchLike = defaultFetch) {}

  async fetch(query: { artist?: string; title?: string }): Promise<string> {
    if (!query.artist || !query.title) return "";

    try {
      const params = new URLSearchParams({
        artist_name: query.artist,
        track_name: query.title,
      });

      const res = await this.fetchFn(`${LRCLIB_BASE_URL}/get?${params}`, {
        headers: { "User-Agent": LRCLIB_USER_AGENT },
      });
      if (!res.ok) return "";

      const data = (await res.json()) as LrclibResponse;
      return parseLrclibResponse(data);
    } catch {
      return "";
    }
  }

  /** Throws when LRCLIB can't be reached (LrclibUnreachableError) or answers with an error. */
  async search(query: LyricsSearchQuery, signal?: AbortSignal): Promise<LrclibResult[]> {
    const title = query.title.trim();
    if (!title) return [];
    const params = new URLSearchParams({ track_name: title });
    if (query.artist?.trim()) params.set("artist_name", query.artist.trim());
    if (query.album?.trim()) params.set("album_name", query.album.trim());

    const res = await lrclibFetch(this.fetchFn, `${LRCLIB_BASE_URL}/search?${params}`, {
      headers: { "User-Agent": LRCLIB_USER_AGENT },
      signal,
    });
    if (!res.ok) throw new Error(`LRCLIB search failed (${res.status})`);
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) throw new Error("LRCLIB search returned an unexpected response");
    return data
      .filter((r): r is LrclibRecord => typeof r === "object" && r !== null && typeof r.id === "number")
      .map(toLrclibResult);
  }
}
