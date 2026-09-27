import { stat } from "node:fs/promises";
import type { ServerContext } from "../context";
import { badRequest, clientPath, notFound, readJson, type RouteTable } from "../http";
import { requireAudioFile } from "../audio-files";
import { isLyricsPath } from "../lyrics-files";
import { draftFields } from "../validate";

export function draftRoutes(ctx: ServerContext): RouteTable {
  return {
    "/api/drafts": {
      GET: async () => Response.json(await ctx.drafts.summaries()),
      POST: async (req) => {
        const body = await readJson(req);
        const audioPath = clientPath(body.audioPath, "audioPath");
        await requireAudioFile(audioPath);
        let lyricsPath: string | undefined;
        if (body.lyricsPath !== undefined && body.lyricsPath !== null) {
          lyricsPath = clientPath(body.lyricsPath, "lyricsPath");
          if (!isLyricsPath(lyricsPath)) throw badRequest("Only .lrc and .txt files can be read");
          if (!(await stat(lyricsPath).catch(() => null))?.isFile()) throw notFound(`File not found: ${lyricsPath}`);
        }
        return Response.json(await ctx.drafts.open(audioPath, lyricsPath));
      },
    },
    "/api/drafts/:id": {
      GET: async (req) => {
        const draft = await ctx.drafts.get(req.params.id!);
        if (!draft) throw notFound("No such draft");
        return Response.json(draft);
      },
      PUT: async (req) => {
        const body = await readJson(req);
        if (body.id !== undefined && body.id !== req.params.id) throw badRequest("The draft id doesn't match the URL");
        const draft = await ctx.drafts.update(req.params.id!, draftFields(body));
        if (!draft) throw notFound("No such draft");
        return Response.json({ updatedAt: draft.updatedAt });
      },
      DELETE: async (req) => {
        await ctx.drafts.remove(req.params.id!);
        return Response.json({ ok: true });
      },
    },
  };
}
