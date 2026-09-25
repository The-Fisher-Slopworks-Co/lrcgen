import type { LrcLine } from "../../core/lrc-document";
import { hasWordTimings } from "../../core/lrc-document";
import { msToLrc } from "../../core/time-utils";
import { SimpleLrcParser } from "./simple-lrc-parser";
import { formatWordTags } from "./word-tags";

/** Writes Enhanced LRC: word timings as inline <mm:ss.xx> tags. Lines without them stay plain. */
export class EnhancedLrcParser extends SimpleLrcParser {
  protected override formatLine(line: LrcLine): string {
    if (!hasWordTimings(line)) return super.formatLine(line);
    const timestamp = line.timestamp ?? line.words!.find((w) => w.start !== null)!.start!;
    return `[${msToLrc(timestamp)}]${formatWordTags(line)}`;
  }
}
