import { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import type { Registry } from "../../registry";
import type { LrcDocument } from "../../core/lrc-document";
import type { AudioRef } from "../../ports/audio-source";
import type { AudioPlayer } from "../../ports/audio-player";
import { setTimestamp, setLineText, addLines, linesFromText, setMetadata, insertLine, removeLine } from "../../core/lrc-document";
import { lrcToMs, msToLrc } from "../../core/time-utils";
import { LocalAudioSource } from "../../adapters/audio-source/local-audio-source";
import { ProgressBar } from "../components/progress-bar";
import { LineList } from "../components/line-list";
import { KeyHints } from "../components/key-hints";
import { FilePicker } from "../components/file-picker";
import { SyncEngine } from "../../core/sync-engine";
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
  | "play"
  | "file-picker-audio"
  | "file-picker-lyrics"
  | "inline-edit-text"
  | "inline-edit-time"
  | "text-input-metadata"
  | "text-input-save"
  | "confirm-lrc"
  | "publish-select"
  | "publishing"
  | "lyrics-source";

const STEP_OPTIONS = [10, 50, 100, 200, 500, 1000];
const AUDIO_EXTENSIONS = [".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac", ".wma"];

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

  const step = STEP_OPTIONS[stepIndex]!;
  const currentLine = document.lines[currentIndex];
  const hasPlayer = player !== null;

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

  // Calculate visible lines: total rows - header (3) - footer (2) - margins (2)
  const lineListHeight = Math.max(3, rows - 7);

  // Mode-specific key hints
  function getHints() {
    switch (mode) {
      case "edit":
        return [
          { key: "←→", label: `±${step}ms` },
          { key: "⏎", label: "play line" },
          { key: "o", label: "insert" },
          { key: "d", label: "delete" },
          { key: "e", label: "edit" },
          { key: "t", label: "time" },
          { key: "a", label: "audio" },
          { key: "l", label: "lyrics" },
          { key: "m", label: "metadata" },
          { key: "y", label: "sync" },
          { key: "p", label: "play" },
          { key: "s", label: "save" },
          { key: "u", label: "publish" },
          { key: "q", label: "quit" },
        ];
      case "sync":
        return [
          { key: "␣", label: "mark" },
          { key: "⏎", label: "skip" },
          { key: "⌫", label: "undo" },
          { key: "Esc", label: "stop" },
        ];
      case "play":
        return [
          { key: "␣", label: paused ? "resume" : "pause" },
          { key: "Esc", label: "stop" },
        ];
      default:
        return [];
    }
  }

  // --- Input handling per mode ---
  useInput((input, key) => {
    if (mode === "edit") {
      handleEditInput(input, key);
    } else if (mode === "sync") {
      handleSyncInput(input, key);
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
        Bun.file(foundLrcPath).text().then((text) => {
          const parsed = registry.lrcParser.parse(text);
          onDocumentChange({ ...document, lines: parsed.lines, metadata: { ...document.metadata, ...parsed.metadata, tool: document.metadata.tool } });
          setMode("edit");
        });
      } else if (input === "n" || key.escape) {
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

  function handleLyricsSourceInput(input: string, key: any) {
    const sources = [
      ...registry.lyricsProviders.map((p) => ({ label: p.name, type: "provider" as const, provider: p })),
      { label: "Load from file", type: "file" as const, provider: null },
    ];
    if (key.upArrow) {
      setSourceIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSourceIndex((i) => Math.min(sources.length - 1, i + 1));
    } else if (key.return) {
      const selected = sources[sourceIndex]!;
      if (selected.type === "file") {
        setMode("file-picker-lyrics");
      } else {
        selected.provider!.fetch({ artist: document.metadata.artist, title: document.metadata.title }).then((text) => {
          if (text.trim()) {
            // If text looks like LRC (has timestamps), parse it
            if (text.match(/^\[(\d{2,}:\d{2}\.\d{2})\]/m)) {
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
          // Check for matching .lrc file
          const lrcPath = filePath.replace(/\.[^.]+$/, ".lrc");
          if (await Bun.file(lrcPath).exists()) {
            setFoundLrcPath(lrcPath);
            setMode("confirm-lrc");
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
              if (filePath.endsWith(".lrc") || text.match(/^\[(\d{2,}:\d{2}\.\d{2})\]/m)) {
                const parsed = registry.lrcParser.parse(text);
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
          const content = registry.lrcParser.serialize(document);
          await Bun.write(value, content);
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

  if (mode === "lyrics-source") {
    const sources = [
      ...registry.lyricsProviders.map((p) => ({ label: p.name, type: "provider" as const })),
      { label: "Load from file", type: "file" as const },
    ];
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
    currentLineOverride = (
      <Text bold color="cyan">
        [
        {formatted.map((ch, i) => (
          i === cursorCharIndex
            ? <Text key={i} backgroundColor="white" color="black">{ch}</Text>
            : <Text key={i}>{ch}</Text>
        ))}
        ] {lineText}
      </Text>
    );
  }

  if (mode === "inline-edit-text") {
    const timeStr = currentLine?.timestamp != null ? `[${msToLrc(currentLine.timestamp)}]` : "[  ?.??  ]";
    const before = editText.slice(0, textCursorPos);
    const cursorChar = editText[textCursorPos] ?? " ";
    const after = editText.slice(textCursorPos + 1);
    currentLineOverride = (
      <Text bold color="cyan">
        {timeStr} {before}
        <Text backgroundColor="white" color="black">{cursorChar}</Text>
        {after}
      </Text>
    );
  }

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
        <Text dimColor>Step: {step}ms</Text>
        <Text dimColor>{modeLabel}</Text>
      </Box>
      <KeyHints hints={getHints()} />
    </Box>
  );
}
