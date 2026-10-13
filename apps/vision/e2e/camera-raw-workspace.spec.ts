import { test, expect, type Page } from "@playwright/test";
import { gotoApp, newScene, composite, tinyCfaDng, tinyDcp, tinyLinearDng } from "./helpers";

// ── Filter ▸ Camera Raw Filter… — develop workspace (Phase 2) ───────
// The workspace previews on a scratch proxy engine (never the live document),
// so Cancel is byte-identical by construction and OK bakes exactly one history
// step. On a smart object the recipe rides fid 17 (append then update-in-place).
// The develop params are built inline (length 1050, offsets mirroring
// state/cameraRaw.recipeToParams) so this drives the real Rust `develop_buf`.

const DEVELOP_LEN = 1050;

async function stageRaw(page: Page, bytes: Uint8Array, name: string, options: {
  invocation?: "raw-open" | "open-as-smart-object";
  seedEditLimits?: boolean;
} = {}) {
  return page.evaluate(async ({ payload, name, invocation, seedEditLimits }) => {
    const mv = (window as any).__mv;
    const input = new Uint8Array(payload);
    const digest = await crypto.subtle.digest("SHA-256", input.slice().buffer);
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const documentIds = mv.store.openDocIds() as number[];
    const sessionId = mv.store.openRaw(input, name, { sha256, originalPath: `/hostile/${name}`, invocation });
    if (seedEditLimits) {
      const runtime = mv.store.cameraRawWorkspaceSession(sessionId);
      if (!runtime?.source) throw new Error("Camera Raw runtime not found");
      runtime.source.recipe.toneCurve.point = Array.from({ length: 128 }, (_, index) => ({
        x: index / 127,
        y: 0.5,
      }));
      const adjustments = {
        temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0,
        whites: 0, blacks: 0, texture: 0, clarity: 0, dehaze: 0, saturation: 0,
        sharpness: 0, noiseReduction: 0, moire: 0, defringe: 0,
      };
      runtime.source.recipe.heal.spots = Array.from({ length: 64 }, (_, index) => ({
        id: `seed-heal-${index + 1}`, mode: "heal", x: 0.25, y: 0.25,
        sourceX: 0.35, sourceY: 0.25, radius: 0.025, feather: 0.5, opacity: 1,
      }));
      runtime.source.recipe.engineMasks = Array.from({ length: 31 }, (_, index) => ({
        id: `seed-mask-${index + 1}`,
        name: index === 0 ? "Color limit" : index === 1 ? "Point limit" : `Seed mask ${index + 1}`,
        kind: index === 0 ? "color-range" : "brush",
        enabled: true, inverted: false, opacity: 1, feather: 0.5,
        points: index === 1
          ? Array.from({ length: 4096 }, (_, point) => ({
              x: (point % 64) / 63, y: (Math.floor(point / 64) % 64) / 63, pressure: 1,
            }))
          : [],
        ...(index === 0 ? {
          colorSamples: Array.from({ length: 64 }, (_, sample) => [sample * 4, 128, 255 - sample * 4]),
        } : {}),
        adjustments: { ...adjustments },
      }));
    }
    // The store must own a defensive copy; mutating the caller's buffer after
    // staging must not corrupt the source eventually embedded in the project.
    input.fill(0);
    return { sessionId, sha256, documentIds };
  }, { payload: Array.from(bytes), name, ...options });
}

async function expectRawWorkspace(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Camera Raw", { exact: true })).toBeVisible();
  return dialog;
}

/** Await a session's terminal disposition. Records it in-page and polls
 * instead of returning the store's promise through page.evaluate: CDP's
 * awaitPromise holds its wrapper promise weakly, and a GC while the completion
 * is still pending collects it (protocol error "Promise was collected",
 * surfaced as "Execution context was destroyed ... navigation") — pinning the
 * app promise in a page global does not root the wrapper, so long-pending
 * evaluates stay flaky. Worst on cold boots: retiring the session frees its
 * scratch WASM engine, spiking GC pressure at the resolution moment. */
async function waitForDisposition(page: Page, sessionId: string): Promise<string | null> {
  await page.evaluate((id) => {
    const w = window as any;
    const recorded = (w.__e2eDispositions ??= {} as Record<string, string>);
    void w.__mv.store.waitForCameraRawSession(id).then((disposition: string | null) => {
      recorded[id] = disposition ?? "__null__";
    });
  }, sessionId);
  const handle = await page.waitForFunction((id) => (window as any).__e2eDispositions[id], sessionId);
  const disposition = (await handle.jsonValue()) as string;
  return disposition === "__null__" ? null : disposition;
}

type CameraRawDevelopState = { frame: number; checksum: number };

/** An atomic snapshot of the develop frame and preview pixels. */
const cameraRawDevelopState = (page: Page): Promise<CameraRawDevelopState> =>
  page.evaluate(() => {
    const cv = document.querySelector("[data-mv-cr-canvas]") as HTMLCanvasElement | null;
    const frame = Number(cv?.dataset.mvCrDevelopFrame ?? -1);
    if (!cv || !cv.width || !cv.height) return { frame, checksum: 0 };
    const ctx = cv.getContext("2d");
    if (!ctx) return { frame, checksum: 0 };
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let checksum = 0;
    for (let i = 0; i < d.length; i += 4) checksum = (checksum + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7) % 2147483647;
    return { frame, checksum };
  });

/** A checksum of the workspace preview canvas' pixels (0 when empty). */
const canvasChk = async (page: Page) => (await cameraRawDevelopState(page)).checksum;

/** Wait for a real develop and two consecutive identical frame/pixel snapshots. */
async function waitForDevelopFrame(page: Page, after = -1): Promise<CameraRawDevelopState> {
  let previous: CameraRawDevelopState | undefined;
  await expect.poll(async () => {
    const current = await cameraRawDevelopState(page);
    const stable = current.frame > after
      && previous?.frame === current.frame
      && previous.checksum === current.checksum;
    previous = current;
    return stable;
  }, { timeout: 15_000 }).toBe(true);
  if (!previous) throw new Error("Camera Raw develop did not produce a stable frame");
  return previous;
}

async function openWorkspace(page: Page) {
  await page.waitForFunction(
    () => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Camera Raw Filter…")),
    null, { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Camera Raw Filter…")).run());
  await expect(page.getByRole("dialog")).toBeVisible();
}

/** Click a dialog slider's track at `frac` of its width. `frac` must not land on
 *  the control's default, or the recipe (and so the preview) would not change. */
async function clickSlider(page: Page, name: string, frac: number) {
  const slider = page.getByRole("dialog").getByRole("slider", { name, exact: true });
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  if (!box) throw new Error(`${name} slider not found`);
  await page.mouse.click(box.x + box.width * frac, box.y + box.height / 2);
}

/** Push the dialog's Exposure slider near its maximum with one track click. */
async function dragExposure(page: Page) {
  await clickSlider(page, "Exposure", 0.92);
}

test("adj.cameraRawDevelop bakes exactly one history step that one undo restores", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const before = await composite(page);
  const camRawSteps = () => page.evaluate(() =>
    (Array.from((window as any).__mv.engine.engine.history_labels()) as string[]).filter((l) => l === "Camera Raw").length);
  const steps0 = await camRawSteps();
  await page.evaluate((len) => {
    const p = new Float32Array(len);
    p[0] = 1; p[1] = 1; p[4] = 0.6; // version, proxyScale, exposure +0.6 EV
    (window as any).__mv.adj.cameraRawDevelop(p);
  }, DEVELOP_LEN);
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);
  expect(await camRawSteps()).toBe(steps0 + 1); // exactly one step added

  await page.evaluate(() => (window as any).__mv.store.undo());
  const restored = await composite(page);
  expect(restored.chk).toBe(before.chk); // one undo → byte-identical
});

test("on a smart object, develop appends fid-17 then updates it in place", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const r = await page.evaluate((len) => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    const id = mv.store.state.activeLayerId;
    E.convert_to_smart_object(id);
    mv.engine.commit();
    const count0 = E.smart_filter_count(id);
    const p = new Float32Array(len); p[0] = 1; p[1] = 1; p[4] = 0.6;
    mv.adj.cameraRawDevelop(p); // append
    const count1 = E.smart_filter_count(id);
    // Locate the fid-17 entry by its distinctive 1050-length params.
    let idx = -1;
    for (let i = 0; i < E.smart_filter_count(id); i++) if (E.smart_filter_params(id, i).length === len) { idx = i; break; }
    const p2 = new Float32Array(len); p2[0] = 1; p2[1] = 1; p2[4] = -0.6;
    mv.adj.cameraRawDevelop(p2, idx); // update in place
    return { count0, count1, count2: E.smart_filter_count(id), idx, exposure: E.smart_filter_params(id, idx)[4] };
  }, DEVELOP_LEN);
  expect(r.count1).toBe(r.count0 + 1); // appended
  expect(r.idx).toBeGreaterThanOrEqual(0);
  expect(r.count2).toBe(r.count1); // updated in place — no new entry
  expect(r.exposure).toBeCloseTo(-0.6, 3); // params replaced
});

test("the workspace opens, a Basic slider changes the preview, and Cancel is byte-identical", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const docBefore = await composite(page);
  await openWorkspace(page);
  await expect(page.getByRole("dialog").getByText("Basic")).toBeVisible();
  await waitForDevelopFrame(page);
  const c0 = await canvasChk(page);
  await dragExposure(page);
  await expect.poll(() => canvasChk(page), { timeout: 5000 }).not.toBe(c0); // preview changed

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const docAfter = await composite(page);
  expect(docAfter.chk).toBe(docBefore.chk); // the live document was never touched
});

test("a dialog requested behind RAW cannot overwrite and orphan the staged session", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const staged = await page.evaluate((payload) => {
    const mv = (window as any).__mv;
    const sessionId = mv.store.openRaw(new Uint8Array(payload), "queued-dialog.dng");
    (window as any).__mvQueuedDialogDisposition = "pending";
    void mv.store.waitForCameraRawSession(sessionId).then((disposition: string) => {
      (window as any).__mvQueuedDialogDisposition = disposition;
    });
    // Both requests are published in one browser task, before React can drain
    // the first one. The RAW transaction must still mount and retire cleanly.
    mv.store.requestDialog("new");
    return { sessionId, documentIds: mv.store.openDocIds() as number[] };
  }, Array.from(tinyLinearDng(31)));

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("New Document", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate((sessionId) => {
    const mv = (window as any).__mv;
    return {
      disposition: (window as any).__mvQueuedDialogDisposition,
      sessionExists: !!mv.store.cameraRawSession(sessionId),
      pendingDialog: mv.store.getSnapshot().pendingDialog,
    };
  }, staged.sessionId)).toEqual({ disposition: "cancelled", sessionExists: false, pendingDialog: null });
  expect(await page.evaluate(() => (window as any).__mv.store.openDocIds())).toEqual(staged.documentIds);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => { delete (window as any).__mvQueuedDialogDisposition; });
});

test("a RAW request remounts an already-open Camera Raw Filter with the new session", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await openWorkspace(page);
  await expect(page.getByRole("dialog").getByText("Camera Raw Filter", { exact: true })).toBeVisible();

  const sessionId = await page.evaluate((payload) => {
    const mv = (window as any).__mv;
    const id = mv.store.openRaw(new Uint8Array(payload), "replace-filter.dng");
    (window as any).__mvReplaceFilterDisposition = "pending";
    void mv.store.waitForCameraRawSession(id).then((disposition: string) => {
      (window as any).__mvReplaceFilterDisposition = disposition;
    });
    return id as string;
  }, Array.from(tinyLinearDng(32)));

  const rawDialog = await expectRawWorkspace(page);
  await expect(rawDialog.locator("[data-mv-cr-open-object]")).toBeVisible();
  await rawDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => page.evaluate((id) => ({
    disposition: (window as any).__mvReplaceFilterDisposition,
    sessionExists: !!(window as any).__mv.store.cameraRawSession(id),
  }), sessionId)).toEqual({ disposition: "cancelled", sessionExists: false });
  await expect(rawDialog).toHaveCount(0);
  await page.evaluate(() => { delete (window as any).__mvReplaceFilterDisposition; });
});

