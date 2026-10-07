import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "fs";
import { gotoApp } from "./helpers";

// Issue #466: Photoshop's plug-in formats open from File ▸ Open (DPX, DICOM,
// JPEG 2000, and headerless Photoshop Raw through its Options dialog) and
// JPEG 2000 saves from File ▸ Save As through its Options dialog. The files
// are built here byte by byte, so the spec needs no fixtures.

async function clickMenuItem(page: Page, top: string, label: string) {
  await page.getByText(top, { exact: true }).first().click();
  const ok = await page.evaluate(async (label) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const labelOf = (e: Element) => (((e.querySelector(".monet-menu-label") || {}) as HTMLElement).textContent || "").trim();
    const findLeaf = () => [...document.querySelectorAll(".monet-menu-item")]
      .find((e) => e.getAttribute("aria-haspopup") !== "menu" && labelOf(e) === label) as HTMLElement | undefined;
    const seen = new Set<Element>();
    const visit = async (): Promise<boolean> => {
      const hit = findLeaf();
      if (hit) { hit.click(); return true; }
      for (const s of [...document.querySelectorAll('.monet-menu-item[aria-haspopup="menu"]')]) {
        if (seen.has(s)) continue;
        seen.add(s);
        s.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
        s.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
        await sleep(45);
        if (await visit()) return true;
      }
      return false;
    };
    return await visit();
  }, label);
  expect(ok, `menu item ${label}`).toBe(true);
}

/** File ▸ Open… with `name`'s bytes through the browser file picker. */
async function openFile(page: Page, name: string, buffer: Buffer) {
  const chooser = page.waitForEvent("filechooser");
  await clickMenuItem(page, "File", "Open…");
  await (await chooser).setFiles({ name, mimeType: "application/octet-stream", buffer });
}

/** The active document once it is `name`: size, depth and RGBA16 samples. */
async function activeDoc(page: Page, name: string) {
  await page.waitForFunction((name) => (window as any).__mv.store.activeName() === name, name);
  return await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return { w: E.width(), h: E.height(), depth: E.doc_depth(), rgba: Array.from(E.export_composite_rgba16() as Uint16Array) };
  });
}

test("File Open reads JPEG 2000, DPX and Cineon written by independent encoders", async ({ page }) => {
  await gotoApp(page);
  page.on("dialog", (d) => d.accept());
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [0, 0, 0], [255, 255, 0], [0, 255, 255], [255, 0, 255]];
  for (const name of ["pillow-rgba.jp2", "imagemagick-rgb.dpx", "imagemagick-rgb.cin"]) {
    await openFile(page, name, readFileSync(new URL(`../test-assets/fixtures/${name}`, import.meta.url)));
    const doc = await activeDoc(page, name);
    expect([doc.w, doc.h, doc.depth]).toEqual([4, 2, name.endsWith("jp2") ? 8 : 16]);
    const alpha = name.endsWith("jp2") ? [255, 128, 64, 0, 255, 255, 255, 255] : Array(8).fill(255);
    for (let i = 0; i < colors.length; i++) {
      expect(doc.rgba[i * 4 + 3]).toBe(alpha[i] * 257);
      // The compositor may discard RGB under fully transparent samples.
      if (alpha[i]) expect(doc.rgba.slice(i * 4, i * 4 + 3)).toEqual(colors[i].map((v) => v * 257));
    }
  }
});

/** SMPTE DPX, big-endian, 10-bit RGB filled three to a word (method A). */
function dpx10(w: number, h: number, px: (x: number, y: number) => [number, number, number]) {
  const file = Buffer.alloc(2048 + w * h * 4);
  file.write("SDPX", 0, "latin1");
  file.writeUInt32BE(2048, 4);
  file.writeUInt32BE(w, 772);
  file.writeUInt32BE(h, 776);
  file[800] = 50; // RGB
  file[803] = 10; // bits
  file.writeUInt16BE(1, 804); // filled, method A
  file.writeUInt32BE(2048, 808);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      file.writeUInt32BE(((r << 22) | (g << 12) | (b << 2)) >>> 0, 2048 + (y * w + x) * 4);
    }
  }
  return file;
}

