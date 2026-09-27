// 4 · Words: tap Enter as each word starts. The selected word of the selected line is the tap target; a tap
// times it and selects the next word, then the next line. Starting from a pause plays from 2 s before the line.
// M joins a word with the next, / splits a joined word, W plays the word, L loops the line. Arrows move the
// selection only while paused: during tapping a stray arrow would silently move the target.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isBacking } from "../../../core/backing";
import type { Flag } from "../../../core/flags";
import { hasWordTimings, wordsOf, type LrcDocument, type LrcLine, type LrcWord } from "../../../core/lrc-document";
import { adoptWordTimings } from "../../../core/lyrics-merge";
import { joinWithNext, splitWord, wordParts } from "../../../core/word-edit";
import type { Transcript } from "../../../shared/api";
import { useFlags } from "../../audio/audio-data";
import { player, usePlayerState } from "../../audio/player";
import { jobLabel } from "../../components/AppHeader";
import { Button, Chip, Kbd, Segmented } from "../../components/controls";
import { Icon, ProgressRing } from "../../components/icons";
import { useHotkeys } from "../../hotkeys/hotkeys";
import { clock, percent, plural, seconds } from "../../lib/format";
import {
  applyTranscript,
  commit,
  currentDoc,
  currentSong,
  goToStep,
  select,
  toggleLoopLine,
  undo,
  undoLabel,
  useDoc,
  useRunningJob,
  useSelection,
  useStore,
  useTranscript,
} from "../../state";
import { toastOnce, toastQuietly } from "../lines/hints";
import {
  arrivalSpot,
  changedSpot,
  firstUntimedWord,
  lineSpot,
  lineWithWords,
  nextSpot,
  partlyTimed,
  preRollStart,
  prevSpot,
  shortWords,
  tapWord,
  wordCounts,
  wordSpan,
  type Spot,
} from "./word-tapping";
import { FlagsPanel } from "./FlagsPanel";
import "./words.css";

type Mode = "tap" | "transcript";
/** Undo label of a tap here; Lines uses "tap line", so each screen's Backspace only takes back its own taps. */
const TAP = "tap word";

/** The selected word of a line; with no word selected (e.g. after "next line" in the footer), its first untimed word. */
function resolveWord(line: LrcLine | undefined, word: number | null): number {
  const words = line ? wordsOf(line) : [];
  if (words.length === 0) return -1;
  if (word === null) return Math.max(0, firstUntimedWord(line!));
  return Math.min(Math.max(0, word), words.length - 1);
}

/** The selected word, when the selected line has words. */
function currentSpot(): Spot | null {
  const song = currentSong();
  const doc = currentDoc();
  if (!song || !doc) return null;
  const word = resolveWord(doc.lines[song.selection.line], song.selection.word);
  return word < 0 ? null : { line: song.selection.line, word };
}

