// 6 · Preview (Preview board): the karaoke as it will look in a video, a whole-song timeline with line
// starts and flags, readiness, and the way to Save & publish. ↑/↓ jump between lines, R replays the line.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isBacking } from "../../../core/backing";
import { wordsOf } from "../../../core/lrc-document";
import { useFlags } from "../../audio/audio-data";
import { player, usePlayerState, usePositionEffect } from "../../audio/player";
import { Button, KeyHint, Segmented } from "../../components/controls";
import { Icon } from "../../components/icons";
import { useHotkeys } from "../../hotkeys/hotkeys";
import { readLocal, writeLocal } from "../../lib/storage";
import { lineSpan } from "../../lib/timing";
import { select, useDoc, useDraftProgress, useTrack } from "../../state";
import { reviewFlag } from "../refine/review";
import { flagTime } from "../refine/word-blocks";
import { openSaveDialog } from "../save/open-save";
import { currentLineAt, fillBackground, jumpBase, jumpTarget, stageLines, wordFills, type Highlight, type JumpCursor, type LinesOnScreen } from "./karaoke";
import "./preview.css";

const BOARD_STAGE_W = 960;
const BOARD_MAIN_W = 1100;

function useLocalChoice<T extends string | number>(key: string, options: readonly T[], fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readLocal(key);
    return options.find((o) => String(o) === stored) ?? fallback;
  });
  const set = (v: T) => {
    setValue(v);
    writeLocal(key, String(v));
  };
  return [value, set];
}

function useDuration(): number {
  const track = useTrack();
  const playerDuration = usePlayerState((s) => s.durationMs);
  return playerDuration || track?.durationMs || 0;
}

