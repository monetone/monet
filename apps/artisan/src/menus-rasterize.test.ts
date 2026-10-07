// ─────────────────────────────────────────────────────────────
// menus-rasterize.test — Object ▸ Rasterize menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Object ▸ Rasterize exists, gates on a selection, and runs the command
// end-to-end (menu → command → op → document). svgToPngDataURL is mocked since
// jsdom has no real canvas.

import { describe, it, expect, vi } from "vitest";

vi.mock("./io/files", () => ({
  svgToPngDataURL: vi.fn(async () => "data:image/png;base64,MENUSTUB"),
}));

import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";
import type { MenuItemDef } from "@monet-ui/monet-react";

type Entry = { id?: string; label?: string; disabled?: boolean; action?: () => void; items?: MenuItemDef[] };
const findById = (entries: Entry[], id: string): Entry | null => {
  for (const e of entries) {
    if (e.id === id) return e;
    if (e.items) {
      const f = findById(e.items as Entry[], id);
      if (f) return f;
    }
  }
  return null;
};

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(10, 20, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const item = (store: ArtisanStore) => findById(buildMenus(store, store.getState()) as unknown as Entry[], "rasterize");

describe("menus — Object ▸ Rasterize", () => {
  it("exposes Object ▸ Rasterize, enabled with a selection", () => {
    const { store } = setup();
    const it = item(store);
    expect(it).toBeTruthy();
    expect(it!.label).toBe("Rasterize");
    expect(it!.disabled).toBeFalsy();
  });

  it("is disabled with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(item(store)!.disabled).toBe(true);
  });

  it("runs menu → command → op, replacing the selection with an image", async () => {
    const { store } = setup();
    await (item(store)!.action!() as unknown as Promise<void>);
    const items = store.getState().doc.layers[0].items;
    expect(items.length).toBe(1);
    expect(items[0].type).toBe("image");
  });
});
