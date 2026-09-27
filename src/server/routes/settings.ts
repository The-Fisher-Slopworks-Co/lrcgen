import type { ServerContext } from "../context";
import { readJson, type RouteTable } from "../http";
import { webSettings } from "../validate";

export function settingsRoutes(ctx: ServerContext): RouteTable {
  return {
    "/api/settings": {
      GET: async () => Response.json(await ctx.settings.get()),
      PUT: async (req) => Response.json(await ctx.settings.put(webSettings(await readJson(req)))),
    },
  };
}
