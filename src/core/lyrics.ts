// The lyrics document, lrcgen's own format: groups of words in reading order. A group is usually one line of
// the song; a group with labels ("backing", "adlib", …) is sung over or between the lines. Every word belongs to
// exactly one group and knows when it starts and when it stops sounding:
//
//   { metadata, groups: [{ id: "g1", labels: [], words: [{ id: "w1", text: "Never", start: 12000, end: 12380 }, …] }] }
//
// Times are song ms. A group starts when its earliest word does, so tapping a line on the Lines step times its
// first word, and the other words get theirs on the Words step. LRC and Enhanced LRC are only imported and
// exported (./lrc-export, src/adapters/lrc-parser).

export interface Metadata {
  artist?: string;
  title?: string;
  album?: string;
  tool: string;
  [key: string]: string | undefined;
}

export interface Word {
  /** Unique in the document ("w12"). Timing, text and label edits keep it. */
  id: string;
  /** As written, without surrounding whitespace. A joined word ("о разном") has spaces inside: its parts share one timing. */
  text: string;
  /** When the word starts sounding, ms; null until it's timed. */
  start: number | null;
  /** When it stops sounding, ms; null when not known, and then it lasts until the next word starts. */
  end: number | null;
  /** Written together with the next word, without a space: syllables timed one by one ("beau", "ti", "ful"). */
  noSpaceAfter?: boolean;
}

export interface Group {
  /** Unique in the document ("g3"). */
  id: string;
  /** Free-form: "backing", "adlib", "singer:A"… A group without labels is a line of the song. */
  labels: string[];
  /** In reading order. */
  words: Word[];
}

export interface LyricsDoc {
  metadata: Metadata;
  /** In reading order. */
  groups: Group[];
}

const TOOL_URL = "https://github.com/txssu/lrcgen";

export function createDoc(metadata?: Partial<Omit<Metadata, "tool">>, groups: Group[] = []): LyricsDoc {
  return { metadata: { ...metadata, tool: TOOL_URL }, groups };
}

export function setMetadata(doc: LyricsDoc, updates: Partial<Omit<Metadata, "tool">>): LyricsDoc {
  return { ...doc, metadata: { ...doc.metadata, ...updates, tool: TOOL_URL } };
}

// ---------------------------------------------------------------- ids

export interface Ids {
  word(): string;
  group(): string;
}

function idNumber(id: string, prefix: string): number {
  return id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length)) ? Number(id.slice(prefix.length)) : 0;
}

/** Hands out ids ("w13", "g4") that no group or word in `groups` has yet. */
export function idsFor(groups: readonly Group[] = []): Ids {
  let w = 0;
  let g = 0;
  for (const group of groups) {
    g = Math.max(g, idNumber(group.id, "g"));
    for (const word of group.words) w = Math.max(w, idNumber(word.id, "w"));
  }
  return { word: () => `w${++w}`, group: () => `g${++g}` };
}

/** Gives a fresh id to each group and word whose id is missing or already taken, e.g. after mixing in groups from elsewhere. */
export function withUniqueIds(groups: Group[]): Group[] {
  const ids = idsFor(groups);
  const groupIds = new Set<string>();
  const wordIds = new Set<string>();
  let changed = false;
  const out = groups.map((g) => {
    let group = g;
    if (!g.id || groupIds.has(g.id)) {
      group = { ...group, id: ids.group() };
      changed = true;
    }
    groupIds.add(group.id);
    let renamed = false;
    const words = g.words.map((w) => {
      if (w.id && !wordIds.has(w.id)) {
        wordIds.add(w.id);
        return w;
      }
      renamed = true;
      const id = ids.word();
      wordIds.add(id);
      return { ...w, id };
    });
    if (renamed) {
      group = { ...group, words };
      changed = true;
    }
    return group;
  });
  return changed ? out : groups;
}

// ---------------------------------------------------------------- text

export function splitText(text: string): string[] {
  return text.trim().split(/\s+/).filter((part) => part !== "");
}

/** The parts of a (possibly joined) word: "о разном" → ["о", "разном"]. */
export function wordParts(word: Word): string[] {
  return splitText(word.text);
}

/** Has letters or digits: punctuation-only words ("—") are never tapped and never flagged. */
export function isSung(word: Word): boolean {
  return /[\p{L}\p{N}]/u.test(word.text);
}

export function groupText(group: Group): string {
  return joinWords(group.words);
}

