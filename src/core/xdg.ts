import os from "node:os";
import path from "node:path";

export function lrcgenConfigDir(
  env: Record<string, string | undefined> = process.env,
  home: string = os.homedir(),
): string {
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "lrcgen");
}

export function lrcgenCacheDir(
  env: Record<string, string | undefined> = process.env,
  home: string = os.homedir(),
): string {
  return path.join(env.XDG_CACHE_HOME || path.join(home, ".cache"), "lrcgen");
}

export function lrcgenDataDir(
  env: Record<string, string | undefined> = process.env,
  home: string = os.homedir(),
): string {
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "lrcgen");
}
