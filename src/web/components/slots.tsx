// Slots let a screen put things into the shared header and footer without owning them:
//   <HeaderExtras><Chip tone="vocals" size="lg"><Icon.Check size={13} />Vocals separated</Chip></HeaderExtras>
//   <TransportExtras><span className="transport-hint">Slowed down without changing pitch…</span></TransportExtras>
// Whatever a screen renders into a slot disappears with the screen.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface SlotTargets {
  header: HTMLElement | null;
  transport: HTMLElement | null;
}

const SlotContext = createContext<{ targets: SlotTargets; setTarget: (name: keyof SlotTargets, el: HTMLElement | null) => void } | null>(null);

export function SlotProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<SlotTargets>({ header: null, transport: null });
  const setTarget = useCallback(
    (name: keyof SlotTargets, el: HTMLElement | null) => setTargets((t) => (t[name] === el ? t : { ...t, [name]: el })),
    [],
  );
  const value = useMemo(() => ({ targets, setTarget }), [targets, setTarget]);
  return <SlotContext.Provider value={value}>{children}</SlotContext.Provider>;
}

/** Where the header/footer render slot content. */
export function SlotTarget({ name, className }: { name: keyof SlotTargets; className?: string }) {
  const setTarget = useContext(SlotContext)?.setTarget;
  // A stable callback: a new one each render would detach and re-attach the target in a loop.
  const ref = useCallback((el: HTMLDivElement | null) => setTarget?.(name, el), [setTarget, name]);
  return <div className={className} ref={ref} />;
}

function Slot({ name, children }: { name: keyof SlotTargets; children: ReactNode }) {
  const target = useContext(SlotContext)?.targets[name];
  return target ? createPortal(children, target) : null;
}

/** Content for the header, between the step navigation and the save status. */
export function HeaderExtras({ children }: { children: ReactNode }) {
  return <Slot name="header">{children}</Slot>;
}

/** Content for the transport footer, after the built-in controls (before the output device). */
export function TransportExtras({ children }: { children: ReactNode }) {
  return <Slot name="transport">{children}</Slot>;
}
