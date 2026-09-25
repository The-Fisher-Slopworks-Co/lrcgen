import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { KeyHints } from "../components/key-hints";

type StartAction = "create" | "import" | "settings";

interface StartScreenProps {
  onSelect: (action: StartAction) => void;
}

const items = [
  { label: "Create new LRC", value: "create" as const },
  { label: "Import existing LRC", value: "import" as const },
  { label: "Settings", value: "settings" as const },
];

export function StartScreen({ onSelect }: StartScreenProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="cyan">lrcgen</Text>
      </Box>
      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
      <Box marginTop={1}>
        <KeyHints hints={[{ key: "↑↓", label: "navigate" }, { key: "⏎", label: "select" }]} />
      </Box>
    </Box>
  );
}
