import { test, expect, type Locator, type Page } from "@playwright/test";
import { composite, gotoApp, newScene, tinyLinearDng } from "./helpers";

// Published Lensfun calibration, pinned by the bundled offline catalog (#445).
const PROFILE_ID = "61e436adf1f54d26f516e70aa45399df";
const PROFILE_NAME = "Canon EF-S 18-55mm f/3.5-5.6 IS STM (Canon EF-S, 1.613×)";
const png = (page: Page) => page.evaluate(() => Array.from((window as any).__mv.engine.engine.export_png() as Uint8Array));

/** Standard EXIF APP1: TIFF camera tags and an ExifIFD with lens/focal/f-number. */
function withLensExif(jpeg: number[]): number[] {
  const make = new TextEncoder().encode("Canon\0");
  const model = new TextEncoder().encode("Canon EOS 600D\0");
  const lens = new TextEncoder().encode("EF-S 18-55mm f/3.5-5.6 IS STM\0");
  const makeAt = 92, modelAt = makeAt + make.length, lensAt = modelAt + model.length;
  const focalAt = lensAt + lens.length, apertureAt = focalAt + 8;
  const tiff = new Uint8Array(apertureAt + 8), view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
  const field = (at: number, tag: number, type: number, count: number, offset: number) => {
    view.setUint16(at, tag, true); view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true); view.setUint32(at + 8, offset, true);
  };
  view.setUint16(8, 3, true);
  field(10, 0x010f, 2, make.length, makeAt);
  field(22, 0x0110, 2, model.length, modelAt);
  field(34, 0x8769, 4, 1, 50);
  view.setUint16(50, 3, true);
  field(52, 0x829d, 5, 1, apertureAt);
  field(64, 0x920a, 5, 1, focalAt);
  field(76, 0xa434, 2, lens.length, lensAt);
  tiff.set(make, makeAt); tiff.set(model, modelAt); tiff.set(lens, lensAt);
  view.setUint32(focalAt, 18, true); view.setUint32(focalAt + 4, 1, true);
  view.setUint32(apertureAt, 35, true); view.setUint32(apertureAt + 4, 10, true);
  const payload = new Uint8Array(6 + tiff.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0, 0]); payload.set(tiff, 6);
  const length = payload.length + 2;
  return [0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 255, ...payload, ...jpeg.slice(2)];
}

async function pickProfile(page: Page, dialog: Locator) {
  await dialog.getByRole("combobox", { name: "Lens profile", exact: true }).click();
  await page.getByRole("option", { name: PROFILE_NAME, exact: true }).click();
  await dialog.getByLabel("Focal length (mm)", { exact: true }).fill("18");
  await dialog.getByLabel("Aperture (f-number)", { exact: true }).fill("3.5");
  await dialog.getByLabel("Sensor crop factor", { exact: true }).fill("1.613");
}

async function stageRaw(page: Page, name: string) {
  const sessionId = await page.evaluate(async ({ bytes, name }) => {
    const mv = (window as any).__mv, input = new Uint8Array(bytes);
    const digest = await crypto.subtle.digest("SHA-256", input.slice().buffer);
    const sha256 = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
    return mv.store.openRaw(input, name, { sha256 }) as string;
  }, { bytes: Array.from(tinyLinearDng(17, 64, 48)), name });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Camera Raw", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Optics", exact: true }).click();
  await expect(dialog.locator("[data-mv-lens-profile-controls]")).toBeVisible();
  return { dialog, sessionId };
}

type Preview = { frame: number; checksum: number };
async function preview(page: Page, after = -1): Promise<Preview> {
  let previous: Preview | undefined;
  await expect.poll(async () => {
    const current = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-mv-cr-canvas]");
      if (!canvas?.width || !canvas.height) return { frame: -1, checksum: 0 };
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let checksum = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        checksum = (checksum + (i / 4 + 1) * (pixels[i] * 3 + pixels[i + 1] * 5 + pixels[i + 2] * 7 + pixels[i + 3] * 11)) % 2147483647;
      }
      return { frame: Number(canvas.dataset.mvCrDevelopFrame ?? -1), checksum };
    });
    const stable = current.frame > after && previous?.frame === current.frame && previous.checksum === current.checksum;
    previous = current;
    return stable;
  }).toBe(true);
  return previous!;
}

