// Calibrate audio latency (Calibrate board): 8 clicks at a steady beat, Enter on each; the taps' median lag
// (core `analyzeTaps`) is saved for the current output device. Clicks play through a SongPlayer, the same
// path songs take, and taps are read from its clock.

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeTaps, type CalibrationResult } from "../../core/calibration";
import { clickTrack, CLICK_INTERVAL_MS } from "../audio/click-track";
import { useOutputDevice } from "../audio/output-device";
import { player } from "../audio/player";
import { SongPlayer } from "../audio/song-player";
import { Button, Kbd } from "../components/controls";
import { Icon } from "../components/icons";
import { DialogHeader, Modal } from "../components/Modal";
import type { HotkeyMap } from "../hotkeys/hotkeys";
import { latencyCorrection } from "../lib/format";
import { closeDialog, setLatency, toast } from "../state/actions";

type Phase = "ready" | "running" | "done";

const STRIP_W = 582;
const STRIP_PAD = 22;
const MIN_PAIRS = 4;

export function CalibrateDialog() {
  const device = useOutputDevice();
  const track = useMemo(clickTrack, []);
  const cal = useRef<SongPlayer | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [taps, setTaps] = useState<number[]>([]);
  const [passed, setPassed] = useState(0);
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const tapsRef = useRef<number[]>([]);
  const close = () => closeDialog("calibrate");

  useEffect(() => {
    player.pause();
    const url = URL.createObjectURL(new Blob([track.wav], { type: "audio/wav" }));
    const p = new SongPlayer();
    p.load("calibration", { mixUrl: url, vocalsUrl: null, durationMs: track.durationMs });
    cal.current = p;
    const offFrame = p.onPosition((ms) => setPassed(track.clicksMs.filter((c) => c <= ms).length));
    return () => {
      offFrame();
      p.dispose();
      URL.revokeObjectURL(url);
      cal.current = null;
    };
  }, [track]);

  useEffect(() => {
    const p = cal.current;
    if (!p || phase !== "running") return;
    return p.subscribe(() => {
      if (!p.getState().playing) finish();
    });
  });

  const start = () => {
    tapsRef.current = [];
    setTaps([]);
    setResult(null);
    setPassed(0);
    setPhase("running");
    cal.current?.play(0);
  };

  const finish = () => {
    setResult(analyzeTaps(track.clicksMs, tapsRef.current));
    setPhase("done");
  };

  const tap = () => {
    const p = cal.current;
    if (!p) return;
    tapsRef.current = [...tapsRef.current, p.getCurrentPosition()];
    setTaps(tapsRef.current);
  };

  const apply = async () => {
    if (!result) return;
    if (await setLatency(device.key, result.offsetMs)) {
      toast(`Taps on ${device.label} are now shifted by ${latencyCorrection(result.offsetMs)}`);
      close();
    }
  };

  const hotkeys: HotkeyMap = {
    Enter: { run: () => (phase === "ready" ? start() : phase === "running" ? tap() : false), repeat: false },
    R: { run: () => (phase === "done" ? start() : false), repeat: false },
  };

  const usable = result !== null && result.pairs.length >= MIN_PAIRS;
  const pxPerMs = (STRIP_W - 2 * STRIP_PAD) / ((track.clicksMs.length - 1) * CLICK_INTERVAL_MS);
  const first = track.clicksMs[0] ?? 0;
  const xOf = (ms: number) => Math.min(STRIP_W - 2, Math.max(0, STRIP_PAD + (ms - first) * pxPerMs));

  return (
    <Modal onClose={close} labelledBy="cal-title" style={{ width: 640, minHeight: "min(640px, calc(100vh - 48px))" }} hotkeys={hotkeys}>
      <DialogHeader
        id="cal-title"
        title="Calibrate audio latency"
        onClose={close}
        subtitle={
          <>
            <Icon.Headphones size={16} />
            Output: {device.label}
          </>
        }
      />

      <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--text-2)" }}>
        Keep the volume where you normally listen. You'll hear 8 clicks — press <Kbd keys="Enter" /> on each one, right on the beat.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: 8 }}>
        {track.clicksMs.map((click, i) => {
          const delta = deltaFor(click, taps, result);
          const current = phase === "running" && i === passed - 1;
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <span
                className="mono"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 13,
                  background: current ? "var(--accent)" : i < passed ? "var(--selected)" : "var(--raised-2)",
                  color: current ? "var(--on-accent)" : "var(--text-1)",
                  border: `1px solid ${current ? "var(--accent)" : "var(--border-4)"}`,
                  transition: "background-color 0.08s",
                }}
              >
                {i + 1}
              </span>
              <span className="mono" style={{ fontSize: 11, color: "var(--accent)", height: 14 }}>
                {delta === null ? "" : `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta))}`}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ position: "relative", width: STRIP_W, height: 64, borderRadius: 10, background: "var(--well)", border: "1px solid var(--border-1)" }}>
          {track.clicksMs.map((c) => (
            <span key={`c${c}`} style={{ position: "absolute", top: 10, left: xOf(c), width: 2, height: 44, borderRadius: 1, background: "var(--text-1)" }} />
          ))}
          {taps.map((t, i) => (
            <span key={`t${i}`} style={{ position: "absolute", top: 18, left: xOf(t), width: 2, height: 28, borderRadius: 1, background: "var(--accent)" }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 18, fontSize: 12, color: "var(--text-3)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 2, height: 12, background: "var(--text-1)" }} />
            click
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 2, height: 12, background: "var(--accent)" }} />
            your tap
          </span>
        </div>
      </div>

      <ResultBox phase={phase} result={result} tapCount={taps.length} />

      <div style={{ flexGrow: 1 }} />
      <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-5)" }}>
        Saved for this output device and applied to every tap. Wired headphones and speakers usually need no correction.
      </p>
      <div className="dialog-actions">
        {phase === "ready" && (
          <Button variant="primary" size="dialog" kbd="Enter" onClick={start}>
            Start
          </Button>
        )}
        {phase === "running" && (
          <Button variant="secondary" size="dialog" onClick={() => cal.current?.pause()}>
            Stop
          </Button>
        )}
        {phase === "done" && (
          <>
            <Button variant="secondary" size="dialog" onClick={start}>
              Try again
            </Button>
            <Button variant="primary" size="dialog" disabled={!usable} onClick={apply}>
              Apply {result ? latencyCorrection(result.offsetMs) : ""}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

/** The lag shown under beat `i`: from the analysis when done, else the nearest tap so far. */
function deltaFor(click: number, taps: number[], result: CalibrationResult | null): number | null {
  if (result) return result.pairs.find((p) => p.clickMs === click)?.deltaMs ?? null;
  let best: number | null = null;
  for (const t of taps) {
    const d = t - click;
    if (Math.abs(d) < CLICK_INTERVAL_MS / 2 && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

function ResultBox({ phase, result, tapCount }: { phase: Phase; result: CalibrationResult | null; tapCount: number }) {
  const box = (borderColor = "var(--accent-banner-border)") => ({
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    padding: "18px 20px",
    borderRadius: 12,
    background: "var(--raised-2)",
    border: `1px solid ${borderColor}`,
    minHeight: 118,
    justifyContent: "center",
  });
  if (phase !== "done" || !result) {
    return (
      <div style={box("var(--border-3)")}>
        <span style={{ fontSize: 14, color: "var(--text-2)" }}>
          {phase === "ready" ? "Press Start, then Enter on each click." : `Listening… ${tapCount} of 8 taps`}
        </span>
      </div>
    );
  }
  if (result.pairs.length < MIN_PAIRS) {
    return (
      <div style={box("var(--warn)")}>
        <span style={{ fontSize: 14, color: "var(--text-2)" }}>Not enough taps landed near the clicks to measure.</span>
        <span style={{ fontSize: 13, color: "var(--text-3)" }}>Try again and press Enter on each click.</span>
      </div>
    );
  }
  const late = result.offsetMs >= 0;
  return (
    <div style={box()}>
      <span style={{ fontSize: 14, color: "var(--text-2)" }}>Your taps land {late ? "late" : "early"} by</span>
      <span className="mono" style={{ fontSize: 34, fontWeight: 500, color: "var(--accent)" }}>
        {Math.abs(Math.round(result.offsetMs))} ms
      </span>
      <span style={{ fontSize: 13, color: "var(--text-3)" }}>
        Spread ±{Math.round(result.spreadMs)} ms across {result.pairs.length} taps —{" "}
        {result.steady ? "a steady result." : "not very steady; try again for a better reading."}
      </span>
    </div>
  );
}
