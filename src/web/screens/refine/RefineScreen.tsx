// 5 · Refine (Refine board): the whole song on a zoomable timeline, a row per line and rows for the labelled groups
// (backing vocals, ad-libs) sung over them. Every word is a block from where it starts to where it stops sounding.
// Nudge or drag starts and ends, retap a group's starts, fit ends to the voice, pick words into a new group and
// label it, act on "Worth a look" flags. With no word selected, edits move the group (its words follow).
// Keys: ←/→ start ±10 ms (Shift ±100), Alt+←/→ end, Tab/Shift+Tab words, ↑/↓ groups, W play exactly the word or
// group, S 0.5×, M join, / split, G new group, Shift+G back into the line, H retap, F fit ends, Esc deselect.

import { useCallback, useEffect, useRef, useState } from "react";
import { fitWordEnds } from "../../../core/fit-ends";
import { mergeIntoLine, moveToNewGroup, splitParentheses } from "../../../core/groups";
import { groupStart, groupText, isLabelled, setLabels, setWordEnd, shiftWords, type Group } from "../../../core/lyrics";
import { joinWithNext, splitWord } from "../../../core/word-edit";
import { ENVELOPE_FRAME_MS, useAudioData, useFlags } from "../../audio/audio-data";
import { player, usePlayerState } from "../../audio/player";
import { Chip, Kbd } from "../../components/controls";
import { Icon } from "../../components/icons";
import { HeaderExtras } from "../../components/slots";
import { useHotkeys } from "../../hotkeys/hotkeys";
import { clock, plural } from "../../lib/format";
import { readLocal, writeLocal } from "../../lib/storage";
import { lineSpan } from "../../lib/timing";
import { commit, currentDoc, currentSong, select, stepLine, toast, useDoc, useDraft, useSelection, useTrack } from "../../state";
import { groupBlocks } from "./blocks";
import { GroupsPane, matchesFilter, type LabelFilter } from "./GroupsPane";
import { Inspector } from "./Inspector";
import type { LaneToggles } from "./lanes";
import { moveEnd, moveTarget, nudgeEnd, nudgeTarget, targetEnd, targetStart } from "./nudge";
import { beginRetap, preRollFor, retapDone, stepBack, tapAt, type Retap } from "./retap";
import { RetapPanel } from "./RetapPanel";
import { Timeline } from "./Timeline";
import { clampView, DEFAULT_SPAN, ensureVisible, nextPreset, spanLabel, viewForLine, zoomAround, type View } from "./timeline-view";
import "./refine.css";

const LANES_KEY = "lrcgen.refine.lanes";
const SPAN_KEY = "lrcgen.refine.span";
const NUDGE_COALESCE_MS = 1200;
/** After the last word is tapped, playback runs on this long, so it's heard before the retap ends. */
const RETAP_TAIL_MS = 1000;

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

/** Where a group is: its start, else the nearest timed group above it. */
function whereIs(index: number): number {
  const d = currentDoc();
  if (!d) return 0;
  for (let i = index; i >= 0; i--) {
    const g = d.groups[i];
    const t = g ? groupStart(g) : null;
    if (t !== null) return t;
  }
  return 0;
}

