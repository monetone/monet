// The OS pasteboard bridge: cross-app Copy/Paste only exists because Copy also
// publishes standard flavours (image/png) on the SYSTEM pasteboard and Paste
// reads them back. Before this, the clipboard was a Rust struct inside wasm and
// no other app — Monet or otherwise — could ever see it.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("./svg", () => ({
  SVG_RE: /\.svgz?$/i,
  svgIntrinsicSize: () => ({ w: 1, h: 1 }),
  withExplicitSize: (t: string) => t,
  svgToPng: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9])),
}));

import { PASTEBOARD_PNG, PASTEBOARD_SVG, PASTEBOARD_TEXT, Store, readPasteboardImage, writePasteboardPng } from "./store";
import { svgToPng } from "./svg";

const OUR_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const FOREIGN_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 7, 7, 7]);

/** A ClipboardItem-shaped stand-in — vitest's node env has no real pasteboard. */
function fakeItem(entries: Record<string, Uint8Array>) {
  return {
    types: Object.keys(entries),
    getType: async (mime: string) => new Blob([entries[mime] as BlobPart], { type: mime }),
  };
}

function fakePasteboard(items: ReturnType<typeof fakeItem>[] = []) {
  const written: { type: string; bytes: Uint8Array }[] = [];
  const board = {
    read: vi.fn(async () => items),
    write: vi.fn(async (list: { type: string; bytes: Uint8Array }[]) => {
      written.push(...list);
    }),
  };
  vi.stubGlobal("navigator", { clipboard: board });
  // Our ClipboardItem stub records what flavour Copy asked for.
  vi.stubGlobal(
    "ClipboardItem",
    class {
      type: string;
      bytes: Promise<Uint8Array>;
      constructor(data: Record<string, Blob>) {
        this.type = Object.keys(data)[0];
        this.bytes = data[this.type].arrayBuffer().then((b) => new Uint8Array(b));
      }
    },
  );
  return { board, written };
}

function fakeEngine(overrides: Record<string, unknown> = {}) {
  return {
    copy: vi.fn(() => true),
    copy_merged: vi.fn(() => true),
    cut: vi.fn(() => true),
    has_clipboard: vi.fn(() => true),
    clipboard_profile: vi.fn(() => 0),
    clipboard_png: vi.fn(() => OUR_PNG),
    set_clipboard_from_image: vi.fn(),
    paste: vi.fn(() => 5),
    paste_in_place: vi.fn(() => 5),
    convert_clipboard_profile_with_icc: vi.fn(() => false),
    ...overrides,
  };
}

function storeWith(eng: ReturnType<typeof fakeEngine>) {
  const client = { onCommit: null, engine: eng, e: eng, docGen: 1, commit: vi.fn(), sync: vi.fn() };
  return new Store(client as never);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("writePasteboardPng", () => {
  it("publishes the standard image/png flavour", async () => {
    const { board, written } = fakePasteboard();
    expect(await writePasteboardPng(OUR_PNG)).toBe(true);
    expect(board.write).toHaveBeenCalledTimes(1);
    expect(written[0].type).toBe(PASTEBOARD_PNG);
    expect(await (written[0] as unknown as { bytes: Promise<Uint8Array> }).bytes).toEqual(OUR_PNG);
  });

  it("never throws when the platform refuses, and skips an empty clipboard", async () => {
    const { board } = fakePasteboard();
    board.write.mockRejectedValueOnce(new Error("NotAllowedError"));
    expect(await writePasteboardPng(OUR_PNG)).toBe(false);
    expect(await writePasteboardPng(new Uint8Array())).toBe(false);
    vi.stubGlobal("navigator", {}); // no pasteboard at all (headless)
    expect(await writePasteboardPng(OUR_PNG)).toBe(false);
  });
});

describe("readPasteboardImage", () => {
  it("prefers SVG over PNG — Artisan publishes both, vector is the better source", async () => {
    fakePasteboard([fakeItem({ [PASTEBOARD_PNG]: OUR_PNG, [PASTEBOARD_SVG]: FOREIGN_PNG })]);
    expect(await readPasteboardImage()).toEqual({ bytes: FOREIGN_PNG, mime: PASTEBOARD_SVG });
  });

  it("reads SVG markup off text/plain — the flavour Artisan and Illustrator publish", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    fakePasteboard([fakeItem({ [PASTEBOARD_TEXT]: svg, [PASTEBOARD_PNG]: FOREIGN_PNG })]);
    expect(await readPasteboardImage()).toEqual({ bytes: svg, mime: PASTEBOARD_SVG });
  });

  it("skips non-image flavours and survives an unreadable pasteboard", async () => {
    fakePasteboard([fakeItem({ [PASTEBOARD_TEXT]: new TextEncoder().encode("just some words") })]);
    expect(await readPasteboardImage()).toBeNull();
    const { board } = fakePasteboard();
    board.read.mockRejectedValueOnce(new Error("NotAllowedError"));
    expect(await readPasteboardImage()).toBeNull();
  });
});

