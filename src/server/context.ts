import path from "node:path";
import type { AppInfo, FolderBookmark } from "../shared/api";
import type { Registry } from "../registry";
import type { DraftService } from "./drafts";
import type { JobManager } from "./jobs";
import type { Limiter } from "./keyed-lock";
import type { MediaInfo } from "./media-info";
import type { SettingsService } from "./settings";
import { bookmarks } from "./folders";

export interface ServerContext {
  registry: Registry;
  homeDir: string;
  cacheDir: string;
  launch: AppInfo["launch"];
  builtinFolders: string[];
  media: MediaInfo;
  settings: SettingsService;
  drafts: DraftService;
  jobs: JobManager;
  /** Caps parallel per-file work when listing a folder. */
  listLimiter: Limiter;
  heartbeatMs: number;
}

export function vocalsPath(cacheDir: string, draftId: string): string {
  return path.join(cacheDir, "stems", draftId, "vocals.flac");
}

export async function folderBookmarks(ctx: ServerContext): Promise<FolderBookmark[]> {
  return bookmarks(ctx.builtinFolders, (await ctx.settings.get()).folders);
}
