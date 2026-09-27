// 3 · Lines: tap Enter the moment each line starts. The selected line is the tap target; a tap times it and
// selects the next line. Backspace undoes the last tap, ←/→ nudge, R replays, F2 edits the text, Ctrl+Enter / B
// insert a line / backing line, Del deletes. Latency banner, whole-song waveform and Song info around it.

import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { asBacking, isBacking } from "../../../core/backing";
import type { Flag } from "../../../core/flags";
import { insertLine, removeLine, setLineText, setMetadata, type LrcLine } from "../../../core/lrc-document";
import { useFlags } from "../../audio/audio-data";
import { useOutputDevice } from "../../audio/output-device";
import { player, usePlayerState, usePositionEffect } from "../../audio/player";
import { Button, Field, IconButton, Kbd } from "../../components/controls";
import { Icon } from "../../components/icons";
import { WaveformOverview } from "../../components/WaveformOverview";
import { useHotkeys } from "../../hotkeys/hotkeys";
import { clock, latencyCorrection } from "../../lib/format";
import { readLocal, writeLocal } from "../../lib/storage";
import { lineSpan } from "../../lib/timing";
import {
  commit,
  currentDoc,
  currentSong,
  goToStep,
  openDialog,
  seekToLine,
  select,
  toast,
  undo,
  undoLabel,
  useDoc,
  useSelection,
  useTrack,
} from "../../state";
import { toastOnce, toastQuietly } from "./hints";
import { changedLine, firstUntimedLine, keepInView, lineAt, lineCounts, nudgeLine, pausedStart, tapLine } from "./line-tapping";
import "./lines.css";

interface Editing {
  index: number;
  /** Inserted just now: cancelling (or leaving it empty) takes the insertion back. */
  isNew: boolean;
  initial: string;
  /** Caret position when editing starts (inside the parentheses of a new backing line). */
  caret: number;
}

const NUDGE_COALESCE_MS = 800;
/** Undo label of a tap here; Words uses "tap word", so each screen's Backspace only takes back its own taps. */
const TAP = "tap line";
/** Long enough for any typing session: the text of a new line merges into its "insert line" step. */
const SESSION_MS = 24 * 3600_000;

