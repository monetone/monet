import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Collider2D Offset: shift the arcade body from its auto-fitted
// position. A box body exports Phaser body.setOffset(x, y); a circle body folds
// the offset into setCircle's centring args. Physics is export/played-game only
// (the editor never simulates), so specs assert the model + the exported code via
// window.__mj. Under the `desktop` project the last test doubles as the CSP smoke.

const PAGE_BODY = (shape: "box" | "circle", offsetX: number, offsetY: number) => ({
  bodyType: "dynamic", shape, offsetX, offsetY,
  velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0,
  collideWorldBounds: false, immovable: false, allowGravity: true,
});

const exportWithBody = (page: Page, kind: string, body: object): Promise<string> =>
  page.evaluate(({ kind, body }) => {
    const { cmd, store, exporter } = window.__mj;
    const id = cmd.addObject(kind, { patch: { width: 100, height: 100 } });
    cmd.updateObject(id, { body });
    return exporter.exportGameJs(store.getProject());
  }, { kind, body });

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a box collider offset exports body.setOffset", async ({ page }) => {
  const js = await exportWithBody(page, "rectangle", PAGE_BODY("box", 8, -4));
  expect(js).toContain(".setOffset(8, -4);");
});

test("a circle collider offset folds into the setCircle centring args", async ({ page }) => {
  const js = await exportWithBody(page, "ellipse", PAGE_BODY("circle", 8, -4));
  expect(js).toContain(".setCircle(50, 8, -4);"); // 100×100 → r50, centre 0,0; + offset
});

test("a default body (no offset) emits no setOffset", async ({ page }) => {
  const js = await exportWithBody(page, "rectangle", PAGE_BODY("box", 0, 0));
  expect(js).not.toContain("setOffset");
});

test("the collider offset round-trips through .jouer", async ({ page }) => {
  const r = await page.evaluate((body) => {
    const { cmd, store, jouer, query } = window.__mj;
    const id = cmd.addObject("rectangle");
    cmd.updateObject(id, { body });
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const o = query.findObject(query.activeScene(back), id);
    return { x: o.body.offsetX, y: o.body.offsetY };
  }, PAGE_BODY("box", 12, 7));
  expect(r).toEqual({ x: 12, y: 7 });
});

test("collider offset runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const js = await exportWithBody(page, "rectangle", PAGE_BODY("box", 5, 5));
  expect(js).toContain(".setOffset(5, 5);");
  expect(await cspViolations(page)).toEqual([]);
});