async function lensDialog(page: Page) {
  await page.waitForFunction(() => (window as any).__mv.commandPalette.items.some((item: any) => item.label.endsWith("Lens Correction…")));
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((item: any) => item.label.endsWith("Lens Correction…")).run());
  const dialog = page.getByRole("dialog", { name: "Lens Correction", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("Camera Raw profile corrections change preview pixels, toggle off exactly, and Cancel leaves the document untouched", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 96, 64);
  const original = await png(page);
  const documents = await page.evaluate(() => (window as any).__mv.store.state.documents);
  const { dialog, sessionId } = await stageRaw(page, "lens-cancel.dng");
  await pickProfile(page, dialog);
  const before = await preview(page);
  const enabled = dialog.getByRole("checkbox", { name: "Enable Profile Corrections", exact: true });
  await enabled.click();
  await expect(dialog.locator("[data-mv-lens-profile-controls]").getByRole("status")).toContainText(PROFILE_NAME);
  const corrected = await preview(page, before.frame);
  expect(corrected.checksum).not.toBe(before.checksum);
  await enabled.click();
  const disabled = await preview(page, corrected.frame);
  expect(disabled.checksum).toBe(before.checksum);
  await expect(dialog.getByRole("combobox", { name: "Lens profile" })).toContainText(PROFILE_NAME);
  await expect(dialog.getByLabel("Focal length (mm)", { exact: true })).toHaveValue("18");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await png(page)).toEqual(original);
  expect(await page.evaluate(() => (window as any).__mv.store.state.documents)).toEqual(documents);
  expect(await page.evaluate((id) => (window as any).__mv.store.cameraRawSession(id), sessionId)).toBeNull();
});

test("Camera Raw Open as Object retains the lens profile and correction through Smart Filter replay and project reopen", async ({ page }) => {
  await gotoApp(page);
  const { dialog } = await stageRaw(page, "lens-object.dng");
  await pickProfile(page, dialog);
  const before = await preview(page);
  await dialog.getByRole("checkbox", { name: "Enable Profile Corrections", exact: true }).click();
  expect((await preview(page, before.frame)).checksum).not.toBe(before.checksum);
  await dialog.locator("[data-mv-cr-open-object]").click();
  await expect(dialog).toHaveCount(0);
  const corrected = await composite(page);
  const saved = await page.evaluate(() => {
    const mv = (window as any).__mv, id = mv.store.state.activeDocId, E = mv.engine.engine;
    const layer = mv.store.state.activeLayerId;
    return {
      bytes: Array.from(mv.store.saveProjectForDoc(id) as Uint8Array),
      optics: mv.store.cameraRawSourceForDoc(id)?.recipe.optics,
      kind: E.layer_kind(layer),
      filters: Array.from({ length: E.smart_filter_count(layer) }, (_, i) => E.smart_filter_id(layer, i)),
    };
  });
  expect(saved.kind).toBe(7);
  expect(saved.filters).toContain(17);
  expect(saved.optics).toMatchObject({
    enableProfileCorrections: true, profileId: PROFILE_ID, profileName: PROFILE_NAME,
    profileFocalLengthMm: 18, profileAperture: 3.5, profileCalibration: { profileId: PROFILE_ID },
  });
  expect(saved.optics.profileCropFactor).toBeCloseTo(1.613, 5);
  await page.evaluate((bytes) => (window as any).__mv.store.openProject(new Uint8Array(bytes), "lens-object.mvision"), saved.bytes);
  expect(await composite(page)).toEqual(corrected);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.engine.engine.set_smart_filters_enabled(mv.store.state.activeLayerId, false);
    mv.engine.commit();
  });
  expect((await composite(page)).chk).not.toBe(corrected.chk);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.engine.engine.set_smart_filters_enabled(mv.store.state.activeLayerId, true);
    mv.engine.commit();
    mv.store.requestCameraRawEdit();
  });
  const reopened = page.getByRole("dialog");
  await expect(reopened).toBeVisible();
  await reopened.getByRole("button", { name: "Optics", exact: true }).click();
  await expect(reopened.getByRole("checkbox", { name: "Enable Profile Corrections", exact: true })).toBeChecked();
  await expect(reopened.getByRole("combobox", { name: "Lens profile" })).toContainText(PROFILE_NAME);
  await expect(reopened.getByLabel("Focal length (mm)", { exact: true })).toHaveValue("18");
  await expect(reopened.getByLabel("Aperture (f-number)", { exact: true })).toHaveValue("3.5");
  await reopened.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(reopened).toHaveCount(0);
  expect(await composite(page)).toEqual(corrected);
});

