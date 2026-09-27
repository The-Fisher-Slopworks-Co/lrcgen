import { stat } from "node:fs/promises";
import path from "node:path";
import type { AppInfo } from "../shared/api";
import { draftIdFor, isAudioPath } from "./audio-files";

/** What `lrcgen <path>` opens: an audio file goes straight into its draft, a folder opens in the browser. */
export async function resolveLaunch(target: string, cwd: string = process.cwd()): Promise<NonNullable<AppInfo["launch"]>> {
  const resolved = path.resolve(cwd, target);
  const info = await stat(resolved).catch(() => null);
  if (!info) throw new Error(`No such file or folder: ${target}`);
  if (info.isDirectory()) return { kind: "folder", path: resolved };
  if (info.isFile() && isAudioPath(resolved)) return { kind: "audio", path: resolved, draftId: draftIdFor(resolved) };
  throw new Error(`Not an audio file or a folder: ${target}`);
}
