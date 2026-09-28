import { stat } from "node:fs/promises";
import type { AppInfo } from "../../shared/api";
import pkg from "../../../package.json";
import { folderBookmarks, type ServerContext } from "../context";
import { clientPath, notFound, query, readJson, type RouteTable } from "../http";

const VERSION = (pkg as { version?: string }).version ?? "0.1.0";

export function appRoutes(ctx: ServerContext): RouteTable {
  return {
    "/api/app": {
      GET: async () => {
        const info: AppInfo = {
          version: VERSION,
          homeDir: ctx.homeDir,
          folders: await folderBookmarks(ctx),
          launch: ctx.launch,
        };
        return Response.json(info);
      },
    },
    "/api/folders": {
      POST: async (req) => {
        const dir = clientPath((await readJson(req)).path);
        if (!(await stat(dir).catch(() => null))?.isDirectory()) throw notFound(`Folder not found: ${dir}`);
        await ctx.settings.update((s) => {
          const folders = s.folders ?? [];
          return folders.includes(dir) || ctx.builtinFolders.includes(dir) ? s : { ...s, folders: [...folders, dir] };
        });
        return Response.json(await folderBookmarks(ctx));
      },
      DELETE: async (req) => {
        const dir = clientPath(query(req, "path"));
        await ctx.settings.update((s) => ({ ...s, folders: (s.folders ?? []).filter((f) => f !== dir) }));
        return Response.json(await folderBookmarks(ctx));
      },
    },
  };
}
