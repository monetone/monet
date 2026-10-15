// Regressions whose dialogs and panels cannot be imported in the node unit
// run (they pull the WASM engine through app.ts). The pure helpers are called.
// The source slices prove the shipped component calls those helpers.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commitOwnedEdit } from "./ownedDocumentEdit";
import { LayerCompSessions, type LayerComp } from "../state/layerComps";
import { hdrPreviewOnDismiss, type HdrPreviewSettings } from "../state/hdrPreview";
import { presentCameraRawFrame } from "../state/splitBeforeAfter";
import { viewToggleCheckedIds } from "./psMenus";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const snapshot = (name: string): LayerComp => ({
  name,
  layers: [{ id: 1, visible: true, opacity: 100, blendMode: "normal" }],
});

describe("commitOwnedEdit", () => {
  it("closes without applying when the document changed, and applies then closes when it did not", () => {
    const order: string[] = [];
    expect(commitOwnedEdit(1, 2, () => order.push("apply"), () => order.push("close"))).toBe(false);
    expect(order).toEqual(["close"]);
    expect(commitOwnedEdit(2, 2, () => order.push("apply"), () => order.push("close"))).toBe(true);
    expect(order).toEqual(["close", "apply", "close"]);
  });

  it("is what Image Size and Rename Layer call with the id captured at open", () => {
    const dialogs = read("./Dialogs.tsx");
    const rename = dialogs.slice(dialogs.indexOf("function RenameLayer"), dialogs.indexOf("function NewLayer"));
    const image = dialogs.slice(dialogs.indexOf("function ImageSize"), dialogs.indexOf("function ImageSize") + 7000);
    expect(rename).toContain("const ownerDocId = useRef(store.state.activeDocId).current;");
    expect(rename).toContain(
      "commitOwnedEdit(ownerDocId, store.state.activeDocId, () => { if (n) store.renameLayer(ownerLayerId, n); }, close)",
    );
    expect(image).toContain("const ownerDocId = useRef(store.state.activeDocId).current;");
    expect(image).toContain(
      "commitOwnedEdit(ownerDocId, store.state.activeDocId, () => { xform.resizeImage(wPx, hPx); }, close)",
    );
  });
});

describe("layer comp sessions", () => {
  it("keeps each document's applied comp and restore snapshot apart", () => {
    const sessions = new LayerCompSessions();
    const first = snapshot("before A");
    const second = snapshot("before B");
    sessions.markApplied(1, 0, first);
    sessions.markApplied(1, 2, snapshot("ignored"));
    sessions.markApplied(2, 1, second);
    expect(sessions.session(1).applied).toBe(2);
    expect(sessions.session(2).applied).toBe(1);
    expect(sessions.restore(1)).toEqual(first);
    expect(sessions.session(1).applied).toBe(-1);
    expect(sessions.session(2).applied).toBe(1);
    expect(sessions.restore(2)).toEqual(second);
    sessions.markApplied(1, 3, snapshot("again"));
    sessions.noteRemoved(1, 1);
    expect(sessions.session(1).applied).toBe(2);
    sessions.noteRemoved(1, 2);
    expect(sessions.session(1).applied).toBe(-1);
    expect(sessions.session(2).applied).toBe(-1);
  });

  it("is what the Layer Comps panel uses, including the document mismatch guard", () => {
    const panels = read("./Panels.tsx");
    const body = panels.slice(panels.indexOf("export function LayerCompsPanel"), panels.indexOf("export function LayerCompsPanel") + 4000);
    expect(body).toContain("sessions.markApplied(");
    expect(body).toContain("sessions.noteRemoved(store.state.activeDocId, i)");
    expect(body).toContain("sessions.restore(docId)");
    expect(body).toContain("if (docId !== activeDocId) return;");
  });
});

describe("HDR preview dismiss", () => {
  const initial: HdrPreviewSettings = { on: false, method: 0, exposure: 0, gamma: 1 };
  const live: HdrPreviewSettings = { on: true, method: 1, exposure: 1.5, gamma: 2 };

  it("keeps the live values only after OK", () => {
    expect(hdrPreviewOnDismiss(false, initial, live)).toEqual(initial);
    expect(hdrPreviewOnDismiss(true, initial, live)).toEqual(live);
  });

  it("is what the 32-bit preview dialog calls on cancel and unmount", () => {
    const dialogs = read("./Dialogs.tsx");
    const body = dialogs.slice(dialogs.indexOf("function HdrPreviewDialog"), dialogs.indexOf("function HdrPreviewDialog") + 2500);
    expect(body).toContain("onClick={ok}");
    expect(body).toContain("committed.current = true");
    expect(body).toContain("hdrPreviewOnDismiss(committed.current, initial, engine.getHdrPreview())");
    expect(body).toContain("hdrPreviewOnDismiss(false, initial, engine.getHdrPreview())");
  });
});

