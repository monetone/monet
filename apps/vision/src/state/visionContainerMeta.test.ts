// `.mvis` is classified by the app itself as a full project format — Save As
// offers it as "Monet Vision Document" right under "Monet Vision Project",
// saveAsIsCopy says it is not a copy, and the tab goes clean. But the bytes it
// wrote were the engine's graphics container alone: every field that lives in
// JS — saved paths, notes, layer comps, brush tips, the measurement scale, the
// ICC assignment, Camera Raw provenance — was destroyed, silently (#493).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { decodeDocumentMetaBytes, encodeDocumentMetaBytes } from "./projectEnvelope";
import { VISION_CONTAINER_ROLES, VISION_DOCUMENT_ROLE, isProjectSaveExtension, saveAsIsCopy } from "./nativeIoPolicy";
import { DEFAULT_MEASURE_SCALE } from "./measureScale";

const appSource = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");

describe("the .mvis container carries the document metadata", () => {
  it("round-trips everything that lives outside the engine", () => {
    const meta = {
      colorProfileAssigned: false,
      iccProfileName: "Custom RGB",
      notes: [{ id: 1, x: 10, y: 20, text: "hello", author: "me" }],
      resolutionPpi: 144,
      pixelAspect: 2,
      pixelAspectCorrection: false,
      measureScale: { ...DEFAULT_MEASURE_SCALE, px: 10, units: 2.5, unit: "cm" },
      savedPaths: [{ name: "Path 1", path: [0, 0, 10, 0, 10, 10] }],
    };

    const back = decodeDocumentMetaBytes(encodeDocumentMetaBytes(meta as never));

    expect(back).not.toBeNull();
    expect(back!.savedPaths).toEqual(meta.savedPaths);
    expect(back!.notes).toEqual(meta.notes);
    expect(back!.colorProfileAssigned).toBe(false);
    expect(back!.resolutionPpi).toBe(144);
    expect(back!.pixelAspect).toBe(2);
    expect(back!.pixelAspectCorrection).toBe(false);
    expect(back!.measureScale).toEqual(meta.measureScale);
    expect(back!.iccProfileName).toBe("Custom RGB");
  });

  it("rejects bytes that are not a document-metadata entry", () => {
    expect(decodeDocumentMetaBytes(new TextEncoder().encode("not json"))).toBeNull();
    expect(decodeDocumentMetaBytes(new TextEncoder().encode('{"format":"something-else"}'))).toBeNull();
  });

  it("claims the entry role, so a foreign app couriers it and Vision replaces it", () => {
    expect(VISION_CONTAINER_ROLES.has(VISION_DOCUMENT_ROLE)).toBe(true);
  });

  it("is written on save and read on open", () => {
    expect(appSource).toContain("encodeDocumentMetaBytes");
    expect(appSource).toContain("decodeDocumentMetaBytes");
  });

  it("stays a project format, not an export copy", () => {
    // The fix is to make the format honest, not to demote it.
    expect(isProjectSaveExtension("mvis")).toBe(true);
    expect(saveAsIsCopy("mvis", false)).toBe(false);
  });
});
