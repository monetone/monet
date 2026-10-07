import { test, expect } from "@playwright/test";
import { gotoApp, waitForNode, cspViolations } from "./helpers";

// Unity-parity object Tags. Each object carries one tag (omitted ⇒ "Untagged");
// the project owns the list of available tags. Tags are identification metadata,
// exported as Phaser object data (setData('tag', …)) so the runnable game can
// query objects by tag. Specs drive the live editor through `window.__mj`. Under
// the `desktop` project (shipped bundle + Tauri CSP) this doubles as the CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a new project seeds the default tag set", async ({ page }) => {
  const tags = await page.evaluate(() => window.__mj.store.getProject().tags);
  expect(tags).toEqual(["Untagged", "Player", "Enemy"]);
});

test("setTag assigns a tag to an object", async ({ page }) => {
  const tag = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    cmd.setTag(id, "Enemy");
    return query.findObject(query.activeScene(store.getProject()), id).tag;
  });
  expect(tag).toBe("Enemy");
});

test("addTag adds a unique tag to the project list", async ({ page }) => {
  const tags = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.addTag("Boss");
    cmd.addTag("Boss"); // dupe ignored
    return store.getProject().tags;
  });
  expect(tags).toContain("Boss");
  expect(tags.filter((t: string) => t === "Boss")).toHaveLength(1);
});

test("removing a tag reassigns its objects back to Untagged", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    cmd.addTag("FX");
    const id = cmd.addObject("rectangle");
    cmd.setTag(id, "FX");
    cmd.removeTag("FX");
    const proj = store.getProject();
    return { tags: proj.tags, tag: query.findObject(query.activeScene(proj), id).tag };
  });
  expect(r.tags).not.toContain("FX");
  expect(r.tag).toBe("Untagged");
});

test("the Untagged tag cannot be removed", async ({ page }) => {
  const tags = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.removeTag("Untagged");
    return store.getProject().tags;
  });
  expect(tags).toContain("Untagged");
});

test("export emits setData('tag', …) for tagged objects only", async ({ page }) => {
  const js = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const tagged = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.setTag(tagged, "Enemy");
    cmd.addObject("rectangle", { x: 100, y: 100 }); // left Untagged
    return window.__mj.exporter.exportGameJs(store.getProject());
  });
  expect(js).toContain("setData('tag', \"Enemy\")");
  expect((js.match(/setData\('tag'/g) || []).length).toBe(1); // only the tagged object
});

test("tags survive a .jouer round-trip", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, jouer } = window.__mj;
    cmd.addTag("Pickup");
    const id = cmd.addObject("rectangle");
    cmd.setTag(id, "Pickup");
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return { tags: back.tags, tag: scene.objects.find((o: any) => o.id === id).tag };
  });
  expect(r.tags).toContain("Pickup");
  expect(r.tag).toBe("Pickup");
});

test("tags run under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 50, y: 50 });
    cmd.setTag(id, "Player");
    return id;
  });
  await waitForNode(page, id);
  expect(await cspViolations(page)).toEqual([]);
});