test("the Optics panel exposes Distortion and Defringe, and Optics params develop live", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);

  // Integration: an Optics distortion param (offset 1050) flows recipeToParams →
  // develop_buf and changes the live composite (proves the appended layout offset).
  const before = await composite(page);
  await page.evaluate(() => {
    const p = new Float32Array(1053);
    p[0] = 1; p[1] = 1; p[1050] = 0.6; // version, proxyScale, Optics distortion
    (window as any).__mv.adj.cameraRawDevelop(p);
  });
  expect((await composite(page)).chk).not.toBe(before.chk);

  // UI: the Optics section (collapsed by default) exposes the new controls.
  await openWorkspace(page);
  await page.getByRole("dialog").getByRole("button", { name: "Optics" }).click();
  await expect(page.getByRole("dialog").getByText("Distortion", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Purple Defringe", { exact: true })).toBeVisible();
});

test("Detail, Optics and Geometry sub-controls each re-develop the preview, and Cancel is byte-identical", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  // Bake film grain first: newScene's flat stripes carry no texture for Sharpen
  // Detail, Masking or the noise controls to act on.
  await page.evaluate((len) => {
    const p = new Float32Array(len);
    p[0] = 1; p[1] = 1; p[20] = 0.6; p[21] = 0.5; p[22] = 0.5; // version, proxyScale, grain
    (window as any).__mv.adj.cameraRawDevelop(p);
  }, DEVELOP_LEN);
  const docBefore = await composite(page);
  await openWorkspace(page);
  const dialog = page.getByRole("dialog");
  let last = await waitForDevelopFrame(page);
  /** One edit must land a new develop frame and, unless it only prepares the
   *  next step, change the preview's pixels. */
  const redevelop = async (label: string, act: () => Promise<void>, prepareOnly = false) => {
    await act();
    const next = await waitForDevelopFrame(page, last.frame);
    if (!prepareOnly) expect(next.checksum, `${label} re-develops the preview`).not.toBe(last.checksum);
    last = next;
  };
  // 0.85 of every track is off each control's default (Scale 135%, Detail 85…).
  const slider = (name: string) => () => clickSlider(page, name, 0.85);
  // Range thumbs are driven by keyboard: role=slider "Minimum"/"Maximum" in the group.
  const press = (group: string, thumb: "Minimum" | "Maximum", key: string) => async () => {
    await dialog.getByRole("group", { name: group }).getByRole("slider", { name: thumb }).focus();
    await page.keyboard.press(key);
  };

  await dialog.getByRole("button", { name: "Detail", exact: true }).click();
  for (const name of ["Sharpening", "Sharpen Detail", "Masking", "Noise Reduction", "Luminance Contrast",
    "Color Noise", "Color Detail", "Color Smoothness"]) {
    await redevelop(name, slider(name));
  }

  await dialog.getByRole("button", { name: "Optics", exact: true }).click();
  await redevelop("Vignetting", slider("Vignetting"));
  await redevelop("Purple Defringe", slider("Purple Defringe"));
  // +10 on the lower bound drops the pure-blue stripe (hue 240°) out of the window.
  await redevelop("Purple Hue", press("Purple Hue", "Minimum", "PageUp"));
  // Widen Green Hue to the whole arc (invisible until Green Defringe is on)…
  await redevelop("Green Hue widen", press("Green Hue", "Minimum", "Home"), true);
  await redevelop("Green Hue widen", press("Green Hue", "Maximum", "End"), true);
  await redevelop("Green Defringe", slider("Green Defringe"));
  // …then narrow it past every green stripe.
  await redevelop("Green Hue", press("Green Hue", "Minimum", "End"));

  await dialog.getByRole("button", { name: "Geometry", exact: true }).click();
  for (const name of ["Aspect", "Scale", "X Offset", "Y Offset"]) await redevelop(name, slider(name));

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect((await composite(page)).chk).toBe(docBefore.chk); // the live document was never touched
});

test("Upright modes straighten a tilted Smart Object and persist on reopen", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  // Tilt the scene 6° (Rotate 0.4 × 15°), then make it a Smart Object.
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    const p = new Float32Array(1086);
    p[0] = 1; p[1] = 1; p[1085] = 0.4;
    mv.adj.cameraRawDevelop(p);
    mv.engine.engine.convert_to_smart_object(mv.store.state.activeLayerId);
    mv.engine.commit();
  });
  await openWorkspace(page);
  const dialog = page.getByRole("dialog");
  const upright = dialog.getByRole("radiogroup", { name: "Upright" });
  const rotate = dialog.getByRole("slider", { name: "Rotate", exact: true });
  const scale = dialog.getByRole("slider", { name: "Scale", exact: true });
  await dialog.getByRole("button", { name: "Geometry", exact: true }).click();
  let last = await waitForDevelopFrame(page);

  await upright.getByRole("radio", { name: "Level" }).click();
  await expect(rotate).not.toHaveAttribute("aria-valuenow", "0");
  let next = await waitForDevelopFrame(page, last.frame);
  expect(next.checksum).not.toBe(last.checksum);

  await clickSlider(page, "Scale", 0.85);
  await expect(scale).not.toHaveAttribute("aria-valuenow", "100");
  const scaleValue = await scale.getAttribute("aria-valuenow");
  await waitForDevelopFrame(page, next.frame);
  await page.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toHaveCount(0);

  // Reopen: fid 17's v5 tail brings the Upright mode and Scale back.
  await openWorkspace(page);
  await dialog.getByRole("button", { name: "Geometry", exact: true }).click();
  await expect(upright.getByRole("radio", { name: "Level" })).toHaveAttribute("aria-checked", "true");
  await expect(scale).toHaveAttribute("aria-valuenow", scaleValue!);
  last = await waitForDevelopFrame(page);

  await upright.getByRole("radio", { name: "Off" }).click();
  await expect(rotate).toHaveAttribute("aria-valuenow", "0");
  next = await waitForDevelopFrame(page, last.frame);
  expect(next.checksum).not.toBe(last.checksum);

  // Guided: one guide dragged along a leaning line straightens the image.
  await upright.getByRole("radio", { name: "Guided" }).click();
  last = await waitForDevelopFrame(page, next.frame);
  const canvas = await page.locator("[data-mv-cr-canvas]").boundingBox();
  if (!canvas) throw new Error("preview canvas not found");
  await page.mouse.move(canvas.x + canvas.width * 0.55, canvas.y + canvas.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.9, { steps: 4 });
  await page.mouse.up();
  await expect(rotate).not.toHaveAttribute("aria-valuenow", "0");
  await waitForDevelopFrame(page, last.frame);

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("Upright on an image with no straight lines says so and changes nothing", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(96, 64, "flat");
    const E = mv.engine.e;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
  });
  await openWorkspace(page);
  const dialog = page.getByRole("dialog");
  const upright = dialog.getByRole("radiogroup", { name: "Upright" });
  await dialog.getByRole("button", { name: "Geometry", exact: true }).click();
  const settled = await waitForDevelopFrame(page);

  await upright.getByRole("radio", { name: "Auto" }).click();
  await expect(dialog.locator("[data-mv-cr-upright-status]")).toHaveText("Upright found no straight lines to correct.");
  await expect(upright.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
  expect((await cameraRawDevelopState(page)).frame).toBe(settled.frame); // no re-develop
});

test("a valid RAW stages off-document and Cancel retires it without adding a document", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await page.evaluate(() => (window as any).__mv.store.clearRecentFiles());
  const staged = await stageRaw(page, tinyLinearDng(1), "cancel-source.dng");
  const dialog = await expectRawWorkspace(page);

  expect(await page.evaluate(() => (window as any).__mv.store.openDocIds())).toEqual(staged.documentIds);
  expect(await page.evaluate((sessionId) => {
    const source = (window as any).__mv.store.cameraRawSession(sessionId)?.session.source;
    return source ? { name: source.originalName, byteLength: source.originalBytes.length } : null;
  }, staged.sessionId)).toEqual({ name: "cancel-source.dng", byteLength: tinyLinearDng(1).length });
  // The App drained the request, so retiring the session cannot reopen it.
  expect(await page.evaluate(() => (window as any).__mv.store.getSnapshot().pendingDialog)).toBeNull();

  const completion = waitForDisposition(page, staged.sessionId);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await completion).toBe("cancelled");
  expect(await page.evaluate(() => (window as any).__mv.store.openDocIds())).toEqual(staged.documentIds);
  expect(await page.evaluate((sessionId) => (window as any).__mv.store.cameraRawSession(sessionId), staged.sessionId)).toBeNull();
  expect(await page.evaluate(() => (window as any).__mv.store.getSnapshot().recentFiles)).toEqual([]);
});

test("Super Resolution is unavailable at the size limit and cannot persist a false success", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const staged = await stageRaw(page, tinyLinearDng(17, 16_384, 1), "max-width.dng");
  const dialog = await expectRawWorkspace(page);
  await dialog.getByRole("button", { name: "Enhance" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Super Resolution (2×)" })).toBeDisabled();
  await expect(dialog.getByText("Unavailable at this document size.")).toBeVisible();

  const rejected = await page.evaluate((sessionId) => {
    const store = (window as any).__mv.store;
    const runtime = store.cameraRawWorkspaceSession(sessionId);
    const recipe = structuredClone(runtime.source.recipe);
    recipe.enhance = {
      denoise: false,
      denoiseAmount: 0,
      rawDetails: false,
      ...recipe.enhance,
      superResolution: true,
    };
    return {
      result: store.completeCameraRawOpen(sessionId, recipe, false),
      width: runtime.engine.width(),
      height: runtime.engine.height(),
      retained: !!store.cameraRawSession(sessionId),
      persisted: runtime.source.recipe.enhance?.superResolution ?? false,
    };
  }, staged.sessionId);
  expect(rejected).toEqual({ result: null, width: 16_384, height: 1, retained: true, persisted: false });

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("Done saves RAW settings but leaves the staged source off-document", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await page.evaluate(() => (window as any).__mv.store.clearRecentFiles());
  const staged = await stageRaw(page, tinyLinearDng(2), "done-source.dng");
  const dialog = await expectRawWorkspace(page);
  expect(await page.evaluate(() => (window as any).__mv.store.openDocIds())).toEqual(staged.documentIds);

  const downloadPromise = page.waitForEvent("download");
  await dialog.locator("[data-mv-cr-done]").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("done-source.xmp");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__mv.store.openDocIds())).toEqual(staged.documentIds);
  expect(await page.evaluate((sessionId) => (window as any).__mv.store.cameraRawSession(sessionId), staged.sessionId)).toBeNull();
  expect(await page.evaluate(() => (window as any).__mv.store.getSnapshot().recentFiles)).toEqual([]);
});

