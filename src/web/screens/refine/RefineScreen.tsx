// 5 · Refine (Refine board): one line at a time on a zoomed timeline — nudge or drag word starts, join and
// split words, act on "Worth a look" flags. With no word selected, edits move the line start (its words
// follow). Keys: ←/→ ±10 ms (Shift ±100), Tab/Shift+Tab words, W play, S 0.5×, M join, / split,
// Ctrl+↑/↓ (or ↑/↓, PageUp/PageDown) change line, Esc back to the line start.

import { useCallback, useEffect, useRef, useState } from "react";
import { wordsOf } from "../../../core/lrc-document";
import { joinWithNext, splitWord } from "../../../core/word-edit";
import { useFlags } from "../../audio/audio-data";
import { player, usePlayerState } from "../../audio/player";
import { Chip, Kbd } from "../../components/controls";
import { Icon } from "../../components/icons";
import { HeaderExtras } from "../../components/slots";
import { useHotkeys } from "../../hotkeys/hotkeys";
import { clock } from "../../lib/format";
import { readLocal, writeLocal } from "../../lib/storage";
import { lineSpan } from "../../lib/timing";
import { commit, currentDoc, select, selectWord, stepLine, toast, useDoc, useSelection, useTrack } from "../../state";
import { Inspector } from "./Inspector";
import type { LaneToggles } from "./lanes";
import { moveTarget, nudgeTarget, stepWord, targetStart } from "./nudge";
import { Timeline } from "./Timeline";
import { clampView, DEFAULT_SPAN, ensureVisible, nextPreset, spanLabel, viewForLine, zoomAround, type View } from "./timeline-view";
import { lineBlocks } from "./word-blocks";
import "./refine.css";

const LANES_KEY = "lrcgen.refine.lanes";
const SPAN_KEY = "lrcgen.refine.span";
const NUDGE_COALESCE_MS = 1200;

function readLanes(): LaneToggles {
  try {
    const v = JSON.parse(readLocal(LANES_KEY) ?? "null") as Partial<LaneToggles> | null;
    if (v && typeof v === "object") return { vocals: v.vocals !== false, spect: v.spect !== false, mix: v.mix !== false };
  } catch {
    // Fall through to the default.
  }
  return { vocals: true, spect: true, mix: true };
}

function readSpan(): number {
  const n = Number(readLocal(SPAN_KEY));
  return Number.isFinite(n) && n >= 1000 && n <= 32000 ? n : DEFAULT_SPAN;
}