export function WordsScreen() {
  const doc = useDoc();
  const selection = useSelection();
  const playing = usePlayerState((s) => s.playing);
  const flags = useFlags();
  const [mode, setMode] = useState<Mode>("tap");
  // After the song's last word there is nothing left to tap: no target until the selection moves.
  const [completeAt, setCompleteAt] = useState<Spot | null>(null);

  // On arrival: the word picked last time (if one was), else the first word still without a start.
  useEffect(() => {
    const d = currentDoc();
    const song = currentSong();
    if (!d || !song) return;
    const spot = arrivalSpot(d, song.selection);
    if (spot) select(spot.line, spot.word);
  }, []);

  const lineIndex = selection.line;
  const line: LrcLine | undefined = doc.lines[lineIndex];
  const words = line ? wordsOf(line) : [];
  const wordIndex = resolveWord(line, selection.word);
  const complete =
    completeAt !== null && completeAt.line === lineIndex && completeAt.word === wordIndex && words[wordIndex]?.start != null;

  useEffect(() => {
    if (completeAt && (completeAt.line !== lineIndex || completeAt.word !== wordIndex)) setCompleteAt(null);
  }, [lineIndex, wordIndex, completeAt]);

  // ---------------------------------------------------------------- actions (read the store: keys can outrun renders)

  const tap = () => {
    const d = currentDoc();
    const spot = currentSpot();
    if (!d || !spot) return;
    if (!player.getState().playing) {
      player.play(preRollStart(d, spot.line));
      toastOnce("Playing from 2 s before the line — press Enter as each word starts");
      return;
    }
    if (completeAt && completeAt.line === spot.line && completeAt.word === spot.word && wordsOf(d.lines[spot.line]!)[spot.word]?.start != null) {
      toastQuietly("That was the last word. Select a word to tap it again.");
      return;
    }
    const r = tapWord(d, spot, player.tapPosition());
    commit(r.doc, TAP);
    if (r.next) select(r.next.line, r.next.word);
    else {
      select(spot.line, spot.word);
      setCompleteAt(spot);
    }
  };

  const undoTap = () => {
    if (undoLabel() !== TAP) return false;
    const before = currentDoc()!;
    undo();
    const spot = changedSpot(before, currentDoc()!);
    setCompleteAt(null);
    if (spot) select(spot.line, spot.word);
  };

  /** Arrows: only while paused (or while a single word/segment plays), never during tapping. */
  const move = (to: (d: LrcDocument, spot: Spot) => Spot | null) => {
    const st = player.getState();
    if (st.playing && st.segmentEnd === null) {
      toastOnce("Arrows are off while playing, so a stray press can't move the word you're tapping. Pause with Space first.");
      return;
    }
    const d = currentDoc();
    const spot = currentSpot();
    if (!d) return;
    if (!spot) {
      const first = arrivalSpot(d, { line: 0, word: null });
      if (first) select(first.line, first.word);
      return;
    }
    const next = to(d, spot);
    if (next) {
      setCompleteAt(null);
      select(next.line, next.word);
    }
  };

  const join = () => {
    const d = currentDoc();
    const spot = currentSpot();
    if (!d || !spot) return;
    const next = joinWithNext(d, spot.line, spot.word);
    if (next === d) toastQuietly("That's the last word of the line — there's nothing after it to join");
    else commit(next, "join");
  };

  const split = () => {
    const d = currentDoc();
    const spot = currentSpot();
    if (!d || !spot) return;
    const next = splitWord(d, spot.line, spot.word);
    if (next === d) toastQuietly("Only joined words can be split");
    else commit(next, "split");
  };

  const playWord = () => {
    const d = currentDoc();
    const spot = currentSpot();
    if (!d || !spot) return;
    const span = wordSpan(d, spot, player.getDuration());
    if (span) player.playSegment(span.from, span.to);
    else toastQuietly("This word has no start yet — tap it first");
  };

  useHotkeys(
    {
      Enter: { run: tap, repeat: false },
      Backspace: undoTap,
      M: { run: join, repeat: false },
      "/": { run: split, repeat: false },
      W: { run: playWord, repeat: false },
      ArrowLeft: () => move(prevSpot),
      ArrowRight: () => move(nextSpot),
      ArrowUp: () => move((d, s) => lineSpot(d, s.line, -1)),
      ArrowDown: () => move((d, s) => lineSpot(d, s.line, 1)),
    },
    { enabled: mode === "tap" },
  );

  const counts = wordCounts(doc);
  const wordFlags = useMemo(() => {
    const map = new Map<string, Flag>();
    for (const f of flags) if (f.wordIndex !== undefined) map.set(`${f.lineIndex}:${f.wordIndex}`, f);
    return map;
  }, [flags]);
  const prevLine = lineWithWords(doc, lineIndex - 1, -1);
  const nextLine = lineWithWords(doc, lineIndex + 1, 1);

  return (
    <div className="words-screen">
      <main className="words-main">
        <div className="words-top">
          <Segmented
            label="Method"
            size="md"
            options={[
              { value: "tap", label: "Tap them" },
              { value: "transcript", label: "Use transcription" },
            ]}
            value={mode}
            onChange={setMode}
          />
          <TranscriptStatus mode={mode} onUse={() => setMode("transcript")} />
          <span className="words-progress">
            Words done in <span className="mono">{counts.done}</span> of <span className="mono">{counts.total}</span> lines
          </span>
        </div>

        {mode === "transcript" ? (
          <TranscriptPanel
            onDone={() => {
              setMode("tap");
              const d = currentDoc();
              const spot = d && arrivalSpot(d, { line: 0, word: null });
              if (spot) select(spot.line, spot.word);
            }}
          />
        ) : (
          <section className={line && isBacking(line) ? "words-card is-backing" : "words-card"} aria-label="Current line">
            <ContextLine doc={doc} index={prevLine} />
            <div className="words-line">
              <span className="n">{line ? lineIndex + 1 : ""}</span>
              {words.length > 0 ? (
                <div className="words-boxes">
                  {words.map((w, i) => (
                    <WordBox
                      key={i}
                      word={w}
                      line={lineIndex}
                      index={i}
                      isNext={i === wordIndex && !complete}
                      flagged={wordFlags.has(`${lineIndex}:${i}`)}
                    />
                  ))}
                </div>
              ) : (
                <span className="words-empty-line">{doc.lines.length === 0 ? "No lyrics yet." : "This line has no words."}</span>
              )}
            </div>
            <ContextLine doc={doc} index={nextLine} />
            <div className="words-tools">
              <button type="button" className="words-key-action" onClick={tap} title={playing ? "Tap the selected word" : "Start playback 2 s before the line"}>
                <Kbd keys="Enter" /> word starts
              </button>
              <button type="button" className="words-key-action" onClick={() => undoTap()}>
                <Kbd keys="Backspace" /> undo tap
              </button>
              <span className="words-tool-buttons">
                <Button variant="tool" size="sm" icon={<Icon.Link size={16} />} kbd="M" onClick={join}>
                  Join with next
                </Button>
                <Button variant="tool" size="sm" icon={<Icon.Scissors size={16} />} kbd="/" onClick={split}>
                  Split
                </Button>
                <Button variant="tool" size="sm" icon={<Icon.Play size={14} />} kbd="W" onClick={playWord}>
                  Word
                </Button>
                <LoopButton />
              </span>
            </div>
          </section>
        )}

        <Earlier doc={doc} before={lineIndex} flags={wordFlags} />
      </main>
      <FlagsPanel shortWords={mode === "tap" ? shortWords(line) : []} />
    </div>
  );
}

