// Settings: transcription service (API key, base URL, model, alignment language — the old TUI's fields) and
// the output latency of the current device, with a way into Calibrate.

import { useEffect, useState, type SyntheticEvent } from "react";
import type { TranscriptionSettings } from "../../core/settings-defaults";
import { useOutputDevice } from "../audio/output-device";
import { Button, Field } from "../components/controls";
import { Icon } from "../components/icons";
import { DialogHeader, Modal } from "../components/Modal";
import { latencyCorrection } from "../lib/format";
import { closeDialog, openDialog, saveSettings } from "../state/actions";
import { useSettings } from "../state/hooks";

export function SettingsDialog() {
  const settings = useSettings();
  const device = useOutputDevice();
  const close = () => closeDialog("settings");
  const [values, setValues] = useState<TranscriptionSettings | null>(settings?.transcription ?? null);
  const [latency, setLatencyText] = useState(String(device.latencyMs));
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!values && settings) setValues(settings.transcription);
  }, [settings, values]);
  // Calibrate (opened from here) changes the stored latency: show the new value.
  useEffect(() => setLatencyText(String(device.latencyMs)), [device.latencyMs]);

  const latencyMs = Number(latency);
  const latencyValid = latency.trim() !== "" && Number.isFinite(latencyMs) && Math.abs(latencyMs) <= 2000;

  const submit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (!settings || !values || !latencyValid) return;
    setSaving(true);
    const ok = await saveSettings({ ...settings, transcription: values, latency: { ...settings.latency, [device.key]: Math.round(latencyMs) } });
    setSaving(false);
    if (ok) close();
  };

  const set = (key: keyof TranscriptionSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => v && { ...v, [key]: e.target.value });

  return (
    <Modal onClose={close} labelledBy="settings-title" style={{ width: 560 }}>
      <DialogHeader id="settings-title" title="Settings" onClose={close} />
      {!values ? (
        <p style={{ color: "var(--text-3)" }}>Loading settings…</p>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 className="eyebrow">Transcription</h2>
            <label className="field">
              API key
              <span style={{ display: "flex", gap: 8 }}>
                <input
                  className="input mono"
                  style={{ flexGrow: 1 }}
                  type={showKey ? "text" : "password"}
                  value={values.apiKey}
                  onChange={set("apiKey")}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="not set"
                />
                <Button variant="secondary" size="sm" onClick={() => setShowKey((s) => !s)} style={{ height: 38 }}>
                  {showKey ? "Hide" : "Show"}
                </Button>
              </span>
            </label>
            <Field label="Base URL" mono value={values.baseUrl} onChange={set("baseUrl")} spellCheck={false} />
            <Field label="Model" mono value={values.model} onChange={set("model")} spellCheck={false} />
            <p style={{ fontSize: 12, color: "var(--text-5)" }}>Unset values fall back to $OPENROUTER_API_KEY / $OPENAI_API_KEY and defaults.</p>
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 20, borderTop: "1px solid var(--border-1)" }}>
            <h2 className="eyebrow">Audio latency</h2>
            <span className="dialog-subtitle">
              <Icon.Headphones size={16} />
              {device.label}
            </span>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
              <Field
                label="Heard late by, ms"
                mono
                inputMode="numeric"
                value={latency}
                onChange={(e) => setLatencyText(e.target.value)}
                aria-invalid={!latencyValid}
                style={{ width: 120 }}
              />
              <span style={{ fontSize: 13, color: "var(--text-3)", paddingBottom: 10 }}>
                Taps are shifted by {latencyValid ? latencyCorrection(latencyMs) : "—"}
              </span>
              <span style={{ flexGrow: 1 }} />
              <Button variant="secondary" size="sm" onClick={() => openDialog("calibrate")} style={{ height: 38 }}>
                Calibrate…
              </Button>
            </div>
          </section>

          <div className="dialog-actions">
            <Button variant="ghost" size="dialog" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" size="dialog" type="submit" disabled={saving || !latencyValid}>
              Save
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
