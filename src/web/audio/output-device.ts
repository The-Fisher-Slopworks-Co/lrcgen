// Which output device the audio goes to, so latency can be stored per device (settings.latency[key]).
// Browsers only reveal device names after a microphone permission; until then everything is "Default output".
//
// Latency convention: settings hold how late the device plays, in ms (+184 = heard 184 ms late); the UI shows
// the correction applied to taps, −184 ms.

import { useSyncExternalStore } from "react";
import { appStore, useStore } from "../state/app-state";
import { player } from "./player";

export interface OutputDevice {
  /** Key into `settings.latency`. */
  key: string;
  label: string;
  /** The name suggests Bluetooth, which typically lags 100–300 ms. */
  bluetooth: boolean;
}

const DEFAULT_DEVICE: OutputDevice = { key: "default", label: "Default output", bluetooth: false };

let device: OutputDevice = DEFAULT_DEVICE;
const listeners = new Set<() => void>();

async function detect(): Promise<void> {
  let next = DEFAULT_DEVICE;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === "audiooutput");
    const chosen = outputs.find((d) => d.deviceId === "default") ?? outputs[0];
    const label = chosen?.label.replace(/^Default\s*-\s*/i, "").trim();
    if (label) next = { key: `output:${label}`, label, bluetooth: /bluetooth|bluez|airpods|buds|wh-|wf-|headset/i.test(label) };
  } catch {
    // No mediaDevices (insecure context): stay on the default.
  }
  if (next.key !== device.key || next.label !== device.label) {
    device = next;
    for (const l of [...listeners]) l();
  }
}

let started = false;

/** Starts watching the output device and keeps the player's latency in sync with settings. Call once. */
export function startOutputDeviceSync(): void {
  if (started) return;
  started = true;
  void detect();
  navigator.mediaDevices?.addEventListener?.("devicechange", () => void detect());
  const sync = () => player.setLatency(latencyFor(device.key));
  listeners.add(sync);
  appStore.subscribe(sync);
  sync();
}

export function outputDevice(): OutputDevice {
  return device;
}

export function outputDeviceKey(): string {
  return device.key;
}

/** Stored latency for a device (0 when never calibrated). */
export function latencyFor(key: string): number {
  return appStore.get().settings?.latency[key] ?? 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current output device and its stored latency. */
export function useOutputDevice(): OutputDevice & { latencyMs: number } {
  const current = useSyncExternalStore(subscribe, outputDevice);
  const latencyMs = useStore((s) => s.settings?.latency[current.key] ?? 0);
  return { ...current, latencyMs };
}