function ContextLine({ doc, index }: { doc: LrcDocument; index: number }) {
  const line = index >= 0 ? doc.lines[index] : undefined;
  return (
    <div className={line && isBacking(line) ? "words-context is-backing" : "words-context"} onClick={line ? () => selectLineStart(index) : undefined}>
      <span className="n">{line ? index + 1 : ""}</span>
      <span className="text">{line?.text ?? ""}</span>
    </div>
  );
}

/** Clicking a neighbouring line (while paused) makes it current, at its first untimed word. */
function selectLineStart(index: number): void {
  if (player.getState().playing) return;
  const line = currentDoc()?.lines[index];
  if (!line) return;
  select(index, Math.max(0, firstUntimedWord(line)));
}

const WordBox = memo(function WordBox({ word, line, index, isNext, flagged }: { word: LrcWord; line: number; index: number; isNext: boolean; flagged: boolean }) {
  const parts = wordParts(word);
  const timed = word.start !== null;
  const classes = ["words-box", isNext ? "is-next" : timed ? "is-done" : "is-todo", flagged && "is-flagged"].filter(Boolean).join(" ");
  return (
    <button type="button" className={classes} aria-current={isNext ? "true" : undefined} onClick={() => select(line, index)}>
      <span className="word">
        {parts.map((p, i) => (
          <span key={i} style={{ display: "contents" }}>
            {i > 0 && <span className="sep" aria-hidden="true" />}
            {p}
          </span>
        ))}
      </span>
      <span className="meta">
        {isNext && !timed ? <kbd className="words-enter-cap">Enter</kbd> : <span className="time">{timed ? clock(word.start) : "––.––"}</span>}
        {parts.length > 1 && <span className="joined">joined</span>}
      </span>
    </button>
  );
});

function LoopButton() {
  const on = useStore((s) => s.song?.loopLine ?? false);
  return (
    <Button variant="tool" size="sm" icon={<Icon.Loop size={16} />} kbd="L" aria-pressed={on} onClick={toggleLoopLine}>
      Loop line
    </Button>
  );
}

// ---------------------------------------------------------------- earlier in the song

