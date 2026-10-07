import { test, expect, type Page } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";

// ── In-place (on-canvas) text editing ──────────────────────────
// Creating a type layer (Type-tool click / New Text Layer) or double-clicking
// one opens an editable caret *on the canvas*, positioned over the text, not a
// field in the options bar. Typing updates the layer live; Escape or clicking
// elsewhere commits. The editor is a transparent <textarea> (.mv-text-edit)
// overlaid on the live engine glyphs.

const EDITOR = ".mv-text-edit";

/** Plain text of the active layer's type spec (or null if not a type layer). */
async function activeText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const mv = (window as any).__mv;
    const id = mv.store.state.activeLayerId;
    const s = mv.text.get(id);
    return s ? mv.text.fullText(s) : null;
  });
}

/** Click the centre of the document canvas at screen coords. */
async function canvasBox(page: Page) {
  const b = await page.locator("canvas").first().boundingBox();
  if (!b) throw new Error("no canvas");
  return b;
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page);
  await newScene(page);
});

test("Type-tool click creates a type layer and opens an on-canvas editor", async ({ page }) => {
  const before = await page.evaluate(() => (window as any).__mv.engine.engine.layer_count());
  await page.evaluate(() => (window as any).__mv.store.setTool("text"));
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);

  const editor = page.locator(EDITOR);
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();

  const info = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const id = mv.store.state.activeLayerId;
    return {
      kind: mv.engine.engine.layer_kind(id),
      editingThis: mv.store.state.textEdit?.id === id,
      count: mv.engine.engine.layer_count(),
    };
  });
  expect(info.kind).toBe(2);
  expect(info.editingThis).toBe(true);
  expect(info.count).toBe(before + 1);

  // a fresh layer selects its placeholder, so typing replaces it; the engine
  // text updates live as we type
  await page.keyboard.type("Hello");
  expect(await activeText(page)).toBe("Hello");
});

test("typing tool-shortcut letters edits the text instead of switching tools", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.store.setTool("text"));
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator(EDITOR)).toBeFocused();

  // v=move, b=brush, m=marquee — must NOT switch tools while editing text
  await page.keyboard.type("vbm");
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("text");
  expect(await activeText(page)).toBe("vbm");
});

test("double-clicking a type layer re-opens the editor with its existing text", async ({ page }) => {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    const spec = mv.text.defaultSpec("ABC", { ax: 30, ay: 40, size: 40, color: [255, 255, 255, 255] });
    mv.text.create(spec); // programmatic create does NOT open the editor
  });
  await page.evaluate(() => (window as any).__mv.store.setTool("move"));
  await expect(page.locator(EDITOR)).toHaveCount(0);

  const b = await canvasBox(page);
  await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);

  const editor = page.locator(EDITOR);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("ABC");

  // re-editing places the caret at the end, so typing appends
  await page.keyboard.type("D");
  expect(await activeText(page)).toBe("ABCD");
});

test("editor renders live and commits on Escape, leaving a re-editable type layer", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.store.setTool("text"));
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator(EDITOR)).toBeFocused();

  const blank = await composite(page);
  await page.keyboard.type("Live");
  const typed = await composite(page);
  expect(typed.chk).not.toBe(blank.chk); // the canvas updated live as we typed

  await page.keyboard.press("Escape");
  await expect(page.locator(EDITOR)).toHaveCount(0);

  const after = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const id = mv.store.state.activeLayerId;
    return {
      kind: mv.engine.engine.layer_kind(id),
      text: mv.text.fullText(mv.text.get(id)),
      editing: mv.store.state.textEdit,
    };
  });
  expect(after.kind).toBe(2); // still re-editable type, not rasterized
  expect(after.text).toBe("Live");
  expect(after.editing).toBeNull();
});

test("clicking elsewhere on the canvas commits the edit", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.store.setTool("text"));
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator(EDITOR)).toBeFocused();
  await page.keyboard.type("Hi");

  // Click empty canvas just to the right of the editor (vertically aligned with
  // it, so it is over the document viewport and below the top toolbar). This
  // commits the edit. (The editor's own area would not — its pointer events are
  // stopped — and the toolbar above the canvas does not commit either.)
  const er = (await page.locator(EDITOR).boundingBox())!;
  const cx = Math.min(er.x + er.width + 120, b.x + b.width - 10);
  await page.mouse.click(cx, er.y + er.height / 2);
  await expect(page.locator(EDITOR)).toHaveCount(0);
  expect(await activeText(page)).toBe("Hi");
});

