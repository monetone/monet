import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Frame tool (K) ───────────────────────────────────────
// Adobe: the Frame tool drags an empty placeholder frame (a clipping container),
// then dropping/placing an image fills it — the image becomes the frame's content
// clipped to the frame bounds. In Monet Vision the frame is a kind=6 container
// (engine new_frame_rect / new_frame_ellipse, adj_params [x,y,w,h,bg=0,shape]) and
// the image is reparented (set_layer_group) as a centred, clipped member.
//   https://helpx.adobe.com/photoshop/using/placing-images-frames.html

const DOCW = 200;
const DOCH = 140;
const FR = { x: 60, y: 40, w: 80, h: 60 }; // frame region

test.describe.configure({ mode: "serial" });

async function setup(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "frame"); // white base
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(255, 255, 255, 255); E.select_none();
    mv.engine.commit();
    mv.store.setTool("frame");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.0, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

async function frameDrag(page: Page, m: { cx: (d: number) => number; cy: (d: number) => number }) {
  await page.mouse.move(m.cx(FR.x), m.cy(FR.y));
  await page.mouse.down();
  await page.mouse.move(m.cx(FR.x + FR.w), m.cy(FR.y + FR.h), { steps: 4 });
  await page.mouse.up();
}

/** A green PNG of `iw`×`ih`, as bytes, decoded in the page. */
async function greenPng(page: Page, iw: number, ih: number): Promise<void> {
  await page.evaluate(async ({ iw, ih }) => {
    const c = document.createElement("canvas"); c.width = iw; c.height = ih;
    const cx = c.getContext("2d")!; cx.fillStyle = "#22cc88"; cx.fillRect(0, 0, iw, ih);
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
    (window as any).__frameImg = new Uint8Array(await blob.arrayBuffer());
  }, { iw, ih });
}

/** The kind=6 frame container created most recently (highest id). */
async function frameLayer(page: Page): Promise<{ id: number; kind: number; bounds: number[] } | null> {
  return await page.evaluate(() => {
    const mv = (window as any).__mv;
    const frames = mv.store.state.layers.filter((l: any) => l.kind === 6);
    if (!frames.length) return null;
    const f = frames.reduce((a: any, b: any) => (b.id > a.id ? b : a));
    return { id: f.id, kind: f.kind, bounds: [...mv.engine.engine.frame_bounds(f.id)] };
  });
}

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return await page.evaluate(({ x, y }) => {
    const c = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
  }, { x, y });
}
const isGreen = (p: number[]) => p[1] > 150 && p[0] < 120 && p[2] < 180 && p[3] > 200;
const isWhite = (p: number[]) => p[0] > 240 && p[1] > 240 && p[2] > 240 && p[3] > 200;

// ── a frame drag creates an empty (kind=6) container of those bounds ──
test("a frame drag creates an empty frame container", async ({ page }) => {
  const m = await setup(page);
  const before = await page.evaluate(() => (window as any).__mv.engine.engine.layer_count());
  await frameDrag(page, m);
  const f = await frameLayer(page);
  expect(f).not.toBeNull();
  expect(f!.kind).toBe(6); // a group/container layer
  // bounds ≈ the dragged FR rect (±2 from canvas→doc rounding)
  expect(Math.abs(f!.bounds[0] - FR.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(f!.bounds[1] - FR.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(f!.bounds[2] - FR.w)).toBeLessThanOrEqual(2);
  expect(Math.abs(f!.bounds[3] - FR.h)).toBeLessThanOrEqual(2);
  // exactly one container layer was added; the empty frame is transparent so the
  // white base still shows inside it.
  const after = await page.evaluate(() => (window as any).__mv.engine.engine.layer_count());
  expect(after).toBe(before + 1);
  expect(isWhite(await pixel(page, FR.x + FR.w / 2, FR.y + FR.h / 2))).toBe(true);
});

// ── placing an image fills + clips the frame; undo restores the empty frame ──
test("placing an image fills the frame (clipped) and undo restores it", async ({ page }) => {
  const m = await setup(page);
  await frameDrag(page, m);
  const f = await frameLayer(page);
  expect(f).not.toBeNull();
  await greenPng(page, FR.w, FR.h);

  const beforeFill = await page.evaluate(() => (window as any).__mv.engine.engine.layer_count());
  // The frame is the active layer after the drag → store.fillFrame targets it.
  const imageId = await page.evaluate((fid) => {
    const mv = (window as any).__mv;
    return mv.store.fillFrame(fid, (window as any).__frameImg, "placed");
  }, f!.id);
  expect(imageId).toBeGreaterThan(0);

  // the image layer became a clipped member of the frame
  const member = await page.evaluate((ids) => {
    const mv = (window as any).__mv;
    const l = mv.store.state.layers.find((x: any) => x.id === ids.imageId);
    return { group: l ? l.group : -1, kind: l ? l.kind : -1 };
  }, { imageId });
  expect(member.group).toBe(f!.id); // clipped to the frame
  expect(member.kind).toBe(0);      // a pixel layer
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.layer_count())).toBe(beforeFill + 1);

  // inside the frame → the green image shows; outside the frame → clipped (white base)
  expect(isGreen(await pixel(page, f!.bounds[0] + f!.bounds[2] / 2, f!.bounds[1] + f!.bounds[3] / 2))).toBe(true);
  expect(isWhite(await pixel(page, 4, 4))).toBe(true);
  expect(isWhite(await pixel(page, DOCW - 4, DOCH - 4))).toBe(true);

  // undo removes the image layer → the empty (transparent) frame is restored
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.layer_count())).toBe(beforeFill);
  expect(isWhite(await pixel(page, f!.bounds[0] + f!.bounds[2] / 2, f!.bounds[1] + f!.bounds[3] / 2))).toBe(true);
});

// ── an elliptical frame clips its content to the inscribed ellipse ──
test("an elliptical frame clips the image to an ellipse", async ({ page }) => {
  const m = await setup(page);
  await page.evaluate(() => (window as any).__mv.store.setOptions({ frameMode: "ellipse" }));
  await frameDrag(page, m);
  const f = await frameLayer(page);
  expect(f).not.toBeNull();
  await greenPng(page, FR.w, FR.h);
  await page.evaluate((fid) => {
    const mv = (window as any).__mv;
    mv.store.fillFrame(fid, (window as any).__frameImg, "placed");
  }, f!.id);
  const [bx, by, bw, bh] = f!.bounds;
  // centre of the ellipse → green; a bounding-box corner → outside the ellipse → clipped (white)
  expect(isGreen(await pixel(page, bx + bw / 2, by + bh / 2))).toBe(true);
  expect(isWhite(await pixel(page, bx + 1, by + 1))).toBe(true);
});

// ── the Frame options bar exposes the Rectangular/Elliptical mode ──
test("the Frame tool options bar switches the frame mode", async ({ page }) => {
  await setup(page);
  await expect(page.getByText("Rectangular", { exact: true })).toBeVisible();
  await page.getByText("Elliptical", { exact: true }).click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.frameMode)).toBe("ellipse");
});
