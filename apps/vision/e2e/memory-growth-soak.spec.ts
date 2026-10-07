import { expect, test } from "@playwright/test";
import { gotoApp } from "./helpers";

const MIB = 1024 * 1024;

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const live = new Set<string>();
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => {
      const url = create(value);
      live.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      live.delete(url);
      revoke(url);
    };
    (window as any).__mvResourceProbe = () => live.size;
  });
  await gotoApp(page);
});

test("forced WebAssembly memory growth keeps live and reopened pixels stable", async ({ page }) => {
  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const signature = () => {
      const bytes = mv.engine.outputCopy() as Uint8ClampedArray;
      let checksum = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        const pixel = (i >> 2) + 1;
        checksum = (checksum + pixel * (bytes[i] * 3 + bytes[i + 1] * 5 + bytes[i + 2] * 7 + bytes[i + 3] * 11)) % 2147483647;
      }
      return checksum;
    };

    mv.store.newDocument(256, 192, "memory-growth", "transparent");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(20, 40, 80, 255); E.select_none();
    E.select_rect(17, 23, 91, 47, 0); E.fill_selection(220, 70, 30, 255); E.select_none();
    mv.engine.commit();
    const before = signature();

    const oldBuffer = mv.engine.mem.buffer as ArrayBuffer;
    const bytesBefore = oldBuffer.byteLength;
    mv.engine.mem.grow(4);
    const oldBufferBytesAfterGrowth = oldBuffer.byteLength;
    mv.engine.blit();
    const afterGrowth = signature();

    E.select_rect(140, 90, 53, 61, 0); E.fill_selection(40, 210, 90, 255); E.select_none();
    mv.engine.commit();
    const edited = signature();
    const project = mv.saveProjectBytes();
    mv.store.openProject(project, "memory-growth-reopened.mvision");
    const reopened = signature();

    return {
      before,
      afterGrowth,
      edited,
      reopened,
      bytesBefore,
      bytesAfter: mv.engine.mem.buffer.byteLength,
      oldBufferBytesAfterGrowth,
    };
  });

  expect(result.oldBufferBytesAfterGrowth).toBe(0);
  expect(result.bytesAfter).toBeGreaterThanOrEqual(result.bytesBefore + 4 * 64 * 1024);
  expect(result.afterGrowth).toBe(result.before);
  expect(result.edited).not.toBe(result.before);
  expect(result.reopened).toBe(result.edited);
});

test("edits, history, serialization, and tab churn stay bounded in one long session", async ({ page }) => {
  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const signature = () => {
      const bytes = mv.engine.outputCopy() as Uint8ClampedArray;
      let checksum = 0;
      for (let i = 0; i < bytes.length; i += 4) checksum = (checksum * 33 + bytes[i] + bytes[i + 1] * 3 + bytes[i + 2] * 7 + bytes[i + 3] * 11) >>> 0;
      return checksum;
    };

    mv.store.newDocument(512, 384, "soak", "transparent");
    const memoryBefore = mv.engine.mem.buffer.byteLength;
    for (let i = 0; i < 64; i++) {
      const E = mv.engine.engine;
      const x = (i * 37) % 448;
      const y = (i * 53) % 320;
      E.select_rect(x, y, 64, 64, 0);
      E.fill_selection((i * 17) & 255, (i * 43) & 255, (i * 89) & 255, 255);
      E.select_none();
      mv.engine.commit();
    }
    const edited = signature();
    for (let i = 0; i < 24; i++) mv.store.undo();
    for (let i = 0; i < 24; i++) mv.store.redo();
    const redone = signature();

    const project = mv.saveProjectBytes();
    const oldDoc = mv.store.state.activeDocId;
    mv.store.openProject(project, "soak-reopened.mvision");
    const keeper = mv.store.state.activeDocId;
    const reopened = signature();
    mv.store.closeDoc(oldDoc);

    for (let i = 0; i < 16; i++) {
      mv.store.newDocument(256, 256, `temporary-${i}`, "transparent");
      const temporary = mv.store.state.activeDocId;
      const E = mv.engine.engine;
      E.select_all(); E.fill_selection(i * 11, i * 7, i * 3, 255); E.select_none();
      mv.engine.commit();
      mv.store.activateDoc(keeper);
      mv.store.closeDoc(temporary);
    }

    return {
      edited,
      redone,
      reopened,
      active: mv.store.state.activeDocId,
      keeper,
      openDocuments: mv.store.state.documents.length,
      memoryGrowth: mv.engine.mem.buffer.byteLength - memoryBefore,
    };
  });

  expect(result.redone).toBe(result.edited);
  expect(result.reopened).toBe(result.edited);
  expect(result.active).toBe(result.keeper);
  expect(result.openDocuments).toBe(1);
  expect(result.memoryGrowth).toBeLessThan(128 * MIB);
});

test("document and dialog churn release JavaScript and DOM resources", async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  const dialog = page.getByRole("dialog", { name: "Search" });

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(128, 96, "resource-keeper", "transparent");
    mv.engine.engine.fill_selection(31, 73, 149, 255);
    mv.engine.commit();
    (window as any).__mvResourceSoak = {
      keeper: mv.store.state.activeDocId,
      project: mv.saveProjectBytes(),
    };
  });

  const churn = async () => {
    const openDocuments = await page.evaluate(() => {
      const mv = (window as any).__mv;
      const { keeper, project } = (window as any).__mvResourceSoak;
      for (let i = 0; i < 12; i++) {
        mv.store.openProject(project, `resource-${i}.mvision`);
        const temporary = mv.store.state.activeDocId;
        mv.engine.engine.fill_selection(i * 17, i * 29, i * 43, 255);
        mv.engine.commit();
        mv.saveProjectBytes();
        mv.store.activateDoc(keeper);
        mv.store.closeDoc(temporary);
      }
      return mv.store.state.documents.length;
    });
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("ControlOrMeta+KeyF");
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
    return openDocuments;
  };

  const resources = async () => {
    await session.send("HeapProfiler.collectGarbage");
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await session.send("HeapProfiler.collectGarbage");
    const heap = await session.send("Runtime.getHeapUsage") as { usedSize: number };
    const dom = await session.send("Memory.getDOMCounters") as {
      documents: number;
      nodes: number;
      jsEventListeners: number;
    };
    const objectUrls = await page.evaluate(() => (window as any).__mvResourceProbe() as number);
    return { heap: heap.usedSize, ...dom, objectUrls };
  };

  expect(await churn()).toBe(1);
  const first = await resources();
  expect(await churn()).toBe(1);
  const second = await resources();

  expect(second.objectUrls).toBe(first.objectUrls);
  expect(second.documents).toBeLessThanOrEqual(first.documents + 1);
  expect(second.nodes).toBeLessThanOrEqual(first.nodes + 100);
  expect(second.jsEventListeners).toBeLessThanOrEqual(first.jsEventListeners + 20);
  expect(second.heap - first.heap).toBeLessThan(32 * MIB);
});
