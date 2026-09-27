import type { Transcript } from "../shared/api";

export interface TranscriptStore {
  get(draftId: string): Promise<Transcript | null>;
  put(transcript: Transcript): Promise<void>;
}
