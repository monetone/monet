// @vitest-environment happy-dom
import { gzipSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import {
  IO,
  Query,
  defaultStroke,
  makeDocument,
  makeRect,
  rgba,
  solid,
  type AppearanceStack,
  type Document,
  type Item,
} from "../../engine";
import { importSVG } from "./svg";
import { importFile } from "./index";

const allItems = (doc: Document): Item[] => {
  const items: Item[] = [];
  Query.eachItem(doc, (item) => { items.push(item); });
  return items;
};
const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${inner}</svg>`;

describe("importSVG — security & robustness", () => {
  it("drops <script> elements and never executes them (SEC-M2)", () => {
    delete (globalThis as unknown as { __pwned?: number }).__pwned;
    const doc = importSVG(svg(`<script>globalThis.__pwned=1</script><rect width="10" height="10"/>`));
    expect((globalThis as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    const items = allItems(doc);
    expect(items.some((i) => /script/i.test(i.type))).toBe(false);
    expect(items.some((i) => i.type === "rect")).toBe(true);
  });

  it("rejects unsafe <image> href schemes (SEC-M1)", () => {
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "http://evil.example/x.png", "blob:abcd"]) {
      const doc = importSVG(svg(`<image width="8" height="8" href="${bad}"/>`));
      expect(allItems(doc).some((i) => i.type === "image")).toBe(false);
    }
  });

  it("keeps a safe inline data:image <image> href", () => {
    const data = "data:image/png;base64,iVBORw0KGgo=";
    const doc = importSVG(svg(`<image width="8" height="8" href="${data}"/>`));
    const img = allItems(doc).find((i) => i.type === "image") as (Item & { href?: string }) | undefined;
    expect(img?.href).toBe(data);
  });

  it("imports a moderately nested <g> tree without error", () => {
    const open = "<g>".repeat(200);
    const close = "</g>".repeat(200);
    expect(() => importSVG(svg(`${open}<rect width="1" height="1"/>${close}`))).not.toThrow();
  });

  it("refuses exponential <use> expansion", () => {
    const defs = [`<g id="u0"><rect width="1" height="1"/></g>`];
    for (let i = 1; i <= 15; i++) defs.push(`<g id="u${i}"><use href="#u${i - 1}"/><use href="#u${i - 1}"/></g>`);
    expect(() => importSVG(svg(`<defs>${defs.join("")}</defs><use href="#u15"/>`))).toThrow(/too complex/i);
  });

  it("imports only the first supported <switch> branch", () => {
    const doc = importSVG(svg(`<switch><foreignObject><div/></foreignObject><g><rect width="2" height="3"/></g><circle r="4"/></switch>`));
    const types = allItems(doc).map((item) => item.type);
    expect(types).toContain("rect");
    expect(types).not.toContain("circle");
  });
});

describe("importFile — compressed SVG", () => {
  it("gunzips .svgz before parsing", async () => {
    const source = svg(`<rect width="4" height="4"/><circle r="2"/>`);
    const result = await importFile("drawing.svgz", gzipSync(source));
    expect(allItems(result.doc).filter((item) => item.type !== "group")).toHaveLength(2);
  });
});

describe("importFile — id re-minting (SEC-M2 / AR-H3)", () => {
  it("re-mints ids so two imports of the same file never share an id", async () => {
    const bytes = new TextEncoder().encode(svg(`<rect width="4" height="4"/><circle r="2"/>`));
    const a = await importFile("a.svg", bytes);
    const b = await importFile("b.svg", bytes);
    const idsA = new Set(allItems(a.doc).map((i) => i.id));
    const idsB = allItems(b.doc).map((i) => i.id);
    expect(idsB.length).toBeGreaterThan(0);
    expect(idsB.some((id) => idsA.has(id))).toBe(false); // disjoint id spaces
  });
});

describe("gradient stop offsets", () => {
  const stopsOf = (offsets: string[]) => {
    const defs = `<defs><linearGradient id="g">${offsets.map((o, i) => `<stop offset="${o}" stop-color="${i ? "#fff" : "#000"}"/>`).join("")}</linearGradient></defs>`;
    const doc = importSVG(svg(`${defs}<rect width="100" height="100" fill="url(#g)"/>`));
    const fill = allItems(doc).find((i) => i.type === "rect")!.fill;
    return fill.type === "gradient" ? fill.gradient.stops.map((st) => st.offset) : [];
  };

  it("reads percentages as hundredths, including small ones", () => {
    // "1%" is 1/100 along the ramp. Guessing the unit from magnitude (off > 1)
    // put it at the very END of the ramp, inverting the gradient.
    expect(stopsOf(["1%", "100%"])).toEqual([0.01, 1]);
  });

  it("still reads a bare number as a fraction", () => {
    expect(stopsOf(["0", "1"])).toEqual([0, 1]);
  });

  it("handles a mid percentage", () => {
    expect(stopsOf(["0%", "50%"])).toEqual([0, 0.5]);
  });
});

describe("SVG paint round trips", () => {
  it("parses exporter colors without a canvas context", () => {
    const doc = importSVG(svg(`
      <defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="rgba(0,0,255,0.5)"/></linearGradient></defs>
      <rect id="solid" width="10" height="10" fill="rgb(10,20,30)" fill-opacity="0.5"/>
      <rect id="gradient" x="20" width="10" height="10" fill="url(#g)"/>
    `));
    const items = allItems(doc);
    const flat = items.find((item) => item.name === "solid")!.fill;
    const gradient = items.find((item) => item.name === "gradient")!.fill;

    expect(flat).toEqual(solid(rgba(10, 20, 30, 0.5)));
    expect(gradient.type === "gradient" ? gradient.gradient.stops.map((stop) => stop.color) : []).toEqual([
      rgba(255, 0, 0),
      rgba(0, 0, 255, 0.5),
    ]);
  });

  it("rebuilds an exported appearance stack as one editable item", () => {
    const stack: AppearanceStack = {
      entries: [
        { id: "fill-base", kind: "fill", paint: solid(rgba(220, 0, 0)) },
        { id: "fill-top", kind: "fill", paint: solid(rgba(0, 0, 220)), opacity: 0.5 },
        { id: "stroke-top", kind: "stroke", stroke: { ...defaultStroke(solid(rgba(0, 160, 60))), width: 6 } },
      ],
    };
    const source = makeDocument();
    source.layers[0].items.push(makeRect(0, 0, 40, 40, 0, 0, { appearance: stack }));

    const back = importSVG(IO.exportSVG(source));
    const leaves = allItems(back).filter((item) => item.type !== "group");

    expect(leaves).toHaveLength(1);
    expect(leaves[0].appearance?.entries).toMatchObject([
      { id: "fill-base", kind: "fill", paint: solid(rgba(220, 0, 0)) },
      { id: "fill-top", kind: "fill", paint: solid(rgba(0, 0, 220)), opacity: 0.5 },
      { id: "stroke-top", kind: "stroke", stroke: { paint: solid(rgba(0, 160, 60)), width: 6 } },
    ]);
  });
});
