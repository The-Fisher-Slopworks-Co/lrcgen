import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { DirEntry, DirListing, LyricsFileContent } from "../../shared/api";
import { folderBookmarks, type ServerContext } from "../context";
import { crumbsFor } from "../folders";
import { HttpError, badRequest, clientPath, notFound, query, type RouteTable } from "../http";
import { isAudioPath } from "../audio-files";
import { findLyricsFile, isLyricsPath, readLyricsFile, timingLevel } from "../lyrics-files";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name);

async function listDir(ctx: ServerContext, dir: string): Promise<DirListing> {
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) throw notFound(`Folder not found: ${dir}`);
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    throw new HttpError(403, `Can't open ${dir}: ${e instanceof Error ? e.message : String(e)}`);
  }

  const siblings = new Set(dirents.map((d) => d.name));
  const dirs: DirEntry[] = [];
  const audio: { name: string; path: string }[] = [];
  for (const d of dirents) {
    if (d.name.startsWith(".")) continue;
    const full = path.join(dir, d.name);
    let isDir = d.isDirectory();
    let isFile = d.isFile();
    if (d.isSymbolicLink()) {
      const target = await stat(full).catch(() => null);
      isDir = target?.isDirectory() ?? false;
      isFile = target?.isFile() ?? false;
    }
    if (isDir) dirs.push({ kind: "dir", name: d.name, path: full });
    else if (isFile && isAudioPath(d.name)) audio.push({ name: d.name, path: full });
  }

  const audioEntries = await Promise.all(
    audio.sort(byName).map((f) =>
      ctx.listLimiter.run(async (): Promise<DirEntry> => {
        const [durationMs, lyrics] = await Promise.all([
          ctx.media.duration(f.path),
          findLyricsFile(f.path, ctx.registry.lrcParser, siblings),
        ]);
        return { kind: "audio", name: f.name, path: f.path, durationMs, lyrics };
      }),
    ),
  );

  const parent = path.dirname(dir);
  return {
    path: dir,
    parent: parent === dir ? null : parent,
    crumbs: crumbsFor(dir, await folderBookmarks(ctx)),
    entries: [...dirs.sort(byName), ...audioEntries],
  };
}

export function fileRoutes(ctx: ServerContext): RouteTable {
  return {
    "/api/fs/list": {
      GET: async (req) => Response.json(await listDir(ctx, clientPath(query(req, "path")))),
    },
    "/api/lyrics-file": {
      GET: async (req) => {
        const filePath = clientPath(query(req, "path"));
        if (!isLyricsPath(filePath)) throw badRequest("Only .lyrics.json, .lrc and .txt files can be read");
        if (!(await stat(filePath).catch(() => null))?.isFile()) throw notFound(`File not found: ${filePath}`);
        const doc = await readLyricsFile(filePath, ctx.registry.lrcParser);
        const content: LyricsFileContent = { path: filePath, doc, timing: timingLevel(doc) };
        return Response.json(content);
      },
    },
  };
}
