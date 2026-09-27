import type { LrcParser } from "./ports/lrc-parser";
import type { DraftStore } from "./ports/draft-store";
import type { LyricsPublisher } from "./ports/lyrics-publisher";
import type { LyricsSearch } from "./ports/lyrics-search";
import type { SettingsStore } from "./ports/settings-store";
import type { Transcriber } from "./ports/transcriber";
import type { TranscriptStore } from "./ports/transcript-store";
import { SimpleLrcParser } from "./adapters/lrc-parser/simple-lrc-parser";
import { EnhancedLrcParser } from "./adapters/lrc-parser/enhanced-lrc-parser";
import { JsonFileDraftStore } from "./adapters/draft-store/json-file-draft-store";
import { JsonFileSettingsStore } from "./adapters/settings-store/json-file-settings-store";
import { JsonFileTranscriptStore } from "./adapters/transcript-store/json-file-transcript-store";
import { LrclibLyricsProvider } from "./adapters/lyrics-provider/lrclib-lyrics-provider";
import { LrclibPublisher } from "./adapters/lyrics-publisher/lrclib-publisher";
import { PythonTranscriber } from "./adapters/transcriber/python-transcriber";
import { lrcgenCacheDir, lrcgenConfigDir, lrcgenDataDir } from "./core/xdg";

export interface Registry {
  lrcParser: LrcParser;
  enhancedLrcParser: LrcParser;
  settingsStore: SettingsStore;
  draftStore: DraftStore;
  transcriptStore: TranscriptStore;
  lyricsSearch: LyricsSearch;
  lyricsPublisher: LyricsPublisher;
  transcriber: Transcriber;
}

export interface AppDirs {
  dataDir: string;
  cacheDir: string;
  configDir: string;
}

export function defaultDirs(): AppDirs {
  return { dataDir: lrcgenDataDir(), cacheDir: lrcgenCacheDir(), configDir: lrcgenConfigDir() };
}

export function createDefaultRegistry(dirs: AppDirs = defaultDirs()): Registry {
  return {
    lrcParser: new SimpleLrcParser(),
    enhancedLrcParser: new EnhancedLrcParser(),
    settingsStore: new JsonFileSettingsStore(dirs.configDir),
    draftStore: new JsonFileDraftStore(dirs.dataDir),
    transcriptStore: new JsonFileTranscriptStore(dirs.dataDir),
    lyricsSearch: new LrclibLyricsProvider(),
    lyricsPublisher: new LrclibPublisher(),
    transcriber: new PythonTranscriber({ cacheDir: dirs.cacheDir }),
  };
}
