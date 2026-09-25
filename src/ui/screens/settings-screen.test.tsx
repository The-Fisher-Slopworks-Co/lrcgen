import { test, expect, describe } from "bun:test";
import { render } from "ink-testing-library";
import { SettingsScreen } from "./settings-screen";
import type { AppSettings } from "../../ports/settings-store";

const tick = () => new Promise((r) => setTimeout(r, 50));

function makeStore(initial: Partial<AppSettings> = {}) {
  const saved: AppSettings[] = [];
  return {
    saved,
    store: {
      load: async () => initial,
      save: async (settings: AppSettings) => {
        saved.push(settings);
        return { success: true };
      },
    },
  };
}

describe("SettingsScreen", () => {
  test("renders fields with stored values and masks the API key", async () => {
    const { store } = makeStore({ transcription: { apiKey: "secret", model: "test-model" } });
    const { lastFrame } = render(<SettingsScreen settingsStore={store} onDone={() => {}} />);
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain("Settings");
    expect(frame).toContain("API key");
    expect(frame).toContain("Base URL");
    expect(frame).toContain("Model");
    expect(frame).toContain("test-model");
    expect(frame).toContain("******");
    expect(frame).not.toContain("secret");
  });

  test("editing a field saves the updated settings", async () => {
    const { store, saved } = makeStore({ transcription: { apiKey: "k", model: "test-model" } });
    const { stdin } = render(<SettingsScreen settingsStore={store} onDone={() => {}} />);
    await tick();
    stdin.write("[B"); // down to Base URL
    stdin.write("[B"); // down to Model
    await tick();
    stdin.write("\r"); // start editing
    await tick();
    stdin.write("x");
    await tick();
    stdin.write("\r"); // submit
    await tick();
    expect(saved.length).toBe(1);
    expect(saved[0]!.transcription.model).toBe("test-modelx");
    expect(saved[0]!.transcription.apiKey).toBe("k");
  });

  test("escape calls onDone without saving", async () => {
    const { store, saved } = makeStore();
    let done = false;
    const { stdin } = render(<SettingsScreen settingsStore={store} onDone={() => { done = true; }} />);
    await tick();
    stdin.write("");
    await tick();
    expect(done).toBe(true);
    expect(saved.length).toBe(0);
  });
});
