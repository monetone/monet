// Photoshop's View ▸ Screen Mode cycle (F forward, Shift+F backward). Pure /
// engine-free so it unit-tests in node. 'standard' = all chrome; 'fullMenu' =
// fullscreen keeping menu + panels; 'full' = canvas only (chrome hidden).

export type ScreenMode = "standard" | "fullMenu" | "full";

export const SCREEN_MODES: ScreenMode[] = ["standard", "fullMenu", "full"];

// The next mode when cycling forward (Shift → reverse), wrapping at the ends. An
// unknown current is treated as index 0 (standard).
export function nextScreenMode(current: ScreenMode, reverse = false): ScreenMode {
  const i = SCREEN_MODES.indexOf(current);
  const base = i < 0 ? 0 : i;
  const n = SCREEN_MODES.length;
  return SCREEN_MODES[(((base + (reverse ? -1 : 1)) % n) + n) % n];
}
