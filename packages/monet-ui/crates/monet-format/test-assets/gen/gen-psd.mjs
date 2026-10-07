// Dev-only generator for committed PSD/PSB test fixtures (run by hand, not by
// the app build):   node test-assets/gen/gen-psd.mjs
//
// Produces test-assets/fixtures/sample.{psd,psb} — one logical document written
// in both the v1 (PSD) and v2 (PSB / large-document) byte layouts so a single
// set of Rust assertions validates both. Content is chosen to exercise the
// monet-format reader: solid layers (exact colours), a per-pixel gradient
// (validates RLE decode + placement), a nested group, an offset child with a
// stroke effect, a text layer, and a brightness/contrast adjustment layer.

import { writePsdBuffer, readPsd } from "ag-psd";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");
mkdirSync(fixtures, { recursive: true });

const W = 16;
const H = 16;

function solid(w, h, [r, g, b, a]) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width: w, height: h, data };
}

// Per-pixel gradient: r = x*16, g = y*16, b = 128, a = 255 — a unique value per
// pixel, so the Rust test can recompute and assert byte-exact equality.
function gradient(w, h) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = x * 16;
      data[i + 1] = y * 16;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const psd = {
  width: W,
  height: H,
  children: [
    { name: "Background", top: 0, left: 0, bottom: H, right: W, imageData: solid(W, H, [40, 40, 40, 255]) },
    {
      name: "Red Half",
      top: 0, left: 0, bottom: H, right: W,
      opacity: 0.5,
      blendMode: "multiply",
      imageData: solid(W, H, [200, 30, 30, 255]),
    },
    { name: "Gradient", top: 0, left: 0, bottom: H, right: W, imageData: gradient(W, H) },
    {
      name: "Hidden Blue",
      top: 0, left: 0, bottom: H, right: W,
      hidden: true,
      imageData: solid(W, H, [0, 0, 255, 255]),
    },
    {
      name: "Group",
      opened: true,
      children: [
        {
          name: "Child",
          top: 4, left: 4, bottom: 12, right: 12,
          imageData: solid(8, 8, [0, 128, 255, 255]),
          effects: {
            stroke: [
              {
                enabled: true,
                size: { units: "Pixels", value: 2 },
                position: "outside",
                fillType: "color",
                color: { r: 0, g: 0, b: 0 },
                opacity: { units: "Percent", value: 100 },
                blendMode: "normal",
              },
            ],
          },
        },
      ],
    },
    {
      name: "Hi",
      text: {
        text: "Hi",
        transform: [1, 0, 0, 1, 2, 12],
        style: { font: { name: "ArialMT" }, fontSize: 10, fillColor: { r: 255, g: 255, b: 255 } },
      },
    },
    {
      name: "Bright",
      adjustment: { type: "brightness/contrast", brightness: 40, contrast: 20, useLegacy: true },
    },
  ],
};

for (const [name, psb] of [["sample.psd", false], ["sample.psb", true]]) {
  const buf = writePsdBuffer(psd, { psb, generateThumbnail: false });
  const out = join(fixtures, name);
  writeFileSync(out, buf);
  console.log(`wrote ${out} (${buf.length} bytes, psb=${psb})`);
}

// Self-validate: re-read structure (no canvas needed) and print the layer tree.
const back = readPsd(writePsdBuffer(psd, { psb: false, generateThumbnail: false }), {
  skipLayerImageData: true,
  skipCompositeImageData: true,
  skipThumbnail: true,
});
const dump = (layers, d = 0) => {
  for (const l of layers || []) {
    const props = [
      l.opacity != null ? `op=${l.opacity}` : "",
      l.blendMode && l.blendMode !== "normal" ? l.blendMode : "",
      l.hidden ? "hidden" : "",
      l.text ? `text=${JSON.stringify(l.text.text)}` : "",
      l.adjustment ? `adj=${l.adjustment.type}` : "",
      l.effects ? `fx=${Object.keys(l.effects).join("+")}` : "",
      l.children ? "GROUP" : "",
    ].filter(Boolean).join(" ");
    console.log(`${"  ".repeat(d)}- ${l.name}  ${props}`);
    if (l.children) dump(l.children, d + 1);
  }
};
console.log("layer tree (top→bottom as ag-psd returns):");
dump(back.children);
