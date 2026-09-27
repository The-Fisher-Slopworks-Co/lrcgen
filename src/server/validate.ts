import type { LrcDocument } from "../core/lrc-document";
import type { Draft, Step, WebSettings } from "../shared/api";
import { STEPS } from "../shared/api";
import { isEnhancedLrcPath } from "../core/enhanced-lrc";
import { badRequest, clientPath } from "./http";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTime = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));

function isWord(v: unknown): boolean {
  return isObject(v) && isTime(v.start) && typeof v.text === "string";
}

function isLine(v: unknown): boolean {
  if (!isObject(v) || !isTime(v.timestamp) || typeof v.text !== "string") return false;
  if (v.words !== undefined && !(Array.isArray(v.words) && v.words.every(isWord))) return false;
  return v.end === undefined || isTime(v.end);
}

export function lrcDocument(value: unknown, what = "doc"): LrcDocument {
  if (!isObject(value) || !isObject(value.metadata) || !Array.isArray(value.lines)) {
    throw badRequest(`"${what}" is not a lyrics document`);
  }
  if (!Object.values(value.metadata).every((v) => v === undefined || typeof v === "string")) {
    throw badRequest(`"${what}.metadata" must hold strings`);
  }
  if (!value.lines.every(isLine)) throw badRequest(`"${what}.lines" has a malformed line`);
  return value as unknown as LrcDocument;
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
    doc: lrcDocument(body.doc),
    step: body.step as Step,
    lrcPath: lrcTargetPath(body.lrcPath, "lrcPath"),
    dismissedFlags: flags as string[],
  };
}

export function webSettings(body: Record<string, unknown>): WebSettings {
  const t = body.transcription;
  if (!isObject(t) || !["apiKey", "baseUrl", "model", "alignLang"].every((k) => typeof t[k] === "string")) {
    throw badRequest(`"transcription" must have apiKey, baseUrl, model and alignLang`);
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
      alignLang: t.alignLang as string,
    },
    latency: latency as Record<string, number>,
    folders: [...new Set(body.folders.map((f) => clientPath(f, "folders[]")))],
  };
}
