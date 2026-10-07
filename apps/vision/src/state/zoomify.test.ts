// @vitest-environment jsdom
// #465: File ▸ Export ▸ Zoomify writes the tiled pyramid Photoshop writes. The
// layout maths here are what a Zoomify / OpenSeadragon viewer relies on; the
// emitted viewer is run for real (jsdom) so its tile requests are checked
// against the tiles the export actually writes.
import { describe, expect, it } from "vitest";
import {
  ZOOMIFY_GROUP, zipStore, zoomifyImageProperties, zoomifyLevels, zoomifyTiles, zoomifyViewerHtml,
} from "./zoomify";

describe("zoomifyLevels", () => {
  it("halves down to a single tile, smallest level first, flooring like the reference converter", () => {
    expect(zoomifyLevels(2000, 1000)).toEqual([
      { div: 8, w: 250, h: 125, cols: 1, rows: 1 },
      { div: 4, w: 500, h: 250, cols: 2, rows: 1 },
      { div: 2, w: 1000, h: 500, cols: 4, rows: 2 },
      { div: 1, w: 2000, h: 1000, cols: 8, rows: 4 },
    ]);
  });

  it("is a single full-resolution level when the image already fits one tile", () => {
    expect(zoomifyLevels(256, 100)).toEqual([{ div: 1, w: 256, h: 100, cols: 1, rows: 1 }]);
    expect(zoomifyLevels(257, 1)).toHaveLength(2); // one px over → one more halving
  });

  it("never floors a degenerate side to zero", () => {
    expect(zoomifyLevels(4000, 1)[0]).toMatchObject({ w: 250, h: 1, cols: 1, rows: 1 });
  });
});

describe("zoomifyTiles", () => {
  it("numbers tiles level-major and row-major, 256 to a TileGroup", () => {
    const tiles = [...zoomifyTiles(2000, 1000)];
    expect(tiles).toHaveLength(1 + 2 + 8 + 32);
    expect(tiles[0]).toEqual({ path: "TileGroup0/0-0-0.jpg", div: 8, x: 0, y: 0, w: 250, h: 125 });
    expect(tiles[1].path).toBe("TileGroup0/1-0-0.jpg");
    expect(tiles[2].path).toBe("TileGroup0/1-1-0.jpg");
    expect(tiles[3].path).toBe("TileGroup0/2-0-0.jpg");
    expect(tiles[3 + 4].path).toBe("TileGroup0/2-0-1.jpg"); // second row of the 4×2 level
    expect(tiles.at(-1)).toEqual({ path: "TileGroup0/3-7-3.jpg", div: 1, x: 1792, y: 768, w: 208, h: 232 });
  });

  it("rolls into TileGroup1 at the 257th tile", () => {
    // 5000×5000: 1 + 4 + 9 + 25 + 100 tiles before the 20×20 full-res level.
    const paths = [...zoomifyTiles(5000, 5000)].map((t) => t.path);
    expect(paths).toHaveLength(539);
    expect(paths[ZOOMIFY_GROUP - 1]).toBe("TileGroup0/5-16-5.jpg");
    expect(paths[ZOOMIFY_GROUP]).toBe("TileGroup1/5-17-5.jpg");
    expect(paths.at(-1)).toBe("TileGroup2/5-19-19.jpg");
  });

  it("hands the engine level coordinates with edge tiles clipped to the level", () => {
    for (const t of zoomifyTiles(700, 300)) {
      const level = zoomifyLevels(700, 300).find((l) => l.div === t.div)!;
      expect(t.x + t.w).toBeLessThanOrEqual(level.w);
      expect(t.y + t.h).toBeLessThanOrEqual(level.h);
      expect(t.w).toBeGreaterThan(0);
      expect(t.h).toBeGreaterThan(0);
    }
  });
});

describe("ImageProperties.xml", () => {
  it("is the one-element Zoomify descriptor", () => {
    expect(zoomifyImageProperties(2000, 1000, 43)).toBe(
      '<IMAGE_PROPERTIES WIDTH="2000" HEIGHT="1000" NUMTILES="43" NUMIMAGES="1" VERSION="1.8" TILESIZE="256" />',
    );
  });
});

/** Run the viewer page for real: parse the markup into jsdom and execute its
 *  inline script against the live document. `innerHTML` never runs a script
 *  (per spec), so the page's own script is re-added as a fresh element, which
 *  vitest's jsdom (`runScripts: "dangerously"`) does run. */
