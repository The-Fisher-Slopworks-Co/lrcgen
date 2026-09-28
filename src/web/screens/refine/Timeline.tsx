// The Refine timeline (Refine board): ruler, words lane with draggable word blocks, vocals waveform,
// spectrogram and mix lanes, playhead and loop. Two canvases — the audio lanes (redrawn when the view
// moves) and an overlay with word-start lines, flags and the playhead (redrawn every frame) — with the word
// blocks as buttons in between. Wheel scrolls, Ctrl+wheel zooms, dragging the ruler scrolls, a click seeks.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Flag } from "../../../core/flags";
import { hasWordTimings, type LrcDocument } from "../../../core/lrc-document";
import type { AudioData } from "../../audio/analysis";
import { ENVELOPE_FRAME_MS, useAudioData } from "../../audio/audio-data";
import { player, usePositionEffect } from "../../audio/player";
import { Button } from "../../components/controls";
import { Icon } from "../../components/icons";
import { cssVar } from "../../lib/css";
import { percent, seconds } from "../../lib/format";
import { lineSpan } from "../../lib/timing";
import { commit, currentDoc, goToStep, select, startJob, useRunningJob } from "../../state";
import { laneLayout, type LaneLayout, type LaneToggles } from "./lanes";
import { moveTarget } from "./nudge";
import { SpectrogramCache, TILE_COLS } from "./spectrogram-cache";
import { colorRamp, hexToRgb, quantizeMsPerCol, tilesFor } from "./spectrogram";
import { clampView, msAt, rulerTicks, xOf, zoomAround, type View } from "./timeline-view";
import { barLevels, loudestLevel, voicedBars } from "./waves";
import { edgeWords, flagNote, flagTime, lineBlocks } from "./word-blocks";

export interface TimelineProps {
  doc: LrcDocument;
  lineIndex: number;
  word: number | null;
  view: View;
  setView: (update: (v: View) => View) => void;
  lanes: LaneToggles;
  /** Flags in this line. */
  flags: Flag[];
  durationMs: number;
  hasStem: boolean;
}

const BAR = 3;
const BAR_GAP = 1;
const DRAG_THRESHOLD = 3;

interface Size {
  width: number;
  height: number;
}

type Gesture =
  | { kind: "ruler"; x0: number; view0: View; moved: boolean }
  | { kind: "seek" }
  | { kind: "block"; word: number; x0: number; start: number; moved: boolean; ms: number }
  | { kind: "ghost"; word: number; x0: number; y0: number; moved: boolean; ms: number | null };

const round10 = (ms: number) => Math.round(ms / 10) * 10;

