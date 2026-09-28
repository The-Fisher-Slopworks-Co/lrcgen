// Save & publish (Save board): write the lyrics file ("Song.lyrics.json") and, if wanted, LRC for players next to
// the track, or publish to LRCLIB. Mounted by the dialog host while "save" is open; Ctrl+S inside it saves.
// `openSaveDialog("publish")` opens it at the publish part.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { hasAnyWordTimings } from "../../../core/lyrics";
import type { SaveCheck, SaveFormat } from "../../../shared/api";
import * as api from "../../api/client";
import { errorMessage } from "../../api/client";
import { useFlags } from "../../audio/audio-data";
import { usePlayerState } from "../../audio/player";
import { Button, Chip, RadioCard } from "../../components/controls";
import { Icon } from "../../components/icons";
import { DialogHeader, Modal } from "../../components/Modal";
import { relativeDay } from "../../lib/format";
import { closeDialog, currentDoc, goToStep, refreshDraftMeta, toast, updateDraft, useApp, useDoc, useDraft, useTrack } from "../../state";
import { reviewFlag } from "../refine/review";
import { takeSaveFocus } from "./open-save";
import {
  backupNames,
  baseName,
  fileSuffixes,
  flagSummary,
  joinedNote,
  joinedOnSave,
  listNames,
  parseLrcPath,
  publishChecklist,
  replacedFiles,
  savedMessage,
  splitPath,
} from "./save-model";
import "./save.css";