export function LinesScreen() {
  const doc = useDoc();
  const sel = useSelection().line;
  const playing = usePlayerState((s) => s.playing);
  const playingLine = usePlayingLine();
  const flags = useFlags();
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  // After tapping the last line there is nothing left to tap: no target until the selection moves.
  const [completeAt, setCompleteAt] = useState<number | null>(null);
  const complete = completeAt === sel && doc.lines[sel]?.timestamp != null;

  useEffect(() => {
    if (completeAt !== null && completeAt !== sel) setCompleteAt(null);
  }, [sel, completeAt]);

  // On arrival the target is the first line without a start (with every line timed, the selection stays).
  useEffect(() => {
    const d = currentDoc();
    const i = d ? firstUntimedLine(d) : -1;
    if (i < 0) return;
    select(i);
    if (!player.getState().playing) seekToLine(i);
  }, []);

  const target = editing || complete || doc.lines.length === 0 ? -1 : sel;

  // ---------------------------------------------------------------- actions (read the store: keys can outrun renders)

  const selectLine = (i: number, seek = !player.getState().playing) => {
    select(i);
    if (seek) seekToLine(i);
  };

  const tap = () => {
    const d = currentDoc();
    const song = currentSong();
    if (!d || !song || d.lines.length === 0) return;
    const i = song.selection.line;
    if (!player.getState().playing) {
      player.play(pausedStart(d, i, player.getCurrentPosition()));
      toastOnce("Playing — press Enter the moment each line starts");
      return;
    }
    if (completeAt === i && d.lines[i]?.timestamp != null) {
      toastQuietly("Every line is tapped. Select a line to tap it again.");
      return;
    }
    const r = tapLine(d, i, player.tapPosition());
    commit(r.doc, TAP);
    if (r.next === null) setCompleteAt(i);
    else select(r.next);
  };

  const undoTap = () => {
    if (undoLabel() !== TAP) return false;
    const before = currentDoc()!;
    undo();
    const i = changedLine(before, currentDoc()!);
    setCompleteAt(null);
    if (i >= 0) select(i);
  };

  const step = (dir: 1 | -1) => {
    const d = currentDoc();
    const song = currentSong();
    if (!d || !song || d.lines.length === 0) return;
    const i = Math.min(Math.max(0, song.selection.line + dir), d.lines.length - 1);
    setCompleteAt(null);
    selectLine(i);
  };

  const lastNudge = useRef<number | null>(null);
  const nudge = (deltaMs: number) => {
    const d = currentDoc();
    const song = currentSong();
    if (!d || !song) return;
    const next = nudgeLine(d, song.selection.line, deltaMs);
    if (next) {
      // A held key on one line is one undo step; moving to another line starts a new one.
      const line = song.selection.line;
      commit(next, "nudge", { coalesceMs: lastNudge.current === line ? NUDGE_COALESCE_MS : undefined });
      lastNudge.current = line;
    }
    else if (d.lines[song.selection.line]?.timestamp == null) toastQuietly("This line has no start yet — tap it first");
  };

  const replay = () => {
    const d = currentDoc();
    const song = currentSong();
    if (!d || !song) return;
    const span = lineSpan(d, song.selection.line, player.getDuration());
    if (span) player.playSegment(span.from, span.to);
    else toastQuietly("This line has no start yet — tap it first");
  };

  const startEdit = (index: number) => {
    const line = currentDoc()?.lines[index];
    if (!line) return;
    select(index);
    setEditing({ index, isNew: false, initial: line.text, caret: line.text.length });
  };

  const insert = (backing: boolean) => {
    const d = currentDoc();
    const song = currentSong();
    if (!d || !song) return;
    const at = d.lines.length === 0 ? 0 : song.selection.line + 1;
    const text = backing ? asBacking("") : "";
    let next = insertLine(d, at - 1);
    if (backing) next = setLineText(next, at, text);
    commit(next, "insert line");
    select(at);
    setCompleteAt(null);
    setEditing({ index: at, isNew: true, initial: text, caret: backing ? 1 : 0 });
  };

  const deleteLine = () => {
    const d = currentDoc();
    const song = currentSong();
    if (!d || !song || d.lines.length === 0) return;
    const i = song.selection.line;
    commit(removeLine(d, i), "delete line");
    toast(`Line ${i + 1} deleted`, { action: { label: "Undo", run: () => undoLabel() === "delete line" && undo() } });
  };

  const finishEdit = (text: string | null) => {
    const ed = editingRef.current;
    if (!ed) return;
    editingRef.current = null;
    setEditing(null);
    const d = currentDoc();
    if (!d) return;
    const value = text?.trim() ?? null;
    if (ed.isNew) {
      if (value === null || value === "" || value === asBacking("")) {
        if (undoLabel() === "insert line") {
          undo();
          select(Math.max(0, ed.index - 1));
        }
        return;
      }
      commit(setLineText(d, ed.index, value), "insert line", { coalesceMs: SESSION_MS });
      return;
    }
    if (value !== null && value !== ed.initial.trim()) commit(setLineText(d, ed.index, value), "edit text");
  };

  useHotkeys({
    Enter: { run: tap, repeat: false },
    Backspace: undoTap,
    ArrowUp: () => step(-1),
    ArrowDown: () => step(1),
    ArrowLeft: () => nudge(-10),
    ArrowRight: () => nudge(10),
    "Shift+ArrowLeft": () => nudge(-100),
    "Shift+ArrowRight": () => nudge(100),
    R: { run: replay, repeat: false },
    F2: { run: () => startEdit(currentSong()?.selection.line ?? 0), repeat: false },
    "Ctrl+Enter": { run: () => insert(false), repeat: false },
    B: { run: () => insert(true), repeat: false },
    Del: { run: deleteLine, repeat: false },
  });

  const counts = lineCounts(doc);
  const lineFlags = new Map<number, Flag>();
  for (const f of flags) if (f.wordIndex === undefined && !lineFlags.has(f.lineIndex)) lineFlags.set(f.lineIndex, f);

  return (
    <div className="lines-screen">
      <LatencyBanner />
      <WaveformOverview framed />
      <div className="lines-body">
        <main className="lines-main">
          <div className="lines-head">
            <h1>
              Lines{" "}
              <span className="mono">
                {counts.timed} / {counts.total}
              </span>
            </h1>
            <span className="lines-hint">
              Press <Kbd keys="Enter" /> the moment a line starts · <Kbd keys="Backspace" /> undo tap
            </span>
            <span className="lines-tools">
              <Button variant="tool" size="xs" icon={<Icon.Plus size={16} />} kbd="Ctrl+Enter" onClick={() => insert(false)} title="Insert a line after the selected one">
                Line
              </Button>
              <Button variant="tool" size="xs" kbd="B" onClick={() => insert(true)} title="Insert a backing-vocal line after the selected one">
                Backing vocal
              </Button>
              <Button
                variant="tool"
                size="xs"
                icon={<Icon.Trash size={16} />}
                kbd="Del"
                aria-label="Delete line"
                title="Delete the selected line"
                style={{ paddingInline: 10 }}
                disabled={doc.lines.length === 0}
                onClick={deleteLine}
              />
            </span>
          </div>
          <LineList
            lines={doc.lines}
            sel={sel}
            target={target}
            playingLine={playingLine}
            playing={playing}
            flags={lineFlags}
            editing={editing}
            onSelect={(i) => {
              setCompleteAt(null);
              selectLine(i);
            }}
            onEdit={startEdit}
            onFinishEdit={finishEdit}
          />
        </main>
        <aside className="lines-aside">
          <SongInfo />
          <section>
            <h2 className="eyebrow">Keys</h2>
            <div className="lines-keys">
              <span><Kbd keys="Enter" /></span><span>line starts now</span>
              <span><Kbd keys="Space" /></span><span>play / pause</span>
              <span><Kbd keys="ArrowUp" /><Kbd keys="ArrowDown" /></span><span>select a line</span>
              <span><Kbd keys="R" /></span><span>replay selected line</span>
              <span><Kbd keys="ArrowLeft" /><Kbd keys="ArrowRight" /></span><span>nudge start by 10 ms</span>
              <span><Kbd keys="F2" /></span><span>edit line text</span>
              <span><Kbd keys="Ctrl+Z" /></span><span>undo</span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- line list

function LineList(props: {
  lines: LrcLine[];
  sel: number;
  target: number;
  playingLine: number;
  playing: boolean;
  flags: Map<number, Flag>;
  editing: Editing | null;
  onSelect: (i: number) => void;
  onEdit: (i: number) => void;
  onFinishEdit: (text: string | null) => void;
}) {
  const { lines, sel, target, playingLine, playing, flags, editing } = props;
  const list = useRef<HTMLOListElement>(null);
  const handlers = useRef(props);
  handlers.current = props;
  const [stable] = useState(() => ({
    select: (i: number) => handlers.current.onSelect(i),
    edit: (i: number) => handlers.current.onEdit(i),
    finish: (text: string | null) => handlers.current.onFinishEdit(text),
  }));

  // Keep the tap target and the playing line in view; if they're too far apart, the playing line wins while
  // playing (you're listening), the target otherwise. Pausing alone doesn't scroll.
  const focus = target >= 0 ? target : sel;
  const scrollFor = useRef({ focus, pending: true });
  if (scrollFor.current.focus !== focus) scrollFor.current = { focus, pending: true };
  useLayoutEffect(() => {
    const el = list.current;
    if (!el || (playingLine < 0 && !scrollFor.current.pending)) return;
    scrollFor.current.pending = false;
    const box = (i: number) => {
      const row = i >= 0 ? el.querySelector<HTMLElement>(`[data-index="${i}"]`) : null;
      return row ? { top: row.offsetTop, bottom: row.offsetTop + row.offsetHeight } : null;
    };
    const targetBox = box(focus);
    const playingBox = box(playingLine);
    const rows = (playingLine >= 0 ? [playingBox, targetBox] : [targetBox, playingBox]).filter((b) => b !== null);
    const top = keepInView(el.scrollTop, el.clientHeight, rows, 8);
    if (top !== el.scrollTop) el.scrollTop = top;
  }, [focus, playingLine, lines.length]);

  if (lines.length === 0) {
    return (
      <div className="lines-empty-list">
        No lines yet.{" "}
        <button type="button" className="lines-link" onClick={() => goToStep("lyrics")}>
          Add lyrics
        </button>{" "}
        or insert a line with <Kbd keys="Ctrl+Enter" />.
      </div>
    );
  }

  return (
    <ol className="lines-list" ref={list} aria-label="Lines">
      {lines.map((line, i) => (
        <LineRow
          key={i}
          index={i}
          line={line}
          isTarget={i === target}
          isSelected={i === sel && target !== sel}
          isPlaying={i === playingLine}
          waiting={i === target && playing}
          flag={flags.get(i) ?? null}
          editing={editing?.index === i ? editing : null}
          actions={stable}
        />
      ))}
    </ol>
  );
}

interface RowActions {
  select: (i: number) => void;
  edit: (i: number) => void;
  finish: (text: string | null) => void;
}

const LineRow = memo(function LineRow({
  index,
  line,
  isTarget,
  isSelected,
  isPlaying,
  waiting,
  flag,
  editing,
  actions,
}: {
  index: number;
  line: LrcLine;
  isTarget: boolean;
  isSelected: boolean;
  isPlaying: boolean;
  waiting: boolean;
  flag: Flag | null;
  editing: Editing | null;
  actions: RowActions;
}) {
  const timed = line.timestamp !== null;
  const backing = isBacking(line);
  const classes = [
    "lines-row",
    isTarget && "is-target",
    !isTarget && isPlaying && "is-playing",
    !isTarget && !isPlaying && isSelected && "is-selected",
    !timed && "is-untimed",
    backing && "is-backing",
    flag && "is-flagged",
  ]
    .filter(Boolean)
    .join(" ");

  const playLine = () => {
    const d = currentDoc();
    const span = d && lineSpan(d, index, player.getDuration());
    if (span) player.playSegment(span.from, span.to);
  };

  return (
    <li
      className={classes}
      data-index={index}
      aria-current={isTarget || isSelected ? "true" : undefined}
      onClick={() => actions.select(index)}
      onDoubleClick={() => actions.edit(index)}
    >
      <span className="n">{index + 1}</span>
      {isTarget && !timed ? <kbd className="lines-enter-cap">Enter</kbd> : <span className="time">{clock(line.timestamp)}</span>}
      <span className="text">
        {editing ? (
          <LineTextInput editing={editing} onFinish={actions.finish} />
        ) : line.text.trim() === "" ? (
          <span className="empty">empty line</span>
        ) : (
          line.text
        )}
      </span>
      <span className="side">
        {flag && (
          <span className="flag" title={flag.message}>
            <Icon.Warning size={14} />
          </span>
        )}
        {backing && <span className="lines-backing-tag">backing vocal</span>}
        {waiting ? (
          <span className="lines-waiting">up next — waiting for your tap</span>
        ) : isPlaying && !isTarget ? (
          <span className="lines-playing">
            <Icon.Play size={12} />
            playing
          </span>
        ) : timed && !isTarget ? (
          <IconButton
            label="Play this line"
            onClick={(e) => {
              e.stopPropagation();
              playLine();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Icon.Play size={14} />
          </IconButton>
        ) : null}
      </span>
    </li>
  );
});

function LineTextInput({ editing, onFinish }: { editing: Editing; onFinish: (text: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(editing.caret, editing.caret);
  }, [editing]);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onFinish(e.currentTarget.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onFinish(null);
    }
  };
  return (
    <input
      ref={ref}
      className="text-input"
      aria-label="Line text"
      defaultValue={editing.initial}
      onKeyDown={onKeyDown}
      onBlur={(e) => onFinish(e.currentTarget.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

/** The line heard right now (-1 when paused or between lines); re-renders only when it changes. */
function usePlayingLine(): number {
  const doc = useDoc();
  const playing = usePlayerState((s) => s.playing);
  const [line, setLine] = useState(-1);
  const docRef = useRef(doc);
  docRef.current = doc;
  const compute = (heard: number) => (player.getState().playing ? lineAt(docRef.current, heard, player.getDuration()) : -1);
  usePositionEffect((_, heard) => {
    const i = compute(heard);
    setLine((prev) => (prev === i ? prev : i));
  });
  useEffect(() => setLine(compute(player.heardPosition())), [doc, playing]);
  return line;
}

// ---------------------------------------------------------------- latency banner

function LatencyBanner() {
  const device = useOutputDevice();
  const kind = device.latencyMs !== 0 ? "calibrated" : device.bluetooth ? "bluetooth" : "hint";
  const storageKey = `lrcgen.lines.banner:${kind}:${device.key}:${device.latencyMs}`;
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (dismissed === storageKey || readLocal(storageKey) === "dismissed") return null;
  const dismiss = () => {
    writeLocal(storageKey, "dismissed");
    setDismissed(storageKey);
  };
  const calibrate = () => openDialog("calibrate");

  if (kind === "hint") {
    return (
      <div role="status" className="lines-banner slim">
        <Icon.Headphones size={16} />
        <span>Every output device plays a little late. Calibrate once so your taps land on time.</span>
        <button type="button" className="lines-link" onClick={calibrate}>
          Calibrate
        </button>
        <span style={{ flexGrow: 1 }} />
        <IconButton label="Dismiss hint" onClick={dismiss}>
          <Icon.Close size={14} />
        </IconButton>
      </div>
    );
  }

  const bluetooth = device.bluetooth ? "You're listening on Bluetooth headphones, which lag by 0.1–0.3 s. " : "";
  return (
    <div role="status" className="lines-banner">
      <Icon.Headphones size={18} />
      {kind === "calibrated" ? (
        <span>
          {bluetooth}Your taps are shifted by <strong>{latencyCorrection(device.latencyMs)}</strong> from your last calibration.
        </span>
      ) : (
        <span>{bluetooth}Calibrate so your taps land on time.</span>
      )}
      <button type="button" className="lines-link" onClick={calibrate}>
        {kind === "calibrated" ? "Recalibrate" : "Calibrate"}
      </button>
      <span style={{ flexGrow: 1 }} />
      <IconButton label="Dismiss" onClick={dismiss}>
        <Icon.Close size={16} />
      </IconButton>
    </div>
  );
}

// ---------------------------------------------------------------- song info

type MetaKey = "artist" | "title" | "album";

function SongInfo() {
  const track = useTrack();
  const duration = usePlayerState((s) => s.durationMs);
  return (
    <section>
      <h2 className="eyebrow">Song info</h2>
      <MetaField field="artist" label="Artist" />
      <MetaField field="title" label="Title" />
      <MetaField field="album" label="Album" />
      <div className="lines-length">
        <span>Length, from the file</span>
        <span className="mono">{clock(duration || track?.durationMs || null)}</span>
      </div>
    </section>
  );
}

/** Edits one metadata field; everything typed while it has focus is one undo step. */
function MetaField({ field, label }: { field: MetaKey; label: string }) {
  const value = useDoc().metadata[field] ?? "";
  const edits = useRef(0);
  return (
    <Field
      label={label}
      value={value}
      spellCheck={false}
      onFocus={() => {
        edits.current = 0;
      }}
      onChange={(e) => {
        const d = currentDoc();
        if (!d) return;
        commit(setMetadata(d, { [field]: e.target.value }), `edit ${field}`, edits.current++ > 0 ? { coalesceMs: SESSION_MS } : {});
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
