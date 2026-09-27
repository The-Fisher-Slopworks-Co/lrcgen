#!/usr/bin/env bun
import { parseArgs } from "node:util";
import type { AppInfo } from "./shared/api";
import { defaultDirs } from "./registry";
import { resolveLaunch } from "./server/launch";
import { createServer, type AppServer } from "./server/server";
import index from "./server/web";

const DEFAULT_PORT = 4471;

const USAGE = `Usage: lrcgen [path] [--port N] [--no-open]

Sync song lyrics in your browser. Starts a local server on 127.0.0.1 and opens it.

  path        an audio file to open, or a folder to browse
  --port N    port to listen on (default ${DEFAULT_PORT}, or any free one if taken)
  --no-open   don't open the browser; just print the URL
  -h, --help  show this help`;

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : ["xdg-open", url];
  try {
    const proc = Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true });
    proc.unref();
    proc.exited.catch(() => {});
  } catch {
    // The printed URL is the fallback.
  }
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: Bun.argv.slice(2),
      allowPositionals: true,
      options: {
        port: { type: "string" },
        "no-open": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`);
    process.exit(2);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (positionals.length > 1) {
    console.error(`Expected at most one path.\n\n${USAGE}`);
    process.exit(2);
  }

  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid port: ${values.port}`);
    process.exit(2);
  }

  let launch: AppInfo["launch"] = null;
  if (positionals[0] !== undefined) {
    try {
      launch = await resolveLaunch(positionals[0]);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  }

  const options = {
    ...defaultDirs(),
    launch,
    index,
    development: process.env.LRCGEN_DEV === "1",
  };
  let app: AppServer;
  try {
    app = await createServer({ ...options, port });
  } catch (e) {
    if (values.port !== undefined) {
      console.error(`Couldn't listen on port ${port}: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
    app = await createServer({ ...options, port: 0 });
  }

  console.log(`lrcgen is running at ${app.url}`);
  console.log("Press Ctrl+C to stop.");
  if (!values["no-open"]) openBrowser(app.url);

  let stopping = false;
  const stop = async () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log("\nStopping…");
    await app.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

await main();
