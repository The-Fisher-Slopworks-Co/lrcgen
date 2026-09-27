// The selected file: cover and tags, the lyrics file found next to it, the draft note, and the open buttons.

import { useEffect, useState } from "react";
import type { DirEntry, TrackInfo } from "../../../shared/api";
import * as api from "../../api/client";
import { Button } from "../../components/controls";
import { EmptyState, Loading } from "../../components/feedback";
import { Icon } from "../../components/icons";
import { DialogHeader, Modal } from "../../components/Modal";
import { clock, relativeDay } from "../../lib/format";
import { toast, toastError } from "../../state";
import { albumLine, sidecarSummary } from "./browse";
import { StepBar } from "./RecentList";

export type TrackLoad = { path: string; track: TrackInfo | null; error: string | null };

interface TrackPanelProps {
  selected: DirEntry | null;
  load: TrackLoad | null;
  loadLyrics: boolean;
  onLoadLyrics: (on: boolean) => void;
  busy: boolean;
  onOpen: (how: "primary" | "elsewhere") => void;
  onEnterFolder: (path: string) => void;
  onChanged: () => void;
}

export function TrackPanel(props: TrackPanelProps) {
  const { selected, load } = props;
  return <aside className="open-panel">{content()}</aside>;

  function content() {
    if (!selected) {
      return (
        <EmptyState icon={<Icon.AudioFile size={32} />} title="Pick a song">
          Select an audio file to see its tags, the lyrics next to it and whether you've started on it.
        </EmptyState>
      );
    }
    if (selected.kind === "dir") {
      return (
        <EmptyState
          icon={<Icon.Folder size={32} />}
          title={selected.name}
          actions={
            <Button variant="secondary" kbd="Enter" onClick={() => props.onEnterFolder(selected.path)}>
              Open the folder
            </Button>
          }
        />
      );
    }
    if (!load || load.path !== selected.path) return <Loading>Reading tags…</Loading>;
    if (!load.track) {
      return (
        <EmptyState icon={<Icon.Warning size={30} style={{ color: "var(--warn)" }} />} title="Can't read this file">
          <span className="open-error">{load.error}</span>
        </EmptyState>
      );
    }
    return <TrackDetails {...props} track={load.track} />;
  }
}

function Cover({ track }: { track: TrackInfo }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [track.path]);
  if (!track.hasCover || failed) {
    return (
      <div className="open-cover placeholder" aria-hidden="true">
        cover art
        <br />
        from tags
      </div>
    );
  }
  return <img className="open-cover" src={api.coverUrl(track.path)} alt="" onError={() => setFailed(true)} />;
}

function TrackDetails({ track, loadLyrics, onLoadLyrics, busy, onOpen, onChanged }: TrackPanelProps & { track: TrackInfo }) {
  const [confirming, setConfirming] = useState(false);
  const { draft, lyrics } = track;
  const album = albumLine(track.album, track.trackNo);

  return (
    <>
      <div className="open-track-head">
        <Cover track={track} />
        <div className="open-track-meta">
          <h1>{track.title}</h1>
          {track.artist && <span className="artist">{track.artist}</span>}
          {album && <span className="album">{album}</span>}
          <span className="format">
            {track.format} · {clock(track.durationMs)}
          </span>
        </div>
      </div>

      {lyrics && (
        <div className="open-sidecar">
          <div className="open-sidecar-head">
            <Icon.Check size={16} />
            Lyrics found next to the track
          </div>
          <div className="open-sidecar-file">
            <Icon.LyricsFile size={28} strokeWidth={1.5} />
            <div className="text">
              <span className="file">{lyrics.name}</span>
              <span className="summary">{sidecarSummary(lyrics)}</span>
            </div>
          </div>
          {draft ? (
            <p className="aside">Not loaded again: the draft keeps its own lyrics. You can swap them on the Lyrics step.</p>
          ) : (
            <label className="open-check">
              <input type="checkbox" checked={loadLyrics} onChange={(e) => onLoadLyrics(e.target.checked)} />
              Load it when opening
            </label>
          )}
        </div>
      )}

      {draft ? (
        <div className="open-draft">
          <span className="open-progress">
            <StepBar done={draft.stepsDone} />
            {draft.status}
          </span>
          <p className="open-note">
            Draft last edited {relativeDay(draft.updatedAt)}. Opening continues where you left off.
          </p>
        </div>
      ) : (
        <p className="open-note">
          No draft for this song yet. Once it's open, your work saves as you go — close the app any time and pick up where you left off.
        </p>
      )}

      <div className="open-spacer" />

      <div className="open-actions">
        {draft ? (
          <>
            <Button variant="primary" size="lg" block kbd="Enter" disabled={busy} onClick={() => onOpen("primary")}>
              Continue
            </Button>
            <Button variant="ghost" block disabled={busy} onClick={() => setConfirming(true)}>
              Start over…
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="lg" block kbd="Enter" disabled={busy} onClick={() => onOpen("primary")}>
              {lyrics && loadLyrics ? "Open with these lyrics" : "Open"}
            </Button>
            <Button variant="secondary" block disabled={busy} onClick={() => onOpen("elsewhere")}>
              Open and get lyrics elsewhere
            </Button>
          </>
        )}
      </div>

      {confirming && draft && (
        <StartOverDialog
          track={track}
          onClose={() => setConfirming(false)}
          onDeleted={() => {
            setConfirming(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function StartOverDialog({ track, onClose, onDeleted }: { track: TrackInfo; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const draft = track.draft!;
  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteDraft(draft.id);
      toast(`Draft for “${track.title}” deleted`);
      onDeleted();
    } catch (err) {
      toastError("Couldn't delete the draft", err);
      setBusy(false);
    }
  };
  return (
    <Modal onClose={onClose} labelledBy="open-restart-title" style={{ width: 520 }}>
      <DialogHeader id="open-restart-title" title="Start this song over?" onClose={onClose} />
      <p className="open-dialog-text">
        This deletes the draft for “{track.title}” ({draft.status.toLowerCase()}): its lyrics, timings and undo history. Files you
        already saved next to the track stay where they are.
      </p>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={onClose}>
          Keep the draft
        </Button>
        <Button className="open-danger" onClick={remove} disabled={busy} icon={<Icon.Trash size={16} />}>
          Delete and start over
        </Button>
      </div>
    </Modal>
  );
}
