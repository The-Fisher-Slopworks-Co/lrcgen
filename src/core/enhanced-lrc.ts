import type { LrcDocument } from "./lrc-document";
import { hasWordTimings, withTimestamp } from "./lrc-document";

// Word timings go to a companion file so the plain .lrc stays readable by every player.
const ENHANCED_SUFFIX = ".enhanced.lrc";

export function isEnhancedLrcPath(filePath: string): boolean {
  return filePath.endsWith(ENHANCED_SUFFIX);
}

// Same as node's path.extname for "/" paths, so this module also runs in the browser.
function extname(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 || base === ".." ? "" : base.slice(dot);
}

/** "song.lrc" → "song.enhanced.lrc" */
export function enhancedLrcPath(filePath: string): string {
  if (isEnhancedLrcPath(filePath)) return filePath;
  const ext = extname(filePath);
  return filePath.slice(0, filePath.length - ext.length) + ENHANCED_SUFFIX;
}

/** "song.enhanced.lrc" → "song.lrc" */
export function plainLrcPath(filePath: string): string {
  if (!isEnhancedLrcPath(filePath)) return filePath;
  return filePath.slice(0, -ENHANCED_SUFFIX.length) + ".lrc";
}

/**
 * Copies word timings from `enhanced` onto the lines of `base` with the same text, matched in order.
 * `base` wins everywhere else: edited lines lose their word timings, re-timed lines drag them along.
 */
export function mergeWordTimings(base: LrcDocument, enhanced: LrcDocument): LrcDocument {
  let next = 0;
  const lines = base.lines.map((line) => {
    for (let j = next; j < enhanced.lines.length; j++) {
      const candidate = enhanced.lines[j]!;
      if (candidate.text.trim() !== line.text.trim()) continue;
      next = j + 1;
      if (!hasWordTimings(candidate)) return line;
      return { ...withTimestamp(candidate, line.timestamp), text: line.text };
    }
    return line;
  });
  return { ...base, lines };
}
