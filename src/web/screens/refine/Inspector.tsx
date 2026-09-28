// The Refine side panel: the selected word — when it starts and ends, with nudge buttons — or the selected group's
// start; Listen and Edit actions; the group's labels; its flags with their suggested fix; and what the group looks
// like in the lyrics file and in LRC.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Flag } from "../../../core/flags";
import { hostOf } from "../../../core/groups";
import { groupStart, groupText, isLabelled, setGroupStart, setWordStart, wordParts, type LyricsDoc } from "../../../core/lyrics";
import { usePlayerState } from "../../audio/player";
import { Kbd, LabelChip } from "../../components/controls";
import { Icon } from "../../components/icons";
import { clock, seconds } from "../../lib/format";
import { readLocal, writeLocal } from "../../lib/storage";
import { commit, currentDoc, dismissFlag, restoreFlag, select, toast, toggleLoopLine, toggleVocals, useStore } from "../../state";
import { exportedLine, groupJson } from "./export-preview";
import { parseTime, targetEnd, targetStart } from "./nudge";

export interface InspectorProps {
  doc: LyricsDoc;
  group: number;
  word: number | null;
  /** Words picked besides the selected one. */
  picked: number;
  /** Flags in this group. */
  flags: Flag[];
  durationMs: number;
  /** Word ends can be fitted to the voice (there's a vocal stem). */
  canFit: boolean;
  /** Changes when the label field should take focus (a new group was just made). */
  labelFocus: number;
  onNudge: (deltaMs: number) => void;
  onNudgeEnd: (deltaMs: number) => void;
  onSetStart: (ms: number) => void;
  onSetEnd: (ms: number | null) => void;
  onPlay: () => void;
  onSlow: () => void;
  onJoin: () => void;
  onSplit: () => void;
  onNewGroup: () => void;
  onMerge: () => void;
  onRetap: () => void;
  onFit: () => void;
  onLabels: (labels: string[]) => void;
  onClearPicked: () => void;
}

const SUGGESTED = ["backing", "adlib"];
const TAB_KEY = "lrcgen.refine.export";
type ExportTab = "json" | "elrc" | "lrc";

