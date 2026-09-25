import type { LrcLine } from "../core/lrc-document";
import type { TranscribeStage } from "../core/transcribe-protocol";
import type { TranscriptionSettings } from "../core/settings-defaults";

export interface TranscribeProgressEvent {
  stage: TranscribeStage;
  message: string;
}

export interface TranscribeOptions {
  audioPath: string;
  settings: TranscriptionSettings;
  onProgress?: (event: TranscribeProgressEvent) => void;
  signal?: AbortSignal;
}

export interface TranscribeResult {
  success: boolean;
  lines?: LrcLine[];
  rawLyrics?: string;
  error?: string;
}

export interface Transcriber {
  name: string;
  isAvailable(): Promise<boolean>;
  transcribe(options: TranscribeOptions): Promise<TranscribeResult>;
}
