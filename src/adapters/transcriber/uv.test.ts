import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { downloadUv, uvDownloadUrl, uvTarget, UV_VERSION } from "./uv";

describe("uvTarget", () => {
  test("maps platform and arch to the uv release build", () => {
    expect(uvTarget("win32", "x64")).toBe("x86_64-pc-windows-msvc");
    expect(uvTarget("darwin", "arm64")).toBe("aarch64-apple-darwin");
    expect(uvTarget("linux", "x64")).toBe("x86_64-unknown-linux-gnu");
    expect(uvTarget("freebsd", "x64")).toBeNull();
    expect(uvTarget("linux", "ia32")).toBeNull();
  });

  test("Windows builds are zips, the rest tarballs", () => {
    const base = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`;
    expect(uvDownloadUrl("x86_64-pc-windows-msvc")).toBe(`${base}/uv-x86_64-pc-windows-msvc.zip`);
    expect(uvDownloadUrl("aarch64-apple-darwin")).toBe(`${base}/uv-aarch64-apple-darwin.tar.gz`);
  });
});

describe.skipIf(process.platform === "win32")("downloadUv", () => {
  let dir: string;
  let archive: Uint8Array<ArrayBuffer>;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lrcgen-uv-"));
    const target = uvTarget()!;
    archive = await new Bun.Archive({ [`uv-${target}/uv`]: "#!/bin/sh\n", [`uv-${target}/uvx`]: "" }, { compress: "gzip" }).bytes() as Uint8Array<ArrayBuffer>;
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  const serve = (checksum: string) =>
    (async (url: string) => {
      if (url.endsWith(".sha256")) return new Response(`${checksum}  uv.tar.gz\n`);
      return new Response(archive, { headers: { "content-length": String(archive.length) } });
    }) as unknown as typeof fetch;

  test("unpacks the binary after checking the checksum", async () => {
    const sha = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
    const progress: (number | null)[] = [];
    const uv = await downloadUv(path.join(dir, "bin"), { fetch: serve(sha), onProgress: (f) => progress.push(f) });
    expect(uv).toBe(path.join(dir, "bin", "uv"));
    expect(await Bun.file(uv).text()).toBe("#!/bin/sh\n");
    expect((await stat(uv)).mode & 0o111).not.toBe(0);
    expect(progress.at(-1)).toBe(1);
  });

  test("rejects a download that doesn't match the checksum", async () => {
    const binDir = path.join(dir, "bad");
    await expect(downloadUv(binDir, { fetch: serve("0".repeat(64)) })).rejects.toThrow("checksum");
    expect(await Bun.file(path.join(binDir, "uv")).exists()).toBe(false);
  });
});
