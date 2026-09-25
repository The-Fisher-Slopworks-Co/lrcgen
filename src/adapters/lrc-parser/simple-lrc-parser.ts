import type { LrcParser } from "../../ports/lrc-parser";
import type { LrcDocument, LrcLine, LrcMetadata } from "../../core/lrc-document";
import { createDocument } from "../../core/lrc-document";
import { msToLrc, lrcToMs, LRC_TIME_PATTERN } from "../../core/time-utils";
import { parseWordTags } from "./word-tags";

const METADATA_TAGS: Record<string, keyof LrcMetadata> = {
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

export class SimpleLrcParser implements LrcParser {
  parse(content: string): LrcDocument {
    const metadata: Partial<Omit<LrcMetadata, "tool">> = {};
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

      // Word tags from enhanced files are read too, so they never leak into the text.
      const lineMatch = trimmed.match(LINE_RE);
      if (lineMatch) {
        const timestamp = lrcToMs(lineMatch[1]!);
        lines.push({ timestamp, ...parseWordTags(lineMatch[2]!) });
        continue;
      }

      lines.push({ timestamp: null, ...parseWordTags(trimmed) });
    }

    const doc = createDocument(metadata);
    return { ...doc, lines };
  }

  serialize(doc: LrcDocument): string {
    const parts: string[] = [];
    for (const [field, tag] of Object.entries(REVERSE_TAGS)) {
      const value = doc.metadata[field];
      if (value) {
        parts.push(`[${tag}:${value}]`);
      }
    }
    parts.push(`[tool:${doc.metadata.tool}]`);
    for (const line of doc.lines) {
      parts.push(this.formatLine(line));
    }
    return parts.join("\n");
  }

  protected formatLine(line: LrcLine): string {
    const text = line.text.trim();
    return line.timestamp !== null ? `[${msToLrc(line.timestamp)}] ${text}` : text;
  }
}
