import { mkdir } from "node:fs/promises";
import path from "node:path";
import transcribeScript from "./transcribe.py" with { type: "text" };
import type { Transcriber, TranscribeOptions, TranscribeResult } from "../../ports/transcriber";
import { parseProtocolLine } from "../../core/transcribe-protocol";
import { lrcgenCacheDir } from "../../core/xdg";
import { commandExists } from "../process-utils";

const STDERR_TAIL_LINES = 10;
/** What uv prints while it installs the script's dependencies (first run: several GB). */
const UV_PROGRESS_LINE = /^\s*(Downloading|Downloaded|Installed|Prepared|Resolved|Building|Built)\b/;

export async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        yield buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
      }
    }
  } finally {
    reader.releaseLock();
  }
  buffer += decoder.decode();
  if (buffer) yield buffer;
}

export interface PythonTranscriberOptions {
  /** Where transcribe.py is written before each run. */
  cacheDir?: string;
  /** The command that runs the script; tests swap uv for a fake. */
  command?: (scriptPath: string) => string[];
}

export class PythonTranscriber implements Transcriber {
  name = "Transcribe from audio (AI)";
  private available: boolean | null = null;
  private cacheDir: string;
  private command: (scriptPath: string) => string[];

  constructor(options: PythonTranscriberOptions = {}) {
    this.cacheDir = options.cacheDir ?? lrcgenCacheDir();
    this.command = options.command ?? ((scriptPath) => ["uv", "run", "--script", scriptPath]);
  }

  async isAvailable(): Promise<boolean> {
    if (this.available === null) this.available = await commandExists(this.command("")[0]!);
    return this.available;
  }

  async transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
    if (!(await this.isAvailable())) {
      return {
        success: false,
        error: "uv not found in PATH. Install it from https://docs.astral.sh/uv/ to use transcription.",
      };
    }
    const { settings, separateOnly } = options;
    if (!separateOnly && !settings.apiKey) {
      return { success: false, error: "No API key configured. Add one in Settings or set OPENROUTER_API_KEY." };
    }

    try {
      const scriptPath = path.join(this.cacheDir, "transcribe.py");
      await mkdir(this.cacheDir, { recursive: true });
      await mkdir(path.dirname(options.vocalsPath), { recursive: true });
      // Rewritten on every run so the script always matches the running build.
      await Bun.write(scriptPath, transcribeScript);

      const args = [options.audioPath, "--vocals", options.vocalsPath];
      if (separateOnly) args.push("--separate-only");
      else args.push("--base-url", settings.baseUrl, "--model", settings.model, "--align-lang", settings.alignLang);

      const proc = Bun.spawn([...this.command(scriptPath), ...args], {
        stdout: "pipe",
        stderr: "pipe",
        // The key goes through the environment, never argv, so it doesn't show up in `ps`.
        env: { ...process.env, ...(settings.apiKey ? { OPENAI_API_KEY: settings.apiKey } : {}) },
        signal: options.signal,
      });

      let result: TranscribeResult | null = null;
      let scriptStarted = false;
      const stderrTail: string[] = [];

      const readStdout = async () => {
        for await (const line of readLines(proc.stdout)) {
          const event = parseProtocolLine(line);
          if (!event) continue;
          scriptStarted = true;
          if (event.type === "stage") {
            const progress = { stage: event.stage, message: event.message };
            options.onProgress?.(event.progress === undefined ? progress : { ...progress, progress: event.progress });
          } else if (event.type === "result") {
            result = { success: true, lines: event.lines, rawLyrics: event.rawLyrics };
          } else {
            result = { success: false, error: event.message };
          }
        }
      };
      const readStderr = async () => {
        for await (const line of readLines(proc.stderr)) {
          if (!scriptStarted && UV_PROGRESS_LINE.test(line)) {
            options.onProgress?.({ stage: "init", message: line.trim() });
          }
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
