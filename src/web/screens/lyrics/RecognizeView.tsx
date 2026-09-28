// 2b · Transcription (Recognize board), route `lyrics?transcribe=1`, or a sync of the user's own lyrics, route
// `lyrics?sync=1`. Shows the song's latest job of that kind: its stages while it runs (a sync skips recognition),
// then the result or the error. It never starts a job on its own (a reload must not re-run a paid transcription):
// the "Transcribe automatically" and "Sync my lyrics" cards, "Start" and "Try again" do.
// Keys: Esc cancels a running job (else back to the sources) · Enter runs the main button.

import { useEffect, useState, type ReactNode } from "react";
import type { JobState } from "../../../shared/api";
import type { TranscribeStage } from "../../../core/transcribe-protocol";
import { Button, Chip } from "../../components/controls";
import { Icon, ProgressRing } from "../../components/icons";
import { useHotkeys } from "../../hotkeys/hotkeys";
import { percent } from "../../lib/format";
import {
  applySync,
  cancelJob,
  goToStep,
  offerTranscript,
  openDialog,
  startJob,
  useDoc,
  useSettings,
  useSongJobs,
  useTranscript,
} from "../../state";
import { lyricLineCount } from "./lyrics-text";
import { elapsed, segmentFill, stageIndex, stageState, STAGE_ORDER, SYNC_STAGE_ORDER, type StageState } from "./stages";

type Phase = "running" | "need-key" | "need-lyrics" | "done" | "error" | "ready";
type Kind = "transcribe" | "align";

export function RecognizeView({ kind }: { kind: Kind }) {
  const settings = useSettings();
  const jobs = useSongJobs(kind);
  const job = jobs[0] ?? null;
  const doc = useDoc();
  const transcript = useTranscript();
  const [starting, setStarting] = useState(false);

  const hasKey = !!settings?.transcription.apiKey;
  const sync = kind === "align";
  const order = sync ? SYNC_STAGE_ORDER : STAGE_ORDER;
  const phase: Phase =
    job?.status === "running"
      ? "running"
      : job?.status === "done"
        ? "done"
        : !sync && !hasKey
          ? "need-key"
          : sync && lyricLineCount(doc.lines) === 0
            ? "need-lyrics"
            : job?.status === "error"
              ? "error"
              : "ready";

  const start = async () => {
    if (starting) return;
    setStarting(true);
    await startJob(kind);
    setStarting(false);
  };
  const cancel = async () => {
    if (job?.status === "running") await cancelJob(job.id);
    goToStep("lyrics");
  };
  const back = () => goToStep("lyrics");
  const toLines = () => goToStep("lines");
  const main: (() => void) | null =
    phase === "running" ? toLines : phase === "done" ? toLines : phase === "ready" || phase === "error" ? () => void start() : phase === "need-key" ? () => openDialog("settings") : null;

  useHotkeys({
    Escape: phase === "running" ? () => void cancel() : back,
    Enter: {
      run: (e) => {
        if (!main || (e.target instanceof Element && e.target.closest("button, a[href]"))) return false;
        main();
      },
      repeat: false,
    },
  });

  const firstRun = job?.status === "running" && job.firstRun;
  const shown = phase === "running" || phase === "done" || phase === "error" ? job : null;

  return (
    <div className="recognize-screen">
      <main className="recognize-main">
        <div className="recognize-intro">
          {firstRun && (
            <Chip tone="accent" size="lg">
              FIRST RUN
            </Chip>
          )}
          <h1>{(sync ? SYNC_HEADINGS : HEADINGS)[phase]}</h1>
          <p>{intro(kind, phase, job)}</p>
        </div>

        {shown && <OverallProgress job={shown} order={order} />}

        {phase === "need-key" && (
          <Need title="Add an API key first">
            Recognizing the words uses a transcription service, and it needs an API key. Add it in{" "}
            <button type="button" className="recognize-link" onClick={() => openDialog("settings")}>
              Settings
            </button>
            ; everything else runs on this computer.
          </Need>
        )}
        {phase === "need-lyrics" && (
          <Need title="Add your lyrics first">
            Syncing lines up the lyrics already in this song with the vocals. Paste them or load a file, then come back.
          </Need>
        )}
        {(phase === "error" || phase === "need-key" || phase === "need-lyrics") && job?.status === "error" && <ErrorDetails job={job} />}

        <ol className="recognize-stages">
          {order.map((stage, i) => (
            <Stage key={stage} index={i} order={order} job={shown} firstRun={!!job?.firstRun && phase === "running"} hasKey={hasKey} />
          ))}
        </ol>

        <div className="recognize-buttons">
          {phase === "running" && (
            <>
              <Button variant="primary" className="recognize-btn" onClick={toLines}>
                Keep working while it runs
              </Button>
              <Button variant="secondary" className="recognize-btn" kbd="Escape" onClick={() => void cancel()}>
                Cancel
              </Button>
            </>
          )}
          {phase === "done" && (
            <>
              <Button variant="primary" className="recognize-btn" kbd="Enter" onClick={toLines}>
                Go to Lines
              </Button>
              {!sync && transcript && doc.lines.length > 0 && (
                <Button variant="secondary" className="recognize-btn" onClick={() => offerTranscript(transcript)}>
                  Compare with your lyrics
                </Button>
              )}
              {sync && job?.lines && (
                <Button variant="secondary" className="recognize-btn" onClick={() => applySync(job.lines!)}>
                  Apply the timings again
                </Button>
              )}
            </>
          )}
          {(phase === "ready" || phase === "error") && (
            <>
              <Button variant="primary" className="recognize-btn" kbd="Enter" disabled={starting} onClick={() => void start()}>
                {phase === "error" ? "Try again" : sync ? "Start syncing" : "Start transcription"}
              </Button>
              <Button variant="secondary" className="recognize-btn" kbd="Escape" onClick={back}>
                Back
              </Button>
            </>
          )}
          {phase === "need-key" && (
            <>
              <Button variant="primary" className="recognize-btn" kbd="Enter" onClick={() => openDialog("settings")}>
                Open Settings
              </Button>
              <Button variant="secondary" className="recognize-btn" kbd="Escape" onClick={back}>
                Back
              </Button>
            </>
          )}
          {phase === "need-lyrics" && (
            <Button variant="secondary" className="recognize-btn" kbd="Escape" onClick={back}>
              Back
            </Button>
          )}
        </div>
      </main>
      <Aside kind={kind} />
    </div>
  );
}