/** A Part-10 DICOM, explicit VR little endian, 16-bit MONOCHROME2. */
function dicom(w: number, h: number, values: number[], window: [number, number], instance = 1) {
  const el = (group: number, elem: number, vr: string, value: Buffer) => {
    const long = vr === "OW";
    const head = Buffer.alloc(long ? 12 : 8);
    head.writeUInt16LE(group, 0);
    head.writeUInt16LE(elem, 2);
    head.write(vr, 4, "latin1");
    if (long) head.writeUInt32LE(value.length, 8);
    else head.writeUInt16LE(value.length, 6);
    return Buffer.concat([head, value]);
  };
  const text = (s: string) => Buffer.from(s.length % 2 ? `${s} ` : s, "latin1");
  const us = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
  const pixels = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => pixels.writeUInt16LE(v, i * 2));
  const preamble = Buffer.alloc(132);
  preamble.write("DICM", 128, "latin1");
  return Buffer.concat([
    preamble,
    el(0x0002, 0x0010, "UI", Buffer.from("1.2.840.10008.1.2.1\0", "latin1")),
    el(0x0020, 0x0013, "IS", text(String(instance))),
    el(0x0028, 0x0002, "US", us(1)),
    el(0x0028, 0x0004, "CS", text("MONOCHROME2")),
    el(0x0028, 0x0010, "US", us(h)),
    el(0x0028, 0x0011, "US", us(w)),
    el(0x0028, 0x0100, "US", us(16)),
    el(0x0028, 0x0101, "US", us(12)),
    el(0x0028, 0x0103, "US", us(0)),
    el(0x0028, 0x1050, "DS", text(String(window[0]))),
    el(0x0028, 0x1051, "DS", text(String(window[1]))),
    el(0x7fe0, 0x0010, "OW", pixels),
  ]);
}

test("File ▸ Open reads DPX, DICOM and headerless Photoshop Raw", async ({ page }) => {
  await gotoApp(page);
  page.on("dialog", (d) => d.accept()); // the missing-profile prompt, if the policy asks

  // 10-bit film data opens as-is (no log→lin) into a 16-bit document.
  const film = (x: number, y: number): [number, number, number] => [x * 300, y * 1000, 1023 - x * 100];
  await openFile(page, "scan.dpx", dpx10(4, 2, film));
  const dpx = await activeDoc(page, "scan.dpx");
  expect([dpx.w, dpx.h, dpx.depth]).toEqual([4, 2, 16]);
  const to16 = (v: number) => Math.floor((v * 65535) / 1023);
  expect(dpx.rgba.slice((1 * 4 + 3) * 4, (1 * 4 + 3) * 4 + 3)).toEqual(film(3, 1).map(to16));

  // DICOM: 12-bit data through a 1000-wide window centred on 1000.
  await openFile(page, "slice.dcm", dicom(3, 1, [0, 1000, 4095], [1000, 1000]));
  const dcm = await activeDoc(page, "slice.dcm");
  expect([dcm.w, dcm.h, dcm.depth]).toEqual([3, 1, 16]);
  expect([dcm.rgba[0], dcm.rgba[8]]).toEqual([0, 65535]);
  expect(Math.abs(dcm.rgba[4] - 32768)).toBeLessThan(70);

  // Photoshop Raw: the camera decoder refuses the bytes, so the Options dialog
  // asks for the layout; Guess finds the height from the width.
  const rgb = Buffer.alloc(6 * 4 * 3);
  for (let i = 0; i < 24; i++) rgb.set([(i % 6) * 40, Math.floor(i / 6) * 60, i * 10], i * 3);
  await openFile(page, "flat.raw", rgb);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Photoshop Raw Options");
  await page.getByRole("spinbutton", { name: "Width", exact: true }).fill("6");
  await page.getByRole("spinbutton", { name: "Height", exact: true }).fill("0");
  await page.getByRole("spinbutton", { name: "Height", exact: true }).press("Enter");
  await dialog.getByRole("button", { name: "Guess" }).click();
  await expect(page.getByRole("spinbutton", { name: "Height", exact: true })).toHaveValue("4");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  const raw = await activeDoc(page, "flat.raw");
  expect([raw.w, raw.h, raw.depth]).toEqual([6, 4, 8]);
  const i = 2 * 6 + 5;
  expect(raw.rgba.slice(i * 4, i * 4 + 4)).toEqual([5 * 40, 2 * 60, i * 10, 255].map((v) => v * 257));
});

