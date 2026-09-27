// 2 · Get lyrics (Text board): paste, search LRCLIB, load a file, or transcribe (the Recognize view,
// route param `transcribe=1`); once there are lyrics, sync them to the vocals (the same view, `sync=1`). Whatever is used goes through core `replaceLyrics`, so timings already set
// are kept for lines that still match.
// Keys: Ctrl V paste · Ctrl F search · Ctrl O load a file · ↑/↓ pick a result · Enter use it (Ctrl Enter in the text box).

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { LrclibResult } from "../../../shared/api";
import { Kbd } from "../../components/controls";
import { Icon } from "../../components/icons";
import { isTypingTarget, useHotkeys } from "../../hotkeys/hotkeys";
import { plural } from "../../lib/format";
import { goToStep, runningJob, startJob, toastError, useApp, useDoc, useRunningJob, useSettings, useStep, useTrack } from "../../state";
import { applyLyrics } from "./apply";
import { lyricLineCount, parseLyricsText } from "./lyrics-text";
import { PreviewPanel, primaryUse, type PreviewContent } from "./PreviewPanel";
import { RecognizeView } from "./RecognizeView";
import { resultLyrics, sortResults } from "./search-results";
import { SearchPane, useLrclibSearch } from "./SearchPane";
import { TextPane, type LyricsText } from "./TextPane";
import "./lyrics.css";

export function LyricsScreen() {
  const params = useStep()?.params ?? {};
  if (params.transcribe === "1") return <RecognizeView kind="transcribe" />;
  if (params.sync === "1") return <RecognizeView kind="align" />;
  return <LyricsSources />;
}

type Source = "paste" | "search" | "file";

const DB_NOTE = "Database timings are a starting point: on the next step you can re-tap or nudge them.";
const TEXT_NOTE = "These timings are a starting point: on the next step you can re-tap or nudge them.";

function searchPreview(r: LrclibResult): PreviewContent {
  return {
    title: `${r.artistName} — ${r.trackName}`,
    source: "contributed by a database user",
    ...resultLyrics(r),
    empty: r.instrumental ? { title: "Instrumental — no lyrics", text: "The database lists this recording as instrumental." } : undefined,
    timingNote: DB_NOTE,
  };
}

function textPreview(text: LyricsText): PreviewContent {
  const lrc = text.origin === "file" && /\.lrc$/i.test(text.name ?? "");
  return {
    title: text.origin === "file" ? (text.name ?? "File") : "Pasted from the clipboard",
    ...parseLyricsText(text.content, { lrc }),
    timingNote: TEXT_NOTE,
  };
}

/** Enter on a focused button (a source card, "Use lyrics only") clicks it instead of using the preview. */
function isOtherControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target.closest("[data-lyrics-row]")) return false;
  return target.closest("button, a[href]") !== null;
}

