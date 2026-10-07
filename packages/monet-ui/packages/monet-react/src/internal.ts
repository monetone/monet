// ─────────────────────────────────────────────────────────────
// Monet — internal shared helpers (NOT public API)
// ─────────────────────────────────────────────────────────────
// Small framework-free utilities shared across the in-house controls and the
// creative-app component families. Intentionally NOT re-exported from index.ts
// — these are implementation details, not public surface.

import { useCallback, useEffect, useRef, useState } from "react";

/** Drive a value as controlled (when `value` is supplied) or fall back to
 *  internal uncontrolled state seeded from `defaultValue`. The React
 *  controlled/uncontrolled convention every Monet control uses. */
export function useControllableState<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
): [T, (next: T) => void] {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<T>(defaultValue);
  const current = isControlled ? (value as T) : internal;
  const set = useCallback(
    (next: T) => {
      if (!isControlled) setInternal(next);
      onChange?.(next);
    },
    [isControlled, onChange],
  );
  return [current, set];
}

/** Join class-name parts, dropping falsy entries. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Clamp `n` to the inclusive [min, max] range. */
export function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

/** Round `n` to `decimals` places (default 0), avoiding binary-float dust. */
export function roundTo(n: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** True when a keyboard event belongs to a control that owns typed keys —
 *  including an open Select (a combobox button), whose list takes arrows,
 *  typeahead, Space/Enter and Esc. A closed one leaves app shortcuts alone. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (
    el.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
    (el.getAttribute?.("role") === "combobox" && el.getAttribute("aria-expanded") === "true")
  );
}

export interface PointerSession {
  move: (event: PointerEvent) => void;
  up: (event: PointerEvent) => void;
  onCancel?: () => void;
  cursor?: string;
}

// ponytail: desktop chrome owns one pointer gesture at a time; split this by
// pointer id only if concurrent multi-touch chrome gestures become a real need.
let activePointerSession: (() => void) | null = null;

/** Bind one window-level pointer session, including interruption cleanup. */
export function beginPointerSession({ move, up, onCancel, cursor }: PointerSession): () => void {
  activePointerSession?.();
  let done = false;
  const teardown = () => {
    if (done) return;
    done = true;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", wrappedUp);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("keydown", onKey, true);
    if (cursor !== undefined) document.body.style.cursor = "";
    if (activePointerSession === teardown) activePointerSession = null;
  };
  const wrappedUp = (event: PointerEvent) => { try { up(event); } finally { teardown(); } };
  const cancel = () => { try { onCancel?.(); } finally { teardown(); } };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", wrappedUp);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel);
  window.addEventListener("keydown", onKey, true);
  if (cursor !== undefined) document.body.style.cursor = cursor;
  activePointerSession = teardown;
  return teardown;
}

/** Start pointer sessions that are also torn down when their owner unmounts. */
export function usePointerSession(): (session: PointerSession) => void {
  const teardown = useRef<(() => void) | null>(null);
  useEffect(() => () => teardown.current?.(), []);
  return useCallback((session) => {
    teardown.current?.();
    teardown.current = beginPointerSession(session);
  }, []);
}
