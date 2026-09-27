// Renders the open dialogs from the store, stacked in the order they were opened (Settings → Calibrate).
// Open one with `openDialog("save" | "settings" | "calibrate")`; "transcript" opens itself when needed.

import { useStore } from "../state/app-state";
import { SaveDialog } from "../screens/save/SaveDialog";
import { CalibrateDialog } from "./CalibrateDialog";
import { SettingsDialog } from "./SettingsDialog";
import { TranscriptCompareDialog } from "./TranscriptCompareDialog";

export function DialogHost() {
  const dialogs = useStore((s) => s.dialogs);
  const songOpen = useStore((s) => s.song !== null);
  return (
    <>
      {dialogs.map((kind) => {
        switch (kind) {
          case "settings":
            return <SettingsDialog key={kind} />;
          case "calibrate":
            return <CalibrateDialog key={kind} />;
          case "save":
            return songOpen ? <SaveDialog key={kind} /> : null;
          case "transcript":
            return songOpen ? <TranscriptCompareDialog key={kind} /> : null;
        }
      })}
    </>
  );
}
