// Smoke test: harness works, rail default-slot + flyout selection work, a tool
// actually mutates the document.
import { launch } from "./harness.mjs";

const s = await launch();
const out = { steps: [], errors: s.errors };
const ok = (name, cond, extra) => out.steps.push({ name, pass: !!cond, ...(extra || {}) });

try {
  await s.reset();
  const a = await s.snapshot();
  ok("loads clean (no page errors)", s.errors.length === 0, { errors: s.errors });
  ok("starts empty", a.itemCount === 0, { itemCount: a.itemCount });

  // 1) Default-visible slot: Rectangle, drag to create.
  await s.clickRailSlot("Rectangle (M)");
  const afterSelect = await s.snapshot();
  ok("rail selects Rectangle", afterSelect.tool === "rect", { tool: afterSelect.tool });
  await s.drag({ x: 80, y: 80 }, { x: 280, y: 220 });
  const b = await s.snapshot();
  ok("Rectangle draws a rect", b.itemCount === 1 && b.items[0]?.type === "rect", { items: b.items });

  // 2) Flyout member: Ellipse lives under the Rectangle slot's flyout.
  const picked = await s.pickFromFlyout("Ellipse");
  ok("flyout exposes Ellipse", picked === true);
  const afterEllipse = await s.snapshot();
  ok("flyout selects Ellipse", afterEllipse.tool === "ellipse", { tool: afterEllipse.tool });
  await s.drag({ x: 360, y: 80 }, { x: 540, y: 240 });
  const c = await s.snapshot();
  ok("Ellipse draws an ellipse", c.itemCount === 2 && c.items[1]?.type === "ellipse", { items: c.items });

  await s.screenshot("/tmp/artisan-e2e-smoke.png");
} catch (e) {
  out.fatal = String(e);
} finally {
  out.errors = s.errors;
  await s.close();
}

const passed = out.steps.filter((x) => x.pass).length;
console.log(JSON.stringify({ passed, total: out.steps.length, ...out }, null, 2));
process.exit(out.fatal || passed !== out.steps.length ? 1 : 0);