export function SaveDialog() {
  const close = () => closeDialog("save");
  const draft = useDraft();
  const doc = useDoc();
  const homeDir = useApp()?.homeDir ?? null;
  const [focus] = useState(takeSaveFocus);

  const [format, setFormat] = useState<SaveFormat>(() => (hasAnyWordTimings(doc) ? "enhanced" : "lines"));
  const [check, setCheck] = useState<SaveCheck | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const path = draft.lrcPath;
  useEffect(() => {
    let live = true;
    setCheck(null);
    api.checkSave(path).then(
      (c) => live && setCheck(c),
      (err: unknown) => live && setSaveError(errorMessage(err)),
    );
    return () => {
      live = false;
    };
  }, [path]);

  /** Applies the path being edited; false when it isn't valid. */
  const applyPath = (): string | null => {
    if (editing === null) return path;
    const parsed = parseLrcPath(editing, homeDir);
    if ("error" in parsed) {
      setEditError(parsed.error);
      return null;
    }
    setEditing(null);
    setEditError(null);
    setSaveError(null);
    if (parsed.path !== path) updateDraft({ lrcPath: parsed.path });
    return parsed.path;
  };

  const doSave = async () => {
    if (saving) return;
    const target = applyPath();
    const current = currentDoc();
    if (!target || !current) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.save({ draftId: draft.id, path: target, format, doc: current });
      void refreshDraftMeta();
      toast(savedMessage(res.written));
      close();
    } catch (err) {
      setSaveError(errorMessage(err));
      setSaving(false);
    }
  };

  const joined = joinedNote(joinedOnSave(doc));
  const { dir, name } = splitPath(path, homeDir);
  const targets = (f: SaveFormat) => check?.targets.find((t) => t.format === f)?.paths.map(baseName) ?? [];
  const lyricsName = check ? baseName(check.lyricsPath) : "";
  const { replaced, kept } = replacedFiles(check?.existing ?? [], check?.lyricsPath ?? "", format);
  const backups = backupNames(replaced);
  const companionGoes = format === "lines" && replaced.some((p) => p !== path && p !== check?.lyricsPath);

  const onEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyPath();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null);
      setEditError(null);
    }
  };

  return (
    <Modal
      onClose={close}
      labelledBy="save-title"
      padded={false}
      className="save-dialog"
      style={{ width: 720, height: "min(800px, calc(100vh - 48px))" }}
      hotkeys={{ "Ctrl+S": { run: () => void doSave(), inInputs: true } }}
    >
      <div className="save-head">
        <DialogHeader id="save-title" title="Save & publish" onClose={close} />
      </div>
      <div className="save-scroll">
        <section className="save-section" aria-labelledby="save-local-title">
          <h2 id="save-local-title" className="save-h2">
            Save next to the track
          </h2>
          {editing === null ? (
            <div className="save-path-row">
              <div className="save-path" title={path}>
                <span className="inner">
                  <span className="dir">{dir}</span>
                  <span className="name">{name}</span>
                </span>
              </div>
              <Button variant="ghost" size="xs" onClick={() => setEditing(path)}>
                Change…
              </Button>
            </div>
          ) : (
            <div className="save-path-edit">
              <div className="save-path-row">
                <input
                  className="input mono save-path-input"
                  aria-label="Save to"
                  value={editing}
                  autoFocus
                  spellCheck={false}
                  onChange={(e) => {
                    setEditing(e.target.value);
                    setEditError(null);
                  }}
                  onKeyDown={onEditKey}
                />
                <Button variant="secondary" size="xs" onClick={applyPath}>
                  Use this path
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setEditing(null);
                    setEditError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
              <span className={editError ? "save-hint error" : "save-hint"}>
                {editError ?? "A plain .lrc file; the lyrics file and, with word timings, the .enhanced.lrc go next to it."}
              </span>
            </div>
          )}

          <div className="save-lyrics-file">
            <Icon.Check size={18} />
            <span className="text">
              <span className="save-card-label">
                lrcgen lyrics
                {lyricsName && (
                  <span className="save-writes" title={`Writes ${lyricsName}`}>
                    .lyrics.json
                  </span>
                )}
              </span>
              <span className="save-card-note">
                Always saved: when every word starts (and ends, where that's set), the groups and their labels. lrcgen opens it as it is, and so can your own tools.
              </span>
            </span>
          </div>

          <fieldset className="save-formats">
            <legend className="eyebrow">LRC for players</legend>
            <RadioCard
              name="save-format"
              checked={format === "enhanced"}
              onChange={() => setFormat("enhanced")}
              label={<Writes label="LRC with word timings" names={targets("enhanced")} />}
              description={
                <>
                  Enhanced LRC — for karaoke players and lyric-video tools. Backing vocals and ad-libs go into their line in parentheses.
                  {joined && <span className="save-card-note">{joined}</span>}
                </>
              }
            />
            <RadioCard
              name="save-format"
              checked={format === "lines"}
              onChange={() => setFormat("lines")}
              label={<Writes label="LRC, lines only" names={targets("lines")} />}
              description="For players that don't read word timings."
            />
            <RadioCard
              name="save-format"
              checked={format === "none"}
              onChange={() => setFormat("none")}
              label="No LRC"
              description="Only the lyrics file."
            />
          </fieldset>

          {backups.length > 0 && (
            <p className="save-note">
              <Icon.Info size={16} />
              <span>
                {backups.length === 1 ? "This file already exists. The old version will be kept as " : "These files already exist. The old versions will be kept as "}
                {backups.map((b, i) => (
                  <span key={b}>
                    {i > 0 && (i === backups.length - 1 ? " and " : ", ")}
                    <span className="mono-name">{b}</span>
                  </span>
                ))}
                .{companionGoes && <> Lines only removes {baseName(replaced.find((p) => p !== path && p !== check?.lyricsPath)!)}, since it would no longer match.</>}
              </span>
            </p>
          )}
          {kept.length > 0 && (
            <p className="save-note">
              <Icon.Info size={16} />
              <span>
                {listNames(kept.map(baseName))} {kept.length === 1 ? "stays" : "stay"} as {kept.length === 1 ? "it is" : "they are"} and won't match these lyrics.
              </span>
            </p>
          )}
          {saveError && (
            <p className="save-error" role="alert">
              <Icon.Warning size={16} />
              <span>Couldn't save: {saveError}</span>
            </p>
          )}
          <div className="save-actions">
            <Button variant="primary" size="dialog" kbd="Ctrl+S" onClick={() => void doSave()} disabled={saving} autoFocus={focus !== "publish"}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </section>

        <PublishSection focus={focus === "publish"} onDone={close} />
      </div>
    </Modal>
  );
}

/** The card's label with the files it writes on the right: "LRC with word timings    .lrc + .enhanced.lrc". */
function Writes({ label, names }: { label: string; names: string[] }) {
  return (
    <span className="save-card-label">
      {label}
      {names.length > 0 && (
        <span className="save-writes" title={`Writes ${listNames(names)}`}>
          {fileSuffixes(names).join(" + ")}
        </span>
      )}
    </span>
  );
}

