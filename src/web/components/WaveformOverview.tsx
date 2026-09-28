// The whole song at a glance (Lines board): waveform bars — the played part lighter — line-start marks
// numbered from 1, "Worth a look" diamonds, and the playhead. Click or drag to seek.
//   <WaveformOverview framed />                       // with the board's 84 px strip around it
//   <WaveformOverview source="vocals" height={48} onSeek={(ms) => …} />
// Draws on a canvas; follows playback without re-rendering React.

import { useEffect, useMemo, useRef, useState } from "react";
import { flagTime, type Flag } from "../../core/flags";
import { groupStart, isLabelled, type LyricsDoc } from "../../core/lyrics";
import { levels, maxOf, type AudioData } from "../audio/analysis";
import { useAudioData, useFlags } from "../audio/audio-data";
import { player, usePlayerState, usePositionEffect } from "../audio/player";
import { cssVar } from "../lib/css";
import { clock } from "../lib/format";
import { useStore } from "../state/app-state";

export interface WaveformOverviewProps {
  source?: "mix" | "vocals";
  /** Height of the drawing in px (default 64, as on the board). */
  height?: number;
  /** Line-start marks with numbers (default true). */
  marks?: boolean;
  /** Flag diamonds (default true). */
  flags?: boolean;
  /** Wrap in the board's strip: 84 px, padded, sidebar background, bottom border. */
  framed?: boolean;
  /** Default: seek the player. */
  onSeek?: (ms: number) => void;
}

const BAR = 3;
const GAP = 1;
const LABEL_H = 18;

export function WaveformOverview({ source = "mix", height = 64, marks = true, flags: showFlags = true, framed, onSeek }: WaveformOverviewProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const audio = useAudioData();
  const data = source === "vocals" ? audio.vocals ?? audio.mix : audio.mix;
  const doc = useStore((s) => s.song?.history.present.value ?? null);
  const flagList = useFlags();
  const playerDuration = usePlayerState((s) => s.durationMs);
  const trackDuration = useStore((s) => s.song?.track?.durationMs ?? 0);
  const duration = playerDuration || trackDuration || data?.durationMs || 0;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)));
    ro.observe(el);
    setWidth(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const dpr = window.devicePixelRatio || 1;
  const layers = useMemo(() => (width > 0 ? renderBars(data, width, height, dpr) : null), [data, width, height, dpr]);

  const draw = (heard: number) => {
    const c = canvas.current;
    if (!c || !layers || width === 0) return;
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    const x = duration > 0 ? (heard / duration) * width : 0;
    g.drawImage(layers.unplayed, 0, 0);
    const px = Math.round(x * dpr);
    if (px > 0) g.drawImage(layers.played, 0, 0, px, c.height, 0, 0, px, c.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (doc && duration > 0) {
      if (marks) drawMarks(g, doc, duration, width, height);
      if (showFlags) drawFlags(g, doc, flagList, duration, width);
    }
    g.fillStyle = cssVar("--text-1");
    g.beginPath();
    g.roundRect(Math.round(x) - 1, 12, 2, height - 12, 1);
    g.fill();
  };

  // Slider values for screen readers, set on the element directly: at most once a second while playing
  // (every frame would flood them), right away after a seek or pause.
  const ariaAt = useRef(0);
  const updateAria = (heard: number) => {
    const el = box.current;
    const now = performance.now();
    if (!el || (player.getState().playing && now - ariaAt.current < 1000)) return;
    ariaAt.current = now;
    el.setAttribute("aria-valuenow", String(Math.round(heard / 1000)));
    el.setAttribute("aria-valuetext", `${clock(heard)} of ${clock(duration || null)}`);
  };

  const drawRef = useRef(draw);
  drawRef.current = (heard: number) => {
    draw(heard);
    updateAria(heard);
  };
  usePositionEffect((_, heard) => drawRef.current(heard));
  useEffect(() => drawRef.current(player.heardPosition()));

  const seekAt = (clientX: number) => {
    const el = box.current;
    if (!el || duration <= 0) return;
    const r = el.getBoundingClientRect();
    const ms = Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
    (onSeek ?? ((t: number) => player.seek(t)))(ms);
  };

  const body = (
    <div
      ref={box}
      className="waveform-overview"
      style={{ height }}
      role="slider"
      aria-label="Whole song"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration / 1000)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        seekAt(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e.clientX);
      }}
    >
      <canvas ref={canvas} />
    </div>
  );
  return framed ? (
    <section aria-label="Whole song" className="waveform-frame">
      {body}
    </section>
  ) : (
    body
  );
}

interface BarLayers {
  played: HTMLCanvasElement;
  unplayed: HTMLCanvasElement;
}

/** The bars in both colours, drawn once per size/data; each frame copies the played part over. */
function renderBars(data: AudioData | null, width: number, height: number, dpr: number): BarLayers {
  const make = (color: string) => {
    const c = document.createElement("canvas");
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.fillStyle = color;
    const band = height - LABEL_H;
    const mid = LABEL_H + band / 2;
    const count = Math.floor((width + GAP) / (BAR + GAP));
    if (!data) {
      g.fillRect(0, mid - 1, width, 2);
      return c;
    }
    const l = levels(data, count);
    const norm = maxOf(l) || 1;
    for (let i = 0; i < count; i++) {
      // Loud music sits near its maximum RMS; the curve brings out verses vs. choruses.
      const h = Math.max(3, Math.round(band * (l[i]! / norm) ** 1.8));
      g.beginPath();
      g.roundRect(i * (BAR + GAP), mid - h / 2, BAR, h, 1);
      g.fill();
    }
    return c;
  };
  return { played: make(cssVar("--wave-played")), unplayed: make(cssVar("--wave-unplayed")) };
}

/** Line starts, numbered like the Lines list; backing vocals and ad-libs get no mark. */
function drawMarks(g: CanvasRenderingContext2D, doc: LyricsDoc, duration: number, width: number, height: number): void {
  g.fillStyle = cssVar("--accent");
  g.font = `10px ${cssVar("--font-mono")}`;
  g.textBaseline = "top";
  doc.groups.forEach((group, i) => {
    const start = isLabelled(group) ? null : groupStart(group);
    if (start === null) return;
    const x = (start / duration) * width - 1;
    g.fillRect(x, 0, 2, height);
    g.fillText(String(i + 1), x + 4, 1);
  });
}

function drawFlags(g: CanvasRenderingContext2D, doc: LyricsDoc, flags: Flag[], duration: number, width: number): void {
  g.fillStyle = cssVar("--warn");
  for (const flag of flags) {
    const t = flagTime(doc, flag);
    if (t === null) continue;
    const x = (t / duration) * width;
    g.save();
    g.translate(x, 9);
    g.rotate(Math.PI / 4);
    g.beginPath();
    g.roundRect(-4, -4, 8, 8, 1.5);
    g.fill();
    g.restore();
  }
}