export function RefineScreen() {
  const doc = useDoc();
  const draft = useDraft();
  const { line: groupIndex, word } = useSelection();
  const track = useTrack();
  const playerDuration = usePlayerState((s) => s.durationMs);
  const rate = usePlayerState((s) => s.rate);
  const durationMs = playerDuration || track?.durationMs || 0;
  const allFlags = useFlags();
  const { envelope } = useAudioData();
  const hasStem = track?.hasVocals ?? false;
  const group: Group | undefined = doc.groups[groupIndex];

  const [lanes, setLanes] = useState(readLanes);
  const toggleLane = (key: keyof LaneToggles) => {
    const next = { ...lanes, [key]: !lanes[key] };
    setLanes(next);
    writeLocal(LANES_KEY, JSON.stringify(next));
  };

  const [view, setViewState] = useState<View>(() => viewForLine(whereIs(groupIndex), readSpan()));
  const setView = useCallback((update: (v: View) => View) => setViewState((v) => update(v)), []);
  useEffect(() => writeLocal(SPAN_KEY, String(Math.round(view.spanMs))), [view.spanMs]);

  /** Words picked besides the selected one (Shift+click), by id. */
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<LabelFilter>(null);
  const [labelFocus, setLabelFocus] = useState(0);
  const [retap, setRetapState] = useState<Retap | null>(null);
  const retapRef = useRef(retap);
  const setRetap = (r: Retap | null) => {
    retapRef.current = r;
    setRetapState(r);
  };

  // A new selection from elsewhere (↑/↓, Tab, a flag) drops the picked words, and brings the target into view.
  const selectedId = word !== null ? group?.words[word]?.id : undefined;
  const lastSelection = useRef(`${groupIndex}:${selectedId}`);
  /** Set while Shift+click picks a word, so the selection change it makes keeps the picked ones. */
  const pickingRef = useRef(false);
  useEffect(() => {
    const key = `${groupIndex}:${selectedId}`;
    if (key === lastSelection.current) return;
    lastSelection.current = key;
    if (!pickingRef.current) setPicked(new Set());
    pickingRef.current = false;
  }, [groupIndex, selectedId]);

  const target = targetStart(doc, { line: groupIndex, word });
  useEffect(() => {
    const t = target ?? whereIs(groupIndex);
    setViewState((v) => clampView(ensureVisible(v, t), durationMs));
  }, [groupIndex, word, target, durationMs]);

  // ---------------------------------------------------------------- selection

  const pickWord = (g: number, w: number, additive: boolean) => {
    const d = currentDoc();
    const song = currentSong();
    const id = d?.groups[g]?.words[w]?.id;
    if (!d || !song || !id) return;
    if (additive) {
      const next = new Set(picked);
      const prev = song.selection.word !== null ? d.groups[song.selection.line]?.words[song.selection.word]?.id : undefined;
      if (prev && prev !== id) next.add(prev);
      if (next.has(id)) next.delete(id);
      pickingRef.current = true;
      setPicked(next);
    } else setPicked(new Set());
    select(g, w);
  };

  const pickGroup = (g: number) => {
    setPicked(new Set());
    select(g, null);
    const d = currentDoc();
    const t = d?.groups[g] ? groupStart(d.groups[g]!) : null;
    if (t !== null && !player.getState().playing) player.seek(t);
  };

  /** Ids of the picked words and the selected one. */
  const pickedIds = (): string[] => {
    const d = currentDoc();
    const song = currentSong();
    if (!d || !song) return [];
    const ids = new Set(picked);
    const sel = song.selection.word !== null ? d.groups[song.selection.line]?.words[song.selection.word]?.id : undefined;
    if (sel) ids.add(sel);
    return [...ids];
  };

  // ---------------------------------------------------------------- actions

  const lastNudge = useRef<string>("");
  const commitNudge = (next: ReturnType<typeof currentDoc>, key: string) => {
    if (!next) return;
    commit(next, "nudge", { coalesceMs: lastNudge.current === key ? NUDGE_COALESCE_MS : undefined });
    lastNudge.current = key;
  };

  const nudge = (delta: number) => {
    const d = currentDoc();
    if (!d) return;
    if (picked.size > 0) {
      const ids = new Set(pickedIds());
      const next = shiftWords(d, ids, delta);
      if (next !== d) commitNudge(next, `picked:${[...ids].join(",")}`);
      return;
    }
    const t = { line: groupIndex, word };
    const next = nudgeTarget(d, t, delta, durationMs);
    if (next === d) {
      if (targetStart(d, t) === null) toast(word === null ? "This group has no start yet — tap it on the Lines step" : "This word has no start yet — drag it onto the timeline or type a time");
      return;
    }
    commitNudge(next, `${groupIndex}:${word}`);
  };

  const nudgeEndBy = (delta: number) => {
    const d = currentDoc();
    if (!d) return;
    if (word === null) {
      toast("Pick a word to move where it ends — Tab picks the first one");
      return;
    }
    const next = nudgeEnd(d, { line: groupIndex, word }, delta, durationMs);
    if (next !== d) commitNudge(next, `end:${groupIndex}:${word}`);
  };

  const setStart = (ms: number) => {
    const d = currentDoc();
    if (d) commit(moveTarget(d, { line: groupIndex, word }, ms, durationMs), "edit time");
  };

  const setEnd = (ms: number | null) => {
    const d = currentDoc();
    if (!d || word === null) return;
    commit(ms === null ? setWordEnd(d, groupIndex, word, null) : moveEnd(d, { line: groupIndex, word }, ms, durationMs), ms === null ? "clear end" : "edit time");
  };

  /** W: exactly the word, from its start to its end; or the group. */
  const play = () => {
    const d = currentDoc();
    if (!d) return;
    if (word !== null) {
      const start = targetStart(d, { line: groupIndex, word });
      const end = targetEnd(d, { line: groupIndex, word }, durationMs);
      if (start === null || !end) toast("This word has no start yet");
      else player.playSegment(start, end.end);
      return;
    }
    const span = lineSpan(d, groupIndex, durationMs);
    if (span) player.playSegment(span.from, span.to);
    else toast("This group has no start yet");
  };

  const toggleSlow = () => player.setSpeed(player.getState().rate === 0.5 ? 1 : 0.5);

  const join = () => {
    const d = currentDoc();
    if (!d || word === null) return;
    const next = joinWithNext(d, groupIndex, word);
    if (next !== d) commit(next, "join");
  };

  const split = () => {
    const d = currentDoc();
    if (!d || word === null) return;
    const next = splitWord(d, groupIndex, word);
    if (next !== d) commit(next, "split");
  };

  const newGroup = () => {
    const d = currentDoc();
    const ids = pickedIds();
    if (!d) return;
    if (ids.length === 0) {
      toast("Pick words first: click one, Shift+click more");
      return;
    }
    const { doc: next, index } = moveToNewGroup(d, ids);
    if (index < 0) return;
    commit(next, "new group");
    setPicked(new Set());
    select(index, null);
    setLabelFocus((n) => n + 1);
    toast(`New group of ${plural(ids.length, "word")} — give it a label, or leave it a line of its own`);
  };

  const mergeBack = () => {
    const d = currentDoc();
    if (!d || !group || !isLabelled(group)) return;
    const { doc: next, index } = mergeIntoLine(d, groupIndex);
    if (index < 0) {
      toast("There's no line before it to go into");
      return;
    }
    commit(next, "into the line");
    select(index, null);
  };

  const setGroupLabels = (labels: string[]) => {
    const d = currentDoc();
    if (d) commit(setLabels(d, groupIndex, labels), "labels");
  };

  const fit = () => {
    const d = currentDoc();
    if (!d) return;
    if (!envelope) {
      toast(hasStem ? "Still reading the vocals…" : "Fitting ends needs the separated vocals");
      return;
    }
    const ids = pickedIds();
    const { doc: next, changed } =
      ids.length > 0 ? fitWordEnds(d, envelope, ENVELOPE_FRAME_MS, { wordIds: ids }) : fitWordEnds(d, envelope, ENVELOPE_FRAME_MS, { groups: [groupIndex] });
    if (changed === 0) toast("The ends already sit where the voice stops");
    else commit(next, "fit ends");
  };

  const splitParens = () => {
    const d = currentDoc();
    if (!d) return;
    const { doc: next, backing, adlib } = splitParentheses(d);
    if (next === d || backing + adlib === 0) return;
    commit(next, "split parentheses");
    const parts = [backing > 0 && `${backing} “backing” (they echo the line)`, adlib > 0 && `${adlib} “adlib”`].filter(Boolean).join(", ");
    toast(`Split out ${plural(backing + adlib, "part")}: ${parts}. Rename the labels any time.`, { durationMs: 8000 });
  };

  const walk = (dir: 1 | -1) => {
    const d = currentDoc();
    if (!d) return;
    // Every word in reading order, across groups.
    const all = d.groups.flatMap((g, gi) => g.words.map((_, wi) => ({ gi, wi })));
    if (all.length === 0) return;
    const at = all.findIndex((p) => p.gi === groupIndex && p.wi === word);
    const from = at >= 0 ? at : all.findIndex((p) => p.gi >= groupIndex) - (dir > 0 ? 1 : 0);
    const next = all[Math.min(all.length - 1, Math.max(0, from + dir))]!;
    setPicked(new Set());
    select(next.gi, next.wi);
    const t = d.groups[next.gi]!.words[next.wi]!.start;
    if (t !== null && !player.getState().playing) player.seek(t);
  };

  const zoom = (dir: 1 | -1) => {
    setViewState((v) => {
      const anchor = target !== null && target >= v.startMs && target <= v.startMs + v.spanMs ? target : v.startMs + v.spanMs / 2;
      return clampView(zoomAround(v, nextPreset(v.spanMs, dir), anchor), durationMs);
    });
  };

  const deselect = () => {
    if (picked.size > 0) setPicked(new Set());
    else if (word !== null) select(groupIndex, null);
    else return false;
  };

  // ---------------------------------------------------------------- retap

  const startRetap = () => {
    const d = currentDoc();
    if (!d) return;
    const r = beginRetap(d, groupIndex, word, player.getState().rate);
    if (!r) return;
    setPicked(new Set());
    if (r.rate === 1) player.setSpeed(0.75);
    setRetap(r);
    player.play(preRollFor(r, whereIs(groupIndex)));
  };

  const endRetap = (keep: boolean) => {
    const r = retapRef.current;
    if (!r) return;
    setRetap(null);
    player.pause();
    player.setSpeed(r.rate);
    if (keep && r.done > 0) {
      commit(r.doc, "retap");
      toast(`Retapped ${plural(r.done, "word")} · Ctrl Z takes it back`);
    }
  };

  const retapTap = () => {
    const r = retapRef.current;
    if (!r || retapDone(r)) return;
    if (!player.getState().playing) {
      player.play(preRollFor(r, whereIs(r.group)));
      return;
    }
    const next = tapAt(r, player.tapPosition());
    setRetap(next);
    if (retapDone(next)) {
      setTimeout(() => {
        const cur = retapRef.current;
        if (cur && retapDone(cur)) endRetap(true);
      }, RETAP_TAIL_MS);
    }
  };

  const retapBack = () => {
    const r = retapRef.current;
    if (!r) return;
    const back = stepBack(r);
    setRetap(back);
    player.play(preRollFor(back, whereIs(back.group)));
  };

  // Leaving Refine mid-retap keeps what was done.
  useEffect(() => () => endRetap(true), []);

  useHotkeys(
    {
      Enter: { run: retapTap, repeat: false, inInputs: true },
      Backspace: retapBack,
      Escape: () => endRetap(true),
    },
    { enabled: retap !== null, priority: 10 },
  );

  useHotkeys(
    {
      ArrowLeft: () => nudge(-10),
      ArrowRight: () => nudge(10),
      "Shift+ArrowLeft": () => nudge(-100),
      "Shift+ArrowRight": () => nudge(100),
      "Alt+ArrowLeft": () => nudgeEndBy(-10),
      "Alt+ArrowRight": () => nudgeEndBy(10),
      "Alt+Shift+ArrowLeft": () => nudgeEndBy(-100),
      "Alt+Shift+ArrowRight": () => nudgeEndBy(100),
      Tab: () => walk(1),
      "Shift+Tab": () => walk(-1),
      W: { run: play, repeat: false },
      S: { run: toggleSlow, repeat: false },
      M: { run: join, repeat: false },
      "/": { run: split, repeat: false },
      G: { run: newGroup, repeat: false },
      "Shift+G": { run: mergeBack, repeat: false },
      H: { run: startRetap, repeat: false },
      F: { run: fit, repeat: false },
      "Ctrl+ArrowUp": () => stepLine(-1),
      "Ctrl+ArrowDown": () => stepLine(1),
      ArrowUp: () => stepLine(-1),
      ArrowDown: () => stepLine(1),
      PageUp: () => stepLine(-1),
      PageDown: () => stepLine(1),
      Escape: deselect,
    },
    { enabled: retap === null },
  );

  // ---------------------------------------------------------------- layout

  const shown = retap?.doc ?? doc;
  const live = retap && retap.tapped !== null && !retapDone(retap) ? { group: retap.group, start: retap.tapped } : null;
  const flags = allFlags.filter((f) => f.lineIndex === groupIndex);
  const groupStartMs = group ? groupStart(group) : null;
  const untimed = group ? groupBlocks(doc, groupIndex, durationMs).untimed.length : 0;

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
      <GroupsPane
        doc={doc}
        draftId={draft.id}
        group={groupIndex}
        filter={filter}
        setFilter={setFilter}
        flags={allFlags}
        onPick={pickGroup}
        onSplitParens={splitParens}
      />
      <main className="refine-main">
        <div className="refine-title">
          <span className="refine-line-no">
            Group {groupIndex + 1} · {groupStartMs !== null ? clock(groupStartMs) : "no start yet"}
            {untimed > 0 && ` · ${plural(untimed, "word")} untimed`}
          </span>
          <h1 className="refine-line-text" title={group ? groupText(group) : undefined}>
            {group ? groupText(group) || "Empty line" : "No lyrics yet"}
          </h1>
          <div role="group" aria-label="Lanes" className="refine-lane-toggles">
            <button type="button" className="refine-lane-toggle vocals" aria-pressed={lanes.vocals} onClick={() => toggleLane("vocals")} title="Vocals waveform">
              Vocals
            </button>
            <button type="button" className="refine-lane-toggle vocals" aria-pressed={lanes.spect} onClick={() => toggleLane("spect")} title="Spectrogram">
              Spect
            </button>
            <button type="button" className="refine-lane-toggle" aria-pressed={lanes.mix} onClick={() => toggleLane("mix")} title="Full mix waveform">
              Mix
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

        <Timeline
          doc={shown}
          group={groupIndex}
          word={word}
          picked={picked}
          dimmed={(g) => !matchesFilter(g, filter)}
          view={view}
          setView={setView}
          lanes={lanes}
          flags={retap ? [] : allFlags}
          durationMs={durationMs}
          hasStem={hasStem}
          locked={retap !== null}
          live={live}
          onPickWord={pickWord}
          onPickGroup={pickGroup}
        />

        {retap ? (
          <RetapPanel retap={retap} doc={doc} rate={rate} onStop={() => endRetap(true)} onCancel={() => endRetap(false)} />
        ) : (
          <div className="refine-hints">
            <span>
              <Kbd keys="ArrowLeft" /> <Kbd keys="ArrowRight" /> start
            </span>
            <span>
              <Kbd keys="Alt" /> + <Kbd keys="ArrowLeft" /> <Kbd keys="ArrowRight" /> end
            </span>
            <span>
              <Kbd keys="W" /> play exactly
            </span>
            <span>
              <Kbd keys="Shift" /> + click more words
            </span>
            <span>
              <Kbd keys="G" /> new group
            </span>
            <span>
              <Kbd keys="H" /> retap
            </span>
            <span>
              <Kbd keys="F" /> fit ends
            </span>
          </div>
        )}
      </main>

      <Inspector
        doc={shown}
        group={groupIndex}
        word={word}
        picked={picked.size}
        flags={flags}
        durationMs={durationMs}
        canFit={!!envelope}
        labelFocus={labelFocus}
        onNudge={nudge}
        onNudgeEnd={nudgeEndBy}
        onSetStart={setStart}
        onSetEnd={setEnd}
        onPlay={play}
        onSlow={toggleSlow}
        onJoin={join}
        onSplit={split}
        onNewGroup={newGroup}
        onMerge={mergeBack}
        onRetap={startRetap}
        onFit={fit}
        onLabels={setGroupLabels}
        onClearPicked={() => setPicked(new Set())}
      />
    </div>
  );
}
