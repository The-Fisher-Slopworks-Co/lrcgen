// Prototype server: serves index.html plus one draft's words, audio and vocal stem, read-only.
// bun prototypes/word-groups/serve.ts [draftId] [--port N]

import { homedir } from "node:os";
import path from "node:path";

const args = Bun.argv.slice(2);
const portFlag = args.indexOf("--port");
const port = portFlag === -1 ? 4490 : Number(args[portFlag + 1]);
const draftId = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port") ?? "c058938250ebb7b2";

const dataDir = path.join(process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share"), "lrcgen");
const cacheDir = path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), ".cache"), "lrcgen");
const draft = await Bun.file(path.join(dataDir, "drafts", `${draftId}.json`)).json();
const stemPath = path.join(cacheDir, "stems", draftId, "vocals.flac");

const root = import.meta.dir;
const repo = path.join(root, "..", "..");
const fontsDir = path.join(repo, "node_modules", "@fontsource");

/** Serves a file with Range support, so <audio> can seek. */
async function serveFile(req: Request, filePath: string): Promise<Response> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  const size = file.size;
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range) return new Response(file, { headers: { "Accept-Ranges": "bytes" } });
  const start = range[1] ? Number(range[1]) : size - Number(range[2]);
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Content-Type": file.type,
    },
  });
}

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const p = decodeURIComponent(url.pathname);
    if (p === "/") return new Response(Bun.file(path.join(root, "index.html")));
    if (p === "/draft.json") return Response.json(draft);
    if (p === "/tokens.css") return new Response(Bun.file(path.join(repo, "src", "web", "styles", "tokens.css")));
    if (p === "/mix") return serveFile(req, draft.audioPath);
    if (p === "/vocals") return serveFile(req, stemPath);
    if (p.startsWith("/fonts/")) {
      const f = path.normalize(path.join(fontsDir, p.slice("/fonts/".length)));
      if (!f.startsWith(fontsDir)) return new Response("Not found", { status: 404 });
      return serveFile(req, f);
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Prototype running at http://127.0.0.1:${server.port}`);
