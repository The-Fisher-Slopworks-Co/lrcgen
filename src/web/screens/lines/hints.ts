// Toasts for key presses that can't do anything right now, without flooding the screen on auto-repeat.

import { toast } from "../../state";

const shown = new Set<string>();
const lastAt = new Map<string, number>();

/** Shows `message` once per page load. */
export function toastOnce(message: string): void {
  if (shown.has(message)) return;
  shown.add(message);
  toast(message);
}

/** Shows `message` unless it was shown in the last few seconds. */
export function toastQuietly(message: string, gapMs = 4000): void {
  const now = Date.now();
  if (now - (lastAt.get(message) ?? -Infinity) < gapMs) return;
  lastAt.set(message, now);
  toast(message);
}
