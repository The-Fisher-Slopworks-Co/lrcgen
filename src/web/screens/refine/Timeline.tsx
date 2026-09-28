// The Refine timeline (Refine board): ruler, the group rows — lines, then labelled groups (backing vocals,
// ad-libs) — with a draggable block per word, the ghost strip for the selected group's untimed words, vocals
// waveform, spectrogram and mix lanes, playhead and loop. Two canvases — the audio lanes (redrawn when the view
// moves) and an overlay with the selected word's start and end, flags and the playhead (redrawn every frame) —
// with the bands and blocks as elements in between.
//
// A block's left edge is where the word starts, its right edge where it ends (faded when the word has no end of its
// own and runs until the next word). Drag an edge to move it, the middle to move the word. Click picks a word
// (Shift/Ctrl adds more), double-click plays it. Wheel scrolls, Ctrl+wheel zooms, dragging the ruler scrolls, a
// click elsewhere seeks; while playing, the view pages along with the playhead.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { flagTime, type Flag } from "../../../core/flags";
import { isLabelled, setWordTimes, type Group, type LyricsDoc } from "../../../core/lyrics";
import type { AudioData } from "../../audio/analysis";
import { ENVELOPE_FRAME_MS, useAudioData } from "../../audio/audio-data";
import { player, usePositionEffect } from "../../audio/player";
import { Button, LabelChips } from "../../components/controls";
import { Icon } from "../../components/icons";
import { cssVar } from "../../lib/css";
import { labelHue } from "../../lib/labels";
import { percent, seconds } from "../../lib/format";
import { commit, currentDoc, goToStep, startJob, useRunningJob } from "../../state";
import { flagNote, groupBlocks, timelineRows, type WordBlock } from "./blocks";
import { laneLayout, ROW_H, type LaneLayout, type LaneToggles } from "./lanes";
import { moveEnd, moveTarget } from "./nudge";
import { SpectrogramCache, TILE_COLS } from "./spectrogram-cache";
import { colorRamp, hexToRgb, quantizeMsPerCol, tilesFor } from "./spectrogram";
import { clampView, msAt, rulerTicks, xOf, zoomAround, type View } from "./timeline-view";
import { barLevels, loudestLevel, voicedBars } from "./waves";

export interface TimelineProps {
  /** What to draw: the document, or a retap's work in progress. */
  doc: LyricsDoc;
  /** The selected group and word. */
  group: number;
  word: number | null;
  /** Words picked besides the selected one (Shift+click), by id. */
  picked: ReadonlySet<string>;
  /** Groups the Groups pane filters out: drawn faded. */
  dimmed: (group: Group) => boolean;
  view: View;
  setView: (update: (v: View) => View) => void;
  lanes: LaneToggles;
  flags: Flag[];
  durationMs: number;
  hasStem: boolean;
  /** No dragging or picking (a retap is running). */
  locked?: boolean;
  /** The word tapped last in a retap: drawn from its start to the playhead, until the next tap. */
  live?: { group: number; start: number } | null;
  onPickWord: (group: number, word: number, additive: boolean) => void;
  onPickGroup: (group: number) => void;
}

const BAR = 3;
const BAR_GAP = 1;
const DRAG_THRESHOLD = 3;
/** Where the blocks sit in a row, under the label tag. */
const BLOCK_TOP = 19;
const BLOCK_H = 30;

interface Size {
  width: number;
  height: number;
}

type Edge = "start" | "end" | "move";

type Gesture =
  | { kind: "ruler"; x0: number; view0: View; moved: boolean }
  | { kind: "seek" }
  | { kind: "block"; edge: Edge; group: number; word: number; x0: number; start: number; end: number | null; drawnEnd: number; moved: boolean; additive: boolean }
  | { kind: "ghost"; group: number; word: number; x0: number; y0: number; moved: boolean; ms: number | null };

const round10 = (ms: number) => Math.round(ms / 10) * 10;

