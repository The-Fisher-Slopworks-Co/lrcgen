// Moving focus to the song's step body, e.g. after a header link changed the step: focus left on the link
// would make screens treat their keys (Enter…) as meant for that control.

export const STEP_BODY_ID = "step-body";

export function focusStepBody(): void {
  document.getElementById(STEP_BODY_ID)?.focus({ preventScroll: true });
}
