import { test, expect, describe } from "bun:test";
import path from "node:path";
import { lrcgenCacheDir, lrcgenConfigDir, lrcgenDataDir } from "./xdg";

describe("xdg", () => {
  test("defaults to ~/.config, ~/.cache and ~/.local/share", () => {
    expect(lrcgenConfigDir({}, "/home/u")).toBe(path.join("/home/u", ".config", "lrcgen"));
    expect(lrcgenCacheDir({}, "/home/u")).toBe(path.join("/home/u", ".cache", "lrcgen"));
    expect(lrcgenDataDir({}, "/home/u")).toBe(path.join("/home/u", ".local", "share", "lrcgen"));
  });

  test("honors XDG overrides", () => {
    expect(lrcgenConfigDir({ XDG_CONFIG_HOME: "/xdg/cfg" }, "/home/u")).toBe(path.join("/xdg/cfg", "lrcgen"));
    expect(lrcgenCacheDir({ XDG_CACHE_HOME: "/xdg/cache" }, "/home/u")).toBe(path.join("/xdg/cache", "lrcgen"));
    expect(lrcgenDataDir({ XDG_DATA_HOME: "/xdg/data" }, "/home/u")).toBe(path.join("/xdg/data", "lrcgen"));
  });

  test("ignores empty XDG overrides", () => {
    expect(lrcgenConfigDir({ XDG_CONFIG_HOME: "" }, "/home/u")).toBe(path.join("/home/u", ".config", "lrcgen"));
    expect(lrcgenDataDir({ XDG_DATA_HOME: "" }, "/home/u")).toBe(path.join("/home/u", ".local", "share", "lrcgen"));
  });
});
