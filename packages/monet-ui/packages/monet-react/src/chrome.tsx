// ─────────────────────────────────────────────────────────────
// Monet · Tauri chrome integration
// ─────────────────────────────────────────────────────────────
// Bridges the React chrome to the native window:
//   • useMonet()    → { platform, accent, vibrancy } from monet-ui (Rust)
//   • windowControls   → close / minimize / toggle-maximize via app commands
//   • <MonetProvider> provides platform config + controls to DockableWorkspace
// In a plain browser (vite dev without Tauri) everything degrades gracefully:
// platform is guessed from the UA and the window controls become no-ops.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Accent, Platform } from "@monet-ui/monet-core";

/** The light/dark/auto appearance the native vibrancy material adopts; the
 *  chrome reads this to match its theme tokens to the material. Mirrors the
 *  Rust `VibrancyAppearance`. */
export type MonetAppearance = "auto" | "light" | "dark";

/** Per-window config injected by the Rust side (`window.__MONET__`) and also
 *  returned by the `monet_config` command. */
export interface MonetConfig {
  platform: Platform;
  accent: Accent;
  accentVar: string;
  accentValue: string;
  vibrancy: boolean;
  /** Appearance the native material adopts (`"auto" | "light" | "dark"`).
   *  Optional for backward compat with configs from older Rust builds; the
   *  provider defaults it to `"dark"`. */
  appearance?: MonetAppearance;
  /** CSS `rgba(…)` background to paint when `vibrancy` is `false` (the solid /
   *  Linux fallback colour). Optional for backward compat. */
  solidColor?: string;
  /** Dropdown lists and menus may open in native popup windows (macOS). */
  nativePopups?: boolean;
}

declare global {
  interface Window {
    __MONET__?: MonetConfig;
    __TAURI_INTERNALS__?: unknown;
  }
}

/** True when running inside a Tauri webview. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeCommand<T = void>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | undefined> {
  if (!isTauri()) return undefined;
  try {
    const core = await import("@tauri-apps/api/core");
    return await core.invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

/** Stop a Tauri event subscription. */
type Unlisten = () => void;

/** Subscribe to a Tauri event, gracefully no-op outside Tauri. Returns a
 *  promise of an `Unlisten`; outside Tauri (or on failure) the unlisten is a
 *  no-op so callers can always `.then((un) => ...)` safely. */
async function listenEvent<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<Unlisten> {
  if (!isTauri()) return () => {};
  try {
    const mod = await import("@tauri-apps/api/event");
    return await mod.listen<T>(event, (e) => handler(e.payload));
  } catch {
    return () => {};
  }
}

// ─── native event names + payloads (mirror crates/monet-ui) ──

/** Tauri event the Rust side emits for native menu activations. */
export const MENU_EVENT = "monet://menu" as const;
/** Tauri event the Rust side emits for native window-state changes. */
export const WINDOW_EVENT = "monet://window" as const;

/** Payload of [`MENU_EVENT`]: the activated menu item's id. Custom default-menu
 *  ids live under the `monet:` prefix (e.g. `"monet:preferences"`). */
export interface MenuCommandPayload {
  id: string;
}

/** Payload of [`WINDOW_EVENT`] — a discriminated union on `type`, mirroring the
 *  Rust `WindowEventPayload`. */
export type WindowEventPayload =
  | { type: "focused"; focused: boolean }
  | { type: "maximized"; maximized: boolean }
  | { type: "closeRequested" };

/** Live native window state, kept in sync from [`WINDOW_EVENT`]. Drives the
 *  chrome's maximize/restore button and dim-on-blur styling. */
export interface WindowState {
  /** Whether the window currently has key focus (defaults `true`). */
  focused: boolean;
  /** Whether the window is currently maximized. */
  maximized: boolean;
}

/** A menu-command handler. Receives the activated menu item id. */
export type MenuCommandHandler = (id: string) => void;

/** Window-control actions wired to the monet-ui app commands. No-ops outside Tauri. */
export interface WindowControls {
  close: () => void;
  minimize: () => void;
  toggleMaximize: () => void;
  startDrag: () => void;
}