export function RefineScreen() {
  const doc = useDoc();
  const { line: lineIndex, word } = useSelection();
  const track = useTrack();
  const playerDuration = usePlayerState((s) => s.durationMs);
  const durationMs = playerDuration || track?.durationMs || 0;
  const allFlags = useFlags();
  const flags = allFlags.filter((f) => f.lineIndex === lineIndex);
  const line = doc.lines[lineIndex];
  const hasStem = track?.hasVocals ?? false;

  const [lanes, setLanes] = useState(readLanes);
  const toggleLane = (key: keyof LaneToggles) => {
    const next = { ...lanes, [key]: !lanes[key] };
    setLanes(next);
    writeLocal(LANES_KEY, JSON.stringify(next));
  };

  const [view, setViewState] = useState<View>(() => {
    const t = line?.timestamp ?? previousStart(lineIndex);
    return viewForLine(t, readSpan());
  });
  const setView = useCallback((update: (v: View) => View) => setViewState((v) => update(v)), []);
  useEffect(() => writeLocal(SPAN_KEY, String(Math.round(view.spanMs))), [view.spanMs]);

  // A new line: frame it. A moved or newly selected target: keep it in view.
  const lineStart = line?.timestamp ?? null;
  const framed = useRef<number | null>(null);
  useEffect(() => {
    if (framed.current === lineIndex) return;
    framed.current = lineIndex;
    const t = lineStart ?? previousStart(lineIndex);
    setViewState((v) => clampView(viewForLine(t, v.spanMs), durationMs));
  }, [lineIndex]);
  const target = targetStart(doc, { line: lineIndex, word });
  useEffect(() => {
    if (target !== null) setViewState((v) => clampView(ensureVisible(v, target), durationMs));
  }, [target, durationMs]);

  // ---------------------------------------------------------------- actions

  const lastNudge = useRef<string>("");
  const nudge = (delta: number) => {
    const d = currentDoc();
    if (!d) return;
    const t = { line: lineIndex, word };
    const next = nudgeTarget(d, t, delta, durationMs);
    if (next === d) {
      if (targetStart(d, t) === null) toast(word === null ? "This line has no start yet — tap it on the Lines step" : "This word has no start yet — drag it onto the timeline or type a time");
      return;
    }
    const key = `${lineIndex}:${word}`;
    commit(next, "nudge", { coalesceMs: lastNudge.current === key ? NUDGE_COALESCE_MS : undefined });
    lastNudge.current = key;
  };

  const setStart = (ms: number) => {
    const d = currentDoc();
    if (d) commit(moveTarget(d, { line: lineIndex, word }, ms, durationMs), "edit time");
  };

  const playTarget = () => {
    const d = currentDoc();
    if (!d) return;
    const span = lineSpan(d, lineIndex, durationMs);
    if (word === null) {
      if (span) player.playSegment(span.from, span.to);
      return;
    }
    const block = lineBlocks(d.lines[lineIndex], span?.to ?? null).blocks.find((b) => b.index === word);
    if (block) player.playSegment(block.start, block.end);
    else toast("This word has no start yet");
  };

  const toggleSlow = () => player.setSpeed(player.getState().rate === 0.5 ? 1 : 0.5);

  const join = () => {
    const d = currentDoc();
    if (!d || word === null) return;
    const next = joinWithNext(d, lineIndex, word);
    if (next !== d) commit(next, "join");
  };

  const split = () => {
    const d = currentDoc();
    if (!d || word === null) return;
    const next = splitWord(d, lineIndex, word);
    if (next !== d) commit(next, "split");
  };

  const walk = (dir: 1 | -1) => {
    const d = currentDoc();
    const l = d?.lines[lineIndex];
    if (!l) return;
    const next = stepWord(wordsOf(l).length, word, dir);
    select(lineIndex, next);
    const t = targetStart(d, { line: lineIndex, word: next });
    if (t !== null && !player.getState().playing) player.seek(t);
  };

  const zoom = (dir: 1 | -1) => {
    setViewState((v) => {
      const anchor = target !== null && target >= v.startMs && target <= v.startMs + v.spanMs ? target : v.startMs + v.spanMs / 2;
      return clampView(zoomAround(v, nextPreset(v.spanMs, dir), anchor), durationMs);
    });
  };

  useHotkeys({
    ArrowLeft: () => nudge(-10),
    ArrowRight: () => nudge(10),
    "Shift+ArrowLeft": () => nudge(-100),
    "Shift+ArrowRight": () => nudge(100),
    Tab: () => walk(1),
    "Shift+Tab": () => walk(-1),
    W: { run: playTarget, repeat: false },
    S: { run: toggleSlow, repeat: false },
    M: { run: join, repeat: false },
    "/": { run: split, repeat: false },
    "Ctrl+ArrowUp": () => stepLine(-1),
    "Ctrl+ArrowDown": () => stepLine(1),
    ArrowUp: () => stepLine(-1),
    ArrowDown: () => stepLine(1),
    PageUp: () => stepLine(-1),
    PageDown: () => stepLine(1),
    Escape: () => (word !== null ? selectWord(null) : false),
  });

  // ---------------------------------------------------------------- layout

  const prev = lineIndex > 0 ? doc.lines[lineIndex - 1] : undefined;
  const next = doc.lines[lineIndex + 1];

  return (
    <div className="refine-screen">
      {hasStem && (
        <HeaderExtras>
          <Chip tone="vocals" size="lg">
            <Icon.Check size={13} />
            Vocals separated
          </Chip>
        </HeaderExtras>
      )}
      <main className="refine-main">
        <div className="refine-title">
          <span className="refine-line-no">
            Line {lineIndex + 1} · {line?.timestamp != null ? clock(line.timestamp) : "no start yet"}
          </span>
          <h1 className="refine-line-text" title={line?.text}>
            {line?.text.trim() || "Empty line"}
          </h1>
          <span className="refine-spacer" />
          <div role="group" aria-label="Lanes" className="refine-lane-toggles">
            <button type="button" className="refine-lane-toggle vocals" aria-pressed={lanes.vocals} onClick={() => toggleLane("vocals")}>
              Vocals
            </button>
            <button type="button" className="refine-lane-toggle vocals" aria-pressed={lanes.spect} onClick={() => toggleLane("spect")}>
              Spectrogram
            </button>
            <button type="button" className="refine-lane-toggle" aria-pressed={lanes.mix} onClick={() => toggleLane("mix")}>
              Full mix
            </button>
          </div>
          <div className="refine-zoom">
            <button type="button" aria-label="Zoom out" title="Zoom out (Ctrl + wheel)" onClick={() => zoom(1)}>
              −
            </button>
            <span className="mono">{spanLabel(view.spanMs)}</span>
            <button type="button" aria-label="Zoom in" title="Zoom in (Ctrl + wheel)" onClick={() => zoom(-1)}>
              +
            </button>
          </div>
        </div>

        <Timeline doc={doc} lineIndex={lineIndex} word={word} view={view} setView={setView} lanes={lanes} flags={flags} durationMs={durationMs} hasStem={hasStem} />

        <div className="refine-context">
          {prev ? (
            <button type="button" className="refine-context-line" onClick={() => stepLine(-1)} title="Previous line (Ctrl ↑)">
              <Kbd keys="ArrowUp" />
              <span className="no">{lineIndex}</span>
              <span className="text">{prev.text.trim() || "Empty line"}</span>
            </button>
          ) : (
            <span className="refine-context-line placeholder" />
          )}
          <span className="refine-context-hint">Drag a block by its left edge — that's where the word starts. The dotted mark inside a joined block is where it can be split.</span>
          {next ? (
            <button type="button" className="refine-context-line" onClick={() => stepLine(1)} title="Next line (Ctrl ↓)">
              <span className="no">{lineIndex + 2}</span>
              <span className="text">{next.text.trim() || "Empty line"}</span>
              <Kbd keys="ArrowDown" />
            </button>
          ) : (
            <span className="refine-context-line placeholder" />
          )}
        </div>
      </main>

      <Inspector
        doc={doc}
        lineIndex={lineIndex}
        word={word}
        flags={flags}
        onNudge={nudge}
        onSetStart={setStart}
        onPlay={playTarget}
        onSlow={toggleSlow}
        onJoin={join}
        onSplit={split}
      />
    </div>
  );
}

/** Where to look for a line with no start: the closest timed line above it. */
function previousStart(index: number): number {
  const d = currentDoc();
  if (!d) return 0;
  for (let i = index; i >= 0; i--) {
    const t = d.lines[i]?.timestamp;
    if (t != null) return t;
  }
  return 0;
}