const HEADINGS: Record<Phase, string> = {
  running: "Transcribing the lyrics",
  done: "Transcription finished",
  error: "Transcription stopped",
  ready: "Transcribe the lyrics",
  "need-key": "Transcribe the lyrics",
  "need-lyrics": "Transcribe the lyrics",
};

const SYNC_HEADINGS: Record<Phase, string> = {
  running: "Syncing your lyrics",
  done: "Lyrics synced",
  error: "Sync stopped",
  ready: "Sync your lyrics",
  "need-key": "Sync your lyrics",
  "need-lyrics": "Sync your lyrics",
};

function intro(kind: Kind, phase: Phase, job: JobState | null): string {
  const order = kind === "align" ? SYNC_STAGE_ORDER : STAGE_ORDER;
  if (phase === "running" && job?.firstRun && job.stage === "init") {
    return "First we need to download the tools and the model that separate vocals from music. It's a one-time download — after that, separation runs on this computer with no internet.";
  }
  if (phase === "error") return `It stopped at stage ${stageIndex(job?.stage ?? "init", order) + 1} of ${order.length}. Nothing in your draft changed.`;
  if (kind === "align") {
    if (phase === "done") return "Your lines got start times and word timings. Check them on the Lines and Words steps — the sync can drift where the vocals are hard to hear.";
    return "The vocals are separated from the music, then the lyrics already in this song are lined up with them — no API key needed. It takes from a minute to several; you can keep working meanwhile.";
  }
  if (phase === "done") return "The lyrics came back with line and word timings. Check them on the Lines and Words steps — questionable spots are flagged there.";
  return "The vocals are separated from the music, the words are recognized, then lined up with the song. It takes from a minute to several; you can keep working meanwhile.";
}

function OverallProgress({ job, order }: { job: JobState; order: TranscribeStage[] }) {
  const now = useNow(job.status === "running");
  const fill = segmentFill(job, order);
  const stage = stageIndex(job.stage, order) + 1;
  return (
    <div className="recognize-overall">
      <div className="labels">
        <span>{job.status === "done" ? `All ${order.length} stages done` : `Stage ${stage} of ${order.length}`}</span>
        <span className="mono">
          {job.status === "running" ? `${elapsed(job.startedAt, now)} elapsed` : `took ${elapsed(job.startedAt, job.finishedAt ?? now)}`}
        </span>
      </div>
      <div className="recognize-bar" aria-hidden="true">
        {fill.map((f, i) => {
          const state = stageState(job, i, order);
          const cls = state === "failed" ? "failed" : state === "current" ? (f === null ? "current indeterminate" : "current") : undefined;
          return <div key={i} className={cls}>{state === "failed" ? null : <span style={{ width: f === null ? undefined : `${f * 100}%` }} />}</div>;
        })}
      </div>
    </div>
  );
}

