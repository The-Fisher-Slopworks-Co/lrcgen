// The file-browser page: header ("Open a song"), the open screen, and the key-hints footer from the board.

import { AppHeader } from "../components/AppHeader";
import { ErrorBoundary } from "../components/feedback";
import { KeyHints } from "../components/KeyHints";
import { SlotProvider } from "../components/slots";
import { OpenScreen } from "../screens/open/OpenScreen";

const HINTS = [
  { keys: ["ArrowUp", "ArrowDown"], label: "select" },
  { keys: ["Enter"], label: "open" },
  { keys: ["Backspace"], label: "up a folder" },
  { keys: ["/"], label: "filter" },
];

export function OpenLayout() {
  return (
    <SlotProvider>
      <div className="app-shell">
        <AppHeader variant="open" />
        <main className="app-body">
          <ErrorBoundary>
            <OpenScreen />
          </ErrorBoundary>
        </main>
        <KeyHints hints={HINTS} note="Works offline · the network is only used for the lyrics database and transcription" />
      </div>
    </SlotProvider>
  );
}
