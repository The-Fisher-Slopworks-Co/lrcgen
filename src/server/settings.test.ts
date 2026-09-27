import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import type { WebSettings } from "../shared/api";
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from "../core/settings-defaults";
import { transcriptionToStore } from "./settings";
import { startTestApp, type TestApp } from "./test-helpers";

describe("transcriptionToStore", () => {
  const env = { OPENROUTER_API_KEY: "env-key" };
  const resolved = { apiKey: "env-key", baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, alignLang: "rus" };

  test("stores nothing that would apply anyway", () => {
    expect(transcriptionToStore({}, resolved, env)).toEqual({});
  });

  test("stores what differs, or what was stored before", () => {
    expect(transcriptionToStore({}, { ...resolved, apiKey: "mine", model: "m" }, env)).toEqual({ apiKey: "mine", model: "m" });
    expect(transcriptionToStore({ apiKey: "mine" }, resolved, env)).toEqual({ apiKey: "env-key" });
  });
});

describe("/api/settings", () => {
  let t: TestApp;
  const configFile = () => path.join(t.dirs.configDir, "config.json");

  beforeAll(async () => {
    t = await startTestApp({ env: { OPENROUTER_API_KEY: "env-key" } });
  });
  afterAll(() => t.close());

  const get = async () => (await (await t.api("/api/settings")).json()) as WebSettings;
  const put = async (settings: WebSettings) => {
    const res = await t.api("/api/settings", { method: "PUT", json: settings });
    expect(res.status).toBe(200);
    return (await res.json()) as WebSettings;
  };

  test("GET resolves transcription settings against the environment", async () => {
    expect(await get()).toEqual({
      transcription: { apiKey: "env-key", baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, alignLang: "rus" },
      latency: {},
      folders: [],
    });
  });

  test("PUT round-trips, without persisting a key that came from the environment", async () => {
    const current = await get();
    const next = { ...current, latency: { "default:speakers": 42.5 }, folders: [t.music] };
    expect(await put(next)).toEqual(next);
    expect(await get()).toEqual(next);

    const stored = await Bun.file(configFile()).json();
    expect(stored.transcription).toEqual({});
    expect(stored.latency).toEqual({ "default:speakers": 42.5 });
    expect(stored.folders).toEqual([t.music]);
  });

  test("a key the user typed is stored, and stays stored", async () => {
    const current = await get();
    await put({ ...current, transcription: { ...current.transcription, apiKey: "user-key" } });
    expect((await get()).transcription.apiKey).toBe("user-key");
    expect((await Bun.file(configFile()).json()).transcription).toEqual({ apiKey: "user-key" });

    await put({ ...current, transcription: { ...current.transcription, apiKey: "env-key" } });
    expect((await Bun.file(configFile()).json()).transcription).toEqual({ apiKey: "env-key" });
  });

  test("PUT validates the body", async () => {
    const current = await get();
    const bad = (body: object) => t.api("/api/settings", { method: "PUT", json: body });
    expect((await bad({ ...current, latency: { x: "fast" } })).status).toBe(400);
    expect((await bad({ ...current, folders: ["relative"] })).status).toBe(400);
    expect((await bad({ ...current, transcription: { apiKey: 1 } })).status).toBe(400);
  });
});
