// ─────────────────────────────────────────────────────────────
// commands-rasterize.test — Object ▸ Rasterize (command)
// ─────────────────────────────────────────────────────────────
// commands.rasterize captures the selection as a PNG (svgToPngDataURL, mocked here
// since jsdom has no real canvas) then replaces it with an embedded image in one
// undoable step; it is a guarded no-op (no dirty) with an empty selection.

import { describe, it, expect, vi } from "vitest";

vi.mock("./io/files", () => ({
  svgToPngDataURL: vi.fn(async () => "data:image/png;base64,STUBPNG"),
}));

import { commands } from "./commands";
import { svgToPngDataURL } from "./io/files";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const RED = rgba(220, 0, 0);
const withRect = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(10, 20, 40, 40, 0, 0, { fill: solid(RED) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  return { store, r };
};

describe("commands.rasterize", () => {
  it("replaces the selection with an embedded PNG image in one undoable step", async () => {
    const { store, r } = withRect();
    store.setSelection([r.id]);
    await commands.rasterize(store);
    const items = store.getState().doc.layers[0].items;
    expect(items.length).toBe(1);
    const img = items[0];
    expect(img.type).toBe("image");
    if (img.type === "image") expect(img.href).toBe("data:image/png;base64,STUBPNG");
    expect(Query.getItem(store.getState().doc, r.id)).toBeNull(); // original consumed
    expect(store.getState().selection).toEqual([img.id]); // new image selected
    store.undo();
    expect(Query.getItem(store.getState().doc, r.id)).toBeTruthy(); // restored
  });

  it("is a no-op (no dirty) with an empty selection", async () => {
    const { store } = withRect(); // nothing selected
    await commands.rasterize(store);
    expect(store.getState().dirty).toBe(false);
  });

  it("leaves the artwork untouched when rasterization fails (no canvas)", async () => {
    const { store, r } = withRect();
    store.setSelection([r.id]);
    vi.mocked(svgToPngDataURL).mockRejectedValueOnce(new Error("no canvas"));
    await commands.rasterize(store);
    const items = store.getState().doc.layers[0].items;
    expect(items.length).toBe(1);
    expect(items[0].type).toBe("rect"); // original rect, not replaced by an image
    expect(Query.getItem(store.getState().doc, r.id)).toBeTruthy();
    expect(store.getState().dirty).toBe(false);
  });
});
