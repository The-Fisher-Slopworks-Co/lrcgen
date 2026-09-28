import os from "node:os";
import path from "node:path";
import type { BunRequest, HTMLBundle, Server } from "bun";
import type { AppInfo } from "../shared/api";
import { createDefaultRegistry, type AppDirs, type Registry } from "../registry";
import { vocalsPath, type ServerContext } from "./context";
import { DraftService } from "./drafts";
import { builtinFolders } from "./folders";
import { errorResponse, toErrorResponse, type Handler, type RouteTable } from "./http";
import { JobManager } from "./jobs";
import { Limiter } from "./keyed-lock";
import { MediaInfo } from "./media-info";
import { rejectReason } from "./security";
import { SettingsService } from "./settings";
import { appRoutes } from "./routes/app";
import { draftRoutes } from "./routes/drafts";
import { fileRoutes } from "./routes/files";
import { jobRoutes } from "./routes/jobs";
import { lrclibRoutes } from "./routes/lrclib";
import { saveRoutes } from "./routes/save";
import { settingsRoutes } from "./routes/settings";
import { trackRoutes } from "./routes/tracks";

const SHUTDOWN_GRACE_MS = 5000;

export interface ServerOptions extends AppDirs {
  /** 0 picks a free port. */
  port?: number;
  hostname?: string;
  homeDir?: string;
  env?: Record<string, string | undefined>;
  launch?: AppInfo["launch"];
  /** The web app, served at "/". */
  index?: HTMLBundle;
  /** Swap adapters (tests inject fakes). */
  registry?: Partial<Registry>;
  heartbeatMs?: number;
  /** Bun's dev mode for the web bundle: HMR and browser console forwarding. */
  development?: boolean;
}

export interface AppServer {
  server: Server<undefined>;
  url: string;
  context: ServerContext;
  /** Cancels running jobs, then stops the server. */
  stop(): Promise<void>;
}

function guard(handler: Handler, port: () => number): Handler {
  return async (req, server) => {
    const reason = rejectReason(req, port());
    if (reason) return errorResponse(403, reason);
    try {
      return await handler(req, server);
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

export async function createServer(options: ServerOptions): Promise<AppServer> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const registry = { ...createDefaultRegistry(options), ...options.registry };
  const media = new MediaInfo();
  const settings = new SettingsService(registry.settingsStore, env);
  const folders = await builtinFolders(homeDir, env);

  const ctx: ServerContext = {
    registry,
    homeDir,
    cacheDir: options.cacheDir,
    launch: options.launch ?? null,
    builtinFolders: folders,
    media,
    settings,
    drafts: new DraftService(registry.draftStore, media, registry.lrcParser),
    jobs: new JobManager({
      transcriber: registry.transcriber,
      transcripts: registry.transcriptStore,
      transcriptionSettings: () => settings.transcription(),
      vocalsPath: (draftId) => vocalsPath(options.cacheDir, draftId),
      depsMarkerPath: path.join(options.cacheDir, "deps-ready"),
    }),
    listLimiter: new Limiter(8),
    heartbeatMs: options.heartbeatMs ?? 15_000,
  };

  const tables: RouteTable[] = [
    appRoutes(ctx),
    fileRoutes(ctx),
    trackRoutes(ctx),
    draftRoutes(ctx),
    lrclibRoutes(ctx),
    saveRoutes(ctx),
    settingsRoutes(ctx),
    jobRoutes(ctx),
  ];

  let port = 0;
  const currentPort = () => port;
  const routes: Bun.Serve.Routes<undefined, string> = {};
  for (const table of tables) {
    for (const [route, methods] of Object.entries(table)) {
      routes[route] = Object.fromEntries(Object.entries(methods).map(([m, h]) => [m, guard(h, currentPort)]));
    }
  }
  if (options.index) routes["/"] = options.index;

  const notFoundHandler = guard(async () => errorResponse(404, "Not found"), currentPort);
  const server = Bun.serve<undefined, string>({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    // Bun sets SO_REUSEPORT in production mode unless told not to: a second lrcgen would then share
    // the port (requests split between the two) instead of failing and falling back to a free one.
    reusePort: false,
    development: options.development ?? false,
    routes,
    fetch: (req, server) => notFoundHandler(req as BunRequest<string>, server),
  });
  port = server.port ?? 0;

  return {
    server,
    url: `http://${server.hostname}:${port}`,
    context: ctx,
    async stop() {
      // Give cancelled pipelines a moment to exit, but don't hang on one that ignores SIGTERM.
      await Promise.race([ctx.jobs.shutdown(), Bun.sleep(SHUTDOWN_GRACE_MS)]);
      await server.stop(true);
    },
  };
}
