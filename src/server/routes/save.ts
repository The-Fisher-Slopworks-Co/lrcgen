import { stat } from "node:fs/promises";
import path from "node:path";
import type { SaveFormat } from "../../shared/api";
import type { ServerContext } from "../context";
import { badRequest, notFound, query, readJson, type RouteTable } from "../http";
import { saveCheck, saveLrc } from "../save-lrc";
import { lrcDocument, lrcTargetPath } from "../validate";

const FORMATS: SaveFormat[] = ["enhanced", "lines"];

export function saveRoutes(ctx: ServerContext): RouteTable {
  return {
    "/api/save/check": {
      GET: async (req) => Response.json(await saveCheck(lrcTargetPath(query(req, "path")))),
    },
    "/api/save": {
      POST: async (req) => {
        const body = await readJson(req);
        const lrcPath = lrcTargetPath(body.path);
        if (!FORMATS.includes(body.format as SaveFormat)) throw badRequest(`"format" must be one of ${FORMATS.join(", ")}`);
        if (typeof body.draftId !== "string") throw badRequest(`Missing "draftId"`);
        const doc = lrcDocument(body.doc);
        const dir = path.dirname(lrcPath);
        if (!(await stat(dir).catch(() => null))?.isDirectory()) throw notFound(`Folder not found: ${dir}`);

        const { lrcParser, enhancedLrcParser } = ctx.registry;
        const result = await saveLrc(lrcPath, body.format as SaveFormat, doc, lrcParser, enhancedLrcParser);
        await ctx.drafts.mark(body.draftId, "savedAt");
        return Response.json(result);
      },
    },
  };
}
