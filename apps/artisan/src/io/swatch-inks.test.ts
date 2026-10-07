import { buildAseSwatches, parseAseSwatches, type AseSwatch } from "@monet-ui/monet-imageio";
import { describe, expect, it } from "vitest";
import { commands } from "../commands";
import { ArtisanStore, IO, makeDocument } from "../engine";
import { aseSwatchFromPaint, paintFromAse } from "./commands";

describe("Adobe swatch ink wiring", () => {
  it("keeps a spot and its same-RGB process twin distinct across document and ASE round trips", () => {
    const source: AseSwatch[] = [
      { name: "Spot Grey", hex: "#808080", model: "CMYK", components: [0, 0, 0, 0.5], colorType: 1 },
      { name: "808080", hex: "#808080", model: "RGB", components: [128 / 255, 128 / 255, 128 / 255], colorType: 2 },
    ];
    const paints = parseAseSwatches(buildAseSwatches(source)).map(paintFromAse);
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.swatches = [];
    store.replaceDoc(doc, { markClean: true });

    expect(commands.importSwatches(store, paints)).toBe(2);
    const reopened = IO.deserializeDocument(IO.serializeDocument(store.doc));
    expect(reopened.swatches).toHaveLength(2);
    expect(reopened.swatches[0]).toMatchObject({ ink: { name: "Spot Grey", kind: "spot", components: { k: 50 } } });

    const exported = reopened.swatches.flatMap((paint) => paint.type === "solid" ? [aseSwatchFromPaint(paint)] : []);
    expect(exported).toMatchObject([
      { name: "Spot Grey", model: "CMYK", colorType: 1 },
      { name: "808080", model: "RGB", colorType: 2 },
    ]);
    expect(exported[0].components[3]).toBeCloseTo(0.5);
  });
});