test("File ▸ Save As writes JPEG 2000 through its Options dialog", async ({ page }) => {
  await gotoApp(page);
  page.on("dialog", (d) => d.accept());
  // A real .jp2 to open: the engine's own lossless writer, from a 16-bit doc.
  const source = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(12, 8, "src");
    const E = mv.engine.engine;
    E.set_depth(16);
    E.select_rect(0, 0, 5, 8, 0); E.fill_selection(200, 30, 90, 255);
    E.select_rect(5, 2, 7, 3, 0); E.fill_selection(10, 220, 140, 255);
    E.select_none();
    mv.engine.commit();
    return {
      jp2: Array.from(E.export_jpeg2000(true, 100, false) as Uint8Array),
      rgba: Array.from(E.export_composite_rgba16() as Uint16Array),
    };
  });
  await openFile(page, "photo.jp2", Buffer.from(source.jp2));
  const opened = await activeDoc(page, "photo.jp2");
  expect([opened.w, opened.h, opened.depth]).toEqual([12, 8, 16]);
  expect(opened.rgba).toEqual(source.rgba);

  // Save As keeps the .jp2 name and asks for JPEG 2000 Options first.
  await clickMenuItem(page, "File", "Save As…");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("JPEG 2000 Options");
  await expect(page.getByRole("checkbox", { name: "Lossless" })).toHaveAttribute("aria-checked", "true");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "OK", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("photo.jp2");
  const saved = Array.from(readFileSync(await download.path()));
  expect(saved.slice(0, 12)).toEqual([0, 0, 0, 12, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a]);
  const reopened = await page.evaluate((bytes) => {
    const mv = (window as any).__mv;
    const e = mv.engine.buildImage(new Uint8Array(bytes));
    try { return Array.from(e.export_composite_rgba16() as Uint16Array); } finally { e.free(); }
  }, saved);
  expect(reopened).toEqual(source.rgba); // lossless: bit-exact at 16 bits
});

test("multiple Photoshop Raw files wait for each layout, including after Cancel", async ({ page }) => {
  await gotoApp(page);
  page.on("dialog", (d) => d.accept());
  const chooser = page.waitForEvent("filechooser");
  await clickMenuItem(page, "File", "Open…");
  await (await chooser).setFiles(["first.rawps", "second.rawps"].map((name) => ({
    name, mimeType: "application/octet-stream", buffer: Buffer.alloc(48, 120),
  })));
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("first.rawps");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toContainText("second.rawps");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  const doc = await activeDoc(page, "second.rawps");
  expect([doc.w, doc.h, doc.depth]).toEqual([4, 4, 8]);
  const names = await page.evaluate(() => (window as any).__mv.store.state.documents.map((d: { name: string }) => d.name));
  expect(names).not.toContain("first.rawps");
});

test("a malformed IFF is refused and leaves the open document usable", async ({ page }) => {
  await gotoApp(page);
  // usize is 32 bits in the wasm engine: a chunk size near u32::MAX has to end
  // the chunk walk. A wrapped offset traps, and a trap inside importImage never
  // releases the document, so not even Save works afterwards.
  const files = [0xffffffff, 0xffffffe6].map((size) => {
    const file = Buffer.alloc(24);
    file.write("FORM", 0, "latin1");
    file.writeUInt32BE(16, 4);
    file.write("ILBMJUNK", 8, "latin1");
    file.writeUInt32BE(size, 16);
    return Array.from(file);
  });
  const after = await page.evaluate((files) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(4, 4, "doc");
    const E = mv.engine.engine;
    const layers = E.layer_count();
    const refusals = files.map((bytes) => {
      try { return `imported layer ${E.importImage(new Uint8Array(bytes), "bad")}`; } catch (e) { return String(e); }
    });
    return { refusals, added: E.layer_count() - layers, png: (E.export_png() as Uint8Array).length };
  }, files);
  const refusal = "decode failed: the IFF file has no bitmap header (BMHD)";
  expect(after.refusals).toEqual([refusal, refusal]);
  expect(after.added).toBe(0);
  expect(after.png).toBeGreaterThan(0);
});

test("Load Multiple DICOM Files is a live menu command", async ({ page }) => {
  await gotoApp(page);
  const chooser = page.waitForEvent("filechooser");
  await clickMenuItem(page, "File", "Load Multiple DICOM Files…");
  const picker = await chooser;
  expect(picker.isMultiple()).toBe(true);
  // Instance Number, not the file name, orders the slices.
  await picker.setFiles([
    { name: "a.dcm", mimeType: "application/dicom", buffer: dicom(2, 2, [4095, 4095, 4095, 4095], [2048, 4096], 2) },
    { name: "b.dcm", mimeType: "application/dicom", buffer: dicom(2, 2, [0, 0, 0, 0], [2048, 4096], 1) },
  ]);
  await page.waitForFunction(() => (window as any).__mv.store.activeName() === "b.dcm");
  await page.waitForFunction(() => (window as any).__mv.engine.engine.layer_count() === 2);
  const names = await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    return [0, 1].map((i) => E.layer_name(E.layer_id_at(i)));
  });
  expect(names).toEqual(["a", "Background"]); // slice 2 stacks above slice 1
});
