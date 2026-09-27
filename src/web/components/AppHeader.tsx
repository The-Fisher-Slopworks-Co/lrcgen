// The 56 px header. `variant="open"`: logo, "Open a song", settings. `variant="song"`: logo (back to the file
// browser), song title/artist, step navigation with ✓ for finished steps, a slot for screen extras
// (<HeaderExtras>), running-job chips, autosave status, Save (opens the Save dialog) and settings.

import { STEPS, type JobState, type Step } from "../../shared/api";
import { useFlags } from "../audio/audio-data";
import { focusStepBody } from "../lib/focus";
import { percent } from "../lib/format";
import { formatRoute } from "../routing/route";
import { goToStep } from "../routing/router";
import { openDialog } from "../state/actions";
import { useStore } from "../state/app-state";
import { useDraftProgress, useSaveStatus, useSongJobs, useStep } from "../state/hooks";
import { leaveSong } from "../state/session";
import { Button, Chip, IconButton } from "./controls";
import { Icon, LogoMark, ProgressRing } from "./icons";
import { SlotTarget } from "./slots";

export const STEP_LABELS: Record<Step, string> = {
  lyrics: "Lyrics",
  lines: "Lines",
  words: "Words",
  refine: "Refine",
  preview: "Preview",
};

export function AppHeader({ variant }: { variant: "open" | "song" }) {
  return (
    <header className="app-header">
      {variant === "open" ? (
        <>
          <a className="app-logo" href="#/open">
            <LogoMark />
            <span>lrcgen</span>
          </a>
          <div className="header-divider" />
          <span className="header-title">Open a song</span>
          <div style={{ flexGrow: 1 }} />
        </>
      ) : (
        <SongHeaderContent />
      )}
      <IconButton label="Settings" onClick={() => openDialog("settings")}>
        <Icon.Gear size={20} />
      </IconButton>
    </header>
  );
}

function SongHeaderContent() {
  const title = useStore((s) => {
    const song = s.song;
    if (!song) return null;
    const meta = song.draft.doc.metadata;
    return meta.title || song.track?.title || fileName(song.draft.audioPath);
  });
  const sub = useStore((s) => {
    const song = s.song;
    if (!song) return "";
    const meta = song.draft.doc.metadata;
    return [meta.artist || song.track?.artist, meta.album || song.track?.album].filter(Boolean).join(" · ");
  });
  const loading = useStore((s) => !s.song);

  return (
    <>
      <button type="button" className="app-logo" onClick={leaveSong} title="Back to your songs">
        <LogoMark />
        <span>lrcgen</span>
      </button>
      <div className="header-divider" />
      <div className="header-song">
        <span className="title ellipsis">{title ?? "Opening…"}</span>
        <span className="sub ellipsis">{sub}</span>
      </div>
      {loading ? <div style={{ flexGrow: 1 }} /> : <StepNav />}
      <SlotTarget name="header" className="header-extras" />
      {!loading && <JobChips />}
      {!loading && <SaveStatus />}
      {!loading && (
        <Button variant="secondary" size="sm" onClick={() => openDialog("save")} title="Save & publish (Ctrl S)">
          Save
        </Button>
      )}
    </>
  );
}

function StepNav() {
  const current = useStep()?.step;
  const draftId = useStore((s) => s.song?.draft.id ?? "");
  const flags = useFlags();
  const stepsDone = useDraftProgress(flags.length)?.stepsDone ?? 0;
  return (
    <nav aria-label="Steps" className="step-nav">
      {STEPS.map((step, i) => {
        const done = i < stepsDone && step !== current;
        return (
          <a
            key={step}
            href={formatRoute({ name: "song", draftId, step, params: {} })}
            aria-current={step === current ? "step" : undefined}
            onClick={(e) => {
              e.preventDefault();
              goToStep(step);
              // Before the new screen mounts, so a screen that focuses something itself still wins.
              focusStepBody();
            }}
          >
            <span className={done ? "step-dot done" : "step-dot"}>{done ? "✓" : i + 1}</span>
            {STEP_LABELS[step]}
          </a>
        );
      })}
    </nav>
  );
}

function SaveStatus() {
  const { status, error } = useSaveStatus();
  const text = status === "saved" ? "Draft saved" : status === "saving" ? "Saving…" : "Not saved — retrying";
  return (
    <span className={status === "error" ? "save-status error" : "save-status"} title={error ?? undefined} role="status">
      {text}
    </span>
  );
}

/** Minimised progress of running jobs; a transcription chip leads back to its progress screen. */
function JobChips() {
  const jobs = useSongJobs().filter((j) => j.status === "running");
  if (jobs.length === 0) return null;
  return (
    <>
      {jobs.map((job) => (
        <JobChip key={job.id} job={job} />
      ))}
    </>
  );
}

export function jobLabel(job: JobState): string {
  if (job.kind === "separate") return "Separating vocals";
  if (job.firstRun && job.stage === "init") return "Downloading models";
  return "Transcribing";
}

function JobChip({ job }: { job: JobState }) {
  const text = job.progress === null ? jobLabel(job) : `${jobLabel(job)} · ${percent(job.progress)}`;
  const open =
    job.kind === "transcribe"
      ? () => {
          goToStep("lyrics", { transcribe: "1" });
          focusStepBody();
        }
      : undefined;
  return (
    <Chip tone={job.kind === "separate" ? "vocals" : "accent"} size="lg" onClick={open} title={job.message}>
      <ProgressRing progress={job.progress} size={14} stroke={2} />
      {text}
    </Chip>
  );
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
}
