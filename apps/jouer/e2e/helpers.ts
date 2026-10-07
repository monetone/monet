import { expect, type Page } from "@playwright/test";

// The dev/e2e app API exposed on `window.__mj` (see src/main.tsx). Loosely
// typed — specs reach into the real model through it.
export interface MjApi {
  store: {
    state: any;
    getProject: () => any;
    selection: string[];
    replaceProject: (p: any, o?: any) => void;
    selectOne: (id: string | null) => void;
    select: (ids: string[]) => void;
    clearSelection: () => void;
    setActiveScene: (id: string) => void;
    setActiveTimeline: (id: string) => void;
    setPlayhead: (s: number) => void;
    setPlaying: (v: boolean) => void;
    setGridSize: (n: number) => void;
    togglePlaying: () => void;
    setLoopPlayback: (v: boolean) => void;
    timelineExtent: () => number;
    soleSelection: () => string | null;
  };
  cmd: any;
  query: any;
  sample: any;
  jouer: any;
  exporter: { exportGameJs: (p: any) => string; exportStandaloneHtml: (p: any) => string };
  probe: (id: string) => null | {
    x: number; y: number; scaleX: number; scaleY: number; angle: number; alpha: number;
    originX: number | null; originY: number | null; width: number | null; height: number | null;
    displayOriginX: number | null; displayOriginY: number | null;
    geomWidth: number | null; geomHeight: number | null; strokeWidth: number | null;
    visible: boolean; depth: number; anim: string | null; animPlaying: boolean; frame: number | null;
    flipX: boolean; flipY: boolean;
  };
  camera: () => null | {
    zoom: number; scrollX: number; scrollY: number; centerX: number; centerY: number; width: number; height: number;
  };
  frameSelected: () => void;
  moveToView: () => void;
}

declare global {
  interface Window {
    __mj: MjApi;
    __csp: string[];
  }
}

/** Navigate to the app, capture CSP violations, and wait for the live Phaser
 *  editor (the `window.__mj` hook + a canvas) to be ready. */
export async function gotoApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Use Phaser's Canvas renderer in headless so the GPU process tears down
    // cleanly (WebGL teardown can hang the worker for minutes). Behaviour is
    // identical — tests read game-object geometry, not pixels.
    (window as any).__MJ_RENDERER = "CANVAS";
    (window as any).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      const v = e as SecurityPolicyViolationEvent;
      (window as any).__csp.push(`${v.violatedDirective} <- ${v.blockedURI}`);
    });
  });
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__mj?.store?.state?.ready === true && typeof (window as any).__mj?.probe === "function", null, { timeout: 30_000 });
  await page.waitForSelector(".mj-stage canvas", { timeout: 30_000 });
  // Let the Phaser scene complete its first reconcile + frame.
  await page.waitForFunction(() => {
    const mj = (window as any).__mj;
    const s = mj.query.activeScene(mj.store.getProject());
    return !s || s.objects.length === 0 || mj.probe(s.objects[0].id) !== null;
  }, null, { timeout: 15_000 });
}

/** Read recorded CSP violations (desktop project only). */
export async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__csp ?? []);
}

/** Poll the live probe until the scene has built a node for `id`. */
export async function waitForNode(page: Page, id: string): Promise<void> {
  await page.waitForFunction((nid) => (window as any).__mj.probe(nid) !== null, id, { timeout: 10_000 });
}

/** Wait `n` real animation frames in the page so the EditorScene's update loop
 *  applies the current playhead pose to the live nodes. Frame-counted (not
 *  wall-clock) so it stays correct even when parallel Phaser pages slow the
 *  frame rate. */
export async function tick(page: Page, n = 4): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((res) => {
        let c = 0;
        const step = () => (++c >= n ? res() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n,
  );
}

/** Poll the live probe until a numeric field reaches `expected` (±eps) — the
 *  most robust way to assert an animated pose without racing the frame loop. */
export async function waitProbe(page: Page, id: string, field: "x" | "y" | "scaleX" | "scaleY" | "angle" | "alpha" | "width" | "height", expected: number, eps = 0.6): Promise<void> {
  await page.waitForFunction(
    ({ id, field, expected, eps }) => {
      const p = window.__mj.probe(id) as any;
      return p && Math.abs((p[field] ?? NaN) - expected) <= eps;
    },
    { id, field, expected, eps },
    { timeout: 8000 },
  );
}

/** Build a horizontal spritesheet data URL (frames distinct solid colours) and
 *  return it with its frame geometry, so sprite/animation specs need no files. */
export async function makeSpritesheet(page: Page, frames = 4, size = 16): Promise<{ src: string; frameWidth: number; frameHeight: number; width: number; height: number; frames: number }> {
  return page.evaluate(({ frames, size }) => {
    const c = document.createElement("canvas");
    c.width = frames * size;
    c.height = size;
    const ctx = c.getContext("2d")!;
    const colors = ["#ff4d4d", "#4dff88", "#4d88ff", "#ffd24d", "#b84dff", "#4dffe0"];
    for (let i = 0; i < frames; i++) {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(i * size, 0, size, size);
    }
    return { src: c.toDataURL("image/png"), frameWidth: size, frameHeight: size, width: frames * size, height: size, frames };
  }, { frames, size });
}

/** Assert two numbers are within `eps`. */
export function near(actual: number, expected: number, eps = 0.5): void {
  expect(Math.abs(actual - expected), `${actual} ≈ ${expected} (±${eps})`).toBeLessThanOrEqual(eps);
}