type PublishState = { kind: "idle" } | { kind: "busy" } | { kind: "done" } | { kind: "error"; message: string };

function PublishSection({ focus, onDone }: { focus: boolean; onDone: () => void }) {
  const draft = useDraft();
  const doc = useDoc();
  const track = useTrack();
  const flags = useFlags();
  const playerDuration = usePlayerState((s) => s.durationMs);
  const durationMs = track?.durationMs ?? (playerDuration || null);
  const [state, setState] = useState<PublishState>({ kind: "idle" });
  const section = useRef<HTMLElement>(null);
  const firstAction = useRef<HTMLDivElement>(null);

  const { rows, blockers, firstFlag } = publishChecklist(doc, durationMs, flags);
  const blocked = blockers.length > 0;
  const busy = state.kind === "busy";

  // Runs before the Modal's own focus handling (children first), so it keeps this focus.
  useEffect(() => {
    if (!focus) return;
    section.current?.scrollIntoView({ block: "start" });
    const button = firstAction.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    (button ?? section.current)?.focus();
  }, [focus]);

  const publish = async () => {
    const current = currentDoc();
    if (!current || !durationMs || blocked || busy) return;
    setState({ kind: "busy" });
    try {
      const res = await api.publish({ draftId: draft.id, doc: current, durationMs });
      if (res.success) {
        await refreshDraftMeta();
        setState({ kind: "done" });
      } else setState({ kind: "error", message: res.error ?? "The database refused it." });
    } catch (err) {
      setState({ kind: "error", message: errorMessage(err) });
    }
  };

  const songInfo = () => {
    onDone();
    goToStep("lines");
  };

  return (
    <section ref={section} tabIndex={-1} className="save-section publish" aria-labelledby="save-publish-title">
      <div className="save-publish-head">
        <h2 id="save-publish-title" className="save-h2">
          Publish to the open lyrics database
        </h2>
        <Chip tone="vocals" size="lg">
          needs internet
        </Chip>
      </div>
      <p className="save-copy">Sends the lyrics, line and word timings, artist, title, album and length. The audio never leaves your computer.</p>

      <ul className="save-checklist">
        {rows.map((row) => (
          <li key={row.id} className={row.ok ? "ok" : "warn"}>
            {row.ok ? <Icon.Check size={18} className="mark" /> : <Icon.Warning size={18} className="mark" />}
            <span className="text">{row.text}</span>
            {!row.ok && row.id === "tags" && (
              <button type="button" className="save-link" onClick={songInfo}>
                Song info
              </button>
            )}
            {!row.ok && row.id === "flags" && firstFlag && (
              <button type="button" className="save-link" onClick={() => reviewFlag(firstFlag)}>
                Review
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="save-publish-status" aria-live="polite">
        {busy && (
          <p className="save-progress">
            <Icon.Spinner size={16} />
            Publishing — solving the database's anti-spam puzzle…
          </p>
        )}
        {state.kind === "done" && (
          <p className="save-result ok">
            <Icon.Check size={16} />
            Published. Players that look up lyrics online can find it now.
          </p>
        )}
        {state.kind === "error" && (
          <p className="save-error" role="alert">
            <Icon.Warning size={16} />
            <span>Couldn't publish: {state.message}</span>
          </p>
        )}
        {state.kind !== "done" && !busy && draft.publishedAt !== null && (
          <p className="save-hint">Published {relativeDay(draft.publishedAt)}. Publishing again sends the current version.</p>
        )}
      </div>

      <div className="save-publish-actions" ref={firstAction}>
        {blocked && <span className="save-blocker">{blockers.join(" · ")}</span>}
        {firstFlag ? (
          <>
            <Button variant="primary" onClick={() => reviewFlag(firstFlag)} title={flagSummary(firstFlag)}>
              Review line {firstFlag.lineIndex + 1} first
            </Button>
            <Button variant="secondary" disabled={blocked || busy} onClick={() => void publish()}>
              Publish anyway
            </Button>
          </>
        ) : (
          <Button variant="primary" disabled={blocked || busy} onClick={() => void publish()}>
            Publish
          </Button>
        )}
      </div>
    </section>
  );
}
