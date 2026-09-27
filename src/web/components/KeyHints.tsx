// The slim 40 px footer row of key hints (open screen): "↑ ↓ select · Enter open · …" and a note on the right.
//   <KeyHints hints={[{ keys: ["ArrowUp", "ArrowDown"], label: "select" }]} note="Works offline…" />

import type { ReactNode } from "react";
import { KeyHint } from "./controls";

export interface KeyHintItem {
  /** Hotkey specs, each shown as a key cap. */
  keys: string[];
  label: ReactNode;
}

export function KeyHints({ hints, note }: { hints: KeyHintItem[]; note?: ReactNode }) {
  return (
    <footer className="key-hints">
      {hints.map((h, i) => (
        <KeyHint key={i} keys={h.keys}>
          {h.label}
        </KeyHint>
      ))}
      <span className="spacer" />
      {note && <span>{note}</span>}
    </footer>
  );
}
