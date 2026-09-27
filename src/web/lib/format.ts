// Formatting for the UI, on top of src/core/time-utils (msToLrc: "00:44.31").

import { msToLrc } from "../../core/time-utils";

const MINUS = "−";

/** "00:44.31"; "––:––.––" for a missing time. */
export function clock(ms: number | null | undefined): string {
  return ms == null ? "––:––.––" : msToLrc(Math.max(0, ms));
}

/** "03:24" (no hundredths), e.g. file lengths. */
export function shortClock(ms: number | null | undefined): string {
  if (ms == null) return "––:––";
  const total = Math.round(Math.max(0, ms) / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** "41.46" under a minute, "1:08.40" above: compact times for chips like "41.46 → 45.02". */
export function seconds(ms: number): string {
  const hundredths = Math.round(Math.max(0, ms) / 10);
  const s = Math.floor(hundredths / 100);
  const frac = String(hundredths % 100).padStart(2, "0");
  if (s < 60) return `${s}.${frac}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.${frac}`;
}

/** "−184 ms", "+12 ms", "0 ms" — with a real minus sign. */
export function signedMs(ms: number): string {
  const r = Math.round(ms);
  if (r === 0) return "0 ms";
  return `${r < 0 ? MINUS : "+"}${Math.abs(r)} ms`;
}

/** The tap correction for a stored latency: latency 184 (heard late) → "−184 ms". */
export function latencyCorrection(latencyMs: number): string {
  return signedMs(-latencyMs);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "today", "yesterday", "3 days ago", "Sep 14", "Sep 14, 2024" — for the Recent list. */
export function relativeDay(timestamp: number, now: number = Date.now()): string {
  const day = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  };
  const diff = day(now) - day(timestamp);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return `${diff} days ago`;
  const d = new Date(timestamp);
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

/** 0–1 → "62%". */
export function percent(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

/** "1 line", "12 lines". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
