// The Refine timeline's visible window: which stretch of the song it shows and how that maps to pixels.

import { seconds } from "../../lib/format";

export interface View {
  /** Song time at the left edge, ms (may be slightly negative so time 0 isn't glued to the edge). */
  startMs: number;
  /** How much time the width shows, ms. */
  spanMs: number;
}

/** The "−  4 s view  +" steps. */
export const ZOOM_PRESETS = [2000, 4000, 8000, 16000] as const;
export const DEFAULT_SPAN = 4000;
export const MIN_SPAN = 1000;
export const MAX_SPAN = 32000;

/** Where a line starts in a fresh view, as a fraction of the width (as on the board). */
const LEAD_FRACTION = 0.065;
/** How far past the song's ends the view may scroll, as a fraction of the span. */
const OVERSCROLL = 0.05;

export function xOf(view: View, widthPx: number, ms: number): number {
  return ((ms - view.startMs) / view.spanMs) * widthPx;
}

export function msAt(view: View, widthPx: number, x: number): number {
  return view.startMs + (x / widthPx) * view.spanMs;
}

export function clampSpan(spanMs: number): number {
  return Math.min(MAX_SPAN, Math.max(MIN_SPAN, spanMs));
}

/** Keeps the view within the song (a little overscroll allowed). `durationMs` 0 = unknown. */
export function clampView(view: View, durationMs: number): View {
  const spanMs = clampSpan(view.spanMs);
  const min = -spanMs * OVERSCROLL;
  const max = durationMs > 0 ? Math.max(min, durationMs - spanMs * (1 - OVERSCROLL)) : Number.POSITIVE_INFINITY;
  const startMs = Math.min(max, Math.max(min, view.startMs));
  return startMs === view.startMs && spanMs === view.spanMs ? view : { startMs, spanMs };
}

/** Zooms to `spanMs`, keeping `anchorMs` at the same spot on screen. */
export function zoomAround(view: View, spanMs: number, anchorMs: number): View {
  const span = clampSpan(spanMs);
  const fraction = (anchorMs - view.startMs) / view.spanMs;
  return { startMs: anchorMs - fraction * span, spanMs: span };
}

/** The next preset in a direction: −1 zooms in (shorter span), +1 zooms out. */
export function nextPreset(spanMs: number, dir: 1 | -1): number {
  if (dir < 0) {
    const smaller = [...ZOOM_PRESETS].reverse().find((p) => p < spanMs - 1);
    return smaller ?? Math.max(MIN_SPAN, Math.min(spanMs, ZOOM_PRESETS[0]));
  }
  const larger = ZOOM_PRESETS.find((p) => p > spanMs + 1);
  return larger ?? Math.min(MAX_SPAN, Math.max(spanMs, ZOOM_PRESETS[ZOOM_PRESETS.length - 1]!));
}

/** "4 s view", "2.5 s view". */
export function spanLabel(spanMs: number): string {
  const s = spanMs / 1000;
  return `${Number.isInteger(s) ? s : s < 10 ? s.toFixed(1) : Math.round(s)} s view`;
}

/** A view of `spanMs` with the line starting near the left edge. */
export function viewForLine(fromMs: number, spanMs: number): View {
  return { startMs: fromMs - spanMs * LEAD_FRACTION, spanMs };
}

/** Scrolls just enough (to a comfortable spot) that `ms` is visible. */
export function ensureVisible(view: View, ms: number, margin = 0.04): View {
  const lo = view.startMs + view.spanMs * margin;
  const hi = view.startMs + view.spanMs * (1 - margin);
  if (ms >= lo && ms <= hi) return view;
  return { ...view, startMs: ms - view.spanMs * (ms < lo ? 0.15 : 0.6) };
}

const STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000];

export interface RulerTicks {
  minor: number[];
  major: { ms: number; label: string }[];
}

/** Tick times for the ruler: minor ticks at least ~18 px apart, labelled major ones at least ~100 px apart. */
export function rulerTicks(view: View, widthPx: number): RulerTicks {
  const pxPerMs = widthPx / view.spanMs;
  const minorStep = STEPS.find((s) => s * pxPerMs >= 18) ?? STEPS[STEPS.length - 1]!;
  const majorStep = STEPS.find((s) => s * pxPerMs >= 100 && s % minorStep === 0) ?? minorStep * 5;
  const minor: number[] = [];
  const major: { ms: number; label: string }[] = [];
  const end = view.startMs + view.spanMs;
  for (let ms = Math.ceil(Math.max(0, view.startMs) / minorStep) * minorStep; ms <= end; ms += minorStep) {
    if (ms % majorStep === 0) major.push({ ms, label: seconds(ms) });
    else minor.push(ms);
  }
  return { minor, major };
}
