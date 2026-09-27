// Pure helpers for the file browser: filtering, keyboard selection, which bookmark is current, lyrics labels.

import type { DirEntry, FolderBookmark, LyricsFileInfo, TimingLevel } from "../../../shared/api";
import { plural } from "../../lib/format";

/** Entries whose name contains `query` (case-insensitive); all of them for a blank query. */
export function filterEntries(entries: DirEntry[], query: string): DirEntry[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return entries;
  return entries.filter((e) => e.name.toLocaleLowerCase().includes(q));
}

/**
 * The path `delta` rows away from `current` in `paths`, clamped to the ends.
 * With nothing selected (or a selection that is filtered out), ↓ picks the first row and ↑ the last.
 */
export function moveSelection(paths: string[], current: string | null, delta: number): string | null {
  if (paths.length === 0) return null;
  const i = current === null ? -1 : paths.indexOf(current);
  if (i === -1) return delta > 0 ? paths[0]! : paths[paths.length - 1]!;
  return paths[Math.min(paths.length - 1, Math.max(0, i + delta))]!;
}

/** The bookmark `dir` lives in (the deepest one when bookmarks nest), or null. */
export function currentBookmark(folders: FolderBookmark[], dir: string | null): string | null {
  if (!dir) return null;
  let best: string | null = null;
  for (const f of folders) {
    const inside = dir === f.path || dir.startsWith(f.path.endsWith("/") ? f.path : `${f.path}/`);
    if (inside && (best === null || f.path.length > best.length)) best = f.path;
  }
  return best;
}

const ROW_TIMING: Record<TimingLevel, string> = {
  none: "no timings",
  lines: "line timings",
  words: "word timings",
};

/** The file list's "Lyrics alongside" column: "X.lrc · line timings", "X.txt · no timings", "—". */
export function lyricsLabel(info: LyricsFileInfo | null): string {
  return info ? `${info.name} · ${ROW_TIMING[info.timing]}` : "—";
}

const SUMMARY_TIMING: Record<TimingLevel, string> = {
  none: "no timings",
  lines: "line timings · no word timings",
  words: "line timings · word timings",
};

/** The track panel's sidecar summary: "11 lines · line timings · no word timings". */
export function sidecarSummary(info: LyricsFileInfo): string {
  return `${plural(info.lineCount, "line")} · ${SUMMARY_TIMING[info.timing]}`;
}

/** "Short Waves · track 2", "Short Waves", "track 2", or "" when neither is known. */
export function albumLine(album: string | null, trackNo: number | null): string {
  return [album, trackNo != null ? `track ${trackNo}` : null].filter(Boolean).join(" · ");
}

/** The folder a path sits in ("/" for top-level entries). */
export function parentDir(path: string): string {
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  const i = trimmed.lastIndexOf("/");
  return i <= 0 ? "/" : trimmed.slice(0, i);
}

/** The last path segment. */
export function baseName(path: string): string {
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}
