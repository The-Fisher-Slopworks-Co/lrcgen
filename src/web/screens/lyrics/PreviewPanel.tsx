// The right-hand preview: where the lyrics come from, their lines (with times when they have them), and the use buttons.

import type { ReactNode } from "react";
import { groupStart, groupText, isLabelled, type Group } from "../../../core/lyrics";
import type { TimingLevel } from "../../../shared/api";
import { Button } from "../../components/controls";
import { EmptyState } from "../../components/feedback";
import { clock, plural } from "../../lib/format";
import { lyricLineCount, stripTimings } from "./lyrics-text";

export interface PreviewContent {
  title: string;
  /** Appended to "N lines · line timings" ("contributed by a database user"). */
  source?: string;
  groups: Group[];
  timing: TimingLevel;
  /** Shown instead of lines (instrumental result, nothing pasted yet). */
  empty?: { title: string; text?: ReactNode };
  /** The note under the buttons when the lyrics come with timings. */
  timingNote?: string;
}

const TIMING_LABEL: Record<TimingLevel, string> = {
  none: "no timings",
  lines: "line timings",
  words: "line and word timings",
};

/** The primary action's label and groups for a preview (text only when there are no timings to keep). */
export function primaryUse(content: PreviewContent): { label: string; groups: Group[] } {
  if (content.timing === "none") return { label: "Use these lyrics", groups: stripTimings(content.groups) };
  return { label: content.timing === "words" ? "Use lyrics and timings" : "Use lyrics and line timings", groups: content.groups };
}

/** `primaryKey`: the key cap on the main button ("Ctrl+Enter" while typing in the text box). */
export function PreviewPanel({
  content,
  onUse,
  primaryKey = "Enter",
}: {
  content: PreviewContent | null;
  onUse: (groups: Group[]) => void;
  primaryKey?: string;
}) {
  const count = content ? lyricLineCount(content.groups) : 0;
  const usable = !!content && !content.empty && count > 0;
  const primary = content && primaryUse(content);
  const timed = content?.timing !== "none";

  return (
    <aside className="lyrics-preview" aria-label="Preview">
      <div className="lyrics-preview-head">
        <span className="eyebrow">Preview</span>
        {content ? (
          <>
            <span className="title">{content.title}</span>
            <span className="sub">
              {content.empty
                ? content.empty.title
                : [plural(count, "line"), TIMING_LABEL[content.timing], content.source].filter(Boolean).join(" · ")}
            </span>
          </>
        ) : (
          <span className="sub">Nothing picked yet</span>
        )}
      </div>

      {!content || content.empty || count === 0 ? (
        <EmptyState title={content?.empty?.title ?? (content ? "No lines yet" : "Pick lyrics to preview them")}>
          {content?.empty?.text ?? (content ? "Paste or type the lyrics on the left — one line per line." : undefined)}
        </EmptyState>
      ) : (
        <div className={timed ? "lyrics-preview-lines" : "lyrics-preview-lines plain"}>
          {content.groups.map((g) => {
            const start = groupStart(g);
            return (
              <div key={g.id} className="lyrics-preview-line">
                {timed && <span className="time">{start === null ? "" : clock(start)}</span>}
                <span className={isLabelled(g) ? "text backing" : "text"}>{groupText(g)}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="lyrics-preview-actions">
        <Button variant="primary" size="dialog" block kbd={primaryKey} disabled={!usable} onClick={() => primary && onUse(primary.groups)}>
          {primary?.label ?? "Use these lyrics"}
        </Button>
        {usable && timed && (
          <Button variant="secondary" block className="lyrics-secondary" onClick={() => onUse(stripTimings(content.groups))}>
            Use lyrics only
          </Button>
        )}
        {usable && timed && content.timingNote && <p>{content.timingNote}</p>}
      </div>
    </aside>
  );
}