function Earlier({ doc, before, flags }: { doc: LrcDocument; before: number; flags: Map<string, Flag> }) {
  const list = useRef<HTMLDivElement>(null);
  const rows = doc.lines.map((line, i) => ({ line, i })).filter(({ line, i }) => i < before && hasWordTimings(line));
  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [before, rows.length]);
  return (
    <section className="words-earlier" aria-label="Finished lines">
      <h2 className="eyebrow">Earlier in the song</h2>
      <div className="words-earlier-list" ref={list}>
        {rows.length === 0 && <div className="words-earlier-empty">Lines you finish show up here.</div>}
        {rows.map(({ line, i }) => (
          <div key={i} className="words-earlier-row">
            <span className="n">{i + 1}</span>
            <span className="t">{clock(line.timestamp)}</span>
            <div className="words-chips">
              {wordsOf(line).map((w, j) => {
                const flagged = flags.has(`${i}:${j}`);
                const parts = wordParts(w);
                return (
                  <button
                    key={j}
                    type="button"
                    className={["words-chip", flagged && "is-flagged", w.start === null && "is-untimed"].filter(Boolean).join(" ")}
                    onClick={() => select(i, j)}
                    title={flags.get(`${i}:${j}`)?.message}
                  >
                    <span className="w">
                      {parts.map((p, k) => (
                        <span key={k} style={{ display: "contents" }}>
                          {k > 0 && <span className="dot">·</span>}
                          {p}
                        </span>
                      ))}
                      {flagged && <Icon.Warning size={13} />}
                    </span>
                    <span className="ct">{w.start === null ? "––.––" : seconds(w.start)}</span>
                  </button>
                );
              })}
              {partlyTimed(line) && (
                <span className="words-incomplete" title="Some words of this line have no start yet">
                  not all words timed
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- transcription

function TranscriptStatus({ mode, onUse }: { mode: Mode; onUse: () => void }) {
  const transcript = useTranscript();
  const job = useRunningJob("transcribe");
  if (job) {
    return (
      <Chip tone="accent" size="lg" onClick={() => goToStep("lyrics", { transcribe: "1" })} title={job.message}>
        <ProgressRing progress={job.progress} size={14} stroke={2} />
        {job.progress === null ? jobLabel(job) : `${jobLabel(job)} · ${percent(job.progress)}`}
      </Chip>
    );
  }
  if (transcript === undefined || mode === "transcript") return null;
  if (transcript === null) {
    return (
      <span className="status">
        No transcription for this song yet.
        <button type="button" className="words-link" onClick={() => goToStep("lyrics", { transcribe: "1" })}>
          Run it
        </button>
      </span>
    );
  }
  return (
    <span className="status">
      A transcription is ready.
      <button type="button" className="words-link" onClick={onUse}>
        Use it
      </button>
    </span>
  );
}

/** How the transcription's word timings would land: matching lines, and how many of them already have timings. */
function adoption(doc: LrcDocument, transcript: Transcript): { adopted: number; replaced: number } {
  const { doc: next, adopted } = adoptWordTimings(doc, transcript.lines);
  const replaced = doc.lines.filter((line, i) => next.lines[i] !== line && hasWordTimings(line)).length;
  return { adopted, replaced };
}

function TranscriptPanel({ onDone }: { onDone: () => void }) {
  const doc = useDoc();
  const transcript = useTranscript();
  const job = useRunningJob("transcribe");
  const result = useMemo(() => (transcript ? adoption(doc, transcript) : null), [doc, transcript]);
  const total = wordCounts(doc).total;

  if (!transcript || !result) {
    return (
      <section className="words-card words-transcript">
        <h2>No transcription for this song yet</h2>
        <p>
          A transcription listens to the song and times every word it hears. Lines whose words match yours can take those timings instead of being
          tapped.
        </p>
        <div className="actions">
          {job ? (
            <Chip tone="accent" size="lg" onClick={() => goToStep("lyrics", { transcribe: "1" })} title={job.message}>
              <ProgressRing progress={job.progress} size={14} stroke={2} />
              {job.progress === null ? jobLabel(job) : `${jobLabel(job)} · ${percent(job.progress)}`}
            </Chip>
          ) : (
            transcript === null && (
              <Button variant="primary" size="sm" onClick={() => goToStep("lyrics", { transcribe: "1" })}>
                Run it
              </Button>
            )
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="words-card words-transcript">
      <h2>Take word timings from the transcription</h2>
      {result.adopted > 0 ? (
        <p>
          <span className="mono">{result.adopted}</span> of <span className="mono">{total}</span> lines match the transcription word for word. They get
          its word timings; your text stays exactly as it is, and the other lines keep what they have.
          {result.replaced > 0 && ` ${plural(result.replaced, "of them already has", "of them already have")} word timings, which will be replaced.`}
        </p>
      ) : (
        <p>None of your lines match the transcription word for word, so there are no timings to take. Tap the words instead.</p>
      )}
      <div className="actions">
        <Button
          variant="primary"
          size="sm"
          disabled={result.adopted === 0}
          onClick={() => {
            applyTranscript(transcript, "words");
            onDone();
          }}
        >
          Use word timings for {plural(result.adopted, "line")}
        </Button>
        <span style={{ fontSize: 13, color: "var(--text-4)" }}>
          <Kbd keys="Ctrl+Z" /> takes it back
        </span>
      </div>
    </section>
  );
}