test("a whole in-place typing burst is one undo step, and undo closes the editor", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.store.setTool("text"));
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator(EDITOR)).toBeFocused();
  await page.keyboard.type("Hello");
  expect(await activeText(page)).toBe("Hello");

  // One undo reverts the entire coalesced edit (not one step per character) and
  // dismisses the now-stale editor.
  await page.evaluate(() => (window as any).__mv.store.undo());
  await expect(page.locator(EDITOR)).toHaveCount(0);
  const after = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const id = mv.store.state.activeLayerId;
    return { editing: mv.store.state.textEdit, kind: mv.engine.engine.layer_kind(id) };
  });
  expect(after.editing).toBeNull();
  expect(after.kind).toBe(0); // back to the blank pre-text layer in a single undo
});

test("starting a new document while editing closes the in-place editor", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.store.setTool("text"));
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator(EDITOR)).toBeFocused();
  await page.keyboard.type("Bye");

  await page.evaluate(() => (window as any).__mv.store.newDocument(120, 90, "fresh"));
  await expect(page.locator(EDITOR)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__mv.store.state.textEdit)).toBeNull();
});

test("the on-canvas editor is positioned over the text anchor and scales with zoom", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.store.setTool("text"));
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator(EDITOR)).toBeFocused();
  await page.keyboard.type("Anchor");

  // the editor's screen rect should sit at the spec anchor mapped through the
  // current view transform (pan + zoom), within a tolerance.
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const id = mv.store.state.activeLayerId;
    const spec = mv.text.get(id);
    const el = document.querySelector(".mv-text-edit") as HTMLElement;
    const er = el.getBoundingClientRect();
    const cr = (document.querySelector("canvas") as HTMLElement).getBoundingClientRect();
    const z = mv.store.state.zoom;
    // expected screen-x of the text anchor = canvas-left + ax*zoom
    const expectedX = cr.left + spec.ax * z;
    return { ex: er.left, expectedX, w: er.width };
  });
  expect(Math.abs(r.ex - r.expectedX)).toBeLessThan(4);
  expect(r.w).toBeGreaterThan(0);
});

test("IME composition and international text survive save and reopen", async ({ page }) => {
  await page.evaluate(() => (window as any).__mv.store.setTool("text"));
  const b = await canvasBox(page);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  const editor = page.locator(EDITOR);
  await expect(editor).toBeFocused();

  await editor.evaluate((node) => {
    node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "かな" }));
    node.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true, isComposing: true,
    }));
  });
  await expect(editor).toBeFocused();

  const value = "かな العربية עברית हिन्दी e\u0301 👩🏽‍💻";
  await editor.evaluate((node, text) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setValue.call(node, text);
    node.dispatchEvent(new InputEvent("input", {
      bubbles: true, composed: true, data: text, inputType: "insertCompositionText",
    }));
    node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: text }));
  }, value);
  await expect.poll(() => activeText(page)).toBe(value);

  const result = await page.evaluate((expected) => {
    const mv = (window as any).__mv;
    const id = mv.store.state.activeLayerId;
    const spec = mv.text.get(id);
    mv.text.apply(id, { ...spec, composer: "worldReady", font: '"Monet QA Missing", Arial' });
    mv.store.endTextEdit();
    const hash = () => {
      const bytes = mv.engine.engine.export_png();
      let n = 0;
      for (let i = 0; i < bytes.length; i += 17) n = (n * 33 + bytes[i]) >>> 0;
      return n;
    };
    const before = hash();
    const saved = mv.saveProjectBytes();
    mv.store.openProject(saved, "international-ime-roundtrip.mvision");
    const reopened = mv.text.get(id);
    return {
      expected,
      text: reopened && mv.text.fullText(reopened),
      composer: reopened?.composer,
      font: reopened?.font,
      before,
      after: hash(),
      kind: mv.engine.engine.layer_kind(id),
    };
  }, value);

  expect(result.text).toBe(result.expected);
  expect(result.composer).toBe("worldReady");
  expect(result.font).toBe('"Monet QA Missing", Arial');
  expect(result.kind).toBe(2);
  expect(result.after).toBe(result.before);
});
