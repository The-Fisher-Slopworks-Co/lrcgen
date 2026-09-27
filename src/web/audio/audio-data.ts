// Decoded samples of the open song for waveforms, spectrograms and flags. The mix and the vocal stem are
// fetched and decoded once per song (resampled to ANALYSIS_RATE to keep loops short), then cached.
//   const { mix, vocals, envelope, voiceOnsetAfter, loading } = useAudioData();
//   const flags = useFlags();   // findFlags on the current doc, with voice onsets when there is a stem

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { findFlags, type Flag } from "../../core/flags";
import { energyEnvelope, voiceOnsetAfter as onsetAfter } from "../../core/voice-activity";
import { audioUrl, vocalsUrl } from "../api/client";
import { useStore } from "../state/app-state";
import { shallowEqual } from "../state/store";
import { toAudioData, type AudioData } from "./analysis";

/** Sample rate the analysis works at: plenty for waveforms and a vocal spectrogram (up to 11 kHz). */
export const ANALYSIS_RATE = 22050;
/** Frame length of the vocal energy envelope. */
export const ENVELOPE_FRAME_MS = 10;

export interface SongAudio {
  mix: AudioData | null;
  vocals: AudioData | null;
  /** Vocal RMS per ENVELOPE_FRAME_MS frame, loudest = 1 (null without a stem). */
  envelope: Float32Array | null;
  /** `FlagOptions.voiceOnsetAfter` for the stem; undefined without one. */
  voiceOnsetAfter: ((ms: number) => number | null) | undefined;
  /** Something is still being fetched or decoded. */
  loading: boolean;
  error: string | null;
}

const EMPTY: SongAudio = { mix: null, vocals: null, envelope: null, voiceOnsetAfter: undefined, loading: false, error: null };

// ---------------------------------------------------------------- decoding, cached by URL

const cache = new Map<string, Promise<AudioData>>();
const CACHE_LIMIT = 4;

export function loadAudioData(url: string): Promise<AudioData> {
  const hit = cache.get(url);
  if (hit) return hit;
  const promise = decode(url);
  cache.set(url, promise);
  promise.catch(() => cache.delete(url));
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return promise;
}

async function decode(url: string): Promise<AudioData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load the audio (${res.status})`);
  const bytes = await res.arrayBuffer();
  // decodeAudioData runs off the main thread and resamples to the context's rate.
  const ctx = new OfflineAudioContext(1, 1, ANALYSIS_RATE);
  const buffer = await ctx.decodeAudioData(bytes);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  return toAudioData(channels, buffer.sampleRate);
}

// ---------------------------------------------------------------- the open song's audio

let current: { key: string; audio: SongAudio } = { key: "", audio: EMPTY };
const listeners = new Set<() => void>();

function publish(key: string, update: Partial<SongAudio>): void {
  if (current.key !== key) return;
  current = { key, audio: { ...current.audio, ...update } };
  for (const l of [...listeners]) l();
}

function ensure(path: string | null, stemVersion: number | null): void {
  const key = path ? `${path}|${stemVersion ?? "none"}` : "";
  if (current.key === key) return;
  current = { key, audio: path ? { ...EMPTY, loading: true } : EMPTY };
  for (const l of [...listeners]) l();
  if (!path) return;

  const mixDone = loadAudioData(audioUrl(path)).then(
    (mix) => publish(key, { mix }),
    (err: unknown) => publish(key, { error: String(err instanceof Error ? err.message : err) }),
  );
  const vocalsDone =
    stemVersion === null
      ? Promise.resolve()
      : loadAudioData(vocalsUrl(path, stemVersion))
          .then((vocals) => {
            publish(key, { vocals });
            const envelope = energyEnvelope(vocals.samples, vocals.sampleRate, ENVELOPE_FRAME_MS);
            const voiceOnsetAfter = (ms: number) => onsetAfter(envelope, ENVELOPE_FRAME_MS, ms);
            publish(key, { envelope, voiceOnsetAfter });
          })
          .catch((err: unknown) => publish(key, { error: String(err instanceof Error ? err.message : err) }));
  void Promise.all([mixDone, vocalsDone]).then(() => publish(key, { loading: false }));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Samples of the open song (starts decoding on first use). */
export function useAudioData(): SongAudio {
  const { path, stemVersion } = useStore(
    (s) => ({
      path: s.song?.draft.audioPath ?? null,
      stemVersion: s.song?.track?.hasVocals ? s.song.vocalsVersion : null,
    }),
    shallowEqual,
  );
  useEffect(() => ensure(path, stemVersion), [path, stemVersion]);
  const audio = useSyncExternalStore(subscribe, () => current.audio);
  const key = path ? `${path}|${stemVersion ?? "none"}` : "";
  return current.key === key ? audio : path ? { ...EMPTY, loading: true } : EMPTY;
}

const NO_FLAGS: string[] = [];

/** "Worth a look" flags for the current document, minus the dismissed ones. */
export function useFlags(): Flag[] {
  const doc = useStore((s) => s.song?.history.present.value ?? null);
  const dismissed = useStore((s) => s.song?.draft.dismissedFlags ?? NO_FLAGS);
  const { voiceOnsetAfter } = useAudioData();
  return useMemo(
    () => (doc ? findFlags(doc, { voiceOnsetAfter, dismissed: new Set(dismissed) }) : []),
    [doc, dismissed, voiceOnsetAfter],
  );
}
