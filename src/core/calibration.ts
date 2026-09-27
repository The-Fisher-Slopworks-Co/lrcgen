// Audio latency calibration: the app plays clicks, the user taps along; the taps land late by the output latency.

export interface CalibrationResult {
  /** How late the taps land, in ms (median). Positive = late. */
  offsetMs: number;
  /** Spread of the taps around that offset, ± ms. */
  spreadMs: number;
  /** Each tap paired with its click; taps that could not be paired are left out. */
  pairs: { clickMs: number; tapMs: number; deltaMs: number }[];
  /** Enough paired taps with a small enough spread to trust. */
  steady: boolean;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const MIN_PAIRS = 5;
const MAX_SPREAD_MS = 25;

export function analyzeTaps(clicksMs: number[], tapsMs: number[]): CalibrationResult {
  const clicks = [...clicksMs].sort((a, b) => a - b);
  // A tap belongs to the click it is closest to, within half the click interval; with one click, to that click.
  const interval = clicks.length > 1 ? median(clicks.slice(1).map((c, i) => c - clicks[i]!)) : Infinity;
  const used = new Set<number>();
  const pairs: CalibrationResult["pairs"] = [];
  for (const tapMs of [...tapsMs].sort((a, b) => a - b)) {
    let nearest = -1;
    for (let i = 0; i < clicks.length; i++) {
      if (nearest === -1 || Math.abs(tapMs - clicks[i]!) < Math.abs(tapMs - clicks[nearest]!)) nearest = i;
    }
    if (nearest === -1 || used.has(nearest)) continue;
    const clickMs = clicks[nearest]!;
    if (Math.abs(tapMs - clickMs) > interval / 2) continue;
    used.add(nearest);
    pairs.push({ clickMs, tapMs, deltaMs: tapMs - clickMs });
  }
  if (pairs.length === 0) return { offsetMs: 0, spreadMs: 0, pairs, steady: false };

  const deltas = pairs.map((p) => p.deltaMs);
  const offset = median(deltas);
  const spreadMs = Math.round(median(deltas.map((d) => Math.abs(d - offset))));
  return { offsetMs: Math.round(offset), spreadMs, pairs, steady: pairs.length >= MIN_PAIRS && spreadMs <= MAX_SPREAD_MS };
}
