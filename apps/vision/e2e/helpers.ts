import { type Locator, type Page } from "@playwright/test";

// ── shared e2e helpers ─────────────────────────────────────────
// Tests drive the live app through `window.__mv` (the full app API,
// exposed in dev by main.tsx) and through real UI interactions.

/** Pick an option in a Monet `<Select>` — the stand-in for Playwright's
 *  native-only `selectOption()`. Matches the option's value, else its label.
 *  Assert the committed value with `toHaveAttribute("data-value", v)`. */
export async function chooseOption(select: Locator, valueOrLabel: string) {
  await select.click();
  const list = select.page().locator(".monet-listbox");
  await list.waitFor();
  const byValue = list.locator(`[role="option"][data-value=${JSON.stringify(valueOrLabel)}]`);
  await ((await byValue.count()) ? byValue : list.getByRole("option", { name: valueOrLabel, exact: true })).click();
}

/** Load the app and explicitly create the document these workspace tests use. */
export async function gotoApp(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => {
    const mv = (window as any).__mv;
    return mv && mv.engine && mv.store;
  }, null, { timeout: 30_000 });
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    if (!mv.store.state.documents.length) mv.store.newDocument(1280, 800, "Untitled.psd", "white", 1, { pristineBlank: true });
  });
}

/** Create a fresh structured document (gradient bg + colored stripes) so
 *  pixel-change assertions are meaningful. Returns {w,h}. */
export async function newScene(page: Page, w = 256, h = 192) {
  return await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    const E = () => mv.engine.engine;
    mv.store.newDocument(w, h, "e2e");
    E().select_all(); E().fill_selection(232, 226, 210, 255); E().select_none();
    const cols = 8;
    for (let i = 0; i < cols; i++) {
      E().select_rect(Math.round(i * (w / cols)), 0, Math.round(w / (cols * 2)), h, 0);
      E().fill_selection((i * 53) % 256, (i * 97) % 256, (180 - i * 8 + 256) % 256, 255);
    }
    // asymmetric block (top-left) so the scene is neither H- nor V-symmetric
    E().select_rect(0, 0, Math.round(w / 3), Math.round(h / 4), 0);
    E().fill_selection(18, 18, 22, 255);
    E().select_none();
    mv.engine.commit();
    return { w, h };
  }, { w, h });
}

