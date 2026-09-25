import path from "node:path";
import { plainLrcPath } from "./enhanced-lrc";

const AUDIO_EXTENSIONS = [".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac", ".wma"];

export async function detectMatchingAudio(lrcPath: string): Promise<string | null> {
  const plainPath = plainLrcPath(lrcPath);
  const dir = path.dirname(plainPath);
  const base = path.basename(plainPath, path.extname(plainPath));

  for (const ext of AUDIO_EXTENSIONS) {
    const candidate = path.join(dir, base + ext);
    if (await Bun.file(candidate).exists()) {
      return candidate;
    }
  }

  return null;
}
