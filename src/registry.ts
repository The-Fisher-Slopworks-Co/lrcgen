import type { AudioSource } from "./ports/audio-source";
import type { LyricsProvider } from "./ports/lyrics-provider";
import type { LrcParser } from "./ports/lrc-parser";
import type { LyricsPublisher } from "./ports/lyrics-publisher";
import type { Transcriber } from "./ports/transcriber";
import type { SettingsStore } from "./ports/settings-store";
import { LocalAudioSource, type PlayerBackend } from "./adapters/audio-source/local-audio-source";
import { ClipboardLyricsProvider } from "./adapters/lyrics-provider/clipboard-lyrics-provider";
import { LrclibLyricsProvider } from "./adapters/lyrics-provider/lrclib-lyrics-provider";
import { SimpleLrcParser } from "./adapters/lrc-parser/simple-lrc-parser";
import { EnhancedLrcParser } from "./adapters/lrc-parser/enhanced-lrc-parser";
import { LrclibPublisher } from "./adapters/lyrics-publisher/lrclib-publisher";
import { PythonTranscriber } from "./adapters/transcriber/python-transcriber";
import { JsonFileSettingsStore } from "./adapters/settings-store/json-file-settings-store";

export interface Registry {
  audioSources: AudioSource[];
  lyricsProviders: LyricsProvider[];
  lyricsPublishers: LyricsPublisher[];
  transcribers: Transcriber[];
  lrcParser: LrcParser;
  enhancedLrcParser: LrcParser;
  settingsStore: SettingsStore;
}

export function createDefaultRegistry(backend: PlayerBackend = "mpv"): Registry {
  const lrcParser = new SimpleLrcParser();
  return {
    audioSources: [new LocalAudioSource(backend)],
    lyricsProviders: [new ClipboardLyricsProvider(), new LrclibLyricsProvider()],
    lyricsPublishers: [new LrclibPublisher()],
    transcribers: [new PythonTranscriber()],
    lrcParser,
    enhancedLrcParser: new EnhancedLrcParser(),
    settingsStore: new JsonFileSettingsStore(),
  };
}
