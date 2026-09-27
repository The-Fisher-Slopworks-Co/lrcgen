import type { LrcLine, LrcWord } from "./lrc-document";

const STAGES = ["init", "demucs", "api", "align"] as const;

export type TranscribeStage = (typeof STAGES)[number];

export type ProtocolLine =
  /** `progress` (0–1 within the stage) is sent when the pipeline can measure it. */
  | { type: "stage"; stage: TranscribeStage; message: string; progress?: number }
  | { type: "result"; lines: LrcLine[]; rawLyrics: string }
  | { type: "error"; stage: TranscribeStage; message: string };

function validateWords(value: unknown): LrcWord[] | null {
  if (!Array.isArray(value)) return null;
  const words: LrcWord[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { start, text } = item as Record<string, unknown>;
    if (start !== null && typeof start !== "number") return null;
    if (typeof text !== "string") return null;
    words.push({ start: start as number | null, text });
  }
  return words;
}

export function validateLrcLines(value: unknown): LrcLine[] | null {
  if (!Array.isArray(value)) return null;
  const lines: LrcLine[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { timestamp, text, words, end } = item as Record<string, unknown>;
    if (timestamp !== null && typeof timestamp !== "number") return null;
    if (typeof text !== "string") return null;
    const line: LrcLine = { timestamp: timestamp as number | null, text };
    if (words !== undefined) {
      const validWords = validateWords(words);
      if (!validWords) return null;
      // Words that don't spell out the line would corrupt it on save; the line timing alone is still good.
      if (validWords.map((w) => w.text).join("") === text.trim()) {
        line.words = validWords;
        if (typeof end === "number") line.end = end;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function parseProtocolLine(raw: string): ProtocolLine | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (obj.type === "stage" || obj.type === "error") {
    if (typeof obj.stage !== "string" || !(STAGES as readonly string[]).includes(obj.stage)) return null;
    if (typeof obj.message !== "string") return null;
    const line: ProtocolLine = { type: obj.type, stage: obj.stage as TranscribeStage, message: obj.message };
    if (line.type === "stage" && typeof obj.progress === "number" && Number.isFinite(obj.progress)) {
      line.progress = Math.min(1, Math.max(0, obj.progress));
    }
    return line;
  }

  if (obj.type === "result") {
    const lines = validateLrcLines(obj.lines);
    if (!lines) return null;
    return { type: "result", lines, rawLyrics: typeof obj.rawLyrics === "string" ? obj.rawLyrics : "" };
  }

  return null;
}
