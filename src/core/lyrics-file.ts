// lrcgen's lyrics file, "Song.lyrics.json", written next to the track on save and read back as it is:
//
//   { "format": "lrcgen-lyrics", "version": 1,
//     "metadata": { "artist": "…", "title": "…", "album": "…", "tool": "https://github.com/txssu/lrcgen" },
//     "groups": [
//       { "id": "g1", "labels": [], "words": [{ "id": "w1", "text": "Never", "start": 12000, "end": 12380 }, …] },
//       { "id": "g2", "labels": ["backing"], "words": [ … ] } ] }
//
// Times are whole ms from the start of the song, null when not known; a word without an end lasts until the next
// word starts. Groups and the words in them are in reading order. Drafts keep the same shape.

import { groupsFromLrcLines, type LrcLine } from "./lrc-lines";
import { createDoc, withUniqueIds, type Group, type LyricsDoc, type Word } from "./lyrics";

export const LYRICS_FORMAT = "lrcgen-lyrics";
export const LYRICS_VERSION = 1;

const SUFFIX = ".lyrics.json";

export interface LyricsFile {
  format: typeof LYRICS_FORMAT;
  version: typeof LYRICS_VERSION;
  metadata: LyricsDoc["metadata"];
  groups: Group[];
}

/** "Song.lrc" → "Song.lyrics.json", next to it. */
export function lyricsFilePath(lrcPath: string): string {
  return lrcPath.replace(/\.lrc$/i, "") + SUFFIX;
}

export function isLyricsFilePath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(SUFFIX);
}

export function toLyricsFile(doc: LyricsDoc): LyricsFile {
  return {
    format: LYRICS_FORMAT,
    version: LYRICS_VERSION,
    metadata: doc.metadata,
    groups: doc.groups.filter((g) => g.words.length > 0).map((g) => ({ id: g.id, labels: g.labels, words: g.words.map(cleanWord) })),
  };
}

function cleanWord(w: Word): Word {
  const round = (t: number | null) => (t === null ? null : Math.round(t));
  const out: Word = { id: w.id, text: w.text, start: round(w.start), end: round(w.end) };
  if (w.noSpaceAfter) out.noSpaceAfter = true;
  return out;
}

export function serializeLyricsFile(doc: LyricsDoc): string {
  return `${JSON.stringify(toLyricsFile(doc), null, 2)}\n`;
}

// ---------------------------------------------------------------- reading

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTime = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);

function wordProblem(v: unknown): string | null {
  if (!isObject(v)) return "a word is not an object";
  if (typeof v.id !== "string" || typeof v.text !== "string") return "a word needs a string id and text";
  if (!isTime(v.start) || !isTime(v.end)) return `word "${v.id}" has a start or end that isn't ms or null`;
  if (v.noSpaceAfter !== undefined && typeof v.noSpaceAfter !== "boolean") return `word "${v.id}" has a noSpaceAfter that isn't true or false`;
  return null;
}

function groupProblem(v: unknown): string | null {
  if (!isObject(v)) return "a group is not an object";
  if (typeof v.id !== "string") return "a group needs a string id";
  if (!Array.isArray(v.labels) || !v.labels.every((l) => typeof l === "string")) return `group "${v.id}" needs a list of labels`;
  if (!Array.isArray(v.words)) return `group "${v.id}" needs a list of words`;
  for (const w of v.words) {
    const problem = wordProblem(w);
    if (problem) return problem;
  }
  return null;
}

/** What's wrong with `value` as a lyrics document ({ metadata, groups }), or null when nothing is. */
export function lyricsDocProblem(value: unknown): string | null {
  if (!isObject(value) || !isObject(value.metadata)) return "it has no metadata";
  if (!Object.values(value.metadata).every((v) => v === undefined || typeof v === "string")) return "the metadata must be strings";
  if (!Array.isArray(value.groups)) return "it has no groups";
  for (const g of value.groups) {
    const problem = groupProblem(g);
    if (problem) return problem;
  }
  return null;
}

function isLegacy(value: Record<string, unknown>): boolean {
  return value.groups === undefined && Array.isArray(value.lines);
}

function legacyLines(value: unknown[]): LrcLine[] {
  return value.filter(isObject).map((l) => ({
    timestamp: typeof l.timestamp === "number" ? l.timestamp : null,
    text: typeof l.text === "string" ? l.text : "",
    words: Array.isArray(l.words)
      ? l.words.filter(isObject).map((w) => ({ start: typeof w.start === "number" ? w.start : null, text: typeof w.text === "string" ? w.text : "" }))
      : undefined,
    end: typeof l.end === "number" ? l.end : null,
  }));
}

/**
 * A lyrics document from a parsed lyrics file or a stored draft — drafts from before groups (LRC-style `lines`)
 * too. Ids that clash get fresh ones. Throws when `value` isn't a lyrics document.
 */
export function readLyricsDoc(value: unknown): LyricsDoc {
  if (isObject(value) && isObject(value.metadata) && isLegacy(value)) {
    return createDoc(stringFields(value.metadata), groupsFromLrcLines(legacyLines(value.lines as unknown[])));
  }
  const problem = lyricsDocProblem(value);
  if (problem) throw new Error(`Not a lyrics document: ${problem}`);
  const doc = value as unknown as LyricsDoc;
  return createDoc(stringFields(doc.metadata), withUniqueIds(doc.groups.map((g) => ({ id: g.id, labels: g.labels, words: g.words.map(cleanWord) }))));
}

function stringFields(metadata: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(metadata)) if (typeof v === "string" && k !== "tool") out[k] = v;
  return out;
}

/** Reads the text of a ".lyrics.json" file. Throws when it isn't one. */
export function parseLyricsFile(text: string): LyricsDoc {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Not a lyrics file: it isn't JSON");
  }
  if (!isObject(value) || value.format !== LYRICS_FORMAT) throw new Error(`Not a lyrics file: "format" should be "${LYRICS_FORMAT}"`);
  if (typeof value.version !== "number" || value.version > LYRICS_VERSION) {
    throw new Error("This lyrics file is from a newer lrcgen. Update lrcgen to open it.");
  }
  return readLyricsDoc(value);
}
