// Reads design tokens (CSS variables from styles/tokens.css) for canvas drawing.

const cache = new Map<string, string>();

/** The value of a CSS variable on :root, e.g. cssVar("--accent") → "#f0b44c". */
export function cssVar(name: string): string {
  let value = cache.get(name);
  if (value === undefined) {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (value) cache.set(name, value);
  }
  return value;
}
