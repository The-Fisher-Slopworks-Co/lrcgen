import type { LrcParser } from "../../ports/lrc-parser";
import type { LrcLine } from "../../core/lrc-lines";
import { groupsFromLrcLines } from "../../core/lrc-lines";
import { exportLines, formatPlainLine, type ExportLine } from "../../core/lrc-export";
import { createDoc, type LyricsDoc, type Metadata } from "../../core/lyrics";
import { lrcToMs, LRC_TIME_PATTERN } from "../../core/time-utils";
import { parseWordTags } from "./word-tags";

const METADATA_TAGS: Record<string, keyof Metadata> = {
  ar: "artist",
  ti: "title",
  al: "album",
};

const REVERSE_TAGS: Record<string, string> = {
  artist: "ar",
  title: "ti",
  album: "al",
};

const LINE_RE = new RegExp(`^\\[(${LRC_TIME_PATTERN})\\](.*)$`);

/** Reads LRC (word tags from Enhanced LRC too, so they never leak into the text); writes plain LRC. */
export class SimpleLrcParser implements LrcParser {
  parse(content: string): LyricsDoc {
    const metadata: Partial<Omit<Metadata, "tool">> = {};
    const lines: LrcLine[] = [];

    for (const raw of content.split("\n")) {
      const trimmed = raw.trim();
      if (!trimmed) continue;

      const metaMatch = trimmed.match(/^\[([a-z]+):(.+)\]$/i);
      if (metaMatch) {
        const tag = metaMatch[1]!.toLowerCase();
        const value = metaMatch[2]!.trim();
        const field = METADATA_TAGS[tag];
        if (field) {
          (metadata as Record<string, string>)[field] = value;
        }
        continue;
      }

      const lineMatch = trimmed.match(LINE_RE);
      if (lineMatch) {
        const timestamp = lrcToMs(lineMatch[1]!);
        lines.push({ timestamp, ...parseWordTags(lineMatch[2]!) });
        continue;
      }

      lines.push({ timestamp: null, ...parseWordTags(trimmed) });
    }

    return createDoc(metadata, groupsFromLrcLines(lines));
  }

  serialize(doc: LyricsDoc): string {
    const parts: string[] = [];
    for (const [field, tag] of Object.entries(REVERSE_TAGS)) {
      const value = doc.metadata[field];
      if (value) {
        parts.push(`[${tag}:${value}]`);
      }
    }
    parts.push(`[tool:${doc.metadata.tool}]`);
    for (const line of exportLines(doc)) {
      parts.push(this.formatLine(line));
    }
    return parts.join("\n");
  }

  protected formatLine(line: ExportLine): string {
    return formatPlainLine(line);
  }
}
