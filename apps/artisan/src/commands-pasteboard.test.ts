// ─────────────────────────────────────────────────────────────
// commands-pasteboard.test — Copy / Paste across the OS pasteboard
// ─────────────────────────────────────────────────────────────
// The in-app clipboard is a module-level array no other process can see, so
// Copy here used to be invisible to Vision, Illustrator and Figma. Copy now
// also publishes STANDARD flavours (SVG markup as text/plain + image/png) and
// a focus pull adopts whatever another app left on the pasteboard.

import { describe, it, expect, vi, afterEach } from "vitest";
import { commands, adoptPasteboardArtwork } from "./commands";
import { ArtisanStore, makeDocument, makeRect, rgba, solid } from "./engine";

vi.mock("./io/files", () => ({
  // A 1×1 transparent PNG — the real rasterizer needs a canvas.
  svgToPngDataURL: vi.fn(async () => "data:image/png;base64,iVBORw0KGgo="),
}));

// The SVG parser itself is covered by the io/import/svg suite and needs a DOM;
// here we only care that pasteboard SVG reaches it and its items land in the
// clipboard. `null` stands for "not artwork", which importSVG signals by throwing.
const svgImport = vi.hoisted(() => ({ result: null as { layers: { items: unknown[] }[] } | null }));
vi.mock("./io/import/svg", () => ({
  importSVG: vi.fn(() => {
    if (!svgImport.result) throw new Error("Not an SVG document");
    return svgImport.result;
  }),
}));

const items = (store: ArtisanStore) => store.getState().doc.layers[0].items;

function setup() {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(50, 50, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, id: r.id };
}

function fakeItem(entries: Record<string, string | Uint8Array>) {
  return {
    types: Object.keys(entries),
    getType: async (mime: string) => {
      const v = entries[mime];
      return new Blob([(typeof v === "string" ? v : (v as BlobPart)) as BlobPart], { type: mime });
    },
  };
}

function fakePasteboard(read: ReturnType<typeof fakeItem>[] = []) {
  const written: { parts: Record<string, Blob> }[] = [];
  vi.stubGlobal("navigator", {
    clipboard: {
      read: vi.fn(async () => read),
      write: vi.fn(async (list: { parts: Record<string, Blob> }[]) => void written.push(...list)),
    },
  });
  vi.stubGlobal(
    "ClipboardItem",
    class {
      parts: Record<string, Blob>;
      constructor(data: Record<string, Blob>) {
        this.parts = data;
      }
    },
  );
  return written;
}

const FOREIGN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">' +
  '<rect x="1" y="1" width="8" height="8" fill="#00f"/></svg>';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  svgImport.result = null;
});

describe("Copy → system pasteboard", () => {
  it("publishes SVG markup as text/plain plus a rendered image/png", async () => {
    const written = fakePasteboard();
    const { store } = setup();
    commands.copy(store);
    await vi.waitFor(() => expect(written).toHaveLength(1));
    const parts = written[0].parts;
    expect(Object.keys(parts).sort()).toEqual(["image/png", "text/plain"]);
    expect(await parts["text/plain"].text()).toMatch(/^<svg /);
  });

  it("publishes nothing when the selection is empty", async () => {
    const written = fakePasteboard();
    const { store } = setup();
    store.setSelection([]);
    commands.copy(store);
    await Promise.resolve();
    expect(written).toHaveLength(0);
  });
});

describe("adoptPasteboardArtwork", () => {
  it("imports SVG another app copied, so ⌘V pastes real vector artwork", async () => {
    svgImport.result = { layers: [{ items: [makeRect(1, 1, 8, 8, 0, 0, { fill: solid(rgba(0, 0, 255)) })] }] };
    fakePasteboard([fakeItem({ "text/plain": FOREIGN_SVG })]);
    const { store, id } = setup();
    expect(await adoptPasteboardArtwork()).toBe(true);
    commands.paste(store);
    const list = items(store);
    expect(list).toHaveLength(2);
    expect(list.find((i) => i.id !== id)!.type).toBe("rect");
  });

  it("wraps a foreign bitmap in an image item", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
    fakePasteboard([fakeItem({ "image/png": png })]);
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 64;
      naturalHeight = 32;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    });
    const { store, id } = setup();
    expect(await adoptPasteboardArtwork()).toBe(true);
    commands.paste(store);
    const pasted = items(store).find((i) => i.id !== id)!;
    expect(pasted.type).toBe("image");
    if (pasted.type !== "image") throw new Error();
    expect([pasted.width, pasted.height]).toEqual([64, 32]);
    expect(pasted.href.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("keeps the richer in-app items when our own Copy comes back", async () => {
    const written = fakePasteboard();
    const { store } = setup();
    commands.copy(store);
    await vi.waitFor(() => expect(written).toHaveLength(1));
    const ourSvg = await written[0].parts["text/plain"].text();
    fakePasteboard([fakeItem({ "text/plain": ourSvg, "image/png": new Uint8Array([1]) })]);
    expect(await adoptPasteboardArtwork()).toBe(false);
  });

  it("ignores plain text and survives a denied pasteboard", async () => {
    fakePasteboard([fakeItem({ "text/plain": "just some words" })]);
    expect(await adoptPasteboardArtwork()).toBe(false);
    vi.stubGlobal("navigator", {}); // headless / no pasteboard at all
    expect(await adoptPasteboardArtwork()).toBe(false);
  });
});
