import path from "node:path";
import type { TrackInfo } from "../../shared/api";
import { vocalsPath, type ServerContext } from "../context";
import { badRequest, clientPath, notFound, query, type RouteTable } from "../http";
import { audioContentType, draftIdFor, isAudioPath, requireAudioFile } from "../audio-files";
import { findLyricsFile } from "../lyrics-files";
import { summarize } from "../drafts";

async function audioParam(req: Request): Promise<string> {
  const filePath = clientPath(query(req, "path"));
  await requireAudioFile(filePath);
  return filePath;
}

export function trackRoutes(ctx: ServerContext): RouteTable {
  return {
    "/api/track": {
      GET: async (req) => {
        const filePath = await audioParam(req);
        const draftId = draftIdFor(filePath);
        const [tags, lyrics, draft, hasVocals] = await Promise.all([
          ctx.media.tags(filePath),
          findLyricsFile(filePath, ctx.registry.lrcParser),
          ctx.drafts.get(draftId),
          Bun.file(vocalsPath(ctx.cacheDir, draftId)).exists(),
        ]);
        const info: TrackInfo = {
          path: filePath,
          fileName: path.basename(filePath),
          title: tags.title ?? path.basename(filePath, path.extname(filePath)),
          artist: tags.artist,
          album: tags.album,
          trackNo: tags.trackNo,
          format: tags.format,
          durationMs: tags.durationMs,
          hasCover: tags.hasCover,
          lyrics,
          draftId,
          draft: draft ? summarize(draft, false) : null,
          hasVocals,
        };
        return Response.json(info);
      },
    },
    "/api/track/cover": {
      GET: async (req) => {
        const cover = await ctx.media.cover(await audioParam(req));
        if (!cover) throw notFound("No cover art");
        return new Response(new Uint8Array(cover.data), { headers: { "Content-Type": cover.format, "Cache-Control": "no-cache" } });
      },
    },
    "/api/audio": {
      // A BunFile body gets Range, Content-Length and Last-Modified handling from Bun.
      GET: async (req) => {
        const filePath = await audioParam(req);
        return new Response(Bun.file(filePath), { headers: { "Content-Type": audioContentType(filePath) } });
      },
    },
    "/api/vocals": {
      GET: async (req) => {
        const filePath = clientPath(query(req, "path"));
        if (!isAudioPath(filePath)) throw badRequest(`Not an audio file: ${filePath}`);
        const stem = Bun.file(vocalsPath(ctx.cacheDir, draftIdFor(filePath)));
        if (!(await stem.exists())) throw notFound("No separated vocals for this track");
        return new Response(stem, { headers: { "Content-Type": "audio/flac" } });
      },
    },
  };
}
