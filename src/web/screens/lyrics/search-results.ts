// LRCLIB results as the Lyrics step shows them: sorted against the track, described for the result rows.

import type { LrcLine } from "../../../core/lrc-document";
import { durationMatch, type DurationMatch } from "../../../core/lrclib-match";
import type { LrclibResult, TimingLevel } from "../../../shared/api";
import { shortClock } from "../../lib/format";
import { parseLyricsText } from "./lyrics-text";

/** Results whose length matches the track come first; instrumental ones last; otherwise LRCLIB's order. */
export function sortResults(results: LrclibResult[], trackMs: number | null): LrclibResult[] {
  const rank = (r: LrclibResult) => {
    if (r.instrumental) return 2;
    return trackMs != null && r.durationMs != null && durationMatch(trackMs, r.durationMs).matches ? 0 : 1;
  };
  return results
    .map((r, i) => ({ r, i, rank: rank(r) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.r);
}

export interface ResultView {
  title: string;
  /** "artist · album" or "artist · no album". */
  meta: string;
  duration: string;
  match: DurationMatch | null;
  badge: "line timings" | "plain lyrics" | "instrumental";
}

export function describeResult(r: LrclibResult, trackMs: number | null): ResultView {
  return {
    title: r.trackName || "Untitled",
    meta: `${r.artistName || "Unknown artist"} · ${r.albumName || "no album"}`,
    duration: shortClock(r.durationMs),
    match: trackMs != null && r.durationMs != null ? durationMatch(trackMs, r.durationMs) : null,
    badge: r.instrumental ? "instrumental" : r.syncedLyrics ? "line timings" : "plain lyrics",
  };
}

/** The result's lyrics as lines: synced ones keep their times. */
export function resultLyrics(r: LrclibResult): { lines: LrcLine[]; timing: TimingLevel } {
  if (r.instrumental) return { lines: [], timing: "none" };
  if (r.syncedLyrics) return parseLyricsText(r.syncedLyrics, { lrc: true });
  return parseLyricsText(r.plainLyrics ?? "");
}