test("Lens Correction refuses unknown automatic matching, cancels cleanly, and applies one undoable published-profile Smart Filter", async ({ page }) => {
  await gotoApp(page);
  await newScene(page, 96, 64);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.engine.engine.convert_to_smart_object(mv.store.state.activeLayerId);
    mv.engine.commit();
  });
  const before = await composite(page), original = await png(page);
  let dialog = await lensDialog(page);
  await dialog.getByRole("checkbox", { name: "Enable Profile Corrections", exact: true }).click();
  await expect(dialog.locator("[data-mv-lens-profile-controls]").getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(await png(page)).toEqual(original);
  await pickProfile(page, dialog);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await png(page)).toEqual(original);

  dialog = await lensDialog(page);
  await pickProfile(page, dialog);
  await dialog.getByRole("checkbox", { name: "Enable Profile Corrections", exact: true }).click();
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const corrected = await composite(page);
  expect(corrected.chk).not.toBe(before.chk);
  expect(await page.evaluate(() => {
    const mv = (window as any).__mv, E = mv.engine.engine, id = mv.store.state.activeLayerId;
    return Array.from({ length: E.smart_filter_count(id) }, (_, i) => E.smart_filter_id(id, i));
  })).toEqual([118]);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await composite(page)).toEqual(before);
  await page.evaluate(() => (window as any).__mv.store.redo());
  expect(await composite(page)).toEqual(corrected);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.openProject(mv.store.saveProjectForDoc(mv.store.state.activeDocId), "lens-filter.mvision");
  });
  expect(await composite(page)).toEqual(corrected);
});

test("Automatic lens correction reads actual JPEG EXIF and survives project metadata roundtrip without manual overrides", async ({ page }) => {
  await gotoApp(page);
  const jpeg = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 96; canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgb(80,120,160)"; ctx.fillRect(0, 0, 96, 64);
    for (let x = 0; x < 96; x += 12) {
      ctx.fillStyle = x % 24 ? "rgb(230,210,90)" : "rgb(40,80,130)";
      ctx.fillRect(x, 0, 4, 64);
    }
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/jpeg", 0.95));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const capture = await page.evaluate((bytes) => {
    const mv = (window as any).__mv;
    mv.store.openImage(new Uint8Array(bytes), "automatic-exif.jpg");
    const before = mv.store.lensMetadata();
    mv.store.openProject(mv.store.saveProjectForDoc(mv.store.state.activeDocId), "automatic-exif.mvision");
    return { before, after: mv.store.lensMetadata() };
  }, withLensExif(jpeg));
  expect(capture.before).toMatchObject({ make: "Canon", model: "Canon EOS 600D", lens: "EF-S 18-55mm f/3.5-5.6 IS STM", focalLengthMm: 18, aperture: 3.5 });
  expect(capture.after).toEqual(capture.before);
  const before = await composite(page);
  const dialog = await lensDialog(page);
  await expect(dialog.getByRole("combobox", { name: "Lens profile", exact: true })).toContainText("Automatic");
  for (const label of ["Focal length (mm)", "Aperture (f-number)", "Sensor crop factor"]) await expect(dialog.getByLabel(label, { exact: true })).toHaveValue("");
  await dialog.getByRole("checkbox", { name: "Enable Profile Corrections", exact: true }).click();
  await expect(dialog.locator("[data-mv-lens-profile-controls]").getByRole("status")).toContainText(PROFILE_NAME);
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await composite(page)).chk).not.toBe(before.chk);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await composite(page)).toEqual(before);
});
