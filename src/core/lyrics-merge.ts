import {
  groupStart,
  groupText,
  hasWordTimings,
  idsFor,
  isTimed,
  splitText,
  withStart,
  withText,
  type Group,
  type Ids,
  type LyricsDoc,
  type Word,
} from "./lyrics";

// Bringing timings from elsewhere onto a document: new lyrics that keep the timings of lines that still match,
// word timings from a transcription, and the timings a lyrics sync found. Groups match by text, in order.

/** For each group of `groups`, the index of the group in `candidates` it matches; matching only moves forward. */
function matchInOrder(groups: Group[], candidates: Group[]): (number | null)[] {
  const keys = candidates.map((g) => normalize(groupText(g)));
  let next = 0;
  return groups.map((g) => {
    const k = normalize(groupText(g));
    if (k === "") return null;
    const j = keys.indexOf(k, next);
    if (j === -1) return null;
    next = j + 1;
    return j;
  });
}

// Transcriptions and lyrics sites disagree on case, punctuation and quotes; "ё" is often written as "е".
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/['’‘`´ʼ]/g, "")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The group with fresh ids for itself and its words. */
function renumbered(group: Group, ids: Ids): Group {
  return { ...group, id: ids.group(), words: group.words.map((w) => ({ ...w, id: ids.word() })) };
}

/**
 * Swaps in new lyrics, keeping the timings (line and word) and labels of groups whose text still matches one of
 * the old groups, matched in order. Returns how many groups kept their timings. Groups match ignoring case,
 * punctuation and extra whitespace; the new text wins, and word timings survive a changed text the way they
 * survive a typo fix (same number of parts), otherwise only the start does.
 */
export function replaceLyrics(doc: LyricsDoc, groups: Group[]): { doc: LyricsDoc; kept: number } {
  const matches = matchInOrder(groups, doc.groups);
  const ids = idsFor(doc.groups);
  let kept = 0;
  const merged = groups.map((g, i) => {
    const old = matches[i] == null ? undefined : doc.groups[matches[i]!];
    if (!old || !isTimed(old)) return renumbered(g, ids);
    kept++;
    const next = withText(old, groupText(g), ids);
    return old.labels.length > 0 || g.labels.length === 0 ? next : { ...next, labels: g.labels };
  });
  return { doc: { ...doc, groups: merged }, kept };
}

/** How many whitespace-separated parts of the word are more than punctuation. */
function partsOf(word: Word): number {
  return splitText(word.text).filter((part) => normalize(part) !== "").length;
}

/**
 * `shape`'s words with starts taken from `source` part by part (punctuation-only parts like "—" don't count): a word
 * starts where the source word its first part lines up with starts; null where that part sits inside a joined source
 * word, or for a punctuation-only word. Null if the parts don't line up.
 */
function mapStarts(shape: Word[], source: Word[]): Word[] | null {
  const parts = source.flatMap((w) => Array.from({ length: partsOf(w) }, (_, k) => (k === 0 ? w.start : null)));
  const sizes = shape.map(partsOf);
  if (sizes.reduce((a, b) => a + b, 0) !== parts.length) return null;
  let part = 0;
  return shape.map((w, i) => {
    const n = sizes[i]!;
    const start = n === 0 ? null : (parts[part] ?? null);
    part += n;
    return { ...w, start, end: null };
  });
}

/**
 * The group's words with the source's starts, keeping its own joins when they line up, else split afresh. None of
 * them keeps an end, the source's or its own: a word lasts until the next one starts unless someone sets its end.
 */
function adoptedWords(group: Group, source: Group, ids: Ids): Word[] | null {
  const same = source.words.length === group.words.length && source.words.every((w, i) => w.text === group.words[i]!.text);
  if (same) return group.words.map((w, i) => ({ ...w, start: source.words[i]!.start, end: null }));
  const own = mapStarts(group.words, source.words);
  if (own) return own;
  const split = group.words.flatMap((w) => splitText(w.text).map((text, k) => ({ id: k === 0 ? w.id : ids.word(), text, start: null, end: null })));
  return mapStarts(split, source.words);
}

/**
 * Copies word starts from `source` onto the groups of `doc` whose text matches, ignoring case, punctuation and
 * extra whitespace; groups are matched in order. The text of `doc` wins, and the words it times lose their ends.
 * Used for "Use transcription" on the Words step. Returns how many groups got word timings.
 */
export function adoptWordTimings(doc: LyricsDoc, source: Group[]): { doc: LyricsDoc; adopted: number } {
  const matches = matchInOrder(doc.groups, source);
  const ids = idsFor(doc.groups);
  let adopted = 0;
  const groups = doc.groups.map((g, i) => {
    const from = matches[i] == null ? undefined : source[matches[i]!];
    if (!from || !hasWordTimings(from)) return g;
    const words = adoptedWords(g, from, ids);
    if (!words) return g;
    adopted++;
    return { ...g, words };
  });
  return { doc: { ...doc, groups }, adopted };
}

/**
 * Puts the timings of a lyrics sync ("align" job) onto the groups of `doc`, which the sync was run on. Groups are
 * matched like adoptWordTimings (so edits made while it ran don't shift anything). A matched group takes the new
 * word starts, and its words lose their ends; if only its start was found, its old word timings go, as they'd no
 * longer fit. Returns how many groups got a start.
 */
export function applyAlignment(doc: LyricsDoc, source: Group[]): { doc: LyricsDoc; synced: number } {
  const matches = matchInOrder(doc.groups, source);
  const ids = idsFor(doc.groups);
  let synced = 0;
  const groups = doc.groups.map((g, i) => {
    const from = matches[i] == null ? undefined : source[matches[i]!];
    const start = from ? groupStart(from) : null;
    if (!from || start === null) return g;
    synced++;
    const words = hasWordTimings(from) ? adoptedWords(g, from, ids) : null;
    if (words) return { ...g, words };
    return withStart(withStart(g, null), start);
  });
  return { doc: { ...doc, groups }, synced };
}
