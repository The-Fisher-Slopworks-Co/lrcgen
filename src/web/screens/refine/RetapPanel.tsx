// The strip under the Refine timeline while a group is being retapped: its words, which are done (with their new
// starts), which is next, and the keys.

import type { LyricsDoc } from "../../../core/lyrics";
import { Button, Kbd } from "../../components/controls";
import { seconds } from "../../lib/format";
import { currentWord, type Retap } from "./retap";

export function RetapPanel({ retap, doc, rate, onStop, onCancel }: { retap: Retap; doc: LyricsDoc; rate: number; onStop: () => void; onCancel: () => void }) {
  const words = retap.doc.groups[retap.group]?.words ?? [];
  const next = currentWord(retap);
  const retapped = new Set(retap.order.slice(0, retap.at));
  return (
    <section className="refine-retap" aria-label="Retap">
      <div className="words">
        {words.map((w, i) => {
          const cls = ["refine-retap-word", retapped.has(i) && "done", i === next && "next", !retap.order.includes(i) && "skipped"].filter(Boolean).join(" ");
          return (
            <span key={w.id} className={cls}>
              {w.text}
              <small>{retapped.has(i) && w.start !== null ? seconds(w.start) : " "}</small>
            </span>
          );
        })}
      </div>
      <div className="side">
        <Button variant="secondary" size="sm" kbd="Esc" onClick={onStop}>
          Done
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={doc === retap.doc}>
          Cancel
        </Button>
      </div>
      <p className="how">
        <span>
          Tap <Kbd keys="Enter" /> as each word starts. Only the starts change.
        </span>
        <span>
          <Kbd keys="Backspace" /> the word before again
        </span>
        <span>Playing at {rate}×, from a little before the word</span>
      </p>
    </section>
  );
}
