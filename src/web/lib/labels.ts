// Group labels are free text; each gets a hue that stays the same on every screen (the --label-N tokens).
// The two the app suggests itself have their own; any other label is hashed onto the rest.

const KNOWN: Record<string, number> = { backing: 1, adlib: 2 };
const OTHERS = [3, 4, 5, 6];

/** The CSS colour of a label: `var(--label-N)`. */
export function labelHue(label: string): string {
  const known = KNOWN[label.trim().toLowerCase()];
  if (known) return `var(--label-${known})`;
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return `var(--label-${OTHERS[h % OTHERS.length]})`;
}
