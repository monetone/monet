// Image ingestion: bytes → data URL → an `image` layer with a usable `src`.
// The `image` layer kind was declared but unreachable before this path existed,
// so these cover the two halves that can break silently: the data URL encoding
// (wrong mime / truncated on a big file) and the layer the command produces.

import { describe, expect, it } from "vitest";
import { addImageLayer } from "../commands";
import { imageDataUrl, isDocumentPath, isImagePath, layerNameFor } from "./files";
import { newContainer, projectFromContainer, projectToContainer } from "./anime";
import { activeComp } from "../model/query";
import { store } from "../state/store";
import { createProject } from "../model/factory";

// 1×1 transparent PNG.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);

describe("path classification", () => {
  it("recognises image extensions case-insensitively", () => {
    expect(isImagePath("/tmp/Sunset.PNG")).toBe(true);
    expect(isImagePath("/tmp/a.jpeg")).toBe(true);
    expect(isImagePath("/tmp/a.webp")).toBe(true);
    expect(isImagePath("/tmp/a.mani")).toBe(false);
    expect(isImagePath("/tmp/noextension")).toBe(false);
    // a directory named like an image must not read as one
    expect(isImagePath("/tmp/photos.png/readme")).toBe(false);
  });

  it("recognises every Monet extension as a document, and the two sets never overlap", () => {
    expect(isDocumentPath("/tmp/Scene.mani")).toBe(true);
    // Every app's container opens in Anime — the manifest decides, not the name.
    expect(isDocumentPath("/tmp/Cut.mcin")).toBe(true);
    expect(isDocumentPath("/tmp/Art.mvis")).toBe(true);
    expect(isDocumentPath("/tmp/Scene.monet")).toBe(false); // the bare-JSON format is gone
    expect(isDocumentPath("/tmp/Scene.json")).toBe(false);
    expect(isDocumentPath("/tmp/Scene.png")).toBe(false);
  });

  it("names a layer after the file stem", () => {
    expect(layerNameFor("/a/b/Sunset over Nice.png")).toBe("Sunset over Nice");
    expect(layerNameFor("C:\\pics\\logo.jpg")).toBe("logo");
  });
});

describe("imageDataUrl", () => {
  it("types the data URL from the extension and round-trips the bytes", () => {
    const url = imageDataUrl(PNG, "/tmp/pixel.png");
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    const back = Uint8Array.from(atob(url.slice("data:image/png;base64,".length)), (c) => c.charCodeAt(0));
    expect(Array.from(back)).toEqual(Array.from(PNG));
  });

  it("maps jpg/jpeg to image/jpeg and falls back to png for the unknown", () => {
    expect(imageDataUrl(PNG, "a.jpg")).toContain("data:image/jpeg;base64,");
    expect(imageDataUrl(PNG, "a.JPEG")).toContain("data:image/jpeg;base64,");
    expect(imageDataUrl(PNG, "a.unknown")).toContain("data:image/png;base64,");
  });

  it("survives a payload larger than the 0x8000 chunk (no stack blowout)", () => {
    const big = new Uint8Array(0x8000 * 3 + 7).map((_, i) => i % 256);
    const url = imageDataUrl(big, "big.png");
    const back = Uint8Array.from(atob(url.slice("data:image/png;base64,".length)), (c) => c.charCodeAt(0));
    expect(back.length).toBe(big.length);
    expect(back[back.length - 1]).toBe(big[big.length - 1]);
  });
});

describe("addImageLayer", () => {
  it("adds a selected front image layer carrying the source, and it survives a .monet round trip", () => {
    store.replaceProject(createProject("Untitled"), { markClean: true });
    const src = imageDataUrl(PNG, "pixel.png");
    addImageLayer("Pixel", src, 640, 480);

    const layer = activeComp(store.getState().project).layers[0];
    expect(layer.kind).toBe("image");
    expect(layer.name).toBe("Pixel");
    expect(layer.src).toBe(src);
    expect(layer.width).toBe(640);
    expect(layer.height).toBe(480);
    // anchor centres the image so rotation/scale pivot correctly
    expect(layer.transform.anchorX).toBe(320);
    expect(layer.transform.anchorY).toBe(240);
    expect(store.getState().selection).toEqual([layer.id]);

    // Through the real save path: images are inline data URLs in timeline.json.
    const reopened = projectFromContainer(
      projectToContainer(store.getState().project, newContainer()),
    ).project;
    const saved = activeComp(reopened).layers[0];
    expect(saved.kind).toBe("image");
    expect(saved.src).toBe(src);
  });
});
