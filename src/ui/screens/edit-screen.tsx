import { useState, useEffect, useRef } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import type { Registry } from "../../registry";
import type { LrcDocument } from "../../core/lrc-document";
import type { AudioRef } from "../../ports/audio-source";
import type { AudioPlayer } from "../../ports/audio-player";
import type { LyricsProvider } from "../../ports/lyrics-provider";
import type { Transcriber, TranscribeProgressEvent } from "../../ports/transcriber";
import {
  setTimestamp, setLineText, addLines, linesFromText, setMetadata, insertLine, removeLine,
  setWordStart, wordsOf, hasWordTimings, lineEnd,
} from "../../core/lrc-document";
import { lrcToMs, msToLrc, LRC_TIME_PATTERN } from "../../core/time-utils";
import { resolveTranscriptionSettings } from "../../core/settings-defaults";
import { enhancedLrcPath } from "../../core/enhanced-lrc";
import { LocalAudioSource } from "../../adapters/audio-source/local-audio-source";
import { readLrcFile, writeLrcFiles } from "../../adapters/lrc-files";
import { ProgressBar } from "../components/progress-bar";
import { LineList, timeLabel } from "../components/line-list";
import { WordLine } from "../components/word-line";
import { KeyHints } from "../components/key-hints";
import { FilePicker } from "../components/file-picker";
import { SettingsScreen } from "./settings-screen";
import { SyncEngine } from "../../core/sync-engine";
import { WordSyncEngine } from "../../core/word-sync-engine";
import path from "node:path";

interface EditorScreenProps {
  registry: Registry;
  document: LrcDocument;
  audioRef: AudioRef | null;
  player: AudioPlayer | null;
  onDocumentChange: (doc: LrcDocument) => void;
  onAudioRefChange: (ref: AudioRef) => Promise<void>;
  onQuit: () => void;
}

type Mode =
  | "edit"
  | "sync"
  | "words"
  | "sync-words"
  | "play"
  | "file-picker-audio"
  | "file-picker-lyrics"
  | "inline-edit-text"
  | "inline-edit-time"
  | "text-input-metadata"
  | "text-input-save"
  | "confirm-lrc"
  | "confirm-transcribe"
  | "transcribing"
  | "settings"
  | "publish-select"
  | "publishing"
  | "lyrics-source";

type LyricsSourceItem =
  | { label: string; type: "provider"; provider: LyricsProvider }
  | { label: string; type: "transcribe"; transcriber: Transcriber }
  | { label: string; type: "file" };

const STEP_OPTIONS = [10, 50, 100, 200, 500, 1000];
const SPEED_OPTIONS = [0.5, 0.75, 1];
const SPEED_MODES: Mode[] = ["edit", "words", "sync", "sync-words", "play"];
// Word sync starts a little before the line so the first word can be caught.
const WORD_SYNC_PRE_ROLL_MS = 2000;
const AUDIO_EXTENSIONS = [".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac", ".wma"];
const LRC_LINE_RE = new RegExp(`^\\[${LRC_TIME_PATTERN}\\]`, "m");

