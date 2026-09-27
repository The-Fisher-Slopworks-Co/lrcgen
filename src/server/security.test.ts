import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rejectReason } from "./security";
import { startTestApp, type TestApp } from "./test-helpers";

const req = (method: string, headers: Record<string, string>) =>
  new Request("http://127.0.0.1:4471/api/app", { method, headers });

describe("rejectReason", () => {
  test("accepts the server's own host on GET", () => {
    expect(rejectReason(req("GET", { host: "127.0.0.1:4471" }), 4471)).toBeNull();
    expect(rejectReason(req("GET", { host: "localhost:4471" }), 4471)).toBeNull();
    expect(rejectReason(req("GET", { host: "localhost:4471", "sec-fetch-site": "none" }), 4471)).toBeNull();
  });

  test("rejects other hosts (DNS rebinding)", () => {
    expect(rejectReason(req("GET", { host: "evil.example:4471" }), 4471)).not.toBeNull();
    expect(rejectReason(req("GET", { host: "127.0.0.1:9999" }), 4471)).not.toBeNull();
    expect(rejectReason(req("GET", { host: "127.0.0.1" }), 4471)).not.toBeNull();
  });

  test("rejects cross-site requests even for GET", () => {
    expect(rejectReason(req("GET", { host: "127.0.0.1:4471", "sec-fetch-site": "cross-site" }), 4471)).not.toBeNull();
    expect(rejectReason(req("GET", { host: "127.0.0.1:4471", "sec-fetch-site": "same-site" }), 4471)).not.toBeNull();
  });

  test("requires same-origin for state-changing methods", () => {
    const host = "127.0.0.1:4471";
    expect(rejectReason(req("POST", { host }), 4471)).not.toBeNull();
    expect(rejectReason(req("POST", { host, origin: "http://evil.example" }), 4471)).not.toBeNull();
    expect(rejectReason(req("POST", { host, origin: "http://localhost:4471" }), 4471)).not.toBeNull();
    expect(rejectReason(req("POST", { host, origin: "http://127.0.0.1:4471" }), 4471)).toBeNull();
    expect(rejectReason(req("DELETE", { host, "sec-fetch-site": "same-origin" }), 4471)).toBeNull();
  });
});

describe("server guard", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(() => t.close());

  test("serves the app's own requests", async () => {
    const res = await t.api("/api/app");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("refuses a foreign Host header", async () => {
    const res = await fetch(`${t.url}/api/app`, { headers: { host: "attacker.example" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Unexpected Host header" });
  });

  test("refuses writes without a matching Origin", async () => {
    const body = JSON.stringify({ path: t.music });
    const noOrigin = await fetch(`${t.url}/api/folders`, { method: "POST", body });
    expect(noOrigin.status).toBe(403);
    const foreign = await fetch(`${t.url}/api/folders`, { method: "POST", body, headers: { origin: "http://evil.example" } });
    expect(foreign.status).toBe(403);
  });

  test("unknown routes are JSON 404s", async () => {
    const res = await t.api("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  test("a second server can't share the port", async () => {
    const port = t.app.server.port!;
    await expect(startTestApp({ port })).rejects.toThrow();
  });

  test("relative paths are refused", async () => {
    const res = await t.api("/api/fs/list?path=Music");
    expect(res.status).toBe(400);
  });
});
