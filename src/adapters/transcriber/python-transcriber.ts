import { mkdir } from "node:fs/promises";
import path from "node:path";
import transcribeScript from "./transcribe.py" with { type: "text" };
import type { Transcriber, TranscribeOptions, TranscribeResult } from "../../ports/transcriber";
import { parseProtocolLine } from "../../core/transcribe-protocol";
import { lrcgenCacheDir } from "../../core/xdg";
import { commandExists } from "../process-utils";

const STDERR_TAIL_LINES = 10;

export async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      yield buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) yield buffer;
}

export class PythonTranscriber implements Transcriber {
  name = "Transcribe from audio (AI)";
  private available: boolean | null = null;

  async isAvailable(): Promise<boolean> {
    if (this.available === null) this.available = await commandExists("uv");
    return this.available;
  }

  async transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
    if (!(await this.isAvailable())) {
      return {
        success: false,
        error: "uv not found in PATH. Install it from https://docs.astral.sh/uv/ to use transcription.",
      };
    }
    if (!options.settings.apiKey) {
      return {
        success: false,
        error: "No API key configured. Open Settings (S) or set OPENROUTER_API_KEY.",
      };
    }

    try {
      const cacheDir = lrcgenCacheDir();
      const scriptPath = path.join(cacheDir, "transcribe.py");
      await mkdir(cacheDir, { recursive: true });
      // Rewritten on every run so the script always matches the running build.
      await Bun.write(scriptPath, transcribeScript);

      const proc = Bun.spawn(
        [
          "uv", "run", "--script", scriptPath,
          options.audioPath,
          "--base-url", options.settings.baseUrl,
          "--model", options.settings.model,
          "--align-lang", options.settings.alignLang,
          "--separated-dir", path.join(cacheDir, "separated"),
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, OPENAI_API_KEY: options.settings.apiKey },
          signal: options.signal,
        },
      );

      let result: TranscribeResult | null = null;
      const stderrTail: string[] = [];

      const readStdout = async () => {
        for await (const line of readLines(proc.stdout)) {
          const event = parseProtocolLine(line);
          if (!event) continue;
          if (event.type === "stage") {
            options.onProgress?.({ stage: event.stage, message: event.message });
          } else if (event.type === "result") {
            result = { success: true, lines: event.lines, rawLyrics: event.rawLyrics };
          } else {
            result = { success: false, error: event.message };
          }
        }
      };
      const readStderr = async () => {
        for await (const line of readLines(proc.stderr)) {
          stderrTail.push(line);
          if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
        }
      };

      await Promise.all([readStdout(), readStderr()]);
      const exitCode = await proc.exited;

      if (options.signal?.aborted) return { success: false, error: "Cancelled" };
      if (result) return result;
      const tail = stderrTail.join("\n").trim();
      return {
        success: false,
        error: `transcribe.py exited with code ${exitCode}${tail ? `:\n${tail}` : ""}`,
      };
    } catch (e) {
      if (options.signal?.aborted) return { success: false, error: "Cancelled" };
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