/** Words as one text: a space between them unless a word has `noSpaceAfter`. */
export function joinWords(words: readonly Pick<Word, "text" | "noSpaceAfter">[]): string {
  return words.map((w, i) => (i < words.length - 1 && !w.noSpaceAfter ? `${w.text} ` : w.text)).join("");
}

export function isLabelled(group: Group): boolean {
  return group.labels.length > 0;
}

/** An untimed group of `text`'s words. */
export function makeGroup(ids: Ids, text: string, labels: string[] = []): Group {
  return { id: ids.group(), labels, words: splitText(text).map((part) => ({ id: ids.word(), text: part, start: null, end: null })) };
}

/** One untimed group per non-empty line of `text`. */
export function groupsFromText(text: string, ids: Ids = idsFor()): Group[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => makeGroup(ids, line));
}

// ---------------------------------------------------------------- timing

/** When the group starts: its earliest word start. */
export function groupStart(group: Group): number | null {
  let min: number | null = null;
  for (const w of group.words) if (w.start !== null && (min === null || w.start < min)) min = w.start;
  return min;
}

/** The latest word start. */
export function lastStart(group: Group): number | null {
  let max: number | null = null;
  for (const w of group.words) if (w.start !== null && (max === null || w.start > max)) max = w.start;
  return max;
}

/** When the group stops sounding: the latest known word end, as long as it comes after every start. */
export function groupEnd(group: Group): number | null {
  let end: number | null = null;
  for (const w of group.words) if (w.end !== null && (end === null || w.end > end)) end = w.end;
  const last = lastStart(group);
  return end !== null && (last === null || end > last) ? end : null;
}

export function isTimed(group: Group): boolean {
  return group.words.some((w) => w.start !== null);
}

/**
 * Timings finer than the line start: a word after the first has a start, or some word has an end. A group that
 * was only tapped on the Lines step has just its first word's start.
 */
export function hasWordTimings(group: Group): boolean {
  return group.words.some((w, i) => w.end !== null || (i > 0 && w.start !== null));
}

/** Every sung word has a start (punctuation-only words ("—") needn't). */
export function wordsComplete(group: Group): boolean {
  return group.words.length > 0 && group.words.every((w) => w.start !== null || !isSung(w));
}

export function hasAnyWordTimings(doc: LyricsDoc): boolean {
  return doc.groups.some(hasWordTimings);
}

/** Where a word is: its group and position. */
export interface WordRef {
  group: number;
  word: number;
}

export function findWord(doc: LyricsDoc, wordId: string): WordRef | null {
  for (let g = 0; g < doc.groups.length; g++) {
    const w = doc.groups[g]!.words.findIndex((x) => x.id === wordId);
    if (w >= 0) return { group: g, word: w };
  }
  return null;
}

// ---------------------------------------------------------------- edits

export function updateGroup(doc: LyricsDoc, index: number, fn: (group: Group) => Group): LyricsDoc {
  const group = doc.groups[index];
  if (!group) return doc;
  const next = fn(group);
  if (next === group) return doc;
  return { ...doc, groups: doc.groups.map((g, i) => (i === index ? next : g)) };
}

function updateWord(doc: LyricsDoc, groupIndex: number, wordIndex: number, fn: (word: Word) => Word): LyricsDoc {
  return updateGroup(doc, groupIndex, (g) => {
    const word = g.words[wordIndex];
    if (!word) return g;
    const next = fn(word);
    return next === word ? g : { ...g, words: g.words.map((w, i) => (i === wordIndex ? next : w)) };
  });
}

/**
 * Moves a group to start at `ms`: its timed words shift along, keeping their spacing. An untimed group gets
 * `ms` as its first word's start. Null clears every timing in the group.
 */
export function withStart(group: Group, ms: number | null): Group {
  if (ms === null) {
    if (!group.words.some((w) => w.start !== null || w.end !== null)) return group;
    return { ...group, words: group.words.map((w) => ({ ...w, start: null, end: null })) };
  }
  const from = groupStart(group);
  if (from === null) {
    if (group.words.length === 0) return group;
    return { ...group, words: group.words.map((w, i) => (i === 0 ? { ...w, start: Math.max(0, ms) } : w)) };
  }
  const delta = ms - from;
  if (delta === 0) return group;
  const shift = (t: number | null) => (t === null ? null : Math.max(0, t + delta));
  return { ...group, words: group.words.map((w) => ({ ...w, start: shift(w.start), end: shift(w.end) })) };
}

export function setGroupStart(doc: LyricsDoc, index: number, ms: number | null): LyricsDoc {
  return updateGroup(doc, index, (g) => withStart(g, ms));
}

