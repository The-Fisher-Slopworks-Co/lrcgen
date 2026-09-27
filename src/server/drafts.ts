import { stat } from "node:fs/promises";
import path from "node:path";
import type { Draft, DraftSummary } from "../shared/api";
import type { LrcMetadata } from "../core/lrc-document";
import type { DraftStore } from "../ports/draft-store";
import type { LrcParser } from "../ports/lrc-parser";
import { createDocument } from "../core/lrc-document";
import { draftProgress } from "../core/draft-status";
import { findFlags } from "../core/flags";
import { draftIdFor } from "./audio-files";
import { KeyedLock } from "./keyed-lock";
import { readLyricsFile } from "./lyrics-files";
import type { MediaInfo } from "./media-info";
import type { DraftFields } from "./validate";

function baseName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

/** `audioMissing`: the audio file is no longer at `draft.audioPath`. */
export function summarize(draft: Draft, audioMissing: boolean): DraftSummary {
  const openFlags = findFlags(draft.doc, { dismissed: new Set(draft.dismissedFlags) }).length;
  const progress = draftProgress(draft.doc, { published: draft.publishedAt !== null, openFlags });
  return {
    id: draft.id,
    audioPath: draft.audioPath,
    title: draft.doc.metadata.title || baseName(draft.audioPath),
    artist: draft.doc.metadata.artist || null,
    step: draft.step,
    stepsDone: progress.stepsDone,
    status: progress.status,
    updatedAt: draft.updatedAt,
    audioMissing,
  };
}

/** Drafts with every read-modify-write serialised per draft, so autosave, save and publish can't clobber each other. */
export class DraftService {
  private lock = new KeyedLock();

  constructor(
    private store: DraftStore,
    private media: MediaInfo,
    private parser: LrcParser,
    private now: () => number = Date.now,
  ) {}

  get(id: string): Promise<Draft | null> {
    return this.store.get(id);
  }

  async summaries(): Promise<DraftSummary[]> {
    const drafts = await this.store.list();
    const missing = await Promise.all(drafts.map(async (d) => !(await stat(d.audioPath).catch(() => null))?.isFile()));
    return drafts
      .map((d, i) => summarize(d, missing[i]!))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** The draft for `audioPath`, created (from `lyricsPath` when given) if there is none yet. */
  open(audioPath: string, lyricsPath?: string): Promise<Draft> {
    const id = draftIdFor(audioPath);
    return this.lock.run(id, async () => {
      const existing = await this.store.get(id);
      if (existing) return existing;

      const tags = await this.media.tags(audioPath);
      const lyrics = lyricsPath ? await readLyricsFile(lyricsPath, this.parser) : null;
      // What the user saved in the lyrics file wins; tags only fill the gaps.
      const metadata: Partial<LrcMetadata> = { ...lyrics?.metadata };
      for (const key of ["artist", "title", "album"] as const) {
        const fromTags = tags[key];
        if (!metadata[key]?.trim() && fromTags) metadata[key] = fromTags;
      }
      const doc = { ...createDocument(metadata), lines: lyrics?.lines ?? [] };
      const now = this.now();
      const draft: Draft = {
        id,
        audioPath,
        doc,
        step: doc.lines.length > 0 ? "lines" : "lyrics",
        lrcPath: path.join(path.dirname(audioPath), `${baseName(audioPath)}.lrc`),
        dismissedFlags: [],
        savedAt: null,
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.store.put(draft);
      return draft;
    });
  }

  /**
   * Applies what the client owns. id, audioPath, createdAt, savedAt and publishedAt stay as stored:
   * a debounced autosave can arrive after a save/publish and must not reset them.
   */
  update(id: string, fields: DraftFields): Promise<Draft | null> {
    return this.lock.run(id, async () => {
      const stored = await this.store.get(id);
      if (!stored) return null;
      const draft: Draft = { ...stored, ...fields, updatedAt: Math.max(this.now(), stored.updatedAt + 1) };
      await this.store.put(draft);
      return draft;
    });
  }

  /** Records a save or publish. No-op (null) when the draft is gone. */
  mark(id: string, field: "savedAt" | "publishedAt"): Promise<Draft | null> {
    return this.lock.run(id, async () => {
      const stored = await this.store.get(id);
      if (!stored) return null;
      const draft: Draft = { ...stored, [field]: this.now() };
      await this.store.put(draft);
      return draft;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.lock.run(id, () => this.store.delete(id));
  }
}