export function EditorScreen({
  registry,
  document,
  audioRef,
  player,
  onDocumentChange,
  onAudioRefChange,
  onQuit,
}: EditorScreenProps) {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout?.rows ?? 24);

  const [mode, setMode] = useState<Mode>("edit");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(2);
  const [positionMs, setPositionMs] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [metadataField, setMetadataField] = useState<"artist" | "title" | "album">("artist");
  const [syncEngine, setSyncEngine] = useState<SyncEngine | null>(null);
  const [wordSyncEngine, setWordSyncEngine] = useState<WordSyncEngine | null>(null);
  const [wordIndex, setWordIndex] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);
  const [paused, setPaused] = useState(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [savePath, setSavePath] = useState("");
  const [publishIndex, setPublishIndex] = useState(0);
  const [publishStatus, setPublishStatus] = useState("");
  const [foundLrcPath, setFoundLrcPath] = useState("");
  const [timeDigits, setTimeDigits] = useState("000000");
  const [timeCursorPos, setTimeCursorPos] = useState(0);
  const [editText, setEditText] = useState("");
  const [textCursorPos, setTextCursorPos] = useState(0);
  const [transcribeProgress, setTranscribeProgress] = useState<TranscribeProgressEvent | null>(null);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [availableTranscribers, setAvailableTranscribers] = useState<Transcriber[]>([]);
  const transcribeControllerRef = useRef<AbortController | null>(null);

  const step = STEP_OPTIONS[stepIndex]!;
  const currentLine = document.lines[currentIndex];
  const hasPlayer = player !== null;
  const canChangeSpeed = typeof player?.setSpeed === "function";
  const markWords = document.lines.some(hasWordTimings);

  // Track terminal resize
  useEffect(() => {
    const onResize = () => setRows(stdout?.rows ?? 24);
    stdout?.on("resize", onResize);
    return () => { stdout?.off("resize", onResize); };
  }, [stdout]);

  // Track player position
  useEffect(() => {
    if (!player) return;
    const unsub = player.onPosition((ms) => setPositionMs(ms));
    return unsub;
  }, [player]);

  useEffect(() => {
    player?.setSpeed?.(speed);
  }, [player, speed]);

  // Resolve which transcribers can actually run (gates the auto-suggest flow)
  useEffect(() => {
    let cancelled = false;
    Promise.all(registry.transcribers.map(async (t) => ((await t.isAvailable()) ? t : null))).then((checked) => {
      if (!cancelled) setAvailableTranscribers(checked.filter((t): t is Transcriber => t !== null));
    });
    return () => { cancelled = true; };
  }, [registry.transcribers]);

  // Calculate visible lines: total rows - header (3) - footer (2) - margins (2)
  const lineListHeight = Math.max(3, rows - 7);

  // Mode-specific key hints
  function getHints() {
    const speedHint = canChangeSpeed ? [{ key: "-+", label: "speed" }] : [];
    switch (mode) {
      case "edit":
        return [
          { key: "←→", label: `±${step}ms` },
          { key: "⏎", label: "play line" },
          { key: "o", label: "insert" },
          { key: "d", label: "delete" },
          { key: "e", label: "edit" },
          { key: "t", label: "time" },
          { key: "w", label: "words" },
          { key: "a", label: "audio" },
          { key: "l", label: "lyrics" },
          { key: "m", label: "metadata" },
          { key: "y", label: "sync" },
          { key: "Y", label: "sync words" },
          { key: "p", label: "play" },
          { key: "s", label: "save" },
          { key: "u", label: "publish" },
          { key: "S", label: "settings" },
          { key: "q", label: "quit" },
        ];
      case "sync":
        return [
          { key: "␣", label: "mark" },
          { key: "⏎", label: "skip" },
          { key: "⌫", label: "undo" },
          ...speedHint,
          { key: "Esc", label: "stop" },
        ];
      case "sync-words":
        return [
          { key: "␣", label: "mark word" },
          { key: "⏎", label: "skip word" },
          { key: "⌫", label: "undo" },
          ...speedHint,
          { key: "Esc", label: "stop" },
        ];
      case "words":
        return [
          { key: "←→", label: "select word" },
          { key: ",.", label: `±${step}ms` },
          { key: "⏎", label: "play word" },
          { key: "␣", label: "play line" },
          { key: "↑↓", label: "line" },
          ...speedHint,
          { key: "Esc", label: "back" },
        ];
      case "play":
        return [
          { key: "␣", label: paused ? "resume" : "pause" },
          ...speedHint,
          { key: "Esc", label: "stop" },
        ];
      default:
        return [];
    }
  }

  // --- Input handling per mode ---
  useInput((input, key) => {
    if (status) setStatus(null);
    if (SPEED_MODES.includes(mode) && canChangeSpeed && (input === "-" || input === "+" || input === "=")) {
      const i = SPEED_OPTIONS.indexOf(speed);
      const next = input === "-" ? Math.max(0, i - 1) : Math.min(SPEED_OPTIONS.length - 1, i + 1);
      setSpeed(SPEED_OPTIONS[next]!);
      return;
    }

    if (mode === "edit") {
      handleEditInput(input, key);
    } else if (mode === "sync") {
      handleSyncInput(input, key);
    } else if (mode === "sync-words") {
      handleWordSyncInput(input, key);
    } else if (mode === "words") {
      handleWordsInput(input, key);
    } else if (mode === "play") {
      handlePlayInput(input, key);
    } else if (mode === "lyrics-source") {
      handleLyricsSourceInput(input, key);
    } else if (mode === "inline-edit-time") {
      handleInlineTimeInput(input, key);
    } else if (mode === "inline-edit-text") {
      handleInlineTextInput(input, key);
    } else if (mode === "confirm-lrc") {
      if (input === "y") {
        readLrcFile(foundLrcPath, registry.lrcParser).then((parsed) => {
          onDocumentChange({ ...document, lines: parsed.lines, metadata: { ...document.metadata, ...parsed.metadata, tool: document.metadata.tool } });
          setMode("edit");
        });
      } else if (input === "n" || key.escape) {
        setMode("edit");
      }
    } else if (mode === "confirm-transcribe") {
      if (input === "y" && availableTranscribers.length > 0) {
        startTranscription(availableTranscribers[0]!);
      } else if (input === "n" || key.escape) {
        setMode("edit");
      }
    } else if (mode === "transcribing") {
      if (key.escape) {
        transcribeControllerRef.current?.abort();
        transcribeControllerRef.current = null;
        setMode("edit");
      }
    } else if (mode === "publish-select") {
      handlePublishSelectInput(input, key);
    }
  });

  function handleEditInput(input: string, key: any) {
    if (key.upArrow) {
      setCurrentIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setCurrentIndex((i) => Math.min(document.lines.length - 1, i + 1));
    } else if (key.leftArrow && currentLine?.timestamp != null) {
      onDocumentChange(setTimestamp(document, currentIndex, Math.max(0, currentLine.timestamp - step)));
    } else if (key.rightArrow && currentLine?.timestamp != null) {
      onDocumentChange(setTimestamp(document, currentIndex, currentLine.timestamp + step));
    } else if (key.return && currentLine?.timestamp != null && hasPlayer) {
      const nextLine = document.lines[currentIndex + 1];
      const endMs = nextLine?.timestamp ?? (currentLine.timestamp! + 5000);
      player!.playSegment(currentLine.timestamp!, endMs);
    } else if (input === "o") {
      onDocumentChange(insertLine(document, currentIndex));
      setCurrentIndex(currentIndex + 1);
    } else if (input === "d" && document.lines.length > 0) {
      onDocumentChange(removeLine(document, currentIndex));
      setCurrentIndex(Math.min(currentIndex, document.lines.length - 2));
    } else if (input === "e" && currentLine) {
      setEditText(currentLine.text);
      setTextCursorPos(currentLine.text.length);
      setMode("inline-edit-text");
    } else if (input === "t") {
      const ts = currentLine?.timestamp ?? 0;
      const lrc = msToLrc(ts);
      setTimeDigits(lrc.replace(/[:\.]/g, ""));
      setTimeCursorPos(0);
      setMode("inline-edit-time");
    } else if (input === "a") {
      setMode("file-picker-audio");
    } else if (input === "l") {
      setSourceIndex(0);
      setMode("lyrics-source");
    } else if (input === "m") {
      setMetadataField("artist");
      setInputValue(document.metadata.artist ?? "");
      setMode("text-input-metadata");
    } else if (input === "y" && hasPlayer) {
      const engine = new SyncEngine(document);
      for (let i = 0; i < currentIndex; i++) {
        if (document.lines[i]?.timestamp != null) {
          engine.mark(document.lines[i]!.timestamp!);
        } else {
          engine.skip();
        }
      }
      setSyncEngine(engine);
      const startMs = currentLine?.timestamp ?? 0;
      player!.play(startMs);
      setMode("sync");
    } else if (input === "Y" && hasPlayer) {
      const engine = new WordSyncEngine(document, currentIndex);
      if (engine.isComplete) return;
      setWordSyncEngine(engine);
      setCurrentIndex(engine.lineIndex);
      setWordIndex(engine.wordIndex);
      player!.play(preRollStart(engine.lineIndex));
      setMode("sync-words");
    } else if (input === "w" && currentLine && wordsOf(currentLine).length > 0) {
      setWordIndex(0);
      setMode("words");
    } else if (input === "p" && hasPlayer) {
      const startMs = currentLine?.timestamp ?? 0;
      player!.play(startMs);
      setPaused(false);
      setMode("play");
    } else if (input === "s") {
      const defaultPath = audioRef
        ? audioRef.id.replace(/\.[^.]+$/, ".lrc")
        : path.join(process.cwd(), "output.lrc");
      setSavePath(defaultPath);
      setMode("text-input-save");
    } else if (input === "u") {
      setPublishIndex(0);
      setPublishStatus("");
      setMode("publish-select");
    } else if (input === "S") {
      setMode("settings");
    } else if (input === "[") {
      setStepIndex((i) => Math.max(0, i - 1));
    } else if (input === "]") {
      setStepIndex((i) => Math.min(STEP_OPTIONS.length - 1, i + 1));
    } else if (input === "q") {
      player?.dispose();
      onQuit();
    }
  }

  function handleSyncInput(input: string, key: any) {
    if (!syncEngine || !player) return;
    if (input === " ") {
      syncEngine.mark(player.getCurrentPosition());
      onDocumentChange(syncEngine.document);
      setCurrentIndex(syncEngine.currentIndex);
      if (syncEngine.isComplete) {
        player.pause();
        setMode("edit");
        setSyncEngine(null);
      }
    } else if (key.return) {
      syncEngine.skip();
      onDocumentChange(syncEngine.document);
      setCurrentIndex(syncEngine.currentIndex);
      if (syncEngine.isComplete) {
        player.pause();
        setMode("edit");
        setSyncEngine(null);
      }
    } else if (key.backspace || key.delete) {
      syncEngine.undo();
      onDocumentChange(syncEngine.document);
      setCurrentIndex(syncEngine.currentIndex);
    } else if (key.escape) {
      player.pause();
      onDocumentChange(syncEngine.document);
      setMode("edit");
      setSyncEngine(null);
    }
  }

  function preRollStart(lineIndex: number): number {
    for (let i = lineIndex; i >= 0; i--) {
      const ts = document.lines[i]?.timestamp;
      if (ts != null) return Math.max(0, ts - WORD_SYNC_PRE_ROLL_MS);
    }
    return 0;
  }

  function nextTimestampAfter(lineIndex: number): number | null {
    return document.lines.slice(lineIndex + 1).find((l) => l.timestamp !== null)?.timestamp ?? null;
  }

  // The karaoke highlight only makes sense while playback is inside the line.
  function positionInLine(lineIndex: number): number | undefined {
    const line = document.lines[lineIndex];
    if (!line) return undefined;
    const start = line.timestamp ?? wordsOf(line).find((w) => w.start !== null)?.start ?? null;
    if (start === null || positionMs < start) return undefined;
    const next = nextTimestampAfter(lineIndex);
    return next === null || positionMs < next ? positionMs : undefined;
  }

  function handleWordSyncInput(input: string, key: any) {
    if (!wordSyncEngine || !player) return;
    const engine = wordSyncEngine;
    if (input === " ") {
      engine.mark(player.getCurrentPosition());
    } else if (key.return) {
      engine.skip();
    } else if (key.backspace || key.delete) {
      engine.undo();
    } else if (key.escape) {
      player.pause();
      onDocumentChange(engine.document);
      setMode("edit");
      setWordSyncEngine(null);
      return;
    } else {
      return;
    }
    onDocumentChange(engine.document);
    if (engine.isComplete) {
      player.pause();
      setCurrentIndex(Math.max(0, engine.document.lines.length - 1));
      setMode("edit");
      setWordSyncEngine(null);
    } else {
      setCurrentIndex(engine.lineIndex);
      setWordIndex(engine.wordIndex);
    }
  }

  function handleWordsInput(input: string, key: any) {
    if (!currentLine) {
      setMode("edit");
      return;
    }
    const words = wordsOf(currentLine);
    const word = words[wordIndex];
    if (key.escape) {
      setMode("edit");
    } else if (key.leftArrow) {
      setWordIndex((i) => Math.max(0, i - 1));
    } else if (key.rightArrow) {
      setWordIndex((i) => Math.min(words.length - 1, i + 1));
    } else if (key.upArrow || key.downArrow) {
      const next = key.upArrow ? currentIndex - 1 : currentIndex + 1;
      const line = document.lines[next];
      if (line && wordsOf(line).length > 0) {
        setCurrentIndex(next);
        setWordIndex(0);
      }
    } else if ((input === "," || input === ".") && word) {
      // An unsynced word starts from the word before it.
      const base = word.start
        ?? words.slice(0, wordIndex).reverse().find((w) => w.start !== null)?.start
        ?? currentLine.timestamp;
      if (base == null) return;
      const delta = input === "," ? -step : step;
      onDocumentChange(setWordStart(document, currentIndex, wordIndex, Math.max(0, base + delta)));
    } else if (input === "[") {
      setStepIndex((i) => Math.max(0, i - 1));
    } else if (input === "]") {
      setStepIndex((i) => Math.min(STEP_OPTIONS.length - 1, i + 1));
    } else if (key.return && hasPlayer && word?.start != null) {
      const nextStart = words.slice(wordIndex + 1).find((w) => w.start !== null)?.start
        ?? lineEnd(currentLine)
        ?? nextTimestampAfter(currentIndex);
      const endMs = nextStart != null && nextStart > word.start ? nextStart : word.start + 1000;
      player!.playSegment(word.start, endMs);
    } else if (input === " " && hasPlayer && currentLine.timestamp !== null) {
      const endMs = lineEnd(currentLine) ?? nextTimestampAfter(currentIndex) ?? currentLine.timestamp + 5000;
      player!.playSegment(currentLine.timestamp, endMs);
    }
  }

  function handlePlayInput(input: string, key: any) {
    if (!player) return;
    if (input === " ") {
      if (paused) {
        player.resume();
        setPaused(false);
      } else {
        player.pause();
        setPaused(true);
      }
    } else if (key.escape) {
      player.pause();
      setMode("edit");
    }
  }

  function buildLyricsSources(): LyricsSourceItem[] {
    const items: LyricsSourceItem[] = registry.lyricsProviders.map((p) => ({ label: p.name, type: "provider", provider: p }));
    if (audioRef) {
      for (const t of registry.transcribers) {
        items.push({ label: t.name, type: "transcribe", transcriber: t });
      }
    }
    items.push({ label: "Load from file", type: "file" });
    return items;
  }

  function startTranscription(transcriber: Transcriber) {
    if (!audioRef) return;
    const controller = new AbortController();
    transcribeControllerRef.current = controller;
    setTranscribeProgress(null);
    setTranscribeError(null);
    setMode("transcribing");

    registry.settingsStore
      .load()
      .then((stored) => {
        const settings = resolveTranscriptionSettings(stored.transcription, process.env);
        return transcriber.transcribe({
          audioPath: audioRef.id,
          settings,
          onProgress: (event) => {
            if (transcribeControllerRef.current === controller) setTranscribeProgress(event);
          },
          signal: controller.signal,
        });
      })
      .then((result) => {
        if (transcribeControllerRef.current !== controller) return;
        transcribeControllerRef.current = null;
        if (result.success && result.lines) {
          onDocumentChange({ ...document, lines: result.lines });
          setMode("edit");
        } else {
          setTranscribeError(result.error ?? "Unknown error");
        }
      })
      .catch((e) => {
        if (transcribeControllerRef.current !== controller) return;
        transcribeControllerRef.current = null;
        setTranscribeError(e instanceof Error ? e.message : String(e));
      });
  }

  function handleLyricsSourceInput(input: string, key: any) {
    const sources = buildLyricsSources();
    if (key.upArrow) {
      setSourceIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSourceIndex((i) => Math.min(sources.length - 1, i + 1));
    } else if (key.return) {
      const selected = sources[sourceIndex]!;
      if (selected.type === "file") {
        setMode("file-picker-lyrics");
      } else if (selected.type === "transcribe") {
        startTranscription(selected.transcriber);
      } else {
        selected.provider.fetch({ artist: document.metadata.artist, title: document.metadata.title }).then((text) => {
          if (text.trim()) {
            // If text looks like LRC (has timestamps), parse it
            if (LRC_LINE_RE.test(text)) {
              const parsed = registry.lrcParser.parse(text);
              onDocumentChange({ ...document, lines: parsed.lines });
            } else {
              onDocumentChange(addLines(document, linesFromText(text)));
            }
          }
          setMode("edit");
        });
      }
    } else if (key.escape || input === "q") {
      setMode("edit");
    }
  }

  function handleInlineTimeInput(input: string, key: any) {
    if (key.return) {
      // Apply: parse "012986" → "01:29.86" → ms
      const formatted = `${timeDigits[0]}${timeDigits[1]}:${timeDigits[2]}${timeDigits[3]}.${timeDigits[4]}${timeDigits[5]}`;
      const ms = lrcToMs(formatted);
      if (ms !== null) {
        onDocumentChange(setTimestamp(document, currentIndex, ms));
      }
      setMode("edit");
    } else if (key.escape) {
      setMode("edit");
    } else if (key.leftArrow) {
      setTimeCursorPos((p) => Math.max(0, p - 1));
    } else if (key.rightArrow) {
      setTimeCursorPos((p) => Math.min(5, p + 1));
    } else if (input >= "0" && input <= "9") {
      const digits = timeDigits.split("");
      digits[timeCursorPos] = input;
      setTimeDigits(digits.join(""));
      setTimeCursorPos((p) => Math.min(5, p + 1));
    }
  }

  function handleInlineTextInput(input: string, key: any) {
    if (key.return) {
      onDocumentChange(setLineText(document, currentIndex, editText));
      setMode("edit");
    } else if (key.escape) {
      setMode("edit");
    } else if (key.leftArrow) {
      setTextCursorPos((p) => Math.max(0, p - 1));
    } else if (key.rightArrow) {
      setTextCursorPos((p) => Math.min(editText.length, p + 1));
    } else if (key.backspace || key.delete) {
      if (textCursorPos > 0) {
        setEditText(editText.slice(0, textCursorPos - 1) + editText.slice(textCursorPos));
        setTextCursorPos((p) => p - 1);
      }
    } else if (input && !key.ctrl && !key.meta) {
      setEditText(editText.slice(0, textCursorPos) + input + editText.slice(textCursorPos));
      setTextCursorPos((p) => p + input.length);
    }
  }

  function handlePublishSelectInput(input: string, key: any) {
    const publishers = registry.lyricsPublishers;
    if (key.upArrow) {
      setPublishIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setPublishIndex((i) => Math.min(publishers.length - 1, i + 1));
    } else if (key.return) {
      const selected = publishers[publishIndex];
      if (!selected) return;
      const duration = player?.getDuration() ?? 0;
      setPublishStatus("Solving proof-of-work...");
      setMode("publishing");
      selected.publish(document, duration).then((result) => {
        if (result.success) {
          setPublishStatus("Published!");
        } else {
          setPublishStatus(`Error: ${result.error}`);
        }
        setTimeout(() => setMode("edit"), 2000);
      });
    } else if (key.escape || input === "q") {
      setMode("edit");
    }
  }

  // Auto-advance current line in play mode
  useEffect(() => {
    if (mode !== "play") return;
    let idx = 0;
    for (let i = 0; i < document.lines.length; i++) {
      const ts = document.lines[i]!.timestamp;
      if (ts !== null && ts <= positionMs) idx = i;
    }
    setCurrentIndex(idx);
  }, [positionMs, mode]);

  // --- Modal overlays ---
  if (mode === "file-picker-audio") {
    return (
      <FilePicker
        extensions={AUDIO_EXTENSIONS}
        onSelect={async (filePath) => {
          const source = registry.audioSources[0] as LocalAudioSource;
          const ref = source.selectFromPath(filePath);
          await onAudioRefChange(ref);
          // Check for matching .lrc file (or just its enhanced companion)
          const lrcPath = filePath.replace(/\.[^.]+$/, ".lrc");
          let found: string | null = null;
          for (const candidate of [lrcPath, enhancedLrcPath(lrcPath)]) {
            if (await Bun.file(candidate).exists()) {
              found = candidate;
              break;
            }
          }
          if (found) {
            setFoundLrcPath(found);
            setMode("confirm-lrc");
          } else if (document.lines.length === 0 && availableTranscribers.length > 0) {
            setMode("confirm-transcribe");
          } else {
            setMode("edit");
          }
        }}
        onCancel={() => setMode("edit")}
      />
    );
  }

  if (mode === "file-picker-lyrics") {
    return (
      <FilePicker
        extensions={[".txt", ".lrc"]}
        onSelect={async (filePath) => {
          try {
            const text = await Bun.file(filePath).text();
            if (text.trim()) {
              if (filePath.endsWith(".lrc") || LRC_LINE_RE.test(text)) {
                const parsed = filePath.endsWith(".lrc")
                  ? await readLrcFile(filePath, registry.lrcParser)
                  : registry.lrcParser.parse(text);
                onDocumentChange({ ...document, lines: parsed.lines, metadata: { ...document.metadata, ...parsed.metadata, tool: document.metadata.tool } });
              } else {
                onDocumentChange(addLines(document, linesFromText(text)));
              }
            }
          } catch {}
          setMode("edit");
        }}
        onCancel={() => setMode("edit")}
      />
    );
  }

  if (mode === "text-input-save") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>Save to:</Text>
        <TextInput value={savePath} onChange={setSavePath} onSubmit={async (value) => {
          try {
            const written = await writeLrcFiles(value, document, registry.lrcParser, registry.enhancedLrcParser);
            setStatus({ text: `Saved ${written.map((p) => path.basename(p)).join(" + ")}`, isError: false });
          } catch (e) {
            setStatus({ text: `Save failed: ${e instanceof Error ? e.message : String(e)}`, isError: true });
          }
          setMode("edit");
        }} />
      </Box>
    );
  }

  // text-input-edit and text-input-time are now inline modes (handled in main layout)

  if (mode === "text-input-metadata") {
    const fields: Array<"artist" | "title" | "album"> = ["artist", "title", "album"];
    return (
      <Box flexDirection="column" padding={1}>
        <Text>{metadataField.charAt(0).toUpperCase() + metadataField.slice(1)}:</Text>
        <TextInput value={inputValue} onChange={setInputValue} onSubmit={(value) => {
          onDocumentChange(setMetadata(document, { [metadataField]: value }));
          const idx = fields.indexOf(metadataField);
          if (idx < fields.length - 1) {
            const next = fields[idx + 1]!;
            setMetadataField(next);
            setInputValue(document.metadata[next] ?? "");
          } else {
            setMode("edit");
          }
        }} />
      </Box>
    );
  }

  if (mode === "settings") {
    return <SettingsScreen settingsStore={registry.settingsStore} onDone={() => setMode("edit")} />;
  }

  if (mode === "confirm-transcribe") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>No matching LRC file found.</Text>
        <Text>Transcribe lyrics from audio? (y/n)</Text>
        <Text dimColor>Uses the configured AI model via API — may incur cost.</Text>
      </Box>
    );
  }

  if (mode === "transcribing") {
    return (
      <Box flexDirection="column" padding={1}>
        {transcribeError ? (
          <Box flexDirection="column">
            <Text bold color="red">Transcription failed</Text>
            <Text color="red">{transcribeError}</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text bold>Transcribing lyrics...</Text>
            <Text dimColor>
              {transcribeProgress ? `[${transcribeProgress.stage}] ${transcribeProgress.message}` : "Starting..."}
            </Text>
            <Text dimColor>First run downloads several GB of ML dependencies and may take a long time.</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <KeyHints hints={[{ key: "Esc", label: transcribeError ? "back" : "cancel" }]} />
        </Box>
      </Box>
    );
  }

  if (mode === "lyrics-source") {
    const sources = buildLyricsSources();
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Add lyrics from:</Text>
        <Box flexDirection="column" marginY={1}>
          {sources.map((s, i) => (
            <Text key={s.label} color={i === sourceIndex ? "cyan" : undefined} bold={i === sourceIndex}>
              {i === sourceIndex ? "▸ " : "  "}{s.label}
            </Text>
          ))}
        </Box>
        <KeyHints hints={[{ key: "↑↓", label: "navigate" }, { key: "⏎", label: "select" }, { key: "Esc", label: "back" }]} />
      </Box>
    );
  }

  if (mode === "confirm-lrc") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>Found matching LRC file: {path.basename(foundLrcPath)}</Text>
        <Text>Load it? (y/n)</Text>
      </Box>
    );
  }

  if (mode === "publish-select") {
    const publishers = registry.lyricsPublishers;
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Publish to:</Text>
        <Box flexDirection="column" marginY={1}>
          {publishers.map((p, i) => (
            <Text key={p.name} color={i === publishIndex ? "cyan" : undefined} bold={i === publishIndex}>
              {i === publishIndex ? "▸ " : "  "}{p.name}
            </Text>
          ))}
        </Box>
        <KeyHints hints={[{ key: "↑↓", label: "navigate" }, { key: "⏎", label: "publish" }, { key: "Esc", label: "back" }]} />
      </Box>
    );
  }

  if (mode === "publishing") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>{publishStatus}</Text>
      </Box>
    );
  }

  // --- Main layout ---
  const modeLabel = mode === "edit" ? "[edit]"
    : mode === "sync" ? "[sync]"
    : mode === "words" ? "[words]"
    : mode === "sync-words" ? "[sync words]"
    : mode === "play" ? "[play]"
    : mode === "inline-edit-time" ? "[time]"
    : mode === "inline-edit-text" ? "[text]"
    : "[edit]";

  // Build inline edit overlay for current line
  let currentLineOverride: React.ReactNode | undefined;

  if (mode === "inline-edit-time") {
    // Render timestamp with cursor: [01:29.86] where cursor digit is inverted
    const d = timeDigits;
    const formatted = [d[0], d[1], ":", d[2], d[3], ".", d[4], d[5]];
    const cursorCharIndex = timeCursorPos < 2 ? timeCursorPos : timeCursorPos < 4 ? timeCursorPos + 1 : timeCursorPos + 2;
    const lineText = currentLine?.text ?? "";
    const wordMark = !markWords ? "" : currentLine && hasWordTimings(currentLine) ? "*" : " ";
    currentLineOverride = (
      <Text bold color="cyan">
        [
        {formatted.map((ch, i) => (
          i === cursorCharIndex
            ? <Text key={i} backgroundColor="white" color="black">{ch}</Text>
            : <Text key={i}>{ch}</Text>
        ))}
        ]{wordMark} {lineText}
      </Text>
    );
  }

  if (mode === "inline-edit-text" && currentLine) {
    const before = editText.slice(0, textCursorPos);
    const cursorChar = editText[textCursorPos] ?? " ";
    const after = editText.slice(textCursorPos + 1);
    currentLineOverride = (
      <Text bold color="cyan">
        {timeLabel(currentLine, markWords)}{before}
        <Text backgroundColor="white" color="black">{cursorChar}</Text>
        {after}
      </Text>
    );
  }

  if ((mode === "words" || mode === "sync-words") && currentLine) {
    currentLineOverride = (
      <WordLine line={currentLine} markWords={markWords} selectedIndex={wordIndex} positionMs={positionInLine(currentIndex)} />
    );
  }

  if (mode === "play" && currentLine && hasWordTimings(currentLine)) {
    currentLineOverride = (
      <WordLine line={currentLine} markWords={markWords} positionMs={positionInLine(currentIndex)} />
    );
  }

  const selectedWord = mode === "words" && currentLine ? wordsOf(currentLine)[wordIndex] : undefined;
  const footerInfo = status?.text ?? [
    `Step: ${step}ms`,
    canChangeSpeed ? `Speed: ${speed}x` : "",
    selectedWord ? `Word: ${selectedWord.start !== null ? msToLrc(selectedWord.start) : "not synced"}` : "",
  ].filter(Boolean).join("  ");

  return (
    <Box flexDirection="column" height={rows}>
      {hasPlayer && audioRef ? (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Text>Audio: {audioRef.displayName}</Text>
            <Text>{" "}</Text>
          </Box>
          <ProgressBar currentMs={positionMs} durationMs={player!.getDuration()} width={Math.max(20, (stdout?.columns ?? 80) - 4)} />
        </Box>
      ) : (
        <Text dimColor>No audio selected (press a)</Text>
      )}

      <Box flexGrow={1} marginY={1}>
        <LineList lines={document.lines} currentIndex={currentIndex} visibleCount={lineListHeight} currentLineOverride={currentLineOverride} />
      </Box>

      <Box justifyContent="space-between">
        <Text dimColor={!status} color={status ? (status.isError ? "red" : "green") : undefined}>{footerInfo}</Text>
        <Text dimColor>{modeLabel}</Text>
      </Box>
      <KeyHints hints={getHints()} />
    </Box>
  );
}