export const windowControls: WindowControls = {
  close: () => void invokeCommand("window_close"),
  minimize: () => void invokeCommand("window_minimize"),
  toggleMaximize: () => void invokeCommand("window_toggle_maximize"),
  startDrag: () => void invokeCommand("window_start_drag"),
};

function guessPlatform(): Platform {
  if (typeof navigator === "undefined") return "mac";
  const ua = navigator.userAgent;
  if (/Windows|Win64|Win32/.test(ua)) return "win";
  return "mac";
}

function initialConfig(): MonetConfig {
  const injected =
    typeof window !== "undefined" ? window.__MONET__ : undefined;
  if (injected) return injected;
  const platform = guessPlatform();
  return {
    platform,
    accent: "raster",
    accentVar: "var(--accent-raster)",
    accentValue: "oklch(0.78 0.14 200)",
    vibrancy: false,
    appearance: "dark",
    solidColor: "rgba(11, 14, 20, 1)",
  };
}

/** Read the live Monet config: the synchronously-injected `window.__MONET__`
 *  first, then reconciled with the `monet_config` command. `override` lets a
 *  host pin specific fields (e.g. force an accent in the Sandbox). */
export function useMonet(override?: Partial<MonetConfig>): MonetConfig {
  const [config, setConfig] = useState<MonetConfig>(() => ({
    ...initialConfig(),
    ...override,
  }));

  useEffect(() => {
    let alive = true;
    invokeCommand<MonetConfig>("monet_config").then((c) => {
      if (alive && c) setConfig((prev) => ({ ...prev, ...c, ...override }));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [override?.accent, override?.platform, override?.vibrancy]);

  return config;
}

/** Track live native [`WindowState`] by subscribing to [`WINDOW_EVENT`].
 *  Outside Tauri it stays at its initial value (focused, not maximized) and
 *  never updates. */
export function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>({
    focused: true,
    maximized: false,
  });

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: Unlisten = () => {};
    let alive = true;
    listenEvent<WindowEventPayload>(WINDOW_EVENT, (p) => {
      setState((prev) => {
        switch (p.type) {
          case "focused":
            return { ...prev, focused: p.focused };
          case "maximized":
            return { ...prev, maximized: p.maximized };
          default:
            // "closeRequested" carries no state; advisory only.
            return prev;
        }
      });
    }).then((un) => {
      if (alive) unlisten = un;
      else un();
    });
    return () => {
      alive = false;
      unlisten();
    };
  }, []);

  return state;
}

/** A subscribe function: register a [`MenuCommandHandler`], get an unsubscribe.
 *  Provided through the [`MonetProvider`] so apps can react to native menu
 *  commands (e.g. `"monet:preferences"`). No-op outside Tauri. */
export type MenuCommandSubscribe = (handler: MenuCommandHandler) => Unlisten;

/** Build a menu-command fan-out backed by a single [`MENU_EVENT`] listener.
 *  Returns a stable `subscribe` plus a `dispose` to tear the listener down. */
function createMenuCommandHub(): {
  subscribe: MenuCommandSubscribe;
  dispose: () => void;
} {
  const handlers = new Set<MenuCommandHandler>();
  let unlisten: Unlisten = () => {};
  let started = false;

  const start = () => {
    if (started || !isTauri()) return;
    started = true;
    listenEvent<MenuCommandPayload>(MENU_EVENT, (p) => {
      for (const h of handlers) h(p.id);
    }).then((un) => {
      unlisten = un;
      // If everyone unsubscribed before the listener resolved, stop now.
      if (handlers.size === 0) {
        unlisten();
        unlisten = () => {};
        started = false;
      }
    });
  };

  const subscribe: MenuCommandSubscribe = (handler) => {
    handlers.add(handler);
    start();
    return () => {
      handlers.delete(handler);
    };
  };

  const dispose = () => {
    handlers.clear();
    unlisten();
    unlisten = () => {};
    started = false;
  };

  return { subscribe, dispose };
}