test("a failed Done sidecar save stays visible and retryable", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const staged = await stageRaw(page, tinyLinearDng(13), "done-failure.dng");
  const dialog = await expectRawWorkspace(page);
  await page.evaluate(() => {
    (window as any).__mvCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = () => { throw new Error("forced sidecar failure"); };
  });

  await dialog.locator("[data-mv-cr-done]").click();
  await expect(dialog.getByRole("alert")).toHaveText("Could not finish. Retry or Cancel.");
  expect(await page.evaluate((sessionId) =>
    !!(window as any).__mv.store.cameraRawSession(sessionId), staged.sessionId)).toBe(true);

  await page.evaluate(() => {
    URL.createObjectURL = (window as any).__mvCreateObjectURL;
    delete (window as any).__mvCreateObjectURL;
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("Demosaic re-decodes the staged RAW and persists; Depth 32 opens a float document on the 32 Bits scale", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  // Coloured edges over a bright grey whose red the camera matrix lifts above
  // white while the sensor stays below its white level.
  const bytes = tinyCfaDng(48, 48, (x, y) => (
    x + y > 70 ? [0.03, 0.03, 0.03]
      : x >= 8 && x < 16 ? [0.5, 0.05, 0.05]
        : y >= 26 && y < 32 ? [0.05, 0.1, 0.5]
          : [0.95, 0.95, 0.95]
  ));
  const staged = await stageRaw(page, bytes, "edges.dng");
  const dialog = await expectRawWorkspace(page);
  const demosaic = dialog.getByRole("combobox", { name: "Demosaic" });
  await expect(demosaic).toContainText("Adaptive");
  const adaptive = await waitForDevelopFrame(page);

  await demosaic.click();
  await page.getByRole("option", { name: "Bilinear (fast)" }).click();
  const bilinear = await waitForDevelopFrame(page, adaptive.frame);
  expect(bilinear.checksum).not.toBe(adaptive.checksum); // the preview re-decoded
  expect(await page.evaluate((id) => {
    const mv = (window as any).__mv;
    return {
      preference: mv.store.state.filePrefs.rawDemosaic,
      stored: JSON.parse(localStorage.getItem("mv.filePrefs") ?? "{}").rawDemosaic,
      source: mv.store.cameraRawSession(id)?.session.source?.demosaic,
    };
  }, staged.sessionId)).toEqual({ preference: "bilinear", stored: "bilinear", source: "bilinear" });

  await dialog.getByRole("combobox", { name: "Open Depth" }).click();
  await page.getByRole("option", { name: "32 Bits/Channel (float)" }).click();
  const completion = waitForDisposition(page, staged.sessionId);
  await dialog.locator("[data-mv-cr-open]").click();
  expect(await completion).toBe("open");
  const composite16 = () => page.evaluate(() => Array.from((window as any).__mv.engine.engine.export_composite_rgba16() as Uint16Array));
  expect(await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return { depth: E.doc_depth(), hdr: E.has_hdr_samples(), headroom: E.has_raw_headroom() };
  })).toEqual({ depth: 32, hdr: true, headroom: false });
  const opened32 = await composite16();

  // The next RAW decodes with the remembered demosaic; opened at 16 bits it
  // looks exactly like the 32-bit document (Mode ▸ 32 Bits' scale).
  const next = await stageRaw(page, bytes, "next.dng");
  const nextDialog = await expectRawWorkspace(page);
  await expect(nextDialog.getByRole("combobox", { name: "Demosaic" })).toContainText("Bilinear");
  expect(await page.evaluate((id) => (window as any).__mv.store.cameraRawSession(id)?.session.source?.demosaic, next.sessionId))
    .toBe("bilinear");
  await nextDialog.getByRole("combobox", { name: "Open Depth" }).click();
  await page.getByRole("option", { name: "16 Bits/Channel", exact: true }).click();
  const nextCompletion = waitForDisposition(page, next.sessionId);
  await nextDialog.locator("[data-mv-cr-open]").click();
  expect(await nextCompletion).toBe("open");
  expect(await page.evaluate(() => (window as any).__mv.engine.engine.doc_depth())).toBe(16);
  expect(await composite16()).toEqual(opened32);
});

test("Open creates exactly one source-backed pixel document without changing the RAW bytes", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await page.evaluate(() => (window as any).__mv.store.clearRecentFiles());
  const bytes = tinyLinearDng(3);
  const staged = await stageRaw(page, bytes, "retained-source.dng");
  const dialog = await expectRawWorkspace(page);
  expect(await page.evaluate(() => (window as any).__mv.store.openDocIds())).toEqual(staged.documentIds);

  const completion = waitForDisposition(page, staged.sessionId);
  await dialog.locator("[data-mv-cr-open]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await completion).toBe("open");
  const accepted = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const docIds = mv.store.openDocIds() as number[];
    const docId = mv.store.state.activeDocId as number;
    const layerId = mv.store.state.activeLayerId as number;
    const source = mv.store.cameraRawSourceForDoc(docId);
    const recentFiles = mv.store.getSnapshot().recentFiles;
    if (!source) return { docIds, docId, layerId, source: null, recentFiles };
    const digest = await crypto.subtle.digest("SHA-256", source.originalBytes.slice().buffer);
    const retainedSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return {
      docIds, docId, layerId, recentFiles,
      source: {
        name: source.originalName,
        path: source.originalPath,
        sha256: source.sha256,
        retainedSha256,
        byteLength: source.originalBytes.length,
        dirty: mv.store.docDirty(docId),
        layerKind: mv.store.layerKindInDoc(docId, layerId),
      },
    };
  });
  expect(accepted.docIds.filter((id) => !staged.documentIds.includes(id))).toEqual([accepted.docId]);
  // The entry also carries openedAt and a thumbnail since Home (#476); what
  // this test is about is that the RAW is recorded once, under its own name.
  expect(accepted.recentFiles).toHaveLength(1);
  expect(accepted.recentFiles[0]).toMatchObject({ name: "retained-source.dng", path: "/hostile/retained-source.dng" });
  expect(accepted.source).toEqual({
    name: "retained-source.dng",
    path: "/hostile/retained-source.dng",
    sha256: staged.sha256,
    retainedSha256: staged.sha256,
    byteLength: bytes.length,
    dirty: true,
    layerKind: 0,
  });
  const guardedClose = await page.evaluate(async (docId) => {
    const mv = (window as any).__mv;
    const originalConfirm = window.confirm;
    const prompts: string[] = [];
    window.confirm = (message?: string) => { prompts.push(String(message ?? "")); return false; };
    try {
      const closed = await mv.closeDocumentTab(docId);
      return { closed, prompts, stillOpen: (mv.store.openDocIds() as number[]).includes(docId) };
    } finally {
      window.confirm = originalConfirm;
    }
  }, accepted.docId);
  expect(guardedClose).toMatchObject({ closed: false, stillOpen: true });
  expect(guardedClose.prompts[0]).toContain("Save changes");
  expect(guardedClose.prompts[1]).toContain("Close without saving?");
});

test("multiple RAW opens stay serialized and reject out-of-order acceptance", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const first = await stageRaw(page, tinyLinearDng(4), "queue-first.dng");
  const second = await stageRaw(page, tinyLinearDng(5), "queue-second.dng");
  const dialog = await expectRawWorkspace(page);
  expect(second.documentIds).toEqual(first.documentIds);

  // Session two exists, but it is not the pinned active transaction yet.
  const refused = await page.evaluate((sessionId) => {
    const mv = (window as any).__mv;
    const session = mv.store.cameraRawSession(sessionId)?.session;
    return session?.source ? mv.store.completeCameraRawOpen(sessionId, session.source.recipe, true) : -1;
  }, second.sessionId);
  expect(refused).toBeNull();
  expect(await page.evaluate(() => (window as any).__mv.store.openDocIds())).toEqual(first.documentIds);

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => page.evaluate(({ firstId, secondId }) => ({
    first: !!(window as any).__mv.store.cameraRawSession(firstId),
    second: !!(window as any).__mv.store.cameraRawSession(secondId),
  }), { firstId: first.sessionId, secondId: second.sessionId })).toEqual({ first: false, second: true });
  const secondDialog = await expectRawWorkspace(page);
  await secondDialog.locator("[data-mv-cr-open-object]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const result = await page.evaluate(async ({ firstId, secondId }) => {
    const mv = (window as any).__mv;
    const docIds = mv.store.openDocIds() as number[];
    const docId = mv.store.state.activeDocId as number;
    const source = mv.store.cameraRawSourceForDoc(docId);
    const digest = source ? await crypto.subtle.digest("SHA-256", source.originalBytes.slice().buffer) : null;
    const retainedSha256 = digest
      ? Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
      : null;
    return {
      docIds, docId, name: source?.originalName, sha256: source?.sha256, retainedSha256,
      kind: mv.store.layerKindInDoc(docId, mv.store.state.activeLayerId),
      firstSession: mv.store.cameraRawSession(firstId), secondSession: mv.store.cameraRawSession(secondId),
    };
  }, { firstId: first.sessionId, secondId: second.sessionId });
  expect(result.docIds.filter((id) => !first.documentIds.includes(id))).toEqual([result.docId]);
  expect(result.name).toBe("queue-second.dng");
  expect(result.sha256).toBe(second.sha256);
  expect(result.retainedSha256).toBe(second.sha256);
  expect(result.kind).toBe(7);
  expect(result.firstSession).toBeNull();
  expect(result.secondSession).toBeNull();
});

test("Camera Raw staging rejects beyond the pending-session cap and releases capacity on Cancel", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  // Stage up to the filmstrip cap (MAX_CAMERA_RAW_PENDING_SESSIONS = 8); each
  // one coexists so the workspace shows a filmstrip of all pending sources.
  const staged = [];
  for (let i = 0; i < 8; i++) {
    staged.push(await stageRaw(page, tinyLinearDng(30 + i), `bounded-${i}.dng`));
  }
  expect(staged).toHaveLength(8);
  // One more exceeds the cap and is rejected with a helpful message.
  const rejection = await page.evaluate((payload) => {
    try {
      (window as any).__mv.store.openRaw(new Uint8Array(payload), "bounded-overflow.dng");
      return "accepted";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, Array.from(tinyLinearDng(99)));
  expect(rejection).toContain("Finish a pending Camera Raw workspace");

  // The workspace lists every staged source in its filmstrip…
  const dialog = await expectRawWorkspace(page);
  await expect(dialog.locator("[data-mv-cr-filmstrip-item]")).toHaveCount(8);
  // …each rendering a real proxy thumbnail (proxy → copy → dataURL pipeline).
  await expect.poll(async () => dialog.locator('[data-mv-cr-filmstrip-item] img[src^="data:image/png"]').count(), { timeout: 6000 }).toBeGreaterThan(0);
  // …and cancelling the active session releases capacity for a new stage.
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await stageRaw(page, tinyLinearDng(120), "bounded-after-release.dng");
  const afterRelease = await expectRawWorkspace(page);
  await afterRelease.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("browser RAW size preflight rejects before allocating the file body", async ({ page }) => {
  await gotoApp(page);
  const result = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    let readCalled = false;
    let alertMessage = "";
    const originalAlert = window.alert;
    window.alert = (message?: unknown) => { alertMessage = String(message ?? ""); };
    try {
      await mv.openImageFile({
        name: "oversized.dng",
        size: 256 * 1024 * 1024 + 1,
        lastModified: 1,
        arrayBuffer: async () => { readCalled = true; return new ArrayBuffer(0); },
      });
      return { readCalled, alertMessage };
    } finally {
      window.alert = originalAlert;
    }
  });
  expect(result.readCalled).toBe(false);
  expect(result.alertMessage).toContain("256 MiB size limit");
});

test("replacing Camera Raw cancels its staged session and advances the queued RAW", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const first = await stageRaw(page, tinyLinearDng(21), "replace-first.dng");
  const second = await stageRaw(page, tinyLinearDng(22), "replace-second.dng");
  const firstCompletion = waitForDisposition(page, first.sessionId);
  const secondCompletion = waitForDisposition(page, second.sessionId);

  const firstDialog = await expectRawWorkspace(page);
  await firstDialog.getByRole("button", { name: "Cancel", exact: true }).focus();
  const shortcutHandled = await page.evaluate(() => {
    const target = document.activeElement ?? window;
    const event = new KeyboardEvent("keydown", {
      key: "n", code: "KeyN", ctrlKey: true, bubbles: true, cancelable: true,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(shortcutHandled).toBe(true);

  expect(await firstCompletion).toBe("cancelled");
  await expect.poll(() => page.evaluate(({ firstId, secondId }) => {
    const store = (window as any).__mv.store;
    return {
      first: !!store.cameraRawSession(firstId),
      second: store.cameraRawSession(secondId)?.session.source?.originalName ?? null,
    };
  }, { firstId: first.sessionId, secondId: second.sessionId })).toEqual({
    first: false,
    second: "replace-second.dng",
  });

  const secondDialog = await expectRawWorkspace(page);
  await secondDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await secondCompletion).toBe("cancelled");
  await expect(secondDialog).toHaveCount(0);
  expect(await page.evaluate(({ firstId, secondId }) => ({
    first: (window as any).__mv.store.cameraRawSession(firstId),
    second: (window as any).__mv.store.cameraRawSession(secondId),
  }), { firstId: first.sessionId, secondId: second.sessionId })).toEqual({ first: null, second: null });
});

test("failed RAW acceptance stays retryable or retires cleanly so the queue advances", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const first = await stageRaw(page, tinyLinearDng(10), "failed-first.dng");
  const second = await stageRaw(page, tinyLinearDng(11), "failed-second.dng");
  const dialog = await expectRawWorkspace(page);

  await page.evaluate(() => {
    const mv = (window as any).__mv;
    (window as any).__mvCompleteCameraRawOpen = mv.store.completeCameraRawOpen;
    mv.store.completeCameraRawOpen = () => null;
  });
  await dialog.locator("[data-mv-cr-open]").click();
  await expect(dialog.getByRole("alert")).toHaveText("Could not finish. Retry or Cancel.");
  expect(await page.evaluate(({ firstId, secondId }) => ({
    first: !!(window as any).__mv.store.cameraRawSession(firstId),
    second: !!(window as any).__mv.store.cameraRawSession(secondId),
  }), { firstId: first.sessionId, secondId: second.sessionId })).toEqual({ first: true, second: true });

  await page.evaluate(() => {
    (window as any).__mv.store.completeCameraRawOpen = () => { throw new Error("forced failure"); };
  });
  await dialog.locator("[data-mv-cr-open]").click();
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.completeCameraRawOpen = (window as any).__mvCompleteCameraRawOpen;
    delete (window as any).__mvCompleteCameraRawOpen;
  });

  const completion = waitForDisposition(page, first.sessionId);
  await page.evaluate((sessionId) => {
    const runtime = (window as any).__mv.store.cameraRawWorkspaceSession(sessionId);
    if (!runtime) throw new Error("Camera Raw runtime not found");
    runtime.engine.camera_raw_develop = () => { throw new Error("forced engine failure"); };
  }, first.sessionId);
  await dialog.locator("[data-mv-cr-open]").click();
  expect(await completion).toBe("cancelled");
  await expect.poll(() => page.evaluate(({ firstId, secondId }) => ({
    first: !!(window as any).__mv.store.cameraRawSession(firstId),
    second: !!(window as any).__mv.store.cameraRawSession(secondId),
  }), { firstId: first.sessionId, secondId: second.sessionId })).toEqual({ first: false, second: true });
  const secondDialog = await expectRawWorkspace(page);
  await secondDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(secondDialog).toHaveCount(0);
});

