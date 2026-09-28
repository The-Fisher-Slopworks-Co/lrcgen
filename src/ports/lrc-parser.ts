import type { LyricsDoc } from "../core/lyrics";

/** LRC (and Enhanced LRC) in and out: import and export formats; the document itself is lrcgen's own. */
export interface LrcParser {
  parse(content: string): LyricsDoc;
  serialize(doc: LyricsDoc): string;
}