export function Timeline({ doc, lineIndex, word, view, setView, lanes, flags, durationMs, hasStem }: TimelineProps) {
  const lanesBox = useRef<HTMLDivElement>(null);
  const bgCanvas = useRef<HTMLCanvasElement>(null);
  const fgCanvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [drag, setDrag] = useState<{ word: number; ms: number } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const audio = useAudioData();
  const dpr = window.devicePixelRatio || 1;

  // Latest values for native listeners.
  const live = useRef({ view, size, durationMs });
  live.current = { view, size, durationMs };

  useLayoutEffect(() => {
    const el = lanesBox.current;
    if (!el) return;
    const measure = () => setSize({ width: Math.round(el.clientWidth), height: Math.round(el.clientHeight) });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // Wheel: scroll; Ctrl+wheel (or pinch): zoom around the pointer. Native so preventDefault works.
  useEffect(() => {
    const el = lanesBox.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { size: s, durationMs: d } = live.current;
      if (s.width === 0) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? s.width : 1;
      const px = e.clientX - el.getBoundingClientRect().left;
      if (e.ctrlKey || e.metaKey) {
        setView((v) => clampView(zoomAround(v, v.spanMs * Math.exp(e.deltaY * unit * 0.0025), msAt(v, s.width, px)), d));
      } else {
        const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
        setView((v) => clampView({ ...v, startMs: v.startMs + (delta * v.spanMs) / s.width }, d));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setView]);

  // What's drawn: the document with the block being dragged already moved.
  const shown = drag ? moveTarget(doc, { line: lineIndex, word: drag.word }, drag.ms, durationMs) : doc;
  const line = shown.lines[lineIndex];
  const span = lineSpan(shown, lineIndex, durationMs);
  const { blocks } = lineBlocks(line, span?.to ?? null);
  // The ghost strip reads the real document, so a ghost being dragged stays put (and keeps the pointer).
  const { untimed } = lineBlocks(doc.lines[lineIndex], null);
  const edges = edgeWords(shown, lineIndex);
  const layout = laneLayout(size.height, lanes, untimed.length > 0);
  const x = (ms: number) => xOf(view, size.width, ms);
  const flaggedWords = new Set(flags.filter((f) => f.wordIndex !== undefined).map((f) => f.wordIndex!));

  // ---------------------------------------------------------------- audio lanes (background canvas)

  const lut = useMemo(
    () =>
      colorRamp([
        [0, hexToRgb(cssVar("--well") || "#121110")],
        [0.4, hexToRgb(cssVar("--vocals-dim") || "#34424a")],
        [0.72, hexToRgb(cssVar("--vocals") || "#86bde0")],
        [1, hexToRgb(cssVar("--text-1") || "#efe8da")],
      ]),
    [],
  );
  const specData = audio.vocals ?? audio.mix;
  const cache = useMemo(() => (specData ? new SpectrogramCache(specData, lut) : null), [specData, lut]);
  const vocalsNorm = useMemo(() => (audio.vocals ? loudestLevel(audio.vocals.samples, audio.vocals.sampleRate) : 1), [audio.vocals]);
  const mixNorm = useMemo(() => (audio.mix ? loudestLevel(audio.mix.samples, audio.mix.sampleRate) : 1), [audio.mix]);

  const drawBg = () => {
    const c = bgCanvas.current;
    if (!c || size.width === 0 || size.height === 0) return;
    fitCanvas(c, size, dpr);
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.width, size.height);
    drawRuler(g, view, size.width, layout);
    g.fillStyle = cssVar("--sidebar");
    g.beginPath();
    g.roundRect(0, layout.words.y, size.width, layout.words.h, 6);
    g.fill();

    const bars = Math.floor((size.width + BAR_GAP) / (BAR + BAR_GAP));
    const to = view.startMs + (bars * (BAR + BAR_GAP) * view.spanMs) / size.width;
    if (layout.vocals && audio.vocals) {
      const voiced = audio.envelope ? voicedBars(audio.envelope, ENVELOPE_FRAME_MS, bars, view.startMs, to) : null;
      drawBars(g, audio.vocals, vocalsNorm, bars, view.startMs, to, layout.vocals, (i) => (voiced?.[i] ? cssVar("--vocals") : cssVar("--vocals-dim")), 1.6);
    }
    if (layout.spect) drawSpectrogram(g, cache, view, size.width, layout.spect);
    if (layout.mix && audio.mix) drawBars(g, audio.mix, mixNorm, bars, view.startMs, to, layout.mix, () => cssVar("--muted-2"), 1.3);
    if (!audio.mix && audio.loading) {
      g.fillStyle = cssVar("--text-5");
      g.font = `12px ${cssVar("--font-ui")}`;
      g.textAlign = "center";
      g.fillText("Reading the audio…", size.width / 2, layout.audioTop + 60);
      g.textAlign = "start";
    }
  };
  const drawBgRef = useRef(drawBg);
  drawBgRef.current = drawBg;
  const bgFrame = useRef(0);
  const scheduleBg = () => {
    cancelAnimationFrame(bgFrame.current);
    bgFrame.current = requestAnimationFrame(() => drawBgRef.current());
  };

  useEffect(() => {
    if (!cache) return;
    cache.onReady = scheduleBg;
    return () => cache.dispose();
  }, [cache]);

  // Redrawn when what it shows changes, not on every render (a drag re-renders on each move).
  const bgKey = [view.startMs, view.spanMs, size.width, size.height, dpr, lanes.vocals, lanes.spect, lanes.mix, !!layout.ghost, audio.loading].join("|");
  useEffect(() => {
    drawBg();
    if (cache && layout.spect && size.width > 0) {
      const msPerCol = quantizeMsPerCol(view.spanMs / size.width);
      const margin = view.spanMs * 0.5;
      const visible = tilesFor(view.startMs, view.startMs + view.spanMs, msPerCol, TILE_COLS);
      const around = tilesFor(view.startMs - margin, view.startMs + view.spanMs + margin, msPerCol, TILE_COLS).filter((i) => !visible.includes(i));
      cache.request([...visible, ...around].map((index) => ({ msPerCol, index })));
    }
  }, [bgKey, cache, audio.mix, audio.vocals, audio.envelope]);
  useEffect(() => () => cancelAnimationFrame(bgFrame.current), []);

  // ---------------------------------------------------------------- overlay (every frame)

  const drawFg = (heard: number) => {
    const c = fgCanvas.current;
    if (!c || size.width === 0 || size.height === 0) return;
    fitCanvas(c, size, dpr);
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.width, size.height);
    const bottom = layout.height;
    const top = layout.audioTop;
    const accent = cssVar("--accent");

    const loop = player.getState().loop;
    if (loop) {
      const x0 = x(loop.from);
      const x1 = x(loop.to);
      g.fillStyle = withAlpha(accent, 0.05);
      g.fillRect(x0, layout.words.y, x1 - x0, bottom - layout.words.y);
      g.fillStyle = withAlpha(accent, 0.55);
      g.beginPath();
      g.roundRect(x0, layout.ruler.h - 6, Math.max(2, x1 - x0), 4, 2);
      g.fill();
    }

    for (const flag of flags) {
      const t = flagTime(shown, flag);
      if (t === null || flag.suggestMs === undefined) continue;
      const a = x(Math.min(t, flag.suggestMs));
      const b = x(Math.max(t, flag.suggestMs));
      g.fillStyle = withAlpha(cssVar("--warn"), 0.18);
      g.fillRect(a, top + 6, Math.max(2, b - a), bottom - top - 6);
    }

    // Neighbouring lines' starts: dashed, labelled "ln 8".
    g.font = `11px ${cssVar("--font-mono")}`;
    g.textBaseline = "top";
    for (const e of [edges.prev, edges.next]) {
      if (!e) continue;
      const t = shown.lines[e.lineIndex]!.timestamp!;
      const lx = Math.round(x(t)) + 0.5;
      if (lx < -40 || lx > size.width + 1) continue;
      g.strokeStyle = accent;
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(lx, 0);
      g.lineTo(lx, bottom);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = accent;
      g.fillText(`ln ${e.lineIndex + 1}`, lx + 5, layout.words.y + 2);
    }

    // Word starts (or the line start when the line has no word timings).
    const startLine = (t: number, color: string, w: number) => {
      g.fillStyle = color;
      g.fillRect(Math.round(x(t) - w / 2), top, w, bottom - top);
    };
    if (blocks.length > 0) {
      for (const b of blocks) {
        const selected = b.index === word || (word === null && b.index === 0);
        const color = selected ? accent : flaggedWords.has(b.index) ? cssVar("--warn") : withAlpha(cssVar("--text-1"), 0.3);
        startLine(b.start, color, selected ? 2 : 1);
      }
    } else if (line?.timestamp != null) {
      startLine(line.timestamp, accent, 2);
    }

    const px = Math.round(x(heard));
    if (px >= -6 && px <= size.width + 6) {
      g.fillStyle = cssVar("--text-1");
      g.fillRect(px - 1, 0, 2, bottom);
      g.beginPath();
      g.moveTo(px - 6, 0);
      g.lineTo(px + 6, 0);
      g.lineTo(px, 8);
      g.closePath();
      g.fill();
    }
  };
  const drawFgRef = useRef(drawFg);
  drawFgRef.current = drawFg;
  usePositionEffect((_, heard) => drawFgRef.current(heard));
  useLayoutEffect(() => drawFg(player.heardPosition()));

  // ---------------------------------------------------------------- pointer

  const lanesPoint = (clientX: number) => clientX - (lanesBox.current?.getBoundingClientRect().left ?? 0);
  const clampSong = (ms: number) => Math.min(durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY, Math.max(0, ms));

  const follow = (onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void) => {
    const move = (e: PointerEvent) => onMove(e);
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onUp(e);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onLanesDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || size.width === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const inRuler = e.clientY - r.top < layout.ruler.h;
    if (inRuler) {
      const g: Gesture = { kind: "ruler", x0: e.clientX, view0: view, moved: false };
      gesture.current = g;
      follow(
        (m) => {
          const dx = m.clientX - g.x0;
          if (!g.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
          g.moved = true;
          setView(() => clampView({ ...g.view0, startMs: g.view0.startMs - (dx * g.view0.spanMs) / size.width }, durationMs));
        },
        (u) => {
          gesture.current = null;
          if (!g.moved) player.seek(clampSong(msAt(view, size.width, lanesPoint(u.clientX))));
        },
      );
      return;
    }
    player.seek(clampSong(msAt(view, size.width, e.clientX - r.left)));
    gesture.current = { kind: "seek" };
    follow(
      (m) => player.seek(clampSong(msAt(live.current.view, live.current.size.width, lanesPoint(m.clientX)))),
      () => (gesture.current = null),
    );
  };

  const onBlockDown = (e: ReactPointerEvent, index: number, start: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const g: Gesture = { kind: "block", word: index, x0: e.clientX, start, moved: false, ms: start };
    gesture.current = g;
    follow(
      (m) => {
        const dx = m.clientX - g.x0;
        if (!g.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
        g.moved = true;
        g.ms = clampSong(round10(g.start + (dx * view.spanMs) / size.width));
        setDrag({ word: index, ms: g.ms });
      },
      () => {
        gesture.current = null;
        setDrag(null);
        select(lineIndex, index);
        const d = currentDoc();
        if (g.moved && d) commit(moveTarget(d, { line: lineIndex, word: index }, g.ms, durationMs), "drag");
        else if (!player.getState().playing) player.seek(start);
      },
    );
  };

  const onGhostDown = (e: ReactPointerEvent, index: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const g: Gesture = { kind: "ghost", word: index, x0: e.clientX, y0: e.clientY, moved: false, ms: null };
    gesture.current = g;
    select(lineIndex, index);
    follow(
      (m) => {
        if (!g.moved && Math.hypot(m.clientX - g.x0, m.clientY - g.y0) < DRAG_THRESHOLD) return;
        g.moved = true;
        const px = lanesPoint(m.clientX);
        const r = lanesBox.current?.getBoundingClientRect();
        const inside = !!r && px >= 0 && px <= size.width && m.clientY >= r.top && m.clientY <= r.bottom;
        g.ms = inside ? clampSong(round10(msAt(view, size.width, px))) : null;
        setDrag(g.ms === null ? null : { word: index, ms: g.ms });
      },
      () => {
        gesture.current = null;
        setDrag(null);
        const d = currentDoc();
        if (g.moved && g.ms !== null && d) commit(moveTarget(d, { line: lineIndex, word: index }, g.ms, durationMs), "drag");
      },
    );
  };

  // ---------------------------------------------------------------- DOM

  const labelTop = (band: { y: number; h: number } | null) => (band ? band.y + band.h / 2 - 7 : 0);
  const hasTimings = !!line && hasWordTimings(line);
  const noteFlag = flags.find((f) => f.suggestMs !== undefined || f.wordIndex !== undefined) ?? flags[0];
  const noteAt = noteFlag ? flagTime(shown, noteFlag) : null;
  const noteX = noteFlag && noteAt !== null ? x(Math.max(noteAt, noteFlag.suggestMs ?? noteAt)) + 5 : null;
  const noteY = (layout.vocals ?? layout.spect ?? layout.mix)?.y;

  return (
    <div className="refine-timeline">
      <div className="refine-lane-labels" aria-hidden="true">
        <span style={{ top: labelTop(layout.words) }}>Words</span>
        {layout.vocals && (
          <span className="vocals" style={{ top: labelTop(layout.vocals) }}>
            Vocals
          </span>
        )}
        {layout.spect && (
          <span className={audio.vocals ? "vocals" : undefined} style={{ top: labelTop(layout.spect) }}>
            Spect
          </span>
        )}
        {layout.mix && <span style={{ top: labelTop(layout.mix) }}>Mix</span>}
      </div>

      <div ref={lanesBox} className="refine-lanes" onPointerDown={onLanesDown}>
        <canvas ref={bgCanvas} className="refine-canvas" />

        {edges.prev && (
          <EdgeBlock left={x(edges.prev.start)} width={x(edges.prev.end) - x(edges.prev.start) - 3} top={layout.words.y + 8} text={edges.prev.text} onSelect={() => select(edges.prev!.lineIndex)} />
        )}
        {edges.next && (
          <EdgeBlock left={x(edges.next.start)} width={x(edges.next.end) - x(edges.next.start) - 3} top={layout.words.y + 8} text={edges.next.text} onSelect={() => select(edges.next!.lineIndex)} />
        )}

        {blocks.map((b) => {
          const selected = b.index === word;
          const flagged = flaggedWords.has(b.index);
          const left = x(b.start);
          const width = Math.max(10, x(b.end) - left - 3);
          if (left > size.width || left + width < 0) return null;
          const cls = ["refine-block", selected && "selected", flagged && "flagged", drag?.word === b.index && "dragging"].filter(Boolean).join(" ");
          return (
            <button
              key={b.index}
              type="button"
              className={cls}
              style={{ left, width, top: layout.words.y + 8 }}
              aria-pressed={selected}
              aria-label={`${b.parts.join(" ")}, starts ${seconds(b.start)}`}
              title="Drag to move where the word starts"
              onPointerDown={(e) => onBlockDown(e, b.index, doc.lines[lineIndex]?.words?.[b.index]?.start ?? b.start)}
              onClick={(e) => e.preventDefault()}
            >
              <span className="grip" />
              {b.splits.map((s, i) => (
                <span key={i} className="split" style={{ left: x(s) - left }} />
              ))}
              <span className="word">
                {b.parts.map((p, i) => (
                  <span key={i} className="part">
                    {i > 0 && <Icon.Link size={12} aria-label="joined" />}
                    {p}
                  </span>
                ))}
                {flagged && <Icon.Warning size={13} className="flag-icon" />}
              </span>
              <span className="time">{seconds(b.start)}</span>
            </button>
          );
        })}

        {!hasTimings && (
          <div className="refine-lane-hint" style={{ top: layout.words.y, height: layout.words.h }}>
            {line?.timestamp == null ? (
              <>
                This line has no start yet — tap it on the Lines step.
                <button type="button" className="refine-link" onClick={() => goToStep("lines")}>
                  Go to Lines
                </button>
              </>
            ) : (
              <>
                No word timings in this line yet — tap them on the Words step. The line start can still be moved here.
                <button type="button" className="refine-link" onClick={() => goToStep("words")}>
                  Go to Words
                </button>
              </>
            )}
          </div>
        )}

        {layout.ghost && (
          <div className="refine-ghosts" style={{ top: layout.ghost.y, height: layout.ghost.h }}>
            <span className="label">No start yet — drag onto the timeline:</span>
            {untimed.map((u) => (
              <button
                key={u.index}
                type="button"
                className={u.index === word ? "refine-ghost selected" : "refine-ghost"}
                onPointerDown={(e) => onGhostDown(e, u.index)}
              >
                {u.text}
              </button>
            ))}
          </div>
        )}

        {noteFlag && noteX !== null && noteY !== undefined && noteX > 0 && noteX < size.width - 40 && (
          <span className="refine-flag-note" style={{ left: noteX, top: noteY + 4 }}>
            {flagNote(shown, noteFlag)}
          </span>
        )}

        {layout.vocals && !hasStem && <SeparateOffer band={layout.vocals} />}

        <canvas ref={fgCanvas} className="refine-canvas overlay" />
      </div>
    </div>
  );
}

function EdgeBlock({ left, width, top, text, onSelect }: { left: number; width: number; top: number; text: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      className="refine-block edge"
      style={{ left, width: Math.max(10, width), top }}
      title="Another line — click to refine it"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onSelect}
    >
      <span className="word">{text}</span>
    </button>
  );
}

function SeparateOffer({ band }: { band: { y: number; h: number } }) {
  const separateJob = useRunningJob("separate");
  const transcribeJob = useRunningJob("transcribe");
  const alignJob = useRunningJob("align");
  const separating = separateJob ?? transcribeJob ?? alignJob;
  return (
    <div className="refine-offer" style={{ top: band.y, height: band.h }} onPointerDown={(e) => e.stopPropagation()}>
      {separating ? (
        <span className="progress">
          <Icon.Spinner size={16} />
          {separating.kind === "separate"
            ? "Separating vocals"
            : separating.kind === "align"
              ? "Syncing lyrics (separates the vocals too)"
              : "Transcribing (separates the vocals too)"}
          {separating.progress !== null ? ` · ${percent(separating.progress)}` : "…"}
          <span className="message">{separating.message}</span>
        </span>
      ) : (
        <>
          <span>No separated vocals yet. With them, this lane shows where the voice is, and the spectrogram gets clearer.</span>
          <Button variant="secondary" size="sm" icon={<Icon.Mic size={16} />} onClick={() => void startJob("separate")}>
            Separate vocals
          </Button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- drawing helpers

function fitCanvas(c: HTMLCanvasElement, size: Size, dpr: number): void {
  const w = Math.round(size.width * dpr);
  const h = Math.round(size.height * dpr);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
}

function drawRuler(g: CanvasRenderingContext2D, view: View, width: number, layout: LaneLayout): void {
  const { minor, major } = rulerTicks(view, width);
  const h = layout.ruler.h;
  g.fillStyle = cssVar("--border-1");
  g.fillRect(0, h - 1, width, 1);
  g.fillStyle = cssVar("--wave-unplayed");
  for (const t of minor) g.fillRect(Math.round(xOf(view, width, t)), h - 7, 1, 6);
  g.font = `10px ${cssVar("--font-mono")}`;
  g.textBaseline = "top";
  for (const m of major) {
    const mx = Math.round(xOf(view, width, m.ms));
    g.fillStyle = cssVar("--muted-1");
    g.fillRect(mx, h - 13, 1, 12);
    g.fillStyle = cssVar("--text-5");
    g.fillText(m.label, mx + 4, 2);
  }
}

function drawBars(
  g: CanvasRenderingContext2D,
  data: AudioData,
  norm: number,
  bars: number,
  from: number,
  to: number,
  band: { y: number; h: number },
  color: (i: number) => string,
  curve: number,
): void {
  const levels = barLevels(data.samples, data.sampleRate, bars, from, to);
  const mid = band.y + band.h / 2;
  const maxH = band.h - 8;
  for (let i = 0; i < bars; i++) {
    const v = Math.min(1, levels[i]! / (norm || 1)) ** curve;
    const h = Math.max(2, Math.round(v * maxH));
    g.fillStyle = color(i);
    g.beginPath();
    g.roundRect(i * (BAR + BAR_GAP), mid - h / 2, BAR, h, 1);
    g.fill();
  }
}

function drawSpectrogram(g: CanvasRenderingContext2D, cache: SpectrogramCache | null, view: View, width: number, band: { y: number; h: number }): void {
  g.save();
  g.beginPath();
  g.roundRect(0, band.y, width, band.h, 4);
  g.clip();
  g.fillStyle = cssVar("--refine-spect-bg") || "#0e0d0c";
  g.fillRect(0, band.y, width, band.h);
  if (cache) {
    const msPerCol = quantizeMsPerCol(view.spanMs / width);
    const tileMs = msPerCol * TILE_COLS;
    g.imageSmoothingEnabled = true;
    for (const index of tilesFor(view.startMs, view.startMs + view.spanMs, msPerCol, TILE_COLS)) {
      const tile = cache.get({ msPerCol, index });
      if (!tile) continue;
      const x0 = xOf(view, width, index * tileMs);
      const x1 = xOf(view, width, (index + 1) * tileMs);
      g.drawImage(tile, x0, band.y, x1 - x0 + 0.5, band.h);
    }
  }
  g.restore();
}

function withAlpha(color: string, alpha: number): string {
  if (!color.startsWith("#")) return color;
  const [r, gg, b] = hexToRgb(color);
  return `rgba(${r}, ${gg}, ${b}, ${alpha})`;
}
