import type { LyricsDoc } from "../core/lyrics";

export interface PublishResult {
  success: boolean;
  error?: string;
}

export interface LyricsPublisher {
  name: string;
  publish(doc: LyricsDoc, audioLengthMs: number): Promise<PublishResult>;
}
