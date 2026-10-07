// ── Preferences ▸ Interface ───────────────────────────────────
// Photoshop's Interface pane picks the app theme and the chrome density.
// Both already ship as pure CSS in @monet-ui/monet-core — `data-theme` and
// `data-density` on :root, which cascade to every window — so this module only
// remembers the choice and stamps the attributes. No design-system rule changes.
//
// It is an application preference rather than document state, so it persists
// beside the store's other `mv.*` keys instead of in the snapshot.

import {
  DEFAULT_DENSITY, DEFAULT_THEME, DENSITIES, DENSITY_ATTR, THEMES, THEME_ATTR,
  type Density, type Theme,
} from "@monet-ui/monet-core";

export interface InterfacePrefs {
  theme: Theme;
  density: Density;
}

export const DEFAULT_INTERFACE_PREFS: InterfacePrefs = { theme: DEFAULT_THEME, density: DEFAULT_DENSITY };

const INTERFACE_PREFS_KEY = "mv.interfacePrefs";

/** Coerce user-editable storage into a usable pair; unknown values fall back. */
export function normalizeInterfacePrefs(raw: unknown, base: InterfacePrefs = DEFAULT_INTERFACE_PREFS): InterfacePrefs {
  const o = (raw ?? {}) as Partial<Record<keyof InterfacePrefs, unknown>>;
  return {
    theme: THEMES.includes(o.theme as Theme) ? (o.theme as Theme) : base.theme,
    density: DENSITIES.includes(o.density as Density) ? (o.density as Density) : base.density,
  };
}

/** The saved interface preferences — defaults when unset or storage is unavailable. */
export function loadInterfacePrefs(): InterfacePrefs {
  try {
    return normalizeInterfacePrefs(JSON.parse(localStorage.getItem(INTERFACE_PREFS_KEY) ?? "null"));
  } catch {
    return DEFAULT_INTERFACE_PREFS; // storage may be unavailable (node, private mode) or hold junk
  }
}

/** Merge a patch over the saved value, persist it, and echo back the result. */
export function saveInterfacePrefs(patch: Partial<InterfacePrefs>): InterfacePrefs {
  const next = normalizeInterfacePrefs({ ...loadInterfacePrefs(), ...patch });
  try {
    localStorage.setItem(INTERFACE_PREFS_KEY, JSON.stringify(next));
  } catch { /* storage may be unavailable */ }
  return next;
}

/** The slice of Element the stamp needs — keeps this file node-testable. */
export interface AttrTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

// Each attribute's default is the *unscoped* CSS, so the default choice removes
// the attribute instead of writing it — dark/default stays byte-identical to a
// build that never knew about this preference.
function stamp(root: AttrTarget, attr: string, value: string, fallback: string) {
  if (value === fallback) root.removeAttribute(attr);
  else root.setAttribute(attr, value);
}

/** Apply the preferences to a root element (`document.documentElement`). */
export function applyInterfacePrefs(prefs: InterfacePrefs, root: AttrTarget): void {
  stamp(root, THEME_ATTR, prefs.theme, DEFAULT_THEME);
  stamp(root, DENSITY_ATTR, prefs.density, DEFAULT_DENSITY);
}
