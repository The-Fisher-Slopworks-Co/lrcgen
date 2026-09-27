// Opens the Save dialog, optionally scrolled to the publish section (Preview's "Publish to the database…").

import { openDialog } from "../../state";

export type SaveFocus = "save" | "publish";

let pending: SaveFocus = "save";

export function openSaveDialog(focus: SaveFocus = "save"): void {
  pending = focus;
  openDialog("save");
}

/** Read once by the dialog when it opens. */
export function takeSaveFocus(): SaveFocus {
  const focus = pending;
  pending = "save";
  return focus;
}
