// The contract between the local server (src/server) and the browser app (src/web).
// Every route the server answers is listed here with its request and response shapes.
// Errors come back as a non-2xx status with an `ApiError` body.

import type { Group, LyricsDoc } from "../core/lyrics";
import type { TranscriptionSettings } from "../core/settings-defaults";
import type { TranscribeStage } from "../core/transcribe-protocol";

export interface ApiError {
  error: string;
}

// ---------------------------------------------------------------- app

/** GET /api/app */
export interface AppInfo {
  version: string;
  homeDir: string;
  /** Folders shown in the sidebar: XDG music and downloads dirs (when they exist) plus the ones the user added. */
  folders: FolderBookmark[];
  /** What `lrcgen <path>` was started with, resolved: an audio file opens straight into its draft, a folder opens in the browser. */
  launch: { kind: "audio"; path: string; draftId: string } | { kind: "folder"; path: string } | null;
}

export interface FolderBookmark {
  path: string;
  name: string;
  /** Added by the user (can be removed), as opposed to a built-in XDG folder. */
  custom: boolean;
}

/** POST /api/folders  body: { path }  →  FolderBookmark[] */
export interface AddFolderRequest {
  path: string;
}
/** DELETE /api/folders?path=…  →  FolderBookmark[] */

// ---------------------------------------------------------------- file browser

/** GET /api/fs/list?path=<dir> */
export interface DirListing {
  path: string;
  parent: string | null;
  /** Breadcrumbs from the nearest bookmarked folder (or /) down to `path`. */
  crumbs: { name: string; path: string }[];
  /** Subfolders first, then audio files; both sorted by name. Hidden entries and non-audio files are left out. */
  entries: DirEntry[];
}

export type DirEntry =
  | { kind: "dir"; name: string; path: string }
  | { kind: "audio"; name: string; path: string; durationMs: number | null; lyrics: LyricsFileInfo | null };

export type TimingLevel = "none" | "lines" | "words";

/** A lyrics file sitting next to an audio file with the same base name. */
export interface LyricsFileInfo {
  path: string;
  name: string;
  /** "lyrics": lrcgen's own ".lyrics.json". */
  format: "lyrics" | "lrc" | "txt";
  timing: TimingLevel;
  lineCount: number;
}

// ---------------------------------------------------------------- tracks

/** GET /api/track?path=<audio file> */
export interface TrackInfo {
  path: string;
  fileName: string;
  /** From tags, falling back to the file name. */
  title: string;
  artist: string | null;
  album: string | null;
  trackNo: number | null;
  /** "FLAC", "MP3", … */
  format: string;
  durationMs: number | null;
  hasCover: boolean;
  lyrics: LyricsFileInfo | null;
  draftId: string;
  /** Present when a draft for this track already exists. */
  draft: DraftSummary | null;
  /** A separated vocal stem is cached for this track: GET /api/vocals serves it. */
  hasVocals: boolean;
}

// GET /api/track/cover?path=<audio file>  →  image bytes (404 if none)
// GET /api/audio?path=<audio file>        →  the audio file, with Range support
// GET /api/vocals?path=<audio file>       →  the separated vocal stem (404 if none), with Range support.
//                                            Sample-aligned with the audio file.

/**
 * GET /api/lyrics-file?path=<.lyrics.json, .lrc or .txt>  → the file parsed; for an .lrc, word timings merged in from
 * a "*.enhanced.lrc" companion.
 */
export interface LyricsFileContent {
  path: string;
  doc: LyricsDoc;
  timing: TimingLevel;
}

// ---------------------------------------------------------------- drafts

export type Step = "lyrics" | "lines" | "words" | "refine" | "preview";
export const STEPS: Step[] = ["lyrics", "lines", "words", "refine", "preview"];

