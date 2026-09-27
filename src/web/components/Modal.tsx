// A modal dialog: backdrop, panel, focus kept inside, Esc and backdrop click close it, and a blocking
// hotkey layer so the song's keys don't fire underneath. Size it through the panel's `style`.
//   <Modal onClose={close} labelledBy="save-title" style={{ width: 720, height: 800 }} hotkeys={{ "Ctrl+S": save }}>
//     <DialogHeader id="save-title" title="Save & publish" onClose={close} />
//     …
//   </Modal>
// The dialog's keys go in `hotkeys` (or in useHotkeys inside a component rendered *within* the Modal):
// useHotkeys called in the component that renders <Modal> registers outside the modal's layer and is blocked.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HotkeyLayer, useHotkeys, type HotkeyMap } from "../hotkeys/hotkeys";
import { IconButton } from "./controls";
import { Icon } from "./icons";

export interface ModalProps {
  onClose: () => void;
  /** Id of the element naming the dialog (usually the DialogHeader title). */
  labelledBy?: string;
  /**
   * Adds the boards' 28 px padding and 22 px gap, and scrolls the panel when the window is too short.
   * Default true. Unpadded panels are clipped to the window: give them their own scroll container.
   */
  padded?: boolean;
  /** Close on backdrop click. Default true. */
  dismissible?: boolean;
  /** Keys while the dialog is open. "Escape" closes it unless overridden here. */
  hotkeys?: HotkeyMap;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
}

export function Modal(props: ModalProps) {
  // Read while rendering, before the dialog or anything in it (autoFocus, child effects) moves focus.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(
    () => () => {
      // Give focus back unless something else has already taken it (e.g. a screen the dialog navigated to).
      const active = document.activeElement;
      const lost = !active || active === document.body || !!panelRef.current?.contains(active);
      if (lost && opener?.isConnected) opener.focus({ preventScroll: true });
    },
    [opener],
  );
  return createPortal(
    <HotkeyLayer blocking>
      <ModalBody {...props} panelRef={panelRef} />
    </HotkeyLayer>,
    document.body,
  );
}

function ModalBody({
  onClose,
  labelledBy,
  padded = true,
  dismissible = true,
  hotkeys,
  style,
  className,
  children,
  panelRef: panel,
}: ModalProps & { panelRef: React.RefObject<HTMLDivElement | null> }) {
  useHotkeys({ Escape: { run: () => onClose(), inInputs: true }, ...hotkeys });

  useEffect(() => {
    const el = panel.current;
    if (el && !el.contains(document.activeElement)) {
      const first = el.querySelector<HTMLElement>("[autofocus], input, textarea, select");
      (first ?? el).focus();
    }
  }, [panel]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panel.current) return;
    const focusable = [...panel.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
      (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={["modal-panel", padded && "padded", className].filter(Boolean).join(" ")}
        style={style}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

/** Title (display font, 20 px), optional subtitle line, close button. */
export function DialogHeader({ id, title, subtitle, onClose }: { id?: string; title: ReactNode; subtitle?: ReactNode; onClose: () => void }) {
  return (
    <div className="dialog-header">
      <div className="titles">
        <h1 id={id} className="dialog-title">
          {title}
        </h1>
        {subtitle && <span className="dialog-subtitle">{subtitle}</span>}
      </div>
      <IconButton label="Close" onClick={onClose}>
        <Icon.Close />
      </IconButton>
    </div>
  );
}
