// ─────────────────────────────────────────────────────────────
// Monet · native popup windows
// ─────────────────────────────────────────────────────────────
// A webview cannot paint outside its window, so a dropdown list or menu opened
// near the window edge would be cut off by the window itself. In the desktop
// app (macOS) these surfaces render into a borderless native child window
// instead, so they can hang past the app window like OS menus do.
//
// The window is opened with `window.open("about:blank#monet-popup-…")`; the
// monet-ui crate's new-window hook creates it sharing this page's WebKit
// configuration (crates/monet-ui/src/popup.rs), so the page keeps DOM access
// and React portals straight into its document — same tree, same handlers.
// `monet_popup_place` sizes, positions (flip/shift inside the monitor's work
// area) and shows it; `monet_popup_hide` parks it as a click-through pixel.
// Windows are pooled and never closed (see popup.rs for why).
//
// A popup never becomes the key window: the app window keeps focus, so a
// Select's keys still reach its trigger; menus, whose items take DOM focus,
// get the app window's keys forwarded. WebKit ignores mouse moves in a page
// that is not key, so hover is driven by polling the cursor.
//
// Browsers, tests and other platforms get no slot and callers keep the
// in-window overlay.

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface NativePopupSlot {
  label: string;
  win: Window;
  /** Portal target inside the popup document. */
  root: HTMLElement;
  busy: boolean;
  /** Bumped on every acquire/release; a placement from an older holder is dropped. */
  gen: number;
  /** Place/park calls run in order, so a late placement can't re-show a closed popup. */
  queue: Promise<unknown>;
  /** Where the popup last landed, in this window's client coordinates. */
  at: { x: number; y: number } | null;
}

export interface NativePopupPlacement {
  /** Top-left of the popup in the opener's client coordinates. */
  x: number;
  y: number;
  side: "top" | "bottom" | "left" | "right";
}

const pool: NativePopupSlot[] = [];

/** True where native popup windows are supported: a monet-ui desktop window on
 *  macOS, which announces the new-window hook they need (`__MONET__.nativePopups`). */
export function nativePopupsAvailable(): boolean {
  return typeof window !== "undefined" && window.__MONET__?.nativePopups === true;
}

// Labels are stable for this tab (sessionStorage outlives a reload), so a
// reloaded page re-adopts the popup windows its previous document opened
// instead of leaking new ones (Rust parks them when the page reloads).
const COUNT_KEY = "monet-popup-count";
function sessionStore(key: string, fallback: string): string {
  try {
    const value = sessionStorage.getItem(key);
    if (value) return value;
    sessionStorage.setItem(key, fallback);
  } catch {
    // Storage unavailable: labels just stop being stable across reloads.
  }
  return fallback;
}
const session =
  typeof window === "undefined" ? "" : sessionStore("monet-popup-session", Math.random().toString(36).slice(2, 10));
let seq = 0;
const labelFor = (n: number) => `monet-popup-${session}-${n}`;

/** Whether a Monet dropdown list or native popup menu is open — for app key
 *  handlers that must leave its keys alone (a native list is not in this document). */
export function isDropdownOpen(): boolean {
  return !!document.querySelector(".monet-listbox") || pool.some((s) => s.busy);
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T | undefined> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

// Stylesheet changes (Vite HMR, lazily loaded CSS) bump the version; a popup
// re-mirrors the sheets when it is next acquired with an older one.
let styleVersion = 0;
if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
  new MutationObserver(() => styleVersion++).observe(document.head, { childList: true, subtree: true, characterData: true });
}

// Mirror this document's stylesheets, root attributes and fonts into a popup
// document so portalled surfaces look exactly as they do in-window.
const mirrored = new WeakMap<NativePopupSlot, number>();
function syncDocument(slot: NativePopupSlot) {
  const doc = slot.win.document;
  const html = document.documentElement;
  for (const { name } of Array.from(doc.documentElement.attributes)) {
    if (!html.hasAttribute(name)) doc.documentElement.removeAttribute(name);
  }
  for (const { name, value } of Array.from(html.attributes)) doc.documentElement.setAttribute(name, value);
  if (mirrored.get(slot) === styleVersion) return;
  mirrored.set(slot, styleVersion);
  doc.head.querySelectorAll("[data-monet-mirror]").forEach((n) => n.remove());
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
    const copy = doc.importNode(n, true) as HTMLElement;
    copy.setAttribute("data-monet-mirror", "");
    doc.head.appendChild(copy);
  });
  document.fonts?.forEach((f) => {
    try {
      doc.fonts.add(f);
    } catch {
      // A FontFace from another document may be refused; system fonts still resolve by name.
    }
  });
}

function createSlot(): NativePopupSlot | null {
  const label = labelFor(++seq);
  let win: Window | null = null;
  try {
    win = window.open(`about:blank#${label}`, label, "popup=yes,width=1,height=1");
  } catch {
    win = null;
  }
  if (!win) return null;
  try {
    sessionStorage.setItem(COUNT_KEY, String(seq));
  } catch {
    // See sessionStore.
  }
  return initSlot(win, label);
}