// ─── context consumed by DockableWorkspace ──────────────────
export interface MonetContextValue {
  platform: Platform;
  accent: Accent | string;
  vibrancy: boolean;
  /** Appearance the native material adopts; the chrome matches its theme to it.
   *  Defaults to `"dark"` when the Rust side didn't supply one. */
  appearance: MonetAppearance;
  controls: WindowControls;
  /** Live native window state (focus + maximized), synced from the Rust side. */
  windowState: WindowState;
  /** Subscribe to native menu commands; returns an unsubscribe. No-op outside Tauri. */
  onMenuCommand: MenuCommandSubscribe;
}

export const MonetContext = createContext<MonetContextValue | null>(null);

/** Read the nearest [`MonetProvider`] value (null if none). */
export function useMonetContext(): MonetContextValue | null {
  return useContext(MonetContext);
}

/** Subscribe `handler` to native menu commands for the lifetime of the calling
 *  component (via the nearest [`MonetProvider`]). No-op outside a provider or
 *  outside Tauri. The handler may change between renders; only the latest is
 *  invoked, so callers don't need to memoize it. */
export function useMenuCommand(handler: MenuCommandHandler): void {
  const ctx = useMonetContext();
  const ref = useRef(handler);
  ref.current = handler;
  const subscribe = ctx?.onMenuCommand;
  useEffect(() => {
    if (!subscribe) return;
    return subscribe((id) => ref.current(id));
  }, [subscribe]);
}

/** Read just the live [`WindowState`] from the nearest [`MonetProvider`].
 *  Falls back to a focused, non-maximized default when used outside one. */
export function useMonetWindowState(): WindowState {
  const ctx = useMonetContext();
  return ctx?.windowState ?? { focused: true, maximized: false };
}

/** Read the appearance ("auto" | "light" | "dark") the native vibrancy material
 *  adopted, from the nearest [`MonetProvider`]. Lets the chrome match its theme
 *  to the material. Falls back to `"dark"` outside a provider. */
export function useMonetAppearance(): MonetAppearance {
  const ctx = useMonetContext();
  return ctx?.appearance ?? "dark";
}

export interface MonetProviderProps {
  /** Override config fields (e.g. pin an accent). */
  config?: Partial<MonetConfig>;
  /** Custom window controls (defaults to the Tauri-backed [`windowControls`]). */
  controls?: WindowControls;
  children: ReactNode;
}

/** Provides platform/accent/controls to the Monet chrome and sets the
 *  `--accent` custom property on the document root (the Rust init script also
 *  does this; this covers browser-only dev). */
export function MonetProvider({
  config: override,
  controls = windowControls,
  children,
}: MonetProviderProps) {
  const cfg = useMonet(override);
  const windowState = useWindowState();

  // One menu-command hub per provider instance; disposed on unmount.
  const hubRef = useRef<ReturnType<typeof createMenuCommandHub> | null>(null);
  if (hubRef.current === null) hubRef.current = createMenuCommandHub();
  const onMenuCommand = hubRef.current.subscribe;
  useEffect(() => {
    const hub = hubRef.current;
    return () => hub?.dispose();
  }, []);

  const appearance: MonetAppearance = cfg.appearance ?? "dark";

  useEffect(() => {
    if (typeof document === "undefined") return;
    const de = document.documentElement;
    de.style.setProperty("--accent", cfg.accentVar);
    if (isTauri()) {
      de.setAttribute("data-monet-tauri", "");
      de.setAttribute("data-monet-appearance", appearance);
      if (cfg.vibrancy) {
        de.removeAttribute("data-monet-solid");
      } else {
        de.setAttribute("data-monet-solid", "");
        if (cfg.solidColor) de.style.setProperty("--monet-solid-bg", cfg.solidColor);
      }
    }
  }, [cfg.accentVar, cfg.vibrancy, cfg.solidColor, appearance]);

  const value = useMemo<MonetContextValue>(
    () => ({
      platform: cfg.platform,
      accent: cfg.accent,
      vibrancy: cfg.vibrancy,
      appearance,
      controls,
      windowState,
      onMenuCommand,
    }),
    [cfg.platform, cfg.accent, cfg.vibrancy, appearance, controls, windowState, onMenuCommand],
  );

  return (
    <MonetContext.Provider value={value}>
      {children}
    </MonetContext.Provider>
  );
}
