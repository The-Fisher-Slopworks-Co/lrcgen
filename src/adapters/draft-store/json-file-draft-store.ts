import path from "node:path";
import type { Draft } from "../../shared/api";
import type { DraftStore } from "../../ports/draft-store";
import { readLyricsDoc } from "../../core/lyrics-file";
import { lrcgenDataDir } from "../../core/xdg";
import { JsonDir } from "../json-dir";

/** Drafts as `<dataDir>/drafts/<id>.json`. Drafts from before groups (LRC-style lines) are upgraded as they're read. */
export class JsonFileDraftStore implements DraftStore {
  private dir: JsonDir<Draft>;

  constructor(dataDir: string = lrcgenDataDir()) {
    this.dir = new JsonDir(path.join(dataDir, "drafts"));
  }

  async list(): Promise<Draft[]> {
    return (await this.dir.readAll()).flatMap((d) => upgrade(d) ?? []);
  }

  async get(id: string): Promise<Draft | null> {
    const draft = await this.dir.read(id);
    return draft && upgrade(draft);
  }

  put(draft: Draft): Promise<void> {
    return this.dir.write(draft.id, draft);
  }

  delete(id: string): Promise<boolean> {
    return this.dir.remove(id);
  }
}

/** The draft with its document in the current shape; null when it can't be read as one. */
function upgrade(draft: Draft): Draft | null {
  try {
    return { ...draft, doc: readLyricsDoc(draft.doc) };
  } catch {
    return null;
  }
}