function mountViewer(w: number, h: number) {
  const html = zoomifyViewerHtml("doc", w, h);
  expect(html).not.toContain("data:image");
  document.documentElement.innerHTML = html.replace(/^<!DOCTYPE html><html>|<\/html>$/g, "");
  const script = document.createElement("script");
  script.textContent = document.querySelector("script")!.textContent;
  document.body.appendChild(script);
  const view = document.getElementById("v")!;
  const srcs = () => [...view.querySelectorAll("img")].map((i) => i.getAttribute("src")!);
  return { view, srcs };
}

describe("the emitted viewer", () => {
  const written = (w: number, h: number) => new Set([...zoomifyTiles(w, h)].map((t) => t.path));

  it("loads tiles the export wrote, at the coarsest level that covers the window", () => {
    // jsdom's window is 1024×768: a 2000×1000 image fits at 0.512, so the
    // 1000×500 level (0.5 density) is too coarse — full resolution it is.
    const { srcs } = mountViewer(2000, 1000);
    expect(srcs()).toHaveLength(32);
    expect(srcs().every((s) => s.startsWith("TileGroup0/3-"))).toBe(true);
    for (const s of srcs()) expect(written(2000, 1000)).toContain(s);
  });

  it("drops to a coarser level as the user zooms out, and keeps only tiles in view", () => {
    const { view, srcs } = mountViewer(2000, 1000);
    for (let i = 0; i < 4; i++) {
      view.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, clientX: 512, clientY: 384, cancelable: true }));
    }
    // 0.512 / 1.1⁴ ≈ 0.35 → the half-resolution level (0.7 density) covers it.
    expect(srcs().length).toBeGreaterThan(0);
    expect(srcs().every((s) => /^TileGroup0\/2-\d+-\d+\.jpg$/.test(s))).toBe(true);
    for (const s of srcs()) expect(written(2000, 1000)).toContain(s);
  });

  it("reaches full resolution on zoom-in and names tiles past the first TileGroup the way the export does", () => {
    const { view, srcs } = mountViewer(5000, 5000);
    // Fit scale 0.154 → the 1250px level, all 25 of its tiles in view.
    expect(srcs()).toHaveLength(25);
    expect(srcs().every((s) => /^TileGroup0\/3-\d-\d\.jpg$/.test(s))).toBe(true);
    // 13 wheel steps around the centre → 0.53, past the 0.5 that full
    // resolution needs; the tiles mid-image sit beyond index 256.
    for (let i = 0; i < 13; i++) {
      view.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 512, clientY: 384, cancelable: true }));
    }
    expect(srcs().length).toBeLessThan(100); // only what the window shows
    expect(srcs().every((s) => /^TileGroup[12]\/5-\d+-\d+\.jpg$/.test(s))).toBe(true);
    expect(srcs().some((s) => s.startsWith("TileGroup1/"))).toBe(true);
    for (const s of srcs()) expect(written(5000, 5000)).toContain(s);
  });
});

describe("zipStore", () => {
  it("writes a STORE zip whose entries a reader can walk back", () => {
    const a = new TextEncoder().encode("hello"), b = new Uint8Array([1, 2, 3]);
    const zip = zipStore([["doc/ImageProperties.xml", a], ["doc/TileGroup0/0-0-0.jpg", b]]);
    const dv = new DataView(zip.buffer);
    const entries: [string, Uint8Array][] = [];
    let at = 0;
    while (dv.getUint32(at, true) === 0x04034b50) {
      const size = dv.getUint32(at + 18, true), nameLen = dv.getUint16(at + 26, true);
      expect(dv.getUint16(at + 8, true)).toBe(0); // method: store
      const name = new TextDecoder().decode(zip.subarray(at + 30, at + 30 + nameLen));
      entries.push([name, zip.subarray(at + 30 + nameLen, at + 30 + nameLen + size)]);
      at += 30 + nameLen + size;
    }
    expect(entries.map(([n]) => n)).toEqual(["doc/ImageProperties.xml", "doc/TileGroup0/0-0-0.jpg"]);
    expect([...entries[0][1]]).toEqual([...a]);
    expect([...entries[1][1]]).toEqual([...b]);
    // Central directory follows the data, and the EOCD counts both entries.
    expect(dv.getUint32(at, true)).toBe(0x02014b50);
    const eocd = zip.length - 22;
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
    expect(dv.getUint16(eocd + 10, true)).toBe(2);
    expect(dv.getUint32(eocd + 16, true)).toBe(at);
    expect(dv.getUint32(eocd + 12, true)).toBe(eocd - at);
  });
});
