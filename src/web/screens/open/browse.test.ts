import { describe, expect, test } from "bun:test";
import type { DirEntry, FolderBookmark, LyricsFileInfo } from "../../../shared/api";
import { albumLine, baseName, currentBookmark, filterEntries, lyricsLabel, moveSelection, parentDir, sidecarSummary } from "./browse";

const dir = (name: string): DirEntry => ({ kind: "dir", name, path: `/m/${name}` });
const audio = (name: string): DirEntry => ({ kind: "audio", name, path: `/m/${name}`, durationMs: 1000, lyrics: null });

describe("filterEntries", () => {
  const entries = [dir("Artwork"), audio("01 Short Waves.flac"), audio("02 Lanterns.flac"), audio("Твоё имя.mp3")];

  test("matches names case-insensitively, any script", () => {
    expect(filterEntries(entries, "short").map((e) => e.name)).toEqual(["01 Short Waves.flac"]);
    expect(filterEntries(entries, "ТВОЁ").map((e) => e.name)).toEqual(["Твоё имя.mp3"]);
  });

  test("a blank query keeps everything", () => {
    expect(filterEntries(entries, "  ")).toBe(entries);
  });
});

describe("moveSelection", () => {
  const paths = ["a", "b", "c"];

  test("moves and clamps", () => {
    expect(moveSelection(paths, "a", 1)).toBe("b");
    expect(moveSelection(paths, "c", 1)).toBe("c");
    expect(moveSelection(paths, "a", -1)).toBe("a");
  });

  test("starts from an end when nothing (visible) is selected", () => {
    expect(moveSelection(paths, null, 1)).toBe("a");
    expect(moveSelection(paths, null, -1)).toBe("c");
    expect(moveSelection(paths, "gone", 1)).toBe("a");
  });

  test("empty list", () => {
    expect(moveSelection([], "a", 1)).toBeNull();
  });
});

describe("currentBookmark", () => {
  const folders: FolderBookmark[] = [
    { path: "/home/u/Music", name: "Music", custom: false },
    { path: "/home/u/Music/Live", name: "Live", custom: true },
    { path: "/home/u/Downloads", name: "Downloads", custom: false },
  ];

  test("the deepest bookmark containing the folder", () => {
    expect(currentBookmark(folders, "/home/u/Music")).toBe("/home/u/Music");
    expect(currentBookmark(folders, "/home/u/Music/Marigold/Short Waves")).toBe("/home/u/Music");
    expect(currentBookmark(folders, "/home/u/Music/Live/2019")).toBe("/home/u/Music/Live");
  });

  test("a sibling with a common prefix doesn't count", () => {
    expect(currentBookmark(folders, "/home/u/Musicals")).toBeNull();
    expect(currentBookmark(folders, null)).toBeNull();
  });
});

describe("labels", () => {
  const info = (timing: LyricsFileInfo["timing"], name = "Song.lrc", lineCount = 11): LyricsFileInfo => ({
    path: `/m/${name}`,
    name,
    format: name.endsWith(".txt") ? "txt" : "lrc",
    timing,
    lineCount,
  });

  test("lyricsLabel", () => {
    expect(lyricsLabel(info("lines"))).toBe("Song.lrc · line timings");
    expect(lyricsLabel(info("none", "Song.txt"))).toBe("Song.txt · no timings");
    expect(lyricsLabel(info("words"))).toBe("Song.lrc · word timings");
    expect(lyricsLabel(null)).toBe("—");
  });

  test("sidecarSummary", () => {
    expect(sidecarSummary(info("lines"))).toBe("11 lines · line timings · no word timings");
    expect(sidecarSummary(info("words", "Song.lrc", 1))).toBe("1 line · line timings · word timings");
    expect(sidecarSummary(info("none", "Song.txt", 4))).toBe("4 lines · no timings");
  });

  test("albumLine", () => {
    expect(albumLine("Short Waves", 2)).toBe("Short Waves · track 2");
    expect(albumLine(null, 2)).toBe("track 2");
    expect(albumLine("Short Waves", null)).toBe("Short Waves");
    expect(albumLine(null, null)).toBe("");
  });
});

describe("paths", () => {
  test("parentDir", () => {
    expect(parentDir("/home/u/Music/a.mp3")).toBe("/home/u/Music");
    expect(parentDir("/home/u/Music/")).toBe("/home/u");
    expect(parentDir("/a")).toBe("/");
  });

  test("baseName", () => {
    expect(baseName("/home/u/Music")).toBe("Music");
    expect(baseName("/home/u/Music/")).toBe("Music");
    expect(baseName("/")).toBe("/");
  });
});
