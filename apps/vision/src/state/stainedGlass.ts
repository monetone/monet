// ─────────────────────────────────────────────────────────────
// Stained Glass (Filter ▸ Texture ▸ Stained Glass) — like Crystallize (solid Voronoi cells, each
// taking the colour sampled at its seed), but the seams BETWEEN cells are drawn in the foreground
// colour — the dark "lead" of a leaded-glass window — and an optional `light` adds a soft glow from
// the image centre (cells nearer the middle are brightened). Deterministic (seeds from a position
// hash), so it round-trips and unit-tests in node. Engine-free.
//
// A pixel is either the flat lead colour, or a COPY of one source pixel scaled by a radial glow, so
// for a grey image (R=G=B) with a grey lead it maps to `stained_glass` bit-for-bit — modelled here
// as one channel. The floating-point work is choosing the nearest seed and the centre glow.
//
// MUST match `filters.rs stained_glass` (grey domain, full selection ⇒ straight copy):
//   cs = max(cell_size, 2);  bw = max(border, 1);  fg16 = fg·257;  cx,cy = w/2,h/2
//   maxd = max(sqrt(cx²+cy²), 1)
//   owner(x,y) = the nearest jittered-grid seed (as in Crystallize): its CELL (gx,gy) and the rounded,
//                clamped sample location.  Precompute the owning cell + sample of every pixel.
//   lead = any pixel within the `bw` square (clamped) has a DIFFERENT owning cell
//   out  = lead ? fg16 : trunc( clamp( src[sample] · glow ) ),
//          glow = light>0 ? 1 + light·(1 − d/maxd) with d = sqrt((x−cx)²+(y−cy)²), else 1
//
// `hash2` is mirrored with `Math.imul`+`>>>0`. The seed/distance/glow chain uses `Math.fround` per
// sub-op; the round is half-away-from-zero (Rust `f32::round`). The cell-equality (lead) test is
// integer (exact given the cell assignment); the f32-sensitive results are the seed/cell choice (as
// in Crystallize) and the `src·glow` value.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const STAINED_GLASS_MAX = 65535;

/** The Voronoi hash (shared layout with Crystallize/Pointillize), mirrored with u32 wrapping. */
export function hash2(x: number, y: number): number {
  let v = ((Math.imul(x >>> 0, 0x9e3779b1) >>> 0) ^ (Math.imul(y >>> 0, 0x85ebca6b) >>> 0)) >>> 0;
  v = (v ^ (v >>> 15)) >>> 0;
  v = Math.imul(v, 0x2c1b3c6d) >>> 0;
  v = (v ^ (v >>> 12)) >>> 0;
  v = Math.imul(v, 0x297a2d39) >>> 0;
  v = (v ^ (v >>> 15)) >>> 0;
  return v >>> 0;
}

/** Rust `f32::round` — round half AWAY from zero. */
const roundAway = (v: number): number => (v < 0 ? -Math.round(-v) : Math.round(v));
const clampInt = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

function seedPos(gx: number, gy: number, csf: number): [number, number] {
  const hsh = hash2(gx, gy);
  const jx = fr((hsh & 0xffff) / 65535);
  const jy = fr(((hsh >>> 16) & 0xffff) / 65535);
  return [fr(fr(gx + jx) * csf), fr(fr(gy + jy) * csf)];
}

/** The owning cell `[gx, gy]` and the rounded/clamped sample location `[sx, sy]` for pixel `(x, y)`:
 *  the nearest jittered-grid seed over the 3×3 grid-cell neighbourhood. Exposed for testing. */
export function stainedGlassOwner(x: number, y: number, cs: number, w: number, h: number): [number, number, number, number] {
  const csf = fr(cs);
  const gx0 = Math.floor(x / cs);
  const gy0 = Math.floor(y / cs);
  let best = Infinity; // engine seeds with f32::MAX; the first neighbour always wins
  let bgx = gx0;
  let bgy = gy0;
  let sx = x;
  let sy = y;
  for (let dgy = -1; dgy <= 1; dgy++) {
    for (let dgx = -1; dgx <= 1; dgx++) {
      const cgx = gx0 + dgx;
      const cgy = gy0 + dgy;
      const [px, py] = seedPos(cgx, cgy, csf);
      const ex = fr(px - x);
      const ey = fr(py - y);
      const d = fr(fr(ex * ex) + fr(ey * ey));
      if (d < best) {
        best = d;
        bgx = cgx;
        bgy = cgy;
        sx = clampInt(roundAway(px), w - 1);
        sy = clampInt(roundAway(py), h - 1);
      }
    }
  }
  return [bgx, bgy, sx, sy];
}

/** Apply Stained Glass to a single-channel (grey) 2-D image (u16 values 0..65535) with grey lead
 *  colour `fg` (u8). `cellSize` ≥2 is the cell pitch, `border` ≥1 the lead width, `light` ≥0 the
 *  central glow. Does not mutate the input. */
export function stainedGlass2D(
  image: readonly (readonly number[])[],
  cellSize: number,
  border: number,
  light: number,
  fg = 0,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const cs = Math.max(cellSize | 0, 2);
  const bw = Math.max(border | 0, 1);
  const fg16 = (fg & 0xff) * 257; // fg is a u8 at the wasm boundary (matches the cell/border coercion)
  const lt = fr(light);

  // precompute each pixel's owning cell and the value it samples
  const cellGx: number[][] = [];
  const cellGy: number[][] = [];
  const sample: number[][] = [];
  for (let y = 0; y < h; y++) {
    const rgx = new Array<number>(w);
    const rgy = new Array<number>(w);
    const rsv = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      const [gx, gy, sx, sy] = stainedGlassOwner(x, y, cs, w, h);
      rgx[x] = gx;
      rgy[x] = gy;
      rsv[x] = image[sy][sx];
    }
    cellGx.push(rgx);
    cellGy.push(rgy);
    sample.push(rsv);
  }

  const cx = fr(w / 2);
  const cy = fr(h / 2);
  const maxd = fr(Math.max(fr(Math.sqrt(fr(fr(cx * cx) + fr(cy * cy)))), 1));

  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      const mgx = cellGx[y][x];
      const mgy = cellGy[y][x];
      let lead = false;
      for (let dy = -bw; dy <= bw && !lead; dy++) {
        const ny = clampInt(y + dy, h - 1);
        for (let dx = -bw; dx <= bw; dx++) {
          const nx = clampInt(x + dx, w - 1);
          if (cellGx[ny][nx] !== mgx || cellGy[ny][nx] !== mgy) { lead = true; break; }
        }
      }
      if (lead) {
        row[x] = fg16;
      } else {
        let glow = 1;
        if (lt > 0) {
          const ex = fr(x - cx);
          const ey = fr(y - cy);
          const d = fr(Math.sqrt(fr(fr(ex * ex) + fr(ey * ey))));
          glow = fr(1 + fr(lt * fr(1 - fr(d / maxd))));
        }
        const v = fr(sample[y][x] * glow);
        row[x] = Math.trunc(v < 0 ? 0 : v > STAINED_GLASS_MAX ? STAINED_GLASS_MAX : v);
      }
    }
    out.push(row);
  }
  return out;
}
