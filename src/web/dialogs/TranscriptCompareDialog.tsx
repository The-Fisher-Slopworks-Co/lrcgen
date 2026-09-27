// Shown when a transcription finishes and the song already has lyrics: transcription never overwrites
// anything silently. Keep mine / take only word timings for matching lines (core adoptWordTimings) /
// use the transcription instead.

import { useState } from "react";
import { hasWordTimings, type LrcLine } from "../../core/lrc-document";
import { Button, RadioCard } from "../components/controls";
import { DialogHeader, Modal } from "../components/Modal";
import type { HotkeyMap } from "../hotkeys/hotkeys";
import { plural } from "../lib/format";
import { closeDialog } from "../state/actions";
import { useStore } from "../state/app-state";
import { applyTranscript, type TranscriptChoice } from "../state/jobs";

const CHOICES: TranscriptChoice[] = ["words", "replace", "keep"];

export function TranscriptCompareDialog() {
  const transcript = useStore((s) => s.pendingTranscript);
  const doc = useStore((s) => s.song?.history.present.value ?? null);
  const [choice, setChoice] = useState<TranscriptChoice>("words");

  const close = () => {
    if (transcript) applyTranscript(transcript, "keep");
    closeDialog("transcript");
  };
  const apply = () => {
    if (transcript) applyTranscript(transcript, choice);
    closeDialog("transcript");
  };

  const move = (dir: 1 | -1) => setChoice((c) => CHOICES[(CHOICES.indexOf(c) + dir + CHOICES.length) % CHOICES.length]!);
  const hotkeys: HotkeyMap = { ArrowDown: () => move(1), ArrowUp: () => move(-1), Enter: { run: apply, repeat: false } };

  if (!transcript || !doc) return null;

  return (
    <Modal onClose={close} labelledBy="compare-title" style={{ width: 640 }} hotkeys={hotkeys}>
      <DialogHeader id="compare-title" title="Transcription finished" onClose={close} />
      <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--text-2)" }}>
        This song already has lyrics. Nothing changes unless you choose it here — and anything you apply can be undone with Ctrl Z.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Summary title="Yours" lines={doc.lines} />
        <Summary title="Transcription" lines={transcript.lines} />
      </div>

      <fieldset style={{ margin: 0, padding: 0, border: "none", display: "flex", flexDirection: "column", gap: 8 }}>
        <legend className="eyebrow" style={{ marginBottom: 8 }}>
          What to keep
        </legend>
        <RadioCard
          name="transcript-choice"
          checked={choice === "words"}
          onChange={() => setChoice("words")}
          label="Take only word timings for matching lines"
          description="Your text and line order stay. Lines whose words match the transcription get its word timings."
        />
        <RadioCard
          name="transcript-choice"
          checked={choice === "replace"}
          onChange={() => setChoice("replace")}
          label="Use the transcription"
          description={`Replace your lines and timings with the transcription's ${plural(transcript.lines.length, "line")}.`}
        />
        <RadioCard
          name="transcript-choice"
          checked={choice === "keep"}
          onChange={() => setChoice("keep")}
          label="Keep mine"
          description="Leave everything as it is. The transcription stays available on the Words step."
        />
      </fieldset>

      <div className="dialog-actions">
        <Button variant="ghost" size="dialog" onClick={close}>
          Cancel
        </Button>
        <Button variant="primary" size="dialog" kbd="Enter" onClick={apply}>
          Apply
        </Button>
      </div>
    </Modal>
  );
}

function Summary({ title, lines }: { title: string; lines: LrcLine[] }) {
  const timed = lines.filter((l) => l.timestamp !== null).length;
  const words = lines.filter(hasWordTimings).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", borderRadius: 10, background: "var(--raised-2)", border: "1px solid var(--border-2)" }}>
      <span className="eyebrow">{title}</span>
      <span style={{ fontSize: 14 }}>{plural(lines.length, "line")}</span>
      <span style={{ fontSize: 13, color: "var(--text-3)" }}>
        {timed} timed · {words} with word timings
      </span>
      <span className="ellipsis" style={{ fontSize: 13, color: "var(--text-4)", marginTop: 4 }}>
        {lines[0]?.text ?? "—"}
      </span>
    </div>
  );
}
