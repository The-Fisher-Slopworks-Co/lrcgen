import type { LyricsDoc } from "../core/lyrics";
import type { Draft, Step, WebSettings } from "../shared/api";
import { STEPS } from "../shared/api";
import { isEnhancedLrcPath } from "../core/enhanced-lrc";
import { lyricsDocProblem, readLyricsDoc } from "../core/lyrics-file";
import { badRequest, clientPath } from "./http";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function lyricsDoc(value: unknown, what = "doc"): LyricsDoc {
  const problem = lyricsDocProblem(value);
  if (problem) throw badRequest(`"${what}" is not a lyrics document: ${problem}`);
  return readLyricsDoc(value);
}

/** A path the app may write lyrics to: an absolute "*.lrc" that isn't an ".enhanced.lrc" companion. */
export function lrcTargetPath(value: unknown, what = "path"): string {
  const filePath = clientPath(value, what);
  if (!filePath.toLowerCase().endsWith(".lrc")) throw badRequest(`"${what}" must be an .lrc file`);
  if (isEnhancedLrcPath(filePath)) {
    throw badRequest(`"${what}" must be the plain .lrc; the .enhanced.lrc companion is written next to it`);
  }
  return filePath;
}

export type DraftFields = Pick<Draft, "doc" | "step" | "lrcPath" | "dismissedFlags">;

/** The parts of a PUT draft body the client owns. */
export function draftFields(body: Record<string, unknown>): DraftFields {
  if (typeof body.step !== "string" || !(STEPS as string[]).includes(body.step)) {
    throw badRequest(`"step" must be one of ${STEPS.join(", ")}`);
  }
  const flags = body.dismissedFlags;
  if (!Array.isArray(flags) || !flags.every((f) => typeof f === "string")) {
    throw badRequest(`"dismissedFlags" must be a list of strings`);
  }
  return {
    doc: lyricsDoc(body.doc),
    step: body.step as Step,
    lrcPath: lrcTargetPath(body.lrcPath, "lrcPath"),
    dismissedFlags: flags as string[],
  };
}

export function webSettings(body: Record<string, unknown>): WebSettings {
  const t = body.transcription;
  if (!isObject(t) || !["apiKey", "baseUrl", "model"].every((k) => typeof t[k] === "string")) {
    throw badRequest(`"transcription" must have apiKey, baseUrl and model`);
  }
  const latency = body.latency;
  if (!isObject(latency) || !Object.values(latency).every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw badRequest(`"latency" must map device keys to milliseconds`);
  }
  if (!Array.isArray(body.folders)) throw badRequest(`"folders" must be a list of paths`);
  return {
    transcription: {
      apiKey: t.apiKey as string,
      baseUrl: t.baseUrl as string,
      model: t.model as string,
    },
    latency: latency as Record<string, number>,
    folders: [...new Set(body.folders.map((f) => clientPath(f, "folders[]")))],
  };
}