test("a late RAW adoption failure restores the previous document before the queue advances", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const liveText = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const id = mv.text.createAt(40, 60) as number;
    return {
      id,
      kind: mv.store.layerKindInDoc(mv.store.state.activeDocId, id) as number,
      editingId: mv.store.state.textEdit?.id as number | undefined,
    };
  });
  expect(liveText.editingId).toBe(liveText.id);
  const before = {
    ids: await page.evaluate(() => (window as any).__mv.store.openDocIds() as number[]),
    activeId: await page.evaluate(() => (window as any).__mv.store.state.activeDocId as number),
    composite: await composite(page),
  };
  const first = await stageRaw(page, tinyLinearDng(13), "rollback-first.dng");
  const second = await stageRaw(page, tinyLinearDng(14), "rollback-second.dng");
  const dialog = await expectRawWorkspace(page);
  const completion = waitForDisposition(page, first.sessionId);

  await page.evaluate(() => {
    const store = (window as any).__mv.store;
    (window as any).__mvNotifyVectorFontTargetsChanged = store.notifyVectorFontTargetsChanged;
    store.notifyVectorFontTargetsChanged = () => { throw new Error("forced late adoption failure"); };
  });
  await dialog.locator("[data-mv-cr-open-object]").click();
  expect(await completion).toBe("cancelled");

  await expect.poll(() => page.evaluate(({ firstId, secondId }) => ({
    first: !!(window as any).__mv.store.cameraRawSession(firstId),
    second: !!(window as any).__mv.store.cameraRawSession(secondId),
  }), { firstId: first.sessionId, secondId: second.sessionId })).toEqual({ first: false, second: true });
  const secondDialog = await expectRawWorkspace(page);
  const restored = await page.evaluate(({ activeId, textId }) => {
    const store = (window as any).__mv.store;
    return {
      ids: store.openDocIds() as number[],
      activeId: store.state.activeDocId as number,
      source: store.cameraRawSourceForDoc(activeId),
      textEdit: store.state.textEdit,
      textKind: store.layerKindInDoc(activeId, textId),
    };
  }, { activeId: before.activeId, textId: liveText.id });
  expect(restored).toEqual({
    ids: before.ids,
    activeId: before.activeId,
    source: null,
    textEdit: null,
    textKind: liveText.kind,
  });
  expect(await composite(page)).toEqual(before.composite);

  await page.evaluate(() => {
    const store = (window as any).__mv.store;
    store.notifyVectorFontTargetsChanged = (window as any).__mvNotifyVectorFontTargetsChanged;
    delete (window as any).__mvNotifyVectorFontTargetsChanged;
  });
  await secondDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(secondDialog).toHaveCount(0);
});

test("a preflight finalization failure leaves the prior document coherent and cancels adoption", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const before = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setPaintSymmetry(1);
    mv.store.beginPaintSymmetryTransform();
    const x = mv.store.state.paintSymmetryAxisX + 7;
    const y = mv.store.state.paintSymmetryAxisY + 3;
    mv.store.movePaintSymmetryPath(x, y, 15, 1.25);
    return {
      ids: mv.store.openDocIds() as number[],
      activeId: mv.store.state.activeDocId as number,
      x,
      y,
    };
  });
  const first = await stageRaw(page, tinyLinearDng(15), "preflight-first.dng");
  const second = await stageRaw(page, tinyLinearDng(16), "preflight-second.dng");
  const dialog = await expectRawWorkspace(page);
  const completion = waitForDisposition(page, first.sessionId);

  await page.evaluate(() => {
    const client = (window as any).__mv.engine;
    (window as any).__mvEngineSync = client.sync;
    client.sync = () => { throw new Error("forced preflight sync failure"); };
  });
  await dialog.locator("[data-mv-cr-open-object]").click();
  expect(await completion).toBe("cancelled");
  await expect.poll(() => page.evaluate(({ firstId, secondId }) => ({
    first: !!(window as any).__mv.store.cameraRawSession(firstId),
    second: !!(window as any).__mv.store.cameraRawSession(secondId),
  }), { firstId: first.sessionId, secondId: second.sessionId })).toEqual({ first: false, second: true });
  const secondDialog = await expectRawWorkspace(page);

  const restored = await page.evaluate(({ activeId }) => {
    const mv = (window as any).__mv;
    mv.engine.sync = (window as any).__mvEngineSync;
    delete (window as any).__mvEngineSync;
    mv.engine.sync();
    return {
      ids: mv.store.openDocIds() as number[],
      activeId: mv.store.state.activeDocId as number,
      source: mv.store.cameraRawSourceForDoc(activeId),
      transforming: mv.store.state.paintSymmetryTransforming as boolean,
      x: mv.store.state.paintSymmetryAxisX as number,
      y: mv.store.state.paintSymmetryAxisY as number,
      engineX: mv.engine.engine.paint_symmetry_axis_x() as number,
      engineY: mv.engine.engine.paint_symmetry_axis_y() as number,
      dirty: mv.store.docDirty(activeId) as boolean,
    };
  }, { activeId: before.activeId });
  expect(restored).toMatchObject({
    ids: before.ids,
    activeId: before.activeId,
    source: null,
    transforming: false,
    dirty: true,
  });
  expect(restored.x).toBeCloseTo(before.x, 3);
  expect(restored.y).toBeCloseTo(before.y, 3);
  expect(restored.engineX).toBeCloseTo(before.x, 3);
  expect(restored.engineY).toBeCloseTo(before.y, 3);

  await secondDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(secondDialog).toHaveCount(0);
});

test("Open as Smart Object cannot be downgraded to a regular RAW Open", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const staged = await stageRaw(page, tinyLinearDng(12), "forced-smart.dng", { invocation: "open-as-smart-object" });
  const dialog = await expectRawWorkspace(page);
  await expect(dialog.locator("[data-mv-cr-open]")).toHaveCount(0);

  const completion = waitForDisposition(page, staged.sessionId);
  const accepted = await page.evaluate((sessionId) => {
    const mv = (window as any).__mv;
    const session = mv.store.cameraRawSession(sessionId)?.session;
    const documentId = session?.source
      ? mv.store.completeCameraRawOpen(sessionId, session.source.recipe, false)
      : null;
    return {
      documentId,
      layerKind: documentId === null ? null : mv.store.layerKindInDoc(documentId, mv.store.state.activeLayerId),
    };
  }, staged.sessionId);
  expect(await completion).toBe("open-as-smart-object");
  expect(accepted.documentId).not.toBeNull();
  expect(accepted.layerKind).toBe(7);
});

