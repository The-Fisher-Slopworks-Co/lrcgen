import { formatEnhancedLine, type ExportLine } from "../../core/lrc-export";
import { SimpleLrcParser } from "./simple-lrc-parser";

/** Writes Enhanced LRC: word timings as inline <mm:ss.xx> tags. Lines without them stay plain. */
export class EnhancedLrcParser extends SimpleLrcParser {
  protected override formatLine(line: ExportLine): string {
    return formatEnhancedLine(line);
  }
}
