import path from "node:path";
import { stat } from "node:fs/promises";
import type { FolderBookmark } from "../shared/api";

async function isDir(dir: string): Promise<boolean> {
  return (await stat(dir).catch(() => null))?.isDirectory() ?? false;
}

async function xdgUserDir(name: string, env: Record<string, string | undefined>): Promise<string | null> {
  try {
    const proc = Bun.spawn(["xdg-user-dir", name], { stdout: "pipe", stderr: "ignore", env: env as Record<string, string> });
    const out = (await new Response(proc.stdout).text()).trim();
    return (await proc.exited) === 0 && out ? out : null;
  } catch {
    return null;
  }
}

/** The music and downloads folders (XDG user dirs when configured, else ~/Music and ~/Downloads) that exist. */
export async function builtinFolders(home: string, env: Record<string, string | undefined>): Promise<string[]> {
  const found: string[] = [];
  for (const [xdgName, fallback] of [["MUSIC", "Music"], ["DOWNLOAD", "Downloads"]] as const) {
    const xdg = await xdgUserDir(xdgName, { ...env, HOME: home });
    // xdg-user-dir prints $HOME for a folder that isn't configured.
    const dir = xdg && path.resolve(xdg) !== path.resolve(home) ? path.resolve(xdg) : path.join(home, fallback);
    if (!found.includes(dir) && (await isDir(dir))) found.push(dir);
  }
  return found;
}

export function folderName(dir: string): string {
  return path.basename(dir) || dir;
}

export function bookmarks(builtin: string[], custom: string[]): FolderBookmark[] {
  return [
    ...builtin.map((p) => ({ path: p, name: folderName(p), custom: false })),
    ...custom.filter((p) => !builtin.includes(p)).map((p) => ({ path: p, name: folderName(p), custom: true })),
  ];
}

function isInside(dir: string, root: string): boolean {
  const rel = path.relative(root, dir);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** Breadcrumbs from the nearest bookmarked folder containing `dir` (or from /) down to `dir`. */
export function crumbsFor(dir: string, folders: FolderBookmark[]): { name: string; path: string }[] {
  const root = folders
    .filter((f) => isInside(dir, f.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const crumbs = root ? [{ name: root.name, path: root.path }] : [{ name: "/", path: path.parse(dir).root }];
  let current = crumbs[0]!.path;
  for (const part of path.relative(current, dir).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    crumbs.push({ name: part, path: current });
  }
  return crumbs;
}
