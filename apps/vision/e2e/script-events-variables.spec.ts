import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { composite, gotoApp, newScene } from "./helpers";

// #475: Script Events Manager bindings fire from real completions, and Variables
// ▸ Pixel Replacement is gated to the desktop app and applies as one undo step.

async function runExactCommand(page: Page, label: string) {
  await page.waitForFunction((exact) =>
    (window as any).__mv.commandPalette?.items?.some((item: any) => item.label === exact), label, { timeout: 5000 });
  await page.evaluate((exact) =>
    (window as any).__mv.commandPalette.items.find((item: any) => item.label === exact).run(), label);
}

async function choose(page: Page, combobox: string, option: string) {
  await page.getByRole("combobox", { name: combobox, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

const played = (page: Page) => page.evaluate(() => [...(window as any).__played]);
const docNames = (page: Page) => page.evaluate(() => (window as any).__mv.store.state.documents.map((d: any) => d.name));
const history = (page: Page) => page.evaluate(() => {
  const mv = (window as any).__mv;
  return { depth: mv.engine.engine.undo_depth(), last: mv.engine.engine.history_labels().at(-1) };
});

// These cases exercise document/event lifecycles; their actual image and
// replacement fixtures establish the pixels they assert.
test.beforeEach(async ({ page }) => { await gotoApp(page, { w: 256, h: 192 }); });

test("Script Events Manager stages edits until Done and plays bindings on Open, Export and Close only", async ({ page }) => {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    for (const name of ["On Open", "On Close", "On Export"]) {
      mv.actions.start(); mv.adj.invert(); mv.actions.stop(); mv.actions.save(name);
    }
    // scriptEvents.ts plays through this same object.
    const w = window as any, play = mv.actions.playNamed;
    w.__played = [];
    mv.actions.playNamed = (id: number, from?: number) => {
      w.__played.push(mv.actions.list().find((a: any) => a.id === id)?.name);
      return play.call(mv.actions, id, from);
    };
  });
  const dialog = page.getByRole("dialog", { name: "Script Events Manager" });

  await runExactCommand(page, "File ▸ Scripts ▸ Script Events Manager…");
  await page.getByRole("combobox", { name: "App event", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "App event" }).getByRole("option"))
    .toHaveText(["New Document", "Save Document", "Open Document", "Close Document", "Export Document"]);
  await page.getByRole("option", { name: "Open Document", exact: true }).click();
  await choose(page, "Bound action", "On Open");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Remove Open Document → On Open", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("mv.scriptEvents"))).toBeNull();

  await runExactCommand(page, "File ▸ Scripts ▸ Script Events Manager…");
  await expect(dialog.getByText("No events bound.")).toBeVisible();
  await choose(page, "Binding kind", "Script");
  await expect(dialog.getByRole("textbox", { name: "Script to run", exact: true })).toBeVisible();
  await choose(page, "Binding kind", "Action");
  for (const [event, action] of [["Open Document", "On Open"], ["Close Document", "On Close"], ["Export Document", "On Export"]]) {
    await choose(page, "App event", event);
    await choose(page, "Bound action", action);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
  }
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mv.scriptEvents")!).bindings.map((b: any) => [b.event, b.actionName])))
    .toEqual([["openDocument", "On Open"], ["closeDocument", "On Close"], ["exportDocument", "On Export"]]);

  // File ▸ Open raises Open Document.
  const chooser = page.waitForEvent("filechooser");
  await runExactCommand(page, "File ▸ Open…");
  await (await chooser).setFiles({ name: "opened.png", mimeType: "image/png", buffer: readFileSync(new URL("../src-tauri/fixtures/px.png", import.meta.url)) });
  await expect.poll(() => docNames(page)).toContain("opened.png");
  await expect.poll(() => played(page)).toEqual(["On Open"]);

  // Split Channels makes documents but is not an Open.
  const before = (await docNames(page)).length;
  await page.evaluate(() => (window as any).__mv.store.getWorkspace().openPanel("channels"));
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect.poll(async () => (await docNames(page)).length).toBe(before + 3);
  expect(await played(page)).toEqual(["On Open"]);

  // A document download raises Export Document.
  const download = page.waitForEvent("download");
  await runExactCommand(page, "File ▸ Export ▸ Quick Export as PNG");
  await download;
  await expect.poll(() => played(page)).toEqual(["On Open", "On Export"]);

  // Close Document waits for the discard confirmation.
  const name: string = await page.evaluate(() => {
    const { store } = (window as any).__mv;
    store.markDocDirty(store.state.activeDocId);
    return store.docName(store.state.activeDocId);
  });
  const close = page.getByRole("button", { name: `Close ${name}`, exact: true });
  const refused = page.waitForEvent("dialog").then((d) => d.dismiss());
  await close.click();
  await refused;
  await expect(close).toBeVisible();
  expect(await played(page)).toEqual(["On Open", "On Export"]);
  const accepted = page.waitForEvent("dialog").then((d) => d.accept());
  await close.click();
  await accepted;
  await expect.poll(() => docNames(page)).not.toContain(name);
  await expect.poll(() => played(page)).toEqual(["On Open", "On Export", "On Close"]);
});