/** A signature of the current composite: mean RGB, a content checksum, dims. */
export async function composite(page: Page): Promise<{ mean: number; chk: number; w: number; h: number; alphaMean: number }> {
  return await page.evaluate(async () => {
    const mv = (window as any).__mv;
    const png = mv.engine.engine.export_png();
    const blob = new Blob([png], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const img: HTMLImageElement = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const cx = c.getContext("2d")!; cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    // Position-WEIGHTED checksum: sensitive to both value changes AND pixel
    // permutations (flips/reorders). A plain sum is permutation-invariant and
    // nearly conserved by averaging filters, so it would miss those.
    let s = 0, chk = 0, alpha = 0;
    for (let i = 0; i < d.length; i += 4) {
      const p = (i >> 2) + 1;
      s += d[i] + d[i + 1] + d[i + 2]; alpha += d[i + 3];
      chk = (chk + p * (d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7 + d[i + 3] * 11)) % 2147483647;
    }
    URL.revokeObjectURL(url);
    return { mean: s / (d.length / 4 * 3), chk, w: c.width, h: c.height, alphaMean: alpha / (d.length / 4) };
  });
}

/** Convenience: current layer count. */
export async function layerCount(page: Page): Promise<number> {
  return await page.evaluate(() => (window as any).__mv.engine.engine.layer_count());
}

/** Run a function with the __mv object in the page; returns its result. */
export async function withMv<T>(page: Page, fn: string): Promise<T> {
  return await page.evaluate((src) => {
    const mv = (window as any).__mv;
    // eslint-disable-next-line no-new-func
    return new Function("mv", "E", `return (${src})(mv, mv.engine.engine);`)(mv, mv.engine.engine);
  }, fn);
}

/** A tiny standards-shaped linear DNG that rawloader can decode. Building this
 * fixture in code lets RAW cases (Camera Raw lifecycle, Batch) exercise the
 * real RAW decoder without depending on a large or licensed camera sample. */
/** A minimal uncompressed 16-bit RGGB mosaic DNG (#443). `rgbAt` gives each
 *  pixel's linear camera RGB in 0..1; the CFA keeps one channel per site. The
 *  colour matrix and neutral match tinyLinearDng's. */
export function tinyCfaDng(width: number, height: number, rgbAt: (x: number, y: number) => [number, number, number]): Uint8Array {
  const make = "Monet", model = "Vision E2E";
  const entryCount = 22;
  const ifdEnd = 8 + 2 + entryCount * 12 + 4;
  const pool: number[] = [];
  const push32 = (out: number[], value: number) => {
    out.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
  };
  const append = (bytes: readonly number[]) => {
    if ((ifdEnd + pool.length) & 1) pool.push(0);
    const offset = ifdEnd + pool.length;
    pool.push(...bytes);
    return offset;
  };
  const ascii = (value: string) => append([...value].map((character) => character.charCodeAt(0)).concat(0));
  const makeOffset = ascii(make);
  const modelOffset = ascii(model);
  const matrix: number[] = [];
  for (const value of [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.204, 1.057]) {
    push32(matrix, Math.round(value * 1_000_000) >>> 0);
    push32(matrix, 1_000_000);
  }
  const matrixOffset = append(matrix);
  const neutral: number[] = [];
  for (let i = 0; i < 3; i++) { push32(neutral, 1); push32(neutral, 1); }
  const neutralOffset = append(neutral);
  if ((ifdEnd + pool.length) & 1) pool.push(0);
  const imageOffset = ifdEnd + pool.length;
  const imageByteLength = width * height * 2;
  const le32 = (value: number) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
  const short = (value: number) => [value & 255, (value >>> 8) & 255, 0, 0];
  const entries: Array<[number, number, number, number[]]> = [
    [254, 4, 1, le32(0)], [256, 4, 1, le32(width)], [257, 4, 1, le32(height)],
    [258, 3, 1, short(16)], [259, 3, 1, short(1)], [262, 3, 1, short(32803)],
    [271, 2, make.length + 1, le32(makeOffset)], [272, 2, model.length + 1, le32(modelOffset)],
    [273, 4, 1, le32(imageOffset)], [277, 3, 1, short(1)], [278, 4, 1, le32(height)],
    [279, 4, 1, le32(imageByteLength)], [284, 3, 1, short(1)],
    [33421, 3, 2, [2, 0, 2, 0]], [33422, 1, 4, [0, 1, 1, 2]],
    [50706, 1, 4, [1, 4, 0, 0]], [50707, 1, 4, [1, 1, 0, 0]],
    [50708, 2, model.length + 1, le32(modelOffset)], [50717, 4, 1, le32(65535)],
    [50721, 10, 9, le32(matrixOffset)], [50728, 5, 3, le32(neutralOffset)], [50778, 3, 1, short(21)],
  ];
  const out = new Uint8Array(imageOffset + imageByteLength);
  const view = new DataView(out.buffer);
  out.set([0x49, 0x49], 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, entryCount, true);
  let cursor = 10;
  for (const [tag, type, count, value] of entries) {
    view.setUint16(cursor, tag, true);
    view.setUint16(cursor + 2, type, true);
    view.setUint32(cursor + 4, count, true);
    out.set(value, cursor + 8);
    cursor += 12;
  }
  view.setUint32(cursor, 0, true);
  out.set(pool, ifdEnd);
  cursor = imageOffset;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // RGGB: red on even/even, blue on odd/odd, green elsewhere.
    const channel = (y & 1) === 0 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 1 : 2);
    view.setUint16(cursor, Math.round(rgbAt(x, y)[channel] * 60_000), true);
    cursor += 2;
  }
  return out;
}

/** A DNG camera profile (.dcp: a TIFF with magic 0x4352) for `model`: the
 *  tiny DNG's own ColorMatrix plus a hue × sat × val HueSatMap (6 × 2 × 1 by
 *  default) turning every hue by `hueShift` degrees, so selecting it visibly
 *  re-renders. 90 × 32 × 32 makes it Adobe-sized (~1.1 MB). */
