import type { WebSettings } from "../shared/api";
import type { AppSettings, SettingsStore } from "../ports/settings-store";
import { resolveTranscriptionSettings, type TranscriptionSettings } from "../core/settings-defaults";
import { KeyedLock } from "./keyed-lock";

type Env = Record<string, string | undefined>;

const TRANSCRIPTION_KEYS = ["apiKey", "baseUrl", "model", "alignLang"] as const satisfies (keyof TranscriptionSettings)[];

/**
 * What to store for the transcription settings the user sent back. A value is stored only when it was stored
 * already or differs from what would apply anyway (env or default) — so a key that came from
 * OPENROUTER_API_KEY never ends up in the config file.
 */
export function transcriptionToStore(
  stored: Partial<TranscriptionSettings>,
  incoming: TranscriptionSettings,
  env: Env,
): Partial<TranscriptionSettings> {
  const fallback = resolveTranscriptionSettings({}, env);
  const out: Partial<TranscriptionSettings> = {};
  for (const key of TRANSCRIPTION_KEYS) {
    if (stored[key] !== undefined || incoming[key] !== fallback[key]) out[key] = incoming[key];
  }
  return out;
}

/** Settings read-modify-write, serialised so concurrent requests don't lose each other's changes. */
export class SettingsService {
  private lock = new KeyedLock();

  constructor(
    private store: SettingsStore,
    private env: Env,
  ) {}

  private async load(): Promise<AppSettings> {
    const stored = await this.store.load();
    return { ...stored, transcription: stored.transcription ?? {} };
  }

  private toWeb(settings: AppSettings): WebSettings {
    return {
      transcription: resolveTranscriptionSettings(settings.transcription, this.env),
      latency: settings.latency ?? {},
      folders: settings.folders ?? [],
    };
  }

  async get(): Promise<WebSettings> {
    return this.toWeb(await this.load());
  }

  async transcription(): Promise<TranscriptionSettings> {
    return (await this.get()).transcription;
  }

  async update(change: (current: AppSettings) => AppSettings): Promise<WebSettings> {
    return this.lock.run("settings", async () => {
      const next = change(await this.load());
      const result = await this.store.save(next);
      if (!result.success) throw new Error(`Couldn't save settings: ${result.error ?? "unknown error"}`);
      return this.toWeb(next);
    });
  }

  put(web: WebSettings): Promise<WebSettings> {
    return this.update((current) => ({
      ...current,
      transcription: transcriptionToStore(current.transcription, web.transcription, this.env),
      latency: web.latency,
      folders: web.folders,
    }));
  }
}
