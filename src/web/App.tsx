// The root: waits for app info, then shows the file browser or the song workspace depending on the route,
// with dialogs and toasts on top.

import { Button } from "./components/controls";
import { EmptyState, Toaster } from "./components/feedback";
import { Icon } from "./components/icons";
import { DialogHost } from "./dialogs/DialogHost";
import { OpenLayout } from "./layout/OpenLayout";
import { SongLayout } from "./layout/SongLayout";
import { useRoute } from "./routing/router";
import { useStore } from "./state/app-state";
import { boot } from "./state/session";

export function App() {
  const route = useRoute();
  const ready = useStore((s) => s.app !== null);
  const bootError = useStore((s) => s.bootError);

  if (bootError) {
    return (
      <div className="app-shell">
        <EmptyState
          icon={<Icon.Warning size={32} style={{ color: "var(--warn)" }} />}
          title="Can't reach lrcgen"
          actions={
            <Button variant="secondary" onClick={() => void boot()}>
              Try again
            </Button>
          }
        >
          {bootError} — start it again with <span className="mono">lrcgen</span> in a terminal.
        </EmptyState>
      </div>
    );
  }
  if (!ready || !route) return <div className="app-shell" />;

  return (
    <>
      {route.name === "song" ? <SongLayout /> : <OpenLayout />}
      <DialogHost />
      <Toaster />
    </>
  );
}