export function tinyDcp(model: string, name: string, hueShift: number, dims: [number, number, number] = [6, 2, 1]): Uint8Array {
  const le16 = (value: number) => [value & 255, (value >>> 8) & 255];
  const le32 = (value: number) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
  const ascii = (value: string) => [...value].map((character) => character.charCodeAt(0)).concat(0);
  const matrix = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.204, 1.057];
  const cells = Array.from({ length: dims[0] * dims[1] * dims[2] }, () => [hueShift, 1, 1]).flat();
  const tags: Array<[number, number, number, number[]]> = [
    [50708, 2, model.length + 1, ascii(model)], // UniqueCameraModel
    [50721, 10, 9, matrix.flatMap((value) => [...le32(Math.round(value * 1_000_000) >>> 0), ...le32(1_000_000)])], // ColorMatrix1
    [50778, 3, 1, le16(21)], // CalibrationIlluminant1 = D65
    [50936, 2, name.length + 1, ascii(name)], // ProfileName
    [50937, 4, 3, dims.flatMap(le32)], // ProfileHueSatMapDims
    [50938, 11, cells.length, [...new Uint8Array(new Float32Array(cells).buffer)]], // ProfileHueSatMapData1
  ];
  const ifdEnd = 8 + 2 + tags.length * 12 + 4;
  const head = [0x49, 0x49, ...le16(0x4352), ...le32(8), ...le16(tags.length)];
  const pool: number[] = [];
  for (const [tag, type, count, bytes] of tags) {
    head.push(...le16(tag), ...le16(type), ...le32(count));
    if (bytes.length <= 4) head.push(...bytes, ...new Array(4 - bytes.length).fill(0));
    else {
      if (pool.length & 1) pool.push(0);
      head.push(...le32(ifdEnd + pool.length));
      for (const byte of bytes) pool.push(byte); // spreading ~1 MB overflows the stack
    }
  }
  head.push(...le32(0));
  const out = new Uint8Array(head.length + pool.length);
  out.set(head);
  out.set(pool, head.length);
  return out;
}

export function tinyLinearDng(seed = 0, width = 8, height = 6): Uint8Array {
  const make = "Monet", model = "Vision E2E";
  const entryCount = 20;
  const ifdEnd = 8 + 2 + entryCount * 12 + 4;
  const pool: number[] = [];
  const push32 = (out: number[], value: number) => {
    out.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
  };
  const append = (bytes: readonly number[]) => {
    if ((ifdEnd + pool.length) & 1) pool.push(0);
    const offset = ifdEnd + pool.length;
    pool.push(...bytes);
    return offset;
  };
  const ascii = (value: string) => append([...value].map((character) => character.charCodeAt(0)).concat(0));
  const bitsOffset = append([16, 0, 16, 0, 16, 0]);
  const makeOffset = ascii(make);
  const modelOffset = ascii(model);
  const matrix: number[] = [];
  for (const value of [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.204, 1.057]) {
    push32(matrix, Math.round(value * 1_000_000) >>> 0);
    push32(matrix, 1_000_000);
  }
  const matrixOffset = append(matrix);
  const neutral: number[] = [];
  for (let i = 0; i < 3; i++) { push32(neutral, 1); push32(neutral, 1); }
  const neutralOffset = append(neutral);
  if ((ifdEnd + pool.length) & 1) pool.push(0);
  const imageOffset = ifdEnd + pool.length;
  const imageByteLength = width * height * 3 * 2;
  const le32 = (value: number) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
  const short = (value: number) => [value & 255, (value >>> 8) & 255, 0, 0];
  const entries: Array<[number, number, number, number[]]> = [
    [254, 4, 1, le32(0)], [256, 4, 1, le32(width)], [257, 4, 1, le32(height)],
    [258, 3, 3, le32(bitsOffset)], [259, 3, 1, short(1)], [262, 3, 1, short(34892)],
    [271, 2, make.length + 1, le32(makeOffset)], [272, 2, model.length + 1, le32(modelOffset)],
    [273, 4, 1, le32(imageOffset)], [277, 3, 1, short(3)], [278, 4, 1, le32(height)],
    [279, 4, 1, le32(imageByteLength)], [284, 3, 1, short(1)],
    [50706, 1, 4, [1, 4, 0, 0]], [50707, 1, 4, [1, 1, 0, 0]],
    [50708, 2, model.length + 1, le32(modelOffset)], [50717, 4, 1, le32(65535)],
    [50721, 10, 9, le32(matrixOffset)], [50728, 5, 3, le32(neutralOffset)], [50778, 3, 1, short(21)],
  ];
  const out = new Uint8Array(imageOffset + imageByteLength);
  const view = new DataView(out.buffer);
  out.set([0x49, 0x49], 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, entryCount, true);
  let cursor = 10;
  for (const [tag, type, count, value] of entries) {
    view.setUint16(cursor, tag, true);
    view.setUint16(cursor + 2, type, true);
    view.setUint32(cursor + 4, count, true);
    out.set(value, cursor + 8);
    cursor += 12;
  }
  view.setUint32(cursor, 0, true);
  out.set(pool, ifdEnd);
  cursor = imageOffset;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const values = [
      8_000 + ((x * 6_000 + seed * 997) % 50_000),
      6_000 + ((y * 8_000 + seed * 577) % 50_000),
      10_000 + (((x + y) * 4_000 + seed * 313) % 45_000),
    ];
    for (const value of values) { view.setUint16(cursor, value, true); cursor += 2; }
  }
  return out;
}