export function Inspector(props: InspectorProps) {
  const { doc, group: groupIndex, word, picked, flags, durationMs, canFit, labelFocus } = props;
  const group = doc.groups[groupIndex];
  const words = group?.words ?? [];
  const current = word !== null ? words[word] : undefined;
  const target = { line: groupIndex, word };
  const start = targetStart(doc, target);
  const end = targetEnd(doc, target, durationMs);
  const rate = usePlayerState((s) => s.rate);
  const track = usePlayerState((s) => s.track);
  const loopLine = useStore((s) => s.song?.loopLine ?? false);
  const canJoin = word !== null && word < words.length - 1;
  const canSplit = !!current && wordParts(current).length > 1;
  const labelled = !!group && isLabelled(group);

  const next = current && word !== null ? words.slice(word + 1).find((w) => w.start !== null) : undefined;
  const gap = current?.end != null && next?.start != null ? next.start - current.end : null;

  // Another word or group: back to the top, where its times are.
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    // scrollTo returns a promise in newer browsers; an effect must not return it.
    panel.current?.scrollTo({ top: 0 });
  }, [groupIndex, word]);

  if (!group) {
    return (
      <aside className="refine-inspector">
        <p className="refine-no-flags">No lyrics yet.</p>
      </aside>
    );
  }

  return (
    <aside ref={panel} className="refine-inspector">
      <section className="refine-subject">
        <span className="eyebrow">
          {current ? `Word ${word! + 1} of ${words.length} · group ${groupIndex + 1}` : `Group ${groupIndex + 1} · ${labelled ? group.labels.join(", ") : "line"}`}
        </span>
        <span className={current ? "refine-subject-text" : "refine-subject-text line"}>{current ? current.text : groupText(group) || "Empty line"}</span>
      </section>

      {picked > 0 && (
        <section className="refine-picked">
          <p>
            <strong>{picked + (current ? 1 : 0)} words picked.</strong> Arrows move them together; a new group takes them out of their groups.
          </p>
          <div className="refine-tools">
            <button type="button" className="refine-tool accent" onClick={props.onNewGroup}>
              New group <Kbd keys="G" />
            </button>
            <button type="button" className="refine-tool" onClick={props.onClearPicked}>
              Clear <Kbd keys="Esc" />
            </button>
          </div>
        </section>
      )}

      {current ? (
        <section className="refine-times">
          <TimeField label="Starts" keys="← →" value={start} onCommit={props.onSetStart} onNudge={props.onNudge} />
          <TimeField
            label="Ends"
            keys="Alt ← →"
            value={end?.end ?? null}
            derived={end?.derived ?? false}
            disabled={start === null}
            onCommit={(ms) => props.onSetEnd(ms)}
            onNudge={props.onNudgeEnd}
            onClear={current.end !== null ? () => props.onSetEnd(null) : undefined}
          />
          <p className="refine-time-meta">
            {start === null
              ? "No start yet: drag it onto the timeline or tap it on the Words step."
              : end?.derived
                ? "No end: it lasts until the next word, which is usually right. Where the voice stops before that, drag the block's right edge or fit it to the voice."
                : `Sounds ${seconds((end?.end ?? 0) - start)} s${gap === null ? "" : gap > 0 ? ` · then ${gap} ms of pause` : gap < 0 ? ` · overlaps the next word by ${-gap} ms` : " · runs into the next word"}`}
          </p>
          <span className="refine-keyhint">
            <span>
              <Kbd>Shift</Kbd> ×10 ·
            </span>
            <span>
              <Kbd keys="Tab" /> next word
            </span>
          </span>
        </section>
      ) : (
        <section className="refine-times">
          <TimeField label="Group starts" keys="← →" value={start} onCommit={props.onSetStart} onNudge={props.onNudge} />
          <p className="refine-time-meta">{start === null ? "No start yet — tap it on the Lines step." : "Moving it moves all its words."}</p>
        </section>
      )}

      <section className="refine-group">
        <h2 className="eyebrow">Listen</h2>
        <div className="refine-tools">
          <button type="button" className="refine-tool" onClick={props.onPlay} disabled={start === null}>
            {current ? "This word" : "This group"} <Kbd keys="W" />
          </button>
          <button type="button" className="refine-tool tone-accent" aria-pressed={loopLine} onClick={toggleLoopLine}>
            Loop group <Kbd keys="L" />
          </button>
          <button type="button" className="refine-tool tone-accent" aria-pressed={rate === 0.5} onClick={props.onSlow}>
            0.5× <Kbd keys="S" />
          </button>
          <button type="button" className="refine-tool tone-vocals" aria-pressed={track === "vocals"} onClick={toggleVocals}>
            Vocals <Kbd keys="V" />
          </button>
        </div>
      </section>

      <section className="refine-group">
        <h2 className="eyebrow">Edit</h2>
        <div className="refine-tools">
          <button type="button" className="refine-tool" onClick={props.onRetap} title="Play the group and tap Enter as each word starts">
            Retap <Kbd keys="H" />
          </button>
          <button
            type="button"
            className="refine-tool"
            disabled={!canFit || start === null}
            onClick={props.onFit}
            title={canFit ? "End the words where the voice stops before the next word; words that run into it get no end" : "Needs the separated vocals"}
          >
            {current ? "Fit end" : "Fit ends"} <Kbd keys="F" />
          </button>
          <button type="button" className="refine-tool" disabled={!current} onClick={props.onNewGroup} title="Take the word (and the ones picked with Shift+click) into a group of its own">
            New group <Kbd keys="G" />
          </button>
          {labelled ? (
            <button type="button" className="refine-tool" onClick={props.onMerge} title="Put the words back into the line they're sung with">
              Into the line <Kbd keys="Shift+G" />
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="refine-tool" disabled={!canJoin} onClick={props.onJoin} title="Join with the next word: one timing for both">
            Join next <Kbd keys="M" />
          </button>
          <button type="button" className="refine-tool" disabled={!canSplit} onClick={props.onSplit} title="Split a joined word after its first part">
            Split <Kbd keys="/" />
          </button>
        </div>
      </section>

      <Labels doc={doc} groupIndex={groupIndex} labels={group.labels} focus={labelFocus} onChange={props.onLabels} />

      <FlagCard lineIndex={groupIndex} flags={flags} />

      <ExportPreview doc={doc} groupIndex={groupIndex} />
    </aside>
  );
}

// ---------------------------------------------------------------- times

function TimeField({
  label,
  keys,
  value,
  derived,
  disabled,
  onCommit,
  onNudge,
  onClear,
}: {
  label: string;
  keys: string;
  value: number | null;
  /** The value is a guess (a word without an end): shown dimmed. */
  derived?: boolean;
  disabled?: boolean;
  onCommit: (ms: number) => void;
  onNudge: (deltaMs: number) => void;
  onClear?: () => void;
}) {
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
  const off = disabled || value === null;
  return (
    <div className="refine-time">
      <div className="refine-time-head">
        <span className="refine-field-label">{label}</span>
        {derived && <span className="refine-time-tag">not set</span>}
        {onClear && (
          <button type="button" className="refine-time-clear" onClick={onClear} title="Forget the end: the word lasts until the next one again">
            clear
          </button>
        )}
        <span className="refine-time-keys">{keys}</span>
      </div>
      <input
        className={["refine-time-input", bad && "bad", derived && draft === null && "derived"].filter(Boolean).join(" ")}
        value={draft ?? shown}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        aria-label={label}
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
      <div className="refine-time-nudges">
        {[-100, -10, 10, 100].map((d) => (
          <button
            key={d}
            type="button"
            className={Math.abs(d) === 10 ? "fine" : undefined}
            aria-label={`${label}: ${d < 0 ? "earlier" : "later"} by ${Math.abs(d)} ms`}
            disabled={off}
            onClick={() => onNudge(d)}
          >
            {d < 0 ? `−${-d}` : `+${d}`}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- labels

function Labels({ doc, groupIndex, labels, focus, onChange }: { doc: LyricsDoc; groupIndex: number; labels: string[]; focus: number; onChange: (labels: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    if (focus > 0) input.current?.focus();
  }, [focus]);
  useEffect(() => setText(""), [groupIndex]);

  const inUse = new Set<string>(SUGGESTED);
  for (const g of doc.groups) for (const l of g.labels) inUse.add(l);
  const suggestions = [...inUse].filter((l) => !labels.includes(l));
  const add = (label: string) => {
    const l = label.trim();
    if (l && !labels.includes(l)) onChange([...labels, l]);
    setText("");
  };
  const host = labels.length > 0 ? hostOf(doc, groupIndex) : -1;
  const start = doc.groups[groupIndex] ? groupStart(doc.groups[groupIndex]!) : null;

  return (
    <section className="refine-group">
      <h2 className="eyebrow">Labels</h2>
      <div className="refine-labels">
        {labels.map((l) => (
          <LabelChip key={l} label={l}>
            <button type="button" className="refine-label-remove" aria-label={`Remove the label ${l}`} onClick={() => onChange(labels.filter((x) => x !== l))}>
              ×
            </button>
          </LabelChip>
        ))}
        <input
          ref={input}
          className="refine-label-input"
          value={text}
          placeholder={labels.length ? "Another label…" : "Add a label — any word"}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(text);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setText("");
              e.currentTarget.blur();
            } else if (e.key === "Backspace" && text === "" && labels.length > 0) {
              e.preventDefault();
              onChange(labels.slice(0, -1));
            }
          }}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="refine-label-suggestions">
          {suggestions.map((l) => (
            <button key={l} type="button" onClick={() => add(l)} title={`Label it “${l}”`}>
              <LabelChip label={l} small />
            </button>
          ))}
        </div>
      )}
      <p className="refine-note">
        {labels.length === 0
          ? "No labels: a line of the song. Labelled groups — backing vocals, ad-libs, anything you name — get rows of their own."
          : host >= 0
            ? `On the Labelled rows. In LRC it goes into line ${host + 1}, in parentheses.`
            : start === null
              ? "On the Labelled rows. In LRC it gets a line of its own until it has a start."
              : "On the Labelled rows. In LRC it gets a line of its own, in parentheses: no line is sung right before it."}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- flags

function FlagCard({ lineIndex, flags }: { lineIndex: number; flags: Flag[] }) {
  if (flags.length === 0) {
    return (
      <p className="refine-no-flags">
        <Icon.Check size={15} />
        Nothing worth a look in this group.
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
    } else commit(setGroupStart(d, flag.lineIndex, flag.suggestMs), "move to suggestion");
  };
  return (
    <article className="refine-flags">
      <div className="refine-flags-head">
        <Icon.Warning size={15} />
        IN THIS GROUP
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

// ---------------------------------------------------------------- what gets saved

function ExportPreview({ doc, groupIndex }: { doc: LyricsDoc; groupIndex: number }) {
  const [tab, setTab] = useState<ExportTab>(() => {
    const stored = readLocal(TAB_KEY);
    return stored === "elrc" || stored === "lrc" ? stored : "json";
  });
  const pick = (t: ExportTab) => {
    setTab(t);
    writeLocal(TAB_KEY, t);
  };
  const line = tab === "json" ? null : exportedLine(doc, groupIndex);
  const elsewhere = line !== null && line.line !== groupIndex;
  return (
    <section className="refine-group">
      <h2 className="eyebrow">What gets saved</h2>
      <div className="refine-export-tabs" role="group" aria-label="Format">
        {(
          [
            ["json", "Lyrics file"],
            ["elrc", "Enhanced LRC"],
            ["lrc", "LRC"],
          ] as const
        ).map(([value, text]) => (
          <button key={value} type="button" aria-pressed={tab === value} onClick={() => pick(value)}>
            {text}
          </button>
        ))}
      </div>
      <pre className={tab === "json" ? "refine-export" : "refine-export wrap"}>
        {tab === "json" ? groupJson(doc, groupIndex) : line ? (tab === "elrc" ? line.enhanced : line.plain) : ""}
      </pre>
      <p className="refine-note">
        {tab === "json"
          ? "The lyrics file keeps everything: every word's start and end in ms (null when not set), the groups and their labels."
          : `${elsewhere ? `This group goes into line ${line!.line + 1}. ` : ""}${
              tab === "elrc"
                ? "Enhanced LRC has no word ends: a pause after a word is an extra tag with nothing but a space after it."
                : "Plain LRC keeps only when the line starts."
            }`}
      </p>
    </section>
  );
}
