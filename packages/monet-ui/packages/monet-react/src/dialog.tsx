// ─────────────────────────────────────────────────────────────
// Monet · dialog & toast layer — Dialog/Modal + Toast system
// ─────────────────────────────────────────────────────────────
// Built on the Portal / focus-trap / dismiss plumbing in overlay-core.
// Self-contained — uses plain styled <button>s, never the controls layer.
//
// Exports:
//   <Dialog open onClose title description> ... </Dialog>
//   ToastProvider / useToast() → { push, dismiss, clear }
//   <Toaster> (rendered automatically by ToastProvider)
//
// Accessibility:
//   • Dialog: role="dialog" aria-modal, focus trap, labelledby/describedby,
//     Escape + backdrop-click dismiss, body scroll-lock, focus restore.
//   • Toasts: region role="status" aria-live="polite", auto + manual dismiss.
//
// Visuals live in monet-core/overlays.css.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon, I } from "./icons";
import { Portal, useDismiss, useFocusTrap, useLayer, useMonetId } from "./overlay-core";

// ─── body scroll lock ──────────────────────────────────────────
// Reference-counted so stacked dialogs don't unlock prematurely.
let _scrollLocks = 0;
let _prevOverflow = "";
function lockScroll() {
  if (typeof document === "undefined") return;
  if (_scrollLocks === 0) {
    _prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  _scrollLocks += 1;
}
function unlockScroll() {
  if (typeof document === "undefined") return;
  _scrollLocks = Math.max(0, _scrollLocks - 1);
  if (_scrollLocks === 0) document.body.style.overflow = _prevOverflow;
}

// ─── Dialog / Modal ────────────────────────────────────────────
export interface DialogProps {
  /** Visibility. */
  open: boolean;
  /** Requested close (Escape, backdrop click, close button). */
  onClose: () => void;
  /** Accessible title; rendered in the header and wired to aria-labelledby. */
  title?: ReactNode;
  /** Supporting copy; wired to aria-describedby. */
  description?: ReactNode;
  /** Body content. */
  children?: ReactNode;
  /** Footer content (typically action buttons). */
  footer?: ReactNode;
  /** Allow closing by clicking the backdrop (default true). */
  dismissOnBackdrop?: boolean;
  /** Allow closing with Escape (default true). */
  dismissOnEscape?: boolean;
  /** Show the header close button (default true). */
  showClose?: boolean;
  /** Extra class on the dialog surface. */
  className?: string;
  /** Width hint for the surface (px or CSS length). Default from CSS. */
  width?: number | string;
  /** Accessible label when no `title` is provided. */
  ariaLabel?: string;
}

/** Accessible modal dialog: focus-trapped, scroll-locked, dismiss-on-Escape/backdrop. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  showClose = true,
  className,
  width,
  ariaLabel,
}: DialogProps) {
  const titleId = useMonetId("monet-dialog-title");
  const descId = useMonetId("monet-dialog-desc");
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const z = useLayer(open);

  useFocusTrap(surfaceRef, { active: open });
  useDismiss({
    onDismiss: onClose,
    refs: [surfaceRef],
    enabled: open,
    escapeKey: dismissOnEscape,
    // Backdrop clicks are handled by the explicit onPointerDown below so we can
    // honor dismissOnBackdrop; outside-pointer here would double-fire.
    outsidePointer: false,
  });

  useEffect(() => {
    if (!open) return;
    lockScroll();
    return () => unlockScroll();
  }, [open]);

  if (!open) return null;

  return (
    <Portal>
      <div
        className="monet-dialog-backdrop"
        style={{ zIndex: z }}
        onPointerDown={(e) => {
          if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={surfaceRef}
          role="dialog"
          aria-modal="true"
          aria-label={title ? undefined : ariaLabel}
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descId : undefined}
          className={`monet-dialog${className ? ` ${className}` : ""}`}
          style={width != null ? { width } : undefined}
        >
          {(title || showClose) && (
            <div className="monet-dialog-header">
              {title ? (
                <h2 id={titleId} className="monet-dialog-title">
                  {title}
                </h2>
              ) : (
                <span />
              )}
              {showClose && (
                <button
                  type="button"
                  className="monet-dialog-close"
                  aria-label="Close dialog"
                  onClick={onClose}
                >
                  <Icon d={I.close} size={12} strokeWidth={1.5} />
                </button>
              )}
            </div>
          )}
          {description ? (
            <p id={descId} className="monet-dialog-desc">
              {description}
            </p>
          ) : null}
          {children ? <div className="monet-dialog-body">{children}</div> : null}
          {footer ? <div className="monet-dialog-footer">{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
}

// ─── Toasts ────────────────────────────────────────────────────
export type ToastVariant = "info" | "success" | "warn" | "error";

export interface ToastOptions {
  /** Primary message. */
  message: ReactNode;
  /** Optional bold lead-in title. */
  title?: ReactNode;
  /** Visual + semantic variant. Default "info". */
  variant?: ToastVariant;
  /** Auto-dismiss after N ms. 0 / null disables auto-dismiss. Default 5000. */
  duration?: number | null;
  /** Optional single action (e.g. "Undo"). */
  action?: { label: string; onClick: () => void };
}

