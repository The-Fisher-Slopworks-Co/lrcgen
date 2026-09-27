// Hash routes, parsed and formatted without touching the DOM:
//   #/open?dir=<dir>&file=<audio file>       the file browser
//   #/song/<draftId>/<step>[?key=value…]      a song's workspace on one step (e.g. lyrics?transcribe=1)

import { STEPS, type Step } from "../../shared/api";

export type Route =
  | { name: "open"; dir: string | null; file: string | null }
  | { name: "song"; draftId: string; step: Step; params: Record<string, string> };

export function isStep(value: string): value is Step {
  return (STEPS as string[]).includes(value);
}

/** The route in a location hash ("#/song/abc/lines"), or null for anything unknown. */
export function parseRoute(hash: string): Route | null {
  const raw = hash.replace(/^#/, "");
  const q = raw.indexOf("?");
  const path = q === -1 ? raw : raw.slice(0, q);
  const search = new URLSearchParams(q === -1 ? "" : raw.slice(q + 1));
  const parts = path.split("/").filter((p) => p !== "").map(safeDecode);

  if (parts[0] === "open" && parts.length === 1) {
    return { name: "open", dir: search.get("dir") || null, file: search.get("file") || null };
  }
  if (parts[0] === "song" && parts.length === 3) {
    const [, draftId, step] = parts as [string, string, string];
    if (!draftId || !isStep(step)) return null;
    return { name: "song", draftId, step, params: Object.fromEntries(search) };
  }
  return null;
}

export function formatRoute(route: Route): string {
  if (route.name === "open") {
    const search = new URLSearchParams();
    if (route.dir) search.set("dir", route.dir);
    if (route.file) search.set("file", route.file);
    return withSearch("#/open", search);
  }
  const search = new URLSearchParams(route.params);
  return withSearch(`#/song/${encodeURIComponent(route.draftId)}/${route.step}`, search);
}

export function sameRoute(a: Route | null, b: Route | null): boolean {
  if (!a || !b) return a === b;
  return formatRoute(a) === formatRoute(b);
}

function withSearch(path: string, search: URLSearchParams): string {
  const s = search.toString();
  return s ? `${path}?${s}` : path;
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}