/**
 * New text for a group. A typo fix keeps the words' ids and timings (and joins) as long as the number of
 * whitespace-separated parts stays the same; otherwise the words are new and untimed, but the group keeps its start.
 */
export function withText(group: Group, text: string, ids: Ids): Group {
  const parts = splitText(text);
  if (parts.join(" ") === groupText(group)) return group;
  if (group.words.some((w) => w.noSpaceAfter)) return { ...group, words: newWords(parts, groupStart(group), ids) };
  const sizes = group.words.map((w) => wordParts(w).length);
  if (sizes.length > 0 && sizes.every((n) => n > 0) && sizes.reduce((a, b) => a + b, 0) === parts.length) {
    let next = 0;
    const words = group.words.map((w, i) => {
      const t = parts.slice(next, next + sizes[i]!).join(" ");
      next += sizes[i]!;
      return t === w.text ? w : { ...w, text: t };
    });
    return { ...group, words };
  }
  return { ...group, words: newWords(parts, groupStart(group), ids) };
}

/** Untimed words, except that the first keeps the group's start. */
function newWords(parts: string[], start: number | null, ids: Ids): Word[] {
  return parts.map((part, i) => ({ id: ids.word(), text: part, start: i === 0 ? start : null, end: null }));
}

export function setGroupText(doc: LyricsDoc, index: number, text: string): LyricsDoc {
  const ids = idsFor(doc.groups);
  return updateGroup(doc, index, (g) => withText(g, text, ids));
}

/** Sets when a word starts; an end that would no longer come after it is dropped. */
export function setWordStart(doc: LyricsDoc, groupIndex: number, wordIndex: number, start: number | null): LyricsDoc {
  return updateWord(doc, groupIndex, wordIndex, (w) => {
    if (w.start === start) return w;
    const end = start !== null && w.end !== null && w.end <= start ? null : w.end;
    return { ...w, start, end };
  });
}

/** Sets when a word stops sounding; an end at or before its start is refused (no change). */
export function setWordEnd(doc: LyricsDoc, groupIndex: number, wordIndex: number, end: number | null): LyricsDoc {
  return updateWord(doc, groupIndex, wordIndex, (w) => {
    if (w.end === end) return w;
    if (end !== null && w.start !== null && end <= w.start) return w;
    return { ...w, end };
  });
}

/** Sets both times at once (moving a whole word). */
export function setWordTimes(doc: LyricsDoc, groupIndex: number, wordIndex: number, start: number | null, end: number | null): LyricsDoc {
  return updateWord(doc, groupIndex, wordIndex, (w) => {
    if (w.start === start && w.end === end) return w;
    return { ...w, start, end: start !== null && end !== null && end <= start ? null : end };
  });
}

/** Moves the timed words with `wordIds` (starts and ends) by `deltaMs`, not before 0. */
export function shiftWords(doc: LyricsDoc, wordIds: ReadonlySet<string>, deltaMs: number): LyricsDoc {
  if (deltaMs === 0) return doc;
  let changed = false;
  const groups = doc.groups.map((g) => {
    if (!g.words.some((w) => wordIds.has(w.id) && w.start !== null)) return g;
    changed = true;
    const words = g.words.map((w) => {
      if (!wordIds.has(w.id) || w.start === null) return w;
      const delta = Math.max(-w.start, deltaMs);
      return { ...w, start: w.start + delta, end: w.end === null ? null : w.end + delta };
    });
    return { ...g, words };
  });
  return changed ? { ...doc, groups } : doc;
}

/** Inserts a new, untimed group of `text` (may be empty while it's being typed) at `index`. */
export function insertGroup(doc: LyricsDoc, index: number, text = "", labels: string[] = []): LyricsDoc {
  const group = makeGroup(idsFor(doc.groups), text, labels);
  const groups = [...doc.groups];
  groups.splice(Math.min(Math.max(0, index), groups.length), 0, group);
  return { ...doc, groups };
}

export function removeGroup(doc: LyricsDoc, index: number): LyricsDoc {
  if (index < 0 || index >= doc.groups.length) return doc;
  return { ...doc, groups: doc.groups.filter((_, i) => i !== index) };
}

/** Sets a group's labels, trimmed, without blanks or repeats. */
export function setLabels(doc: LyricsDoc, index: number, labels: string[]): LyricsDoc {
  const clean = [...new Set(labels.map((l) => l.trim()).filter((l) => l !== ""))];
  return updateGroup(doc, index, (g) => (clean.length === g.labels.length && clean.every((l, i) => l === g.labels[i]) ? g : { ...g, labels: clean }));
}
