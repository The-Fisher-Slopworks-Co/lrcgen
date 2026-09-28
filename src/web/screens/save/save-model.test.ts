import { describe, expect, test } from "bun:test";
import type { Flag } from "../../../core/flags";
import type { LyricsDoc } from "../../../core/lyrics";
import { doc as docOfGroups, group } from "../../../core/testing";
import { backupNames, fileSuffixes, joinedNote, joinedOnSave, parseLrcPath, publishChecklist, savedMessage, splitPath } from "./save-model";

describe("paths", () => {
  test("shows the home folder as ~", () => {
    expect(splitPath("/home/u/Music/A/Song.lrc", "/home/u")).toEqual({ dir: "~/Music/A/", name: "Song.lrc" });
    expect(splitPath("/srv/Song.lrc", "/home/u")).toEqual({ dir: "/srv/", name: "Song.lrc" });
    expect(splitPath("/home/user2/x.lrc", "/home/u")).toEqual({ dir: "/home/user2/", name: "x.lrc" });
  });

  test("accepts only a plain .lrc path", () => {
    expect(parseLrcPath("~/Music/x.lrc", "/home/u")).toEqual({ path: "/home/u/Music/x.lrc" });
    expect(parseLrcPath(" /a/b.LRC ", null)).toEqual({ path: "/a/b.LRC" });
    expect("error" in parseLrcPath("a/b.lrc", null)).toBe(true);
    expect("error" in parseLrcPath("/a/b.enhanced.lrc", null)).toBe(true);
    expect("error" in parseLrcPath("/a/b.txt", null)).toBe(true);
    expect("error" in parseLrcPath("/a/../b.lrc", null)).toBe(true);
    expect("error" in parseLrcPath("", null)).toBe(true);
  });

  test("file suffixes for the format cards", () => {
    expect(fileSuffixes(["A b.lrc", "A b.enhanced.lrc"])).toEqual([".lrc", ".enhanced.lrc"]);
    expect(fileSuffixes([])).toEqual([]);
  });

  test("backup names and the saved toast", () => {
    expect(backupNames(["/m/A.lrc", "/m/A.enhanced.lrc"])).toEqual(["A.lrc.bak", "A.enhanced.lrc.bak"]);
    expect(savedMessage(["/m/A.lrc", "/m/A.enhanced.lrc"])).toBe("Saved A.lrc (+ A.enhanced.lrc)");
    expect(savedMessage(["/m/A.lrc"])).toBe("Saved A.lrc");
  });
});

describe("untimed words in Enhanced LRC", () => {
  const doc = docOfGroups(group("a b", [1000, null]), group("c — d", [2000, null, 2500]), group("e f"), group("g h", [null, 4200]));

  test("only untimed words after a timed one are joined; punctuation doesn't count", () => {
    expect(joinedOnSave(doc)).toEqual([0]);
  });

  test("the note names the lines", () => {
    expect(joinedNote([])).toBeNull();
    expect(joinedNote([0])).toBe("Line 1 has a word without a start. Enhanced LRC saves it joined to the word before.");
    expect(joinedNote([3, 8, 11])).toStartWith("Lines 4, 9 and 12 have words");
    expect(joinedNote([0, 1, 2, 3, 4, 5, 6])).toStartWith("Lines 1, 2, 3, 4, 5 and 2 more have words");
  });
});

describe("publish checklist", () => {
  const timed: LyricsDoc = {
    metadata: { tool: "t", artist: "A", title: "T", album: "Al" },
    groups: docOfGroups(group("one a", [1000, 1100]), group("two b", [2000, 2100])).groups,
  };
  const flag: Flag = { id: "f", kind: "words-out-of-order", lineIndex: 8, wordIndex: 1, message: "m" };

  test("all good", () => {
    const c = publishChecklist(timed, 204100, []);
    expect(c.rows.every((r) => r.ok)).toBe(true);
    expect(c.rows.map((r) => r.text)).toEqual([
      "Artist, title and album filled in",
      "Length matches the track · 03:24",
      "All 2 lines have line and word timings",
      "Nothing worth a look",
    ]);
    expect(c.blockers).toEqual([]);
  });

  test("missing album warns, missing artist or title blocks", () => {
    const noAlbum = publishChecklist({ ...timed, metadata: { tool: "t", artist: "A", title: "T" } }, 1000, []);
    expect(noAlbum.rows[0]).toMatchObject({ ok: false, blocking: false, text: "Album is missing" });
    expect(noAlbum.blockers).toEqual([]);
    const none = publishChecklist({ ...timed, metadata: { tool: "t", album: " " } }, 1000, []);
    expect(none.rows[0]!.text).toBe("Artist, title and album are missing");
    expect(none.blockers[0]).toBe("Fill in the artist and title first");
  });

  test("untimed lines and an unknown length block; missing word timings only warn", () => {
    const partial = { ...timed, groups: docOfGroups(timed.groups[0]!, group("three c", [3000]), group("four d")).groups };
    const c = publishChecklist(partial, null, []);
    expect(c.rows[1]).toMatchObject({ ok: false, blocking: true });
    expect(c.rows[2]).toMatchObject({ ok: false, blocking: true, text: "2 of 3 lines timed · 1 with word timings" });
    expect(c.blockers).toEqual(["The track's length is unknown", "1 line has no start time"]);
    const wordsOnly = publishChecklist({ ...timed, groups: docOfGroups(timed.groups[0]!, group("three c", [3000])).groups }, 1000, []);
    expect(wordsOnly.rows[2]).toMatchObject({ ok: false, blocking: false, text: "All 2 lines timed · 1 of 2 with word timings" });
  });

  test("flags are counted and the first one named", () => {
    const c = publishChecklist(timed, 1000, [flag, { ...flag, id: "g" }]);
    expect(c.rows[3]!.text).toBe("2 spots worth a look: line 9, words out of order");
    expect(c.firstFlag).toBe(flag);
    expect(c.blockers).toEqual([]);
  });
});
