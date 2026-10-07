import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Note tool (annotations) ──────────────────────────────
// Adobe spec (helpx "Metadata and notes" + tutorials): the Note tool drops a
// small non-printing icon tied to a location on the image; the Notes panel edits
// its text. Options bar carries an Author (stamped on new notes) and Clear All;
// View ▸ Show ▸ Notes toggles visibility. Click adds, clicking a note selects it,
// dragging moves it, Alt-click deletes one.
//   https://helpx.adobe.com/photoshop/using/metadata-notes.html

const DOCW = 200;
const DOCH = 140;

async function scene(page: Page): Promise<{ cx: (d: number) => number; cy: (d: number) => number }> {
  await gotoApp(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(w, h, "notes");
    const E = mv.engine.engine;
    E.select_rect(0, 0, w, h, 0); E.fill_selection(220, 220, 220, 255); E.select_none();
    mv.engine.commit();
    mv.store.setTool("note");
    mv.store.fit();
  }, { w: DOCW, h: DOCH });
  await page.waitForFunction(() => (window as any).__mv.store.state.zoom > 1.2, null, { timeout: 5000 });
  const box = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { cx: (d: number) => box.x + d * box.w / DOCW, cy: (d: number) => box.y + d * box.h / DOCH };
}

const notesState = (page: Page): Promise<{ id: number; x: number; y: number; text: string; author: string }[]> =>
  page.evaluate(() => (window as any).__mv.store.state.notes);
const activeId = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__mv.store.state.activeNoteId);

async function runExactCommand(page: Page, label: string) {
  await page.waitForFunction((exact) =>
    (window as any).__mv.commandPalette?.items?.some((item: any) => item.label === exact), label, { timeout: 5000 });
  await page.evaluate((exact) =>
    (window as any).__mv.commandPalette.items.find((item: any) => item.label === exact).run(), label);
}

test("the Note tool is selectable via the Analyze menu action", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.setTool("note"));
  expect(await page.evaluate(() => (window as any).__mv.store.state.tool)).toBe("note");
});

test("File ▸ Import ▸ Notes imports FDF annotations into the active document", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(200, 140, "imported notes");
    mv.store.markActiveSaved();
  });
  const fdf = String.raw`%FDF-1.2
1 0 obj
<< /FDF << /Annots [
  << /Type /Annot /Subtype /Text /Page 0 /Rect [10 100 20 110]
     /Contents (Check \(edge\)) /T (Ada) >>
  << /Type /Annot /Subtype /Text /Page 0 /Rect [50 20 60 30]
     /Contents (Second note) /T (Lin) >>
] >> >>
endobj
%%EOF`;

  const chooserPromise = page.waitForEvent("filechooser");
  await runExactCommand(page, "File ▸ Import ▸ Notes…");
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "review.fdf", mimeType: "application/vnd.fdf", buffer: Buffer.from(fdf) });
  await expect.poll(() => notesState(page)).toHaveLength(2);

  const state = await page.evaluate(() => {
    const mv = (window as any).__mv;
    return {
      notes: mv.store.state.notes,
      active: mv.store.state.activeNoteId,
      next: mv.store.state.nextNoteId,
      visible: mv.store.state.showNotes,
      dirty: mv.store.docDirty(mv.store.state.activeDocId),
    };
  });
  expect(state).toEqual({
    notes: [
      { id: 1, x: 10, y: 30, text: "Check (edge)", author: "Ada" },
      { id: 2, x: 50, y: 110, text: "Second note", author: "Lin" },
    ],
    active: 2,
    next: 3,
    visible: true,
    dirty: true,
  });

  expect(await page.evaluate(() => {
    const mv = (window as any).__mv;
    const saved = mv.store.saveProject();
    mv.store.openProject(saved, "imported-notes-roundtrip.mvision");
    return mv.store.state.notes;
  })).toEqual(state.notes);
});

test("clicking the canvas adds a note icon and selects it", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(40), m.cy(40));
  const notes = await notesState(page);
  expect(notes).toHaveLength(1);
  expect(await activeId(page)).toBe(notes[0].id);
  await expect(page.locator("[data-mv-notes]")).toHaveAttribute("data-mv-notes", "1");
});

test("clicking an existing note selects it instead of adding one", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(40), m.cy(40));
  await page.mouse.click(m.cx(150), m.cy(110));
  const notes = await notesState(page);
  expect(notes).toHaveLength(2);
  expect(await activeId(page)).toBe(notes[1].id); // the 2nd is active
  await page.mouse.click(m.cx(40), m.cy(40));      // click back on the 1st
  expect(await notesState(page)).toHaveLength(2);   // no new note
  expect(await activeId(page)).toBe(notes[0].id);   // 1st is now active
});

test("the options-bar Author is stamped on newly created notes", async ({ page }) => {
  const m = await scene(page);
  await page.fill("#mv-note-author", "Dal");
  expect(await page.evaluate(() => (window as any).__mv.store.state.noteAuthor)).toBe("Dal");
  await page.mouse.click(m.cx(60), m.cy(60));
  expect((await notesState(page))[0].author).toBe("Dal");
});

