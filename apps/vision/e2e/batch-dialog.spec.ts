import { test, expect, type Locator, type Page } from "@playwright/test";
import { gotoApp, tinyLinearDng } from "./helpers";

// ── File ▸ Automate ▸ Batch dialog (#472) ──────────────────────
// Override Action "Save As" Commands, Destination None / Save and Close,
// Starting serial #, Suppress File Open Options Dialogs / Color Profile
// Warnings, per-file progress and Cancel. Nothing waits on time: an in-page
// MutationObserver records every progress text the dialog renders (it survives
// the dialog remounting around Camera Raw) and can press Cancel the moment a
// matching text appears, so a fast run can't slip past the test.

type Payload = { name: string; mimeType: string; buffer: Buffer };

const INVERTED = [55, 215, 225]; // the solid (200, 40, 30) sources, inverted

/** Record and save an action from `steps` (run with `mv` in scope). */
async function saveAction(page: Page, name: string, steps: string) {
  await page.evaluate(({ name, steps }) => {
    const mv = (window as any).__mv;
    mv.actions.start();
    // eslint-disable-next-line no-new-func
    new Function("mv", steps)(mv);
    mv.actions.stop();
    mv.actions.save(name);
  }, { name, steps });
}

/** Solid 16×16 (200, 40, 30) PNGs rendered by the engine, as file-chooser payloads. */
async function solidPngs(page: Page, names: string[]): Promise<Payload[]> {
  const bytes = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const previous = mv.store.state.activeDocId;
    mv.store.newDocument(16, 16, "batch-source");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(200, 40, 30, 255); E.select_none(); mv.engine.commit();
    const png = Array.from(E.export_png() as Uint8Array);
    mv.store.closeDoc(mv.store.state.activeDocId);
    mv.store.activateDoc(previous);
    return png;
  });
  return names.map((name) => ({ name, mimeType: "image/png", buffer: Buffer.from(bytes) }));
}

const openIds = (page: Page) => page.evaluate(() => (window as any).__mv.store.openDocIds() as number[]);

/** The top-left-centre pixel of each document, activating each in turn. */
const pixels = (page: Page, ids: number[]) => page.evaluate((ids) => {
  const mv = (window as any).__mv;
  return ids.map((id) => {
    mv.store.activateDoc(id);
    const packed = mv.engine.engine.pick_color(8, 8) >>> 0;
    return [(packed >>> 24) & 255, (packed >>> 16) & 255, (packed >>> 8) & 255];
  });
}, ids);

