import type { Draft } from "../shared/api";

export interface DraftStore {
  list(): Promise<Draft[]>;
  get(id: string): Promise<Draft | null>;
  put(draft: Draft): Promise<void>;
  /** False when there was no such draft. */
  delete(id: string): Promise<boolean>;
}
