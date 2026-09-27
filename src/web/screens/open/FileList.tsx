// The file browser: breadcrumbs, filter, and the folder's subfolders and audio files with their lyrics sidecars.

import { forwardRef, useEffect, useRef, type KeyboardEvent } from "react";
import type { DirEntry, DirListing } from "../../../shared/api";
import { Button } from "../../components/controls";
import { EmptyState, Loading } from "../../components/feedback";
import { Icon } from "../../components/icons";
import { shortClock } from "../../lib/format";
import { goToOpen } from "../../state";
import { baseName, lyricsLabel, parentDir } from "./browse";

export interface ListingState {
  dir: string;
  listing: DirListing | null;
  error: { status: number; message: string } | null;
}

interface FileListProps {
  state: ListingState | null;
  loading: boolean;
  visible: DirEntry[];
  selected: string | null;
  filter: string;
  onFilter: (value: string) => void;
  onSelect: (path: string) => void;
  onActivate: (entry: DirEntry) => void;
}

export const FileList = forwardRef<HTMLInputElement, FileListProps>(function FileList(
  { state, loading, visible, selected, filter, onFilter, onSelect, onActivate },
  filterRef,
) {
  const listRef = useRef<HTMLDivElement>(null);
  const listing = state?.listing ?? null;

  useEffect(() => {
    if (!selected) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(selected)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selected, listing]);

  const onFilterKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    if (filter) onFilter("");
    else e.currentTarget.blur();
  };

  return (
    <main className="open-main">
      <div className="open-toolbar">
        <nav aria-label="Path" className="open-crumbs">
          {state &&
            visibleCrumbs(listing?.crumbs ?? fallbackCrumbs(state.dir)).map((c, i, all) =>
              i === all.length - 1 ? (
                <span key={c.path} className="here" title={c.path}>
                  {c.name}
                </span>
              ) : (
                <CrumbLink key={c.path} name={c.name} path={c.path} />
              ),
            )}
        </nav>
        <label className="open-filter">
          <Icon.Search size={16} />
          <span className="visually-hidden">Filter by name</span>
          <input
            ref={filterRef}
            value={filter}
            placeholder="Filter this folder"
            onChange={(e) => onFilter(e.target.value)}
            onKeyDown={onFilterKey}
            spellCheck={false}
          />
        </label>
      </div>

      <div className="open-cols" aria-hidden="true">
        <span>File</span>
        <span className="len">Length</span>
        <span>Lyrics alongside</span>
      </div>

      {!state ? (
        loading && <Loading>Reading the folder…</Loading>
      ) : state.error ? (
        <FolderError dir={state.dir} error={state.error} />
      ) : !listing ? null : listing.entries.length === 0 ? (
        <EmptyState icon={<Icon.Folder size={32} />} title="Nothing to open here">
          This folder has no audio files or subfolders.
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState icon={<Icon.Search size={28} />} title={`Nothing matches “${filter}”`}>
          Press <kbd>Esc</kbd> to clear the filter.
        </EmptyState>
      ) : (
        <div
          ref={listRef}
          className={loading ? "open-list stale" : "open-list"}
          role="listbox"
          aria-label="Files"
          aria-activedescendant={selected ? rowId(selected) : undefined}
        >
          {visible.map((entry) => (
            <Row key={entry.path} entry={entry} selected={entry.path === selected} onSelect={onSelect} onActivate={onActivate} />
          ))}
        </div>
      )}
    </main>
  );
});

/** For a folder that couldn't be listed: its parent and itself. */
function fallbackCrumbs(dir: string): DirListing["crumbs"] {
  const parent = parentDir(dir);
  const self = { name: baseName(dir), path: dir };
  return dir === "/" ? [self] : [{ name: baseName(parent), path: parent }, self];
}

/** Long paths keep their first crumb and the last three; "…" stands for the rest and goes to the one before them. */
function visibleCrumbs(crumbs: DirListing["crumbs"]): DirListing["crumbs"] {
  if (crumbs.length <= 4) return crumbs;
  const skipped = crumbs[crumbs.length - 4]!;
  return [crumbs[0]!, { name: "…", path: skipped.path }, ...crumbs.slice(-3)];
}

function CrumbLink({ name, path }: { name: string; path: string }) {
  return (
    <>
      <a
        href={`#/open?dir=${encodeURIComponent(path)}`}
        title={path}
        onClick={(e) => {
          e.preventDefault();
          goToOpen(path);
        }}
      >
        {name}
      </a>
      {name !== "/" && <span className="sep">/</span>}
    </>
  );
}

function rowId(path: string): string {
  return `open-row-${encodeURIComponent(path)}`;
}

function Row({
  entry,
  selected,
  onSelect,
  onActivate,
}: {
  entry: DirEntry;
  selected: boolean;
  onSelect: (path: string) => void;
  onActivate: (entry: DirEntry) => void;
}) {
  const common = {
    id: rowId(entry.path),
    role: "option",
    "aria-selected": selected,
    "data-path": entry.path,
    "data-open-row": "",
    tabIndex: -1,
    title: entry.name,
  } as const;

  if (entry.kind === "dir") {
    return (
      <button type="button" className="open-row dir" {...common} onClick={() => onActivate(entry)}>
        <span className="name">
          <Icon.Folder />
          <span className="ellipsis">{entry.name}</span>
        </span>
        <span />
        <span />
      </button>
    );
  }
  return (
    <button type="button" className="open-row audio" {...common} onClick={() => onSelect(entry.path)} onDoubleClick={() => onActivate(entry)}>
      <span className="name">
        <Icon.AudioFile />
        <span className="ellipsis">{entry.name}</span>
      </span>
      <span className="len">{entry.durationMs == null ? "" : shortClock(entry.durationMs)}</span>
      <span className={entry.lyrics ? "lyr has" : "lyr"}>
        {entry.lyrics && <Icon.LyricsFile size={16} />}
        <span className="ellipsis">{lyricsLabel(entry.lyrics)}</span>
      </span>
    </button>
  );
}

function FolderError({ dir, error }: { dir: string; error: { status: number; message: string } }) {
  const missing = error.status === 404;
  const parent = parentDir(dir);
  return (
    <EmptyState
      icon={<Icon.Warning size={30} style={{ color: "var(--warn)" }} />}
      title={missing ? "This folder isn't there" : "Can't open this folder"}
      actions={
        dir !== "/" && (
          <Button variant="secondary" onClick={() => goToOpen(parent)}>
            Go up to {baseName(parent)}
          </Button>
        )
      }
    >
      <span className="open-error">{error.message}</span>
    </EmptyState>
  );
}
