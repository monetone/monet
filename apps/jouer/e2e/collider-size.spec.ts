import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Collider Size (BoxCollider2D.Size / CircleCollider2D.Radius):
// explicit collider dimensions that override the auto-fit to the object. A box
// body exports Phaser body.setSize(w, h) (before any setOffset); a circle body's
// radius drives setCircle. Physics is export/played-game only (the editor never
// simulates), so specs assert the exported code + the model via window.__mj.
// Under the `desktop` project the last test doubles as the CSP smoke.

const BODY = (over: Record<string, unknown>) => ({
  bodyType: "dynamic", shape: "box", offsetX: 0, offsetY: 0,
  velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0,
  collideWorldBounds: false, immovable: false, allowGravity: true,
  ...over,
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

test("an explicit box collider size exports body.setSize", async ({ page }) => {
  const js = await exportWithBody(page, "rectangle", BODY({ sizeW: 120, sizeH: 48 }));
  expect(js).toContain(".setSize(120, 48);");
});

test("setSize comes before setOffset (setSize re-centres the offset)", async ({ page }) => {
  const js = await exportWithBody(page, "rectangle", BODY({ sizeW: 120, sizeH: 48, offsetX: 8, offsetY: -4 }));
  expect(js.indexOf(".setSize(120, 48);")).toBeLessThan(js.indexOf(".setOffset(8, -4);"));
});

test("an explicit circle radius drives setCircle (100x100, r30 -> centre 20,20)", async ({ page }) => {
  const js = await exportWithBody(page, "ellipse", BODY({ shape: "circle", radius: 30 }));
  expect(js).toContain(".setCircle(30, 20, 20);");
});

test("a default body emits no explicit size (auto-fit preserved)", async ({ page }) => {
  const js = await exportWithBody(page, "rectangle", BODY({}));
  expect(js).not.toContain("setSize");
});

test("collider size round-trips through .jouer", async ({ page }) => {
  const r = await page.evaluate((body) => {
    const { cmd, store, jouer, query } = window.__mj;
    const id = cmd.addObject("rectangle");
    cmd.updateObject(id, { body });
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const o = query.findObject(query.activeScene(back), id);
    return { w: o.body.sizeW, h: o.body.sizeH };
  }, BODY({ sizeW: 120, sizeH: 48 }));
  expect(r).toEqual({ w: 120, h: 48 });
});

test("collider size runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const js = await exportWithBody(page, "rectangle", BODY({ sizeW: 64, sizeH: 64 }));
  expect(js).toContain(".setSize(64, 64);");
  expect(await cspViolations(page)).toEqual([]);
});
