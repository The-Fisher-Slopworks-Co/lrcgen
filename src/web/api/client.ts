// Typed calls for every route in src/shared/api.ts. Failures throw `ApiRequestError` carrying the server's
// `ApiError` message; network failures throw it too, with status 0. URL builders cover the routes the
// browser loads directly (<audio src>, <img src>).

import type {
  AddFolderRequest,
  ApiError,
  AppInfo,
  DirListing,
  Draft,
  DraftSummary,
  FolderBookmark,
  JobEvent,
  JobState,
  LrclibResult,
  LyricsFileContent,
  OpenDraftRequest,
  PublishRequest,
  PublishResponse,
  SaveCheck,
  SaveRequest,
  SaveResponse,
  StartJobRequest,
  TrackInfo,
  Transcript,
  WebSettings,
} from "../../shared/api";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.error);
    this.name = "ApiRequestError";
  }
}

/** The message to show for anything thrown by an API call. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

type Query = Record<string, string | number | null | undefined>;

function url(path: string, query: Query = {}): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v != null && v !== "") search.set(k, String(v));
  const s = search.toString();
  return s ? `${path}?${s}` : path;
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...init,
    });
  } catch (err) {
    throw new ApiRequestError(0, { error: `Can't reach lrcgen — is it still running? (${errorMessage(err)})` });
  }
  if (!res.ok) {
    let error = `${res.status} ${res.statusText}`;
    try {
      const parsed = (await res.json()) as Partial<ApiError>;
      if (typeof parsed.error === "string") error = parsed.error;
    } catch {
      // Not JSON: keep the status line.
    }
    throw new ApiRequestError(res.status, { error });
  }
  return (await res.json()) as T;
}

const get = <T>(path: string, query?: Query) => request<T>("GET", url(path, query));

// ---------------------------------------------------------------- app, folders, file browser

export const getApp = () => get<AppInfo>("/api/app");

export const addFolder = (path: string) => request<FolderBookmark[]>("POST", "/api/folders", { path } satisfies AddFolderRequest);
export const removeFolder = (path: string) => request<FolderBookmark[]>("DELETE", url("/api/folders", { path }));

export const listDir = (path: string) => get<DirListing>("/api/fs/list", { path });

// ---------------------------------------------------------------- tracks, audio, lyrics files

export const getTrack = (path: string) => get<TrackInfo>("/api/track", { path });

export const coverUrl = (path: string) => url("/api/track/cover", { path });
export const audioUrl = (path: string) => url("/api/audio", { path });
/** `version` busts the browser cache after a separation job writes a new stem. */
export const vocalsUrl = (path: string, version?: number) => url("/api/vocals", { path, v: version });

export const getLyricsFile = (path: string) => get<LyricsFileContent>("/api/lyrics-file", { path });

// ---------------------------------------------------------------- drafts

export const listDrafts = () => get<DraftSummary[]>("/api/drafts");
export const openDraft = (req: OpenDraftRequest) => request<Draft>("POST", "/api/drafts", req);
export const getDraft = (id: string) => get<Draft>(`/api/drafts/${encodeURIComponent(id)}`);
/** `keepalive` lets the request outlive the page (flush on close). */
export const putDraft = (draft: Draft, options: { keepalive?: boolean } = {}) =>
  request<{ updatedAt: number }>("PUT", `/api/drafts/${encodeURIComponent(draft.id)}`, draft, { keepalive: options.keepalive });
export const deleteDraft = (id: string) => request<{ ok: true }>("DELETE", `/api/drafts/${encodeURIComponent(id)}`);

// ---------------------------------------------------------------- LRCLIB

export const searchLrclib = (q: { artist: string; title: string; album?: string | null }) =>
  get<LrclibResult[]>("/api/lrclib/search", q);
export const publish = (req: PublishRequest) => request<PublishResponse>("POST", "/api/lrclib/publish", req);

// ---------------------------------------------------------------- saving

export const checkSave = (path: string) => get<SaveCheck>("/api/save/check", { path });
export const save = (req: SaveRequest) => request<SaveResponse>("POST", "/api/save", req);

// ---------------------------------------------------------------- settings

export const getSettings = () => get<WebSettings>("/api/settings");
export const putSettings = (settings: WebSettings) => request<WebSettings>("PUT", "/api/settings", settings);

// ---------------------------------------------------------------- jobs, transcripts

export const startJob = (req: StartJobRequest) => request<JobState>("POST", "/api/jobs", req);
export const listJobs = (audioPath?: string) => get<JobState[]>("/api/jobs", { audioPath });
export const cancelJob = (id: string) => request<JobState>("DELETE", `/api/jobs/${encodeURIComponent(id)}`);

/** The last finished transcription for a draft, or null when there is none. */
export async function getTranscript(draftId: string): Promise<Transcript | null> {
  try {
    return await get<Transcript>(`/api/transcripts/${encodeURIComponent(draftId)}`);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Follows a job's event stream until its "done" event. Reconnects with backoff when the stream drops;
 * after `maxRetries` failed reconnects in a row it calls `onLost` (the job may be gone: check `listJobs`).
 * Returns an unsubscribe function.
 */
export function subscribeJob(
  id: string,
  onEvent: (event: JobEvent) => void,
  options: { onLost?: () => void; maxRetries?: number } = {},
): () => void {
  const maxRetries = options.maxRetries ?? 6;
  let source: EventSource | null = null;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const close = () => {
    closed = true;
    source?.close();
    source = null;
    if (timer) clearTimeout(timer);
  };

  const connect = () => {
    if (closed) return;
    const es = new EventSource(`/api/jobs/${encodeURIComponent(id)}/events`);
    source = es;
    es.onmessage = (msg) => {
      retries = 0;
      let event: JobEvent;
      try {
        event = JSON.parse(msg.data) as JobEvent;
      } catch {
        return;
      }
      // The server ends the stream after "done"; EventSource would reconnect on its own, so close first.
      if (event.type === "done") close();
      onEvent(event);
    };
    es.onerror = () => {
      if (closed) return;
      es.close();
      if (retries >= maxRetries) {
        close();
        options.onLost?.();
        return;
      }
      const delay = Math.min(10_000, 500 * 2 ** retries);
      retries++;
      timer = setTimeout(connect, delay);
    };
  };

  connect();
  return close;
}
