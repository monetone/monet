// ─────────────────────────────────────────────────────────────
// Monet · DesignCanvas — shared runtime context
// ─────────────────────────────────────────────────────────────
// The canvas API shared between DesignCanvas (owner), the section/artboard
// items, and the focus overlay. Kept in its own module so canvas.tsx and
// canvas-items.tsx / canvas-focus.tsx can import it without a cycle.

import { createContext, useContext } from "react";
import type { DesignCanvasState, DCSectionState } from "./canvas-export";

/** The imperative API DesignCanvas publishes to its descendants. */
export interface DCContextValue {
  /** Live runtime state (persisted sections + ephemeral focus). */
  state: DesignCanvasState;
  /** Read one section's persisted state (empty object when absent). */
  section: (id: string) => DCSectionState;
  /** Patch one section's state; the patch may be an object or an updater. */
  patchSection: (
    id: string,
    patch: Partial<DCSectionState> | ((prev: DCSectionState) => Partial<DCSectionState>),
  ) => void;
  /** Open the focus overlay on a slot id (`"sectionId/artboardId"`), or close it with null. */
  setFocus: (slotId: string | null) => void;
}

export const DCContext = createContext<DCContextValue | null>(null);

/** Read the nearest DesignCanvas context (null when used outside one). */
export function useDCContext(): DCContextValue | null {
  return useContext(DCContext);
}
