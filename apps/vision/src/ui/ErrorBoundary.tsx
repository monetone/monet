// A visible, last-resort failure surface. `ErrorBoundary` catches render-time
// throws anywhere in the tree; `BootError` renders the same UI from main.tsx
// when engine init fails before React mounts. Without these a failure leaves an
// unstyled blank window with only a console message (see review Quality C1 / OPS1).

import { Component, type ErrorInfo, type ReactNode } from "react";

export function BootError({ title, detail }: { title: string; detail?: string }) {
  return (
    <div
      role="alert"
      style={{
        position: "fixed", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 12, padding: 32,
        background: "var(--surface-1, #1e1e1e)", color: "var(--text-1, #e8e8e8)",
        font: "13px/1.5 system-ui, -apple-system, sans-serif", textAlign: "center",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
      {detail ? (
        <div style={{ maxWidth: 520, fontFamily: "var(--font-mono, monospace)", opacity: 0.8, wordBreak: "break-word" }}>
          {detail}
        </div>
      ) : null}
      <div style={{ opacity: 0.6, marginTop: 4 }}>Try reopening the app. If this persists, the document or engine may be unsupported.</div>
    </div>
  );
}

interface State { error: Error | null; }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Monet Vision render error:", error, info);
  }

  render() {
    if (this.state.error) {
      return <BootError title="Monet Vision hit an unexpected error" detail={this.state.error.message} />;
    }
    return this.props.children;
  }
}
