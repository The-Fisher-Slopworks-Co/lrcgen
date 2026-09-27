// A minimal external store for `useSyncExternalStore`. `useSelector` caches its result, so a selector may
// build a new object each call as long as it passes an equality function (e.g. `shallowEqual`).

import { useCallback, useRef, useSyncExternalStore } from "react";

export interface Store<T> {
  get(): T;
  set(update: Partial<T> | ((state: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update) {
      const patch = typeof update === "function" ? update(state) : update;
      const next = { ...state, ...patch };
      if (Object.keys(patch).every((k) => Object.is(state[k as keyof T], next[k as keyof T]))) return;
      state = next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useSelector<T, S>(store: Store<T>, selector: (state: T) => S, isEqual: (a: S, b: S) => boolean = Object.is): S {
  const cache = useRef<{ state: T; selector: (state: T) => S; selected: S } | null>(null);
  // The selector is usually an inline arrow, so this runs it again on every render; that's intended.
  const getSnapshot = useCallback(() => {
    const state = store.get();
    const prev = cache.current;
    if (prev && prev.state === state && prev.selector === selector) return prev.selected;
    let selected = selector(state);
    if (prev && isEqual(prev.selected, selected)) selected = prev.selected;
    cache.current = { state, selector, selected };
    return selected;
  }, [store, selector, isEqual]);
  return useSyncExternalStore(store.subscribe, getSnapshot);
}

export function shallowEqual<S>(a: S, b: S): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
