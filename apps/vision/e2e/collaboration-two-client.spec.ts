import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const serverScript = fileURLToPath(new URL("../../../scripts/collab-server.mjs", import.meta.url));
let server: ChildProcess | null = null;

test.beforeAll(async () => {
  server = spawn(process.execPath, [serverScript], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: "1234", COLLAB_DATA: "" },
    stdio: "ignore",
  });
  await expect.poll(async () => {
    try { return (await fetch("http://127.0.0.1:1234")).ok; } catch { return false; }
  }, { timeout: 10_000 }).toBe(true);
});

test.afterAll(() => server?.kill());

async function openPeer(context: BrowserContext, room: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:1420/?room=${encodeURIComponent(room)}`);
  await page.waitForFunction(() => {
    const mv = (window as any).__mv;
    return mv?.engine?.engine && mv?.collab;
  });
  await page.evaluate(() => (window as any).__mv.collab.whenSynced());
  return page;
}

async function rgba(page: Page, x: number, y: number): Promise<number[]> {
  return page.evaluate(({ x, y }) => {
    const p = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0;
    return [(p >>> 24) & 255, (p >>> 16) & 255, (p >>> 8) & 255, p & 255];
  }, { x, y });
}

async function paint(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setTool("brush");
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 });
    mv.store.setBrush({ size: 22, hardness: 1, flow: 1, opacity: 1, spacing: 0.1 });
  });
  const box = await page.locator(".mv-canvas-viewport canvas").first().boundingBox();
  if (!box) throw new Error("Vision canvas is not visible");
  const w = await page.evaluate(() => (window as any).__mv.engine.engine.width());
  const h = await page.evaluate(() => (window as any).__mv.engine.engine.height());
  const at = (p: { x: number; y: number }) => ({ x: box.x + p.x * box.width / w, y: box.y + p.y * box.height / h });
  const a = at(from), b = at(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

test("two live Vision clients exchange strokes, presence, reconnects, and late-join history", async ({ browser }) => {
  const room = `vision-${Date.now()}-${process.pid}`;
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  try {
    const a = await openPeer(contexts[0], room);
    const b = await openPeer(contexts[1], room);
    await expect.poll(() => b.evaluate(() => (window as any).__mv.collab.peers().length)).toBe(1);

    const bHistory = await b.evaluate(() => (window as any).__mv.engine.engine.undo_depth());
    await paint(a, { x: 120, y: 180 }, { x: 220, y: 180 });
    await expect.poll(async () => (await rgba(b, 170, 180))[0]).toBeLessThan(40);
    expect(await b.evaluate(() => (window as any).__mv.engine.engine.undo_depth())).toBe(bHistory + 1);

    await paint(b, { x: 280, y: 180 }, { x: 380, y: 180 });
    await expect.poll(async () => (await rgba(a, 330, 180))[0]).toBeLessThan(40);

    await a.evaluate(() => (window as any).__mv.collab.setCursor({ x: 420, y: 220 }));
    await expect.poll(() => b.evaluate(() => (window as any).__mv.collab.peers()[0]?.cursor)).toEqual({ x: 420, y: 220 });
    await expect(b.locator(".monet-collab-cursors > div")).toHaveCount(1);

    await b.evaluate(() => (window as any).__mv.collab.provider.disconnect());
    await expect.poll(() => b.evaluate(() => (window as any).__mv.collab.provider.wsconnected)).toBe(false);
    const disconnectedHistory = await b.evaluate(() => (window as any).__mv.engine.engine.undo_depth());
    await paint(a, { x: 440, y: 180 }, { x: 540, y: 180 });
    expect((await rgba(b, 490, 180))[0]).toBeGreaterThan(240);
    await b.evaluate(() => new Promise<void>((resolve) => {
      const provider = (window as any).__mv.collab.provider;
      provider.once("sync", () => resolve());
      provider.connect();
    }));
    await expect.poll(async () => (await rgba(b, 490, 180))[0]).toBeLessThan(40);
    expect(await b.evaluate(() => (window as any).__mv.engine.engine.undo_depth())).toBe(disconnectedHistory + 1);

    const late = await openPeer(contexts[2], room);
    await expect.poll(async () => (await rgba(late, 170, 180))[0]).toBeLessThan(40);
    await expect.poll(async () => (await rgba(late, 330, 180))[0]).toBeLessThan(40);
    await expect.poll(async () => (await rgba(late, 490, 180))[0]).toBeLessThan(40);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
