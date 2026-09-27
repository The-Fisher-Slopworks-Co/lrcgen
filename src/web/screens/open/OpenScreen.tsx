// 1 · Open a song (Main board). The route holds the folder and the selected file (`#/open?dir=…&file=…`),
// so reload and Back keep them. Arrow keys replace the history entry; changing folders pushes one.
// Keys: ↑/↓ select · Enter open (folder: enter it) · Backspace up a folder · / filter · Ctrl R Recent · Ctrl O add a folder.

import { useEffect, useMemo, useRef, useState } from "react";
import type { DirEntry, TrackInfo } from "../../../shared/api";
import * as api from "../../api/client";
import { ApiRequestError, errorMessage } from "../../api/client";
import { Button } from "../../components/controls";
import { EmptyState } from "../../components/feedback";
import { Icon } from "../../components/icons";
import { useHotkeys } from "../../hotkeys/hotkeys";
import { goToOpen, goToSong, navigate, openSong, toastError, useApp, useRoute } from "../../state";
import { currentBookmark, filterEntries, moveSelection, parentDir } from "./browse";
import { FileList, type ListingState } from "./FileList";
import { AddFolderDialog, FolderList } from "./FolderList";
import { RecentList } from "./RecentList";
import { TrackPanel, type TrackLoad } from "./TrackPanel";
import "./open.css";

/**
 * The last finished listing (kept on screen while the next folder loads) and whether one is loading.
 * Re-reads when the bookmarks change: they decide where the breadcrumbs start.
 */
function useListing(dir: string | null, bookmarks: unknown): { state: ListingState | null; loading: boolean } {
  const [state, setState] = useState<ListingState | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!dir) return;
    let live = true;
    setLoading(true);
    api
      .listDir(dir)
      .then((listing) => live && setState({ dir, listing, error: null }))
      .catch((err) => {
        if (!live) return;
        const status = err instanceof ApiRequestError ? err.status : 0;
        setState({ dir, listing: null, error: { status, message: errorMessage(err) } });
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [dir, bookmarks]);
  return { state, loading };
}

function useTrackLoad(path: string | null, version: number): TrackLoad | null {
  const [load, setLoad] = useState<TrackLoad | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api
      .getTrack(path)
      .then((track) => live && setLoad({ path, track, error: null }))
      .catch((err) => live && setLoad({ path, track: null, error: errorMessage(err) }));
    return () => {
      live = false;
    };
  }, [path, version]);
  return load;
}

/** Enter on a focused button or link (Recent row, "Start over…", a crumb) clicks it rather than opening the selection. */
function isOtherControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target.closest("[data-open-row]")) return false;
  return target.closest("button, a[href]") !== null;
}