function LyricsSources() {
  const doc = useDoc();
  const track = useTrack();
  const app = useApp();
  const settings = useSettings();
  const transcribing = useRunningJob("transcribe");
  const syncing = useRunningJob("align");
  const trackMs = track?.durationMs ?? null;

  const [source, setSource] = useState<Source>("search");
  const [artist, setArtist] = useState(() => doc.metadata.artist || track?.artist || "");
  const [title, setTitle] = useState(() => doc.metadata.title || track?.title || "");
  const [filledFrom, setFilledFrom] = useState<"tags" | "song info" | null>(() =>
    (doc.metadata.artist ?? null) === (track?.artist ?? null) && (doc.metadata.title ?? track?.title) === track?.title ? "tags" : "song info",
  );
  const [pasted, setPasted] = useState<LyricsText | null>(null);
  const [loaded, setLoaded] = useState<LyricsText | null>(null);
  const [starting, setStarting] = useState(false);
  const [typing, setTyping] = useState(false);
  const artistRef = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const { state: search, search: runSearch } = useLrclibSearch();
  const results = useMemo(() => sortResults(search.results, trackMs), [search.results, trackMs]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  useEffect(() => setSelectedId(results[0]?.id ?? null), [results]);
  const selected = results.find((r) => r.id === selectedId) ?? null;

  const doSearch = () => {
    if (title.trim()) runSearch(artist, title);
  };
  // Search right away when the tags give both fields.
  useEffect(() => {
    if (artist.trim() && title.trim()) runSearch(artist, title);
  }, []);

  const text = source === "paste" ? pasted : source === "file" ? loaded : null;
  const preview = useMemo(() => {
    if (source === "search") return selected && searchPreview(selected);
    return text && textPreview(text);
  }, [source, selected, text]);

  const applyCurrent = () => {
    if (!preview || preview.empty) return;
    applyLyrics(primaryUse(preview).lines);
  };

  const pasteFromClipboard = async () => {
    setSource("paste");
    try {
      const content = await navigator.clipboard.readText();
      if (content.trim()) setPasted({ origin: "clipboard", name: null, content, problem: null });
      else setPasted((p) => (p?.content.trim() ? p : { origin: "clipboard", name: null, content: "", problem: "empty" }));
    } catch {
      setPasted((p) => (p?.content.trim() ? p : { origin: "clipboard", name: null, content: "", problem: "denied" }));
    }
  };

  const pickFile = () => fileInput.current?.click();
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setLoaded({ origin: "file", name: file.name, content: await file.text(), problem: null });
      setSource("file");
    } catch (err) {
      toastError("Couldn't read the file", err);
    }
  };

  const transcribe = async () => {
    if (app?.capabilities.uv && settings?.transcription.apiKey && !runningJob("transcribe")) {
      setStarting(true);
      await startJob("transcribe");
    }
    goToStep("lyrics", { transcribe: "1" });
  };

  const syncLyrics = async () => {
    if (app?.capabilities.uv && lyricLineCount(doc.lines) > 0 && !runningJob("align")) {
      setStarting(true);
      await startJob("align");
    }
    goToStep("lyrics", { sync: "1" });
  };

  // Ctrl V anywhere on the screen: the paste event carries the text without asking for clipboard permission.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target) || (e.target instanceof Element && e.target.closest(".modal-backdrop"))) return;
      const content = e.clipboardData?.getData("text/plain") ?? "";
      if (!content.trim()) return;
      e.preventDefault();
      setPasted({ origin: "clipboard", name: null, content, problem: null });
      setSource("paste");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const moveResult = (delta: number) => {
    if (source !== "search" || results.length === 0) return false;
    const i = results.findIndex((r) => r.id === selectedId);
    const next = results[Math.min(results.length - 1, Math.max(0, i === -1 ? 0 : i + delta))];
    if (next) setSelectedId(next.id);
  };

  useHotkeys({
    "Ctrl+F": {
      run: () => {
        setSource("search");
        requestAnimationFrame(() => {
          artistRef.current?.focus();
          artistRef.current?.select();
        });
      },
      inInputs: true,
    },
    "Ctrl+O": { run: pickFile, inInputs: true },
    ArrowDown: { run: () => moveResult(1), inInputs: true },
    ArrowUp: { run: () => moveResult(-1), inInputs: true },
    Enter: {
      run: (e) => {
        if (isOtherControl(e.target)) return false;
        applyCurrent();
      },
      repeat: false,
    },
    "Ctrl+Enter": { run: applyCurrent, inInputs: true, repeat: false },
  });

  const existing = lyricLineCount(doc.lines);

  return (
    <div className="lyrics-screen">
      <aside className="lyrics-sources">
        <h1>Where are the lyrics?</h1>
        <SourceCard
          pressed={source === "paste"}
          icon={<ClipboardIcon />}
          title="Paste from clipboard"
          kbd="Ctrl+V"
          onClick={() => void pasteFromClipboard()}
        >
          Split into lines at line breaks. You add the timings.
        </SourceCard>
        <SourceCard pressed={source === "search"} icon={<Icon.Search size={22} strokeWidth={1.9} />} title="Search the open database" kbd="Ctrl+F" onClick={() => setSource("search")}>
          By artist and title. Sometimes with line timings already.
        </SourceCard>
        <SourceCard
          pressed={source === "file"}
          icon={<Icon.LyricsFile size={22} strokeWidth={1.7} />}
          title="Load a file"
          kbd="Ctrl+O"
          onClick={() => (loaded && source !== "file" ? setSource("file") : pickFile())}
        >
          TXT or LRC from disk.
        </SourceCard>
        <SourceCard pressed={false} icon={<WaveIcon />} title="Transcribe automatically" onClick={() => void transcribe()} disabled={starting}>
          {transcribing ? "Running now — open it to see how far it got." : "Comes with line and word timings. Slow: a minute to several."}
        </SourceCard>
        {(existing > 0 || syncing) && (
          <SourceCard pressed={false} icon={<SyncIcon />} title="Sync my lyrics" onClick={() => void syncLyrics()} disabled={starting}>
            {syncing
              ? "Running now — open it to see how far it got."
              : `Line and word timings for the ${plural(existing, "line")} you have. No API key needed.`}
          </SourceCard>
        )}
        <input ref={fileInput} type="file" accept=".lrc,.txt" hidden onChange={(e) => void onFile(e)} />
        <div style={{ flexGrow: 1 }} />
        <p className="note">You can swap the lyrics later — timings you've already set are kept for lines that still match.</p>
      </aside>

      <main className="lyrics-main">
        {existing > 0 && (
          <div className="lyrics-existing">
            <Icon.Info size={16} />
            This song has {plural(existing, "line")} already — new lyrics keep the timings of lines that match.
          </div>
        )}
        {source === "search" ? (
          <SearchPane
            ref={artistRef}
            artist={artist}
            title={title}
            onArtist={(v) => {
              setArtist(v);
              setFilledFrom(null);
            }}
            onTitle={(v) => {
              setTitle(v);
              setFilledFrom(null);
            }}
            onSearch={doSearch}
            state={search}
            results={results}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onUse={(id) => {
              const r = results.find((x) => x.id === id);
              if (r && !r.instrumental) applyLyrics(primaryUse(searchPreview(r)).lines);
            }}
            trackMs={trackMs}
            filledFrom={filledFrom}
          />
        ) : (
          <TextPane
            key={source}
            text={text ?? { origin: source === "file" ? "file" : "clipboard", name: null, content: "", problem: null }}
            onChange={(content) =>
              (source === "file" ? setLoaded : setPasted)((t) => ({ origin: "clipboard", name: null, ...t, content, problem: null }))
            }
            onPickFile={pickFile}
            onFocusChange={setTyping}
          />
        )}
      </main>

      <PreviewPanel content={preview} onUse={applyLyrics} primaryKey={typing ? "Ctrl+Enter" : "Enter"} />
    </div>
  );
}

function SourceCard({
  pressed,
  icon,
  title,
  kbd,
  onClick,
  disabled,
  children,
}: {
  pressed: boolean;
  icon: ReactNode;
  title: string;
  kbd?: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" className="lyrics-card" aria-pressed={pressed} onClick={onClick} disabled={disabled}>
      {icon}
      <span className="body">
        <span className="title">
          {title}
          {kbd && <Kbd keys={kbd} />}
        </span>
        <span className="desc">{children}</span>
      </span>
    </button>
  );
}

function ClipboardIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4V2.5h6V4" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2" />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h10M4 12h7M4 18h10M17 9v6M20 11v2" />
    </svg>
  );
}