test("the Notes panel edits text two-way with the store", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(60), m.cy(60));
  await page.locator('[data-tab-id="notes"]').click(); // surface the Notes panel
  // type in the panel → store updates
  await page.fill("#mv-note-text", "fix the highlights here");
  expect((await notesState(page))[0].text).toBe("fix the highlights here");
  // store update → panel reflects it
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setNoteText(mv.store.state.activeNoteId, "from store");
  });
  await expect(page.locator("#mv-note-text")).toHaveValue("from store");
});

test("the panel Delete button removes the active note", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(50), m.cy(50));
  await page.mouse.click(m.cx(150), m.cy(110));
  await page.locator('[data-tab-id="notes"]').click();
  await page.locator("[data-mv-notes-panel]").getByRole("button", { name: "Delete" }).click();
  expect(await notesState(page)).toHaveLength(1);
});

test("Alt-clicking a note deletes it; the options-bar Clear All empties them", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(40), m.cy(40));
  await page.mouse.click(m.cx(120), m.cy(90));
  expect(await notesState(page)).toHaveLength(2);
  await page.keyboard.down("Alt");
  await page.mouse.click(m.cx(40), m.cy(40)); // on the first note
  await page.keyboard.up("Alt");
  expect(await notesState(page)).toHaveLength(1);
  await page.getByRole("button", { name: "Clear All" }).click();
  expect(await notesState(page)).toHaveLength(0);
});

test("dragging a note moves it", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(50), m.cy(50));
  await page.mouse.move(m.cx(50), m.cy(50));
  await page.mouse.down();
  await page.mouse.move(m.cx(130), m.cy(100), { steps: 6 });
  await page.mouse.up();
  const notes = await notesState(page);
  expect(notes).toHaveLength(1); // moved, not added
  expect(Math.abs(notes[0].x - 130)).toBeLessThan(4);
  expect(Math.abs(notes[0].y - 100)).toBeLessThan(4);
});

test("View ▸ Show ▸ Notes toggles the on-canvas icons", async ({ page }) => {
  const m = await scene(page);
  await page.mouse.click(m.cx(60), m.cy(60));
  await expect(page.locator("[data-mv-notes]")).toHaveCount(1);
  await page.evaluate(() => (window as any).__mv.store.toggleShowNotes());
  await expect(page.locator("[data-mv-notes]")).toHaveCount(0);
  await page.evaluate(() => (window as any).__mv.store.toggleShowNotes());
  await expect(page.locator("[data-mv-notes]")).toHaveCount(1);
});

test("note positions are clamped to the canvas", async ({ page }) => {
  await scene(page);
  await page.evaluate(({ w, h }) => {
    const mv = (window as any).__mv;
    const id = mv.store.addNote(-40, -40);
    mv.store.addNote(w + 500, h + 500);
    mv.store.moveNote(id, w + 99, -20);
  }, { w: DOCW, h: DOCH });
  const notes = await notesState(page);
  expect(notes[0]).toMatchObject({ x: DOCW - 1, y: 0 });
  expect(notes[1]).toMatchObject({ x: DOCW - 1, y: DOCH - 1 });
});

test("notes are per-document metadata and persist through .mvision save/open", async ({ page }) => {
  await gotoApp(page);
  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(100, 80, "notes-a");
    mv.store.markActiveSaved();
    const docA = mv.store.state.activeDocId;
    const cleanBefore = mv.store.docDirty(docA);
    mv.store.setNoteAuthor("Dal");
    const firstId = mv.store.addNote(12.4, 14.6);
    mv.store.setNoteText(firstId, "check highlight");
    const dirtyAfterNote = mv.store.docDirty(docA);

    mv.store.newDocument(120, 90, "notes-b");
    const docB = mv.store.state.activeDocId;
    const notesInNewDoc = mv.store.state.notes.slice();
    mv.store.activateDoc(docA);
    const notesAfterReturn = mv.store.state.notes.slice();
    mv.store.activateDoc(docB);
    const notesAfterSecondReturn = mv.store.state.notes.slice();

    mv.store.activateDoc(docA);
    const saved = mv.store.saveProject();
    mv.store.openProject(saved, "notes-roundtrip.mvision");
    const restored = mv.store.state.notes.slice();
    const restoredActive = mv.store.state.activeNoteId;
    const restoredNext = mv.store.state.nextNoteId;
    const secondId = mv.store.addNote(50, 60);

    return {
      cleanBefore,
      dirtyAfterNote,
      firstId,
      notesInNewDoc,
      notesAfterReturn,
      notesAfterSecondReturn,
      restored,
      restoredActive,
      restoredNext,
      secondId,
    };
  });

  expect(result.cleanBefore).toBe(false);
  expect(result.dirtyAfterNote).toBe(true);
  expect(result.notesInNewDoc).toEqual([]);
  expect(result.notesAfterReturn).toEqual([{ id: result.firstId, x: 12, y: 15, text: "check highlight", author: "Dal" }]);
  expect(result.notesAfterSecondReturn).toEqual([]);
  expect(result.restored).toEqual([{ id: result.firstId, x: 12, y: 15, text: "check highlight", author: "Dal" }]);
  expect(result.restoredActive).toBe(result.firstId);
  expect(result.restoredNext).toBe(result.firstId + 1);
  expect(result.secondId).toBe(result.firstId + 1);
});
