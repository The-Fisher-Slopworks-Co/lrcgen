import type { Group } from "../core/lyrics";
import type { TranscribeStage } from "../core/transcribe-protocol";
import type { TranscriptionSettings } from "../core/settings-defaults";

export interface TranscribeProgressEvent {
  stage: TranscribeStage;
  message: string;
  /** 0–1 within the stage, when the pipeline reports it. */
  progress?: number;
}

export interface TranscribeOptions {
  audioPath: string;
  /** Where the separated vocal stem lives (FLAC, sample-aligned with the audio). Reused when it exists. */
  vocalsPath: string;
  /** Stop after separating the vocals: no transcription, the result has no lines. */
  separateOnly?: boolean;
  /** Align these lyrics (one line per line) instead of transcribing them: no API call, no API key needed. */
  lyrics?: string;
  settings: TranscriptionSettings;
  onProgress?: (event: TranscribeProgressEvent) => void;
  signal?: AbortSignal;
}

export interface TranscribeResult {
  success: boolean;
  groups?: Group[];
  rawLyrics?: string;
  error?: string;
}

export interface Transcriber {
  name: string;
  isAvailable(): Promise<boolean>;
  transcribe(options: TranscribeOptions): Promise<TranscribeResult>;
}
