import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Layer ▸ Group Layers / New ▸ Group from Layers ──────
// Adobe: ⌘G (and Layer ▸ New ▸ Group from Layers) wraps the SELECTED layers in a
// new group. Vision previously only made an empty group (create_group tagged just
// the active layer); now the engine group_layers gathers the multi-selection
// contiguously under a new header. (New ▸ Group… still makes an empty group — #55.)
//   https://helpx.adobe.com/photoshop/using/creating-layers-groups.html

async function threeLayers(page: Page, doc: string): Promise<number[]> {
  await gotoApp(page);
  return await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, d);
    mv.store.addLayer(); mv.store.addLayer(); // 3 plain layers total
    return mv.store.state.layers.map((l: any) => l.id);
  }, doc);
}

async function runGroupLayers(page: Page) {
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.includes("Group Layers")), null, { timeout: 5000 });
  await page.keyboard.press("ControlOrMeta+KeyG");
}

test("Group Layers wraps the multi-selection in a contiguous group", async ({ page }) => {
  const ids = await threeLayers(page, "grp");
  // Multi-select two NON-adjacent layers (skip ids[1]).
  await page.evaluate((ids) => {
    const mv = (window as any).__mv;
    mv.store.selectLayer(ids[0]);
    mv.store.toggleLayerInSelection(ids[2]);
  }, ids);
  await runGroupLayers(page);
  const info = await page.evaluate((ids) => {
    const ls = (window as any).__mv.store.state.layers;
    const header = ls.find((l: any) => l.kind === 6);
    const gid = header ? header.id : 0;
    const idx = (id: number) => ls.findIndex((l: any) => l.id === id);
    const pos = [idx(gid), idx(ids[0]), idx(ids[2])].sort((a, b) => a - b);
    return {
      count: ls.length, gid,
      g0: ls.find((l: any) => l.id === ids[0])?.group,
      g1: ls.find((l: any) => l.id === ids[1])?.group,
      g2: ls.find((l: any) => l.id === ids[2])?.group,
      consecutive: pos[1] === pos[0] + 1 && pos[2] === pos[1] + 1,
    };
  }, ids);
  expect(info.gid).toBeGreaterThan(0);          // a group header was created
  expect(info.count).toBe(ids.length + 1);      // +1 header
  expect(info.g0).toBe(info.gid);               // selected layers reparented
  expect(info.g2).toBe(info.gid);
  expect(info.g1).toBe(0);                       // the non-selected layer stays top-level
  expect(info.consecutive).toBe(true);          // header + its 2 children are contiguous
});
