// The Refine side panel: the selected word (or the line start), its start time with nudge buttons, Listen
// and Word actions, and the flags of this line with their suggested fix.

import { useEffect, useState, type KeyboardEvent } from "react";
import type { Flag } from "../../../core/flags";
import { setTimestamp, setWordStart, wordsOf, type LrcDocument } from "../../../core/lrc-document";
import { wordParts } from "../../../core/word-edit";
import { usePlayerState } from "../../audio/player";
import { Kbd } from "../../components/controls";
import { Icon } from "../../components/icons";
import { clock, seconds } from "../../lib/format";
import { commit, currentDoc, dismissFlag, restoreFlag, select, toast, toggleLoopLine, toggleVocals, useStore } from "../../state";
import { parseTime, targetStart } from "./nudge";

export interface InspectorProps {
  doc: LrcDocument;
  lineIndex: number;
  word: number | null;
  flags: Flag[];
  onNudge: (deltaMs: number) => void;
  onSetStart: (ms: number) => void;
  onPlay: () => void;
  onSlow: () => void;
  onJoin: () => void;
  onSplit: () => void;
}

export function Inspector({ doc, lineIndex, word, flags, onNudge, onSetStart, onPlay, onSlow, onJoin, onSplit }: InspectorProps) {
  const line = doc.lines[lineIndex];
  const words = line ? wordsOf(line) : [];
  const current = word !== null ? words[word] : undefined;
  const start = targetStart(doc, { line: lineIndex, word });
  const rate = usePlayerState((s) => s.rate);
  const track = usePlayerState((s) => s.track);
  const loopLine = useStore((s) => s.song?.loopLine ?? false);
  const canJoin = word !== null && word < words.length - 1;
  const canSplit = !!current && wordParts(current).length > 1;
  const nudgeOff = start === null;

  return (
    <aside className="refine-inspector">
      <section className="refine-subject">
        <span className="eyebrow">{current ? `Word ${word! + 1} of ${words.length}` : `Line ${lineIndex + 1} · start`}</span>
        <span className={current ? "refine-subject-text" : "refine-subject-text line"}>{current ? current.text.trim() : line?.text.trim() || "Empty line"}</span>
      </section>

      <section className="refine-start">
        <label htmlFor="refine-start" className="refine-field-label">
          Start
        </label>
        <StartInput value={start} onCommit={onSetStart} />
        <div className="refine-nudges">
          {[-100, -10, 10, 100].map((d) => (
            <button
              key={d}
              type="button"
              className={Math.abs(d) === 10 ? "refine-nudge fine" : "refine-nudge"}
              aria-label={`${d < 0 ? "Earlier" : "Later"} by ${Math.abs(d)} ms`}
              disabled={nudgeOff}
              onClick={() => onNudge(d)}
            >
              {d < 0 ? `−${-d}` : `+${d}`}
            </button>
          ))}
        </div>
        <span className="refine-keyhint">
          <span>
            <Kbd keys="ArrowLeft" /> <Kbd keys="ArrowRight" /> 10 ms ·
          </span>
          <span>
            <Kbd>Shift</Kbd> 100 ms ·
          </span>
          <span>
            <Kbd keys="Tab" /> next word
          </span>
        </span>
      </section>

      <section className="refine-group">
        <h2 className="eyebrow">Listen</h2>
        <div className="refine-tools">
          <button type="button" className="refine-tool" onClick={onPlay} disabled={start === null}>
            {current ? "This word" : "This line"} <Kbd keys="W" />
          </button>
          <button type="button" className="refine-tool tone-accent" aria-pressed={loopLine} onClick={toggleLoopLine}>
            Loop line <Kbd keys="L" />
          </button>
          <button type="button" className="refine-tool tone-accent" aria-pressed={rate === 0.5} onClick={onSlow}>
            0.5× <Kbd keys="S" />
          </button>
          <button type="button" className="refine-tool tone-vocals" aria-pressed={track === "vocals"} onClick={toggleVocals}>
            Vocals <Kbd keys="V" />
          </button>
        </div>
      </section>

      <section className="refine-group">
        <h2 className="eyebrow">Word</h2>
        <div className="refine-tools">
          <button type="button" className="refine-tool" disabled={!canJoin} onClick={onJoin} title="Join with the next word: one timing for both">
            Join next <Kbd keys="M" />
          </button>
          <button type="button" className="refine-tool" disabled={!canSplit} onClick={onSplit} title="Split a joined word after its first part">
            Split <Kbd keys="/" />
          </button>
        </div>
      </section>

      <FlagCard lineIndex={lineIndex} flags={flags} />
    </aside>
  );
}

function StartInput({ value, onCommit }: { value: number | null; onCommit: (ms: number) => void }) {
  const shown = clock(value);
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setDraft(null);
    setBad(false);
  }, [value]);

  const apply = () => {
    if (draft === null) return;
    const ms = parseTime(draft);
    if (ms === null) {
      setBad(true);
      return;
    }
    setDraft(null);
    setBad(false);
    onCommit(ms);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      apply();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(null);
      setBad(false);
      e.currentTarget.blur();
    }
  };
  return (
    <input
      id="refine-start"
      className={bad ? "refine-start-input bad" : "refine-start-input"}
      value={draft ?? shown}
      spellCheck={false}
      autoComplete="off"
      aria-invalid={bad}
      title="Type a time (00:42.83 or 42.83) and press Enter"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setDraft(e.target.value);
        setBad(false);
      }}
      onBlur={() => {
        setDraft(null);
        setBad(false);
      }}
      onKeyDown={onKeyDown}
    />
  );
}

function FlagCard({ lineIndex, flags }: { lineIndex: number; flags: Flag[] }) {
  if (flags.length === 0) {
    return (
      <p className="refine-no-flags">
        <Icon.Check size={15} />
        Nothing worth a look in this line.
      </p>
    );
  }
  const keep = (flag: Flag) => {
    dismissFlag(flag.id);
    toast(`Line ${flag.lineIndex + 1} kept as it is — it won't be flagged for this again`, {
      action: { label: "Undo", run: () => restoreFlag(flag.id) },
      durationMs: 8000,
    });
  };
  const moveTo = (flag: Flag) => {
    const d = currentDoc();
    if (!d || flag.suggestMs === undefined) return;
    if (flag.wordIndex !== undefined) {
      commit(setWordStart(d, flag.lineIndex, flag.wordIndex, flag.suggestMs), "move to suggestion");
      select(flag.lineIndex, flag.wordIndex);
    } else commit(setTimestamp(d, flag.lineIndex, flag.suggestMs), "move to suggestion");
  };
  return (
    <article className="refine-flags">
      <div className="refine-flags-head">
        <Icon.Warning size={15} />
        IN THIS LINE
      </div>
      {flags.map((flag) => (
        <div key={flag.id} className="refine-flag">
          <p
            className={flag.wordIndex !== undefined ? "clickable" : undefined}
            onClick={flag.wordIndex !== undefined ? () => select(lineIndex, flag.wordIndex!) : undefined}
          >
            {flag.message}
          </p>
          <div className="actions">
            {flag.suggestMs !== undefined && (
              <button type="button" className="refine-flag-move" onClick={() => moveTo(flag)}>
                Move to <span className="mono">{seconds(flag.suggestMs)}</span>
              </button>
            )}
            <button type="button" className="refine-flag-keep" onClick={() => keep(flag)} title="It's intended — stop pointing it out">
              Keep
            </button>
          </div>
        </div>
      ))}
    </article>
  );
}

