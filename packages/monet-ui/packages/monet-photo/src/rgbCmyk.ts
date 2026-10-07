// Naive sRGB → CMYK for Photoshop's Info-panel CMYK readout in RGB/Grayscale
// documents (Photoshop uses the working CMYK ICC profile; Vision has no ICC, so
// this is the indicative conversion). Pure / engine-free so it unit-tests in node;
// each component is a rounded 0-100 percentage.

export interface Cmyk {
  c: number;
  m: number;
  y: number;
  k: number;
}

export function rgbToCmyk(r: number, g: number, b: number): Cmyk {
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const k = 1 - Math.max(rf, gf, bf);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 }; // pure black: no colour ink
  // `|| 0` folds the -0 that rounding the max channel's (1-chan-k)=0 can produce.
  const pct = (n: number) => Math.round(n * 100) || 0;
  return {
    c: pct((1 - rf - k) / (1 - k)),
    m: pct((1 - gf - k) / (1 - k)),
    y: pct((1 - bf - k) / (1 - k)),
    k: pct(k),
  };
}
