// The server lists folders, writes files and spawns processes, so only the app itself may talk to it:
// - Host must be the server's own (defeats DNS rebinding);
// - cross-site requests are refused outright (no-cors <img>/<audio> probes from other pages);
// - state-changing requests must come from the same origin (CSRF). No CORS headers are ever sent.

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/** Why the request is refused, or null when it may go through. */
export function rejectReason(req: Request, port: number): string | null {
  const host = req.headers.get("host");
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return "Unexpected Host header";

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") return "Cross-site requests are not allowed";

  if (SAFE_METHODS.has(req.method)) return null;
  if (fetchSite === "same-origin") return null;
  if (req.headers.get("origin") === `http://${host}`) return null;
  return "Cross-origin requests are not allowed";
}