test("the browser build disables Pixel Replacement and explains a refused data set without editing", async ({ page }) => {
  await newScene(page);
  await runExactCommand(page, "Image ▸ Variables ▸ Define…");
  const define = page.getByRole("dialog", { name: "Variables — Define" });
  await expect(define.getByText("needs the Monet Vision desktop app")).toBeVisible();
  await page.getByRole("combobox", { name: "Variable type for Background", exact: true }).click();
  await expect(page.getByRole("option", { name: "Pixel Replacement (Conform)", exact: true })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("option", { name: "Visibility", exact: true }).click();
  await define.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(define).toHaveCount(0);

  // A binding authored in the desktop app travels with the document.
  await page.evaluate(() => {
    const { store } = (window as any).__mv;
    store.setVariables([{ layer: "Background", name: "image", type: "pixel", fit: "conform" }]);
    store.importDataSets("image\n/fixtures/green.png", "");
  });
  const pixels = await composite(page);
  const { depth } = await history(page);
  await runExactCommand(page, "Image ▸ Variables ▸ Data Sets…");
  const sets = page.getByRole("dialog", { name: "Variables — Data Sets" });
  await sets.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(sets.getByRole("alert")).toContainText("Could not apply data set 1");
  await expect(sets.getByRole("alert")).toContainText("desktop app");
  expect((await composite(page)).chk).toBe(pixels.chk);
  expect((await history(page)).depth).toBe(depth);
});

test("desktop Pixel Replacement conforms the image in one undo step and reports a missing file", async ({ page }) => {
  await newScene(page);
  // A narrow @tauri-apps/plugin-fs IPC stand-in: open/fstat/seek/read/close on
  // one in-memory PNG. Every other command rejects.
  await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(2, 1);
    const cx = canvas.getContext("2d")!;
    cx.fillStyle = "#00ff00"; cx.fillRect(0, 0, 2, 1);
    const files = new Map([["/fixtures/green.png", new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer())]]);
    const handles = new Map<number, { bytes: Uint8Array; at: number }>();
    let rid = 1;
    const w = window as any;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd: string, args: any) => {
        const handle = handles.get(args?.rid);
        switch (cmd) {
          case "plugin:fs|open": {
            const bytes = files.get(args.path);
            if (!bytes) throw "No such file or directory (os error 2)";
            handles.set(rid, { bytes, at: 0 });
            return rid++;
          }
          case "plugin:fs|fstat":
            return { isFile: true, isDirectory: false, isSymlink: false, size: handle!.bytes.length, mtime: null, atime: null, birthtime: null, readonly: true, dev: 0, ino: 0, mode: 0, nlink: 0, uid: 0, gid: 0, rdev: 0, blksize: 0, blocks: 0 };
          case "plugin:fs|seek":
            if (args.whence !== 0) throw "only SeekMode.Start";
            return (handle!.at = args.offset);
          case "plugin:fs|read": {
            // plugin-fs returns the bytes followed by the big-endian 8-byte count.
            const chunk = handle!.bytes.subarray(handle!.at, handle!.at + args.len);
            handle!.at += chunk.length;
            const out = new Uint8Array(chunk.length + 8);
            out.set(chunk);
            new DataView(out.buffer).setBigUint64(chunk.length, BigInt(chunk.length));
            return out;
          }
          case "plugin:resources|close":
            handles.delete(args.rid);
            return null;
          default:
            throw `unexpected IPC ${cmd}`;
        }
      },
    };
    w.isTauri = true;
  });
  try {
    await runExactCommand(page, "Image ▸ Variables ▸ Define…");
    const define = page.getByRole("dialog", { name: "Variables — Define" });
    await define.getByRole("textbox", { name: "Variable for Background", exact: true }).fill("image");
    await page.getByRole("combobox", { name: "Variable type for Background", exact: true }).click();
    const pixelOption = page.getByRole("option", { name: "Pixel Replacement (Conform)", exact: true });
    await expect(pixelOption).not.toHaveAttribute("aria-disabled", "true");
    await pixelOption.click();
    await define.getByRole("button", { name: "OK", exact: true }).click();
    await expect(define).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__mv.store.state.variables))
      .toEqual([{ layer: "Background", name: "image", type: "pixel", fit: "conform" }]);

    // Relative paths resolve beside the imported CSV.
    await page.evaluate(() => (window as any).__mv.store.importDataSets("image\ngreen.png", "/fixtures"));
    const original = await composite(page);
    const start = await history(page);
    await runExactCommand(page, "Image ▸ Variables ▸ Data Sets…");
    const sets = page.getByRole("dialog", { name: "Variables — Data Sets" });
    await sets.getByRole("button", { name: "Apply", exact: true }).click();
    await expect.poll(() => history(page)).toEqual({ depth: start.depth + 1, last: "Apply Data Set 1" });
    await expect.poll(() => page.evaluate(() => {
      const mv = (window as any).__mv;
      const layer = mv.store.state.layers.find((l: any) => l.name === "Background");
      return { kind: layer.kind, rgba: (mv.engine.engine.pick_color(40, 100) >>> 0).toString(16) };
    })).toEqual({ kind: 0, rgba: "ff00ff" });
    await page.evaluate(() => (window as any).__mv.store.undo());
    expect((await composite(page)).chk).toBe(original.chk);

    await page.evaluate(() => (window as any).__mv.store.importDataSets("image\nmissing.png", "/fixtures"));
    const undone = await history(page);
    await sets.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(sets.getByRole("alert")).toContainText("Could not apply data set 1: No such file or directory");
    expect((await composite(page)).chk).toBe(original.chk);
    expect(await history(page)).toEqual(undone);
  } finally {
    await page.evaluate(() => { const w = window as any; delete w.__TAURI_INTERNALS__; delete w.isTauri; });
  }
});
