// ─────────────────────────────────────────────────────────────
// ui/error-boundary — last-resort render guard
// ─────────────────────────────────────────────────────────────
// A render error anywhere in the editor would otherwise unmount the whole React
// tree to a blank webview (losing access to the in-memory document). This catches
// it, shows a recoverable surface, and lets the user retry or reload (BP-M2).

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // No telemetry backend yet — log so a packaged build leaves a breadcrumb.
    console.error("[Artisan] Unhandled render error:", error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 32,
          textAlign: "center",
          color: "var(--text, #e6e9f0)",
          background: "var(--surface, rgba(20,22,30,0.92))",
          font: "13px/1.5 system-ui, sans-serif",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16 }}>Something went wrong</h2>
        <p style={{ margin: 0, opacity: 0.8, maxWidth: 420 }}>
          The editor hit an unexpected error. Your last action may not have been applied — your document is still in memory.
        </p>
        <pre style={{ margin: 0, maxWidth: 480, maxHeight: 160, overflow: "auto", opacity: 0.6, fontSize: 11, whiteSpace: "pre-wrap" }}>{error.message}</pre>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={() => this.setState({ error: null })}>Try again</button>
          <button type="button" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
