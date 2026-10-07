// ─────────────────────────────────────────────────────────────
// Vitest jsdom setup — polyfills for APIs the components touch
// ─────────────────────────────────────────────────────────────
// jsdom implements the DOM but omits a handful of layout/observer APIs and
// has no real layout engine (getBoundingClientRect returns zeros). These
// polyfills make the components mount + run their effects without throwing;
// the tests assert ROLES / ARIA / state / callbacks, never pixel geometry.

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// The package also runs framework-free logic tests from src/ that opt into the
// node environment (`// @vitest-environment node`). setupFiles apply to every
// test file, so everything below is a no-op when there is no DOM.
const HAS_DOM = typeof window !== "undefined";

// Unmount any React tree between tests so portals/overlays don't leak across
// cases (overlays render into a shared #monet-overlay-root on document.body).
afterEach(() => {
  if (!HAS_DOM) return;
  cleanup();
  document.getElementById("monet-overlay-root")?.remove();
});

// Everything below polyfills the DOM, so it is skipped entirely in the node
// environment that the framework-free src/ logic tests opt into.
if (HAS_DOM) {

  // ── window.matchMedia ───────────────────────────────────────────
  // Read by the theming/appearance layer; jsdom does not provide it.
  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }

  // ── ResizeObserver ──────────────────────────────────────────────
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      ResizeObserverStub;
  }

  // ── IntersectionObserver ────────────────────────────────────────
  if (!("IntersectionObserver" in globalThis)) {
    class IntersectionObserverStub {
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds: ReadonlyArray<number> = [];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      IntersectionObserverStub;
  }

  // ── Element.prototype.scrollIntoView ────────────────────────────
  // Select scrolls the active option into view on each move; jsdom stubs it out.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }

  // ── CSS.escape ──────────────────────────────────────────────────
  // Select builds an `#id` query via CSS.escape() to find its active option;
  // jsdom exposes a `CSS` namespace object but without the static escape().
  const cssNs = (globalThis as unknown as { CSS?: { escape?: unknown } }).CSS;
  if (!cssNs) {
    (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = {
      escape: (s: string) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
    };
  } else if (typeof cssNs.escape !== "function") {
    cssNs.escape = (s: string) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
  }

  // ── offsetWidth / offsetHeight ──────────────────────────────────
  // jsdom has no layout engine, so every element reports offsetWidth/Height = 0.
  // The overlay focus trap treats a zero-size element as hidden and skips it,
  // so it can never move focus into a dialog/popover. Report a nonzero box for
  // any connected element to make the "is this element visible?" heuristic pass.
  // (Tests still assert roles/ARIA/focus targets, never actual pixel values.)
  for (const prop of ["offsetWidth", "offsetHeight"] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return this.isConnected ? 1 : 0;
      },
    });
  }

  // ── HTMLElement pointer capture ─────────────────────────────────
  // @testing-library/user-event's pointer API calls these; jsdom lacks them.
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = function setPointerCapture() {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = function releasePointerCapture() {};
  }
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = function hasPointerCapture() {
      return false;
    };
  }
}
