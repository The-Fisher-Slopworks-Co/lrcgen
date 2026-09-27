// Pasted text or a loaded file, editable before it's used; the preview on the right follows the edits.

import { useEffect, useRef } from "react";
import { Button } from "../../components/controls";

export interface LyricsText {
  origin: "clipboard" | "file";
  /** File name for a loaded file. */
  name: string | null;
  content: string;
  /** Why the box is empty after "Paste from clipboard": the browser refused, or there was nothing to paste. */
  problem: "denied" | "empty" | null;
}

export function TextPane({
  text,
  onChange,
  onPickFile,
  onFocusChange,
}: {
  text: LyricsText;
  onChange: (content: string) => void;
  onPickFile: () => void;
  /** Whether the text box has focus (the main button's key is Ctrl Enter there). */
  onFocusChange: (focused: boolean) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  // Unmounting a focused box fires no blur.
  useEffect(() => () => onFocusChange(false), []);
  useEffect(() => {
    if (text.problem) area.current?.focus();
  }, [text.problem]);

  const file = text.origin === "file";
  const note =
    text.problem === "denied"
      ? "The browser didn't let lrcgen read the clipboard. Paste into the box with Ctrl V."
      : text.problem === "empty"
        ? "The clipboard has no text. Paste or type the lyrics into the box."
        : "Fix anything that's off right here — the preview follows. LRC time tags are kept.";

  return (
    <>
      <div className="lyrics-text-head">
        <div className="titles">
          <h2>{file ? text.name : "Pasted lyrics"}</h2>
          <p className={text.problem === "denied" ? "warn" : undefined}>{note}</p>
        </div>
        {file && (
          <Button variant="secondary" size="sm" onClick={onPickFile}>
            Choose another file…
          </Button>
        )}
      </div>
      <textarea
        ref={area}
        className="lyrics-textarea"
        aria-label="Lyrics text"
        value={text.content}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        placeholder={"One line of the song per line.\nBlank lines are dropped."}
        spellCheck={false}
      />
    </>
  );
}
