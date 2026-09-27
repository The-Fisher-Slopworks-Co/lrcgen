import path from "node:path";
import type { Draft } from "../../shared/api";
import type { DraftStore } from "../../ports/draft-store";
import { lrcgenDataDir } from "../../core/xdg";
import { JsonDir } from "../json-dir";

/** Drafts as `<dataDir>/drafts/<id>.json`. */
export class JsonFileDraftStore implements DraftStore {
  private dir: JsonDir<Draft>;

  constructor(dataDir: string = lrcgenDataDir()) {
    this.dir = new JsonDir(path.join(dataDir, "drafts"));
  }

  list(): Promise<Draft[]> {
    return this.dir.readAll();
  }

  get(id: string): Promise<Draft | null> {
    return this.dir.read(id);
  }

  put(draft: Draft): Promise<void> {
    return this.dir.write(draft.id, draft);
  }

  delete(id: string): Promise<boolean> {
    return this.dir.remove(id);
  }
}