test("workspace edit limits refuse overflow without evicting edits or blocking Open Object", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const staged = await stageRaw(page, tinyLinearDng(15), "edit-limits.dng", { seedEditLimits: true });
  const dialog = await expectRawWorkspace(page);
  const alert = dialog.locator("[data-mv-cr-edit-limit]");

  await dialog.getByRole("button", { name: "Tone Curve", exact: true }).click();
  const curveCount = dialog.locator("[data-mv-cr-curve-count]");
  const curve = dialog.locator('[aria-label="Tone curve"]');
  await expect(curveCount).toHaveText("128/128 points");
  await expect(curve.locator("circle")).toHaveCount(128);
  await curve.scrollIntoViewIfNeeded();
  const curveBox = await curve.boundingBox();
  if (!curveBox) throw new Error("Tone curve editor was not measurable");
  await page.mouse.click(curveBox.x + curveBox.width / 2, curveBox.y + curveBox.height * 0.1);
  await expect(alert).toContainText("up to 128 tone-curve points per channel");
  await expect(curveCount).toHaveText("128/128 points");
  await expect(curve.locator("circle")).toHaveCount(128);

  await dialog.getByRole("button", { name: "Healing", exact: true }).click();
  const healCount = dialog.locator("[data-mv-cr-heal-count]");
  await expect(healCount).toHaveText("64/64 spots");
  await dialog.locator("[data-mv-cr-heal-tool]").click();
  await expect(alert).toContainText("up to 64 healing spots");
  await expect(healCount).toHaveText("64/64 spots");
  await expect(dialog.getByText("Spot 1", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Spot 64", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Masking", exact: true }).click();
  const maskCount = dialog.locator("[data-mv-cr-mask-count]");
  await expect(maskCount).toHaveText("31/32 masks · 4096/4096 points");
  await expect(dialog.getByText("64 color samples", { exact: true })).toBeVisible();
  await dialog.locator("[data-mv-cr-color-sample]").click();
  await expect(alert).toContainText("up to 64 color samples per mask");
  await expect(dialog.getByText("64 color samples", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Linear", exact: true }).click();
  await expect(alert).toContainText("up to 4096 mask points");
  await expect(maskCount).toHaveText("31/32 masks · 4096/4096 points");

  await dialog.getByRole("button", { name: "Brush", exact: true }).click();
  await expect(maskCount).toHaveText("32/32 masks · 4096/4096 points");
  const maskCanvas = dialog.locator("[data-mv-cr-canvas]");
  const maskCanvasBox = await maskCanvas.boundingBox();
  if (!maskCanvasBox) throw new Error("Camera Raw preview was not measurable");
  await maskCanvas.dispatchEvent("pointerdown", {
    clientX: maskCanvasBox.x + 2, clientY: maskCanvasBox.y + 2, pointerId: 1, pressure: 1, buttons: 1,
  });
  await maskCanvas.dispatchEvent("pointerup", {
    clientX: maskCanvasBox.x + 2, clientY: maskCanvasBox.y + 2, pointerId: 1, pressure: 0, buttons: 0,
  });
  await expect(alert).toContainText("up to 4096 mask points");
  await expect(maskCount).toHaveText("32/32 masks · 4096/4096 points");
  await dialog.getByRole("button", { name: "Brush", exact: true }).click();
  await expect(alert).toContainText("up to 32 masks");
  await expect(maskCount).toHaveText("32/32 masks · 4096/4096 points");

  const completion = waitForDisposition(page, staged.sessionId);
  await dialog.locator("[data-mv-cr-open-object]").click();
  expect(await completion).toBe("open-as-smart-object");
  await expect(dialog).toHaveCount(0);
});

test("Point Color samples a colour from the preview and its Luminance shift re-develops it", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await stageRaw(page, tinyLinearDng(31), "point-color.dng");
  const dialog = await expectRawWorkspace(page);

  await dialog.getByRole("button", { name: "Point Color", exact: true }).click();
  await expect(dialog.getByText("No point colours yet", { exact: false })).toBeVisible();

  // Activate the eyedropper and sample a pixel inside the tiny preview → one
  // socket appears. (The canvas backing store is a few px; click well inside it.)
  await dialog.locator("[data-mv-cr-point-color-tool]").click();
  await dialog.locator("[data-mv-cr-canvas]").click({ position: { x: 4, y: 3 } });
  await expect(dialog.locator("[data-mv-cr-point-color]")).toHaveCount(1);
  await expect(dialog.getByText("Colour 1", { exact: true })).toBeVisible();

  // Sampling alone is neutral (shifts start at 0), so the preview is unchanged.
  // Pushing this socket's Luminance up brightens the sampled colour and must
  // re-develop the preview (a linear-DNG backdrop is dark, so brighten is robust).
  const before = await canvasChk(page);
  const lum = dialog.locator("[data-mv-cr-point-color]").getByRole("slider", { name: "Luminance" });
  await lum.scrollIntoViewIfNeeded();
  const box = await lum.boundingBox();
  if (!box) throw new Error("Point Color Luminance slider not found");
  await page.mouse.click(box.x + box.width * 0.94, box.y + box.height / 2); // near maximum
  await expect.poll(() => canvasChk(page)).not.toBe(before);

  // Delete removes the socket.
  await dialog.locator("[data-mv-cr-point-color-delete]").click();
  await expect(dialog.locator("[data-mv-cr-point-color]")).toHaveCount(0);
});

test("Camera Raw Generative Expand commits a Smart Object and hands off to the Expand dialog", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const staged = await stageRaw(page, tinyLinearDng(33), "gen-expand.dng");
  const dialog = await expectRawWorkspace(page);

  await dialog.getByRole("button", { name: "Crop & Straighten", exact: true }).click();
  const completion = waitForDisposition(page, staged.sessionId);
  await dialog.locator("[data-mv-cr-generative-expand]").click();
  // The develop commits as a Smart Object (the CR workspace closes)…
  expect(await completion).toBe("open-as-smart-object");
  // …then the pending-dialog bridge immediately opens Neural Filters at the
  // Generative Expand section (that dialog is now the visible one).
  await expect(page.getByText("Neural Filters (AI)", { exact: false })).toBeVisible();
  await expect(page.getByText("outpaint the canvas from its surroundings", { exact: false })).toBeVisible();
});

test("Open Object preserves source, recipe, and fid-17 re-editability through a project round-trip", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const staged = await stageRaw(page, tinyLinearDng(6), "roundtrip-source.dng");
  const dialog = await expectRawWorkspace(page);
  await dragExposure(page);
  await dialog.locator("[data-mv-cr-open-object]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const roundTrip = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const originalDocId = mv.store.state.activeDocId as number;
    const originalSource = mv.store.cameraRawSourceForDoc(originalDocId);
    const saved = mv.store.saveProjectForDoc(originalDocId) as Uint8Array | null;
    if (!originalSource || !saved) throw new Error("Camera Raw project was not serializable");
    const idsBefore = mv.store.openDocIds() as number[];
    mv.store.openProject(saved, "camera-raw-roundtrip.mvision");
    const reopenedDocId = mv.store.state.activeDocId as number;
    const reopenedLayerId = mv.store.state.activeLayerId as number;
    const reopenedSource = mv.store.cameraRawSourceForDoc(reopenedDocId);
    if (!reopenedSource) throw new Error("Camera Raw source was not restored");
    const digest = await crypto.subtle.digest("SHA-256", reopenedSource.originalBytes.slice().buffer);
    const retainedSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const E = mv.engine.engine;
    let fid17Index = -1;
    for (let index = 0; index < E.smart_filter_count(reopenedLayerId); index++) {
      if (E.smart_filter_id(reopenedLayerId, index) === 17) { fid17Index = index; break; }
    }
    const filterExposure = fid17Index >= 0 ? E.smart_filter_params(reopenedLayerId, fid17Index)[4] : null;
    mv.store.requestCameraRawEdit();
    return {
      idsBefore, idsAfter: mv.store.openDocIds() as number[], reopenedDocId,
      name: reopenedSource.originalName, sha256: reopenedSource.sha256, retainedSha256,
      originalExposure: originalSource.recipe.basic.exposure,
      reopenedExposure: reopenedSource.recipe.basic.exposure,
      filterExposure,
      layerKind: mv.store.layerKindInDoc(reopenedDocId, reopenedLayerId),
      fid17Index,
    };
  });
  expect(roundTrip.idsAfter.filter((id) => !roundTrip.idsBefore.includes(id))).toEqual([roundTrip.reopenedDocId]);
  expect(roundTrip.name).toBe("roundtrip-source.dng");
  expect(roundTrip.sha256).toBe(staged.sha256);
  expect(roundTrip.retainedSha256).toBe(staged.sha256);
  expect(roundTrip.originalExposure).not.toBe(0);
  expect(roundTrip.reopenedExposure).toBe(roundTrip.originalExposure);
  expect(roundTrip.filterExposure).toBeCloseTo(roundTrip.reopenedExposure, 5);
  expect(roundTrip.layerKind).toBe(7);
  expect(roundTrip.fid17Index).toBeGreaterThanOrEqual(0);

  const reopenedDialog = await expectRawWorkspace(page);
  await expect(reopenedDialog.getByText("Profile & Calibration", { exact: true })).toBeVisible();
  await expect(reopenedDialog.getByText("Enhance", { exact: true })).toBeVisible();
  const exposure = reopenedDialog.getByRole("slider", { name: "Exposure" });
  await expect(exposure).toHaveAttribute("aria-valuenow", String(Math.round(roundTrip.reopenedExposure / 0.04)));
  await waitForDevelopFrame(page);
  const committedPreview = await canvasChk(page);
  const exposureBox = await exposure.boundingBox();
  if (!exposureBox) throw new Error("Reopened Exposure slider was not measurable");
  await page.mouse.click(exposureBox.x + exposureBox.width * 0.12, exposureBox.y + exposureBox.height / 2);
  await expect.poll(() => canvasChk(page), { timeout: 5000 }).not.toBe(committedPreview);
  const editedPreview = await canvasChk(page);
  const beforeButton = reopenedDialog.locator("[data-mv-cr-before]");
  await beforeButton.dispatchEvent("pointerdown");
  await expect.poll(() => canvasChk(page), { timeout: 5000 }).toBe(committedPreview);
  await beforeButton.dispatchEvent("pointerup");
  await expect.poll(() => canvasChk(page), { timeout: 5000 }).toBe(editedPreview);
  await reopenedDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(reopenedDialog).toHaveCount(0);
});

