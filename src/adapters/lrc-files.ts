import type { LyricsDoc } from "../core/lyrics";
import type { LrcParser } from "../ports/lrc-parser";
import { hasAnyWordTimings } from "../core/lyrics";
import { enhancedLrcPath, isEnhancedLrcPath, mergeWordTimings } from "../core/enhanced-lrc";

/** Reads an LRC file together with the word timings from its "*.enhanced.lrc" companion, if there is one. */
export async function readLrcFile(filePath: string, parser: LrcParser): Promise<LyricsDoc> {
  const doc = parser.parse(await Bun.file(filePath).text());
  const companion = enhancedLrcPath(filePath);
  if (companion === filePath || !(await Bun.file(companion).exists())) return doc;
  return mergeWordTimings(doc, parser.parse(await Bun.file(companion).text()));
}

/**
 * Writes the plain LRC file, plus its "*.enhanced.lrc" companion when there are word timings
 * (or an older companion that would otherwise go stale). Returns the paths written.
 */
export async function writeLrcFiles(
  filePath: string,
  doc: LyricsDoc,
  plainParser: LrcParser,
  enhancedParser: LrcParser,
): Promise<string[]> {
  if (isEnhancedLrcPath(filePath)) {
    await Bun.write(filePath, enhancedParser.serialize(doc));
    return [filePath];
  }
  await Bun.write(filePath, plainParser.serialize(doc));
  const companion = enhancedLrcPath(filePath);
  if (!hasAnyWordTimings(doc) && !(await Bun.file(companion).exists())) return [filePath];
  await Bun.write(companion, enhancedParser.serialize(doc));
  return [filePath, companion];
}
