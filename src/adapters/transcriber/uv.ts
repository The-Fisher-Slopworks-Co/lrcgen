// uv runs the transcription pipeline. The one in PATH is used when there is one; otherwise lrcgen downloads
// a pinned release from GitHub into its cache on the first transcription, so nothing has to be installed by hand.

import { chmod, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

export const UV_VERSION = "0.12.19";

/** The uv release build for this machine, or null if there is none. */
export function uvTarget(platform: string = process.platform, arch: string = process.arch): string | null {
  const cpu = arch === "x64" ? "x86_64" : arch === "arm64" ? "aarch64" : null;
  if (!cpu) return null;
  if (platform === "darwin") return `${cpu}-apple-darwin`;
  if (platform === "linux") return `${cpu}-unknown-linux-gnu`;
  if (platform === "win32") return `${cpu}-pc-windows-msvc`;
  return null;
}

export function uvDownloadUrl(target: string): string {
  const ext = target.endsWith("-windows-msvc") ? "zip" : "tar.gz";
  return `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${target}.${ext}`;
}

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);

export interface UvDownloadOptions {
  signal?: AbortSignal;
  /** 0–1 of the download, when the size is known. */
  onProgress?: (fraction: number | null) => void;
  fetch?: typeof fetch;
}

async function download(url: string, options: UvDownloadOptions): Promise<Uint8Array> {
  const res = await (options.fetch ?? fetch)(url, { signal: options.signal });
  if (!res.ok || !res.body) throw new Error(`GET ${url}: ${res.status} ${res.statusText}`);
  const total = Number(res.headers.get("content-length")) || null;
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    options.onProgress?.(total ? Math.min(1, received / total) : null);
  }
  return Buffer.concat(chunks);
}

/** Unpacks `archive` into `dir`: Bun reads the .tar.gz builds, Windows' own tar.exe (bsdtar) the .zip ones. */
async function unpack(archive: Uint8Array, zip: boolean, dir: string): Promise<void> {
  if (!zip) {
    await new Bun.Archive(archive).extract(dir);
    return;
  }
  const zipPath = path.join(dir, "uv.zip");
  await Bun.write(zipPath, archive);
  // By full path: a GNU tar from Git for Windows earlier in PATH can't read zips.
  const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  const proc = Bun.spawn([tar, "-xf", zipPath, "-C", dir], { stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) throw new Error(`Couldn't unpack uv: ${stderr.trim() || `tar exited with ${proc.exitCode}`}`);
}

async function findFile(dir: string, name: string): Promise<string | null> {
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name === name) return path.join(entry.parentPath, entry.name);
  }
  return null;
}

/** Downloads uv into `binDir`, checking it against the release's checksum. Returns the path to the binary. */
export async function downloadUv(binDir: string, options: UvDownloadOptions = {}): Promise<string> {
  const target = uvTarget();
  if (!target) throw new Error(`There is no uv build for ${process.platform}-${process.arch}. Install uv yourself (https://docs.astral.sh/uv/).`);
  const url = uvDownloadUrl(target);
  const [archive, checksum] = await Promise.all([
    download(url, options),
    download(`${url}.sha256`, { ...options, onProgress: undefined }).then((b) => new TextDecoder().decode(b)),
  ]);
  const expected = checksum.trim().split(/\s+/)[0]?.toLowerCase();
  const actual = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
  if (actual !== expected) throw new Error(`The uv download from ${url} doesn't match its checksum`);

  await mkdir(binDir, { recursive: true });
  const tmp = path.join(binDir, `.uv-${crypto.randomUUID()}`);
  try {
    await unpack(archive, url.endsWith(".zip"), tmp);
    const found = await findFile(tmp, exe("uv"));
    if (!found) throw new Error(`${url} has no ${exe("uv")} in it`);
    const dest = path.join(binDir, exe("uv"));
    await chmod(found, 0o755);
    await rename(found, dest);
    return dest;
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

const downloads = new Map<string, Promise<string>>();

/**
 * The uv to run: the one in PATH, else the one lrcgen downloaded into `binDir` before, else a fresh download
 * there. Concurrent callers share a download; a failed one is retried by the next call.
 */
export async function ensureUv(binDir: string, options: UvDownloadOptions = {}): Promise<string> {
  const inPath = Bun.which("uv");
  if (inPath) return inPath;
  const managed = path.join(binDir, exe("uv"));
  if (await Bun.file(managed).exists()) return managed;
  let pending = downloads.get(binDir);
  if (!pending) {
    pending = downloadUv(binDir, options).finally(() => downloads.delete(binDir));
    downloads.set(binDir, pending);
  }
  return pending;
}
