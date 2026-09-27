// Transport actions shared by the footer, the global keys and screens: play/pause, vocals only, loop line,
// previous/next line. "Loop line" follows the selection: selecting another line moves the loop to it.

import { lineSpan, timedLineFrom } from "../lib/timing";
import { player } from "../audio/player";
import { currentSong, patchSong, select, toast } from "./actions";
import { appStore } from "./app-state";
import { runningJob, startJob } from "./jobs";

export function togglePlay(): void {
  player.toggle();
}

/**
 * "Vocals only" (V): switches to the separated stem and back. Without a stem it offers to separate one
 * (a background job) instead.
 */
export function toggleVocals(): void {
  const state = player.getState();
  if (state.hasVocals) {
    player.setTrack(state.track === "vocals" ? "mix" : "vocals");
    return;
  }
  if (runningJob("separate") || runningJob("transcribe") || runningJob("align")) {
    toast("Still separating the vocals — V works once that's done");
    return;
  }
  if (!appStore.get().app?.capabilities.uv) {
    toast("Separating vocals needs uv (docs.astral.sh/uv) installed and in PATH", { kind: "error" });
    return;
  }
  toast("No vocal track yet", {
    action: { label: "Separate vocals", run: () => void startJob("separate") },
    durationMs: 8000,
  });
}

/** "Loop line" (L): loops the selected line; on again turns it off. */
export function toggleLoopLine(): void {
  const song = currentSong();
  if (!song) return;
  const on = !song.loopLine;
  if (on && !selectedLineSpan()) {
    toast("This line has no start time yet");
    return;
  }
  patchSong({ loopLine: on });
  syncLoop();
}

/** Previous/next line: selects it and, if it's timed, moves playback there. */
export function stepLine(dir: 1 | -1): void {
  const song = currentSong();
  if (!song) return;
  const doc = song.history.present.value;
  const target = Math.min(Math.max(0, song.selection.line + dir), Math.max(0, doc.lines.length - 1));
  select(target);
  const t = doc.lines[target]?.timestamp;
  if (t == null) return;
  if (player.getState().playing) player.play(t);
  else player.seek(t);
}

/** Seeks to the start of the nearest timed line at or before `index`. */
export function seekToLine(index: number): void {
  const song = currentSong();
  if (!song) return;
  const i = timedLineFrom(song.history.present.value, index, -1);
  const t = i >= 0 ? song.history.present.value.lines[i]!.timestamp : null;
  if (t != null) player.seek(t);
}

function selectedLineSpan() {
  const song = currentSong();
  if (!song) return null;
  return lineSpan(song.history.present.value, song.selection.line, player.getDuration());
}

function syncLoop(): void {
  const song = currentSong();
  const want = song?.loopLine ? selectedLineSpan() : null;
  const have = player.getState().loop;
  if (want?.from === have?.from && want?.to === have?.to) return;
  if (song?.loopLine && !want) {
    // The selected line has no time: keep looping the previous one rather than dropping the loop.
    return;
  }
  player.setLoop(want);
}

let started = false;

/** Keeps the loop on the selected line as the selection and timings change. Call once. */
export function startTransportSync(): void {
  if (started) return;
  started = true;
  let last: unknown = null;
  appStore.subscribe(() => {
    const song = appStore.get().song;
    const key = song && song.loopLine ? `${song.selection.line}|${song.history.present.at}` : null;
    if (key === last) return;
    last = key;
    // Only while "Loop line" is on: a custom A–B loop (Refine) is left alone.
    if (key !== null) syncLoop();
  });
}
