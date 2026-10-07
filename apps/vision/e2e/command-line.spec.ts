import { readFileSync } from "node:fs";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Command line (#468) ────────────────────────────────────────
// `monet-vision --run-script foo.js` and `--play-action "Set/Name" --batch dir`
// run in a hidden native window (src-tauri/main.rs) that Playwright cannot
// drive; scripts/native-webview-e2e.mjs covers that end to end. Here: the
// Batch and Scripting Console dialogs' Copy as Command Line, and the webview
// half of a job — exit statuses, refusing an unknown action before anything
// changes, and prompts answered without anyone there.

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

type CliResult = { code: number; stdout: string; stderr: string };

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

/** Record adj.invert, optionally saving it under `name`. */
const recordInvert = (page: Page, name?: string) => page.evaluate((name) => {
  const mv = (window as any).__mv;
  mv.actions.start();
  mv.adj.invert();
  mv.actions.stop();
  return name ? mv.actions.save(name) as number : 0;
}, name);

/** Preferences and open documents — what invalid input and Cancel must leave alone. */
const snapshot = (page: Page) => page.evaluate(() => {
  const mv = (window as any).__mv;
  return {
    storage: Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])),
    documents: mv.store.state.documents.map((d: any) => ({ id: d.id, name: d.name, dirty: d.dirty })),
    active: mv.store.state.activeDocId,
  };
});

/** Start `body` (with `mv` in scope) in the page and wait for what it resolves
 *  to. Returning a long-pending promise from evaluate lets CDP collect it. */
async function settle<T>(page: Page, body: string): Promise<T> {
  await page.evaluate((body) => {
    const w = window as any;
    w.__cliSettled = undefined;
    // eslint-disable-next-line no-new-func
    Promise.resolve(new Function("mv", body)(w.__mv)).then(
      (value) => { w.__cliSettled = { value }; },
      (error) => { w.__cliSettled = { error: String(error) }; },
    );
  }, body);
  const settled = await (await page.waitForFunction(() => (window as any).__cliSettled, null, { timeout: 30_000 })).jsonValue();
  expect(settled.error).toBeUndefined();
  return settled.value as T;
}

