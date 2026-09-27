// Toasts (fed by `toast()` from the store), empty/loading states, and an error boundary that keeps a crashing
// screen from taking the header and transport down with it.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { dismissToast } from "../state/actions";
import { useStore } from "../state/app-state";
import { Button, IconButton } from "./controls";
import { Icon } from "./icons";

export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={t.kind === "error" ? "toast error" : "toast"}>
          {t.kind === "error" && <Icon.Warning size={16} style={{ color: "var(--warn)", flexShrink: 0 }} />}
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="action"
              onClick={() => {
                dismissToast(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          )}
          <IconButton label="Dismiss" className="close" onClick={() => dismissToast(t.id)}>
            <Icon.Close size={14} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

/** A centred message filling its container: nothing here yet, loading, or something went wrong. */
export function EmptyState({ icon, title, children, actions }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <div className="icon">{icon}</div>}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Loading({ children = "Loading…" }: { children?: ReactNode }) {
  return <EmptyState icon={<Icon.Spinner size={28} />} title={children} />;
}

export class ErrorBoundary extends Component<{ children: ReactNode; title?: string }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <EmptyState
        icon={<Icon.Warning size={32} style={{ color: "var(--warn)" }} />}
        title={this.props.title ?? "This part of lrcgen crashed"}
        actions={
          <Button variant="secondary" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        }
      >
        {error.message}
      </EmptyState>
    );
  }
}
