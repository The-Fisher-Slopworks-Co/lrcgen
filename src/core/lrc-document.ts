export interface LrcMetadata {
  artist?: string;
  title?: string;
  album?: string;
  tool: string;
  [key: string]: string | undefined;
}

export interface LrcWord {
  /** Start time in ms, or null if the word has not been synced yet. */
  start: number | null;
  /** The word as written, including the whitespace that follows it. */
  text: string;
}

export interface LrcLine {
  timestamp: number | null;
  text: string;
  /** Per-word timings for karaoke; the word texts concatenate to the trimmed `text`. */
  words?: LrcWord[];
  /** When the last word ends, in ms. */
  end?: number | null;
}

export interface LrcDocument {
  metadata: LrcMetadata;
  lines: LrcLine[];
}

const TOOL_URL = "https://github.com/txssu/lrcgen";

export function createDocument(metadata?: Partial<Omit<LrcMetadata, "tool">>): LrcDocument {
  return { metadata: { ...metadata, tool: TOOL_URL }, lines: [] };
}

export function linesFromText(text: string): LrcLine[] {
  if (!text) return [];
  return text.split("\n").map((line) => line.trim()).filter((line) => line !== "").map((text) => ({ timestamp: null, text }));
}

export function addLines(doc: LrcDocument, lines: LrcLine[]): LrcDocument {
  return { ...doc, lines: [...doc.lines, ...lines] };
}

export function splitWords(text: string): LrcWord[] {
  return (text.trim().match(/\S+\s*/g) ?? []).map((text) => ({ start: null, text }));
}

export function wordsOf(line: LrcLine): LrcWord[] {
  return line.words ?? splitWords(line.text);
}

export function hasWordTimings(line: LrcLine): boolean {
  return line.words?.some((w) => w.start !== null) ?? false;
}

/** Every word that has a letter or digit in it is timed; punctuation-only words ("— ") needn't be. */
export function wordsComplete(line: LrcLine): boolean {
  if (!line.words || line.words.length === 0) return false;
  return line.words.every((w) => w.start !== null || !/[\p{L}\p{N}]/u.test(w.text));
}

export function hasAnyWordTimings(doc: LrcDocument): boolean {
  return doc.lines.some(hasWordTimings);
}

/** The line's end time, as long as it still comes after every timed word. */
export function lineEnd(line: LrcLine): number | null {
  if (line.end == null) return null;
  const lastStart = Math.max(...wordsOf(line).map((w) => w.start ?? -1));
  return line.end > lastStart ? line.end : null;
}

function withoutWords(line: LrcLine): LrcLine {
  const { words: _words, end: _end, ...rest } = line;
  return rest;
}

/** Moves a line to `timestamp`, dragging its word timings along so they stay in sync with it. */
export function withTimestamp(line: LrcLine, timestamp: number | null): LrcLine {
  if (line.timestamp === null || timestamp === null || !line.words) return { ...line, timestamp };
  const delta = timestamp - line.timestamp;
  const shift = (ms: number) => Math.max(0, ms + delta);
  const moved: LrcLine = {
    ...line,
    timestamp,
    words: line.words.map((w) => ({ ...w, start: w.start === null ? null : shift(w.start) })),
  };
  if (line.end != null) moved.end = shift(line.end);
  return moved;
}

export function setTimestamp(doc: LrcDocument, index: number, timestamp: number | null): LrcDocument {
  const lines = doc.lines.map((line, i) => i === index ? withTimestamp(line, timestamp) : line);
  return { ...doc, lines };
}

/** Groups `words` into runs of `sizes` (joined words have several parts); null when they don't add up. */
function regroup(words: LrcWord[], sizes: number[]): LrcWord[] | null {
  if (sizes.some((n) => n === 0) || sizes.reduce((a, b) => a + b, 0) !== words.length) return null;
  let next = 0;
  return sizes.map((n) => {
    const text = words.slice(next, next + n).map((w) => w.text).join("");
    next += n;
    return { start: null, text };
  });
}

/** A typo fix keeps word timings (and joined words) as long as the number of whitespace-separated parts stays the same. */
export function withText(line: LrcLine, text: string): LrcLine {
  if (!line.words || text.trim() === line.text.trim()) return { ...line, text };
  const words = regroup(splitWords(text), line.words.map((w) => w.text.match(/\S+/g)?.length ?? 0));
  if (!words) return { ...withoutWords(line), text };
  return { ...line, text, words: words.map((w, i) => ({ ...w, start: line.words![i]!.start })) };
}

export function setLineText(doc: LrcDocument, index: number, text: string): LrcDocument {
  const lines = doc.lines.map((line, i) => i === index ? withText(line, text) : line);
  return { ...doc, lines };
}

/** Sets when one word starts; the first word also sets when the line starts. */
export function setWordStart(doc: LrcDocument, lineIndex: number, wordIndex: number, start: number | null): LrcDocument {
  const lines = doc.lines.map((line, i) => {
    if (i !== lineIndex) return line;
    const words = wordsOf(line);
    if (wordIndex < 0 || wordIndex >= words.length) return line;
    const updated: LrcLine = { ...line, words: words.map((w, j) => j === wordIndex ? { ...w, start } : w) };
    if (wordIndex === 0 && start !== null) updated.timestamp = start;
    return updated;
  });
  return { ...doc, lines };
}

export function insertLine(doc: LrcDocument, afterIndex: number): LrcDocument {
  const newLine: LrcLine = { timestamp: null, text: "" };
  const lines = [...doc.lines];
  lines.splice(afterIndex + 1, 0, newLine);
  return { ...doc, lines };
}

export function removeLine(doc: LrcDocument, index: number): LrcDocument {
  if (index < 0 || index >= doc.lines.length) return doc;
  const lines = doc.lines.filter((_, i) => i !== index);
  return { ...doc, lines };
}

export function setMetadata(doc: LrcDocument, updates: Partial<Omit<LrcMetadata, "tool">>): LrcDocument {
  return { ...doc, metadata: { ...doc.metadata, ...updates, tool: TOOL_URL } };
}