async function openBatch(page: Page): Promise<Locator> {
  await page.evaluate(() => (window as any).__mv.store.requestDialog("batch"));
  const dialog = page.getByRole("dialog", { name: "Batch" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function pickOption(page: Page, select: string, option: string) {
  await page.locator(select).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("Batch copies a command line only for a saved action over a source folder, and Cancel changes nothing", async ({ page }) => {
  await gotoApp(page);
  await recordInvert(page);
  let dialog = await openBatch(page);
  const copy = dialog.getByRole("button", { name: "Copy as Command Line" });
  // A new process can't play a recording that was never saved.
  await expect(copy).toBeDisabled();
  await expect(copy).toHaveAttribute("title", "Save the action first");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await page.evaluate(() => (window as any).__mv.actions.save("Invert"));
  const before = await snapshot(page);
  dialog = await openBatch(page);
  await expect(copy).toHaveAttribute("title", "Set Source to Folder");
  await pickOption(page, "#mv-batch-source", "Folder…");
  await expect(copy).toHaveAttribute("title", "Enter a source folder");
  await dialog.getByLabel("Batch source folder path").fill("/tmp/in dir");
  const subfolders = dialog.locator("#mv-batch-subfolders");
  await subfolders.focus();
  await page.keyboard.press("Space");
  await expect(subfolders).toHaveAttribute("aria-checked", "false");

  await expect(copy).toBeEnabled();
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => clipboard(page)).toBe(
    "monet-vision --play-action 'Default Actions/Invert' --batch '/tmp/in dir' --no-subfolders"
    + " --format png --template '{name}_{serial}_processed' --serial 1",
  );
  await expect(dialog.locator("#mv-batch-copy-status")).toHaveText("Command copied to the clipboard");

  await pickOption(page, "#mv-batch-destination", "Save and Close");
  await copy.click();
  await expect.poll(() => clipboard(page)).toBe(
    "monet-vision --play-action 'Default Actions/Invert' --batch '/tmp/in dir' --no-subfolders --destination save-and-close",
  );

  // Copying ran nothing; Cancel applies nothing.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await snapshot(page)).toEqual(before);
});

test("Scripting Console downloads the script and copies the command line that runs it", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.requestDialog("script"));
  const dialog = page.getByRole("dialog", { name: "Scripting Console" });
  await expect(dialog).toBeVisible();
  const code = 'vision.log("from the command line");';
  await dialog.getByRole("textbox").fill(code);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Copy as Command Line" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("script.js");
  expect(readFileSync(await download.path(), "utf8")).toBe(code);
  await expect.poll(() => clipboard(page)).toBe("monet-vision --run-script script.js");
  await expect(dialog.getByText("✓ Command copied to the clipboard")).toBeVisible();
});

test("a command-line script exits 0 with its log, or 1 with its error", async ({ page }) => {
  await gotoApp(page);
  expect(await settle<CliResult>(page, `return mv.runCliScript('vision.log("hi", 1);')`))
    .toEqual({ code: 0, stdout: "hi 1", stderr: "" });
  expect(await settle<CliResult>(page, "return mv.runCliScript('vision.deselect();')"))
    .toEqual({ code: 0, stdout: "", stderr: "" });
  const failed = await settle<CliResult>(page, "return mv.runCliScript('vision.nope.x();')");
  expect(failed.code).toBe(1);
  expect(failed.stdout).toBe("");
  expect(failed.stderr).not.toBe("");
});

test("a command-line job naming no saved action exits 2, lists the saved ones and changes nothing", async ({ page }) => {
  await gotoApp(page);
  await recordInvert(page, "Invert");
  const before = await snapshot(page);
  const result = await settle<CliResult>(page,
    `return mv.runCliJob({ action: "Nope/Missing", batch: "/x", destination: "folder", subfolders: true })`);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('"Nope/Missing"');
  expect(result.stderr).toContain("Default Actions/Invert");
  expect(await snapshot(page)).toEqual(before);
});

test("an unattended batch answers every prompt itself, collects alerts and restores alert and confirm", async ({ page }) => {
  await gotoApp(page);
  const prompts: string[] = [];
  page.on("dialog", (d) => { prompts.push(d.message()); void d.dismiss(); });
  const result = await settle<Record<string, unknown>>(page, `
    const E = () => mv.engine.engine;
    // Record first: an untouched boot document is replaced by the next New,
    // which would leave nothing open once batch-source closes.
    mv.actions.start(); mv.adj.invert(); mv.actions.stop();
    const previous = mv.store.state.activeDocId;
    mv.store.newDocument(16, 16, "batch-source");
    E().select_all(); E().fill_selection(200, 40, 30, 255); E().select_none(); mv.engine.commit();
    const png = E().export_png();
    mv.store.closeDoc(mv.store.state.activeDocId);
    mv.store.activateDoc(previous);
    const file = (name) => new File([png], name, { type: "image/png" });

    const paused = mv.actions.save("Paused");
    mv.actions.setStepDialog(paused, 0, true);                    // modal step: confirm
    mv.actions.insertStop(paused, "Check the colours", true);     // Stop with Continue: confirm
    const halted = mv.actions.save("Halted");
    mv.actions.insertStop(halted, "Halt", false);                 // Stop: alert

    const shown = { alert: window.alert, confirm: window.confirm };
    const pixel = () => {
      const packed = E().pick_color(8, 8) >>> 0;
      return [(packed >>> 24) & 255, (packed >>> 16) & 255, (packed >>> 8) & 255];
    };
    return mv.runUnattended(() => mv.batchProcessFiles([file("a.png"), file("b.png")], paused, "png", { destination: "none" }))
      .then(async (paused) => {
        const pausedPixel = pixel();
        const halted2 = await mv.runUnattended(() => mv.batchProcessFiles([file("c.png")], halted, "png", { destination: "none" }));
        return {
          paused: paused.value, pausedAlerts: paused.alerts, pausedPixel,
          halted: halted2.value, haltedAlerts: halted2.alerts,
          restored: window.alert === shown.alert && window.confirm === shown.confirm,
        };
      });
  `);
  expect(result).toEqual({
    paused: 2, pausedAlerts: [], pausedPixel: [55, 215, 225], // the modal invert was applied
    halted: 1, haltedAlerts: ["Halt"],
    restored: true,
  });
  expect(prompts).toEqual([]);
});
