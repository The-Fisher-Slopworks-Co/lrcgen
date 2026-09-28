import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { AppInfo, DirListing, FolderBookmark, LyricsFileContent, TrackInfo } from "../shared/api";
import { draftIdFor } from "./audio-files";
import { q, startTestApp, TINY_PNG, wavBytes, type TestApp } from "./test-helpers";

let t: TestApp;
let album: string;

beforeAll(async () => {
  t = await startTestApp();
  album = path.join(t.music, "Album");
  await mkdir(path.join(album, "Sub"), { recursive: true });
  await mkdir(path.join(album, ".hidden"), { recursive: true });
  await Bun.write(path.join(album, "02 Song.wav"), wavBytes({ seconds: 2, tags: { title: "Tagged", artist: "Someone", album: "Record" }, cover: TINY_PNG }));
  await Bun.write(path.join(album, "10 Other.wav"), wavBytes({ seconds: 1 }));
  await Bun.write(path.join(album, "03 Plain.wav"), wavBytes({ seconds: 1 }));
  await Bun.write(path.join(album, ".secret.wav"), wavBytes({ seconds: 1 }));
  await Bun.write(path.join(album, "notes.pdf"), "not audio");
  // Line timings in the .lrc, word timings in its companion.
  await Bun.write(path.join(album, "02 Song.lrc"), "[ti:Tagged]\n[00:01.00] Hello world\n[00:03.00] Second line\n");
  await Bun.write(path.join(album, "02 Song.enhanced.lrc"), "[00:01.00]<00:01.00>Hello <00:01.50>world<00:02.00>\n");
  await Bun.write(path.join(album, "03 Plain.txt"), "First\n\nSecond\nThird\n");
  await Bun.write(path.join(album, "10 Other.lrc"), "[00:05.00] Timed\n");
});

afterAll(() => t.close());

describe("app info and folders", () => {
  test("lists the home Music folder as a built-in bookmark", async () => {
    const info = (await (await t.api("/api/app")).json()) as AppInfo;
    expect(info.homeDir).toBe(t.home);
    expect(info.folders).toEqual([{ path: t.music, name: "Music", custom: false }]);
    expect(info.launch).toBeNull();
    expect(typeof info.version).toBe("string");
  });

  test("adds and removes custom folders", async () => {
    const added = (await (await t.api("/api/folders", { method: "POST", json: { path: album + "/" } })).json()) as FolderBookmark[];
    expect(added).toContainEqual({ path: album, name: "Album", custom: true });

    // Adding it twice keeps one entry.
    await t.api("/api/folders", { method: "POST", json: { path: album } });
    const settings = await (await t.api("/api/settings")).json();
    expect(settings.folders).toEqual([album]);

    const missing = await t.api("/api/folders", { method: "POST", json: { path: path.join(t.root, "nope") } });
    expect(missing.status).toBe(404);

    const removed = (await (await t.api(`/api/folders${q({ path: album })}`, { method: "DELETE" })).json()) as FolderBookmark[];
    expect(removed.map((f) => f.path)).toEqual([t.music]);
  });
});

describe("GET /api/fs/list", () => {
  test("lists folders then audio files, with durations and lyrics sidecars", async () => {
    const res = await t.api(`/api/fs/list${q({ path: album })}`);
    expect(res.status).toBe(200);
    const listing = (await res.json()) as DirListing;
    expect(listing.path).toBe(album);
    expect(listing.parent).toBe(t.music);
    expect(listing.crumbs).toEqual([
      { name: "Music", path: t.music },
      { name: "Album", path: album },
    ]);
    expect(listing.entries.map((e) => e.name)).toEqual(["Sub", "02 Song.wav", "03 Plain.wav", "10 Other.wav"]);

    const [, song, plain, other] = listing.entries;
    expect(song).toMatchObject({ kind: "audio", path: path.join(album, "02 Song.wav"), durationMs: 2000 });
    expect(song!.kind === "audio" && song!.lyrics).toEqual({
      path: path.join(album, "02 Song.lrc"),
      name: "02 Song.lrc",
      format: "lrc",
      timing: "words",
      lineCount: 2,
    });
    expect(plain!.kind === "audio" && plain!.lyrics).toMatchObject({ format: "txt", timing: "none", lineCount: 3 });
    expect(other!.kind === "audio" && other!.lyrics).toMatchObject({ format: "lrc", timing: "lines", lineCount: 1 });
  });

  test("breadcrumbs start at / outside the bookmarks", async () => {
    const listing = (await (await t.api(`/api/fs/list${q({ path: t.root })}`)).json()) as DirListing;
    expect(listing.crumbs[0]).toEqual({ name: "/", path: "/" });
    expect(listing.crumbs.at(-1)).toEqual({ name: path.basename(t.root), path: t.root });
  });

  test("404s for a missing folder", async () => {
    expect((await t.api(`/api/fs/list${q({ path: path.join(t.root, "missing") })}`)).status).toBe(404);
  });
});

