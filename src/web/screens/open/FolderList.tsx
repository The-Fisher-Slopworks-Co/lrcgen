// "Folders": the bookmarks (XDG folders plus the user's own), the current one highlighted, and "Add a folder…".

import { useState } from "react";
import type { FolderBookmark } from "../../../shared/api";
import { Button, IconButton, Kbd } from "../../components/controls";
import { Icon } from "../../components/icons";
import { DialogHeader, Modal } from "../../components/Modal";
import { addFolder, goToOpen, removeFolder } from "../../state";

export function FolderList({ folders, current, onAdd }: { folders: FolderBookmark[]; current: string | null; onAdd: () => void }) {
  return (
    <section className="open-folders" aria-labelledby="open-folders-title">
      <h2 id="open-folders-title" className="eyebrow">
        Folders
      </h2>
      {folders.map((f) => (
        <div key={f.path} className="open-folder-item">
          <button
            type="button"
            className="open-folder"
            aria-current={f.path === current ? "true" : undefined}
            title={f.path}
            onClick={() => goToOpen(f.path)}
          >
            <Icon.Folder />
            <span className="name ellipsis">{f.name}</span>
          </button>
          {f.custom && (
            <IconButton label={`Remove ${f.name} from Folders`} className="open-folder-remove" onClick={() => void removeFolder(f.path)}>
              <Icon.Close size={14} />
            </IconButton>
          )}
        </div>
      ))}
      <button type="button" className="open-folder add" onClick={onAdd}>
        <Icon.Plus />
        Add a folder…
        <span style={{ flexGrow: 1 }} />
        <Kbd keys="Ctrl+O" />
      </button>
    </section>
  );
}

/** Adds a folder to the sidebar: the one being browsed, pre-filled, or any typed path. */
export function AddFolderDialog({ initialPath, onClose }: { initialPath: string; onClose: () => void }) {
  const [path, setPath] = useState(initialPath);
  const [busy, setBusy] = useState(false);
  const submit = async (e?: { preventDefault(): void }) => {
    e?.preventDefault();
    const value = path.trim();
    if (!value || busy) return;
    setBusy(true);
    const ok = await addFolder(value);
    setBusy(false);
    if (ok) {
      onClose();
      goToOpen(value);
    }
  };
  return (
    <Modal onClose={onClose} labelledBy="open-add-title" style={{ width: 560 }}>
      <DialogHeader id="open-add-title" title="Add a folder" subtitle="It stays in the sidebar until you remove it." onClose={onClose} />
      <form onSubmit={submit} style={{ display: "contents" }}>
        <label className="field">
          Folder path
          <input
            className="input mono"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/home/you/Music/Live recordings"
            spellCheck={false}
            autoFocus
          />
        </label>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" kbd="Enter" disabled={!path.trim() || busy}>
            Add folder
          </Button>
        </div>
      </form>
    </Modal>
  );
}
