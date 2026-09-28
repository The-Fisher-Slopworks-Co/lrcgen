import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TranscribeProgressEvent } from "../../ports/transcriber";
import { groupText } from "../../core/lyrics";
import { PythonTranscriber, readLines } from "./python-transcriber";

// A stand-in for `uv run --script transcribe.py`: prints what uv and the script would, echoing its argv.
const FAKE = `
const args = Bun.argv.slice(2);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
process.stderr.write("Downloading torch (1.2GiB)\\n");
await Bun.sleep(20);
out({ type: "stage", stage: "init", message: "starting ..." });
await Bun.sleep(20);
process.stderr.write("Downloading something the script printed\\n");
out({ type: "stage", stage: "demucs", message: "separating", progress: 0.25 });
const lyricsFile = args[args.indexOf("--lyrics-file") + 1];
const raw = args.includes("--lyrics-file") ? await Bun.file(lyricsFile).text() : (process.env.OPENAI_API_KEY ?? "");
out({ type: "result", lines: [{ timestamp: 1, text: JSON.stringify(args) }], rawLyrics: raw });
`;

let dir: string;
let fakePath: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lrcgen-transcriber-"));
  fakePath = path.join(dir, "fake.ts");
  await Bun.write(fakePath, FAKE);
});

afterAll(() => rm(dir, { recursive: true, force: true }));

const settings = { apiKey: "secret", baseUrl: "https://api.example", model: "m" };

function transcriber() {
  return new PythonTranscriber({ cacheDir: path.join(dir, "cache"), command: () => ["bun", fakePath] });
}

describe("PythonTranscriber", () => {
  test("passes the stem path and settings, forwards progress and parses the result", async () => {
    const events: TranscribeProgressEvent[] = [];
    const vocalsPath = path.join(dir, "cache", "stems", "abc", "vocals.flac");
    const result = await transcriber().transcribe({
      audioPath: "/music/song.flac",
      vocalsPath,
      settings,
      onProgress: (e) => events.push(e),
    });

    expect(result.success).toBe(true);
    expect(JSON.parse(groupText(result.groups![0]!))).toEqual([
      "/music/song.flac", "--vocals", vocalsPath,
      "--base-url", "https://api.example", "--model", "m",
    ]);
    // The key travels in the environment.
    expect(result.rawLyrics).toBe("secret");
    expect(events).toEqual([
      { stage: "init", message: "Downloading torch (1.2GiB)" },
      { stage: "init", message: "starting ..." },
      { stage: "demucs", message: "separating", progress: 0.25 },
    ]);
    expect(await Bun.file(path.join(dir, "cache", "transcribe.py")).exists()).toBe(true);
  });

  test("separate-only needs no API key and skips the transcription options", async () => {
    const result = await transcriber().transcribe({
      audioPath: "/music/song.flac",
      vocalsPath: path.join(dir, "v.flac"),
      separateOnly: true,
      settings: { ...settings, apiKey: "" },
    });
    expect(JSON.parse(groupText(result.groups![0]!))).toEqual(["/music/song.flac", "--vocals", path.join(dir, "v.flac"), "--separate-only"]);
  });

  test("aligning given lyrics needs no API key and passes them in a file that is removed afterwards", async () => {
    const result = await transcriber().transcribe({
      audioPath: "/music/song.flac",
      vocalsPath: path.join(dir, "v.flac"),
      lyrics: "Первая строка\nSecond line",
      settings: { ...settings, apiKey: "" },
    });
    expect(result.success).toBe(true);
    const args = JSON.parse(groupText(result.groups![0]!)) as string[];
    const lyricsFile = args[args.indexOf("--lyrics-file") + 1]!;
    expect(args).toEqual(["/music/song.flac", "--vocals", path.join(dir, "v.flac"), "--lyrics-file", lyricsFile]);
    expect(result.rawLyrics).toBe("Первая строка\nSecond line");
    expect(await Bun.file(lyricsFile).exists()).toBe(false);
  });

  test("transcription without an API key fails up front", async () => {
    const result = await transcriber().transcribe({
      audioPath: "/music/song.flac",
      vocalsPath: path.join(dir, "v.flac"),
      settings: { ...settings, apiKey: "" },
    });
    expect(result).toEqual({ success: false, error: expect.stringContaining("No API key") });
  });
});

describe("readLines", () => {
  test("splits chunks into lines, keeping a trailing partial line", async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode("a\nb"));
        c.enqueue(enc.encode("c\n\nd"));
        c.close();
      },
    });
    const lines: string[] = [];
    for await (const line of readLines(stream)) lines.push(line);
    expect(lines).toEqual(["a", "bc", "", "d"]);
  });
});
