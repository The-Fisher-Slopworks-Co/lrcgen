import { test, expect, describe } from "bun:test";
import { render } from "ink-testing-library";
import { EditorScreen } from "./edit-screen";
import { createDocument, addLines, linesFromText, setTimestamp } from "../../core/lrc-document";
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
