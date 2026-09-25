import { useState, useEffect } from "react";
import type { Registry } from "../registry";
import type { LrcDocument } from "../core/lrc-document";
import type { AudioRef } from "../ports/audio-source";
import type { AudioPlayer } from "../ports/audio-player";
import { createDocument } from "../core/lrc-document";
import { StartScreen } from "./screens/start-screen";
import { ImportScreen } from "./screens/import-screen";
import { EditorScreen } from "./screens/edit-screen";
import { SettingsScreen } from "./screens/settings-screen";
import { BaseAudioPlayer } from "../adapters/audio-player/base-audio-player";
import { MpvAudioPlayer } from "../adapters/audio-player/mpv-audio-player";
import { detectMatchingAudio } from "../core/auto-detect-audio";
import { LocalAudioSource } from "../adapters/audio-source/local-audio-source";

type Screen = { name: "start" } | { name: "import" } | { name: "editor" } | { name: "settings" };

interface AppProps {
  registry: Registry;
  initialDocument?: LrcDocument;
  initialScreen?: Screen;
}

export function App({ registry, initialDocument, initialScreen }: AppProps) {
  const [screen, setScreen] = useState<Screen>(initialScreen ?? { name: "start" });
  const [document, setDocument] = useState<LrcDocument>(initialDocument ?? createDocument());
  const [audioRef, setAudioRef] = useState<AudioRef | null>(null);
  const [player, setPlayer] = useState<AudioPlayer | null>(null);

  useEffect(() => {
    return () => { player?.dispose(); };
  }, [player]);

  async function initPlayer(ref: AudioRef) {
    player?.dispose();
    const source = registry.audioSources.find((s) => s.name === ref.source) ?? registry.audioSources[0]!;
    const newPlayer = source.createPlayer(ref);
    if (newPlayer instanceof BaseAudioPlayer || newPlayer instanceof MpvAudioPlayer) {
      await newPlayer.init();
    }
    setPlayer(newPlayer);
    return newPlayer;
  }

  switch (screen.name) {
    case "start":
      return (
        <StartScreen
          onSelect={(action) => {
            if (action === "create") {
              setScreen({ name: "editor" });
            } else if (action === "import") {
              setScreen({ name: "import" });
            } else {
              setScreen({ name: "settings" });
            }
          }}
        />
      );

    case "import":
      return (
        <ImportScreen
          lrcParser={registry.lrcParser}
          onImport={async (doc, filePath) => {
            setDocument(doc);
            const audioPath = await detectMatchingAudio(filePath);
            if (audioPath) {
              const source = registry.audioSources[0] as LocalAudioSource;
              const ref = source.selectFromPath(audioPath);
              setAudioRef(ref);
              await initPlayer(ref);
            }
            setScreen({ name: "editor" });
          }}
          onCancel={() => setScreen({ name: "start" })}
        />
      );

    case "settings":
      return (
        <SettingsScreen
          settingsStore={registry.settingsStore}
          onDone={() => setScreen({ name: "start" })}
        />
      );

    case "editor":
      return (
        <EditorScreen
          registry={registry}
          document={document}
          audioRef={audioRef}
          player={player}
          onDocumentChange={setDocument}
          onAudioRefChange={async (ref) => {
            setAudioRef(ref);
            await initPlayer(ref);
          }}
          onQuit={() => process.exit(0)}
        />
      );

    default:
      return null;
  }
}
