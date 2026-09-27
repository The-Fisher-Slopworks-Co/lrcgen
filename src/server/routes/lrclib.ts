import type { PublishResponse } from "../../shared/api";
import type { ServerContext } from "../context";
import { HttpError, badRequest, optionalQuery, readJson, type RouteTable } from "../http";
import { lrcDocument } from "../validate";

export function lrclibRoutes(ctx: ServerContext): RouteTable {
  return {
    "/api/lrclib/search": {
      GET: async (req) => {
        const query = {
          title: optionalQuery(req, "title") ?? "",
          artist: optionalQuery(req, "artist"),
          album: optionalQuery(req, "album"),
        };
        try {
          return Response.json(await ctx.registry.lyricsSearch.search(query, req.signal));
        } catch (e) {
          throw new HttpError(502, e instanceof Error ? e.message : String(e));
        }
      },
    },
    "/api/lrclib/publish": {
      POST: async (req, server) => {
        // The proof-of-work sends nothing for a while; don't let the idle timeout drop the connection.
        server.timeout(req, 0);
        const body = await readJson(req);
        if (typeof body.draftId !== "string") throw badRequest(`Missing "draftId"`);
        if (typeof body.durationMs !== "number" || !(body.durationMs > 0)) throw badRequest(`"durationMs" must be positive`);
        const doc = lrcDocument(body.doc);
        const result = await ctx.registry.lyricsPublisher.publish(doc, body.durationMs);
        if (result.success) await ctx.drafts.mark(body.draftId, "publishedAt");
        const response: PublishResponse = result.success ? { success: true } : { success: false, error: result.error };
        return Response.json(response);
      },
    },
  };
}
