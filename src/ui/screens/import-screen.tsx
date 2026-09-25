import { useState } from "react";
import { Box, Text } from "ink";
import type { LrcParser } from "../../ports/lrc-parser";
import type { LrcDocument } from "../../core/lrc-document";
import { FilePicker } from "../components/file-picker";
import { readLrcFile } from "../../adapters/lrc-files";

interface ImportScreenProps {
  lrcParser: LrcParser;
  onImport: (doc: LrcDocument, filePath: string) => void;
  onCancel: () => void;
}

export function ImportScreen({ lrcParser, onImport, onCancel }: ImportScreenProps) {
  const [error, setError] = useState<string | null>(null);

  return (
    <Box flexDirection="column">
      {error && <Text color="red">{error}</Text>}
      <FilePicker
        extensions={[".lrc"]}
        onSelect={async (filePath) => {
          try {
            onImport(await readLrcFile(filePath, lrcParser), filePath);
          } catch (e) {
            setError(`Failed to read file: ${e}`);
          }
        }}
        onCancel={onCancel}
      />
    </Box>
  );
}
