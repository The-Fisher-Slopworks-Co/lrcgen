import { describe, expect, test } from "bun:test";
import { groupText } from "./lyrics";
import { isLyricsFilePath, lyricsDocProblem, lyricsFilePath, parseLyricsFile, readLyricsDoc, serializeLyricsFile, toLyricsFile } from "./lyrics-file";
import { doc, endsOf, group, startsOf } from "./testing";

const song = () => ({ ...doc(group("Never gonna give", [12000, 12480.4, 12900], [12300, null, 14200]), group("ooh", [13000], [], ["backing"])), metadata: { title: "Song", tool: "x" } });

describe("paths", () => {
  test("next to the .lrc", () => {
    expect(lyricsFilePath("/music/Song.lrc")).toBe("/music/Song.lyrics.json");
    expect(lyricsFilePath("/music/Song.LRC")).toBe("/music/Song.lyrics.json");
    expect(isLyricsFilePath("/music/Song.lyrics.json")).toBe(true);
    expect(isLyricsFilePath("/music/Song.json")).toBe(false);
  });
});

describe("the file", () => {
  test("is the format, the version, the metadata and the groups, with whole ms", () => {
    const file = toLyricsFile(song());
    expect(file.format).toBe("lrcgen-lyrics");
    expect(file.version).toBe(1);
    expect(file.groups[0]!.words[1]).toEqual({ id: "w2", text: "gonna", start: 12480, end: null });
    expect(file.groups[1]).toMatchObject({ labels: ["backing"] });
  });

  test("reads back what it wrote", () => {
    const back = parseLyricsFile(serializeLyricsFile(song()));
    expect(back.metadata.title).toBe("Song");
    expect(back.metadata.tool).toBe("https://github.com/txssu/lrcgen");
    expect(back.groups.map(groupText)).toEqual(["Never gonna give", "ooh"]);
    expect(startsOf(back.groups[0])).toEqual([12000, 12480, 12900]);
    expect(endsOf(back.groups[0])).toEqual([12300, null, 14200]);
  });

  test("says what's wrong with a file that isn't one", () => {
    expect(() => parseLyricsFile("{")).toThrow("isn't JSON");
    expect(() => parseLyricsFile(JSON.stringify({ format: "other" }))).toThrow('"format"');
    expect(() => parseLyricsFile(JSON.stringify({ format: "lrcgen-lyrics", version: 2, metadata: {}, groups: [] }))).toThrow("newer lrcgen");
    expect(lyricsDocProblem({ metadata: {}, groups: [{ id: "g1", labels: [], words: [{ id: "w1", text: "a", start: "1", end: null }] }] })).toContain("start or end");
    expect(lyricsDocProblem({ metadata: {}, groups: [] })).toBeNull();
  });
});

describe("readLyricsDoc", () => {
  test("upgrades a draft from before groups", () => {
    const d = readLyricsDoc({
      metadata: { artist: "A", tool: "t" },
      lines: [
        { timestamp: 1000, text: "Hi there", words: [{ start: 1000, text: "Hi " }, { start: 1500, text: "there" }], end: 2000 },
        { timestamp: 2300, text: "" },
        { timestamp: 3000, text: "(ooh)" },
      ],
    });
    expect(d.metadata).toEqual({ artist: "A", tool: "https://github.com/txssu/lrcgen" });
    expect(d.groups.map(groupText)).toEqual(["Hi there", "ooh"]);
    expect(endsOf(d.groups[0])).toEqual([null, 2000]);
    expect(d.groups[1]!.labels).toEqual(["backing"]);
  });

  test("fixes clashing ids and throws on garbage", () => {
    const d = readLyricsDoc({ metadata: {}, groups: [{ id: "g1", labels: [], words: [{ id: "w1", text: "a", start: null, end: null }] }, { id: "g1", labels: [], words: [{ id: "w1", text: "b", start: null, end: null }] }] });
    expect(d.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(() => readLyricsDoc(42)).toThrow("Not a lyrics document");
  });
});
