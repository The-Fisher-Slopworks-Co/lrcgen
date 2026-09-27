import path from "node:path";
import type { Transcript } from "../../shared/api";
import type { TranscriptStore } from "../../ports/transcript-store";
import { lrcgenDataDir } from "../../core/xdg";
import { JsonDir } from "../json-dir";

/** The last transcription per draft, as `<dataDir>/transcripts/<draftId>.json`. */
export class JsonFileTranscriptStore implements TranscriptStore {
  private dir: JsonDir<Transcript>;

  constructor(dataDir: string = lrcgenDataDir()) {
    this.dir = new JsonDir(path.join(dataDir, "transcripts"));
  }

  get(draftId: string): Promise<Transcript | null> {
    return this.dir.read(draftId);
  }

  put(transcript: Transcript): Promise<void> {
    return this.dir.write(transcript.draftId, transcript);
  }
}
