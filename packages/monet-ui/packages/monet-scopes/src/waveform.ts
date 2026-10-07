// Waveform monitor display for the luma-density grid produced by the SHARED
// engine op `Engine.waveform(cols, rows)` (packages/engine — Rec.709 luma,
// cols×rows row-major, log-normalized 0..1, white at the top row). The compute
// lives in the shared engine so monet-vision AND monet-artisan render an
// identical scope; this module is only the display side (green intensity trace
// + IRE graticule).
//
// Shared here in @monet-ui/monet-scopes so monet-vision AND monet-artisan import
// the SAME display module (previously each app kept a hand-synced copy). The
// engine op they both call is the single source of truth for the data. Paired
// with vectorscope.ts.

/** The five IRE graticule levels (0/25/50/75/100) as vertical positions.
 *  `yFrac` is the 0..1 distance from the TOP of the scope — 100 IRE (white)
 *  sits at the top (0), 0 IRE (black) at the bottom (1), matching the engine
 *  grid's white-at-row-0 layout. */
export function ireLines(): { ire: number; yFrac: number }[] {
  return [0, 25, 50, 75, 100].map((ire) => ({ ire, yFrac: (100 - ire) / 100 }));
}

/** Draw the waveform density grid to a rectangular 2D context (`w`×`h` px):
 *  a dark background, a green intensity trace (brighter = more pixels at that
 *  column/luma), and IRE graticule lines. `grid` is the engine's cols×rows
 *  row-major 0..1 array. */
export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  grid: Float32Array | number[],
  cols: number,
  rows: number,
  w: number,
  h: number,
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0b0d10";
  ctx.fillRect(0, 0, w, h);

  const cw = w / cols;
  const ch = h / rows;
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const v = grid[gy * cols + gx];
      if (!v || v <= 0.02) continue;
      // green broadcast trace; opacity scales with column/luma density
      ctx.fillStyle = `rgba(120, 240, 140, ${v.toFixed(3)})`;
      ctx.fillRect(gx * cw, gy * ch, cw + 0.5, ch + 0.5);
    }
  }

  drawIreGraticule(ctx, w, h);
}

/** IRE graticule (horizontal reference lines + labels) shared by both scopes. */
function drawIreGraticule(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.lineWidth = 1;
  ctx.font = "9px var(--font-mono, monospace)";
  ctx.textBaseline = "middle";
  for (const { ire, yFrac } of ireLines()) {
    // (#212) clamp to the last drawable row — 0 IRE has yFrac 1, so the raw
    // h + 0.5 centred a 1px stroke entirely BELOW the canvas and the black
    // reference line never rendered (the label was already clamped).
    const y = Math.min(h - 0.5, Math.round(yFrac * h) + 0.5);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(String(ire), 2, Math.min(h - 6, Math.max(6, yFrac * h)));
  }
}

// Per-channel trace colours for the RGB overlay (additive → overlaps brighten).
const RGB_TRACE = ["rgba(255,90,90,", "rgba(90,235,120,", "rgba(100,150,255,"];

/** Paint one cols×rows density plane of `grid` (starting at `base`) into the
 *  rect (x0,0,pw,h). Shared by the overlaid RGB waveform and the parade. */
function drawPlane(
  ctx: CanvasRenderingContext2D,
  grid: Float32Array | number[],
  base: number,
  cols: number,
  rows: number,
  x0: number,
  pw: number,
  h: number,
  trace: string,
): void {
  const cw = pw / cols;
  const ch = h / rows;
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const v = grid[base + gy * cols + gx];
      if (!v || v <= 0.02) continue;
      const x = x0 + gx * cw;
      ctx.fillStyle = trace + v.toFixed(3) + ")";
      // +0.5 overdraw closes seams between cells, clamped so the last column
      // cannot bleed into the neighbouring parade panel
      ctx.fillRect(x, gy * ch, Math.min(cw + 0.5, x0 + pw - x), ch + 0.5);
    }
  }
}

/** Draw the RGB waveform: three stacked per-channel density grids (R,G,B, each
 *  cols×rows, from `Engine.waveform_rgb`) overlaid additively — so a neutral
 *  image shows a single white trace and colour casts split into coloured ones. */
export function drawWaveformRgb(
  ctx: CanvasRenderingContext2D,
  grid: Float32Array | number[],
  cols: number,
  rows: number,
  w: number,
  h: number,
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0b0d10";
  ctx.fillRect(0, 0, w, h);

  const plane = cols * rows;
  ctx.globalCompositeOperation = "lighter"; // additive channel overlay
  for (let c = 0; c < 3; c++) drawPlane(ctx, grid, c * plane, cols, rows, 0, w, h, RGB_TRACE[c]);
  ctx.globalCompositeOperation = "source-over";
  drawIreGraticule(ctx, w, h);
}

/** Left edge + width of parade panel `c` (0=R, 1=G, 2=B) inside a `w`-wide
 *  scope. Equal thirds, floored to whole pixels so the dividers land on a
 *  pixel boundary and the last panel absorbs the rounding remainder. */
export function paradePanel(c: number, w: number): { x: number; width: number } {
  const x = Math.floor((c * w) / 3);
  return { x, width: Math.floor(((c + 1) * w) / 3) - x };
}

/** Draw the RGB Parade: the same three per-channel grids as `drawWaveformRgb`,
 *  but side by side in equal thirds (R | G | B) instead of stacked on top of
 *  each other — the broadcast parade layout, where a colour cast reads as one
 *  panel's trace sitting higher or lower than its neighbours. */
export function drawWaveformParade(
  ctx: CanvasRenderingContext2D,
  grid: Float32Array | number[],
  cols: number,
  rows: number,
  w: number,
  h: number,
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0b0d10";
  ctx.fillRect(0, 0, w, h);

  const plane = cols * rows;
  for (let c = 0; c < 3; c++) {
    const { x, width } = paradePanel(c, w);
    drawPlane(ctx, grid, c * plane, cols, rows, x, width, h, RGB_TRACE[c]);
    if (c > 0) {
      // panel divider — the parade's defining visual separation
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }
  }
  drawIreGraticule(ctx, w, h);
}
