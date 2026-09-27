// Key specs like "Enter", "Ctrl+Z", "Ctrl+Shift+Z", "Shift+ArrowLeft", "/", "Space", "Esc", "F2", "B".
// Letters and digits match the physical key (event.code), so they keep working on a Russian layout.
// "Ctrl" also matches ⌘ on a Mac. Punctuation ignores Shift unless the spec says it (some layouts need
// Shift to type "/"); on a non-Latin layout (letters type Cyrillic) it goes by the physical key instead,
// since e.g. the "/" key types "." on a Russian layout.

export interface KeySpec {
  /** Normalised: "Enter", "Escape", " ", "ArrowLeft", "F2", "z" (letters lower-case), "7", "/". */
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

/** The fields of a KeyboardEvent the matcher needs. */
export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  return: "Enter",
  space: " ",
  spacebar: " ",
  del: "Delete",
  delete: "Delete",
  backspace: "Backspace",
  tab: "Tab",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  plus: "+",
};

const PUNCTUATION_CODES: Record<string, string> = {
  "/": "Slash",
  "?": "Slash",
  "\\": "Backslash",
  ",": "Comma",
  "<": "Comma",
  ".": "Period",
  ">": "Period",
  ";": "Semicolon",
  ":": "Semicolon",
  "'": "Quote",
  '"': "Quote",
  "[": "BracketLeft",
  "{": "BracketLeft",
  "]": "BracketRight",
  "}": "BracketRight",
  "-": "Minus",
  _: "Minus",
  "=": "Equal",
  "+": "Equal",
  "`": "Backquote",
  "~": "Backquote",
};

export function parseKeySpec(spec: string): KeySpec {
  // "+" alone (or as the last part, "Ctrl++") is the key itself.
  const parts = spec === "+" ? ["+"] : spec.endsWith("++") ? [...spec.slice(0, -2).split("+"), "+"] : spec.split("+");
  const result: KeySpec = { key: "", ctrl: false, shift: false, alt: false };
  for (const [i, raw] of parts.entries()) {
    const part = raw.trim();
    const lower = part.toLowerCase();
    const last = i === parts.length - 1;
    if (!last && (lower === "ctrl" || lower === "control" || lower === "mod" || lower === "cmd" || lower === "meta")) result.ctrl = true;
    else if (!last && lower === "shift") result.shift = true;
    else if (!last && (lower === "alt" || lower === "option")) result.alt = true;
    else if (last) result.key = normaliseKey(part);
    else throw new Error(`Unknown modifier "${part}" in key spec "${spec}"`);
  }
  if (!result.key) throw new Error(`No key in key spec "${spec}"`);
  return result;
}

function normaliseKey(part: string): string {
  const alias = ALIASES[part.toLowerCase()];
  if (alias) return alias;
  if (/^f\d{1,2}$/i.test(part)) return part.toUpperCase();
  if (part.length === 1) return /[a-z]/i.test(part) ? part.toLowerCase() : part;
  return part;
}

const isLetter = (k: string) => k.length === 1 && k >= "a" && k <= "z";
const isDigit = (k: string) => k.length === 1 && k >= "0" && k <= "9";

/** Whether the layout types non-Latin letters: judged from a letter key press, else null. */
export function layoutHint(e: KeyEventLike): boolean | null {
  if (!e.code.startsWith("Key") || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return null;
  return e.key.charCodeAt(0) >= 128;
}

export function matchesKey(spec: KeySpec, e: KeyEventLike, context: { nonLatinLayout?: boolean } = {}): boolean {
  if (spec.ctrl !== (e.ctrlKey || e.metaKey)) return false;
  if (spec.alt !== e.altKey) return false;

  if (isLetter(spec.key)) return spec.shift === e.shiftKey && e.code === `Key${spec.key.toUpperCase()}`;
  if (isDigit(spec.key)) return spec.shift === e.shiftKey && (e.code === `Digit${spec.key}` || e.code === `Numpad${spec.key}`);

  const punctuationCode = PUNCTUATION_CODES[spec.key];
  if (punctuationCode !== undefined) {
    if (spec.shift && !e.shiftKey) return false;
    const nonLatin = context.nonLatinLayout || (e.key.length === 1 && e.key.charCodeAt(0) >= 128);
    if (!nonLatin) return e.key === spec.key;
    // Go by the physical key as on a US layout: "?" is Shift+Slash, "/" is Slash.
    return e.code === punctuationCode && e.shiftKey === /[?<>:"{}_+~]/.test(spec.key);
  }

  if (spec.shift !== e.shiftKey) return false;
  return e.key === spec.key || (spec.key === " " && e.code === "Space");
}

/** How a spec is shown in <kbd>: "Ctrl+Shift+Z" → "Ctrl Shift Z", "ArrowLeft" → "←". */
export function keyLabel(spec: string): string {
  const s = parseKeySpec(spec);
  const names: Record<string, string> = {
    " ": "Space",
    Escape: "Esc",
    Delete: "Del",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
  };
  const key = names[s.key] ?? (s.key.length === 1 ? s.key.toUpperCase() : s.key);
  return [s.ctrl && "Ctrl", s.alt && "Alt", s.shift && "Shift", key].filter(Boolean).join(" ");
}
