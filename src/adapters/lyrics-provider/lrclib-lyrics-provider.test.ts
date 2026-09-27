import { test, expect, describe, spyOn } from "bun:test";
import { LrclibLyricsProvider, parseLrclibResponse } from "./lrclib-lyrics-provider";

describe("parseLrclibResponse", () => {
  test("returns synced lyrics when available", () => {
    const response = {
      syncedLyrics: "[00:01.00] Hello\n[00:05.00] World",
      plainLyrics: "Hello\nWorld",
    };
    expect(parseLrclibResponse(response)).toBe("[00:01.00] Hello\n[00:05.00] World");
  });

  test("falls back to plain lyrics when no synced", () => {
    const response = {
      syncedLyrics: null,
      plainLyrics: "Hello\nWorld",
    };
    expect(parseLrclibResponse(response)).toBe("Hello\nWorld");
  });

  test("returns empty string when both null", () => {
    const response = {
      syncedLyrics: null,
      plainLyrics: null,
    };
    expect(parseLrclibResponse(response)).toBe("");
  });
});

describe("LrclibLyricsProvider.search", () => {
  const record = {
    id: 42,
    name: "Uprising",
    trackName: "Uprising",
    artistName: "Muse",
    albumName: "The Resistance",
    duration: 304.5,
    instrumental: false,
    plainLyrics: "Paranoia is in bloom",
    syncedLyrics: "[00:10.00] Paranoia is in bloom",
  };

  test("queries /search with the given fields and maps the records", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const provider = new LrclibLyricsProvider(async (url, init) => {
      calls.push({ url, init });
      return Response.json([record, { id: 7, trackName: "Other", artistName: "X", albumName: "", duration: null, instrumental: true, plainLyrics: null, syncedLyrics: "" }]);
    });

    const results = await provider.search({ title: " Uprising ", artist: "Muse", album: "" });

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/api/search");
    expect(url.searchParams.get("track_name")).toBe("Uprising");
    expect(url.searchParams.get("artist_name")).toBe("Muse");
    expect(url.searchParams.has("album_name")).toBe(false);
    expect(new Headers(calls[0]!.init?.headers).get("User-Agent")).toStartWith("lrcgen/");

    expect(results).toEqual([
      {
        id: 42,
        trackName: "Uprising",
        artistName: "Muse",
        albumName: "The Resistance",
        durationMs: 304500,
        instrumental: false,
        plainLyrics: "Paranoia is in bloom",
        syncedLyrics: "[00:10.00] Paranoia is in bloom",
      },
      {
        id: 7,
        trackName: "Other",
        artistName: "X",
        albumName: null,
        durationMs: null,
        instrumental: true,
        plainLyrics: null,
        syncedLyrics: null,
      },
    ]);
  });

  test("returns nothing without a title", async () => {
    const provider = new LrclibLyricsProvider(async () => {
      throw new Error("should not be called");
    });
    expect(await provider.search({ title: "  ", artist: "Muse" })).toEqual([]);
  });

  test("an unreachable server gives an actionable error and logs the raw one", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const provider = new LrclibLyricsProvider(async () => {
        throw new TypeError("Unable to connect. Is the computer able to access the url?");
      });
      await expect(provider.search({ title: "Uprising" })).rejects.toThrow(
        "Couldn't reach lrclib.net — check your internet connection or proxy.",
      );
      expect(String(log.mock.calls[0])).toContain("Unable to connect");
    } finally {
      log.mockRestore();
    }
  });

  test("throws on an HTTP error", async () => {
    const provider = new LrclibLyricsProvider(async () => new Response("nope", { status: 503 }));
    await expect(provider.search({ title: "Uprising" })).rejects.toThrow("503");
  });
});
