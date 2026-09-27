import { test, expect, describe, spyOn } from "bun:test";
import { buildPublishBody, LrclibPublisher } from "./lrclib-publisher";
import { createDocument, addLines, linesFromText, setTimestamp } from "../../core/lrc-document";

describe("buildPublishBody", () => {
  test("builds correct request body from document", () => {
    let doc = createDocument({ artist: "Muse", title: "Uprising", album: "The Resistance" });
    doc = addLines(doc, linesFromText("Line A\nLine B"));
    doc = setTimestamp(doc, 0, 1000);
    doc = setTimestamp(doc, 1, 5000);

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
    let doc = createDocument({ artist: "Muse", title: "Uprising", album: "The Resistance" });
    doc = addLines(doc, linesFromText("Hello"));
    doc = setTimestamp(doc, 0, 1000);

    const body = buildPublishBody(doc, 60000);

    expect(body.syncedLyrics).not.toContain("[ar:");
    expect(body.syncedLyrics).not.toContain("[ti:");
    expect(body.syncedLyrics).not.toContain("[al:");
    expect(body.syncedLyrics).not.toContain("[tool:");
  });

  test("trims whitespace from text in synced and plain lyrics", () => {
    let doc = createDocument({ artist: "Test", title: "Test" });
    // Simulate user-entered whitespace
    doc = { ...doc, lines: [
      { timestamp: 1000, text: "  Song text  " },
      { timestamp: 5000, text: "  Another  " },
    ]};

    const body = buildPublishBody(doc, 60000);

    expect(body.syncedLyrics).toContain("[00:01.00] Song text\n");
    expect(body.syncedLyrics).not.toContain("  Song text");
    expect(body.plainLyrics).toBe("Song text\nAnother");
  });

  test("uses empty strings for missing metadata", () => {
    let doc = createDocument();
    doc = addLines(doc, linesFromText("Hello"));
    doc = setTimestamp(doc, 0, 0);

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
      const doc = addLines(createDocument({ artist: "A", title: "T" }), linesFromText("Hi"));
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