// (Re)build a popup document: base URL, the reset sheet, the portal root.
function initSlot(win: Window, label: string): NativePopupSlot {
  const doc = win.document;
  doc.head.replaceChildren();
  doc.body.replaceChildren();
  const base = doc.createElement("base");
  base.href = document.baseURI;
  doc.head.appendChild(base);
  // Viewport units in a popup measure the popup window itself, so the
  // screen-relative caps the in-window surfaces use are restated in pixels.
  const reset = doc.createElement("style");
  reset.textContent =
    "html,body{margin:0;padding:0;background:transparent!important;overflow:hidden}" +
    "body{font-family:var(--font-ui);color:var(--text-1)}" +
    // Nothing behind the popup to blur; a backdrop filter only costs frames here.
    ".monet-native-popup *{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}" +
    `.monet-native-popup .monet-menu-list{max-height:${Math.round(screen.availHeight * 0.8)}px}`;
  doc.head.appendChild(reset);
  const root = doc.createElement("div");
  root.className = "monet-overlay-root monet-native-popup";
  doc.body.appendChild(root);
  const slot: NativePopupSlot = { label, win, root, busy: false, gen: 0, queue: Promise.resolve(), at: null };
  syncDocument(slot);
  // Order it in right away, parked: showing it later never flips its visibility.
  slot.queue = invoke("monet_popup_hide", { label });
  return slot;
}

// Keep a spare window ready. Creating one runs `window.open`, and doing that
// while WebKit is dispatching a click can stall (at worst kill) the web content
// process the popups share with this page — so it happens between events.
function replenish() {
  if (pool.some((s) => !s.busy)) return;
  const slot = createSlot();
  if (slot) pool.push(slot);
}

function acquire(): NativePopupSlot | null {
  let slot = pool.find((s) => !s.busy && !s.win.closed) ?? null;
  if (!slot) {
    slot = createSlot(); // no spare left (rare): create one now
    if (!slot) return null;
    pool.push(slot);
  } else {
    syncDocument(slot);
  }
  slot.busy = true;
  slot.gen++;
  slot.at = null;
  window.setTimeout(replenish, 0);
  return slot;
}

function release(slot: NativePopupSlot) {
  slot.busy = false;
  slot.gen++;
  slot.queue = slot.queue.then(() => invoke("monet_popup_hide", { label: slot.label }));
}

// On load: re-adopt the windows a previous document of this tab opened
// (`window.open("", label)` returns an existing one by name; an unknown name is
// refused by the new-window hook), then make the first spare once the page has
// loaded and the app is active — creating a webview can activate the app on
// older macOS. The app window allows script-opened popups for this (popup.rs).
if (typeof window !== "undefined" && nativePopupsAvailable()) {
  let count = 0;
  try {
    count = Number(sessionStorage.getItem(COUNT_KEY)) || 0;
  } catch {
    count = 0;
  }
  for (let n = 1; n <= count; n++) {
    let win: Window | null = null;
    try {
      win = window.open("", labelFor(n));
    } catch {
      win = null;
    }
    if (win && !win.closed) pool.push(initSlot(win, labelFor(n)));
  }
  seq = count;
  const warm = () => {
    if (document.hasFocus()) window.setTimeout(replenish, 300);
    else window.addEventListener("focus", warm, { once: true });
  };
  if (document.readyState === "complete") warm();
  else window.addEventListener("load", warm, { once: true });
}

/** Hold a pooled native popup window while `open` is true (null where native
 *  popups are unavailable). Acquired in a layout effect so `window.open` still
 *  runs inside the opening click or key press. */
export function useNativePopup(open: boolean): NativePopupSlot | null {
  const [slot, setSlot] = useState<NativePopupSlot | null>(null);
  useLayoutEffect(() => {
    if (!open || !nativePopupsAvailable()) return;
    const s = acquire();
    if (!s) return;
    setSlot(s);
    return () => {
      release(s);
      setSlot(null);
    };
  }, [open]);
  return slot;
}

const isElement = (a: Element | DOMRect): a is Element => "getBoundingClientRect" in a;

/** Size, position and show `slot` beside `anchor`: a client rect in this
 *  window, or an element — possibly in another native popup (a submenu's row),
 *  in which case it is measured once that popup has been placed. */
