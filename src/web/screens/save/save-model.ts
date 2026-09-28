// The Save & publish dialog's logic without the UI: path display and editing, the backup warning, the
// toast after saving, and the publish checklist with what blocks publishing.

import type { Flag, FlagKind } from "../../../core/flags";
import { draftProgress } from "../../../core/draft-status";
import { isEnhancedLrcPath } from "../../../core/enhanced-lrc";
import { isSung, type LyricsDoc } from "../../../core/lyrics";
import { shortClock } from "../../lib/format";

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** "~/Music/Artist/" and "Song.lrc" for showing a path with the file name bright. */
export function splitPath(path: string, homeDir: string | null): { dir: string; name: string } {
  const slash = path.lastIndexOf("/");
  let dir = path.slice(0, slash + 1);
  if (homeDir && (dir === `${homeDir}/` || dir.startsWith(`${homeDir.replace(/\/$/, "")}/`))) {
    dir = `~${dir.slice(homeDir.replace(/\/$/, "").length)}`;
  }
  return { dir, name: path.slice(slash + 1) };
}

/** Checks a typed save path: absolute (or "~/…"), a plain ".lrc" file. */
export function parseLrcPath(input: string, homeDir: string | null): { path: string } | { error: string } {
  let path = input.trim();
  if (path === "") return { error: "Type where to save the file." };
  if (path.startsWith("~/") && homeDir) path = `${homeDir.replace(/\/$/, "")}${path.slice(1)}`;
  if (!path.startsWith("/")) return { error: "Use a full path, starting with / or ~/." };
  if (path.endsWith("/")) return { error: "That's a folder — add a file name ending in .lrc." };
  if (isEnhancedLrcPath(path)) return { error: "Pick the plain .lrc name — the .enhanced.lrc file is written next to it." };
  if (!/\.lrc$/i.test(path)) return { error: "The file name must end in .lrc." };
  if (/(^|\/)\.\.?(\/|$)/.test(path)) return { error: "Leave out “.” and “..” in the path." };
  return { path };
}

/** The files' names past their shared stem: ["A.lrc", "A.enhanced.lrc"] → [".lrc", ".enhanced.lrc"]. */
export function fileSuffixes(names: string[]): string[] {
  const first = names[0];
  if (!first) return [];
  const stem = first.replace(/\.lrc$/i, "");
  return names.map((n) => (n.startsWith(stem) && n.length > stem.length ? n.slice(stem.length) : n));
}

/** "A.lrc", "A.lrc and A.enhanced.lrc", "A, B and C". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Existing files are copied to "<file>.bak" before a save overwrites (or, for lines only, removes) them. */
export function backupNames(existing: string[]): string[] {
  return existing.map((p) => `${baseName(p)}.bak`);
}

/**
 * The existing files a save with `format` replaces (the lyrics file always, LRC files unless no LRC is written),
 * and the LRC files it leaves as they are.
 */
export function replacedFiles(existing: string[], lyricsPath: string, format: "enhanced" | "lines" | "none"): { replaced: string[]; kept: string[] } {
  if (format !== "none") return { replaced: existing, kept: [] };
  return { replaced: existing.filter((p) => p === lyricsPath), kept: existing.filter((p) => p !== lyricsPath) };
}

/** "Saved Song.lrc (+ Song.enhanced.lrc)". */
export function savedMessage(written: string[]): string {
  const [first, ...rest] = written.map(baseName);
  if (!first) return "Saved";
  return rest.length ? `Saved ${first} (+ ${rest.join(", ")})` : `Saved ${first}`;
}

/**
 * Groups (0-based) where a word without a start follows a timed one. Enhanced LRC can't mark a word as untimed,
 * so such a word is written joined to the word before it. Punctuation-only words don't count.
 */
export function joinedOnSave(doc: LyricsDoc): number[] {
  const out: number[] = [];
  doc.groups.forEach((group, i) => {
    let timedBefore = false;
    for (const w of group.words) {
      if (w.start !== null) timedBefore = true;
      else if (timedBefore && isSung(w)) {
        out.push(i);
        return;
      }
    }
  });
  return out;
}