describe("tracks", () => {
  const song = () => path.join(album, "02 Song.wav");

  test("GET /api/track reads tags, lyrics and draft state", async () => {
    const info = (await (await t.api(`/api/track${q({ path: song() })}`)).json()) as TrackInfo;
    expect(info).toMatchObject({
      path: song(),
      fileName: "02 Song.wav",
      title: "Tagged",
      artist: "Someone",
      album: "Record",
      format: "WAV",
      durationMs: 2000,
      hasCover: true,
      draftId: draftIdFor(song()),
      draft: null,
      hasVocals: false,
    });
    expect(info.lyrics?.timing).toBe("words");
  });

  test("falls back to the file name without tags", async () => {
    const info = (await (await t.api(`/api/track${q({ path: path.join(album, "10 Other.wav") })}`)).json()) as TrackInfo;
    expect(info.title).toBe("10 Other");
    expect(info.artist).toBeNull();
    expect(info.hasCover).toBe(false);
  });

  test("GET /api/track/cover serves the embedded picture", async () => {
    const res = await t.api(`/api/track/cover${q({ path: song() })}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(TINY_PNG);
    expect((await t.api(`/api/track/cover${q({ path: path.join(album, "10 Other.wav") })}`)).status).toBe(404);
  });

  test("GET /api/audio serves the file with Range support", async () => {
    const full = await t.api(`/api/audio${q({ path: song() })}`);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toStartWith("audio/wav");
    const size = (await full.arrayBuffer()).byteLength;
    expect(size).toBe(Bun.file(song()).size);

    const part = await t.api(`/api/audio${q({ path: song() })}`, { headers: { range: "bytes=0-99" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-99/${size}`);
    expect(part.headers.get("content-type")).toStartWith("audio/wav");
    expect((await part.arrayBuffer()).byteLength).toBe(100);
  });

  test("GET /api/audio only serves audio files", async () => {
    expect((await t.api(`/api/audio${q({ path: path.join(album, "02 Song.lrc") })}`)).status).toBe(400);
    expect((await t.api(`/api/audio${q({ path: "/etc/passwd" })}`)).status).toBe(400);
    expect((await t.api(`/api/audio${q({ path: path.join(album, "gone.wav") })}`)).status).toBe(404);
  });

  test("GET /api/vocals serves the cached stem, 404 without one", async () => {
    expect((await t.api(`/api/vocals${q({ path: song() })}`)).status).toBe(404);
    const stem = path.join(t.dirs.cacheDir, "stems", draftIdFor(song()), "vocals.flac");
    await Bun.write(stem, "fLaC-not-really");
    const res = await t.api(`/api/vocals${q({ path: song() })}`, { headers: { range: "bytes=0-3" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-type")).toBe("audio/flac");
    expect(await res.text()).toBe("fLaC");
    const info = (await (await t.api(`/api/track${q({ path: song() })}`)).json()) as TrackInfo;
    expect(info.hasVocals).toBe(true);
  });
});

describe("GET /api/lyrics-file", () => {
  test("parses an .lrc with its enhanced companion", async () => {
    const res = await t.api(`/api/lyrics-file${q({ path: path.join(album, "02 Song.lrc") })}`);
    const content = (await res.json()) as LyricsFileContent;
    expect(content.timing).toBe("words");
    expect(content.doc.metadata.title).toBe("Tagged");
    expect(content.doc.lines[0]).toMatchObject({
      timestamp: 1000,
      text: "Hello world",
      words: [
        { start: 1000, text: "Hello " },
        { start: 1500, text: "world" },
      ],
      end: 2000,
    });
    expect(content.doc.lines[1]).toEqual({ timestamp: 3000, text: "Second line" });
  });

  test("reads a .txt as untimed lines", async () => {
    const content = (await (await t.api(`/api/lyrics-file${q({ path: path.join(album, "03 Plain.txt") })}`)).json()) as LyricsFileContent;
    expect(content.timing).toBe("none");
    expect(content.doc.lines).toEqual([
      { timestamp: null, text: "First" },
      { timestamp: null, text: "Second" },
      { timestamp: null, text: "Third" },
    ]);
  });

  test("refuses other file types", async () => {
    expect((await t.api(`/api/lyrics-file${q({ path: path.join(album, "notes.pdf") })}`)).status).toBe(400);
  });
});