/** The document with a block gesture applied, `dt` ms along. */
function dragged(doc: LyricsDoc, g: Extract<Gesture, { kind: "block" }>, dt: number, durationMs: number): LyricsDoc {
  const target = { line: g.group, word: g.word };
  if (g.edge === "start") {
    const limit = (g.end ?? Number.POSITIVE_INFINITY) - 20;
    return moveTarget(doc, target, Math.min(limit, round10(g.start + dt)), durationMs);
  }
  if (g.edge === "end") return moveEnd(doc, target, round10(g.drawnEnd + dt), durationMs);
  if (g.end === null) return moveTarget(doc, target, round10(g.start + dt), durationMs);
  const shift = Math.max(-g.start, round10(dt));
  return setWordTimes(doc, g.group, g.word, g.start + shift, g.end + shift);
}

export function Timeline(props: TimelineProps) {
  const { doc, group, word, picked, dimmed, view, setView, lanes, flags, durationMs, hasStem, locked, live, onPickWord, onPickGroup } = props;
  const lanesBox = useRef<HTMLDivElement>(null);
  const bgCanvas = useRef<HTMLCanvasElement>(null);
  const fgCanvas = useRef<HTMLCanvasElement>(null);
  const blockEls = useRef(new Map<string, HTMLElement>());
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [drag, setDrag] = useState<{ doc: LyricsDoc; tip: { x: number; text: string } | null } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const audio = useAudioData();
  const dpr = window.devicePixelRatio || 1;

  // Latest values for native listeners.
  const live$ = useRef({ view, size, durationMs });
  live$.current = { view, size, durationMs };

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
      const { size: s, durationMs: d } = live$.current;
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

  // What's drawn: the document with the block being dragged already moved. Rows come from the real document, so
  // they hold still while dragging.
  const shown = drag?.doc ?? doc;
  const base = useMemo(() => timelineRows(doc, view, durationMs), [doc, view, durationMs]);
  const rows = useMemo(() => (shown === doc ? base : timelineRows(shown, view, durationMs)), [shown, doc, base, view, durationMs]);
  const rowOf = new Map(base.bands.map((b) => [b.group, b.row]));
  const rowCount = base.lineRows + base.labelledRows;
  // The ghost strip reads the real document, so a ghost being dragged stays put (and keeps the pointer).
  const { untimed } = groupBlocks(doc, group, durationMs);
  const layout = laneLayout(size.height, lanes, untimed.length > 0, rowCount);
  const x = (ms: number) => xOf(view, size.width, ms);
  const rowY = (row: number) => layout.words.y + row * ROW_H;
  const flaggedWords = new Set(flags.filter((f) => f.wordIndex !== undefined).map((f) => `${f.lineIndex}:${f.wordIndex}`));
  const selectedBlock = rows.blocks.find((b) => b.group === group && b.word === word) ?? null;

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
    // Where the labelled rows begin.
    const split = rowY(base.lineRows);
    g.strokeStyle = cssVar("--border-2");
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(0, split + 0.5);
    g.lineTo(size.width, split + 0.5);
    g.stroke();
    g.setLineDash([]);

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
  const bgKey = [view.startMs, view.spanMs, size.width, size.height, dpr, lanes.vocals, lanes.spect, lanes.mix, !!layout.ghost, rowCount, base.lineRows, audio.loading].join("|");
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
      if (b < 0 || a > size.width) continue;
      g.fillStyle = withAlpha(cssVar("--warn"), 0.18);
      g.fillRect(a, top + 6, Math.max(2, b - a), bottom - top - 6);
    }

    // The selected word's start and end down through the audio lanes, so the end can be checked against the
    // voice; with no word selected, the group's start.
    const line = (t: number, color: string, w: number, dashed = false) => {
      const lx = Math.round(x(t) - w / 2);
      if (lx < -4 || lx > size.width + 4) return;
      if (!dashed) {
        g.fillStyle = color;
        g.fillRect(lx, top, w, bottom - top);
        return;
      }
      g.strokeStyle = color;
      g.lineWidth = w;
      g.setLineDash([5, 4]);
      g.beginPath();
      g.moveTo(lx + w / 2, top);
      g.lineTo(lx + w / 2, bottom);
      g.stroke();
      g.setLineDash([]);
    };
    if (selectedBlock) {
      g.fillStyle = withAlpha(accent, 0.07);
      g.fillRect(x(selectedBlock.start), top, x(selectedBlock.end) - x(selectedBlock.start), bottom - top);
      line(selectedBlock.start, accent, 2);
      line(selectedBlock.end, withAlpha(accent, selectedBlock.derived ? 0.5 : 0.9), selectedBlock.derived ? 1 : 2, selectedBlock.derived);
    } else {
      for (const b of rows.blocks) if (b.group === group) line(b.start, withAlpha(cssVar("--text-1"), 0.22), 1);
    }

    // The word tapped last in a retap grows with the playhead until the next tap.
    if (live) {
      const row = rowOf.get(live.group) ?? 0;
      const x0 = x(live.start);
      const x1 = Math.max(x0 + 2, x(heard));
      g.fillStyle = withAlpha(accent, 0.55);
      g.beginPath();
      g.roundRect(x0, rowY(row) + BLOCK_TOP, x1 - x0, BLOCK_H, 6);
      g.fill();
      g.fillStyle = withAlpha(accent, 0.08);
      g.fillRect(x0, top, x1 - x0, bottom - top);
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

    // Words being sung light up.
    const playing = player.getState().playing;
    for (const b of rows.blocks) {
      const el = blockEls.current.get(b.id);
      if (el) el.classList.toggle("sung", playing && heard >= b.start && heard < b.end);
    }
  };
  const drawFgRef = useRef(drawFg);
  drawFgRef.current = drawFg;
  usePositionEffect((_, heard) => {
    drawFgRef.current(heard);
    // Page along with the playhead while the song plays (not while a word or line plays on its own).
    const st = player.getState();
    const { view: v } = live$.current;
    if (st.playing && st.segmentEnd === null && !gesture.current && (heard > v.startMs + v.spanMs * 0.94 || heard < v.startMs)) {
      setView((cur) => clampView({ ...cur, startMs: heard - cur.spanMs * 0.08 }, live$.current.durationMs));
    }
  });
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
      (m) => player.seek(clampSong(msAt(live$.current.view, live$.current.size.width, lanesPoint(m.clientX)))),
      () => (gesture.current = null),
    );
  };

  const tipText = (d: LyricsDoc, g: Extract<Gesture, { kind: "block" }>) => {
    const w = d.groups[g.group]?.words[g.word];
    if (!w || w.start === null) return "";
    if (g.edge === "start") return `starts ${seconds(w.start)}`;
    if (g.edge === "end") return `ends ${w.end === null ? "–" : seconds(w.end)}`;
    return w.end === null ? `starts ${seconds(w.start)}` : `${seconds(w.start)} → ${seconds(w.end)}`;
  };

  const onBlockDown = (e: ReactPointerEvent, b: WordBlock, edge: Edge) => {
    e.stopPropagation();
    if (e.button !== 0 || locked) return;
    const w = doc.groups[b.group]?.words[b.word];
    if (!w || w.start === null) return;
    const g: Gesture = {
      kind: "block",
      edge,
      group: b.group,
      word: b.word,
      x0: e.clientX,
      start: w.start,
      end: w.end,
      drawnEnd: b.end,
      moved: false,
      additive: e.shiftKey || e.metaKey || e.ctrlKey,
    };
    gesture.current = g;
    follow(
      (m) => {
        const dx = m.clientX - g.x0;
        if (!g.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
        g.moved = true;
        const next = dragged(doc, g, (dx * view.spanMs) / size.width, durationMs);
        setDrag({ doc: next, tip: { x: lanesPoint(m.clientX), text: tipText(next, g) } });
      },
      (u) => {
        gesture.current = null;
        setDrag(null);
        if (!g.moved) {
          onPickWord(g.group, g.word, g.additive);
          if (!player.getState().playing) player.seek(g.start);
          return;
        }
        onPickWord(g.group, g.word, false);
        const d = currentDoc();
        if (d) commit(dragged(d, g, ((u.clientX - g.x0) * view.spanMs) / size.width, durationMs), g.edge === "end" ? "drag end" : "drag");
      },
    );
  };

  const onGhostDown = (e: ReactPointerEvent, index: number) => {
    e.stopPropagation();
    if (e.button !== 0 || locked) return;
    const g: Gesture = { kind: "ghost", group, word: index, x0: e.clientX, y0: e.clientY, moved: false, ms: null };
    gesture.current = g;
    onPickWord(group, index, false);
    follow(
      (m) => {
        if (!g.moved && Math.hypot(m.clientX - g.x0, m.clientY - g.y0) < DRAG_THRESHOLD) return;
        g.moved = true;
        const px = lanesPoint(m.clientX);
        const r = lanesBox.current?.getBoundingClientRect();
        const inside = !!r && px >= 0 && px <= size.width && m.clientY >= r.top && m.clientY <= r.bottom;
        g.ms = inside ? clampSong(round10(msAt(view, size.width, px))) : null;
        setDrag(g.ms === null ? null : { doc: moveTarget(doc, { line: g.group, word: g.word }, g.ms, durationMs), tip: { x: px, text: `starts ${seconds(g.ms)}` } });
      },
      () => {
        gesture.current = null;
        setDrag(null);
        const d = currentDoc();
        if (g.moved && g.ms !== null && d) commit(moveTarget(d, { line: g.group, word: g.word }, g.ms, durationMs), "drag");
      },
    );
  };

  const playBlock = (b: WordBlock) => player.playSegment(b.start, b.end);

  // ---------------------------------------------------------------- DOM

  const labelTop = (band: { y: number; h: number } | null) => (band ? band.y + band.h / 2 - 7 : 0);
  const selectedFlags = flags.filter((f) => f.lineIndex === group);
  const noteFlag = selectedFlags.find((f) => f.suggestMs !== undefined || f.wordIndex !== undefined) ?? selectedFlags[0];
  const noteAt = noteFlag ? flagTime(shown, noteFlag) : null;
  const noteX = noteFlag && noteAt !== null ? x(Math.max(noteAt, noteFlag.suggestMs ?? noteAt)) + 5 : null;
  const noteY = (layout.vocals ?? layout.spect ?? layout.mix)?.y;
  const inView = (from: number, to: number) => x(to) >= -40 && x(from) <= size.width + 40;
  const nothingTimed = rows.blocks.length === 0;

  // A block's text may run past its end, up to the next block of its group: short words stay readable.
  const room = (b: WordBlock) => {
    let next = b.start + 4000;
    for (const o of rows.blocks) if (o.group === b.group && o.start > b.start && o.start < next) next = o.start;
    return Math.max(x(b.end), x(next)) - x(b.start) - 12;
  };

  return (
    <div className="refine-timeline">
      <div className="refine-lane-labels" aria-hidden="true">
        <span style={{ top: rowY(0) + ROW_H / 2 - 7 }}>Lines</span>
        <span className="labelled" style={{ top: rowY(base.lineRows) + ROW_H / 2 - 7 }}>
          Labelled
        </span>
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

      <div ref={lanesBox} className={locked ? "refine-lanes locked" : "refine-lanes"} onPointerDown={onLanesDown}>
        <canvas ref={bgCanvas} className="refine-canvas" />

        {rows.bands.map((band) => {
          const g = shown.groups[band.group]!;
          if (!inView(band.start, band.end)) return null;
          const row = rowOf.get(band.group) ?? band.row;
          const hue = isLabelled(g) ? labelHue(g.labels[0]!) : "var(--muted-1)";
          const cls = ["refine-band", band.group === group && "selected", dimmed(g) && "dim"].filter(Boolean).join(" ");
          return (
            <div
              key={g.id}
              className={cls}
              style={{ left: x(band.start) - 6, width: x(band.end) - x(band.start) + 12, top: rowY(row) + 2, height: ROW_H - 4, "--c": hue } as CSSProperties}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (e.button === 0 && !locked) onPickGroup(band.group);
              }}
              onDoubleClick={() => player.playSegment(band.start, band.end)}
              title={isLabelled(g) ? `Group ${band.group + 1} · ${g.labels.join(", ")} — double-click to play it` : `Line ${band.group + 1} — double-click to play it`}
            >
              <span className="tag">
                <span className="num">{band.group + 1}</span>
                {isLabelled(g) && <LabelChips labels={g.labels} small />}
              </span>
            </div>
          );
        })}

        {rows.blocks.map((b) => {
          const left = x(b.start);
          const width = Math.max(10, x(b.end) - left - 2);
          if (left > size.width + 20 || left + width < -20) return null;
          const g = shown.groups[b.group]!;
          const row = rowOf.get(b.group) ?? 0;
          const isSel = b.group === group && b.word === word;
          const isPicked = picked.has(b.id);
          const flagged = flaggedWords.has(`${b.group}:${b.word}`);
          const hue = isLabelled(g) ? labelHue(g.labels[0]!) : "var(--muted-1)";
          const cls = [
            "refine-block",
            isSel && "selected",
            !isSel && isPicked && "picked",
            flagged && "flagged",
            b.derived && "derived",
            dimmed(g) && "dim",
            drag && gesture.current?.kind === "block" && gesture.current.group === b.group && gesture.current.word === b.word && "dragging",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={b.id}
              ref={(el) => {
                if (el) blockEls.current.set(b.id, el);
                else blockEls.current.delete(b.id);
              }}
              role="button"
              tabIndex={-1}
              className={cls}
              style={{ left, width, top: rowY(row) + BLOCK_TOP, "--c": hue } as CSSProperties}
              aria-pressed={isSel || isPicked}
              aria-label={`${b.parts.join(" ")}, ${seconds(b.start)} to ${b.derived ? "the next word" : seconds(b.end)}`}
              title={`${b.parts.join(" ")} · ${seconds(b.start)} → ${b.derived ? `${seconds(b.end)} (no end: until the next word)` : seconds(b.end)}`}
              onPointerDown={(e) => onBlockDown(e, b, "move")}
              onDoubleClick={() => playBlock(b)}
            >
              <span className="h l" onPointerDown={(e) => onBlockDown(e, b, "start")} />
              {b.splits.map((s, i) => (
                <span key={i} className="split" style={{ left: x(s) - left }} />
              ))}
              <span className="word" style={{ maxWidth: Math.max(0, room(b)) }}>
                {b.parts.map((p, i) => (
                  <span key={i} className="part">
                    {i > 0 && <Icon.Link size={11} aria-label="joined" />}
                    {p}
                  </span>
                ))}
                {flagged && <Icon.Warning size={12} className="flag-icon" />}
              </span>
              <span className="h r" onPointerDown={(e) => onBlockDown(e, b, "end")} />
            </div>
          );
        })}

        {drag?.tip && (
          <span className="refine-drag-tip" style={{ left: drag.tip.x + 10, top: layout.words.y + 2 }}>
            {drag.tip.text}
          </span>
        )}

        {nothingTimed && (
          <div className="refine-lane-hint" style={{ top: layout.words.y, height: layout.words.h }}>
            No timed words around here. Tap line starts on the Lines step, then the words on the Words step.
            <button type="button" className="refine-link" onClick={() => goToStep("lines")}>
              Go to Lines
            </button>
          </div>
        )}

        {layout.ghost && (
          <div className="refine-ghosts" style={{ top: layout.ghost.y, height: layout.ghost.h }}>
            <span className="label">No start yet in group {group + 1} — drag onto the timeline:</span>
            {untimed.map((u) => (
              <button
                key={u.word}
                type="button"
                className={u.word === word ? "refine-ghost selected" : "refine-ghost"}
                onPointerDown={(e) => onGhostDown(e, u.word)}
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
          <span>No separated vocals yet. With them, this lane shows where the voice is, word ends can be fitted to it, and the spectrogram gets clearer.</span>
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
