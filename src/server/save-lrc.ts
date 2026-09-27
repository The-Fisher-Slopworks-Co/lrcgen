import { copyFile, rm } from "node:fs/promises";
import type { SaveCheck, SaveFormat, SaveResponse } from "../shared/api";
import type { LrcDocument } from "../core/lrc-document";
import type { LrcParser } from "../ports/lrc-parser";
import { enhancedLrcPath } from "../core/enhanced-lrc";
import { writeLrcFiles } from "../adapters/lrc-files";

const exists = (filePath: string) => Bun.file(filePath).exists();

export async function saveCheck(lrcPath: string): Promise<SaveCheck> {
  const companion = enhancedLrcPath(lrcPath);
  const existing: string[] = [];
  for (const p of [lrcPath, companion]) if (await exists(p)) existing.push(p);
  return {
    targets: [
      { format: "enhanced", paths: [lrcPath, companion] },
      { format: "lines", paths: [lrcPath] },
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
 * Writes `doc` to `lrcPath`, copying files it replaces to "<file>.bak" first.
 * "enhanced": the .lrc plus the ".enhanced.lrc" companion. "lines": the .lrc only — an existing companion is
 * backed up and removed, since it would no longer match.
 */
export async function saveLrc(
  lrcPath: string,
  format: SaveFormat,
  doc: LrcDocument,
  plainParser: LrcParser,
  enhancedParser: LrcParser,
): Promise<SaveResponse> {
  const companion = enhancedLrcPath(lrcPath);
  const backups: string[] = [];
  await backUp(lrcPath, backups);
  await backUp(companion, backups);

  if (format === "enhanced") {
    const written = await writeLrcFiles(lrcPath, doc, plainParser, enhancedParser);
    return { written, backups };
  }
  await Bun.write(lrcPath, plainParser.serialize(doc));
  await rm(companion, { force: true });
  return { written: [lrcPath], backups };
}
