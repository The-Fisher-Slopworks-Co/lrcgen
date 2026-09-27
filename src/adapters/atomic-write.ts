import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

/** Writes via a temp file in the same directory and a rename, so readers never see a half-written file. */
export async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  try {
    await Bun.write(temp, data);
    await rename(temp, filePath);
  } catch (e) {
    await rm(temp, { force: true });
    throw e;
  }
}
