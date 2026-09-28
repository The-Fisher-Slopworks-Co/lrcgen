import path from "node:path";
import type { Transcript } from "../../shared/api";
import type { TranscriptStore } from "../../ports/transcript-store";
import { groupsFromLrcLines, type LrcLine } from "../../core/lrc-lines";
import { lrcgenDataDir } from "../../core/xdg";
import { JsonDir } from "../json-dir";

/** The last transcription per draft, as `<dataDir>/transcripts/<draftId>.json`. */
export class JsonFileTranscriptStore implements TranscriptStore {
  private dir: JsonDir<Transcript & { lines?: LrcLine[] }>;

  constructor(dataDir: string = lrcgenDataDir()) {
    this.dir = new JsonDir(path.join(dataDir, "transcripts"));
  }

  async get(draftId: string): Promise<Transcript | null> {
    const stored = await this.dir.read(draftId);
    if (!stored) return null;
    // Transcripts from before groups have LRC-style lines. Their line ends go: a transcription gives word starts.
    if (!Array.isArray(stored.groups)) {
      const { lines, ...rest } = stored;
      const starts = (Array.isArray(lines) ? lines : []).map(({ end: _end, ...line }) => line);
      return { ...rest, groups: groupsFromLrcLines(starts) };
    }
    return stored;
  }

  put(transcript: Transcript): Promise<void> {
    return this.dir.write(transcript.draftId, transcript);
  }
}
