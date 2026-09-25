import type { AudioSource, AudioRef } from "../../ports/audio-source";
import type { AudioPlayer } from "../../ports/audio-player";
import { MpvAudioPlayer } from "../audio-player/mpv-audio-player";
import { FfplayAudioPlayer } from "../audio-player/ffplay-audio-player";
import path from "node:path";
import { commandExists } from "../process-utils";

export type PlayerBackend = "mpv" | "ffplay";

let detectedBackend: PlayerBackend | null = null;

export async function detectBackend(): Promise<PlayerBackend | null> {
  if (detectedBackend) return detectedBackend;
  if (await commandExists("mpv")) { detectedBackend = "mpv"; return "mpv"; }
  if (await commandExists("ffplay")) { detectedBackend = "ffplay"; return "ffplay"; }
  return null;
}

export class LocalAudioSource implements AudioSource {
  name = "Local File";
  private backend: PlayerBackend;

  constructor(backend: PlayerBackend = "mpv") {
    this.backend = backend;
  }

  async select(): Promise<AudioRef> {
    throw new Error("Use selectFromPath() instead");
  }

  selectFromPath(filePath: string): AudioRef {
    return { source: this.name, id: filePath, displayName: path.basename(filePath) };
  }

  createPlayer(ref: AudioRef): AudioPlayer {
    if (this.backend === "mpv") {
      return new MpvAudioPlayer(ref.id);
    }
    return new FfplayAudioPlayer(ref.id);
  }
}
