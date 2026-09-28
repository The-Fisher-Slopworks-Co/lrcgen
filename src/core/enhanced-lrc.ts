import { groupStart, groupText, hasWordTimings, withStart, withUniqueIds, type LyricsDoc } from "./lyrics";

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
 * Copies word timings from `enhanced` onto the groups of `base` with the same text, matched in order.
 * `base` wins everywhere else: edited lines lose their word timings, re-timed lines drag them along.
 */
export function mergeWordTimings(base: LyricsDoc, enhanced: LyricsDoc): LyricsDoc {
  let next = 0;
  const groups = base.groups.map((group) => {
    for (let j = next; j < enhanced.groups.length; j++) {
      const candidate = enhanced.groups[j]!;
      if (groupText(candidate) !== groupText(group)) continue;
      next = j + 1;
      if (!hasWordTimings(candidate)) return group;
      const start = groupStart(group);
      return { ...group, words: (start === null ? candidate : withStart(candidate, start)).words };
    }
    return group;
  });
  return { ...base, groups: withUniqueIds(groups) };
}