describe("Camera Raw present frame", () => {
  it("splits before compensating, exactly once, and compensates the after frame when the split is off", () => {
    const before = new Uint8ClampedArray([1, 0, 0, 255, 9, 9, 9, 255]);
    const after = new Uint8ClampedArray([2, 0, 0, 255, 8, 8, 8, 255]);
    let calls = 0;
    const compensate = (px: Uint8ClampedArray) => {
      calls += 1;
      const out = new Uint8ClampedArray(px);
      out[0] += 10;
      out[4] += 10;
      return out;
    };
    const split = presentCameraRawFrame(after, before, after, 2, 1, "lr", compensate);
    expect(calls).toBe(1);
    expect(split[0]).toBe(11);
    expect(split[4]).toBe(18);
    const off = presentCameraRawFrame(after, before, after, 2, 1, "off", compensate);
    expect(calls).toBe(2);
    expect(off[0]).toBe(12);
    expect(Array.from(after)).toEqual([2, 0, 0, 255, 8, 8, 8, 255]);
  });

  it("is called from the workspace before clipping, and the histogram still reads the raw copy", () => {
    const workspace = read("./dialogs/CameraRawWorkspace.tsx");
    const render = workspace.slice(workspace.indexOf("const renderCopy"), workspace.indexOf("const renderCopy") + 1200);
    expect(render).toContain("presentCameraRawFrame(");
    expect(render).toContain("engine.displayCompensate(px)");
    const present = render.indexOf("presentCameraRawFrame(");
    expect(render.indexOf("clippingOverlay")).toBeGreaterThan(present);
    expect(workspace).toContain('channelCounts(copy, "luma")');
  });
});

describe("view menu checks are wired from the app shell", () => {
  it("feeds the four flags into the menu and lists them as rebuild deps", () => {
    expect(viewToggleCheckedIds({ showGrid: true, showRulers: false, snapEnabled: true, proofOn: false })).toEqual(["showgrid", "snap"]);
    const app = read("../App.tsx");
    expect(app).toContain("viewToggleCheckedIds({");
    expect(app).toContain("showGridChecked, showRulersChecked, snapEnabledChecked, proofOnChecked");
  });
});

describe("Blur Gallery pin preview", () => {
  it("bumps the pin canvas after a blit and after a cancelled refresh, and the canvas effect depends on that rev", () => {
    const dialogs = read("./Dialogs.tsx");
    const pin = dialogs.slice(dialogs.indexOf("function PinPreviewCanvas"), dialogs.indexOf("function PinPreviewCanvas") + 1800);
    expect(pin).toContain("}, [previewRev]);");
    const gallery = dialogs.slice(dialogs.indexOf("export function BlurGallery"));
    const now = gallery.slice(gallery.indexOf("const previewNow ="));
    expect(now.indexOf("bumpPinPreview()")).toBeGreaterThan(now.indexOf("engine.blit()"));
    const cancel = gallery.slice(gallery.indexOf("const cancelPreview"), gallery.indexOf("const prepareTransaction"));
    expect(cancel.indexOf("bumpPinPreview()")).toBeGreaterThan(cancel.indexOf("engine.refreshFromEngine()"));
    const bump = gallery.slice(gallery.indexOf("const bumpPinPreview"), gallery.indexOf("const bumpPinPreview") + 220);
    expect(bump).toContain("if (store.state.activeDocId !== targetDocId) return;");
  });
});

describe("Glyphs insert", () => {
  it("replaces the character just inserted and passes the chosen family", () => {
    const dialogs = read("./Dialogs.tsx");
    const body = dialogs.slice(dialogs.indexOf("function Glyphs("), dialogs.indexOf("function Glyphs(") + 1800);
    expect(body).toContain("glyphReplaceRange(lastInsert.current, ch, typeEditorSelection())");
    expect(body).toContain("text.insertGlyph(ch, features, family)");
  });
});
