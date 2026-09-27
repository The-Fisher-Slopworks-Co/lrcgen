// The 72 px transport footer: previous/next line, play/pause, position / length, and — per step — speed,
// "Vocals only V", "Loop line L". When a control is hidden but active (Refine), a chip shows its state
// instead ("looping 41.46 → 45.02", "vocals only"). `hint` is the grey note after the controls; screens can
// add more through <TransportExtras>. The output device and its latency correction sit on the right and
// open Calibrate.

import type { ReactNode } from "react";
import { player, useHeardPosition, usePlayerState } from "../audio/player";
import { useOutputDevice } from "../audio/output-device";
import { clock, latencyCorrection, percent, seconds } from "../lib/format";
import { openDialog } from "../state/actions";
import { useRunningJob, useTrack } from "../state/hooks";
import { useStore } from "../state/app-state";
import { stepLine, toggleLoopLine, togglePlay, toggleVocals } from "../state/transport";
import { Button, Chip, Segmented } from "./controls";
import { Icon } from "./icons";
import { SlotTarget } from "./slots";

export const SPEEDS = [0.5, 0.75, 1] as const;

export interface TransportBarProps {
  speed?: boolean;
  vocals?: boolean;
  loop?: boolean;
  hint?: ReactNode;
}

export function TransportBar({ speed = true, vocals = true, loop = true, hint }: TransportBarProps) {
  const playing = usePlayerState((s) => s.playing);
  const ready = usePlayerState((s) => s.ready);
  const rate = usePlayerState((s) => s.rate);
  const track = usePlayerState((s) => s.track);
  const loopRange = usePlayerState((s) => s.loop);

  return (
    <footer className="transport">
      <div className="transport-buttons">
        <button type="button" className="transport-skip" aria-label="Previous line" title="Previous line" onClick={() => stepLine(-1)}>
          <Icon.Prev />
        </button>
        <button type="button" className="transport-play" aria-label={playing ? "Pause" : "Play"} title="Play / pause (Space)" disabled={!ready} onClick={togglePlay}>
          {playing ? <Icon.Pause /> : <Icon.Play />}
        </button>
        <button type="button" className="transport-skip" aria-label="Next line" title="Next line" onClick={() => stepLine(1)}>
          <Icon.Next />
        </button>
      </div>
      <TimeReadout />
      <div className="transport-divider" />
      {speed && (
        <Segmented
          label="Speed"
          mono
          options={SPEEDS.map((v) => ({ value: v, label: `${v}×` }))}
          value={rate}
          onChange={(v) => player.setSpeed(v)}
        />
      )}
      {vocals && <VocalsButton />}
      {loop && <LoopButton />}
      {!loop && loopRange && (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Chip tone="accent">looping</Chip>
          <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
            {seconds(loopRange.from)} → {seconds(loopRange.to)}
          </span>
        </span>
      )}
      {!vocals && track === "vocals" && <Chip tone="vocals">vocals only</Chip>}
      {hint && (
        <span className="transport-hint" title={typeof hint === "string" ? hint : undefined}>
          {hint}
        </span>
      )}
      <SlotTarget name="transport" className="transport-extras" />
      <OutputDeviceBadge />
    </footer>
  );
}

function TimeReadout() {
  const position = useHeardPosition();
  const duration = usePlayerState((s) => s.durationMs);
  return (
    <div className="transport-time">
      <span className="now">{clock(position)}</span>
      <span className="total">/ {clock(duration || null)}</span>
    </div>
  );
}

function VocalsButton() {
  const track = usePlayerState((s) => s.track);
  const hasVocals = usePlayerState((s) => s.hasVocals);
  const separatingJob = useRunningJob("separate");
  const transcribingJob = useRunningJob("transcribe");
  const syncingJob = useRunningJob("align");
  const separating = separatingJob ?? transcribingJob ?? syncingJob;
  const uv = useStore((s) => s.app?.capabilities.uv ?? false);
  const trackInfo = useTrack();

  if (!hasVocals && separating) {
    return (
      <Button variant="toggle" size="sm" icon={<Icon.Spinner size={16} />} disabled title={separating.message}>
        Separating vocals{separating.progress !== null && separating.kind === "separate" ? ` · ${percent(separating.progress)}` : "…"}
      </Button>
    );
  }
  const title = hasVocals
    ? "Hear only the separated vocals (V)"
    : uv
      ? "No vocal track yet — press to separate the vocals from the music"
      : "Separating vocals needs uv installed";
  return (
    <Button
      variant="toggle"
      size="sm"
      tone="vocals"
      icon={<Icon.Mic size={16} />}
      kbd="V"
      aria-pressed={track === "vocals"}
      title={title}
      disabled={!trackInfo}
      onClick={toggleVocals}
    >
      Vocals only
    </Button>
  );
}

function LoopButton() {
  const on = useStore((s) => s.song?.loopLine ?? false);
  return (
    <Button variant="toggle" size="sm" tone="accent" icon={<Icon.Loop size={16} />} kbd="L" aria-pressed={on} title="Loop the selected line (L)" onClick={toggleLoopLine}>
      Loop line
    </Button>
  );
}

export function OutputDeviceBadge() {
  const device = useOutputDevice();
  return (
    <button type="button" className="output-device" onClick={() => openDialog("calibrate")} title="Calibrate audio latency">
      <Icon.Headphones />
      <span className="label">{device.label}</span>
      <Chip tone="accent" mono>
        {latencyCorrection(device.latencyMs)}
      </Chip>
    </button>
  );
}
