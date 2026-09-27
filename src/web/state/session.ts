// App start-up and the open song's lifecycle. The hash route is the source of truth: `#/song/<id>/<step>`
// opens that draft (closing any other), `#/open…` closes it. Screens open a song with `openSong(path)`.

import type { Draft } from "../../shared/api";
import * as api from "../api/client";
import { errorMessage } from "../api/client";
import { player } from "../audio/player";
import { startOutputDeviceSync } from "../audio/output-device";
import { readLocal, writeLocal } from "../lib/storage";
import { currentRoute, navigate, subscribeRoute } from "../routing/router";
import type { Route } from "../routing/route";
import { currentAutosaver, patchSongIf, setAutosaver, setDraftStep, toast, toastError } from "./actions";
import { appStore } from "./app-state";
import { Autosaver } from "./autosave";
import { createHistory } from "./history";
import { loadSongExtras, resumeJobs } from "./jobs";
import { startTransportSync } from "./transport";

const LAST_DIR_KEY = "lrcgen.lastDir";

/** Loads app info and settings, picks the first screen, then follows the route. Call once. */
export async function boot(): Promise<void> {
  let app;
  try {
    const [info, settings] = await Promise.all([api.getApp(), api.getSettings()]);
    app = info;
    appStore.set({ app: info, settings, bootError: null });
  } catch (err) {
    appStore.set({ bootError: errorMessage(err) });
    return;
  }
  startOutputDeviceSync();
  startTransportSync();
  window.addEventListener("pagehide", flushOnUnload);
  void resumeJobs();

  if (!currentRoute()) {
    const launch = app.launch;
    if (launch?.kind === "audio") {
      const opened = await openSong(launch.path, { replace: true, lyricsPath: await sidecarLyrics(launch.path) });
      if (!opened) navigate({ name: "open", dir: dirName(launch.path), file: launch.path }, { replace: true });
    } else if (launch?.kind === "folder") {
      navigate({ name: "open", dir: launch.path, file: null }, { replace: true });
    } else {
      navigate({ name: "open", dir: readLocal(LAST_DIR_KEY), file: null }, { replace: true });
    }
  }
  subscribeRoute(() => void syncRoute(currentRoute()));
  await syncRoute(currentRoute());
}

/** Opens (creating if needed) the draft for an audio file and goes to its current step. */
export async function openSong(audioPath: string, options: { lyricsPath?: string; replace?: boolean } = {}): Promise<Draft | null> {
  try {
    const draft = await api.openDraft({ audioPath, lyricsPath: options.lyricsPath });
    navigate({ name: "song", draftId: draft.id, step: draft.step, params: {} }, { replace: options.replace });
    return draft;
  } catch (err) {
    toastError("Couldn't open the song", err);
    return null;
  }
}

/** Leaves the song for the file browser, at the song's folder. */
export function leaveSong(): void {
  const path = appStore.get().song?.draft.audioPath ?? null;
  navigate({ name: "open", dir: path ? dirName(path) : readLocal(LAST_DIR_KEY), file: path });
}

async function syncRoute(route: Route | null): Promise<void> {
  if (!route) return;
  if (route.name === "open") {
    if (route.dir) writeLocal(LAST_DIR_KEY, route.dir);
    await closeSong();
    return;
  }
  const { song, opening } = appStore.get();
  if (song?.draft.id === route.draftId) {
    setDraftStep(route.step);
    return;
  }
  if (opening?.draftId === route.draftId) return;
  await loadDraft(route.draftId, route.step);
}

async function loadDraft(draftId: string, step: Draft["step"]): Promise<void> {
  await closeSong();
  appStore.set({ opening: { draftId }, openError: null });
  let draft: Draft;
  let track = null;
  try {
    draft = await api.getDraft(draftId);
  } catch (err) {
    if (appStore.get().opening?.draftId === draftId) appStore.set({ opening: null, openError: errorMessage(err) });
    return;
  }
  try {
    track = await api.getTrack(draft.audioPath);
  } catch (err) {
    toastError("Couldn't read the audio file", err);
  }
  if (appStore.get().opening?.draftId !== draftId) return; // another song was opened meanwhile

  const saver = new Autosaver<Draft>({
    save: async (value, { keepalive }) => {
      const { updatedAt } = await api.putDraft(value, { keepalive });
      patchSongIf(value.id, (s) => ({ draft: { ...s.draft, updatedAt } }));
    },
    onStatus: (saveStatus, saveError) => patchSongIf(draftId, { saveStatus, saveError }),
  });
  setAutosaver(saver)?.dispose();

  appStore.set({
    opening: null,
    song: {
      draft,
      track,
      history: createHistory(draft.doc),
      selection: { line: 0, word: null },
      saveStatus: "saved",
      saveError: null,
      transcript: undefined,
      vocalsVersion: 0,
      loopLine: false,
    },
  });
  setDraftStep(step);

  player.load(draft.audioPath, {
    mixUrl: api.audioUrl(draft.audioPath),
    vocalsUrl: track?.hasVocals ? api.vocalsUrl(draft.audioPath, 0) : null,
    durationMs: track?.durationMs,
  });
  void loadSongExtras(draftId, draft.audioPath);
}

/** Saves and closes the open song, if any. */
export async function closeSong(): Promise<void> {
  const { song, opening } = appStore.get();
  if (!song && !opening) return;
  const saver = setAutosaver(null);
  appStore.set({ song: null, opening: null, openError: null, dialogs: [], pendingTranscript: null });
  player.unload();
  if (saver) {
    await saver.flush();
    if (saver.dirty) toast("The last changes to the draft weren't saved", { kind: "error" });
    saver.dispose();
  }
}

function flushOnUnload(): void {
  currentAutosaver()?.flushOnUnload();
}

/** For a song without a draft yet: the lyrics file next to it, which the Open screen loads by default too. */
async function sidecarLyrics(audioPath: string): Promise<string | undefined> {
  try {
    const track = await api.getTrack(audioPath);
    return track.draft ? undefined : track.lyrics?.path;
  } catch {
    return undefined;
  }
}

function dirName(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}
