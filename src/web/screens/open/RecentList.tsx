// "Recent": drafts, most recently edited first. A draft whose audio file is gone stays listed and says so;
// clicking it offers to delete the draft instead of opening a song that can't play.

import { forwardRef, useEffect, useState, type KeyboardEvent } from "react";
import type { DraftSummary } from "../../../shared/api";
import * as api from "../../api/client";
import { Button, Kbd } from "../../components/controls";
import { Icon } from "../../components/icons";
import { DialogHeader, Modal } from "../../components/Modal";
import { relativeDay } from "../../lib/format";
import { goToSong, toast, toastError } from "../../state";

/** The 5-segment progress bar of the Recent list. */
export function StepBar({ done }: { done: number }) {
  return (
    <span className="open-steps" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={i < done ? "on" : undefined} />
      ))}
    </span>
  );
}

function useRecent(version: number): DraftSummary[] | null {
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  useEffect(() => {
    let live = true;
    api
      .listDrafts()
      .then((list) => live && setDrafts(list))
      .catch(() => live && setDrafts([]));
    return () => {
      live = false;
    };
  }, [version]);
  return drafts;
}

export const RecentList = forwardRef<HTMLDivElement, { version: number; selectedPath: string | null; onChanged: () => void }>(
  function RecentList({ version, selectedPath, onChanged }, ref) {
    const drafts = useRecent(version);
    const [gone, setGone] = useState<DraftSummary | null>(null);

    // ↑/↓ move between rows once the list has focus (Ctrl R); the file list keeps its own selection.
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".open-recent-row")];
      const i = rows.indexOf(document.activeElement as HTMLButtonElement);
      if (i === -1) return;
      e.preventDefault();
      rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    };

    return (
      <section className="open-recent" aria-labelledby="open-recent-title">
        <div className="open-section-head">
          <h2 id="open-recent-title" className="eyebrow">
            Recent
          </h2>
          <Kbd keys="Ctrl+R" />
        </div>
        <div ref={ref} className="open-recent-list" onKeyDown={onKeyDown}>
          {drafts === null ? null : drafts.length === 0 ? (
            <p className="open-recent-empty">Songs you open show up here, with how far along they are.</p>
          ) : (
            drafts.map((d) => {
              const isMissing = d.audioMissing;
              return (
                <button
                  key={d.id}
                  type="button"
                  className={isMissing ? "open-recent-row missing" : "open-recent-row"}
                  aria-current={d.audioPath === selectedPath ? "true" : undefined}
                  title={d.audioPath}
                  onClick={() => (isMissing ? setGone(d) : goToSong(d.id, d.step))}
                >
                  <span className="open-recent-top">
                    <span className="open-recent-title ellipsis">{d.title}</span>
                    <span className="open-recent-when">{relativeDay(d.updatedAt)}</span>
                  </span>
                  {d.artist && <span className="open-recent-artist ellipsis">{d.artist}</span>}
                  <span className="open-progress">
                    <StepBar done={d.stepsDone} />
                    {isMissing ? (
                      <span className="open-recent-status">
                        <Icon.Warning size={12} />
                        Audio file not found
                      </span>
                    ) : (
                      <span className="open-recent-status ellipsis">{d.status}</span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
        {gone && (
          <MissingAudioDialog
            draft={gone}
            onClose={() => setGone(null)}
            onDeleted={() => {
              setGone(null);
              onChanged();
            }}
          />
        )}
      </section>
    );
  },
);

function MissingAudioDialog({ draft, onClose, onDeleted }: { draft: DraftSummary; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteDraft(draft.id);
      toast(`Draft for “${draft.title}” deleted`);
      onDeleted();
    } catch (err) {
      toastError("Couldn't delete the draft", err);
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose} labelledBy="open-missing-title" style={{ width: 520 }}>
      <DialogHeader id="open-missing-title" title="The audio file is gone" onClose={onClose} />
      <p className="open-dialog-text">
        The draft for “{draft.title}” belongs to <span className="path">{draft.audioPath}</span>, which isn't there any more. Move the
        file back to keep working on it, or delete the draft ({draft.status.toLowerCase()}).
      </p>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={onClose}>
          Keep the draft
        </Button>
        <Button className="open-danger" onClick={remove} disabled={busy} icon={<Icon.Trash size={16} />}>
          Delete the draft
        </Button>
      </div>
    </Modal>
  );
}