test("fid-17 history is authoritative for source metadata and the next saved project", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await stageRaw(page, tinyLinearDng(13), "history-source.dng");
  const opening = await expectRawWorkspace(page);
  await dragExposure(page);
  await opening.locator("[data-mv-cr-open-object]").click();
  await expect(opening).toHaveCount(0);

  const baseline = await page.evaluate(() => {
    const mv = (window as any).__mv;
    return mv.store.cameraRawSourceForDoc()?.recipe.basic.exposure as number;
  });
  await page.evaluate(() => (window as any).__mv.store.requestCameraRawEdit());
  const editing = await expectRawWorkspace(page);
  const slider = editing.getByRole("slider", { name: "Exposure" });
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  if (!box) throw new Error("Reopened Exposure slider was not measurable");
  await page.mouse.click(box.x + box.width * 0.12, box.y + box.height / 2);
  await editing.getByRole("button", { name: "OK", exact: true }).click();
  await expect(editing).toHaveCount(0);

  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const docId = mv.store.state.activeDocId as number;
    const read = (targetDocId = docId) => {
      const source = mv.store.cameraRawSourceForDoc(targetDocId);
      const E = mv.engine.engine;
      const layerId = mv.store.state.activeLayerId as number;
      let index = -1;
      for (let i = 0; i < E.smart_filter_count(layerId); i++) {
        if (E.smart_filter_id(layerId, i) === 17) { index = i; break; }
      }
      return {
        sourceExposure: source?.recipe.basic.exposure as number,
        filterExposure: index >= 0 ? E.smart_filter_params(layerId, index)[4] as number : NaN,
      };
    };
    const edited = read();
    mv.store.undo();
    const undone = read();
    mv.store.redo();
    const redone = read();
    mv.store.undo();
    const savedState = read();
    const saved = mv.store.saveProjectForDoc(docId) as Uint8Array | null;
    if (!saved) throw new Error("History-state project was not serializable");
    mv.store.openProject(saved, "history-state.mvision");
    const reopenedDocId = mv.store.state.activeDocId as number;
    const reopened = read(reopenedDocId);
    mv.store.requestCameraRawEdit();
    return { edited, undone, redone, savedState, reopened, reopenedDocId };
  });

  expect(result.edited.sourceExposure).not.toBeCloseTo(baseline, 5);
  expect(result.edited.filterExposure).toBeCloseTo(result.edited.sourceExposure, 5);
  expect(result.undone.sourceExposure).toBeCloseTo(baseline, 5);
  expect(result.undone.filterExposure).toBeCloseTo(baseline, 5);
  expect(result.redone.sourceExposure).toBeCloseTo(result.edited.sourceExposure, 5);
  expect(result.redone.filterExposure).toBeCloseTo(result.edited.filterExposure, 5);
  expect(result.savedState.sourceExposure).toBeCloseTo(result.undone.sourceExposure, 5);
  expect(result.reopened.sourceExposure).toBeCloseTo(result.savedState.sourceExposure, 5);
  expect(result.reopened.filterExposure).toBeCloseTo(result.savedState.filterExposure, 5);
  const reopened = await expectRawWorkspace(page);
  await expect(reopened.getByRole("slider", { name: "Exposure" }))
    .toHaveAttribute("aria-valuenow", String(Math.round(result.reopened.sourceExposure / 0.04)));
  await reopened.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("project reopen keeps RAW provenance on its declared fid-17 owner", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await stageRaw(page, tinyLinearDng(14), "owned-source.dng");
  const opening = await expectRawWorkspace(page);
  await dragExposure(page);
  await opening.locator("[data-mv-cr-open-object]").click();
  await expect(opening).toHaveCount(0);

  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    const docId = mv.store.state.activeDocId as number;
    const ownerId = mv.store.state.activeLayerId as number;
    let ownerIndex = -1;
    for (let i = 0; i < E.smart_filter_count(ownerId); i++) {
      if (E.smart_filter_id(ownerId, i) === 17) { ownerIndex = i; break; }
    }
    if (ownerIndex < 0) throw new Error("RAW owner has no fid-17 filter");
    const decoyId = E.add_layer("Unrelated Camera Raw Smart Object") as number;
    E.convert_to_smart_object(decoyId);
    const decoyParams = E.smart_filter_params(ownerId, ownerIndex) as Float32Array;
    decoyParams[4] = -0.75;
    E.smart_add_filter(decoyId, 17, decoyParams);
    const firstFid17 = () => {
      for (let layer = 0; layer < E.layer_count(); layer++) {
        const layerId = E.layer_id_at(layer);
        for (let filter = 0; filter < E.smart_filter_count(layerId); filter++) {
          if (E.smart_filter_id(layerId, filter) === 17) return layerId;
        }
      }
      return -1;
    };
    for (const position of [0, E.layer_count() - 1]) {
      if (firstFid17() !== ownerId) break;
      E.move_layer(decoyId, position);
    }
    mv.engine.commit();
    const scannedFirst = firstFid17();
    if (scannedFirst === ownerId) throw new Error("Could not place the decoy before the RAW owner");
    const saved = mv.store.saveProjectForDoc(docId) as Uint8Array | null;
    if (!saved) throw new Error("Owned RAW project was not serializable");
    const payload = JSON.parse(new TextDecoder().decode(saved)) as { document?: { cameraRawLayerId?: number } };
    mv.store.openProject(saved, "owned-source.mvision");
    const reopenedEngine = mv.engine.engine;
    let reopenedFirst = -1;
    for (let layer = 0; layer < reopenedEngine.layer_count() && reopenedFirst < 0; layer++) {
      const layerId = reopenedEngine.layer_id_at(layer);
      for (let filter = 0; filter < reopenedEngine.smart_filter_count(layerId); filter++) {
        if (reopenedEngine.smart_filter_id(layerId, filter) === 17) { reopenedFirst = layerId; break; }
      }
    }
    mv.store.requestCameraRawEdit();
    return {
      ownerId,
      decoyId,
      scannedFirst,
      persistedOwner: payload.document?.cameraRawLayerId,
      reopenedFirst,
      request: mv.store.getSnapshot().pendingDialog?.arg,
    };
  });

  expect(result.scannedFirst).toBe(result.decoyId);
  expect(result.persistedOwner).toBe(result.ownerId);
  expect(result.reopenedFirst).toBe(result.decoyId);
  expect(result.request).toMatchObject({ invocation: "reopen", targetLayerId: result.ownerId });
  const reopened = await expectRawWorkspace(page);
  await reopened.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("a RAW Smart Object duplicate keeps source provenance and RAW-only re-editing", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const staged = await stageRaw(page, tinyLinearDng(7), "duplicate-source.dng");
  const dialog = await expectRawWorkspace(page);
  await dragExposure(page);
  await dialog.locator("[data-mv-cr-open-object]").click();
  await expect(dialog).toHaveCount(0);

  const duplicated = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const originalDocId = mv.store.state.activeDocId as number;
    const originalSource = mv.store.cameraRawSourceForDoc(originalDocId);
    mv.store.duplicateDocument("RAW duplicate", false);
    const duplicateDocId = mv.store.state.activeDocId as number;
    const layerId = mv.store.state.activeLayerId as number;
    const source = mv.store.cameraRawSourceForDoc(duplicateDocId);
    mv.store.requestCameraRawEdit();
    return {
      originalExposure: originalSource?.recipe.basic.exposure,
      duplicateDocId,
      name: source?.originalName,
      sha256: source?.sha256,
      exposure: source?.recipe.basic.exposure,
      dirty: mv.store.docDirty(duplicateDocId),
      layerKind: mv.store.layerKindInDoc(duplicateDocId, layerId),
      request: mv.store.getSnapshot().pendingDialog?.arg,
    };
  });
  expect(duplicated.name).toBe("duplicate-source.dng");
  expect(duplicated.sha256).toBe(staged.sha256);
  expect(duplicated.exposure).toBe(duplicated.originalExposure);
  expect(duplicated.dirty).toBe(true);
  expect(duplicated.layerKind).toBe(7);
  expect(duplicated.request).toMatchObject({
    invocation: "reopen",
    targetDocumentId: duplicated.duplicateDocId,
  });
  const reopened = await expectRawWorkspace(page);
  await expect(reopened.getByText("Profile & Calibration", { exact: true })).toBeVisible();
  await reopened.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("replacing a RAW document with flattened pixels clears stale provenance", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await stageRaw(page, tinyLinearDng(8), "flattened-source.dng");
  const dialog = await expectRawWorkspace(page);
  await dialog.locator("[data-mv-cr-open-object]").click();
  await expect(dialog).toHaveCount(0);

  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const png = mv.engine.engine.export_png() as Uint8Array;
    const replacement = mv.engine.buildImage(png);
    mv.store.revertActiveDoc(replacement);
    const docId = mv.store.state.activeDocId as number;
    const layerId = mv.store.state.activeLayerId as number;
    mv.store.requestCameraRawEdit();
    return {
      source: mv.store.cameraRawSourceForDoc(docId),
      layerKind: mv.store.layerKindInDoc(docId, layerId),
      request: mv.store.getSnapshot().pendingDialog?.arg,
    };
  });
  expect(result.source).toBeNull();
  expect(result.layerKind).toBe(0);
  expect(result.request).toMatchObject({ invocation: "filter" });
  const filterDialog = page.getByRole("dialog");
  await expect(filterDialog.getByText("Camera Raw Filter", { exact: true })).toBeVisible();
  await expect(filterDialog.getByText("Profile & Calibration", { exact: true })).toBeVisible();
  await expect(filterDialog.getByText("Crop & Straighten", { exact: true })).toHaveCount(0);
  await filterDialog.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("nested Smart Object source tabs retain Camera Raw metadata after project reopen", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const staged = await stageRaw(page, tinyLinearDng(9), "nested-source.dng");
  const dialog = await expectRawWorkspace(page);
  await dragExposure(page);
  await dialog.locator("[data-mv-cr-open-object]").click();
  await expect(dialog).toHaveCount(0);

  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const rawDocId = mv.store.state.activeDocId as number;
    const sourceEngine = mv.store.docProjectBytes(rawDocId) as Uint8Array | null;
    const sourceDocument = mv.store.docDocumentMeta(rawDocId);
    if (!sourceEngine || !sourceDocument?.cameraRaw) throw new Error("RAW source tab was not serializable");

    mv.store.newDocument(16, 16, "nested-parent", "transparent");
    const parentDocId = mv.store.state.activeDocId as number;
    const parentLayerId = mv.store.state.activeLayerId as number;
    mv.smart.convert(parentLayerId);
    const saved = mv.store.saveProjectForDoc(parentDocId, [{
      parentLayerId,
      name: "nested RAW contents",
      engineBytes: sourceEngine,
      document: sourceDocument,
      dirty: true,
    }]) as Uint8Array | null;
    if (!saved) throw new Error("Parent project was not serializable");

    mv.store.openProject(saved, "nested-camera-raw.mvision");
    const reopenedParentId = mv.store.state.activeDocId as number;
    const sourceTab = (mv.store.state.documents as Array<{ id: number }>).find((candidate) =>
      mv.smart.editedContentsBindingForDoc(candidate.id)?.parentDocId === reopenedParentId);
    if (!sourceTab) throw new Error("Nested source tab was not restored");
    mv.store.activateDoc(sourceTab.id);
    const source = mv.store.cameraRawSourceForDoc(sourceTab.id);
    mv.store.requestCameraRawEdit();
    return {
      sourceTabId: sourceTab.id,
      name: source?.originalName,
      sha256: source?.sha256,
      exposure: source?.recipe.basic.exposure,
      request: mv.store.getSnapshot().pendingDialog?.arg,
    };
  });
  expect(result.name).toBe("nested-source.dng");
  expect(result.sha256).toBe(staged.sha256);
  expect(result.exposure).not.toBe(0);
  expect(result.request).toMatchObject({ invocation: "reopen", targetDocumentId: result.sourceTabId });
  const reopened = await expectRawWorkspace(page);
  await expect(reopened.getByText("Profile & Calibration", { exact: true })).toBeVisible();
  await reopened.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("the HSL / Color panel exposes the eight hue bands, and HSL params develop live", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);

  // Integration: desaturating every band (the saturation block at 1061..1069)
  // flows recipeToParams → develop_buf and changes the colourful live composite,
  // proving the appended HSL offsets line up with the Rust layout.
  const before = await composite(page);
  await page.evaluate(() => {
    const p = new Float32Array(1077);
    p[0] = 1; p[1] = 1;
    for (let i = 0; i < 8; i++) p[1061 + i] = -1; // saturation[band] = -1
    (window as any).__mv.adj.cameraRawDevelop(p);
  });
  expect((await composite(page)).chk).not.toBe(before.chk);

  // UI: the HSL / Color section (collapsed by default) exposes a band slider per
  // ACR hue band. Aqua/Purple/Magenta are unique to this panel (no collision with
  // the collapsed Tone Curve's RGB channel select).
  await openWorkspace(page);
  await page.getByRole("dialog").getByRole("button", { name: "HSL / Color" }).click();
  await expect(page.getByRole("dialog").getByText("Aqua", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Purple", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Magenta", { exact: true })).toBeVisible();
});

test("the Color Grading panel exposes three tonal wheels, and grading develops live", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);

  // Integration: saturating all three grading wheels (hue/sat pairs at 1077..1083)
  // flows recipeToParams → develop_buf and re-colours the live composite, proving
  // the appended Color Grading offsets line up with the Rust layout.
  const before = await composite(page);
  await page.evaluate(() => {
    const p = new Float32Array(1083);
    p[0] = 1; p[1] = 1;
    p[1077] = 210; p[1078] = 0.5; // Shadows: blue
    p[1079] = 40; p[1080] = 0.5; // Midtones: warm
    p[1081] = 90; p[1082] = 0.5; // Highlights: green
    (window as any).__mv.adj.cameraRawDevelop(p);
  });
  expect((await composite(page)).chk).not.toBe(before.chk);

  // UI: the Color Grading section (collapsed by default) exposes the three regions.
  await openWorkspace(page);
  await page.getByRole("dialog").getByRole("button", { name: "Color Grading" }).click();
  await expect(page.getByRole("dialog").getByText("midtones", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("highlights", { exact: true })).toBeVisible();
});

test("the Geometry panel exposes keystone/rotate, and geometry develops live", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);

  // Integration: a vertical keystone (param 1083) flows recipeToParams →
  // develop_buf and projectively resamples the live composite.
  const before = await composite(page);
  await page.evaluate(() => {
    const p = new Float32Array(1086);
    p[0] = 1; p[1] = 1; p[1083] = 0.6; // version, proxyScale, Geometry vertical
    (window as any).__mv.adj.cameraRawDevelop(p);
  });
  expect((await composite(page)).chk).not.toBe(before.chk);

  // UI: the Geometry section (collapsed by default) exposes the keystone sliders.
  await openWorkspace(page);
  await page.getByRole("dialog").getByRole("button", { name: "Geometry" }).click();
  // By role: Upright has a Vertical mode segment too (#444).
  await expect(page.getByRole("dialog").getByRole("slider", { name: "Vertical", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("slider", { name: "Horizontal", exact: true })).toBeVisible();
});

test("Auto White Balance neutralises the cast and re-develops the preview", async ({ page }) => {
  await gotoApp(page);
  await newScene(page); // the cream (232,226,210) fill is a warm cast
  await openWorkspace(page);
  await waitForDevelopFrame(page);
  const c0 = await canvasChk(page);
  const btn = page.getByRole("dialog").locator("[data-mv-cr-auto-wb]");
  await expect(btn).toBeVisible();
  await btn.click();
  // The measured cast sets Temperature/Tint, which re-develop the preview.
  await expect.poll(() => canvasChk(page), { timeout: 5000 }).not.toBe(c0);
});

