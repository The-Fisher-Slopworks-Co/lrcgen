import type { LyricsPublisher, PublishResult } from "../../ports/lyrics-publisher";
import type { LyricsDoc } from "../../core/lyrics";
import { exportLines, formatPlainLine, lineText } from "../../core/lrc-export";
import { solveChallenge } from "./lrclib-pow";
import { LRCLIB_BASE_URL, LRCLIB_USER_AGENT, LrclibUnreachableError, defaultFetch, lrclibFetch, type FetchLike } from "../lrclib-common";

interface PublishBody {
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  plainLyrics: string;
  syncedLyrics: string;
}

/** Lines as LRC export writes them: backing vocals and ad-libs in parentheses in the line they're sung with. */
export function buildPublishBody(doc: LyricsDoc, audioLengthMs: number): PublishBody {
  const lines = exportLines(doc);
  const syncedLyrics = lines.filter((l) => l.start !== null).map(formatPlainLine).join("\n");
  const plainLyrics = lines.map(lineText).join("\n");

  return {
    trackName: doc.metadata.title ?? "",
    artistName: doc.metadata.artist ?? "",
    albumName: doc.metadata.album ?? "",
    duration: audioLengthMs / 1000,
    plainLyrics,
    syncedLyrics,
  };
}

export class LrclibPublisher implements LyricsPublisher {
  name = "LRCLIB";

  constructor(private fetchFn: FetchLike = defaultFetch) {}

  async publish(doc: LyricsDoc, audioLengthMs: number): Promise<PublishResult> {
    try {
      // Step 1: Request challenge
      const challengeRes = await lrclibFetch(this.fetchFn, `${LRCLIB_BASE_URL}/request-challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": LRCLIB_USER_AGENT },
      });
      if (!challengeRes.ok) {
        return { success: false, error: `Challenge request failed: ${challengeRes.status}` };
      }
      const { prefix, target } = await challengeRes.json() as { prefix: string; target: string };

      // Step 2: Solve proof-of-work
      const nonce = await solveChallenge(prefix, target);
      const token = `${prefix}:${nonce}`;

      // Step 3: Publish
      const body = buildPublishBody(doc, audioLengthMs);
      const publishRes = await lrclibFetch(this.fetchFn, `${LRCLIB_BASE_URL}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": LRCLIB_USER_AGENT,
          "X-Publish-Token": token,
        },
        body: JSON.stringify(body),
      });

      if (publishRes.ok) {
        return { success: true };
      }

      const errorText = await publishRes.text();
      return { success: false, error: `Publish failed (${publishRes.status}): ${errorText}` };
    } catch (e) {
      if (e instanceof LrclibUnreachableError) return { success: false, error: e.message };
      return { success: false, error: String(e) };
    }
  }
}
