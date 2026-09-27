import path from "node:path";
import { stat } from "node:fs/promises";
import { CryptoHasher } from "bun";
import { badRequest, notFound } from "./http";

const AUDIO_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wma": "audio/x-ms-wma",
  ".opus": "audio/ogg",
};

export function isAudioPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() in AUDIO_TYPES;
}

export function audioContentType(filePath: string): string {
  return AUDIO_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/** Stable id of the draft for an audio file: first 16 hex chars of sha256 of its absolute path. */
export function draftIdFor(audioPath: string): string {
  return new CryptoHasher("sha256").update(audioPath).digest("hex").slice(0, 16);
}

/** Throws a 400/404 unless `filePath` is an existing audio file. */
export async function requireAudioFile(filePath: string): Promise<void> {
  if (!isAudioPath(filePath)) throw badRequest(`Not an audio file: ${filePath}`);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) throw notFound(`File not found: ${filePath}`);
}