export function placeNativePopup(
  slot: NativePopupSlot,
  anchor: Element | DOMRect,
  size: { width: number; height: number },
  opts: { side?: string; align?: string; offset?: number } = {},
): Promise<NativePopupPlacement | undefined> {
  const gen = slot.gen;
  const owner = isElement(anchor) ? pool.find((s) => s.win.document === anchor.ownerDocument) : undefined;
  const ready = owner && owner !== slot ? Promise.all([slot.queue, owner.queue]) : slot.queue;
  const placed = ready.then(async () => {
    if (!slot.busy || slot.gen !== gen) return undefined;
    const r = isElement(anchor) ? openerRect(anchor) : anchor;
    const p = await invoke<NativePopupPlacement>("monet_popup_place", {
      label: slot.label,
      anchor: { x: r.left, y: r.top, width: r.width, height: r.height },
      width: Math.ceil(size.width),
      height: Math.ceil(size.height),
      side: opts.side ?? "bottom",
      align: opts.align ?? "start",
      offset: opts.offset ?? 4,
    });
    if (p && slot.gen === gen) slot.at = { x: p.x, y: p.y };
    return p;
  });
  slot.queue = placed;
  return placed;
}

/** `el`'s rect in this window's client coordinates, also when `el` lives in a
 *  native popup (a submenu anchors to a row of its parent menu). */
export function openerRect(el: Element): DOMRect {
  const r = el.getBoundingClientRect();
  if (el.ownerDocument === document) return r;
  const at = pool.find((s) => s.win.document === el.ownerDocument)?.at;
  return at ? new DOMRect(r.left + at.x, r.top + at.y, r.width, r.height) : r;
}

/** Largest box a native surface may take (bounded by the screen, not the window). */
export function nativePopupMaxSize(): { width: number; height: number } {
  return { width: Math.max(160, screen.availWidth - 16), height: Math.max(120, screen.availHeight - 16) };
}

/** Render `node` into the native popup when there is one, else via `fallback`. */
export function renderInPopup(slot: NativePopupSlot | null, node: ReactNode, fallback: (node: ReactNode) => ReactNode) {
  return slot ? createPortal(node, slot.root) : fallback(node);
}

/** Drive hover inside a native popup: poll the cursor and replay
 *  pointerover/out/move on the element under it — what React's
 *  onPointerEnter/Leave/Move listen to. */
export function useNativePopupHover(slot: NativePopupSlot | null) {
  useEffect(() => {
    if (!slot) return;
    const W = slot.win as Window & typeof globalThis;
    let stopped = false;
    let last: Element | null = null;
    let lastAt = "";
    const pointer = (type: string, target: Element, init: PointerEventInit) =>
      target.dispatchEvent(new W.PointerEvent(type, { bubbles: true, pointerType: "mouse", isPrimary: true, ...init }));
    const tick = async () => {
      while (!stopped) {
        const at = await invoke<[number, number] | null>("monet_popup_cursor", { label: slot.label });
        if (stopped) break;
        const el = at ? W.document.elementFromPoint(at[0], at[1]) : null;
        if (el !== last) {
          if (last) pointer("pointerout", last, { relatedTarget: el });
          if (el) pointer("pointerover", el, { relatedTarget: last });
          last = el;
        }
        const key = at ? `${Math.round(at[0])},${Math.round(at[1])}` : "";
        if (el && at && key !== lastAt) pointer("pointermove", el, { clientX: at[0], clientY: at[1] });
        lastAt = key;
        await new Promise((r) => window.setTimeout(r, 16));
      }
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, [slot]);
}

/** Close a native surface when the app window loses focus (a click in another
 *  app or on the desktop), which no in-page listener would otherwise see. */
export function useCloseOnAppBlur(slot: NativePopupSlot | null, onClose: () => void) {
  useEffect(() => {
    if (!slot) return;
    window.addEventListener("blur", onClose);
    return () => window.removeEventListener("blur", onClose);
  }, [slot, onClose]);
}

// A popup never receives keys, and a menu in one keeps its active row as state
// rather than DOM focus (focusing into the popup's page would blur the app
// window). While a menu is open, the app window's keys are replayed on the
// innermost menu's list and swallowed, as an OS menu does — ahead of the app's
// own window listeners, as this one is installed first, at load.
const keySinks: NativePopupSlot[] = [];
function forwardKeys(e: KeyboardEvent) {
  if (e.defaultPrevented) return;
  for (let i = keySinks.length - 1; i >= 0; i--) {
    const target = keySinks[i].root.querySelector('[role="menu"]');
    if (!target) continue;
    const W = keySinks[i].win as Window & typeof globalThis;
    target.dispatchEvent(
      new W.KeyboardEvent(e.type, {
        key: e.key,
        code: e.code,
        repeat: e.repeat,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        bubbles: true,
        cancelable: true,
      }),
    );
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
}
if (typeof window !== "undefined" && nativePopupsAvailable()) {
  window.addEventListener("keydown", forwardKeys, true);
}

/** Forward the app window's keys to the menu in `slot` while it is open. */
export function useNativeKeyForwarding(slot: NativePopupSlot | null) {
  useEffect(() => {
    if (!slot) return;
    keySinks.push(slot);
    return () => {
      keySinks.splice(keySinks.indexOf(slot), 1);
    };
  }, [slot]);
}
