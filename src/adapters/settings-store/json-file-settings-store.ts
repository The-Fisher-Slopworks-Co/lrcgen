import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AppSettings, SaveResult, SettingsStore } from "../../ports/settings-store";
import { lrcgenConfigDir } from "../../core/xdg";

export class JsonFileSettingsStore implements SettingsStore {
  private path: string;

  constructor(configDir: string = lrcgenConfigDir()) {
    this.path = path.join(configDir, "config.json");
  }

  async load(): Promise<Partial<AppSettings>> {
    try {
      const file = Bun.file(this.path);
      if (!(await file.exists())) return {};
      return (await file.json()) as Partial<AppSettings>;
    } catch {
      return {};
    }
  }

  async save(settings: AppSettings): Promise<SaveResult> {
    try {
      await mkdir(path.dirname(this.path), { recursive: true });
      await Bun.write(this.path, JSON.stringify(settings, null, 2) + "\n");
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
    try {
      // The file holds an API key in plaintext — keep it owner-only.
      await chmod(this.path, 0o600);
    } catch {}
    return { success: true };
  }
}
