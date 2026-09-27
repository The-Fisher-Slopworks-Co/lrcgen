// Vertical layout of the Refine timeline: ruler, words lane, the ghost strip for untimed words, then the
// optional vocals / spectrogram / mix lanes. The board's proportions at 512 px; extra height goes to the
// vocals and spectrogram lanes.

export interface LaneToggles {
  vocals: boolean;
  spect: boolean;
  mix: boolean;
}

export interface Band {
  y: number;
  h: number;
}

export interface LaneLayout {
  ruler: Band;
  words: Band;
  ghost: Band | null;
  vocals: Band | null;
  spect: Band | null;
  mix: Band | null;
  /** From the words lane's bottom to the last lane's bottom: where word-start lines are drawn. */
  audioTop: number;
  height: number;
}

export const RULER_H = 28;
export const WORDS_H = 64;
export const GHOST_H = 26;
export const MIX_H = 56;
export const GAP = 6;
const MIN_FLEX = 64;
const VOCALS_SHARE = 180 / 340;

export function laneLayout(height: number, toggles: LaneToggles, ghost: boolean): LaneLayout {
  let y = 0;
  const take = (h: number): Band => {
    const band = { y, h };
    y += h + GAP;
    return band;
  };
  const ruler = take(RULER_H);
  const words = take(WORDS_H);
  const ghostBand = ghost ? take(GHOST_H) : null;
  const audioTop = words.y + words.h;

  const flexCount = (toggles.vocals ? 1 : 0) + (toggles.spect ? 1 : 0);
  const count = flexCount + (toggles.mix ? 1 : 0);
  const free = Math.max(flexCount * MIN_FLEX, height - y - (toggles.mix ? MIX_H : 0) - Math.max(0, count - 1) * GAP);
  let vocalsH = 0;
  let spectH = 0;
  if (toggles.vocals && toggles.spect) {
    vocalsH = Math.max(MIN_FLEX, Math.round(free * VOCALS_SHARE));
    spectH = Math.max(MIN_FLEX, free - vocalsH);
  } else if (toggles.vocals) vocalsH = free;
  else if (toggles.spect) spectH = free;

  const vocals = toggles.vocals ? take(vocalsH) : null;
  const spect = toggles.spect ? take(spectH) : null;
  // With nothing else below, the mix lane takes the room left.
  const mixH = flexCount === 0 ? Math.max(MIX_H, height - y) : MIX_H;
  const mix = toggles.mix ? take(mixH) : null;
  return { ruler, words, ghost: ghostBand, vocals, spect, mix, audioTop, height: Math.max(height, y - GAP) };
}
