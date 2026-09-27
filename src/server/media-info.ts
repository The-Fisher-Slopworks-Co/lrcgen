import path from "node:path";
import { stat } from "node:fs/promises";
import { parseFile, selectCover, type IAudioMetadata } from "music-metadata";
import { Limiter } from "./keyed-lock";

export interface TrackTags {
  title: string | null;
  artist: string | null;
  album: string | null;
  trackNo: number | null;
  /** "FLAC", "MP3", … */
  format: string;
  durationMs: number | null;
  hasCover: boolean;
}

const CONTAINER_NAMES: Record<string, string> = { MPEG: "MP3", WAVE: "WAV", ASF: "WMA" };

function formatName(meta: IAudioMetadata, filePath: string): string {
  const container = meta.format.container?.split("/")[0]?.trim().toUpperCase();
  if (!container) return path.extname(filePath).slice(1).toUpperCase();
  return CONTAINER_NAMES[container] ?? container;
}

function durationMs(meta: IAudioMetadata): number | null {
  const seconds = meta.format.duration;
  return typeof seconds === "number" && Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

/** Tags, durations and covers read with music-metadata. Durations are cached by path, mtime and size. */
export class MediaInfo {
  private durations = new Map<string, { key: string; value: number | null }>();
  private limiter = new Limiter(6);

  private async fileKey(filePath: string): Promise<string | null> {
    const info = await stat(filePath).catch(() => null);
    return info ? `${info.mtimeMs}:${info.size}` : null;
  }

  async duration(filePath: string): Promise<number | null> {
    const key = await this.fileKey(filePath);
    if (key === null) return null;
    const cached = this.durations.get(filePath);
    if (cached?.key === key) return cached.value;
    const value = await this.limiter.run(async () => {
      try {
        return durationMs(await parseFile(filePath, { skipCovers: true }));
      } catch {
        return null;
      }
    });
    this.durations.set(filePath, { key, value });
    return value;
  }

  async tags(filePath: string): Promise<TrackTags> {
    const key = await this.fileKey(filePath);
    let meta: IAudioMetadata;
    try {
      meta = await parseFile(filePath);
    } catch {
      return {
        title: null,
        artist: null,
        album: null,
        trackNo: null,
        format: path.extname(filePath).slice(1).toUpperCase(),
        durationMs: null,
        hasCover: false,
      };
    }
    const tags: TrackTags = {
      title: meta.common.title?.trim() || null,
      artist: meta.common.artist?.trim() || meta.common.albumartist?.trim() || null,
      album: meta.common.album?.trim() || null,
      trackNo: meta.common.track.no ?? null,
      format: formatName(meta, filePath),
      durationMs: durationMs(meta),
      hasCover: selectCover(meta.common.picture) !== null,
    };
    if (key !== null) this.durations.set(filePath, { key, value: tags.durationMs });
    return tags;
  }

  async cover(filePath: string): Promise<{ data: Uint8Array; format: string } | null> {
    try {
      const picture = selectCover((await parseFile(filePath)).common.picture);
      if (!picture) return null;
      const format = picture.format.toLowerCase();
      // Some taggers store "jpg"/"png" instead of a MIME type.
      const type = format.startsWith("image/") ? format : `image/${format === "jpg" ? "jpeg" : format}`;
      if (!/^image\/[a-z0-9.+-]+$/.test(type)) return null;
      return { data: picture.data, format: type };
    } catch {
      return null;
    }
  }
}
