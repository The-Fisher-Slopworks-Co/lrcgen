// "Worth a look N": one card per flag (Open in Refine / Listen / It's intended), a calm note when there are
// none, and the "Short words" tip for the current line.

import { flagTime as timeOf, type Flag, type FlagKind } from "../../../core/flags";
import { useFlags } from "../../audio/audio-data";
import { player } from "../../audio/player";
import { Button, Chip } from "../../components/controls";
import { Icon } from "../../components/icons";
import { currentDoc, dismissFlag, goToStep, restoreFlag, select, toast } from "../../state";
import { messageParts } from "./word-tapping";

const KIND_LABELS: Record<FlagKind, string> = {
  "lines-out-of-order": "Lines out of order",
  "words-out-of-order": "Words out of order",
  "starts-in-silence": "Starts in silence",
};

/** Where a flag points: the word's start, else the line's. */
function flagTime(flag: Flag): number | null {
  const doc = currentDoc();
  return doc ? timeOf(doc, flag) : null;
}

/** "It's intended": hides the flag for good, with a way back. */
function intended(flag: Flag): void {
  dismissFlag(flag.id);
  toast(`Hidden: ${KIND_LABELS[flag.kind].toLowerCase()} on line ${flag.lineIndex + 1}`, {
    action: { label: "Undo", run: () => restoreFlag(flag.id) },
    durationMs: 8000,
  });
}

function listen(flag: Flag): void {
  const t = flagTime(flag);
  if (t !== null) player.playSegment(Math.max(0, t - 1500), t + 2500);
}

export function FlagsPanel({ shortWords }: { shortWords: string[] }) {
  const flags = useFlags();
  return (
    <aside className="words-aside" aria-label="Worth a look">
      <h2>
        Worth a look
        <Chip tone={flags.length > 0 ? "warn" : "neutral"} mono>
          {flags.length}
        </Chip>
      </h2>
      <p className="intro">lrcgen never fixes these on its own — it only points them out. You decide.</p>
      {flags.length > 0 ? (
        <div className="words-flags">
          {flags.map((flag) => (
            <FlagCard key={flag.id} flag={flag} />
          ))}
        </div>
      ) : (
        <div className="words-calm">
          <span className="title">
            <Icon.Check size={16} />
            Nothing stands out
          </span>
          Words out of order and taps that land in silence show up here as you go.
        </div>
      )}
      {shortWords.length > 0 && (
        <div className="words-tip">
          <span className="title">Short words</span>
          <span>
            {shortWords
              .slice(0, 4)
              .map((w) => `“${w}”`)
              .join(", ")}{" "}
            {shortWords.length === 1 ? "is" : "are"} often sung as one sound with the next word. Join them and they'll light up together in
            karaoke. You can split them again any time.
          </span>
        </div>
      )}
    </aside>
  );
}

function FlagCard({ flag }: { flag: Flag }) {
  return (
    <article className="words-flag">
      <div className="kind">
        <Icon.Warning size={15} />
        {KIND_LABELS[flag.kind]} · Line {flag.lineIndex + 1}
      </div>
      <p>
        {messageParts(flag.message).map((part, i) =>
          part.mono ? (
            <span key={i} className="mono">
              {part.text}
            </span>
          ) : (
            part.text
          ),
        )}
      </p>
      <div className="actions">
        <Button
          variant="ghost"
          className="open"
          onClick={() => {
            select(flag.lineIndex, flag.wordIndex ?? null);
            goToStep("refine");
          }}
        >
          Open in Refine
        </Button>
        <Button variant="ghost" className="listen" icon={<Icon.Play size={12} />} onClick={() => listen(flag)}>
          Listen
        </Button>
        <Button variant="ghost" className="intended" onClick={() => intended(flag)}>
          It's intended
        </Button>
      </div>
    </article>
  );
}