export interface Toast extends Required<Pick<ToastOptions, "message" | "variant">> {
  id: string;
  title?: ReactNode;
  duration: number | null;
  action?: { label: string; onClick: () => void };
}

export interface ToastApi {
  /** Show a toast; returns its id for manual dismissal. */
  push: (opts: ToastOptions) => string;
  /** Dismiss a specific toast. */
  dismiss: (id: string) => void;
  /** Dismiss all toasts. */
  clear: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Access the toast API. Must be used under a [`ToastProvider`]. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return ctx;
}

export interface ToastProviderProps {
  children: ReactNode;
  /** Corner the stack anchors to. Default "bottom-right". */
  placement?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Max simultaneously visible toasts; older ones drop. Default 5. */
  max?: number;
}

let _toastSeq = 0;

/** Provides the toast API and renders the live region. Wrap your app once. */
export function ToastProvider({ children, placement = "bottom-right", max = 5 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (opts: ToastOptions): string => {
      const id = `monet-toast-${++_toastSeq}`;
      const toast: Toast = {
        id,
        message: opts.message,
        title: opts.title,
        variant: opts.variant ?? "info",
        duration: opts.duration === undefined ? 5000 : opts.duration,
        action: opts.action,
      };
      setToasts((list) => {
        const next = [...list, toast];
        return next.length > max ? next.slice(next.length - max) : next;
      });
      if (toast.duration && toast.duration > 0) {
        const timer = setTimeout(() => dismiss(id), toast.duration);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss, max],
  );

  const clear = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
    setToasts([]);
  }, []);

  // Clean up any pending timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ push, dismiss, clear }), [push, dismiss, clear]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} placement={placement} />
    </ToastContext.Provider>
  );
}

const VARIANT_ICON: Record<ToastVariant, string> = {
  info: "M8 7.5L8 11.5M8 4.5L8 4.6",
  success: "M3.5 8.5L6.5 11.5L12.5 5",
  warn: "M8 3L14 13L2 13Z M8 7L8 10 M8 11.5L8 11.6",
  error: "M5 5L11 11M11 5L5 11",
};

interface ToasterProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  placement: NonNullable<ToastProviderProps["placement"]>;
}

/** The live-region stack. Rendered by [`ToastProvider`] via the Portal. */
function Toaster({ toasts, onDismiss, placement }: ToasterProps) {
  const z = useLayer(true);
  if (toasts.length === 0) return null;
  return (
    <Portal>
      <div
        className={`monet-toaster monet-toaster--${placement}`}
        role="region"
        aria-label="Notifications"
        style={{ zIndex: z }}
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
        ))}
      </div>
    </Portal>
  );
}

interface ToastCardProps {
  toast: Toast;
  onDismiss: () => void;
}

function ToastCard({ toast, onDismiss }: ToastCardProps) {
  // Errors and warnings are assertive; info/success are polite.
  const assertive = toast.variant === "error" || toast.variant === "warn";
  return (
    <div
      className={`monet-toast monet-toast--${toast.variant}`}
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
    >
      <span className="monet-toast-icon" aria-hidden="true">
        <Icon d={VARIANT_ICON[toast.variant]} size={14} strokeWidth={1.6} />
      </span>
      <div className="monet-toast-content">
        {toast.title ? <div className="monet-toast-title">{toast.title}</div> : null}
        <div className="monet-toast-message">{toast.message}</div>
      </div>
      {toast.action ? (
        <button
          type="button"
          className="monet-toast-action"
          onClick={() => {
            toast.action!.onClick();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button type="button" className="monet-toast-close" aria-label="Dismiss notification" onClick={onDismiss}>
        <Icon d={I.close} size={11} strokeWidth={1.5} />
      </button>
    </div>
  );
}
