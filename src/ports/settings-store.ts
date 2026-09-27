import type { TranscriptionSettings } from "../core/settings-defaults";

export interface AppSettings {
  transcription: Partial<TranscriptionSettings>;
  /** Audio output latency in ms per output device key. */
  latency?: Record<string, number>;
  /** Folders the user added to the sidebar. */
  folders?: string[];
}

export interface SaveResult {
  success: boolean;
  error?: string;
}

export interface SettingsStore {
  load(): Promise<Partial<AppSettings>>;
  save(settings: AppSettings): Promise<SaveResult>;
}
