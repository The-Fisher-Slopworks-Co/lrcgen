// Searching LRCLIB ("the open database"): artist/title fields, results matched against the track's length.

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import type { LrclibResult } from "../../../shared/api";
import * as api from "../../api/client";
import { errorMessage } from "../../api/client";
import { Button, KeyHint } from "../../components/controls";
import { EmptyState, Loading } from "../../components/feedback";
import { Icon } from "../../components/icons";
import { plural, shortClock } from "../../lib/format";
import { describeResult } from "./search-results";

export interface SearchState {
  status: "idle" | "loading" | "done" | "error";
  results: LrclibResult[];
  error: string | null;
}

// Results for this session, so coming back to the step doesn't ask LRCLIB again.
const cache = new Map<string, LrclibResult[]>();

export function useLrclibSearch(): { state: SearchState; search: (artist: string, title: string) => void } {
  const [state, setState] = useState<SearchState>({ status: "idle", results: [], error: null });
  const seq = useRef(0);
  const search = useCallback((artist: string, title: string) => {
    const query = { artist: artist.trim(), title: title.trim() };
    const key = `${query.artist}\n${query.title}`;
    const id = ++seq.current;
    const cached = cache.get(key);
    if (cached) {
      setState({ status: "done", results: cached, error: null });
      return;
    }
    setState((s) => ({ ...s, status: "loading", error: null }));
    api.searchLrclib(query).then(
      (results) => {
        cache.set(key, results);
        if (id === seq.current) setState({ status: "done", results, error: null });
      },
      (err) => {
        if (id === seq.current) setState({ status: "error", results: [], error: errorMessage(err) });
      },
    );
  }, []);
  useEffect(
    () => () => {
      seq.current++;
    },
    [],
  );
  return { state, search };
}

interface SearchPaneProps {
  artist: string;
  title: string;
  onArtist: (v: string) => void;
  onTitle: (v: string) => void;
  onSearch: () => void;
  state: SearchState;
  results: LrclibResult[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onUse: (id: number) => void;
  trackMs: number | null;
  /** Where the fields came from, until the user edits them. */
  filledFrom: "tags" | "song info" | null;
}

export const SearchPane = forwardRef<HTMLInputElement, SearchPaneProps>(function SearchPane(props, artistRef) {
  const { artist, title, state, results, selectedId, trackMs } = props;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedId == null) return;
    listRef.current?.querySelector(`[data-result="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <>
      <form
        className="lyrics-form"
        onSubmit={(e) => {
          e.preventDefault();
          props.onSearch();
        }}
      >
        <label>
          Artist
          <input ref={artistRef} className="lyrics-input" value={artist} onChange={(e) => props.onArtist(e.target.value)} spellCheck={false} />
        </label>
        <label>
          Title
          <input className="lyrics-input" value={title} onChange={(e) => props.onTitle(e.target.value)} spellCheck={false} />
        </label>
        <Button variant="primary" type="submit" className="lyrics-search-btn" disabled={!title.trim()}>
          Search
        </Button>
      </form>
      {(props.filledFrom || trackMs != null) && (
        <p className="lyrics-hint">
          {props.filledFrom === "tags" ? "Filled in from the file's tags. " : props.filledFrom ? "Filled in from the song info. " : ""}
          {trackMs != null && (
            <>
              Track length is <span className="mono">{shortClock(trackMs)}</span> — results are matched against it.
            </>
          )}
        </p>
      )}

      {state.status === "loading" ? (
        <Loading>Searching the open database…</Loading>
      ) : state.status === "error" ? (
        <EmptyState
          icon={<Icon.Warning size={30} style={{ color: "var(--warn)" }} />}
          title="Lyrics search failed"
          actions={
            <Button variant="secondary" onClick={props.onSearch}>
              Try again
            </Button>
          }
        >
          {state.error}
        </EmptyState>
      ) : state.status === "idle" ? (
        <EmptyState icon={<Icon.Search size={28} />} title="Search by artist and title">
          The open database (LRCLIB) often has the lyrics, sometimes with line timings. The title is enough to start.
        </EmptyState>
      ) : results.length === 0 ? (
        <EmptyState icon={<Icon.Search size={28} />} title="No matches — try fewer words">
          Drop “feat.” parts, remixes and brackets from the title, or search by the title alone.
        </EmptyState>
      ) : (
        <>
          <div className="lyrics-results-head">
            <h2>{plural(results.length, "result")}</h2>
            <KeyHint keys={["ArrowUp", "ArrowDown"]}>select</KeyHint>
          </div>
          <div ref={listRef} className="lyrics-results" role="listbox" aria-label="Results">
            {results.map((r) => (
              <ResultRow
                key={r.id}
                result={r}
                trackMs={trackMs}
                selected={r.id === selectedId}
                onSelect={() => props.onSelect(r.id)}
                onUse={() => props.onUse(r.id)}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
});

function ResultRow({
  result,
  trackMs,
  selected,
  onSelect,
  onUse,
}: {
  result: LrclibResult;
  trackMs: number | null;
  selected: boolean;
  onSelect: () => void;
  onUse: () => void;
}) {
  const view = describeResult(result, trackMs);
  const matches = view.match?.matches ?? true;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      className="lyrics-result"
      data-result={result.id}
      data-lyrics-row=""
      onClick={onSelect}
      onDoubleClick={onUse}
    >
      <span className="what">
        <span className="name ellipsis">{view.title}</span>
        <span className="meta ellipsis">{view.meta}</span>
      </span>
      <span className={matches ? "length matches" : "length"}>
        <span className="mono">{view.duration}</span>
        {view.match && <span className="note">{view.match.label}</span>}
      </span>
      <span className="badges">
        <span className={view.badge === "line timings" ? "lyrics-badge synced" : "lyrics-badge"}>{view.badge}</span>
      </span>
    </button>
  );
}