describe("Store Copy → system pasteboard", () => {
  it("mirrors every capture variant onto the pasteboard", async () => {
    const eng = fakeEngine();
    const { board } = fakePasteboard();
    const store = storeWith(eng);
    store.copy();
    store.copyMerged();
    store.cut();
    await Promise.resolve();
    expect(eng.clipboard_png).toHaveBeenCalledTimes(3);
    expect(board.write).toHaveBeenCalledTimes(3);
  });

  it("leaves the in-app clipboard intact when nothing was captured", () => {
    const eng = fakeEngine({ copy: vi.fn(() => false), has_clipboard: vi.fn(() => false) });
    const { board } = fakePasteboard();
    storeWith(eng).copy();
    expect(board.write).not.toHaveBeenCalled();
  });

  it("resyncs after Copy so Paste enablement updates without a document edit", () => {
    const eng = fakeEngine();
    fakePasteboard();
    const client = { onCommit: null, e: eng, commit: vi.fn(), sync: vi.fn() };
    new Store(client as never).copy();
    expect(client.sync).toHaveBeenCalledOnce();
    expect(client.commit).not.toHaveBeenCalled();
  });
});

describe("Store Paste ← system pasteboard", () => {
  it("adopts an image another app copied", async () => {
    const eng = fakeEngine();
    fakePasteboard([fakeItem({ [PASTEBOARD_PNG]: FOREIGN_PNG })]);
    await storeWith(eng).paste();
    expect(eng.set_clipboard_from_image).toHaveBeenCalledWith(FOREIGN_PNG);
    expect(eng.paste).toHaveBeenCalled();
  });

  it("rasterizes an SVG (Artisan → Vision) before handing it to the engine", async () => {
    const eng = fakeEngine();
    const svg = new TextEncoder().encode("<svg/>");
    fakePasteboard([fakeItem({ [PASTEBOARD_SVG]: svg })]);
    await storeWith(eng).paste();
    expect(svgToPng).toHaveBeenCalledWith(svg);
    expect(eng.set_clipboard_from_image).toHaveBeenCalledWith(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9]));
  });

  it("does NOT clobber the richer in-app clip when our own Copy comes back", async () => {
    const eng = fakeEngine();
    fakePasteboard([fakeItem({ [PASTEBOARD_PNG]: OUR_PNG })]);
    const store = storeWith(eng);
    store.copy(); // publishes OUR_PNG
    await store.paste();
    expect(eng.set_clipboard_from_image).not.toHaveBeenCalled();
    expect(eng.paste).toHaveBeenCalled();
  });

  it("still pastes the in-app clip when the pasteboard is empty or denied", async () => {
    const eng = fakeEngine();
    const { board } = fakePasteboard();
    board.read.mockRejectedValueOnce(new Error("NotAllowedError"));
    await storeWith(eng).paste();
    expect(eng.set_clipboard_from_image).not.toHaveBeenCalled();
    expect(eng.paste).toHaveBeenCalled();
  });

  it("installs the 16-bit window clip into another document when our PNG echoes back (#547)", async () => {
    const pixels = new Uint16Array(2 * 2 * 4).fill(40000);
    const source = fakeEngine({
      clipboard_geometry: vi.fn(() => [2, 2, 3, 4, 0]),
      clipboard_pixels: vi.fn(() => pixels),
    });
    const target = fakeEngine({
      install_clipboard: vi.fn(() => true),
    });
    const { board } = fakePasteboard([fakeItem({ [PASTEBOARD_PNG]: OUR_PNG })]);
    const client = { onCommit: null, engine: source, e: source, docGen: 1, commit: vi.fn(), sync: vi.fn(), onEditError: vi.fn() };
    const store = new Store(client as never);
    store.copy();
    await vi.waitFor(() => expect(board.write).toHaveBeenCalled());
    await Promise.resolve();
    client.engine = target;
    client.e = target;
    await store.paste();
    expect(target.install_clipboard).toHaveBeenCalledTimes(1);
    const installed = target.install_clipboard.mock.calls[0];
    expect(installed.slice(0, 5)).toEqual([2, 2, 3, 4, 0]);
    expect(installed[5]).toEqual(pixels);
    expect(target.set_clipboard_from_image).not.toHaveBeenCalled();
    expect(target.paste).toHaveBeenCalled();
  });

  it("treats our PNG as foreign when the pasteboard write was refused (#547)", async () => {
    const eng = fakeEngine();
    const { board } = fakePasteboard([fakeItem({ [PASTEBOARD_PNG]: OUR_PNG })]);
    board.write.mockRejectedValueOnce(new Error("NotAllowedError"));
    const store = storeWith(eng);
    store.copy();
    await vi.waitFor(() => expect(board.write).toHaveBeenCalled());
    await Promise.resolve();
    await store.paste();
    expect(eng.set_clipboard_from_image).toHaveBeenCalledWith(OUR_PNG);
    expect(eng.paste).toHaveBeenCalled();
  });

  it("reports nothing to paste when the engine clip and the window clip are both empty (#547)", async () => {
    const eng = fakeEngine({ has_clipboard: vi.fn(() => false) });
    fakePasteboard();
    const onEditError = vi.fn();
    const client = { onCommit: null, engine: eng, e: eng, docGen: 1, commit: vi.fn(), sync: vi.fn(), onEditError };
    await new Store(client as never).paste();
    expect(eng.paste).not.toHaveBeenCalled();
    expect(eng.set_clipboard_from_image).not.toHaveBeenCalled();
    expect(onEditError).toHaveBeenCalledWith("Nothing to paste.");
  });

  it("does not paste stale pixels when a foreign image fails to decode", async () => {
    const eng = fakeEngine({
      set_clipboard_from_image: vi.fn(() => {
        throw new Error("clipboard decode failed");
      }),
    });
    fakePasteboard([fakeItem({ [PASTEBOARD_PNG]: FOREIGN_PNG })]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await storeWith(eng).paste();
    expect(err).toHaveBeenCalled();
    expect(eng.paste).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("Paste profile conversion", () => {
  it.each([[0, false], [3, true]])("converts with Color Settings' intent %i and Black Point Compensation %s", async (intent, blackPointCompensation) => {
    // An Adobe RGB clip pasted into an sRGB document under "Convert to Document RGB".
    const eng = fakeEngine({ clipboard_profile: vi.fn(() => 2) });
    fakePasteboard();
    const store = storeWith(eng);
    const prefs = { ...store.state.colorPolicyPrefs, pasteProfilePolicy: "convert", intent, blackPointCompensation };
    (store as unknown as { set(patch: object): void }).set({ colorPolicyPrefs: prefs });
    await store.paste();
    expect(eng.convert_clipboard_profile_with_icc).toHaveBeenCalledTimes(1);
    expect(eng.convert_clipboard_profile_with_icc.mock.calls[0].slice(4)).toEqual([intent, blackPointCompensation]);
  });
});
