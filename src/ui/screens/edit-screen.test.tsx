import { test, expect, describe } from "bun:test";
import { useState } from "react";
import { render } from "ink-testing-library";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EditorScreen } from "./edit-screen";
import { createDocument, addLines, linesFromText, setTimestamp } from "../../core/lrc-document";
import type { LrcDocument } from "../../core/lrc-document";
import { createDefaultRegistry } from "../../registry";

const tick = () => new Promise((r) => setTimeout(r, 50));

function makeDoc() {
  let doc = addLines(createDocument(), linesFromText("Line A\nLine B\nLine C"));
  doc = setTimestamp(doc, 0, 1000);
  doc = setTimestamp(doc, 1, 5000);
  doc = setTimestamp(doc, 2, 10000);
  return doc;
}

const noopPlayer = {
  play: () => {},
  playSegment: () => {},
  pause: () => {},
  resume: () => {},
  seek: () => {},
  getCurrentPosition: () => 0,
  getDuration: () => 60000,
  onPosition: () => () => {},
  dispose: () => {},
};

describe("EditorScreen", () => {
  test("renders key hints in edit mode", () => {
    const registry = createDefaultRegistry();
    const { lastFrame } = render(
      <EditorScreen
        registry={registry}
        document={makeDoc()}
        audioRef={null}
        player={noopPlayer}
        onDocumentChange={() => {}}
        onAudioRefChange={async () => {}}
        onQuit={() => {}}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain("audio");
    expect(frame).toContain("lyrics");
    expect(frame).toContain("save");
  });

  test("renders audio info when audioRef is set", () => {
    const registry = createDefaultRegistry();
    const ref = { source: "Local File", id: "/path/to/song.mp3", displayName: "song.mp3" };
    const { lastFrame } = render(
      <EditorScreen
        registry={registry}
        document={makeDoc()}
        audioRef={ref}
        player={noopPlayer}
        onDocumentChange={() => {}}
        onAudioRefChange={async () => {}}
        onQuit={() => {}}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain("song.mp3");
    expect(frame).toContain("00:01.00");
  });

  test("renders lines from document", () => {
    const registry = createDefaultRegistry();
    const { lastFrame } = render(
      <EditorScreen
        registry={registry}
        document={makeDoc()}
        audioRef={null}
        player={noopPlayer}
        onDocumentChange={() => {}}
        onAudioRefChange={async () => {}}
        onQuit={() => {}}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Line A");
    expect(frame).toContain("Line B");
  });

  test("shows mode indicator", () => {
    const registry = createDefaultRegistry();
    const { lastFrame } = render(
      <EditorScreen
        registry={registry}
        document={makeDoc()}
        audioRef={null}
        player={noopPlayer}
        onDocumentChange={() => {}}
        onAudioRefChange={async () => {}}
        onQuit={() => {}}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain("[edit]");
  });

  test("y key enters sync mode when player available", async () => {
    const registry = createDefaultRegistry();
    const { lastFrame, stdin } = render(
      <EditorScreen
        registry={registry}
        document={makeDoc()}
        audioRef={{ source: "Local File", id: "/test.mp3", displayName: "test.mp3" }}
        player={noopPlayer}
        onDocumentChange={() => {}}
        onAudioRefChange={async () => {}}
        onQuit={() => {}}
      />
    );
    stdin.write("y");
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain("[sync]");
  });

  test("p key enters play mode when player available", async () => {
    const registry = createDefaultRegistry();
    const { lastFrame, stdin } = render(
      <EditorScreen
        registry={registry}
        document={makeDoc()}
        audioRef={{ source: "Local File", id: "/test.mp3", displayName: "test.mp3" }}
        player={noopPlayer}
        onDocumentChange={() => {}}
        onAudioRefChange={async () => {}}
        onQuit={() => {}}
      />
    );
    stdin.write("p");
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain("[play]");
  });

  test("esc in play mode pauses instead of disposing, so play works again", async () => {
    const registry = createDefaultRegistry();
    const calls: string[] = [];
    const player = {
      ...noopPlayer,
      play: () => { calls.push("play"); },
      pause: () => { calls.push("pause"); },
      dispose: () => { calls.push("dispose"); },
    };
    const { lastFrame, stdin } = render(
      <EditorScreen
        registry={registry}
        document={makeDoc()}
        audioRef={{ source: "Local File", id: "/test.mp3", displayName: "test.mp3" }}
        player={player}
        onDocumentChange={() => {}}
        onAudioRefChange={async () => {}}
        onQuit={() => {}}
      />
    );
    stdin.write("p");
    await tick();
    stdin.write(""); // esc
    await tick();
    expect(lastFrame()!).toContain("[edit]");
    stdin.write("p");
    await tick();
    expect(lastFrame()!).toContain("[play]");
    expect(calls).toEqual(["play", "pause", "play"]);
  });

  test("esc in sync mode pauses instead of disposing", async () => {
    const registry = createDefaultRegistry();
    const calls: string[] = [];
    const player = {
      ...noopPlayer,
      play: () => { calls.push("play"); },
      pause: () => { calls.push("pause"); },
      dispose: () => { calls.push("dispose"); },
    };
    const { lastFrame, stdin } = render(
      <EditorScreen
        registry={registry}
        document={makeDoc()}
        audioRef={{ source: "Local File", id: "/test.mp3", displayName: "test.mp3" }}
        player={player}
        onDocumentChange={() => {}}
        onAudioRefChange={async () => {}}
        onQuit={() => {}}
      />
    );
    stdin.write("y");
    await tick();
    stdin.write(""); // esc
    await tick();
    expect(lastFrame()!).toContain("[edit]");
    expect(calls).toEqual(["play", "pause"]);
  });

  test("q key calls onQuit", () => {
    const registry = createDefaultRegistry();
    let quit = false;
    const { stdin } = render(
      <EditorScreen
        registry={registry}
        document={makeDoc()}
        audioRef={null}
        player={noopPlayer}
        onDocumentChange={() => {}}
        onAudioRefChange={async () => {}}
        onQuit={() => { quit = true; }}
      />
    );
    stdin.write("q");
    expect(quit).toBe(true);
  });

  test("s key shows save prompt with default path", async () => {
    const registry = createDefaultRegistry();
    const ref = { source: "Local File", id: "/tmp/test-song.mp3", displayName: "test-song.mp3" };
    const { lastFrame, stdin } = render(
      <EditorScreen
        registry={registry}
        document={makeDoc()}
        audioRef={ref}
        player={noopPlayer}
        onDocumentChange={() => {}}
        onAudioRefChange={async () => {}}
        onQuit={() => {}}
      />
    );
    stdin.write("s");
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain("test-song.lrc");
  });

  test("empty document shows no audio message", () => {
    const registry = createDefaultRegistry();
    const { lastFrame } = render(
      <EditorScreen
        registry={registry}
        document={createDocument()}
        audioRef={null}
        player={null}
        onDocumentChange={() => {}}
        onAudioRefChange={async () => {}}
        onQuit={() => {}}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain("No audio selected");
    expect(frame).toContain("[edit]");
  });
});

describe("EditorScreen transcription", () => {
  const audioRef = { source: "Local File", id: "/test.mp3", displayName: "test.mp3" };

  const fakeSettingsStore = () => ({
    load: async () => ({}),
    save: async () => ({ success: true }),
  });

  function makeRegistry(transcriber: any) {
    return {
      ...createDefaultRegistry(),
      lyricsProviders: [],
      transcribers: [transcriber],
      settingsStore: fakeSettingsStore(),
    };
  }

  function renderEditor(registry: any, overrides: Record<string, unknown> = {}) {
    return render(
      <EditorScreen
        registry={registry}
        document={makeDoc()}
        audioRef={audioRef}
        player={noopPlayer}
        onDocumentChange={() => {}}
        onAudioRefChange={async () => {}}
        onQuit={() => {}}
        {...overrides}
      />
    );
  }

  test("lyrics menu shows transcribe entry when audio is set", async () => {
    const registry = makeRegistry({
      name: "Stub AI",
      isAvailable: async () => true,
      transcribe: async () => ({ success: true, lines: [] }),
    });
    const { lastFrame, stdin } = renderEditor(registry);
    stdin.write("l");
    await tick();
    expect(lastFrame()!).toContain("Stub AI");
  });

  test("lyrics menu hides transcribe entry without audio", async () => {
    const registry = makeRegistry({
      name: "Stub AI",
      isAvailable: async () => true,
      transcribe: async () => ({ success: true, lines: [] }),
    });
    const { lastFrame, stdin } = renderEditor(registry, { audioRef: null });
    stdin.write("l");
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain("Load from file");
    expect(frame).not.toContain("Stub AI");
  });

  test("successful transcription replaces document lines", async () => {
    const registry = makeRegistry({
      name: "Stub AI",
      isAvailable: async () => true,
      transcribe: async () => ({ success: true, lines: [{ timestamp: 100, text: "Auto line" }] }),
    });
    let captured: any = null;
    const { lastFrame, stdin } = renderEditor(registry, { onDocumentChange: (doc: any) => { captured = doc; } });
    stdin.write("l");
    await tick();
    stdin.write("\r");
    await tick();
    expect(captured).not.toBeNull();
    expect(captured.lines).toEqual([{ timestamp: 100, text: "Auto line" }]);
    expect(lastFrame()!).toContain("[edit]");
  });

  test("failed transcription shows the error until dismissed", async () => {
    const registry = makeRegistry({
      name: "Stub AI",
      isAvailable: async () => true,
      transcribe: async () => ({ success: false, error: "boom" }),
    });
    const { lastFrame, stdin } = renderEditor(registry);
    stdin.write("l");
    await tick();
    stdin.write("\r");
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain("Transcription failed");
    expect(frame).toContain("boom");
    stdin.write("");
    await tick();
    expect(lastFrame()!).toContain("[edit]");
  });

  test("esc cancels a running transcription", async () => {
    let aborted = false;
    const registry = makeRegistry({
      name: "Stub AI",
      isAvailable: async () => true,
      transcribe: (options: any) =>
        new Promise((resolve) => {
          options.signal?.addEventListener("abort", () => {
            aborted = true;
            resolve({ success: false, error: "Cancelled" });
          });
        }),
    });
    const { lastFrame, stdin } = renderEditor(registry);
    stdin.write("l");
    await tick();
    stdin.write("\r");
    await tick();
    expect(lastFrame()!).toContain("Transcribing");
    stdin.write("");
    await tick();
    expect(aborted).toBe(true);
    expect(lastFrame()!).toContain("[edit]");
  });
});

describe("EditorScreen word timings", () => {
  // Keeps the document in state so consecutive keys build on each other.
  function Harness({ initial, player = noopPlayer, audioRef = null, onChange }: {
    initial: LrcDocument;
    player?: any;
    audioRef?: any;
    onChange: (doc: LrcDocument) => void;
  }) {
    const [doc, setDoc] = useState(initial);
    return (
      <EditorScreen
        registry={createDefaultRegistry()}
        document={doc}
        audioRef={audioRef}
        player={player}
        onDocumentChange={(d) => { setDoc(d); onChange(d); }}
        onAudioRefChange={async () => {}}
        onQuit={() => {}}
      />
    );
  }

  test("w edits single words: select, nudge, and the first word moves the line", async () => {
    let doc = makeDoc();
    const { lastFrame, stdin } = render(<Harness initial={doc} onChange={(d) => { doc = d; }} />);
    stdin.write("w");
    await tick();
    expect(lastFrame()!).toContain("[words]");
    stdin.write(".");
    await tick();
    expect(doc.lines[0]!.timestamp).toBe(1100);
    stdin.write("\u001B[C"); // right arrow
    await tick();
    stdin.write(".");
    await tick();
    expect(doc.lines[0]!.words).toEqual([
      { start: 1100, text: "Line " },
      { start: 1200, text: "A" },
    ]);
    expect(lastFrame()!).toContain("Word: 00:01.20");
  });

  test("Y marks words one by one at the player position", async () => {
    let doc = makeDoc();
    let position = 0;
    const plays: number[] = [];
    const player = { ...noopPlayer, getCurrentPosition: () => position, play: (ms?: number) => { plays.push(ms ?? 0); } };
    const audioRef = { source: "Local File", id: "/test.mp3", displayName: "test.mp3" };
    const { lastFrame, stdin } = render(<Harness initial={doc} player={player} audioRef={audioRef} onChange={(d) => { doc = d; }} />);
    stdin.write("Y");
    await tick();
    expect(lastFrame()!).toContain("[sync words]");
    expect(plays).toEqual([0]);
    for (const ms of [1200, 1400, 5100]) {
      position = ms;
      stdin.write(" ");
      await tick();
    }
    expect(doc.lines[0]!.timestamp).toBe(1200);
    expect(doc.lines[0]!.words!.map((w) => w.start)).toEqual([1200, 1400]);
    expect(doc.lines[1]!.timestamp).toBe(5100);
    expect(lastFrame()!).toContain("[00:01.20]* Line A");
  });

  test("- and + change the playback speed when the player supports it", async () => {
    const speeds: number[] = [];
    const player = { ...noopPlayer, setSpeed: (rate: number) => { speeds.push(rate); } };
    const { lastFrame, stdin } = render(<Harness initial={makeDoc()} player={player} onChange={() => {}} />);
    await tick();
    expect(lastFrame()!).toContain("Speed: 1x");
    stdin.write("-");
    await tick();
    expect(lastFrame()!).toContain("Speed: 0.75x");
    stdin.write("-");
    await tick();
    stdin.write("-");
    await tick();
    expect(lastFrame()!).toContain("Speed: 0.5x");
    stdin.write("+");
    await tick();
    expect(speeds).toEqual([1, 0.75, 0.5, 0.75]);
  });

  test("saving writes the enhanced companion next to the plain file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lrcgen-save-"));
    try {
      const doc = { ...makeDoc(), lines: [{ timestamp: 1000, text: "Hi you", words: [{ start: 1000, text: "Hi " }, { start: 1300, text: "you" }] }] };
      const audioRef = { source: "Local File", id: path.join(dir, "song.mp3"), displayName: "song.mp3" };
      const { lastFrame, stdin } = render(<Harness initial={doc} audioRef={audioRef} onChange={() => {}} />);
      stdin.write("s");
      await tick();
      stdin.write("\r");
      await tick();
      expect(await Bun.file(path.join(dir, "song.lrc")).text()).toContain("[00:01.00] Hi you");
      expect(await Bun.file(path.join(dir, "song.enhanced.lrc")).text()).toContain("[00:01.00]<00:01.00>Hi <00:01.30>you");
      expect(lastFrame()!).toContain("Saved song.lrc + song.enhanced.lrc");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
