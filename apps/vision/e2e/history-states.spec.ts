import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop "History States" (Preferences ▸ Performance) ──────────
// Adobe spec: the number of undo steps the History panel retains — default 50,
// range 1–1000. The engine capped at 32 with no control; this makes the cap 50
// by default and configurable, dropping the oldest states when lowered.
//
//   https://helpx.adobe.com/photoshop/using/performance-preferences.html

const DOCW = 200;
const DOCH = 140;

async function setup(page: Page, tool: string): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h, tool }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "hs");
    mv.engine.commit();
    mv.store.setTool(tool);
    mv.store.fit();
  }, { w: DOCW, h: DOCH, tool });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.5, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d) => box.x + d * box.w / DOCW, cy: (d) => box.y + d * box.h / DOCH };
}

// ── Integration: the cap through the engine FFI ────────────────────
test("set_history_states caps undo depth and clamps to 1..1000 (default 50)", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(16, 16, "hs");
    const E = mv.engine.engine; // AFTER newDocument — it swaps the engine
    const def = E.history_states();
    E.set_history_states(8);
    for (let i = 0; i < 20; i++) E.select_rect(i % 4, 0, 2, 2, 0); // 20 history states
    const depth = E.undo_depth();
    E.set_history_states(99999); const hi = E.history_states();
    E.set_history_states(0); const lo = E.history_states();
    return { def, depth, hi, lo };
  });
  expect(r.def).toBe(50);   // Photoshop default
  expect(r.depth).toBe(8);  // capped — oldest 12 dropped
  expect(r.hi).toBe(1000);  // clamped up
  expect(r.lo).toBe(1);     // clamped down
});

// ── Mouse: history built by real strokes respects the cap ──────────
test("mouse-built history respects the History States cap", async ({ page }) => {
  const m = await setup(page, "brush");
  await page.evaluate(() => (window as any).__mv.store.setHistoryStates(5));
  // 10 separate brush dabs (each click = one stroke = one history state)
  for (let i = 0; i < 10; i++) await page.mouse.click(m.cx(30 + i * 12), m.cy(70));
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.undo_depth())).toBe(5);
  // …and you can undo exactly the 5 retained states, no further
  const after = await page.evaluate(() => {
    const mv = (window as any).__mv;
    for (let i = 0; i < 5; i++) mv.store.undo();
    return { depth: mv.engine.engine.undo_depth(), canUndo: mv.store.state.canUndo };
  });
  expect(after.depth).toBe(0);
  expect(after.canUndo).toBe(false);
});

// ── UI: the History panel's History States control ─────────────────
test("the History panel exposes a History States control wired to the engine", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("tab", { name: "History" }).click();
  const input = page.getByRole("spinbutton", { name: "History States" });
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.historyStates)).toBe(50); // PS default

  await input.fill("12");
  expect(await page.evaluate(() => (window as any).__mv.store.state.historyStates)).toBe(12);
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.history_states())).toBe(12);

  await input.fill("5000"); // out of range → clamped to the max
  expect(await page.evaluate(() => (window as any).__mv.store.state.historyStates)).toBe(1000);
});
