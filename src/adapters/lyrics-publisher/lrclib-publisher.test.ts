import { test, expect, describe, spyOn } from "bun:test";
import { buildPublishBody, LrclibPublisher } from "./lrclib-publisher";
import { createDoc, groupsFromText, setGroupStart } from "../../core/lyrics";
import { doc as docOfGroups, group } from "../../core/testing";

const song = (metadata: Parameters<typeof createDoc>[0], text: string) => createDoc(metadata, groupsFromText(text));

describe("buildPublishBody", () => {
  test("builds correct request body from document", () => {
    let doc = song({ artist: "Muse", title: "Uprising", album: "The Resistance" }, "Line A\nLine B");
    doc = setGroupStart(doc, 0, 1000);
    doc = setGroupStart(doc, 1, 5000);

    const body = buildPublishBody(doc, 180000);

    expect(body.trackName).toBe("Uprising");
    expect(body.artistName).toBe("Muse");
    expect(body.albumName).toBe("The Resistance");
    expect(body.duration).toBe(180);
    expect(body.syncedLyrics).toContain("[00:01.00]");
    expect(body.syncedLyrics).toContain("Line A");
    expect(body.plainLyrics).toBe("Line A\nLine B");
  });

  test("syncedLyrics contains only timestamps and text, no metadata tags", () => {
    const doc = setGroupStart(song({ artist: "Muse", title: "Uprising", album: "The Resistance" }, "Hello"), 0, 1000);

    const body = buildPublishBody(doc, 60000);

    expect(body.syncedLyrics).not.toContain("[ar:");
    expect(body.syncedLyrics).not.toContain("[ti:");
    expect(body.syncedLyrics).not.toContain("[al:");
    expect(body.syncedLyrics).not.toContain("[tool:");
  });

  test("backing vocals and ad-libs go into their line in parentheses", () => {
    const doc = { ...docOfGroups(group("Song text", [1000, 1500]), group("ooh", [1700], [1900], ["backing"]), group("Another", [5000])), metadata: { tool: "t" } };
    const body = buildPublishBody(doc, 60000);
    expect(body.syncedLyrics).toBe("[00:01.00] Song text (ooh)\n[00:05.00] Another");
    expect(body.plainLyrics).toBe("Song text (ooh)\nAnother");
  });

  test("uses empty strings for missing metadata", () => {
    const doc = setGroupStart(song({}, "Hello"), 0, 0);

    const body = buildPublishBody(doc, 60000);

    expect(body.trackName).toBe("");
    expect(body.artistName).toBe("");
    expect(body.albumName).toBe("");
  });
});

describe("LrclibPublisher", () => {
  test("an unreachable server gives an actionable error and logs the raw one", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const publisher = new LrclibPublisher(async () => {
        throw new TypeError("Unable to connect. Is the computer able to access the url?");
      });
      const doc = song({ artist: "A", title: "T" }, "Hi");
      expect(await publisher.publish(doc, 1000)).toEqual({
        success: false,
        error: "Couldn't reach lrclib.net — check your internet connection or proxy.",
      });
      expect(String(log.mock.calls[0])).toContain("Unable to connect");
    } finally {
      log.mockRestore();
    }
  });
});
