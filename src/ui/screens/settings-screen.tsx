import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { SettingsStore } from "../../ports/settings-store";
import { resolveTranscriptionSettings, type TranscriptionSettings } from "../../core/settings-defaults";
import { KeyHints } from "../components/key-hints";

interface SettingsScreenProps {
  settingsStore: SettingsStore;
  onDone: () => void;
}

const FIELDS: Array<{ key: keyof TranscriptionSettings; label: string; mask?: string }> = [
  { key: "apiKey", label: "API key", mask: "*" },
  { key: "baseUrl", label: "Base URL" },
  { key: "model", label: "Model" },
  { key: "alignLang", label: "Align language (ISO 639-3)" },
];

export function SettingsScreen({ settingsStore, onDone }: SettingsScreenProps) {
  const [values, setValues] = useState<TranscriptionSettings | null>(null);
  const [fieldIndex, setFieldIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    settingsStore.load().then((stored) => {
      setValues(resolveTranscriptionSettings(stored.transcription, process.env));
    });
  }, [settingsStore]);

  function commit(value: string) {
    const next = { ...values!, [FIELDS[fieldIndex]!.key]: value };
    setValues(next);
    setEditing(false);
    settingsStore.save({ transcription: next }).then((result) => {
      setSaveError(result.success ? null : result.error ?? "Failed to save settings");
    });
  }

  useInput((input, key) => {
    if (!values) return;
    if (editing) {
      if (key.escape) setEditing(false);
      return;
    }
    if (key.upArrow) {
      setFieldIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setFieldIndex((i) => Math.min(FIELDS.length - 1, i + 1));
    } else if (key.return) {
      setDraft(values[FIELDS[fieldIndex]!.key]);
      setEditing(true);
    } else if (key.escape || input === "q") {
      onDone();
    }
  });

  if (!values) {
    return (
      <Box padding={1}>
        <Text dimColor>Loading settings...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Settings</Text>
      <Box flexDirection="column" marginY={1}>
        {FIELDS.map((f, i) => {
          const selected = i === fieldIndex;
          const value = values[f.key];
          const display = f.mask && value ? "*".repeat(Math.min(value.length, 16)) : value || "(not set)";
          return (
            <Box key={f.key}>
              <Text color={selected ? "cyan" : undefined} bold={selected}>
                {selected ? "▸ " : "  "}
                {f.label}
                {": "}
              </Text>
              {editing && selected ? (
                <TextInput value={draft} onChange={setDraft} mask={f.mask} onSubmit={commit} />
              ) : (
                <Text dimColor={!value}>{display}</Text>
              )}
            </Box>
          );
        })}
      </Box>
      {saveError && <Text color="red">Failed to save: {saveError}</Text>}
      <Text dimColor>Unset values fall back to $OPENROUTER_API_KEY / $OPENAI_API_KEY and defaults.</Text>
      <Box marginTop={1}>
        <KeyHints
          hints={
            editing
              ? [{ key: "⏎", label: "save" }, { key: "Esc", label: "cancel" }]
              : [{ key: "↑↓", label: "navigate" }, { key: "⏎", label: "edit" }, { key: "Esc", label: "back" }]
          }
        />
      </Box>
    </Box>
  );
}
