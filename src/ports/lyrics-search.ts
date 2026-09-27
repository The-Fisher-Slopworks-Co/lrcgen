import type { LrclibResult } from "../shared/api";

export interface LyricsSearchQuery {
  title: string;
  artist?: string;
  album?: string;
}

export interface LyricsSearch {
  name: string;
  search(query: LyricsSearchQuery, signal?: AbortSignal): Promise<LrclibResult[]>;
}