/** A song being worked on. Saved on the server as you go, so the app can be closed any time. */
export interface Draft {
  /** Stable id derived from the audio path. */
  id: string;
  audioPath: string;
  doc: LyricsDoc;
  step: Step;
  /**
   * Where "Save next to the track" writes the LRC; the lyrics file goes next to it ("Song.lrc" → "Song.lyrics.json").
   * Defaults to `<audio base name>.lrc` beside the audio.
   */
  lrcPath: string;
  /** Flag ids the user answered "It's intended" to. */
  dismissedFlags: string[];
  /** Last successful save to `lrcPath`, epoch ms. */
  savedAt: number | null;
  /** Last successful publish to LRCLIB, epoch ms. */
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface DraftSummary {
  id: string;
  audioPath: string;
  title: string;
  artist: string | null;
  step: Step;
  /** 0–5 filled segments of the progress bar in the Recent list. */
  stepsDone: number;
  /** "Words · 9 of 30 lines", "Published", "Lyrics in", … */
  status: string;
  updatedAt: number;
  /** The audio file is no longer where the draft says it is. */
  audioMissing: boolean;
}

/** GET /api/drafts  →  DraftSummary[], most recently updated first */

/** POST /api/drafts  → Draft. Returns the existing draft for that audio file if there is one. */
export interface OpenDraftRequest {
  audioPath: string;
  /** Start the new draft from this lyrics file (ignored when the draft already exists). */
  lyricsPath?: string;
}

// GET    /api/drafts/:id  →  Draft
// PUT    /api/drafts/:id  body: Draft  →  { updatedAt: number }
//        Only `doc`, `step`, `lrcPath` and `dismissedFlags` are taken from the body; the server owns the rest,
//        so a late autosave can't undo a save or publish.
// DELETE /api/drafts/:id  →  { ok: true }

// ---------------------------------------------------------------- lyrics database (LRCLIB)

/** GET /api/lrclib/search?artist=&title=[&album=]  →  LrclibResult[] */
export interface LrclibResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  durationMs: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

/** POST /api/lrclib/publish  →  PublishResponse. Can take a while: the proof-of-work runs on the server. */
export interface PublishRequest {
  draftId: string;
  /** What to publish; the server does not read the draft file for it. */
  doc: LyricsDoc;
  durationMs: number;
}
export interface PublishResponse {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------- saving

/** GET /api/save/check?path=<.lrc>  →  which of the files a save would write already exist */
export interface SaveCheck {
  /** The lyrics file ("Song.lyrics.json"), written on every save. */
  lyricsPath: string;
  /** The LRC files each choice writes besides it: the .lrc, plus the ".enhanced.lrc" companion for the enhanced format. */
  targets: { format: SaveFormat; paths: string[] }[];
  existing: string[];
}

/** What LRC goes next to the lyrics file: with word timings, lines only, or none. */
export type SaveFormat = "enhanced" | "lines" | "none";

/** POST /api/save */
export interface SaveRequest {
  draftId: string;
  /** The .lrc path; the lyrics file goes next to it. */
  path: string;
  format: SaveFormat;
  doc: LyricsDoc;
}
export interface SaveResponse {
  written: string[];
  /** Existing files are copied to "<name>.bak" before being overwritten. */
  backups: string[];
}

// ---------------------------------------------------------------- settings

export interface WebSettings {
  transcription: TranscriptionSettings;
  /** Audio output latency in ms per output device key (see `outputDeviceKey` in the web app). Positive = heard late. */
  latency: Record<string, number>;
  /** Folders the user added to the sidebar. */
  folders: string[];
}
// GET /api/settings  →  WebSettings (transcription resolved against env like the old TUI did)
// PUT /api/settings  body: WebSettings  →  WebSettings

// ---------------------------------------------------------------- background jobs (transcription, lyrics sync, vocal separation)

/** "align" syncs the user's own lyrics to the vocals: transcription without the recognition step. */
export type JobKind = "transcribe" | "align" | "separate";

/** POST /api/jobs  →  JobState. Starting a job for a track that already has one of that kind running returns the running one. */
export interface StartJobRequest {
  kind: JobKind;
  audioPath: string;
  /** The lyrics to sync, one line per line; required for "align" and only used there. */
  lyrics?: string;
}

export type JobStatus = "running" | "done" | "error" | "cancelled";

export interface JobState {
  id: string;
  kind: JobKind;
  audioPath: string;
  draftId: string;
  status: JobStatus;
  stage: TranscribeStage;
  message: string;
  /** 0–1 within the current stage when the pipeline reports it, else null. */
  progress: number | null;
  /** True on the very first run, while lrcgen downloads uv, the ML dependencies and models. */
  firstRun: boolean;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  /** A finished "align" job's groups, with the timings found; null otherwise. */
  groups: Group[] | null;
}

// GET    /api/jobs[?audioPath=]  →  JobState[] (running and recently finished)
// GET    /api/jobs/:id/events    →  text/event-stream of `JobEvent`, one JSON per `data:` line; starts with a "state" event
// DELETE /api/jobs/:id           →  JobState (cancels it)

export type JobEvent =
  | { type: "state"; job: JobState }
  | { type: "done"; job: JobState };

/** GET /api/transcripts/:draftId  →  the last finished transcription for that draft (404 if none). */
export interface Transcript {
  draftId: string;
  groups: Group[];
  rawLyrics: string;
  createdAt: number;
}
