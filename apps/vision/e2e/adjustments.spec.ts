import { test, expect } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";

// Each adjustment, driven through the real `mv.adj` action layer, must
// change the composite of the structured scene.
const ADJ: Array<{ name: string; code: string }> = [
  { name: "brightness/contrast", code: "mv.adj.brightnessContrast(28, 18)" },
  { name: "levels", code: "mv.adj.levels(20, 235, 1.3, 0, 255, 0)" },
  { name: "curves", code: "const inv=new Uint8Array(256),id=new Uint8Array(256);for(let i=0;i<256;i++){inv[i]=255-i;id[i]=i;}mv.adj.curves(inv,id,id,id)" },
  { name: "hue/saturation", code: "mv.adj.hueSaturation(45, 35, 5)" },
  { name: "vibrance", code: "mv.adj.vibrance(0.6, 0.2)" },
  { name: "invert", code: "mv.adj.invert()" },
  { name: "desaturate", code: "mv.adj.desaturate()" },
  { name: "black & white", code: "mv.adj.blackWhite(0.4, 0.4, 0.2)" },
  { name: "threshold", code: "mv.adj.threshold(128)" },
  { name: "posterize", code: "mv.adj.posterize(4)" },
  { name: "exposure", code: "mv.adj.exposure(0.7, 0.02, 1.1)" },
  { name: "color balance", code: "mv.adj.colorBalance(new Float32Array([0.3,-0.1,0.2]),new Float32Array([0.1,0.1,-0.2]),new Float32Array([-0.2,0.1,0.3]),true)" },
  { name: "photo filter", code: "mv.adj.photoFilter(255, 140, 40, 0.6, true)" },
  { name: "channel mixer", code: "mv.adj.channelMixer(new Float32Array([0,0,1,0, 0,1,0,0, 1,0,0,0]))" },
  { name: "gradient map", code: "const lut=new Uint8Array(256*4);for(let i=0;i<256;i++){lut[i*4]=i;lut[i*4+1]=255-i;lut[i*4+2]=128;lut[i*4+3]=255;}mv.adj.gradientMap(lut)" },
];

for (const a of ADJ) {
  test(`adjustment: ${a.name}`, async ({ page }) => {
    await gotoApp(page);
    await newScene(page);
    const before = await composite(page);
    await page.evaluate((code) => {
      const mv = (window as any).__mv;
      // eslint-disable-next-line no-new-func
      new Function("mv", code)(mv);
    }, a.code);
    const after = await composite(page);
    expect(after.chk).not.toBe(before.chk);
  });
}
