// The song workspace: header, the current step's screen, and the transport footer configured per step
// (Lyrics has none; Refine shows loop/vocals as chips). Registers the workspace-wide keys at priority -1
// so a screen's own bindings win: Space play/pause, V vocals only, L loop line, Ctrl+Z / Ctrl+Shift+Z
// (and Ctrl+Y) undo/redo, Ctrl+S Save dialog.

import type { ComponentType } from "react";
import type { Step } from "../../shared/api";
import { AppHeader } from "../components/AppHeader";
import { Button } from "../components/controls";
import { EmptyState, ErrorBoundary, Loading } from "../components/feedback";
import { Icon } from "../components/icons";
import { SlotProvider } from "../components/slots";
import { TransportBar, type TransportBarProps } from "../components/TransportBar";
import { useHotkeys } from "../hotkeys/hotkeys";
import { STEP_BODY_ID } from "../lib/focus";
import { goToOpen } from "../routing/router";
import { openDialog, redo, undo } from "../state/actions";
import { useStore } from "../state/app-state";
import { useStep } from "../state/hooks";
import { toggleLoopLine, togglePlay, toggleVocals } from "../state/transport";
import { LinesScreen } from "../screens/lines/LinesScreen";
import { LyricsScreen } from "../screens/lyrics/LyricsScreen";
import { PreviewScreen } from "../screens/preview/PreviewScreen";
import { RefineScreen } from "../screens/refine/RefineScreen";
import { WordsScreen } from "../screens/words/WordsScreen";

const SCREENS: Record<Step, ComponentType> = {
  lyrics: LyricsScreen,
  lines: LinesScreen,
  words: WordsScreen,
  refine: RefineScreen,
  preview: PreviewScreen,
};

/** Which transport controls each step shows (null = no footer), as on the boards. */
export const STEP_TRANSPORT: Record<Step, TransportBarProps | null> = {
  lyrics: null,
  lines: { speed: true, vocals: true, loop: true },
  words: { speed: true, vocals: true, loop: false, hint: "Slowed down without changing pitch — taps are converted back to real time" },
  refine: { speed: false, vocals: false, loop: false },
  preview: { speed: true, vocals: true, loop: false },
};

export function SongLayout() {
  const step = useStep()?.step ?? "lyrics";
  const open = useStore((s) => s.song !== null);
  const openError = useStore((s) => s.openError);

  return (
    <SlotProvider>
      <div className="app-shell">
        <AppHeader variant="song" />
        {open ? (
          <SongWorkspace step={step} />
        ) : openError ? (
          <main className="app-body">
            <EmptyState
              icon={<Icon.Warning size={32} style={{ color: "var(--warn)" }} />}
              title="Couldn't open this song"
              actions={
                <Button variant="secondary" onClick={() => goToOpen()}>
                  Back to your songs
                </Button>
              }
            >
              {openError}
            </EmptyState>
          </main>
        ) : (
          <main className="app-body">
            <Loading>Opening the song…</Loading>
          </main>
        )}
      </div>
    </SlotProvider>
  );
}

function SongWorkspace({ step }: { step: Step }) {
  const Screen = SCREENS[step];
  const transport = STEP_TRANSPORT[step];

  useHotkeys(
    {
      Space: { run: togglePlay },
      V: { run: toggleVocals, repeat: false },
      L: { run: toggleLoopLine, repeat: false },
      "Ctrl+Z": undo,
      "Ctrl+Shift+Z": redo,
      "Ctrl+Y": redo,
      "Ctrl+S": { run: () => openDialog("save"), inInputs: true },
    },
    { priority: -1 },
  );

  return (
    <>
      <main id={STEP_BODY_ID} className="app-body" tabIndex={-1}>
        <ErrorBoundary key={step}>
          <Screen />
        </ErrorBoundary>
      </main>
      {transport && <TransportBar {...transport} />}
    </>
  );
}
