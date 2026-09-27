// Keyboard shortcuts. One window listener dispatches to the registered maps:
//
//   useHotkeys({
//     Enter: { run: tap, repeat: false },
//     "Shift+ArrowLeft": () => nudge(-100),
//     Backspace: () => (undoLabel() === "tap" ? undo() : false),   // return false = not handled, keep looking
//   });
//
// - Handlers are always the latest closures; no dependency list needed.
// - Keys are ignored while typing in inputs/textareas/contenteditable unless the binding says `inInputs: true`.
// - Layers: a <HotkeyLayer blocking> (every Modal has one) sits on top; its keys run first and nothing below
//   it sees a key while it's open. Hooks register in the layer of the component that *calls* them, so a
//   dialog's keys belong in <Modal hotkeys={…}> or in a component inside the Modal.
//   Within a layer, higher `priority` wins, then the most recent registration.
//   The song workspace's global keys (Space, V, L, Ctrl+Z…) use priority -1, so screens can override them.
// - A handled Enter/Space never also "clicks" the button that happens to have focus.
// - Events a component already handled (defaultPrevented) are skipped.

import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { layoutHint, matchesKey, parseKeySpec, type KeySpec } from "./key-spec";

export type HotkeyHandler = (e: KeyboardEvent) => void | boolean;

export interface HotkeyBinding {
  run: HotkeyHandler;
  /** Also fire while an input/textarea has focus (e.g. Esc, Ctrl+S). */
  inInputs?: boolean;
  /** Fire on auto-repeat while held (default true; turn off for taps). */
  repeat?: boolean;
  /** Default true. */
  preventDefault?: boolean;
}

export type HotkeyMap = Record<string, HotkeyHandler | HotkeyBinding>;

interface Registration {
  map: () => HotkeyMap;
  priority: number;
  order: number;
  enabled: () => boolean;
}

interface Layer {
  depth: number;
  seq: number;
  blocking: boolean;
  registrations: Set<Registration>;
}

let seq = 0;
const rootLayer: Layer = { depth: 0, seq: 0, blocking: false, registrations: new Set() };
const activeLayers = new Set<Layer>([rootLayer]);
const LayerContext = createContext<Layer>(rootLayer);

const specCache = new Map<string, KeySpec>();
function spec(s: string): KeySpec {
  let parsed = specCache.get(s);
  if (!parsed) {
    parsed = parseKeySpec(s);
    specCache.set(s, parsed);
  }
  return parsed;
}

let nonLatinLayout = false;
let swallowKeyUp: string | null = null;

/** True when the event comes from somewhere the user types text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "range", "button", "submit", "reset", "file", "color"].includes(target.type);
  }
  return false;
}

function onKeyDown(e: KeyboardEvent): void {
  const hint = layoutHint(e);
  if (hint !== null) nonLatinLayout = hint;
  if (e.defaultPrevented || e.isComposing) return;
  if (dispatch(e)) return;
  // The browser's "Save page" is never what Ctrl+S means here, even when nothing handles it (e.g. under a modal).
  if (matchesKey(CTRL_S, e)) e.preventDefault();
}

const CTRL_S = parseKeySpec("Ctrl+S");

/** Runs the first matching binding; true when one handled the event. */
function dispatch(e: KeyboardEvent): boolean {
  const typing = isTypingTarget(e.target);
  const layers = [...activeLayers].sort((a, b) => b.depth - a.depth || b.seq - a.seq);
  for (const layer of layers) {
    const regs = [...layer.registrations].filter((r) => r.enabled()).sort((a, b) => b.priority - a.priority || b.order - a.order);
    for (const reg of regs) {
      for (const [key, value] of Object.entries(reg.map())) {
        if (!matchesKey(spec(key), e, { nonLatinLayout })) continue;
        const binding = typeof value === "function" ? { run: value } : value;
        if (typing && !binding.inInputs) continue;
        if (e.repeat && binding.repeat === false) {
          e.preventDefault();
          return true;
        }
        if (binding.run(e) === false) continue;
        if (binding.preventDefault !== false) e.preventDefault();
        if ((e.key === " " || e.key === "Enter") && e.target instanceof HTMLButtonElement) swallowKeyUp = e.code;
        return true;
      }
    }
    if (layer.blocking) return false;
  }
  return false;
}

function onKeyUp(e: KeyboardEvent): void {
  // Space "clicks" a focused button on keyup; don't let a Space hotkey also press it.
  if (swallowKeyUp !== null && e.code === swallowKeyUp) {
    e.preventDefault();
    swallowKeyUp = null;
  }
}

window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp, true);

export interface HotkeyOptions {
  /** Higher runs first within a layer (default 0). */
  priority?: number;
  /** Turn the whole map off without unmounting (default true). */
  enabled?: boolean;
}

export function useHotkeys(map: HotkeyMap, options: HotkeyOptions = {}): void {
  const layer = useContext(LayerContext);
  const mapRef = useRef(map);
  mapRef.current = map;
  const enabledRef = useRef(options.enabled ?? true);
  enabledRef.current = options.enabled ?? true;
  const priority = options.priority ?? 0;
  useLayoutEffect(() => {
    const reg: Registration = { map: () => mapRef.current, priority, order: ++seq, enabled: () => enabledRef.current };
    layer.registrations.add(reg);
    return () => {
      layer.registrations.delete(reg);
    };
  }, [layer, priority]);
}

/**
 * A layer of hotkeys above the one it's rendered in. `blocking` keeps keys from reaching lower layers
 * while it is mounted (modals).
 */
export function HotkeyLayer({ blocking = false, children }: { blocking?: boolean; children: ReactNode }) {
  const parent = useContext(LayerContext);
  const [layer] = useState<Layer>(() => ({ depth: parent.depth + 1, seq: 0, blocking, registrations: new Set() }));
  layer.blocking = blocking;
  useLayoutEffect(() => {
    layer.seq = ++seq;
    activeLayers.add(layer);
    return () => {
      activeLayers.delete(layer);
    };
  }, [layer]);
  return <LayerContext.Provider value={layer}>{children}</LayerContext.Provider>;
}
