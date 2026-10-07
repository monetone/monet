// ─────────────────────────────────────────────────────────────
// Texturizer (Filter ▸ Texture ▸ Texturizer) — embosses a procedural texture onto the image as a
// relief: a per-pixel HEIGHT field (canvas weave / sandstone noise / brick / burlap) is lit from a
// chosen direction, and the resulting slope brightens or darkens each pixel. The slope is the height
// DIFFERENCE between a pixel and its neighbour toward the light, scaled by `relief`. Deterministic
// (the texture is a function of coordinates, not the image), so it round-trips and unit-tests in node.
// Engine-free.
//
// The same relief `d` is added to all three channels, so a grey image (R=G=B) maps to `texturizer`
// bit-for-bit — modelled here as one channel: out = trunc(clamp(v + d, 0, 65535)).
//
// MUST match `filters.rs texturizer` (grey domain, full selection ⇒ cov 1):
//   rel = clamp(relief,0,1);  rel ≤ 0 ⇒ no-op
//   period = 4 + 28·clamp(scaling,0,1);  f = TAU / period
//   height(x,y) by texture: 1 Sandstone = tex_noise(x/period, y/period);
//     2 Brick = mortar(0) vs raised(1) bands;  3 Burlap = max(0.5+0.5·cos(xf·f), 0.5+0.5·cos(yf·f));
//     _ Canvas = (0.5+0.5·cos(xf·f) + 0.5+0.5·cos(yf·f))·0.5
//   dir = [(0,-1),(-1,-1),(-1,0),(-1,1),(0,1),(1,1),(1,0),(1,-1)][light&7];  sign = invert ? -1 : 1
//   shade = (height(x,y) − height(x+lx, y+ly))·sign;  d = shade·rel·30000·cov;  out = trunc(clamp(v+d))
//
// `tex_hash`/`tex_noise` are integer-exact + smoothstep value noise (no trig) ⇒ Sandstone and Brick
// are BIT-EXACT. Canvas and Burlap use `cos`: the engine's `f32::cos` (native libm cosf) and JS
// `fround(Math.cos)` disagree by exactly 1 ULP for ~1.3% of f32 cos angles (platform-dependent), which
// flips the final relief by ≤1 LSB for a small, relief-dependent fraction of pixels (~0.002–0.06%) —
// so those two are bit-exact-to-≤1, not strict (the goldens below sit at verified-agreeing angles).
// `Math.fround` per sub-op reproduces the engine's f32 order; `as u16` saturates (NaN→0).
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const TEXTURIZER_MAX = 65535;

const TAU = fr(Math.PI * 2); // std::f32::consts::TAU
const AMP = 30000;
// light direction offsets: 0 Top · 1 Top-Left · 2 Left · 3 Bottom-Left · 4 Bottom · 5 Bottom-Right · 6 Right · 7 Top-Right
const DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1]];

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
// Rust `f32::fract()` = self − self.trunc() (toward zero, so SIGN-preserving) — distinct from floor for
// negative inputs (the light-neighbour can land at x/y = −1). Brick then `.abs()`es it.
const fract = (x: number): number => fr(x - Math.trunc(x));

/** The engine's `tex_hash(ix, iy) -> f32` in [0,1): a u32 integer mix. Mirrored with Math.imul/>>>0. */
export function texHash(ix: number, iy: number): number {
  let n = ((Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)) >>> 0);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return fr(((n >>> 8) & 0xffff) / 65535);
}

/** The engine's `tex_noise(x, y) -> f32`: smoothstep-interpolated value noise over `tex_hash` corners. */
export function texNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fr(x - ix);
  const fy = fr(y - iy);
  const sx = fr(fr(fx * fx) * fr(3 - fr(2 * fx))); // smoothstep
  const sy = fr(fr(fy * fy) * fr(3 - fr(2 * fy)));
  const a = texHash(ix, iy);
  const b = texHash(ix + 1, iy);
  const c = texHash(ix, iy + 1);
  const d = texHash(ix + 1, iy + 1);
  const ab = fr(a + fr(fr(b - a) * sx));
  const cd = fr(c + fr(fr(d - c) * sx));
  return fr(ab + fr(fr(cd - ab) * sy));
}

/** The procedural height at `(x, y)` for the chosen `texture` (1 Sandstone, 2 Brick, 3 Burlap, else
 *  Canvas), given the cell `period` and `f = TAU/period`. Exposed for testing. */
export function texturizerHeight(x: number, y: number, texture: number, period: number, f: number): number {
  if (texture === 1) return texNoise(fr(x / period), fr(y / period)); // Sandstone
  if (texture === 2) {
    // Brick: offset alternate rows; mortar (0) around raised bricks (1).
    const row = Math.floor(fr(y / period));
    const off = (row & 1) === 0 ? 0 : fr(period * 0.5);
    const bx = Math.abs(fract(fr(fr(x + off) / period)));
    const by = Math.abs(fract(fr(y / period)));
    const m = fr(0.12);
    return bx < m || bx > fr(1 - m) || by < m || by > fr(1 - m) ? 0 : 1;
  }
  // Canvas / Burlap use cosine threads (the ≤1 LSB trig sites).
  const cx = fr(0.5 + fr(0.5 * fr(Math.cos(fr(x * f))))); // 0.5 + 0.5·cos(xf·f)
  const halfCosY = fr(0.5 * fr(Math.cos(fr(y * f)))); // 0.5·cos(yf·f)
  if (texture === 3) return Math.max(cx, fr(0.5 + halfCosY)); // Burlap: max(0.5+0.5cosx, 0.5+0.5cosy)
  return fr(fr(fr(cx + 0.5) + halfCosY) * 0.5); // Canvas: (0.5+0.5cosx + 0.5 + 0.5cosy)·0.5
}

/** Apply Texturizer to a single-channel (grey) 2-D image (u16 values 0..65535). `texture` 0 Canvas /
 *  1 Sandstone / 2 Brick / 3 Burlap; `scaling` ∈ [0,1] sets the cell period; `relief` ∈ [0,1] the
 *  emboss strength (≤0 ⇒ no-op); `light` 0..7 the light direction; `invert` flips the relief. Does
 *  not mutate the input. */
export function texturizer2D(
  image: readonly (readonly number[])[],
  texture: number,
  scaling: number,
  relief: number,
  light: number,
  invert: boolean,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const rel = clamp01(fr(relief));
  // The engine early-returns only on `rel ≤ 0` (false for NaN, which then propagates to an all-zero
  // image via `NaN as u16 == 0` — handled in the saturating cast below).
  if (w === 0 || rel <= 0) return image.map((row) => [...row]);
  const tex = texture & 0xff; // `texture` is a u8 at the wasm boundary (truncates a fractional value)
  const period = fr(4 + fr(28 * clamp01(fr(scaling))));
  const f = fr(TAU / period);
  const [lx, ly] = DIRS[light & 7];
  const sign = invert ? -1 : 1;
  return image.map((row, y) =>
    row.map((v, x) => {
      const shade = fr(fr(texturizerHeight(x, y, tex, period, f) - texturizerHeight(x + lx, y + ly, tex, period, f)) * sign);
      const d = fr(fr(shade * rel) * AMP); // cov 1
      const out = fr(v + d);
      // `as u16` saturates: NaN→0, <0→0, >max→max, else truncate.
      return out !== out ? 0 : Math.trunc(out < 0 ? 0 : out > TEXTURIZER_MAX ? TEXTURIZER_MAX : out);
    }),
  );
}
