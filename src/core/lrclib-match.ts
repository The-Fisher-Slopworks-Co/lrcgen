// Comparing an LRCLIB search result with the track that is open.

export interface DurationMatch {
  /** Result length minus track length, in ms. */
  diffMs: number;
  /** Within a couple of seconds: most likely the same recording. */
  matches: boolean;
  /** "matches the track", "7 s longer", "12 s shorter", "different version" (way off). */
  label: string;
}

const SAME_RECORDING_MS = 2000;
const SAME_SONG_MS = 20000;

export function durationMatch(trackMs: number, resultMs: number): DurationMatch {
  const diffMs = resultMs - trackMs;
  const off = Math.abs(diffMs);
  if (off <= SAME_RECORDING_MS) return { diffMs, matches: true, label: "matches the track" };
  if (off > SAME_SONG_MS) return { diffMs, matches: false, label: "different version" };
  return { diffMs, matches: false, label: `${Math.round(off / 1000)} s ${diffMs > 0 ? "longer" : "shorter"}` };
}
