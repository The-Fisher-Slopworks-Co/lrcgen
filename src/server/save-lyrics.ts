import { copyFile, rm } from "node:fs/promises";
import type { SaveCheck, SaveFormat, SaveResponse } from "../shared/api";
import type { LyricsDoc } from "../core/lyrics";
import type { LrcParser } from "../ports/lrc-parser";
import { enhancedLrcPath } from "../core/enhanced-lrc";
import { lyricsFilePath, serializeLyricsFile } from "../core/lyrics-file";
import { writeLrcFiles } from "../adapters/lrc-files";

const exists = (filePath: string) => Bun.file(filePath).exists();

export async function saveCheck(lrcPath: string): Promise<SaveCheck> {
  const lyricsPath = lyricsFilePath(lrcPath);
  const companion = enhancedLrcPath(lrcPath);
  const existing: string[] = [];
  for (const p of [lyricsPath, lrcPath, companion]) if (await exists(p)) existing.push(p);
  return {
    lyricsPath,
    targets: [
      { format: "enhanced", paths: [lrcPath, companion] },
      { format: "lines", paths: [lrcPath] },
      { format: "none", paths: [] },
    ],
    existing,
  };
}

async function backUp(filePath: string, backups: string[]): Promise<void> {
  if (!(await exists(filePath))) return;
  const backup = `${filePath}.bak`;
  await copyFile(filePath, backup);
  backups.push(backup);
}

/**
 * Writes `doc` as the lyrics file next to `lrcPath` ("Song.lyrics.json"), plus the LRC `format` asks for, copying
 * files it replaces to "<file>.bak" first. "enhanced": the .lrc and the ".enhanced.lrc" companion. "lines": the
 * .lrc only — an existing companion is backed up and removed, since it would no longer match. "none": LRC files
 * already there are left alone.
 */
export async function saveLyrics(
  lrcPath: string,
  format: SaveFormat,
  doc: LyricsDoc,
  plainParser: LrcParser,
  enhancedParser: LrcParser,
): Promise<SaveResponse> {
  const lyricsPath = lyricsFilePath(lrcPath);
  const companion = enhancedLrcPath(lrcPath);
  const backups: string[] = [];
  await backUp(lyricsPath, backups);
  if (format !== "none") {
    await backUp(lrcPath, backups);
    await backUp(companion, backups);
  }

  await Bun.write(lyricsPath, serializeLyricsFile(doc));
  const written = [lyricsPath];
  if (format === "enhanced") {
    written.push(...(await writeLrcFiles(lrcPath, doc, plainParser, enhancedParser)));
  } else if (format === "lines") {
    await Bun.write(lrcPath, plainParser.serialize(doc));
    await rm(companion, { force: true });
    written.push(lrcPath);
  }
  return { written, backups };
}
