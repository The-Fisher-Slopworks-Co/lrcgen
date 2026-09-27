// The current hash route as an external store: `useRoute()` re-renders on change, `navigate()` changes it.
// Step changes inside a song replace the history entry; moving between songs/folders pushes one.

import { useSyncExternalStore } from "react";
import type { Step } from "../../shared/api";
import { formatRoute, parseRoute, type Route } from "./route";

const listeners = new Set<() => void>();
let current: Route | null = parseRoute(location.hash);

window.addEventListener("hashchange", () => {
  current = parseRoute(location.hash);
  for (const l of listeners) l();
});

export function currentRoute(): Route | null {
  return current;
}

export function useRoute(): Route | null {
  return useSyncExternalStore(subscribeRoute, currentRoute);
}

export function subscribeRoute(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  const hash = formatRoute(route);
  if (hash === location.hash) return;
  if (options.replace) {
    history.replaceState(null, "", hash);
    current = parseRoute(hash);
    for (const l of listeners) l();
  } else {
    location.hash = hash;
  }
}

/** Opens the file browser, optionally at a folder with a file selected. */
export function goToOpen(dir: string | null = null, file: string | null = null): void {
  navigate({ name: "open", dir, file });
}

/** Switches the open song to another step; `params` become the query (e.g. `{ transcribe: "1" }`). */
export function goToStep(step: Step, params: Record<string, string> = {}): void {
  const route = current;
  if (route?.name !== "song") return;
  navigate({ name: "song", draftId: route.draftId, step, params }, { replace: true });
}

export function goToSong(draftId: string, step: Step, params: Record<string, string> = {}): void {
  navigate({ name: "song", draftId, step, params });
}