export function OpenScreen() {
  const route = useRoute();
  const app = useApp();
  const folders = app?.folders ?? [];
  const routeDir = route?.name === "open" ? route.dir : null;
  const routeFile = route?.name === "open" ? route.file : null;
  const dir = routeDir ?? folders[0]?.path ?? null;

  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [noLyricsFor, setNoLyricsFor] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const recentRef = useRef<HTMLDivElement>(null);

  const { state, loading } = useListing(dir, app?.folders);
  const fresh = state?.dir === dir;
  const entries = useMemo(() => state?.listing?.entries ?? [], [state]);
  const visible = useMemo(() => filterEntries(entries, filter), [entries, filter]);
  const selected = entries.find((e) => e.path === routeFile) ?? null;
  const selectedAudio = selected?.kind === "audio" ? selected.path : null;
  const load = useTrackLoad(selectedAudio, version);

  const select = (file: string | null) => {
    if (dir) navigate({ name: "open", dir, file }, { replace: true });
  };

  // A bare #/open lands in the first bookmarked folder.
  useEffect(() => {
    if (!routeDir && dir) navigate({ name: "open", dir, file: routeFile }, { replace: true });
  }, [routeDir, dir, routeFile]);

  useEffect(() => setFilter(""), [dir]);

  // A fresh folder selects its first audio file unless the route already points at something in it.
  useEffect(() => {
    if (!fresh || !state?.listing) return;
    if (routeFile && state.listing.entries.some((e) => e.path === routeFile)) return;
    const first = state.listing.entries.find((e) => e.kind === "audio")?.path ?? null;
    if (first !== routeFile) select(first);
  }, [fresh, state, routeFile]);

  // Filtering keeps a visible selection.
  useEffect(() => {
    if (!filter || visible.length === 0) return;
    if (routeFile && visible.some((e) => e.path === routeFile)) return;
    select(visible[0]!.path);
  }, [filter, visible]);

  async function openTrack(path: string, how: "primary" | "elsewhere") {
    if (busy) return;
    setBusy(true);
    try {
      let track: TrackInfo | null = load?.path === path ? load.track : null;
      if (!track) {
        try {
          track = await api.getTrack(path);
        } catch (err) {
          toastError("Couldn't read the file", err);
          return;
        }
      }
      if (track.draft) {
        goToSong(track.draft.id, how === "elsewhere" ? "lyrics" : track.draft.step);
        return;
      }
      const lyricsPath = how === "primary" && track.lyrics && noLyricsFor !== path ? track.lyrics.path : undefined;
      const draft = await openSong(path, lyricsPath ? { lyricsPath } : {});
      if (draft && how === "elsewhere" && draft.step !== "lyrics") {
        navigate({ name: "song", draftId: draft.id, step: "lyrics", params: {} }, { replace: true });
      }
    } finally {
      setBusy(false);
    }
  }

  const activate = (entry: DirEntry) => {
    if (entry.kind === "dir") goToOpen(entry.path);
    else void openTrack(entry.path, "primary");
  };

  const goUp = () => {
    if (!dir || dir === "/") return;
    goToOpen(state?.listing?.parent ?? parentDir(dir), dir);
  };

  useHotkeys({
    ArrowDown: { run: () => select(moveSelection(visible.map((e) => e.path), routeFile, 1)), inInputs: true },
    ArrowUp: { run: () => select(moveSelection(visible.map((e) => e.path), routeFile, -1)), inInputs: true },
    Enter: {
      run: (e) => {
        if (isOtherControl(e.target) || !selected) return false;
        activate(selected);
      },
      inInputs: true,
      repeat: false,
    },
    Backspace: goUp,
    "/": () => {
      filterRef.current?.focus();
      filterRef.current?.select();
    },
    "Ctrl+R": { run: () => recentRef.current?.querySelector<HTMLElement>(".open-recent-row")?.focus(), inInputs: true },
    "Ctrl+O": { run: () => setAdding(true), inInputs: true },
  });

  const addInitial = dir && !folders.some((f) => f.path === dir) ? dir : "";

  return (
    <div className="open-screen">
      <aside className="open-sidebar">
        <RecentList ref={recentRef} version={version} selectedPath={selectedAudio} onChanged={() => setVersion((v) => v + 1)} />
        <FolderList folders={folders} current={currentBookmark(folders, dir)} onAdd={() => setAdding(true)} />
      </aside>

      {dir ? (
        <FileList
          ref={filterRef}
          state={state}
          loading={loading}
          visible={visible}
          selected={routeFile}
          filter={filter}
          onFilter={setFilter}
          onSelect={select}
          onActivate={activate}
        />
      ) : (
        <main className="open-main">
          <EmptyState
            icon={<Icon.Folder size={32} />}
            title="No folders yet"
            actions={
              <Button variant="primary" kbd="Ctrl+O" onClick={() => setAdding(true)}>
                Add a folder…
              </Button>
            }
          >
            Add the folder where your music lives. It stays in the sidebar, and you can add more later.
          </EmptyState>
        </main>
      )}

      <TrackPanel
        selected={selected}
        load={load}
        loadLyrics={noLyricsFor !== selectedAudio}
        onLoadLyrics={(on) => setNoLyricsFor(on ? null : selectedAudio)}
        busy={busy}
        onOpen={(how) => selectedAudio && void openTrack(selectedAudio, how)}
        onEnterFolder={(path) => goToOpen(path)}
        onChanged={() => setVersion((v) => v + 1)}
      />

      {adding && <AddFolderDialog initialPath={addInitial} onClose={() => setAdding(false)} />}
    </div>
  );
}