test("develop presets apply a built-in look and save the current recipe", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await openWorkspace(page);
  await waitForDevelopFrame(page);
  const c0 = await canvasChk(page);
  const dialog = page.getByRole("dialog");
  const presetSelect = dialog.getByRole("combobox", { name: "Apply Preset" });

  // Apply a built-in preset (custom combobox → open, pick) → the preview re-develops.
  await presetSelect.click();
  await page.getByRole("option", { name: "Punchy" }).click();
  await expect.poll(() => canvasChk(page), { timeout: 5000 }).not.toBe(c0);

  // Save the current recipe under a name → it joins the Apply list.
  await dialog.locator("[data-mv-cr-preset-name]").fill("My Look");
  await dialog.locator("[data-mv-cr-save-preset]").click();
  await presetSelect.click(); // reopen to see the options
  await expect(page.getByRole("option", { name: "My Look" })).toBeVisible();
});

test("Camera Raw Filter exposes the full Edit stack but hides RAW-only tools and transaction actions", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await openWorkspace(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Camera Raw Filter", { exact: true })).toBeVisible();
  // Section headers by role: Detail has a Masking slider too (#444).
  for (const editSection of ["Profile & Calibration", "Healing", "Masking", "Point Color"]) {
    await expect(dialog.getByRole("button", { name: editSection, exact: true })).toBeVisible();
  }
  for (const rawOnlySection of ["Crop & Straighten", "Enhance"]) {
    await expect(dialog.getByText(rawOnlySection, { exact: true })).toHaveCount(0);
  }
  for (const selector of [
    "[data-mv-cr-save-settings]", "[data-mv-cr-done]", "[data-mv-cr-open]", "[data-mv-cr-open-object]",
    "[data-mv-cr-import-settings]", "[data-mv-cr-ai-denoise]",
  ]) await expect(dialog.locator(selector)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "OK", exact: true })).toBeVisible();
});

test("a stale pinned Camera Raw target cannot fall through to the active layer", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const target = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    const safeLayerId = E.active_layer_id();
    const staleLayerId = E.add_layer("Camera Raw stale target");
    E.select_all();
    E.fill_selection(220, 30, 40, 255);
    E.select_none();
    E.set_active_layer(staleLayerId);
    mv.engine.commit();
    const documentId = mv.store.state.activeDocId;
    mv.store.requestDialog("cameraRaw", {
      invocation: "filter", targetDocumentId: documentId, targetLayerId: staleLayerId,
    });
    return { documentId, safeLayerId, staleLayerId };
  });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Camera Raw Filter", { exact: true })).toBeVisible();
  await dragExposure(page);

  const before = await page.evaluate(({ safeLayerId, staleLayerId }) => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    mv.store.deleteLayer(staleLayerId);
    E.set_active_layer(safeLayerId);
    mv.engine.commit();
    const bytes = E.active_layer_rgba8() as Uint8Array;
    let checksum = 0;
    for (let i = 0; i < bytes.length; i++) checksum = (checksum + bytes[i] * ((i % 251) + 1)) % 2147483647;
    return { checksum, history: Array.from(E.history_labels()) as string[], activeLayerId: mv.store.state.activeLayerId };
  }, target);
  expect(before.activeLayerId).toBe(target.safeLayerId);

  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  // Failure is deliberate: the workspace remains open instead of silently
  // applying its recipe to whichever layer became active after the deletion.
  await expect(dialog).toBeVisible();
  const after = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const E = mv.engine.engine;
    const bytes = E.active_layer_rgba8() as Uint8Array;
    let checksum = 0;
    for (let i = 0; i < bytes.length; i++) checksum = (checksum + bytes[i] * ((i % 251) + 1)) % 2147483647;
    return { checksum, history: Array.from(E.history_labels()) as string[], activeLayerId: mv.store.state.activeLayerId };
  });
  expect(after).toEqual(before);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("OK applies the recipe and one undo restores the composite", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  const before = await composite(page);
  await openWorkspace(page);
  await waitForDevelopFrame(page);
  await dragExposure(page);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const applied = await composite(page);
  expect(applied.chk).not.toBe(before.chk); // OK baked the recipe

  await page.evaluate(() => (window as any).__mv.store.undo());
  const restored = await composite(page);
  expect(restored.chk).toBe(before.chk); // exactly one undo restores
});

