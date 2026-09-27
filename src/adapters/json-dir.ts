import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./atomic-write";

const ID_RE = /^[A-Za-z0-9_-]+$/;

/** A directory of `<id>.json` files. Ids are restricted to a safe charset so they can't escape the directory. */
export class JsonDir<T> {
  constructor(private dir: string) {}

  private file(id: string): string {
    if (!ID_RE.test(id)) throw new Error(`Invalid id: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  async read(id: string): Promise<T | null> {
    if (!ID_RE.test(id)) return null;
    const file = Bun.file(this.file(id));
    if (!(await file.exists())) return null;
    try {
      return (await file.json()) as T;
    } catch {
      return null;
    }
  }

  async readAll(): Promise<T[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const ids = names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -".json".length));
    const values: T[] = [];
    for (const id of ids) {
      const value = await this.read(id);
      if (value !== null) values.push(value);
    }
    return values;
  }

  async write(id: string, value: T): Promise<void> {
    await writeFileAtomic(this.file(id), JSON.stringify(value, null, 2) + "\n");
  }

  async remove(id: string): Promise<boolean> {
    if (!ID_RE.test(id)) return false;
    const file = this.file(id);
    if (!(await Bun.file(file).exists())) return false;
    await rm(file, { force: true });
    return true;
  }
}