/** Open the Batch dialog, with the progress recorder installed. */
async function openBatch(page: Page): Promise<Locator> {
  await page.evaluate(() => {
    const w = window as any;
    if (!w.__batchStatus) {
      w.__batchStatus = [];
      w.__batchSeen = "";
      new MutationObserver(() => {
        const text = document.getElementById("mv-batch-progress")?.textContent ?? "";
        if (!text || text === w.__batchSeen) return;
        w.__batchSeen = text;
        w.__batchStatus.push(text);
        if (w.__batchCancelOn?.test(text)) { w.__batchCancelOn = null; w.__batchCancel(); }
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    w.__mv.store.requestDialog("batch");
  });
  const dialog = page.getByRole("dialog", { name: "Batch" });
  await expect(dialog).toBeVisible();
  return dialog;
}

const statuses = (page: Page) => page.evaluate(() => (window as any).__batchStatus as string[]);
const report = (page: Page) => page.evaluate(() => ((window as any).__batchStatus as string[]).find((s) => s.startsWith("Processed")) ?? "");

/** Forget recorded progress; the text already on screen does not count again. */
const clearStatuses = (page: Page) => page.evaluate(() => {
  const w = window as any;
  w.__batchStatus = [];
  w.__batchSeen = document.getElementById("mv-batch-progress")?.textContent ?? "";
});

/** From inside the page, press Cancel (or Escape) as soon as a progress text matches. */
const cancelWhen = (page: Page, pattern: string, via: "button" | "escape") => page.evaluate(({ pattern, via }) => {
  const w = window as any;
  w.__batchCancelOn = new RegExp(pattern);
  w.__batchCancel = () => {
    if (via === "escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    else [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === "Cancel")!.click();
  };
}, { pattern, via });

async function pickOption(page: Page, select: string, option: string) {
  await page.locator(select).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** Click Run, feed the file chooser when the Source asks for files, and wait for the report. */
async function runBatch(page: Page, dialog: Locator, files: Payload[] | null): Promise<string> {
  await clearStatuses(page);
  const chooser = files ? page.waitForEvent("filechooser") : null;
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  if (chooser && files) await (await chooser).setFiles(files);
  await expect.poll(() => report(page), { timeout: 30_000 }).toMatch(/^Processed /);
  return report(page);
}

test("Batch overrides recorded Save As commands, numbers from the Starting serial #, and shows n of N per file", async ({ page }) => {
  await gotoApp(page);
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await saveAction(page, "Invert and export", `mv.adj.invert(); mv.exportPNG("recorded.png");`);
  await expect.poll(() => downloads.length).toBe(1); // the export performed while recording
  downloads.length = 0;
  const files = await solidPngs(page, ["a.png", "b.png"]);
  const dialog = await openBatch(page);

  // Keyboard: the checkbox is a focusable button toggled with Space.
  const override = dialog.locator("#mv-batch-override-save");
  await override.focus();
  await page.keyboard.press("Space");
  await expect(override).toHaveAttribute("aria-checked", "true");
  await expect(dialog.locator("#mv-batch-override-open")).toHaveAttribute("aria-checked", "true");
  await expect(dialog.locator("#mv-batch-override-open")).toBeDisabled();
  await dialog.locator("#mv-batch-serial").fill("7");

  expect(await runBatch(page, dialog, files)).toBe("Processed 2 of 2: a.png, b.png");
  expect(await statuses(page)).toEqual(expect.arrayContaining(["1 of 2 — a.png", "2 of 2 — b.png"]));
  await expect(dialog.getByRole("status")).toHaveText("Processed 2 of 2: a.png, b.png");
  await expect.poll(() => [...downloads].sort()).toEqual(["a_007_processed.png", "b_008_processed.png"]);

  // Without the override the recorded export runs too, once per file.
  await override.focus();
  await page.keyboard.press("Space");
  await expect(override).toHaveAttribute("aria-checked", "false");
  downloads.length = 0;
  expect(await runBatch(page, dialog, files)).toBe("Processed 2 of 2: a.png, b.png");
  await expect.poll(() => [...downloads].sort()).toEqual(["a_007_processed.png", "b_008_processed.png", "recorded.png", "recorded.png"]);
});

test("Batch Destination None plays the action on every file and writes nothing", async ({ page }) => {
  await gotoApp(page);
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await saveAction(page, "Invert", "mv.adj.invert();");
  const files = await solidPngs(page, ["a.png", "b.png"]);
  const before = await openIds(page);
  const dialog = await openBatch(page);
  await pickOption(page, "#mv-batch-destination", "None");
  await expect(dialog.locator("#mv-batch-serial")).toHaveCount(0);
  await expect(dialog.locator("#mv-batch-override-save")).toBeDisabled();

  expect(await runBatch(page, dialog, files)).toBe("Processed 2 of 2: a.png, b.png");
  const added = (await openIds(page)).filter((id) => !before.includes(id));
  expect(added).toHaveLength(2);
  expect(await pixels(page, added)).toEqual([INVERTED, INVERTED]);
  expect(downloads).toEqual([]);
});

test("Batch Save and Close saves each opened document, closes it, and reports on the Home screen", async ({ page }) => {
  await gotoApp(page);
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  const prompts: string[] = [];
  page.on("dialog", (d) => { prompts.push(d.message()); void d.dismiss(); });
  await saveAction(page, "Invert", "mv.adj.invert();");
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    for (const id of mv.store.openDocIds()) mv.store.closeDoc(id);
    for (const name of ["one", "two"]) {
      mv.store.newDocument(16, 16, name);
      const E = mv.engine.engine;
      E.select_all(); E.fill_selection(200, 40, 30, 255); E.select_none(); mv.engine.commit();
    }
  });
  const dialog = await openBatch(page);
  await pickOption(page, "#mv-batch-source", "Opened Files");
  await pickOption(page, "#mv-batch-destination", "Save and Close");

  expect(await runBatch(page, dialog, null)).toMatch(/^Processed 2 of 2/);
  await expect.poll(() => page.evaluate(() => (window as any).__mv.store.state.documents.length)).toBe(0);
  await expect.poll(() => downloads.length).toBe(2);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("Processed 2 of 2");
  expect(prompts).toEqual([]);
});

test("Batch Cancel (button or Escape) stops after the current file and leaves the rest untouched", async ({ page }) => {
  await gotoApp(page);
  await saveAction(page, "Invert", "mv.adj.invert();");
  const files = await solidPngs(page, ["1.png", "2.png", "3.png", "4.png", "5.png", "6.png"]);
  const dialog = await openBatch(page);
  await pickOption(page, "#mv-batch-destination", "None");

  for (const via of ["button", "escape"] as const) {
    const before = await openIds(page);
    await cancelWhen(page, " of 6 — ", via);
    const text = await runBatch(page, dialog, files);
    const match = /^Processed (\d) of 6 — cancelled/.exec(text);
    expect(match, text).not.toBeNull();
    const k = Number(match![1]);
    expect(k).toBeGreaterThanOrEqual(1);
    expect(k).toBeLessThan(6);
    // Exactly the files that started were opened, and each one got the whole action.
    const added = (await openIds(page)).filter((id) => !before.includes(id));
    expect(added).toHaveLength(k);
    expect(await pixels(page, added)).toEqual(Array.from({ length: k }, () => INVERTED));
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
  }
});

test("Batch refuses an invalid Starting serial # without running or changing anything", async ({ page }) => {
  await gotoApp(page);
  await saveAction(page, "Invert", "mv.adj.invert();");
  let choosers = 0;
  page.on("filechooser", () => { choosers++; });
  const dialog = await openBatch(page);
  const snapshot = () => page.evaluate(() => ({
    documents: (window as any).__mv.store.openDocIds(),
    storage: JSON.stringify(Object.entries(localStorage).sort()),
  }));
  const before = await snapshot();
  const serial = dialog.locator("#mv-batch-serial");
  for (const bad of ["-1", "2.5"]) {
    await serial.fill(bad);
    await expect(serial).not.toHaveAttribute("aria-invalid", "true");
    await dialog.getByRole("button", { name: "Run", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Starting serial # must be a whole number of 0 or more — nothing was run.");
    await expect(serial).toHaveAttribute("aria-invalid", "true");
    await expect(serial).toHaveAttribute("aria-describedby", "mv-batch-serial-error");
    await expect(serial).toBeFocused();
  }
  expect(choosers).toBe(0);
  expect(await statuses(page)).toEqual([]);
  expect(await snapshot()).toEqual(before);
});

test("Batch Suppress File Open Options Dialogs develops RAW files without Camera Raw; unsuppressed, Batch comes back after it", async ({ page }) => {
  await gotoApp(page);
  await saveAction(page, "Invert", "mv.adj.invert();");
  const dng: Payload = { name: "shot.dng", mimeType: "image/x-adobe-dng", buffer: Buffer.from(tinyLinearDng(41)) };
  const [png] = await solidPngs(page, ["b.png"]);
  await page.evaluate(() => {
    const w = window as any;
    w.__cameraRawShown = false;
    new MutationObserver(() => {
      if (document.querySelector("[data-mv-cr-open]")) w.__cameraRawShown = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  let before = await openIds(page);
  const dialog = await openBatch(page);
  await pickOption(page, "#mv-batch-destination", "None");
  await dialog.locator("#mv-batch-suppress-open").click();
  await expect(dialog.locator("#mv-batch-suppress-open")).toHaveAttribute("aria-checked", "true");

  expect(await runBatch(page, dialog, [dng])).toBe("Processed 1 of 1: shot.dng");
  expect(await page.evaluate(() => (window as any).__cameraRawShown)).toBe(false);
  expect((await openIds(page)).filter((id) => !before.includes(id))).toHaveLength(1);

  // Unsuppressed: Camera Raw takes the single dialog slot, and the run's
  // progress and report come back in the Batch dialog once it closes.
  before = await openIds(page);
  await dialog.locator("#mv-batch-suppress-open").click();
  await expect(dialog.locator("#mv-batch-suppress-open")).toHaveAttribute("aria-checked", "false");
  await clearStatuses(page);
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  await (await chooser).setFiles([dng, png]);
  const raw = page.getByRole("dialog", { name: "Camera Raw" });
  await expect(raw).toBeVisible({ timeout: 30_000 });
  await raw.locator("[data-mv-cr-open]").click();
  await expect.poll(() => report(page), { timeout: 30_000 }).toBe("Processed 2 of 2: shot.dng, b.png");
  await expect(dialog.getByRole("status")).toHaveText("Processed 2 of 2: shot.dng, b.png");
  expect(await statuses(page)).toContain("2 of 2 — b.png");
  expect((await openIds(page)).filter((id) => !before.includes(id))).toHaveLength(2);
});

test("Batch Suppress Color Profile Warnings keeps an embedded profile and leaves an untagged file as is", async ({ page }) => {
  await gotoApp(page);
  await saveAction(page, "Invert", "mv.adj.invert();");
  const setup = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const base = mv.store.state.activeDocId;
    mv.store.assignProfile(0); // working RGB = sRGB
    mv.store.newDocument(18, 18, "adobe");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(220, 40, 30, 255); E.select_none(); mv.engine.commit();
    mv.store.assignProfile(2); // Adobe RGB (1998)
    const psd = Array.from(mv.exportPSDBytes() as Uint8Array);
    mv.store.closeDoc(mv.store.state.activeDocId);
    mv.store.activateDoc(base);
    mv.store.setColorPolicyPrefs({ embeddedProfilePolicy: "ask", missingProfilePolicy: "ask" });
    const w = window as any;
    w.__confirms = [];
    window.confirm = (message?: string) => { w.__confirms.push(String(message)); return true; };
    return { base, psd };
  });
  const psd: Payload = { name: "adobe.psd", mimeType: "image/vnd.adobe.photoshop", buffer: Buffer.from(setup.psd) };
  const [png] = await solidPngs(page, ["untagged.png"]);
  const confirms = () => page.evaluate(() => ((window as any).__confirms as string[]).length);
  const activeProfile = () => page.evaluate(() => {
    const s = (window as any).__mv.store.state;
    return { profile: s.colorProfile, assigned: s.colorProfileAssigned };
  });
  const dialog = await openBatch(page);
  await pickOption(page, "#mv-batch-destination", "None");

  // Unsuppressed, the mismatch asks once.
  expect(await runBatch(page, dialog, [psd])).toBe("Processed 1 of 1: adobe.psd");
  expect(await confirms()).toBe(1);

  // Suppressed from an sRGB document: no prompt, embedded profile kept.
  await page.evaluate((id) => (window as any).__mv.store.activateDoc(id), setup.base);
  await dialog.locator("#mv-batch-suppress-profile").click();
  await expect(dialog.locator("#mv-batch-suppress-profile")).toHaveAttribute("aria-checked", "true");
  expect(await runBatch(page, dialog, [psd])).toBe("Processed 1 of 1: adobe.psd");
  expect(await confirms()).toBe(1);
  expect((await activeProfile()).profile).toBe(2);

  // Suppressed with an Adobe RGB working space and an untagged file: no prompt, left untagged.
  expect(await runBatch(page, dialog, [png])).toBe("Processed 1 of 1: untagged.png");
  expect(await confirms()).toBe(1);
  expect((await activeProfile()).assigned).toBe(false);
});
