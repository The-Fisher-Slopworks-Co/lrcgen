#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { App } from "./ui/app";
import { createDefaultRegistry } from "./registry";
import { detectBackend } from "./adapters/audio-source/local-audio-source";

async function main() {
  const backend = await detectBackend();
  if (!backend) {
    console.error("No audio player found. Install mpv (https://mpv.io) or ffmpeg (https://ffmpeg.org/download.html).");
    process.exit(1);
  }
  const registry = createDefaultRegistry(backend);
  render(React.createElement(App, { registry }));
}

main();
