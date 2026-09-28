import path from "node:path";
import type { LyricsFileInfo, TimingLevel } from "../shared/api";
import type { LyricsDoc } from "../core/lyrics";
import type { LrcParser } from "../ports/lrc-parser";
import { createDoc, groupsFromText, hasAnyWordTimings, isTimed } from "../core/lyrics";
import { isLyricsFilePath, parseLyricsFile } from "../core/lyrics-file";
import { readLrcFile } from "../adapters/lrc-files";

/** Sidecar names checked next to an audio file, best first: lrcgen's own file, then LRC, then plain text. */
function sidecarNames(audioName: string): string[] {
  const base = audioName.slice(0, audioName.length - path.extname(audioName).length);
  return [`${base}.lyrics.json`, `${base}.lrc`, `${base}.enhanced.lrc`, `${base}.txt`];
}

export function isLyricsPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".lrc" || ext === ".txt" || isLyricsFilePath(filePath);
}

export function timingLevel(doc: LyricsDoc): TimingLevel {
  if (hasAnyWordTimings(doc)) return "words";
  return doc.groups.some(isTimed) ? "lines" : "none";
}

/** A ".lyrics.json", an .lrc (with word timings merged in from its "*.enhanced.lrc" companion) or a plain .txt. */
export async function readLyricsFile(filePath: string, parser: LrcParser): Promise<LyricsDoc> {
  if (isLyricsFilePath(filePath)) return parseLyricsFile(await Bun.file(filePath).text());
  if (path.extname(filePath).toLowerCase() === ".txt") {
    return createDoc({}, groupsFromText(await Bun.file(filePath).text()));
  }
  return readLrcFile(filePath, parser);
}

/**
 * The lyrics file next to `audioPath` with the same base name, if any.
 * `siblings` (names in the same folder) saves a stat per candidate when listing a folder.
 */
export async function findLyricsFile(
  audioPath: string,
  parser: LrcParser,
  siblings?: ReadonlySet<string>,
): Promise<LyricsFileInfo | null> {
  const dir = path.dirname(audioPath);
  for (const name of sidecarNames(path.basename(audioPath))) {
    const filePath = path.join(dir, name);
    const exists = siblings ? siblings.has(name) : await Bun.file(filePath).exists();
    if (!exists) continue;
    try {
      const doc = await readLyricsFile(filePath, parser);
      return {
        path: filePath,
        name,
        format: isLyricsFilePath(name) ? "lyrics" : name.endsWith(".txt") ? "txt" : "lrc",
        timing: timingLevel(doc),
        lineCount: doc.groups.length,
      };
    } catch {
      continue;
    }
  }
  return null;
}
