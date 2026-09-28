// A line all in parentheses is a backing vocal: "(one by one)". In LRC nothing else marks one, so that's how
// lines from LRC files (and older drafts) become groups labelled "backing" (./lrc-lines).

export function isWrapped(text: string): boolean {
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
