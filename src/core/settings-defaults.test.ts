import { test, expect, describe } from "bun:test";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  resolveTranscriptionSettings,
} from "./settings-defaults";

describe("resolveTranscriptionSettings", () => {
  test("returns defaults when nothing is stored or in env", () => {
    const settings = resolveTranscriptionSettings(undefined, {});
    expect(settings).toEqual({
      apiKey: "",
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
    });
  });

  test("stored values win over env and defaults", () => {
    const settings = resolveTranscriptionSettings(
      { apiKey: "stored-key", baseUrl: "https://example.com", model: "m" },
      { OPENROUTER_API_KEY: "env-key", OPENAI_BASE_URL: "https://env.example.com" },
    );
    expect(settings.apiKey).toBe("stored-key");
    expect(settings.baseUrl).toBe("https://example.com");
    expect(settings.model).toBe("m");
  });

  test("env fills in missing apiKey and baseUrl", () => {
    const settings = resolveTranscriptionSettings({}, {
      OPENROUTER_API_KEY: "env-key",
      OPENAI_BASE_URL: "https://env.example.com",
    });
    expect(settings.apiKey).toBe("env-key");
    expect(settings.baseUrl).toBe("https://env.example.com");
  });

  test("OPENROUTER_API_KEY takes precedence over OPENAI_API_KEY", () => {
    const settings = resolveTranscriptionSettings({}, {
      OPENROUTER_API_KEY: "router-key",
      OPENAI_API_KEY: "openai-key",
    });
    expect(settings.apiKey).toBe("router-key");
  });

  test("empty stored strings fall through to env", () => {
    const settings = resolveTranscriptionSettings({ apiKey: "" }, { OPENAI_API_KEY: "env-key" });
    expect(settings.apiKey).toBe("env-key");
  });
});
