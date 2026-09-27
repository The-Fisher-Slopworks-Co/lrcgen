// The app's one SongPlayer and the React hooks around it. The store loads/unloads it as songs open and close;
// screens only call methods on it:
//   const player = usePlayer(); player.toggle(); player.playSegment(from, to); player.tapPosition();
//   const playing = usePlayerState((s) => s.playing);   // selector must return a primitive or an object
//                                                       // held in the state (s.loop) — no fresh objects
//   const ms = usePosition();                 // re-renders every frame while playing — keep such components small
//   usePositionEffect((ms, heard) => draw()); // no re-render: for canvases

import { useEffect, useRef, useSyncExternalStore } from "react";
import { SongPlayer, type PlayerState } from "./song-player";

export const player = new SongPlayer();

let position = { raw: 0, heard: 0 };
const positionListeners = new Set<() => void>();
player.onFrame((raw, heard) => {
  position = { raw, heard };
  for (const l of [...positionListeners]) l();
});

function subscribePosition(listener: () => void): () => void {
  positionListeners.add(listener);
  return () => positionListeners.delete(listener);
}

export function usePlayer(): SongPlayer {
  return player;
}

export function usePlayerState(): PlayerState;
export function usePlayerState<S>(selector: (state: PlayerState) => S): S;
export function usePlayerState<S>(selector?: (state: PlayerState) => S): S | PlayerState {
  const snapshot = () => (selector ? selector(player.getState()) : player.getState());
  return useSyncExternalStore(player.subscribe, snapshot);
}

/** The playback position in ms (what the audio element is at), updated every animation frame. */
export function usePosition(): number {
  return useSyncExternalStore(subscribePosition, () => position.raw);
}

/** What the user hears right now: the position minus output latency while playing. Use it for highlighting. */
export function useHeardPosition(): number {
  return useSyncExternalStore(subscribePosition, () => position.heard);
}

/** Calls `callback(positionMs, heardMs)` every frame while playing and on seek/pause, without re-rendering. */
export function usePositionEffect(callback: (positionMs: number, heardMs: number) => void): void {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    ref.current(position.raw, position.heard);
    return player.onFrame((raw, heard) => ref.current(raw, heard));
  }, []);
}