/** The current time, ticking every second while `live`. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return now;
}

interface StageCopy {
  title: string;
  detail: ReactNode;
  chip?: { tone: "neutral" | "vocals"; label: string };
}

function stageCopy(stage: TranscribeStage, firstRun: boolean, hasKey: boolean, sync: boolean): StageCopy {
  switch (stage) {
    case "init":
      return firstRun
        ? { title: "Download the vocal separation model", detail: "Once per computer. If interrupted, it resumes where it stopped." }
        : { title: "Prepare", detail: "Check the tools and load the vocal separation model." };
    case "demucs":
      return {
        title: "Separate vocals from music",
        detail: "On this computer. The vocal track is kept with the project — Refine and any re-run reuse it with no wait.",
        chip: { tone: "neutral", label: "offline" },
      };
    case "api":
      return {
        title: "Recognize the words",
        detail: (
          <>
            The vocal track is sent to the transcription service. API key {hasKey ? "is set" : "goes"} in{" "}
            <button type="button" onClick={() => openDialog("settings")}>
              Settings
            </button>
            .
          </>
        ),
        chip: { tone: "vocals", label: "needs internet" },
      };
    case "align":
      if (sync) {
        return {
          title: "Line up your lyrics with the vocals",
          detail: "On this computer. Every line and word of your lyrics gets a start time; your text stays as it is.",
          chip: { tone: "neutral", label: "offline" },
        };
      }
      return {
        title: "Split into lines and words",
        detail: "On this computer. Spots where recognition wasn't confident get flagged.",
        chip: { tone: "neutral", label: "offline" },
      };
  }
}

function Stage({
  index,
  order,
  job,
  firstRun,
  hasKey,
}: {
  index: number;
  order: TranscribeStage[];
  job: JobState | null;
  firstRun: boolean;
  hasKey: boolean;
}) {
  const state: StageState = stageState(job, index, order);
  const copy = stageCopy(order[index]!, firstRun, hasKey, order === SYNC_STAGE_ORDER);
  const progress = state === "current" ? (job?.progress ?? null) : null;
  return (
    <li className={`recognize-stage ${state}`} aria-current={state === "current" ? "step" : undefined}>
      <span className="mark">
        {state === "done" ? (
          <Icon.Check size={18} />
        ) : state === "current" ? (
          <ProgressRing progress={progress} size={36} />
        ) : state === "failed" ? (
          <Icon.Close size={16} />
        ) : (
          index + 1
        )}
      </span>
      <div className="body">
        <span className="title">{copy.title}</span>
        <span className="detail">{copy.detail}</span>
        {state === "current" && job?.message && <span className="live">{job.message}</span>}
        {progress !== null && (
          <div className="meter">
            <span style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>
      {progress !== null ? (
        <span className="pct">{percent(progress)}</span>
      ) : copy.chip ? (
        <Chip tone={copy.chip.tone} size="lg">
          {copy.chip.label}
        </Chip>
      ) : (
        <span />
      )}
    </li>
  );
}

function ErrorDetails({ job }: { job: JobState }) {
  const text = (job.error ?? job.message).trim();
  const multiline = text.includes("\n");
  return (
    <div className="recognize-error" role="alert">
      {multiline ? (
        <>
          <p>The transcription tools reported:</p>
          <pre>{text}</pre>
        </>
      ) : (
        <p>{text}</p>
      )}
    </div>
  );
}

function Need({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="recognize-need" role="alert">
      <Icon.Info size={22} />
      <div className="body">
        <span className="title">{title}</span>
        <p>{children}</p>
      </div>
    </div>
  );
}

function Aside({ kind }: { kind: Kind }) {
  if (kind === "align") return <SyncAside />;
  return (
    <aside className="recognize-aside">
      <section>
        <h2 className="eyebrow">What you'll get</h2>
        <ul>
          <li>
            <Icon.Check />
            Lyrics split into lines
          </li>
          <li>
            <Icon.Check />
            Start times for every line and word
          </li>
          <li>
            <Icon.Check />
            An isolated vocal track for the waveform and spectrogram
          </li>
        </ul>
      </section>
      <section className="card">
        <h2>You'll still need to check it</h2>
        <p>
          Transcription mixes up similar-sounding words and often misses backing vocals. Nothing gets fixed silently — questionable spots are
          flagged on the Lines and Words steps.
        </p>
      </section>
      <section>
        <h2 className="eyebrow">While you wait</h2>
        <p>
          You can tap out the lines by hand. When transcription finishes, you'll get to compare and keep the better of the two — it never
          overwrites your timings without asking.
        </p>
      </section>
      <div style={{ flexGrow: 1 }} />
      <div className="footnote">
        <Icon.Clock size={16} />
        When minimized, progress stays visible in the header on every step
      </div>
    </aside>
  );
}

function SyncAside() {
  return (
    <aside className="recognize-aside">
      <section>
        <h2 className="eyebrow">What you'll get</h2>
        <ul>
          <li>
            <Icon.Check />
            Start times for every line and word of your lyrics
          </li>
          <li>
            <Icon.Check />
            An isolated vocal track for the waveform and spectrogram
          </li>
        </ul>
      </section>
      <section className="card">
        <h2>You'll still need to check it</h2>
        <p>
          The sync can drift on long instrumental breaks, backing vocals and lines that aren't sung as written. Lines like [Chorus]
          aren't sung, so they stay untimed.
        </p>
      </section>
      <section>
        <h2 className="eyebrow">While you wait</h2>
        <p>
          You can keep editing. When the sync finishes, its timings land on the lines whose text still matches — lines you changed
          meanwhile keep what they had.
        </p>
      </section>
      <div style={{ flexGrow: 1 }} />
      <div className="footnote">
        <Icon.Clock size={16} />
        When minimized, progress stays visible in the header on every step
      </div>
    </aside>
  );
}