/** "Line 4 has a word…" / "Lines 4, 9 and 12 have words…", for the enhanced format card. */
export function joinedNote(lines: number[]): string | null {
  if (lines.length === 0) return null;
  const shown = lines.slice(0, 5).map((i) => String(i + 1));
  const which =
    lines.length === 1
      ? `Line ${shown[0]} has a word`
      : lines.length > 5
        ? `Lines ${shown.join(", ")} and ${lines.length - 5} more have words`
        : `Lines ${listNames(shown)} have words`;
  return `${which} without a start. Enhanced LRC saves ${lines.length === 1 ? "it" : "each"} joined to the word before.`;
}

// ---------------------------------------------------------------- publish checklist

export type CheckId = "tags" | "length" | "timings" | "flags";

export interface CheckRow {
  id: CheckId;
  ok: boolean;
  text: string;
  /** Publishing is disabled until this is fixed. */
  blocking: boolean;
}

export interface Checklist {
  rows: CheckRow[];
  /** Why Publish is disabled; empty when it can go. */
  blockers: string[];
  firstFlag: Flag | null;
}

const KIND_LABEL: Record<FlagKind, string> = {
  "lines-out-of-order": "lines out of order",
  "words-out-of-order": "words out of order",
  "starts-in-silence": "starts before the voice",
};

export function flagSummary(flag: Flag): string {
  return `line ${flag.lineIndex + 1}, ${KIND_LABEL[flag.kind]}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function publishChecklist(doc: LyricsDoc, durationMs: number | null, flags: Flag[]): Checklist {
  const rows: CheckRow[] = [];
  const blockers: string[] = [];

  const missing = (["artist", "title", "album"] as const).filter((k) => !doc.metadata[k]?.trim());
  if (missing.length === 0) rows.push({ id: "tags", ok: true, text: "Artist, title and album filled in", blocking: false });
  else {
    const blocking = missing.includes("artist") || missing.includes("title");
    rows.push({ id: "tags", ok: false, text: `${capitalise(listNames(missing))} ${missing.length > 1 ? "are" : "is"} missing`, blocking });
    if (blocking) blockers.push(`Fill in the ${listNames(missing.filter((k) => k !== "album"))} first`);
  }

  if (durationMs && durationMs > 0) rows.push({ id: "length", ok: true, text: `Length matches the track · ${shortClock(durationMs)}`, blocking: false });
  else {
    rows.push({ id: "length", ok: false, text: "The track's length is unknown", blocking: true });
    blockers.push("The track's length is unknown");
  }

  const { totalLines, linesTimed, linesWithWords } = draftProgress(doc, { published: false, openFlags: 0 });
  if (totalLines === 0) {
    rows.push({ id: "timings", ok: false, text: "No lyrics yet", blocking: true });
    blockers.push("There are no lyrics yet");
  } else if (linesTimed < totalLines) {
    rows.push({ id: "timings", ok: false, text: `${linesTimed} of ${totalLines} lines timed · ${linesWithWords} with word timings`, blocking: true });
    blockers.push(`${totalLines - linesTimed} ${totalLines - linesTimed === 1 ? "line has" : "lines have"} no start time`);
  } else if (linesWithWords < totalLines) {
    rows.push({ id: "timings", ok: false, text: `All ${totalLines} lines timed · ${linesWithWords} of ${totalLines} with word timings`, blocking: false });
  } else {
    rows.push({ id: "timings", ok: true, text: `All ${totalLines} lines have line and word timings`, blocking: false });
  }

  const firstFlag = flags[0] ?? null;
  if (firstFlag) {
    const n = flags.length;
    rows.push({ id: "flags", ok: false, text: `${n} ${n === 1 ? "spot" : "spots"} worth a look: ${flagSummary(firstFlag)}`, blocking: false });
  } else {
    rows.push({ id: "flags", ok: true, text: "Nothing worth a look", blocking: false });
  }
  return { rows, blockers, firstFlag };
}
