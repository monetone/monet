// keymap — pure resolution of a Library/culling keystroke to an action.
// Mirrors Lightroom's culling keys: 0–5 rate, 6–9 color label, P/X/U flag,
// arrows navigate, [ / ] reorder within a stack, G/E/C/N switch
// grid/loupe/compare/survey. Kept pure so it's unit-tested; the side-effecting
// apply lives in ui/culling.ts.

export type ModuleKey = "grid" | "loupe" | "develop" | "compare" | "survey";

export type CullAction =
  | { kind: "rate"; value: number }
  | { kind: "flag"; value: number } // 1 pick, 0 none, -1 reject
  | { kind: "label"; value: string | null }
  | { kind: "nav"; delta: number }
  | { kind: "navRow"; delta: number } // ↑/↓: one grid row
  | { kind: "navEnd"; dir: -1 | 1 } // Home/End
  | { kind: "loupe" } // Space/Enter/Z open Loupe (Loupe itself zooms)
  | { kind: "gridStyle" } // J cycles the grid cell style
  | { kind: "stackMove"; delta: -1 | 1 } // [ / ] reorder within the stack (LR)
  | { kind: "module"; value: ModuleKey };

/** The culling key for a KeyboardEvent: Shift+digit produces a symbol on most
 *  layouts, so recover the digit from the physical key — LR's Shift+rating
 *  auto-advance chord must still rate. */
export function cullKeyOf(e: { key: string; code?: string; shiftKey?: boolean }): string {
  if (e.shiftKey && e.code && e.code.startsWith("Digit")) return e.code.slice(5);
  return e.key;
}

/** True when Lightroom would auto-advance after a flag/rating/label: Caps Lock
 *  engaged, or the Shift chord held with the shortcut. */
export function autoAdvances(e: {
  shiftKey?: boolean;
  getModifierState?: (key: string) => boolean;
}): boolean {
  return e.shiftKey === true || e.getModifierState?.("CapsLock") === true;
}

const LABEL_KEYS: Record<string, string> = {
  "6": "red",
  "7": "yellow",
  "8": "green",
  "9": "blue",
};

/** Resolve a `KeyboardEvent.key` to a culling action, or null if unhandled. */
export function resolveShortcut(key: string): CullAction | null {
  if (key >= "0" && key <= "5") return { kind: "rate", value: Number(key) };
  if (key in LABEL_KEYS) return { kind: "label", value: LABEL_KEYS[key] };
  switch (key.toLowerCase()) {
    case "p":
      return { kind: "flag", value: 1 };
    case "x":
      return { kind: "flag", value: -1 };
    case "u":
      return { kind: "flag", value: 0 };
    case "arrowright":
      return { kind: "nav", delta: 1 };
    case "arrowleft":
      return { kind: "nav", delta: -1 };
    case "arrowdown":
      return { kind: "navRow", delta: 1 };
    case "arrowup":
      return { kind: "navRow", delta: -1 };
    case "home":
      return { kind: "navEnd", dir: -1 };
    case "end":
      return { kind: "navEnd", dir: 1 };
    case " ":
    case "enter":
    case "z":
      return { kind: "loupe" };
    case "j":
      return { kind: "gridStyle" };
    case "[":
      return { kind: "stackMove", delta: -1 };
    case "]":
      return { kind: "stackMove", delta: 1 };
    case "g":
      return { kind: "module", value: "grid" };
    case "e":
      return { kind: "module", value: "loupe" };
    case "d":
      return { kind: "module", value: "develop" };
    case "c":
      return { kind: "module", value: "compare" };
    case "n":
      return { kind: "module", value: "survey" };
    default:
      return null;
  }
}