export function PreviewScreen() {
  const doc = useDoc();
  const [highlight, setHighlight] = useLocalChoice<Highlight>("lrcgen.preview.highlight", ["word", "line"], "word");
  const [count, setCount] = useLocalChoice<LinesOnScreen>("lrcgen.preview.lines", [1, 2, 3], 3);
  const main = useRef<HTMLElement>(null);
  const [stageW, setStageW] = useState(BOARD_STAGE_W);

  useEffect(() => {
    const el = main.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setStageW(Math.floor(Math.max(320, Math.min((w * BOARD_STAGE_W) / BOARD_MAIN_W, w - 80, ((h - 48 - 20 - 56) * 16) / 9))));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);

  const cursor = useRef<JumpCursor | null>(null);
  const jump = (dir: 1 | -1) => {
    const target = jumpTarget(doc, jumpBase(doc, player.heardPosition(), cursor.current), dir);
    if (target === null) return;
    select(target);
    const t = doc.lines[target]!.timestamp!;
    cursor.current = { index: target, at: t };
    if (player.getState().playing) player.play(t);
    else player.seek(t);
  };

  const replay = () => {
    const current = jumpBase(doc, player.heardPosition(), cursor.current);
    player.play(current >= 0 ? doc.lines[current]!.timestamp! : 0);
  };

  useHotkeys({ ArrowUp: () => jump(-1), ArrowDown: () => jump(1), R: { run: replay, repeat: false } });

  return (
    <div className="preview-screen">
      <main ref={main} className="preview-main">
        <KaraokeStage width={stageW} highlight={highlight} count={count} />
        <PreviewTimeline width={stageW} />
      </main>
      <SidePanel highlight={highlight} setHighlight={setHighlight} count={count} setCount={setCount} />
    </div>
  );
}

// ---------------------------------------------------------------- the stage

function KaraokeStage({ width, highlight, count }: { width: number; highlight: Highlight; count: LinesOnScreen }) {
  const doc = useDoc();
  const track = useTrack();
  const duration = useDuration();
  const [current, setCurrent] = useState(() => currentLineAt(doc, player.heardPosition()));
  const words = useRef<(HTMLSpanElement | null)[]>([]);
  const painted = useRef<string[]>([]);

  const line = current >= 0 ? doc.lines[current] : undefined;
  const backing = !!line && isBacking(line);
  const lineEndMs = current >= 0 ? (lineSpan(doc, current, duration)?.to ?? null) : null;

  const paint = (heard: number) => {
    if (!line) return;
    const fills = wordFills(line, heard, highlight, lineEndMs);
    const rest = backing ? "var(--vocals)" : "var(--text-1)";
    fills.forEach((fill, i) => {
      const el = words.current[i];
      if (!el) return;
      const bg = fillBackground(fill, "var(--accent)", rest);
      if (painted.current[i] !== bg) {
        el.style.backgroundImage = bg;
        painted.current[i] = bg;
      }
    });
  };

  usePositionEffect((_, heard) => {
    const idx = currentLineAt(doc, heard);
    if (idx !== current) setCurrent(idx);
    else paint(heard);
  });

  // The document can change under us (undo); keep the line on stage in step with it.
  useEffect(() => setCurrent(currentLineAt(doc, player.heardPosition())), [doc]);

  useLayoutEffect(() => {
    painted.current = [];
    paint(player.heardPosition());
  });

  const k = width / BOARD_STAGE_W;
  const lines = stageLines(doc, current, count);
  const title = doc.metadata.title?.trim() || track?.title || "";
  const artist = doc.metadata.artist?.trim() || track?.artist || "";

  return (
    <div
      className="preview-stage"
      aria-label="Karaoke preview"
      style={{ width, height: Math.round((width * 9) / 16), gap: 28 * k, ["--k" as string]: k }}
    >
      <span className="preview-stage-label">as in the video · 16:9</span>
      {lines.map((slot) => {
        if (slot.role === "current") {
          if (slot.index === null) {
            return (
              <div key="title" className="preview-title">
                <p className="title">{title}</p>
                {artist && <p className="artist">{artist}</p>}
              </div>
            );
          }
          const l = doc.lines[slot.index]!;
          return (
            <p key={`c${slot.index}`} className={isBacking(l) ? "preview-line current backing" : "preview-line current"}>
              {wordsOf(l).map((w, i) => (
                <span key={i} ref={(el) => void (words.current[i] = el)} className="preview-word">
                  {w.text.trim()}
                </span>
              ))}
            </p>
          );
        }
        const l = slot.index !== null && slot.index >= 0 ? doc.lines[slot.index] : undefined;
        const cls = ["preview-line", slot.role, l && isBacking(l) && "backing"].filter(Boolean).join(" ");
        return (
          <p key={`${slot.role}${slot.index}`} className={cls} aria-hidden={!l}>
            {l ? l.text.trim() : " "}
          </p>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- the timeline

function PreviewTimeline({ width }: { width: number }) {
  const doc = useDoc();
  const flags = useFlags();
  const duration = useDuration();
  const progress = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLSpanElement>(null);
  const ticks = useRef<(HTMLSpanElement | null)[]>([]);
  const box = useRef<HTMLDivElement>(null);

  const starts = doc.lines.map((l) => (l.text.trim() !== "" ? l.timestamp : null));
  const x = (ms: number) => (duration > 0 ? Math.min(width, Math.max(0, (ms / duration) * width)) : 0);

  const paint = (heard: number) => {
    const px = x(heard);
    if (progress.current) progress.current.style.width = `${px}px`;
    if (head.current) head.current.style.transform = `translateX(${px - 7}px)`;
    starts.forEach((t, i) => {
      const el = ticks.current[i];
      if (el && t !== null) el.classList.toggle("passed", t < heard);
    });
  };
  usePositionEffect((_, heard) => paint(heard));
  useLayoutEffect(() => paint(player.heardPosition()));

  const seekAt = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || duration <= 0) return;
    player.seek(Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration)));
  };

  return (
    <div className="preview-timeline" style={{ width }}>
      <div
        ref={box}
        className="preview-track"
        role="slider"
        aria-label="Song position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekAt(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e.clientX);
        }}
      >
        <div className="rail" />
        <div ref={progress} className="progress" />
        {starts.map((t, i) =>
          t === null ? null : <span key={i} ref={(el) => void (ticks.current[i] = el)} className="tick" style={{ left: x(t) - 1 }} title={`Line ${i + 1}`} />,
        )}
        {flags.map((flag) => {
          const t = flagTime(doc, flag);
          if (t === null) return null;
          return (
            <button
              key={flag.id}
              type="button"
              className="preview-flag"
              style={{ left: x(t) - 5 }}
              title={`Line ${flag.lineIndex + 1}: ${flag.message}`}
              aria-label={`Line ${flag.lineIndex + 1}: ${flag.message} — review in Refine`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => reviewFlag(flag)}
            />
          );
        })}
        <span ref={head} className="playhead" />
      </div>
      <div className="preview-hints">
        <span>Ticks mark line starts. The diamond is a spot worth checking.</span>
        <span className="keys">
          <KeyHint keys={["ArrowUp", "ArrowDown"]}>jump to line</KeyHint> · <KeyHint keys={["R"]}>replay line</KeyHint>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- side panel

function SidePanel({
  highlight,
  setHighlight,
  count,
  setCount,
}: {
  highlight: Highlight;
  setHighlight: (h: Highlight) => void;
  count: LinesOnScreen;
  setCount: (c: LinesOnScreen) => void;
}) {
  const flags = useFlags();
  const progress = useDraftProgress(flags.length);
  const first = flags[0];

  return (
    <aside className="preview-side">
      <section className="preview-group">
        <h2 className="eyebrow">Highlight</h2>
        <Segmented
          label="Highlight"
          size="lg"
          fill
          options={[
            { value: "word", label: "By word" },
            { value: "line", label: "By line" },
          ]}
          value={highlight}
          onChange={setHighlight}
        />
      </section>
      <section className="preview-group">
        <h2 className="eyebrow">Lines on screen</h2>
        <Segmented
          label="Lines on screen"
          size="lg"
          fill
          options={([1, 2, 3] as const).map((n) => ({ value: n, label: String(n) }))}
          value={count}
          onChange={setCount}
        />
      </section>

      <section className="preview-readiness">
        <h2 className="eyebrow">Readiness</h2>
        <div className="row">
          <span className="label">Lines timed</span>
          <span className="value">
            {progress?.linesTimed ?? 0} / {progress?.totalLines ?? 0}
          </span>
        </div>
        <div className="row">
          <span className="label">Lines with word timings</span>
          <span className="value">
            {progress?.linesWithWords ?? 0} / {progress?.totalLines ?? 0}
          </span>
        </div>
        {first ? (
          <div className="row">
            <span className="label warn">
              <Icon.Warning size={14} />
              Worth a look
            </span>
            <button type="button" className="preview-link" onClick={() => reviewFlag(first)} title={first.message}>
              line {first.lineIndex + 1} →
            </button>
          </div>
        ) : (
          <div className="row">
            <span className="label">Worth a look</span>
            <span className="value muted">Nothing to check</span>
          </div>
        )}
      </section>

      <div className="preview-spacer" />
      <div className="preview-actions">
        <Button variant="primary" size="lg" kbd="Ctrl+S" block onClick={() => openSaveDialog("save")}>
          Save next to the track
        </Button>
        <Button variant="secondary" block onClick={() => openSaveDialog("publish")}>
          Publish to the database…
        </Button>
      </div>
    </aside>
  );
}

