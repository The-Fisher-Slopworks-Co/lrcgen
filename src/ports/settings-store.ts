import type { TranscriptionSettings } from "../core/settings-defaults";

export interface AppSettings {
  transcription: Partial<TranscriptionSettings>;
}

export interface SaveResult {
  success: boolean;
  error?: string;
}

export interface SettingsStore {
  load(): Promise<Partial<AppSettings>>;
  save(settings: AppSettings): Promise<SaveResult>;
}
