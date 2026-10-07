import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches render-time errors so a thrown component doesn't blank the window. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Monet Cinema render error:", error, info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return <BootError title="Something broke" detail={this.state.error.message} />;
    }
    return this.props.children;
  }
}

export function BootError({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "#0b0e14",
        color: "#e7e9ee",
        fontFamily: "system-ui, sans-serif",
        padding: 40,
      }}
    >
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "var(--accent-motion, #e84bd0)" }}>{title}</div>
        <div style={{ fontSize: 13, color: "#9aa0ad", whiteSpace: "pre-wrap" }}>{detail}</div>
      </div>
    </div>
  );
}
