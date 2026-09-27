import type { LrcLine } from "./lrc-document";

// A backing-vocal line is one whose whole text is wrapped in parentheses: "(one by one)".
// Nothing else marks it, so it survives a round trip through any LRC file.

function isWrapped(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("(") || !t.endsWith(")")) return false;
  // The opening parenthesis must be the one that closes at the end: "(oh) and (ah)" is not a backing line.
  let depth = 0;
  for (let i = 0; i < t.length - 1; i++) {
    if (t[i] === "(") depth++;
    else if (t[i] === ")") depth--;
    if (depth === 0) return false;
  }
  return depth === 1;
}

export function isBacking(line: LrcLine): boolean {
  return isWrapped(line.text);
}

/** Wraps text in parentheses unless it already is. */
export function asBacking(text: string): string {
  return isWrapped(text) ? text : `(${text.trim()})`;
}
