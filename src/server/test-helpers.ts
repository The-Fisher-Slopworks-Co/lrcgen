import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Registry } from "../registry";
import { createServer, type AppServer, type ServerOptions } from "./server";

function ascii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function chunk(id: string, body: Uint8Array): Uint8Array {
  const padded = body.length + (body.length % 2);
  const out = new Uint8Array(8 + padded);
  const view = new DataView(out.buffer);
  ascii(view, 0, id);
  view.setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** An ID3v2.3 tag holding one front-cover APIC frame. */
function id3WithCover(image: Uint8Array, mime: string): Uint8Array {
  const enc = new TextEncoder();
  const frameBody = concat([new Uint8Array([0]), enc.encode(`${mime}\0`), new Uint8Array([3, 0]), image]);
  const frame = new Uint8Array(10 + frameBody.length);
  const fv = new DataView(frame.buffer);
  ascii(fv, 0, "APIC");
  fv.setUint32(4, frameBody.length);
  frame.set(frameBody, 10);
  const header = new Uint8Array(10);
  ascii(new DataView(header.buffer), 0, "ID3");
  header[3] = 3;
  const size = frame.length;
  header[6] = (size >> 21) & 0x7f;
  header[7] = (size >> 14) & 0x7f;
  header[8] = (size >> 7) & 0x7f;
  header[9] = size & 0x7f;
  return concat([header, frame]);
}

export interface WavOptions {
  seconds: number;
  sampleRate?: number;
  tags?: { title?: string; artist?: string; album?: string };
  cover?: Uint8Array;
}

/** A mono 16-bit PCM WAV with a quiet tone, optional RIFF INFO tags and an ID3 cover. */
export function wavBytes({ seconds, sampleRate = 8000, tags, cover }: WavOptions): Uint8Array {
  const samples = Math.round(seconds * sampleRate);
  const fmt = new Uint8Array(16);
  const fv = new DataView(fmt.buffer);
  fv.setUint16(0, 1, true);
  fv.setUint16(2, 1, true);
  fv.setUint32(4, sampleRate, true);
  fv.setUint32(8, sampleRate * 2, true);
  fv.setUint16(12, 2, true);
  fv.setUint16(14, 16, true);
  const data = new Uint8Array(samples * 2);
  const dv = new DataView(data.buffer);
  for (let i = 0; i < samples; i++) dv.setInt16(i * 2, Math.round(Math.sin(i / 10) * 4000), true);

  const chunks = [chunk("fmt ", fmt), chunk("data", data)];
  if (tags) {
    const enc = new TextEncoder();
    const info = Object.entries({ INAM: tags.title, IART: tags.artist, IPRD: tags.album })
      .filter((e): e is [string, string] => e[1] !== undefined)
      .map(([id, value]) => chunk(id, enc.encode(`${value}\0`)));
    chunks.push(chunk("LIST", concat([enc.encode("INFO"), ...info])));
  }
  if (cover) chunks.push(chunk("id3 ", id3WithCover(cover, "image/png")));

  const body = concat([new TextEncoder().encode("WAVE"), ...chunks]);
  return concat([new TextEncoder().encode("RIFF"), new Uint8Array(new Uint32Array([body.length]).buffer), body]);
}

/** Smallest valid PNG: 1×1, one transparent pixel. */
export const TINY_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);

export interface TestApp {
  app: AppServer;
  url: string;
  root: string;
  home: string;
  music: string;
  dirs: { dataDir: string; cacheDir: string; configDir: string };
  /** fetch against the server, sending the Origin a browser would for non-GET requests. */
  api(pathname: string, init?: RequestInit & { json?: unknown }): Promise<Response>;
  close(): Promise<void>;
}

export async function startTestApp(
  options: { registry?: Partial<Registry>; env?: Record<string, string | undefined> } & Partial<ServerOptions> = {},
): Promise<TestApp> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lrcgen-server-"));
  const home = path.join(root, "home");
  const music = path.join(home, "Music");
  await mkdir(music, { recursive: true });
  const dirs = {
    dataDir: path.join(root, "data"),
    cacheDir: path.join(root, "cache"),
    configDir: path.join(root, "config"),
  };
  let app: AppServer;
  try {
    app = await createServer({
      port: 0,
      homeDir: home,
      heartbeatMs: 50,
      ...dirs,
      ...options,
      env: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: dirs.configDir, ...options.env },
    });
  } catch (e) {
    await rm(root, { recursive: true, force: true });
    throw e;
  }
  const url = app.url;
  return {
    app,
    url,
    root,
    home,
    music,
    dirs,
    api(pathname, init = {}) {
      const { json, ...rest } = init;
      const headers = new Headers(rest.headers);
      const method = rest.method ?? "GET";
      if (method !== "GET" && !headers.has("origin")) headers.set("origin", url);
      if (json !== undefined) headers.set("content-type", "application/json");
      return fetch(`${url}${pathname}`, { ...rest, method, headers, body: json === undefined ? rest.body : JSON.stringify(json) });
    },
    async close() {
      await app.stop();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export function q(params: Record<string, string>): string {
  return `?${new URLSearchParams(params)}`;
}
