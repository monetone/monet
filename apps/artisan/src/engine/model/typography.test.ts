// ─────────────────────────────────────────────────────────────
// model/typography.test — shaping-ready text metadata
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  IO,
  Ops,
  fontResolutionForText,
  makeDocument,
  makeText,
  type TextItem,
} from "../index";

describe("typography model helpers", () => {
  it("infers fallback metadata from CSS font-family stacks", () => {
    const t = makeText("Fallback", 0, 0, { fontFamily: "\"Missing Pro\", Helvetica, sans-serif" });

    expect(fontResolutionForText(t)).toEqual({
      requestedFamily: "\"Missing Pro\", Helvetica, sans-serif",
      status: "unresolved",
      fallbacks: [
        { family: "Missing Pro", status: "unresolved", source: "system" },
        { family: "Helvetica", status: "unresolved", source: "system" },
        { family: "sans-serif", status: "unresolved", source: "generic" },
      ],
    });
  });

  it("persists font resolution and layout seams through .artisan JSON", () => {
    const doc = makeDocument("Typography");
    const t = makeText("مرحبا", 10, 20, {
      fontFamily: "Missing Arabic",
      language: "ar",
      direction: "rtl",
      writingMode: "vertical-rl",
      glyphOrientation: "upright",
      features: [{ tag: "kern", value: true }],
      fontResolution: {
        requestedFamily: "Missing Arabic",
        resolvedFamily: "Noto Sans Arabic",
        status: "substituted",
        substitutedFor: "Missing Arabic",
        fallbacks: [{ family: "Noto Sans Arabic", status: "resolved", source: "system" }],
      },
      layout: {
        engine: "browser-measure",
        version: 1,
        writingMode: "vertical-rl",
        runs: [{ start: 0, end: 5, source: "browser", width: 42, height: 120 }],
      },
    });
    doc.layers[0].items.push(t);

    const back = IO.deserializeDocument(IO.serializeDocument(doc));
    expect((back.layers[0].items[0] as TextItem).fontResolution).toEqual(t.fontResolution);
    expect((back.layers[0].items[0] as TextItem).layout).toEqual(t.layout);
    expect(IO.serializeDocument(back)).toBe(IO.serializeDocument(doc));
  });

  it("invalidates measured layout and refreshes font resolution when the family changes", () => {
    const doc = makeDocument("Typography");
    const t = makeText("Cache", 0, 0, {
      layout: {
        engine: "browser-measure",
        version: 1,
        runs: [{ start: 0, end: 5, source: "browser", width: 50, height: 20 }],
      },
    });
    doc.layers[0].items.push(t);

    Ops.Text.setFontFamily(doc, [t.id], "Georgia, serif");
    const edited = doc.layers[0].items[0] as TextItem;
    expect(edited.layout).toBeUndefined();
    expect(edited.fontResolution).toMatchObject({ requestedFamily: "Georgia, serif", status: "unresolved" });
  });
});