// ── Bidirectional Gradient mask (ACR 18.4) ─────────────────────────
// The two-sided/symmetric gradient local-adjustment mask. Engine tent-coverage
// math + linear-vs-bidirectional distinction: cargo develop_bidirectional_mask_tests.
// Recipe round-trip: cameraRaw.test.ts. Here: the REAL RAW-develop workspace UI
// adds one via the new Bidirectional button. Masks are RAW-only (rawOnly) + the
// Masking section is collapsed by default, so stage a RAW and expand it first.
test("the Masking panel's Bidirectional button adds a bidirectional-gradient mask", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await stageRaw(page, tinyLinearDng(41), "bidirectional-mask.dng");
  const dialog = await expectRawWorkspace(page);

  await dialog.getByRole("button", { name: "Masking" }).click(); // expand the collapsed section
  const count = dialog.locator("[data-mv-cr-mask-count]");
  await expect(count).toContainText("0/");
  await expect(dialog.locator("[data-mv-cr-mask-bidirectional]")).toBeVisible();

  await dialog.locator("[data-mv-cr-mask-bidirectional]").click();
  await expect(count).toContainText("1/");
  // the active mask is named from its kind ("bidirectional gradient N")
  await expect(dialog.getByRole("combobox", { name: "Active Mask" })).toContainText(/bidirectional gradient/i);

  await dialog.locator("[data-mv-cr-mask-bidirectional]").click(); // repeatable action
  await expect(count).toContainText("2/");

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click(); // clean up the session
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// ── Camera Raw ▸ Visualize Spots (ACR dust-reveal preview aid) ──────
// A preview-only high-contrast luminance-edge view so sensor dust pops for
// healing. Deterministic transform (src/state/visualizeSpots.ts, unit-tested).
// Here: the real Healing-panel checkbox switches the preview to the edge view
// and back — reversible and non-destructive (never touches the recipe/pixels).
test("the Healing panel's Visualize Spots toggles a high-contrast dust-reveal preview", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await stageRaw(page, tinyLinearDng(42), "visualize-spots.dng");
  const dialog = await expectRawWorkspace(page);
  await dialog.getByRole("button", { name: "Healing" }).click(); // expand the collapsed section
  await waitForDevelopFrame(page);
  const developed = await canvasChk(page);

  const spots = dialog.getByRole("checkbox", { name: "Visualize Spots" });
  await spots.click(); // on
  await expect(dialog.getByText("Spot Threshold")).toBeVisible(); // the threshold slider appears
  await expect.poll(() => canvasChk(page), { timeout: 5000 }).not.toBe(developed); // switched to the edge view

  await spots.click(); // off
  await expect.poll(() => canvasChk(page), { timeout: 5000 }).toBe(developed); // reversible + non-destructive

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// ── Camera Raw ▸ Split Before/After view (L/R + T/B) ────────────────
// ACR/Lightroom compare the original and developed images side by side.
// Composite math: splitBeforeAfter.test.ts. Here: an exposure change makes the
// halves differ, then the real Split View button cycles Off → L/R → T/B → Off
// with a distinct preview per mode, reversible (preview-only, non-destructive).
test("the preview offers a split Before/After view (L/R and T/B)", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await stageRaw(page, tinyLinearDng(43), "split-view.dng");
  const dialog = await expectRawWorkspace(page);

  // Push Exposure so the developed (after) result differs from the original.
  const initial = await waitForDevelopFrame(page);
  await dragExposure(page);
  const { checksum: after } = await waitForDevelopFrame(page, initial.frame);

  const split = dialog.locator("[data-mv-cr-split]");
  await split.click(); // → Split L/R
  await expect(split).toContainText("L/R");
  await expect.poll(() => canvasChk(page), { timeout: 5000 }).not.toBe(after); // composite ≠ pure after
  const lr = await canvasChk(page);

  await split.click(); // → Split T/B
  await expect(split).toContainText("T/B");
  await expect.poll(() => canvasChk(page), { timeout: 5000 }).not.toBe(lr); // different split axis

  await split.click(); // → Off
  await expect(split).toContainText("Split View");
  await expect.poll(() => canvasChk(page), { timeout: 5000 }).toBe(after); // reversible + non-destructive

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// ── Camera Raw ▸ Healing ▸ Detect Spots (auto dust detection) ──────
// Automatically finds dust/blemish blobs in the preview and seeds a healing
// spot at each. Detector correctness: detectDustSpots.test.ts. Here: the real
// Detect Spots button populates the heal-spot list from a preview with sharp
// anomalies (tinyLinearDng's %-wrap discontinuities read as detectable spots).
test("the Healing panel's Detect Spots auto-seeds healing spots from the preview", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await stageRaw(page, tinyLinearDng(50, 48, 36), "detect-spots.dng");
  const dialog = await expectRawWorkspace(page);
  await dialog.getByRole("button", { name: "Healing" }).click(); // expand the collapsed section
  const count = dialog.locator("[data-mv-cr-heal-count]");
  await expect(count).toContainText("0/64 spots");
  await dialog.locator("[data-mv-cr-detect-spots]").click();
  await expect(count).toContainText(/[1-9]\d*\/64 spots/); // spots were detected + seeded
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// ── Camera Raw ▸ Basic ▸ Auto Tone ─────────────────────────────────
// ACR's Basic "Auto" derives Exposure/Contrast/Highlights/Shadows/Whites/Blacks
// from the image's tonal distribution. Heuristic correctness: autoDevelopBasic
// .test.ts. Here: the real Auto Tone button changes the develop preview.
test("the Basic panel's Auto Tone adjusts the preview from its tonal distribution", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await stageRaw(page, tinyLinearDng(51, 48, 36), "auto-tone.dng");
  const dialog = await expectRawWorkspace(page);
  await expect.poll(() => canvasChk(page), { timeout: 5000 }).toBeGreaterThan(0);
  const before = await canvasChk(page);
  await dialog.locator("[data-mv-cr-auto-tone]").click();
  await expect.poll(() => canvasChk(page), { timeout: 5000 }).not.toBe(before); // auto tone re-developed
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// ── Camera Raw ▸ clipping overlay (highlight/shadow warnings) ───────
// ACR marks blown highlights red / crushed shadows blue on the preview so you
// can see where the tonal range clips. Overlay math: clippingOverlay.test.ts.
// Here: pushing Exposure blows the highlights, then clicking the Highlights clip
// readout toggles the on-preview overlay, reversibly (preview-only).
test("the Highlights clip readout toggles an on-preview clipping overlay", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await stageRaw(page, tinyLinearDng(52, 48, 36), "clip-overlay.dng");
  const dialog = await expectRawWorkspace(page);
  // Wait for the initial develop, then for the exposure develop to actually
  // land, so `base` is a genuine developed frame. (The old canvas-stability poll
  // could settle on the pre-exposure render before the rAF develop fired, then
  // the overlay-off repaint wouldn't match that stale checksum → flake.)
  const developFrame = () => page.evaluate(() => Number(
    (document.querySelector("[data-mv-cr-canvas]") as HTMLElement | null)?.dataset.mvCrDevelopFrame ?? -1));
  await expect.poll(developFrame, { timeout: 6000 }).toBeGreaterThanOrEqual(0);
  const f0 = await developFrame();
  await dragExposure(page); // blow the highlights so there is clipping to show
  await expect.poll(developFrame, { timeout: 6000 }).toBeGreaterThan(f0);
  const base = await canvasChk(page);

  const hi = dialog.locator("[data-mv-cr-clip-highlight]");
  await hi.click(); // overlay on
  await expect.poll(() => canvasChk(page), { timeout: 15_000 }).not.toBe(base); // blown highlights marked red
  await hi.click(); // overlay off
  await expect.poll(() => canvasChk(page), { timeout: 5000 }).toBe(base); // reversible + non-destructive

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Camera Raw offers the embedded profile and rejects malformed or camera-mismatched DCP files (#446)", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await stageRaw(page, tinyLinearDng(7), "profiled.dng");
  const dialog = await expectRawWorkspace(page);
  await dialog.getByText("Profile & Calibration", { exact: true }).click();
  const menu = () => dialog.getByRole("combobox", { name: "Camera Profile" });
  const amount = () => dialog.getByRole("slider", { name: "Amount" });
  const warning = () => dialog.locator("[data-mv-cr-profile-warning]");
  // Camera Default has no look for Amount to blend in.
  await expect(amount()).toHaveAttribute("aria-disabled", "true");
  await menu().click();
  await expect(page.getByRole("option", { name: "Embedded", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "Camera Default", exact: true }).click();

  const load = async (name: string, bytes: Uint8Array) => {
    const chooser = page.waitForEvent("filechooser");
    await dialog.locator("[data-mv-cr-load-profile]").click();
    await (await chooser).setFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) });
  };
  await load("notes.dcp", new TextEncoder().encode("not a profile"));
  await expect(warning()).toContainText("can't be used as a camera profile");
  await load("Other Camera.dcp", tinyDcp("Another Camera", "Other Camera Look", 90));
  await expect(warning()).toContainText("made for Another Camera, so it isn't offered for this image");
  await menu().click();
  await expect(page.getByRole("option", { name: "Other Camera Look" })).toHaveCount(0);
  await page.getByRole("option", { name: "Camera Default", exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a loaded DCP changes Camera Raw pixels and survives a project reopen (#446)", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await stageRaw(page, tinyLinearDng(7), "profiled.dng");
  let dialog = await expectRawWorkspace(page);
  await dialog.getByText("Profile & Calibration", { exact: true }).click();
  const menu = () => dialog.getByRole("combobox", { name: "Camera Profile" });
  const amount = () => dialog.getByRole("slider", { name: "Amount" });
  const warning = () => dialog.locator("[data-mv-cr-profile-warning]");
  const chooser = page.waitForEvent("filechooser");
  await dialog.locator("[data-mv-cr-load-profile]").click();
  await (await chooser).setFiles({
    name: "E2E Hue.dcp", mimeType: "application/octet-stream",
    buffer: Buffer.from(tinyDcp("Vision E2E", "E2E Hue Shift", 90)),
  });
  await expect(warning()).toHaveCount(0);

  const cameraDefault = await waitForDevelopFrame(page);
  await menu().click();
  await page.getByRole("option", { name: "E2E Hue Shift" }).click();
  const profiled = await waitForDevelopFrame(page, cameraDefault.frame);
  expect(profiled.checksum).not.toBe(cameraDefault.checksum); // the render changed, not just the recipe
  await expect(amount()).not.toHaveAttribute("aria-disabled", "true");

  await dialog.locator("[data-mv-cr-open-object]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const id = mv.store.state.activeDocId as number;
    return { bytes: Array.from(mv.store.saveProjectForDoc(id) as Uint8Array), profile: mv.store.cameraRawSourceForDoc(id)?.recipe.profile };
  });
  expect(saved.profile).toMatchObject({ id: "custom", name: "E2E Hue Shift", digest: expect.stringMatching(/^[0-9A-F]{32}$/) });

  // A fresh launch (no profile tables in the engine) finds it again in the library.
  const reopen = async () => {
    await gotoApp(page);
    await page.evaluate(() => (window as any).__mv.store.cameraRawProfilesReady);
    await page.evaluate((bytes) => {
      const mv = (window as any).__mv;
      mv.store.openProject(new Uint8Array(bytes), "profiled.mvision");
      mv.store.requestCameraRawEdit();
    }, saved.bytes);
    dialog = await expectRawWorkspace(page);
    await dialog.getByText("Profile & Calibration", { exact: true }).click();
  };
  await reopen();
  await expect(menu()).toHaveText("E2E Hue Shift");
  await expect(warning()).toHaveCount(0);
  const reopened = await waitForDevelopFrame(page);
  await menu().click();
  await page.getByRole("option", { name: "Camera Default", exact: true }).click();
  expect((await waitForDevelopFrame(page, reopened.frame)).checksum).not.toBe(reopened.checksum);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a missing Camera Raw profile keeps its choice and warns after project reopen (#446)", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await stageRaw(page, tinyLinearDng(7), "profiled.dng");
  let dialog = await expectRawWorkspace(page);
  await dialog.getByText("Profile & Calibration", { exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await dialog.locator("[data-mv-cr-load-profile]").click();
  await (await chooser).setFiles({
    name: "E2E Hue.dcp", mimeType: "application/octet-stream",
    buffer: Buffer.from(tinyDcp("Vision E2E", "E2E Hue Shift", 90)),
  });
  await dialog.getByRole("combobox", { name: "Camera Profile" }).click();
  await page.getByRole("option", { name: "E2E Hue Shift" }).click();
  await dialog.locator("[data-mv-cr-open-object]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const id = mv.store.state.activeDocId as number;
    return { bytes: Array.from(mv.store.saveProjectForDoc(id) as Uint8Array), profile: mv.store.cameraRawSourceForDoc(id)?.recipe.profile };
  });
  expect(saved.profile).toMatchObject({ id: "custom", name: "E2E Hue Shift", digest: expect.stringMatching(/^[0-9A-F]{32}$/) });

  // Without the profile the choice stays, rendered as Camera Default, and says how to fix it.
  await page.evaluate(() => new Promise((resolve) => { indexedDB.deleteDatabase("mv.cameraRawProfiles").onsuccess = resolve; }));
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.cameraRawProfilesReady);
  await page.evaluate((bytes) => {
    const mv = (window as any).__mv;
    mv.store.openProject(new Uint8Array(bytes), "profiled.mvision");
    mv.store.requestCameraRawEdit();
  }, saved.bytes);
  dialog = await expectRawWorkspace(page);
  await dialog.getByText("Profile & Calibration", { exact: true }).click();
  await expect(page.getByText("The camera profile “E2E Hue Shift” isn't installed, so layers using it show Camera Default", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Camera Profile" })).toContainText("E2E Hue Shift (missing)");
  await expect(dialog.locator("[data-mv-cr-profile-warning]")).toContainText("“E2E Hue Shift” isn't installed — showing Camera Default. Load it with Load Profile…");
  await expect(dialog.getByRole("slider", { name: "Amount" })).toHaveAttribute("aria-disabled", "true");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a matrix-only DCP changes RAW colors, responds to Amount, and survives a project reopen (#446)", async ({ page }) => {
  await gotoApp(page);
  await newScene(page);
  await stageRaw(page, tinyLinearDng(7), "matrix-profile.dng");
  let dialog = await expectRawWorkspace(page);
  await dialog.getByText("Profile & Calibration", { exact: true }).click();

  // Keep just the four characterization/name tags in the helper's valid TIFF
  // IFD. Its existing data offsets remain valid; no HueSatMap or tone curve
  // can make this test pass in place of the ColorMatrix correction.
  const profile = tinyDcp("Vision E2E", "Matrix Only", 0);
  const view = new DataView(profile.buffer);
  view.setUint16(8, 4, true);
  view.setUint32(10 + 4 * 12, 0, true);
  const matrixOffset = view.getUint32(10 + 12 + 8, true);
  const firstRow = profile.slice(matrixOffset, matrixOffset + 24);
  profile.copyWithin(matrixOffset, matrixOffset + 48, matrixOffset + 72);
  profile.set(firstRow, matrixOffset + 48); // exchange red/blue camera responses
  const chooser = page.waitForEvent("filechooser");
  await dialog.locator("[data-mv-cr-load-profile]").click();
  await (await chooser).setFiles({ name: "Matrix Only.dcp", mimeType: "application/octet-stream", buffer: Buffer.from(profile) });

  const original = await waitForDevelopFrame(page);
  await dialog.getByRole("combobox", { name: "Camera Profile" }).click();
  await page.getByRole("option", { name: "Matrix Only", exact: true }).click();
  const corrected = await waitForDevelopFrame(page, original.frame);
  expect(corrected.checksum).not.toBe(original.checksum);
  const amount = dialog.getByRole("slider", { name: "Amount", exact: true });
  await expect(amount).not.toHaveAttribute("aria-disabled", "true");
  await amount.focus();
  await amount.press("Home");
  const zero = await waitForDevelopFrame(page, corrected.frame);
  expect(zero.checksum).toBe(original.checksum);
  await amount.press("End");
  expect((await waitForDevelopFrame(page, zero.frame)).checksum).toBe(corrected.checksum);
  await dialog.locator("[data-mv-cr-open-object]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await page.evaluate(() => {
    const mv = (window as any).__mv;
    return {
      bytes: Array.from(mv.store.saveProjectForDoc(mv.store.state.activeDocId) as Uint8Array),
      pixels: Array.from(mv.engine.engine.export_composite_rgba16() as Uint16Array),
    };
  });
  await page.reload();
  await gotoApp(page);
  const reopened = await page.evaluate(async (bytes) => {
    const mv = (window as any).__mv;
    await mv.store.cameraRawProfilesReady;
    mv.store.openProject(new Uint8Array(bytes), "matrix-profile.mvision");
    const pixels = Array.from(mv.engine.engine.export_composite_rgba16() as Uint16Array);
    mv.store.requestCameraRawEdit();
    return pixels;
  }, saved.bytes);
  expect(reopened).toEqual(saved.pixels);
  dialog = await expectRawWorkspace(page);
  await dialog.getByText("Profile & Calibration", { exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Camera Profile" })).toHaveText("Matrix Only");
  const afterReload = await waitForDevelopFrame(page);
  await dialog.getByRole("slider", { name: "Amount", exact: true }).focus();
  await dialog.getByRole("slider", { name: "Amount", exact: true }).press("Home");
  expect((await waitForDevelopFrame(page, afterReload.frame)).checksum).not.toBe(afterReload.checksum);
});

test("the profile library keeps ten Adobe-sized profiles across a relaunch, outside localStorage (#446)", async ({ page }) => {
  await gotoApp(page);
  const payloads = Array.from({ length: 10 }, (_, i) =>
    Buffer.from(tinyDcp("Vision E2E", `Big Look ${i}`, i * 30, [90, 32, 32])).toString("base64"));
  expect(Buffer.from(payloads[0], "base64").length).toBeGreaterThan(1_100_000);
  await page.evaluate((list) => {
    const mv = (window as any).__mv;
    mv.store.addSwatch("#123456");
    for (const [i, data] of list.entries()) {
      mv.store.importCameraRawProfile(`Big Look ${i}.dcp`, Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
    }
  }, payloads);
  // Every write has landed before the relaunch.
  await expect.poll(() => page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open("mv.cameraRawProfiles");
    open.onsuccess = () => {
      const count = open.result.transaction("profiles").objectStore("profiles").count();
      count.onsuccess = () => { resolve(count.result); open.result.close(); };
    };
  }))).toBe(10);
  await page.reload();
  await gotoApp(page);
  const after = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    await mv.store.cameraRawProfilesReady;
    mv.store.addSwatch("#654321");
    return {
      names: mv.store.state.cameraRawProfiles.map((entry: { name: string }) => entry.name),
      localStorageChars: Object.keys(localStorage).reduce((sum, key) => sum + key.length + (localStorage.getItem(key) ?? "").length, 0),
      legacyKey: localStorage.getItem("mv.cameraRawProfiles"),
      swatches: localStorage.getItem("mv.swatches"),
    };
  });
  expect(after.names).toEqual(Array.from({ length: 10 }, (_, i) => `Big Look ${i}`));
  expect(after.legacyKey).toBeNull();
  expect(after.localStorageChars).toBeLessThan(200_000);
  expect(after.swatches).toContain("#654321");
});
