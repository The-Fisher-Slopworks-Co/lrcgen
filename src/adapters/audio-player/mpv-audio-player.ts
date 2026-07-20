import type { AudioPlayer } from "../../ports/audio-player";
import type { Subprocess } from "bun";
import { existsSync, unlinkSync } from "node:fs";

export class MpvAudioPlayer implements AudioPlayer {
  private process: Subprocess | null = null;
  private filePath: string;
  private socketPath: string;
  private _duration: number = 0;
  private _position: number = 0;
  private _playing: boolean = false;
  private positionCallbacks: Set<(ms: number) => void> = new Set();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private _segmentEndMs: number | null = null;
  private segmentTimer: ReturnType<typeof setTimeout> | null = null;
  private socket: Awaited<ReturnType<typeof Bun.connect>> | null = null;
  private pendingRequests: Map<number, (value: unknown) => void> = new Map();
  private nextReqId: number = 1;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.socketPath = `/tmp/lrcgen-mpv-${process.pid}-${Date.now()}.sock`;
  }

  async init(): Promise<void> {
    this.process = Bun.spawn([
      "mpv",
      "--no-video",
      "--pause",
      "--idle=once",
      "--keep-open=yes",
      "--input-terminal=no",
      "--really-quiet",
      `--input-ipc-server=${this.socketPath}`,
      this.filePath,
    ], { stdout: "ignore", stderr: "ignore" });

    await this.waitForSocket();
    await this.connectSocket();
    this.sendCommand("observe_property", 1, "eof-reached");

    // Duration is unavailable until mpv finishes loading the file; poll briefly.
    for (let i = 0; i < 40; i++) {
      const duration = await this.getProperty("duration");
      if (typeof duration === "number") {
        this._duration = Math.round(duration * 1000);
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  play(fromMs?: number): void {
    this.clearSegmentTimer();
    this._segmentEndMs = null;
    this.sendCommand("seek", (fromMs ?? 0) / 1000, "absolute");
    this.sendCommand("set_property", "pause", false);
    this._playing = true;
    this.startTicker();
  }

  playSegment(fromMs: number, toMs: number): void {
    this.clearSegmentTimer();
    this._segmentEndMs = toMs;
    this.sendCommand("seek", fromMs / 1000, "absolute");
    this.sendCommand("set_property", "pause", false);
    this._playing = true;
    this.startTicker();

    this.segmentTimer = setTimeout(() => {
      this.sendCommand("set_property", "pause", true);
      this._position = toMs;
      this._playing = false;
      this.stopTicker();
      this.notifyPosition();
    }, toMs - fromMs);
  }

  pause(): void {
    if (!this._playing) return;
    this.clearSegmentTimer();
    this.sendCommand("set_property", "pause", true);
    this._playing = false;
    this.stopTicker();
    this.fetchPosition();
  }

  resume(): void {
    if (this._playing) return;
    this.sendCommand("set_property", "pause", false);
    this._playing = true;
    this.startTicker();
  }

  seek(ms: number): void {
    this.play(ms);
  }

  getCurrentPosition(): number {
    if (this._segmentEndMs !== null) {
      return Math.min(this._position, this._segmentEndMs);
    }
    return this._position;
  }

  getDuration(): number {
    return this._duration;
  }

  onPosition(callback: (ms: number) => void): () => void {
    this.positionCallbacks.add(callback);
    return () => { this.positionCallbacks.delete(callback); };
  }

  dispose(): void {
    this.stopTicker();
    this.clearSegmentTimer();
    this._playing = false;
    this.socket?.end();
    this.socket = null;
    if (this.process) { this.process.kill(); this.process = null; }
    try { unlinkSync(this.socketPath); } catch {}
  }

  // --- IPC via Unix socket ---

  private async waitForSocket(): Promise<void> {
    // Bun.file().exists() only reports regular files, never sockets — use existsSync.
    for (let i = 0; i < 100; i++) {
      if (existsSync(this.socketPath)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private async connectSocket(): Promise<void> {
    const self = this;
    let buffer = "";

    this.socket = await Bun.connect({
      unix: this.socketPath,
      socket: {
        data(_socket, data) {
          buffer += new TextDecoder().decode(data);
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              // Route responses to pending requests
              if (msg.request_id !== undefined && self.pendingRequests.has(msg.request_id)) {
                const resolve = self.pendingRequests.get(msg.request_id)!;
                self.pendingRequests.delete(msg.request_id);
                resolve(msg.data);
              }
              // With --keep-open mpv pauses at EOF instead of quitting; track it
              if (msg.event === "property-change" && msg.name === "eof-reached" && msg.data === true) {
                self._playing = false;
                self.stopTicker();
                if (self._duration > 0) self._position = self._duration;
                self.notifyPosition();
              }
              // Handle end-of-file event
              if (msg.event === "end-file") {
                self._playing = false;
                self.stopTicker();
              }
            } catch {}
          }
        },
        open() {},
        close() { self.socket = null; },
        error() {},
      },
    });
  }

  private sendCommand(...args: unknown[]): void {
    if (!this.socket) return;
    this.socket.write(JSON.stringify({ command: args }) + "\n");
  }

  private async getProperty(name: string): Promise<unknown> {
    if (!this.socket) return null;
    const id = this.nextReqId++;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve(null);
      }, 2000);
      this.pendingRequests.set(id, (value) => {
        clearTimeout(timeout);
        resolve(value);
      });
      this.socket!.write(JSON.stringify({ command: ["get_property", name], request_id: id }) + "\n");
    });
  }

  private async fetchPosition(): Promise<void> {
    const pos = await this.getProperty("time-pos");
    if (typeof pos === "number") {
      this._position = Math.round(pos * 1000);
    }
  }

  private startTicker(): void {
    this.stopTicker();
    this.ticker = setInterval(() => {
      if (!this._playing) return;
      this.fetchPosition().then(() => this.notifyPosition());
    }, 50);
  }

  private notifyPosition(): void {
    const pos = this.getCurrentPosition();
    for (const cb of this.positionCallbacks) { cb(pos); }
  }

  private stopTicker(): void {
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null; }
  }

  private clearSegmentTimer(): void {
    if (this.segmentTimer) { clearTimeout(this.segmentTimer); this.segmentTimer = null; }
  }
}
