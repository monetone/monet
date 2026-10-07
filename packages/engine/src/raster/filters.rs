// ─────────────────────────────────────────────────────────────
// Spatial filters — produce a filtered copy of the layer, then blend
// it back through the active Selection's coverage. Blurs run in
// premultiplied alpha to avoid dark halos at transparent edges.
// ─────────────────────────────────────────────────────────────

use crate::raster::color::to16;
use crate::raster::selection::Selection;

#[inline]
fn idx(x: i32, y: i32, w: i32, h: i32) -> usize {
    let cx = x.clamp(0, w - 1);
    let cy = y.clamp(0, h - 1);
    (cy * w + cx) as usize * 4
}

// Blend a fully-computed `filtered` buffer back into `px` by selection coverage.
pub fn blend_back(px: &mut [u16], filtered: &[u16], sel: &Selection) {
    let n = (sel.w * sel.h) as usize;
    for i in 0..n {
        let cov = sel.coverage(i);
        if cov <= 0.0 {
            continue;
        }
        let p = i * 4;
        if cov >= 1.0 {
            px[p] = filtered[p];
            px[p + 1] = filtered[p + 1];
            px[p + 2] = filtered[p + 2];
            px[p + 3] = filtered[p + 3];
        } else {
            for k in 0..4 {
                let a = px[p + k] as f32;
                let b = filtered[p + k] as f32;
                px[p + k] = (a + (b - a) * cov) as u16;
            }
        }
    }
}

// Filter ▸ Blur ▸ Average: find the single average colour of the image (or the
// selection) and fill that whole area with it. Averaged premultiplied so
// transparent pixels don't pull the colour toward black.
pub fn average(px: &mut [u16], w: u32, h: u32, sel: &Selection) {
    let n = (w * h) as usize;
    let mut acc = [0f64; 4]; // premultiplied colour + alpha, weighted by coverage
    let mut cov_sum = 0f64;
    for i in 0..n {
        let c = sel.coverage(i) as f64;
        if c <= 0.0 {
            continue;
        }
        let a = px[i * 4 + 3] as f64 / 65535.0;
        acc[0] += px[i * 4] as f64 / 65535.0 * a * c;
        acc[1] += px[i * 4 + 1] as f64 / 65535.0 * a * c;
        acc[2] += px[i * 4 + 2] as f64 / 65535.0 * a * c;
        acc[3] += a * c;
        cov_sum += c;
    }
    if cov_sum <= 0.0 {
        return;
    }
    let avg_a = (acc[3] / cov_sum) as f32;
    let avg = if acc[3] > 1e-9 {
        [
            to16((acc[0] / acc[3]) as f32),
            to16((acc[1] / acc[3]) as f32),
            to16((acc[2] / acc[3]) as f32),
            to16(avg_a),
        ]
    } else {
        [0, 0, 0, to16(avg_a)]
    };
    let mut filtered = vec![0u16; px.len()];
    for i in 0..n {
        filtered[i * 4..i * 4 + 4].copy_from_slice(&avg);
    }
    blend_back(px, &filtered, sel);
}

// Layer ▸ Matting ▸ Defringe: replace the colour of the layer's edge pixels
// (those touching transparency) with the colour bled in from the neighbouring
// interior, removing a contaminating halo. Alpha is left untouched; repeated
// `width` times so a thicker fringe is cleaned. Interior pixels never change.
fn alpha_at(buf: &[u16], wi: i32, hi: i32, x: i32, y: i32) -> u16 {
    if x < 0 || y < 0 || x >= wi || y >= hi {
        0
    } else {
        buf[(y * wi + x) as usize * 4 + 3]
    }
}
fn is_fringe(buf: &[u16], wi: i32, hi: i32, x: i32, y: i32) -> bool {
    alpha_at(buf, wi, hi, x, y) > 0
        && (alpha_at(buf, wi, hi, x - 1, y) == 0
            || alpha_at(buf, wi, hi, x + 1, y) == 0
            || alpha_at(buf, wi, hi, x, y - 1) == 0
            || alpha_at(buf, wi, hi, x, y + 1) == 0)
}
pub fn defringe(px: &mut [u16], w: u32, h: u32, sel: &Selection, width: i32) {
    let (wi, hi) = (w as i32, h as i32);
    let mut buf = px.to_vec();
    for _ in 0..width.max(1) {
        let src = buf.clone();
        for y in 0..hi {
            for x in 0..wi {
                if !is_fringe(&src, wi, hi, x, y) {
                    continue;
                }
                // average the colour of opaque, non-fringe (interior) neighbours
                let mut acc = [0f32; 3];
                let mut n = 0f32;
                for (dx, dy) in [
                    (-1, -1),
                    (0, -1),
                    (1, -1),
                    (-1, 0),
                    (1, 0),
                    (-1, 1),
                    (0, 1),
                    (1, 1),
                ] {
                    let (nx, ny) = (x + dx, y + dy);
                    if alpha_at(&src, wi, hi, nx, ny) > 0 && !is_fringe(&src, wi, hi, nx, ny) {
                        let i = (ny * wi + nx) as usize * 4;
                        acc[0] += src[i] as f32;
                        acc[1] += src[i + 1] as f32;
                        acc[2] += src[i + 2] as f32;
                        n += 1.0;
                    }
                }
                if n > 0.0 {
                    let di = (y * wi + x) as usize * 4;
                    buf[di] = (acc[0] / n).round() as u16;
                    buf[di + 1] = (acc[1] / n).round() as u16;
                    buf[di + 2] = (acc[2] / n).round() as u16;
                    // alpha (buf[di+3]) preserved
                }
            }
        }
    }
    blend_back(px, &buf, sel);
}

// Layer ▸ Matting ▸ Remove White Matte / Remove Black Matte: un-mix a matte
// colour from the anti-aliased (partially transparent) edge pixels of a layer.
// Each such pixel's stored straight colour `C` is assumed to be `true·a +
// matte·(1−a)`, so the true colour is recovered as `(C − matte·(1−a)) / a`.
// `white` true removes a white matte, false a black one. Fully opaque/transparent
// pixels are left alone.
pub fn remove_matte(px: &mut [u16], sel: &Selection, white: bool) {
    let matte = if white { 1.0f32 } else { 0.0 };
    let n = px.len() / 4;
    let mut filtered = px.to_vec();
    for i in 0..n {
        let a = px[i * 4 + 3] as f32 / 65535.0;
        if a <= 0.0 || a >= 1.0 {
            continue; // only the partial-alpha (matted) edge pixels
        }
        for c in 0..3 {
            let cv = px[i * 4 + c] as f32 / 65535.0;
            filtered[i * 4 + c] = to16(((cv - matte * (1.0 - a)) / a).clamp(0.0, 1.0));
        }
        // alpha preserved
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Blur ▸ Smart Blur: an edge-aware blur with three modes. An "edge" is
// where a neighbour within `radius` differs in luminance by more than
// `threshold` (0..255). `mode` 0 Normal (blur only across same-side neighbours,
// so edges stay crisp), 1 Edge Only (white edges on black), 2 Overlay Edge
// (the Normal blur with white edges drawn over it). `quality` 0 Low samples a
// sparse integer grid, 1 Medium keeps the full integer grid, and 2 High samples
// the same radius at half-pixel intervals with bilinear interpolation.
pub fn smart_blur(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    radius: i32,
    threshold: f32,
    mode: u8,
    quality: u8,
) {
    let (wi, hi) = (w as i32, h as i32);
    let r = radius.max(1);
    let thr = (threshold / 255.0).clamp(0.0, 1.0);
    let src = px.to_vec();
    let lum = |i: usize| -> f32 {
        (src[i] as f32 * 0.299 + src[i + 1] as f32 * 0.587 + src[i + 2] as f32 * 0.114) / 65535.0
    };
    let mut filtered = src.clone();
    for y in 0..hi {
        for x in 0..wi {
            let ci = (y * wi + x) as usize * 4;
            let lc = lum(ci);
            let mut acc = [0f32; 4]; // premultiplied colour + alpha
            let mut wsum = 0f32;
            let mut max_diff = 0f32;
            let scale = if quality >= 2 { 2 } else { 1 };
            for sy in -(r * scale)..=(r * scale) {
                for sx in -(r * scale)..=(r * scale) {
                    if quality == 0 && r > 1 && (sx.abs() % 2 != 0 || sy.abs() % 2 != 0) {
                        continue;
                    }
                    let sample = if scale == 1 {
                        let nx = (x + sx).clamp(0, wi - 1);
                        let ny = (y + sy).clamp(0, hi - 1);
                        let ni = (ny * wi + nx) as usize * 4;
                        [
                            src[ni] as f32 / 65535.0,
                            src[ni + 1] as f32 / 65535.0,
                            src[ni + 2] as f32 / 65535.0,
                            src[ni + 3] as f32 / 65535.0,
                        ]
                    } else {
                        let fx = (x as f32 + sx as f32 / 2.0).clamp(0.0, (wi - 1) as f32);
                        let fy = (y as f32 + sy as f32 / 2.0).clamp(0.0, (hi - 1) as f32);
                        let x0 = fx.floor() as i32;
                        let y0 = fy.floor() as i32;
                        let x1 = (x0 + 1).min(wi - 1);
                        let y1 = (y0 + 1).min(hi - 1);
                        let tx = fx - x0 as f32;
                        let ty = fy - y0 as f32;
                        let at = |xx: i32, yy: i32, c: usize| {
                            src[(yy * wi + xx) as usize * 4 + c] as f32 / 65535.0
                        };
                        let mut out = [0.0; 4];
                        for (c, value) in out.iter_mut().enumerate() {
                            let top = at(x0, y0, c) * (1.0 - tx) + at(x1, y0, c) * tx;
                            let bottom = at(x0, y1, c) * (1.0 - tx) + at(x1, y1, c) * tx;
                            *value = top * (1.0 - ty) + bottom * ty;
                        }
                        out
                    };
                    let sample_lum = sample[0] * 0.299 + sample[1] * 0.587 + sample[2] * 0.114;
                    let d = (sample_lum - lc).abs();
                    if d > max_diff {
                        max_diff = d;
                    }
                    if d <= thr {
                        // a same-side neighbour — include it in the edge-preserving blur
                        let a = sample[3];
                        acc[0] += sample[0] * a;
                        acc[1] += sample[1] * a;
                        acc[2] += sample[2] * a;
                        acc[3] += a;
                        wsum += 1.0;
                    }
                }
            }
            let is_edge = max_diff > thr;
            let di = ci;
            match mode {
                1 => {
                    // Edge Only: white where an edge is, black elsewhere.
                    let v = if is_edge { 65535 } else { 0 };
                    filtered[di] = v;
                    filtered[di + 1] = v;
                    filtered[di + 2] = v;
                }
                2 if is_edge => {
                    filtered[di] = 65535;
                    filtered[di + 1] = 65535;
                    filtered[di + 2] = 65535;
                }
                _ => {
                    // Normal (and the non-edge pixels of Overlay): the threshold-
                    // gated premultiplied average.
                    let a = acc[3] / wsum.max(1.0);
                    if a > 1e-4 {
                        filtered[di] = to16(acc[0] / wsum.max(1.0) / a);
                        filtered[di + 1] = to16(acc[1] / wsum.max(1.0) / a);
                        filtered[di + 2] = to16(acc[2] / wsum.max(1.0) / a);
                    }
                }
            }
            // alpha preserved from the clone
        }
    }
    blend_back(px, &filtered, sel);
}

// Build a 1-D Gaussian kernel for the given radius (sigma = radius/2).
fn gaussian_kernel(radius: f32) -> (Vec<f32>, i32) {
    let r = radius.max(0.0).ceil() as i32;
    if r < 1 {
        return (vec![1.0], 0);
    }
    let sigma = (radius / 2.0).max(0.5);
    let mut k = Vec::with_capacity((2 * r + 1) as usize);
    let mut sum = 0.0;
    for i in -r..=r {
        let v = (-(i * i) as f32 / (2.0 * sigma * sigma)).exp();
        k.push(v);
        sum += v;
    }
    for v in k.iter_mut() {
        *v /= sum;
    }
    (k, r)
}

pub fn gaussian_blur(px: &mut [u16], w: u32, h: u32, sel: &Selection, radius: f32) {
    if radius < 0.1 { return; }
    let mut native: Vec<f32> = px.iter().map(|v| *v as f32 / 65535.0).collect();
    gaussian_blur_f32(&mut native, w, h, radius);
    // Keep the integer path's existing near-transparent rounding convention.
    let filtered: Vec<u16> = native.chunks_exact(4).flat_map(|p| {
        [if p[3] > 1e-4 { to16(p[0]) } else { 0 },
         if p[3] > 1e-4 { to16(p[1]) } else { 0 },
         if p[3] > 1e-4 { to16(p[2]) } else { 0 }, to16(p[3])]
    }).collect();
    blend_back(px, &filtered, sel);
}

pub(crate) fn gaussian_blur_f32(px: &mut [f32], w: u32, h: u32, radius: f32) {
    if radius < 0.1 {
        return;
    }
    let (w, h) = (w as i32, h as i32);
    let (kernel, r) = gaussian_kernel(radius);
    let n = (w * h) as usize;

    // premultiply into f32
    let mut pm = vec![0f32; n * 4];
    for i in 0..n {
        let a = px[i * 4 + 3];
        pm[i * 4] = px[i * 4] * a;
        pm[i * 4 + 1] = px[i * 4 + 1] * a;
        pm[i * 4 + 2] = px[i * 4 + 2] * a;
        pm[i * 4 + 3] = a;
    }

    // horizontal pass
    let mut tmp = vec![0f32; n * 4];
    for y in 0..h {
        for x in 0..w {
            let mut acc = [0f32; 4];
            for (ki, kv) in kernel.iter().enumerate() {
                let sx = (x + ki as i32 - r).clamp(0, w - 1);
                let si = (y * w + sx) as usize * 4;
                acc[0] += pm[si] * kv;
                acc[1] += pm[si + 1] * kv;
                acc[2] += pm[si + 2] * kv;
                acc[3] += pm[si + 3] * kv;
            }
            let di = (y * w + x) as usize * 4;
            tmp[di..di + 4].copy_from_slice(&acc);
        }
    }
    // The kernel rarely sums to exactly 1 in f32. An all-opaque neighbourhood
    // accumulates to exactly `opaque`; rounding is monotone, so nothing less opaque exceeds it.
    let wsum: f32 = kernel.iter().sum();
    let opaque: f32 = kernel.iter().map(|kv| wsum * kv).sum();
    // Vertical pass, then unpremultiply directly into the destination.
    for y in 0..h {
        for x in 0..w {
            let mut acc = [0f32; 4];
            for (ki, kv) in kernel.iter().enumerate() {
                let sy = (y + ki as i32 - r).clamp(0, h - 1);
                let si = (sy * w + x) as usize * 4;
                acc[0] += tmp[si] * kv;
                acc[1] += tmp[si + 1] * kv;
                acc[2] += tmp[si + 2] * kv;
                acc[3] += tmp[si + 3] * kv;
            }
            let di = (y * w + x) as usize * 4;
            let a = acc[3];
            for c in 0..3 {
                px[di + c] = if a > 0.0 { acc[c] / a } else { 0.0 };
            }
            px[di + 3] = if a >= opaque { 1.0 } else { a.clamp(0.0, 1.0) };
        }
    }
}

pub(crate) fn unsharp_mask_f32(px: &mut [f32], w: u32, h: u32, radius: f32, amount: f32, threshold: f32) {
    let mut blurred = px.to_vec();
    gaussian_blur_f32(&mut blurred, w, h, radius.max(0.3));
    for (pixel, blur) in px.chunks_exact_mut(4).zip(blurred.chunks_exact(4)) {
        for channel in 0..3 {
            let difference = pixel[channel] - blur[channel];
            if difference.abs() >= threshold {
                pixel[channel] += difference * amount;
            }
        }
    }
}

pub fn box_blur(px: &mut [u16], w: u32, h: u32, sel: &Selection, radius: i32) {
    if radius < 1 {
        return;
    }
    let (w, h) = (w as i32, h as i32);
    let n = (w * h) as usize;
    let src = px.to_vec();
    let mut filtered = vec![0u16; n * 4];
    let area = ((2 * radius + 1) * (2 * radius + 1)) as f32;
    for y in 0..h {
        for x in 0..w {
            // Premultiplied accumulate: transparent neighbours contribute no
            // color, so content edges blur to transparency without the dark
            // halo a straight-channel average paints in (RGB of alpha-0
            // pixels is typically black).
            let mut acc = [0f32; 4];
            for dy in -radius..=radius {
                for dx in -radius..=radius {
                    let si = idx(x + dx, y + dy, w, h);
                    let a = src[si + 3] as f32 / 65535.0;
                    acc[0] += src[si] as f32 / 65535.0 * a;
                    acc[1] += src[si + 1] as f32 / 65535.0 * a;
                    acc[2] += src[si + 2] as f32 / 65535.0 * a;
                    acc[3] += a;
                }
            }
            let di = (y * w + x) as usize * 4;
            let a = acc[3] / area;
            if a > 1e-4 {
                filtered[di] = to16(acc[0] / area / a);
                filtered[di + 1] = to16(acc[1] / area / a);
                filtered[di + 2] = to16(acc[2] / area / a);
            }
            filtered[di + 3] = to16(a);
        }
    }
    blend_back(px, &filtered, sel);
}

// Unsharp mask: sharpen by `amount` using a Gaussian of `radius`; only push
// differences above `threshold` (0..1).
pub fn unsharp_mask(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    radius: f32,
    amount: f32,
    threshold: f32,
) {
    let n = (w * h) as usize;
    let orig = px.to_vec();
    let mut blurred = px.to_vec();
    // blur a temp full-selection copy
    let full = Selection {
        w,
        h,
        active: false,
        mask: Vec::new(),
        antialias: true,
    };
    gaussian_blur(&mut blurred, w, h, &full, radius.max(0.3));
    let th = threshold * 65535.0;
    let mut filtered = orig.clone();
    for i in 0..n {
        for k in 0..3 {
            let o = orig[i * 4 + k] as f32;
            let b = blurred[i * 4 + k] as f32;
            let diff = o - b;
            if diff.abs() >= th {
                filtered[i * 4 + k] = (o + diff * amount).clamp(0.0, 65535.0) as u16;
            }
        }
    }
    blend_back(px, &filtered, sel);
}

pub fn sharpen(px: &mut [u16], w: u32, h: u32, sel: &Selection, amount: f32) {
    unsharp_mask(px, w, h, sel, 1.0, amount, 0.0);
}

// Add noise. `amount` 0..1, monochromatic toggles per-channel vs shared,
// `gaussian` switches the flat uniform distribution for a bell curve whose tails
// exceed `amount` (Photoshop's Uniform vs Gaussian option).
pub fn add_noise(
    px: &mut [u16],
    sel: &Selection,
    amount: f32,
    monochromatic: bool,
    gaussian: bool,
    seed: u32,
) {
    let n = (sel.w * sel.h) as usize;
    let mut state = seed | 1;
    let mut next = || {
        // xorshift32
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        (state as f32 / u32::MAX as f32) * 2.0 - 1.0
    };
    // A deviation in roughly [-1, 1] (uniform) or ~N(0, 1) (gaussian, via Box-Muller).
    let mut dev = || {
        if gaussian {
            let u1 = ((next() + 1.0) * 0.5).max(1e-6);
            let u2 = (next() + 1.0) * 0.5;
            (-2.0 * u1.ln()).sqrt() * (std::f32::consts::TAU * u2).cos()
        } else {
            next()
        }
    };
    let amt = amount * 65535.0;
    for i in 0..n {
        let cov = sel.coverage(i);
        if cov <= 0.0 {
            // still advance PRNG so the field is stable regardless of selection? skip for speed
            continue;
        }
        let p = i * 4;
        if monochromatic {
            let d = dev() * amt * cov;
            for k in 0..3 {
                px[p + k] = (px[p + k] as f32 + d).clamp(0.0, 65535.0) as u16;
            }
        } else {
            for k in 0..3 {
                let d = dev() * amt * cov;
                px[p + k] = (px[p + k] as f32 + d).clamp(0.0, 65535.0) as u16;
            }
        }
    }
}

// Filter ▸ Artistic ▸ Film Grain — even monochromatic photographic grain with a
// highlight-protection control. `grain` 0..1 = amount, `intensity` 0..1 boosts the
// grain, `highlight` 0..1 = Highlight Area (raises how much of the bright range is
// protected — brighter pixels get progressively less grain, →0 at white). Distinct
// from Add Noise, which has no highlight protection. grain==0 is a no-op.
pub fn film_grain(
    px: &mut [u16],
    sel: &Selection,
    grain: f32,
    highlight: f32,
    intensity: f32,
    seed: u32,
) {
    let n = (sel.w * sel.h) as usize;
    let mut state = seed | 1;
    let mut next = || {
        // xorshift32 (same PRNG as add_noise) → deterministic per seed
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        (state as f32 / u32::MAX as f32) * 2.0 - 1.0
    };
    let amt = grain * (0.08 + 0.12 * intensity.clamp(0.0, 1.0)) * 65535.0;
    let thresh = (1.0 - highlight.clamp(0.0, 1.0)) * 65535.0;
    for i in 0..n {
        let cov = sel.coverage(i);
        if cov <= 0.0 {
            let _ = next(); // keep the grain field position-stable regardless of selection
            continue;
        }
        let p = i * 4;
        let luma = 0.299 * px[p] as f32 + 0.587 * px[p + 1] as f32 + 0.114 * px[p + 2] as f32;
        let protect = if luma <= thresh {
            1.0
        } else {
            ((65535.0 - luma) / (65535.0 - thresh).max(1.0)).clamp(0.0, 1.0)
        };
        let d = next() * amt * protect * cov; // one monochromatic delta per pixel
        for k in 0..3 {
            px[p + k] = (px[p + k] as f32 + d).clamp(0.0, 65535.0) as u16;
        }
    }
}

// Camera Raw ▸ Basic ▸ Texture — mid-frequency local contrast. Adds the
// high-frequency luminance detail (`lum − gaussian(lum, radius)`) back into every
// channel, scaled by `amount`, so mid-scale texture (skin pores, foliage) pops
// without touching global tone. Luminance-only (hue preserved), alpha untouched.
// Flat regions have zero detail so they stay byte-identical; `amount == 0` (or a
// sub-pixel radius) is a no-op. `radius` is a parameter so the develop op can
// shrink it by `proxyScale` for preview parity.
pub fn texture_boost(px: &mut [u16], w: u32, h: u32, sel: &Selection, amount: f32, radius: f32) {
    if amount == 0.0 || radius <= 0.0 {
        return;
    }
    let n = (w * h) as usize;
    let mut lum = vec![0f32; n];
    for i in 0..n {
        let p = i * 4;
        lum[i] = 0.299 * px[p] as f32 + 0.587 * px[p + 1] as f32 + 0.114 * px[p + 2] as f32;
    }
    let mut base = lum.clone();
    crate::raster::adjust::blur_f32(&mut base, w, h, radius);
    for i in 0..n {
        let cov = sel.coverage(i);
        if cov <= 0.0 {
            continue;
        }
        let detail = (lum[i] - base[i]) * amount * cov;
        if detail == 0.0 {
            continue;
        }
        let p = i * 4;
        for k in 0..3 {
            px[p + k] = (px[p + k] as f32 + detail).clamp(0.0, 65535.0) as u16;
        }
    }
}

// Filter ▸ Brush Strokes ▸ Crosshatch — diagonal pencil hatching that follows the
// image tones: shadows get denser/darker hatch lines (in both ±45° directions),
// highlights stay clean. `length` 0..1 → hatch spacing, `sharpness` 0..1 → line
// crispness (thinner, sharper lines), `strength` 0..1 → darkening amount.
// strength==0 is a no-op.
pub fn crosshatch(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    length: f32,
    sharpness: f32,
    strength: f32,
) {
    let str_ = strength.clamp(0.0, 1.0);
    if str_ <= 0.0 {
        return;
    }
    let (wi, hi) = (w as i32, h as i32);
    let spacing = 3.0 + 9.0 * length.clamp(0.0, 1.0); // px between hatch lines (3..12)
    let half = (0.5 - 0.42 * sharpness.clamp(0.0, 1.0)).clamp(0.08, 0.5); // line half-width (period fraction)
                                                                          // A hatch factor for a diagonal phase: 1 on the line centre, fading to 0 at `half`.
    let line = |v: f32| -> f32 {
        let f = v.rem_euclid(spacing) / spacing; // 0..1 within a period
        let d = f.min(1.0 - f); // distance to the nearest line centre (lines at f==0)
        if d < half {
            1.0 - d / half
        } else {
            0.0
        }
    };
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let p = i * 4;
            let luma = (0.299 * px[p] as f32 + 0.587 * px[p + 1] as f32 + 0.114 * px[p + 2] as f32)
                / 65535.0;
            let darkness = 1.0 - luma;
            let hatch = line((x + y) as f32).max(line((x - y) as f32));
            let darken = str_ * darkness * hatch * cov;
            for k in 0..3 {
                px[p + k] = (px[p + k] as f32 * (1.0 - darken)).clamp(0.0, 65535.0) as u16;
            }
        }
    }
}

// Filter ▸ Brush Strokes ▸ Accented Edges — find edges (Sobel on luma) and accent
// them toward a colour: `brightness` 0..1 picks the accent (1 = white edges, 0 =
// black edges); `width` 0..1 strengthens/thickens the accent; `smoothness` 0..1
// raises the gradient threshold (fewer, softer edges). Flat areas are unchanged.
pub fn accented_edges(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    width: f32,
    brightness: f32,
    smoothness: f32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let src = px.to_vec(); // edges read the original neighbourhood
    let luma = |i: usize| {
        0.299 * src[i * 4] as f32 + 0.587 * src[i * 4 + 1] as f32 + 0.114 * src[i * 4 + 2] as f32
    };
    let at = |x: i32, y: i32| (y.clamp(0, hi - 1) * wi + x.clamp(0, wi - 1)) as usize;
    let gain = 1.0 + 6.0 * width.clamp(0.0, 1.0);
    let thresh = 4000.0 + 30000.0 * smoothness.clamp(0.0, 1.0);
    let edge_color = brightness.clamp(0.0, 1.0) * 65535.0;
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let l = |dx: i32, dy: i32| luma(at(x + dx, y + dy));
            let gx = (l(1, -1) + 2.0 * l(1, 0) + l(1, 1)) - (l(-1, -1) + 2.0 * l(-1, 0) + l(-1, 1));
            let gy = (l(-1, 1) + 2.0 * l(0, 1) + l(1, 1)) - (l(-1, -1) + 2.0 * l(0, -1) + l(1, -1));
            let mag = (gx * gx + gy * gy).sqrt();
            let edge = (mag / thresh * gain).clamp(0.0, 1.0) * cov;
            let p = i * 4;
            for k in 0..3 {
                let v = src[p + k] as f32;
                px[p + k] = (v + (edge_color - v) * edge).clamp(0.0, 65535.0) as u16;
            }
        }
    }
}

// Filter ▸ Brush Strokes ▸ Ink Outlines: redraw the image with fine dark ink lines over
// the original details (pen-and-ink) — strong edges are inked toward black (Dark
// Intensity) while the flat (non-edge) areas are brightened toward white (Light
// Intensity); the image shows through between the lines. `stroke_length` 0..1 scales the
// edge gain (more/thicker ink), `dark_intensity` / `light_intensity` 0..1. Uses the same
// Sobel operator as Accented Edges. Deterministic, off the hot path; RGB only (alpha kept).
pub fn ink_outlines(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    stroke_length: f32,
    dark_intensity: f32,
    light_intensity: f32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let src = px.to_vec();
    let luma = |i: usize| {
        0.299 * src[i * 4] as f32 + 0.587 * src[i * 4 + 1] as f32 + 0.114 * src[i * 4 + 2] as f32
    };
    let at = |x: i32, y: i32| (y.clamp(0, hi - 1) * wi + x.clamp(0, wi - 1)) as usize;
    let gain = 0.5 + 2.0 * stroke_length.clamp(0.0, 1.0); // longer stroke → more edge ink
    let dark = dark_intensity.clamp(0.0, 1.0);
    let light = light_intensity.clamp(0.0, 1.0);
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let l = |dx: i32, dy: i32| luma(at(x + dx, y + dy));
            let gx = (l(1, -1) + 2.0 * l(1, 0) + l(1, 1)) - (l(-1, -1) + 2.0 * l(-1, 0) + l(-1, 1));
            let gy = (l(-1, 1) + 2.0 * l(0, 1) + l(1, 1)) - (l(-1, -1) + 2.0 * l(0, -1) + l(1, -1));
            let edge = ((gx * gx + gy * gy).sqrt() / 30000.0 * gain).clamp(0.0, 1.0); // 0..1 edge strength
            let p = i * 4;
            for c in 0..3 {
                let v = src[p + c] as f32;
                let inked = v * (1.0 - edge * dark); // strong edges → dark ink
                let out = inked + (65535.0 - inked) * (1.0 - edge) * light; // flats → toward white
                px[p + c] = (v + (out - v) * cov).clamp(0.0, 65535.0) as u16;
            }
            // alpha preserved
        }
    }
}

// Filter ▸ Brush Strokes ▸ Angled Strokes: repaint with diagonal strokes — lighter
// areas (luma ≥ balance) are smeared along the (1,1) diagonal, darker areas along the
// opposite (1,-1) diagonal, so the image reads as angled brush strokes in an X. `length`
// is the stroke half-length in px (0 = none), `balance` 0..1 the light/dark split, and
// `sharpness` 0..1 blends the smear back toward the original (higher = sharper). Uses the
// image's own colours; RGB only (alpha preserved). Deterministic, off the hot path.
pub fn angled_strokes(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    length: i32,
    balance: f32,
    sharpness: f32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let len = length.max(0);
    if len == 0 {
        return; // no strokes → identity
    }
    let thr = balance.clamp(0.0, 1.0);
    let keep = sharpness.clamp(0.0, 1.0); // higher sharpness keeps more of the original
    let src = px.to_vec();
    let lum = |i: usize| {
        (src[i * 4] as f32 * 0.299 + src[i * 4 + 1] as f32 * 0.587 + src[i * 4 + 2] as f32 * 0.114)
            / 65535.0
    };
    let at = |x: i32, y: i32| (y.clamp(0, hi - 1) * wi + x.clamp(0, wi - 1)) as usize;
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let dir = if lum(i) >= thr { 1 } else { -1 }; // light → (1,1), dark → (1,-1)
            let mut sum = [0f32; 3];
            let mut cnt = 0.0;
            for k in -len..=len {
                let s = at(x + k, y + k * dir) * 4;
                for c in 0..3 {
                    sum[c] += src[s + c] as f32;
                }
                cnt += 1.0;
            }
            let p = i * 4;
            for c in 0..3 {
                let blurred = sum[c] / cnt;
                let orig = src[p + c] as f32;
                let out = blurred + (orig - blurred) * keep; // sharpness blends back toward the original
                px[p + c] = (orig + (out - orig) * cov).clamp(0.0, 65535.0) as u16;
            }
            // alpha (p+3) preserved
        }
    }
}

// Filter ▸ Brush Strokes ▸ Dark Strokes: paints dark areas with short, tight, dark
// strokes and lighter areas with long, white strokes. Each pixel is first smeared
// along the (1,1) diagonal — a SHORT stroke in the dark zone, a LONG stroke in the
// light zone — then pushed toward black (in shadows) or white (in highlights).
// `balance` 0..1 is the light/dark split (luma < balance → dark zone), `black_intensity`
// 0..1 drives shadows toward black, `white_intensity` 0..1 drives highlights toward
// white. Image-based (no fg/bg); RGB only, alpha preserved. Deterministic, off the
// hot path. 0 black + 0 white is a no-op.
pub fn dark_strokes(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    balance: f32,
    black_intensity: f32,
    white_intensity: f32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let thr = balance.clamp(0.0, 1.0);
    let black = black_intensity.clamp(0.0, 1.0);
    let white = white_intensity.clamp(0.0, 1.0);
    if black <= 0.0 && white <= 0.0 {
        return; // no darkening and no lightening → identity
    }
    let src = px.to_vec();
    let lum = |i: usize| {
        (src[i * 4] as f32 * 0.299 + src[i * 4 + 1] as f32 * 0.587 + src[i * 4 + 2] as f32 * 0.114)
            / 65535.0
    };
    let at = |x: i32, y: i32| (y.clamp(0, hi - 1) * wi + x.clamp(0, wi - 1)) as usize;
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let is_dark = lum(i) < thr;
            let len = if is_dark { 1 } else { 4 }; // short dark strokes, long white strokes
            let mut sum = [0f32; 3];
            let mut cnt = 0.0;
            for k in -len..=len {
                let s = at(x + k, y + k) * 4;
                for c in 0..3 {
                    sum[c] += src[s + c] as f32;
                }
                cnt += 1.0;
            }
            let p = i * 4;
            for c in 0..3 {
                let smeared = sum[c] / cnt;
                let out = if is_dark {
                    smeared * (1.0 - black) // toward black
                } else {
                    smeared + (65535.0 - smeared) * white // toward white
                };
                let orig = src[p + c] as f32;
                px[p + c] = (orig + (out - orig) * cov).clamp(0.0, 65535.0) as u16;
            }
            // alpha (p+3) preserved
        }
    }
}

// Filter ▸ Brush Strokes ▸ Spatter: a spatter-airbrush scatter — each pixel is
// resampled from a random nearby offset within the spray disc, so smooth edges
// break into a ragged spray while flat areas stay flat. `spray_radius` 0..25 px
// sets the spread (0 = no effect); `smoothness` 1..15 simplifies the effect by
// shrinking the jitter. Deterministic (position-hashed via `tex_hash`), off the
// hot path. Reuses the value-noise hash that backs Texturizer / Ocean Ripple.
pub fn spatter(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    spray_radius: f32,
    smoothness: f32,
) {
    let (wi, hi) = (w as i32, h as i32);
    if spray_radius <= 0.0 {
        return; // no spray → identity
    }
    let src = px.to_vec();
    // Higher Smoothness simplifies the effect → smaller jitter (kept ≥25% so it still sprays).
    let amp = spray_radius * (1.0 - 0.05 * smoothness.clamp(0.0, 15.0)).max(0.25);
    // Every pixel (all 4 channels) is rewritten below, so no need to clone `src` first.
    let mut filtered = vec![0u16; src.len()];
    for y in 0..hi {
        for x in 0..wi {
            let di = (y * wi + x) as usize * 4;
            // Two decorrelated hashes → a random angle + distance in the spray disc.
            let ang = tex_hash(x, y) * std::f32::consts::TAU;
            let dist = tex_hash(x + 9173, y + 1337) * amp;
            let sx = (x as f32 + ang.cos() * dist)
                .round()
                .clamp(0.0, (wi - 1) as f32) as i32;
            let sy = (y as f32 + ang.sin() * dist)
                .round()
                .clamp(0.0, (hi - 1) as f32) as i32;
            let s = (sy * wi + sx) as usize * 4;
            filtered[di..di + 4].copy_from_slice(&src[s..s + 4]);
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Brush Strokes ▸ Sprayed Strokes: repaint with angled, sprayed strokes —
// each pixel resamples from a hash-jittered offset that streaks ALONG the chosen
// `direction` (0 Right Diagonal, 1 Horizontal, 2 Left Diagonal, 3 Vertical) up to
// ±`stroke_length` px, with a perpendicular spray of ±`spray_radius` px. Unlike
// Spatter's isotropic disc, the scatter is anisotropic (elongated along the stroke),
// so a boundary smears along the direction while staying crisp across it. Deterministic
// (position-hashed via `tex_hash`), off the hot path; 0 length + 0 radius is a no-op.
pub fn sprayed_strokes(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    stroke_length: f32,
    spray_radius: f32,
    direction: u8,
) {
    let (wi, hi) = (w as i32, h as i32);
    let len = stroke_length.max(0.0);
    let rad = spray_radius.max(0.0);
    if len <= 0.0 && rad <= 0.0 {
        return; // no stroke and no spray → identity
    }
    let d = std::f32::consts::FRAC_1_SQRT_2;
    let (dx, dy) = match direction {
        1 => (1.0, 0.0), // Horizontal
        2 => (d, -d),    // Left Diagonal
        3 => (0.0, 1.0), // Vertical
        _ => (d, d),     // Right Diagonal
    };
    let (px_perp, py_perp) = (-dy, dx); // perpendicular to the stroke
    let src = px.to_vec();
    let mut filtered = vec![0u16; src.len()];
    for y in 0..hi {
        for x in 0..wi {
            let di = (y * wi + x) as usize * 4;
            let along = (tex_hash(x, y) * 2.0 - 1.0) * len; // signed offset along the stroke
            let perp = (tex_hash(x + 9173, y + 1337) * 2.0 - 1.0) * rad; // perpendicular spray
            let sx = (x as f32 + dx * along + px_perp * perp)
                .round()
                .clamp(0.0, (wi - 1) as f32) as i32;
            let sy = (y as f32 + dy * along + py_perp * perp)
                .round()
                .clamp(0.0, (hi - 1) as f32) as i32;
            let s = (sy * wi + sx) as usize * 4;
            filtered[di..di + 4].copy_from_slice(&src[s..s + 4]);
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Brush Strokes ▸ Sumi-e: a Japanese wet-ink look — a soft box blur
// (`stroke_width`) gives the wet, blurry edges; `stroke_pressure` deepens the shadows
// toward jet-black (rich ink, concentrated in dark areas, barely touching highlights);
// `contrast` steepens the tonal spread around mid-gray. Image-based, deterministic,
// off the hot path. 0 width + 0 pressure + 0 contrast is a no-op.
pub fn sumi_e(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    stroke_width: f32,
    stroke_pressure: f32,
    contrast: f32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let r = (stroke_width.clamp(0.0, 1.0) * 4.0).round() as i32; // soft blur radius (0..4)
    let pressure = stroke_pressure.clamp(0.0, 1.0);
    let cf = 1.0 + contrast.clamp(0.0, 1.0) * 1.5; // contrast factor 1..2.5 around mid-gray
    if r == 0 && pressure <= 0.0 && cf <= 1.0 {
        return; // no blur, no ink, no contrast → identity
    }
    let src = px.to_vec();
    let mut filtered = src.clone();
    for y in 0..hi {
        for x in 0..wi {
            let p = (y * wi + x) as usize * 4;
            // 1) soft box blur → wet, blurry edges
            let mut sum = [0f32; 3];
            let mut cnt = 0.0;
            for dy in -r..=r {
                for dx in -r..=r {
                    let s = idx(x + dx, y + dy, wi, hi);
                    for c in 0..3 {
                        sum[c] += src[s + c] as f32;
                    }
                    cnt += 1.0;
                }
            }
            let v = [sum[0] / cnt, sum[1] / cnt, sum[2] / cnt];
            // 2) jet-black ink: darken by pressure, concentrated in shadows
            let lum_b = (v[0] * 0.299 + v[1] * 0.587 + v[2] * 0.114) / 65535.0;
            let ink = 1.0 - pressure * (1.0 - lum_b);
            // 3) contrast around mid-gray
            for c in 0..3 {
                let norm = (v[c] * ink / 65535.0 - 0.5) * cf + 0.5;
                filtered[p + c] = (norm * 65535.0).clamp(0.0, 65535.0) as u16;
            }
            // alpha (p+3) preserved from the src copy
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Texture ▸ Mosaic Tiles: draw the image as a grid of tiles with grout
// lines between them — the image shows through each tile while the grout darkens
// (or, with Lighten Grout, lightens) the lines on the grid. `tile_size` px is the
// tile pitch, `grout_width` px the line thickness, `lighten_grout` 0..1 fades the
// grout from black (0) to white (1). Deterministic, off the hot path; grout 0 = no-op.
pub fn mosaic_tiles(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    tile_size: i32,
    grout_width: i32,
    lighten_grout: f32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let tile = tile_size.max(2);
    let grout = grout_width.clamp(0, tile - 1);
    if grout <= 0 {
        return; // no grout → identity
    }
    let target = lighten_grout.clamp(0.0, 1.0) * 65535.0; // grout gray: 0 black .. 1 white
    let strength = 0.85; // how strongly the grout overrides the image
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            // grout occupies the first `grout` px of each tile cell (the lines between tiles)
            if x.rem_euclid(tile) >= grout && y.rem_euclid(tile) >= grout {
                continue; // tile interior — the image shows through
            }
            let p = i * 4;
            for k in 0..3 {
                let v = px[p + k] as f32;
                px[p + k] = (v + (target - v) * strength * cov).clamp(0.0, 65535.0) as u16;
            }
            // alpha preserved
        }
    }
}

// Filter ▸ Texture ▸ Patchwork: tile the image into raised square patches — each
// square cell takes its average colour, then a bevel relief lightens the top-left
// edge and darkens the bottom-right (brighter cells raised more), for a 3D mosaic-tile
// look. `size` px is the tile size, `relief` 0..1 the bevel depth. Two passes
// (per-cell average, then render); deterministic, off the hot path; alpha preserved.
pub fn patchwork(px: &mut [u16], w: u32, h: u32, sel: &Selection, size: i32, relief: f32) {
    let (wi, hi) = (w as i32, h as i32);
    let s = size.max(2);
    let rel = relief.clamp(0.0, 1.0);
    let src = px.to_vec();
    let cols = ((wi + s - 1) / s) as usize;
    let rows = ((hi + s - 1) / s) as usize;
    // pass 1: per-cell average RGB
    let mut sum = vec![[0f64; 3]; cols * rows];
    let mut cnt = vec![0f64; cols * rows];
    for y in 0..hi {
        for x in 0..wi {
            let cell = (y / s) as usize * cols + (x / s) as usize;
            let p = (y * wi + x) as usize * 4;
            for c in 0..3 {
                sum[cell][c] += src[p + c] as f64;
            }
            cnt[cell] += 1.0;
        }
    }
    let denom = (s as f32 - 1.0).max(1.0);
    // pass 2: render the cell average + the bevel shade
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let cell = (y / s) as usize * cols + (x / s) as usize;
            let n = cnt[cell].max(1.0);
            let avg = [
                (sum[cell][0] / n) as f32,
                (sum[cell][1] / n) as f32,
                (sum[cell][2] / n) as f32,
            ];
            // position within the tile, 0..1; top-left raised (+), bottom-right recessed (−)
            let fx = (x % s) as f32 / denom;
            let fy = (y % s) as f32 / denom;
            let bright = (avg[0] * 0.299 + avg[1] * 0.587 + avg[2] * 0.114) / 65535.0;
            let shade = ((0.5 - fx) + (0.5 - fy)) * rel * bright * 65535.0;
            let p = i * 4;
            for c in 0..3 {
                let out = (avg[c] + shade).clamp(0.0, 65535.0);
                let v = src[p + c] as f32;
                px[p + c] = (v + (out - v) * cov).clamp(0.0, 65535.0) as u16;
            }
            // alpha preserved
        }
    }
}

// Value noise (smooth hash lattice) for the Sandstone texture, in 0..1.
// pub(crate): also reused by the Ocean Ripple displacement field (mod.rs).
pub(crate) fn tex_hash(ix: i32, iy: i32) -> f32 {
    let mut n = (ix.wrapping_mul(374761393) ^ iy.wrapping_mul(668265263)) as u32;
    n = (n ^ (n >> 13)).wrapping_mul(1274126177);
    ((n >> 8) & 0xffff) as f32 / 65535.0
}
pub(crate) fn tex_noise(x: f32, y: f32) -> f32 {
    let (ix, iy) = (x.floor() as i32, y.floor() as i32);
    let (fx, fy) = (x - ix as f32, y - iy as f32);
    let (sx, sy) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy)); // smoothstep
    let a = tex_hash(ix, iy);
    let b = tex_hash(ix + 1, iy);
    let c = tex_hash(ix, iy + 1);
    let d = tex_hash(ix + 1, iy + 1);
    let ab = a + (b - a) * sx;
    let cd = c + (d - c) * sx;
    ab + (cd - ab) * sy
}

// Filter ▸ Texture ▸ Craquelure: paint the image onto a high-relief plaster surface
// with a fine network of cracks. The cracks follow the level-set of a smooth
// value-noise field — where |noise − 0.5| is small a dark groove is cut (depth), with
// a light ridge just beside it (brightness); the rest keeps the image (the plaster).
// `crack_spacing` px sets the crack scale (noise frequency); `crack_depth` and
// `crack_brightness` 0..1. Deterministic, off the hot path; crack_depth 0 = no-op.
pub fn craquelure(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    crack_spacing: f32,
    crack_depth: f32,
    crack_brightness: f32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let depth = crack_depth.clamp(0.0, 1.0);
    if depth <= 0.0 {
        return; // no cracks → identity
    }
    let bright = crack_brightness.clamp(0.0, 1.0);
    let freq = 1.0 / crack_spacing.max(2.0); // wider spacing → lower frequency → broader cracks
    let half = 0.06f32; // crack half-width in noise units
    let src = px.to_vec();
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let d = (tex_noise(x as f32 * freq, y as f32 * freq) - 0.5).abs(); // distance to the crack level-set
            let shade = if d < half {
                -depth * (1.0 - d / half) * 65535.0 // groove: darkest at the crack centre
            } else if d < half * 2.0 {
                bright * (1.0 - (d - half) / half) * 65535.0 // ridge: a light lip just beside the crack
            } else {
                0.0
            };
            if shade == 0.0 {
                continue; // plaster — keep the image
            }
            let p = i * 4;
            for c in 0..3 {
                let v = src[p + c] as f32;
                let out = (v + shade).clamp(0.0, 65535.0);
                px[p + c] = (v + (out - v) * cov).clamp(0.0, 65535.0) as u16;
            }
            // alpha preserved
        }
    }
}

fn texture_period(scaling: f32) -> f32 {
    4.0 + 28.0 * scaling.clamp(0.0, 1.0) // px per texture cell (4..32)
}

fn texture_surface_height(texture: u8, period: f32, x: i32, y: i32) -> f32 {
    let (xf, yf) = (x as f32, y as f32);
    let f = std::f32::consts::TAU / period;
    match texture {
        1 => tex_noise(xf / period, yf / period), // Sandstone
        2 => {
            // Brick: offset rows with mortar lines (low) around raised bricks (high).
            let row = (yf / period).floor();
            let off = if (row as i32) & 1 == 0 {
                0.0
            } else {
                period * 0.5
            };
            let bx = ((xf + off) / period).fract().abs();
            let by = (yf / period).fract().abs();
            let m = 0.12; // mortar fraction
            if bx < m || bx > 1.0 - m || by < m || by > 1.0 - m {
                0.0
            } else {
                1.0
            }
        }
        3 => (0.5 + 0.5 * (xf * f).cos()).max(0.5 + 0.5 * (yf * f).cos()), // Burlap (coarse threads)
        _ => (0.5 + 0.5 * (xf * f).cos() + 0.5 + 0.5 * (yf * f).cos()) * 0.5, // Canvas (woven)
    }
}

fn texture_light_dir(light: u8) -> (i32, i32) {
    // Order matches the Texturizer dialog: 0 Top, 1 Top-Left, 2 Left,
    // 3 Bottom-Left, 4 Bottom, 5 Bottom-Right, 6 Right, 7 Top-Right.
    let dirs: [(i32, i32); 8] = [
        (0, -1),
        (-1, -1),
        (-1, 0),
        (-1, 1),
        (0, 1),
        (1, 1),
        (1, 0),
        (1, -1),
    ];
    dirs[(light as usize) & 7]
}

// Filter ▸ Texture ▸ Texturizer — overlay a surface texture (Canvas/Sandstone/
// Brick/Burlap) as relief. `scaling` 0..1 sizes the texture, `relief` 0..1 is the
// emboss depth, `light` 0..7 the highlight direction, `invert` flips high/low.
// relief==0 is a no-op.
pub fn texturizer(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    texture: u8,
    scaling: f32,
    relief: f32,
    light: u8,
    invert: bool,
) {
    let rel = relief.clamp(0.0, 1.0);
    if rel <= 0.0 {
        return;
    }
    let (wi, hi) = (w as i32, h as i32);
    let period = texture_period(scaling);
    let height = |x: i32, y: i32| texture_surface_height(texture, period, x, y);
    let (lx, ly) = texture_light_dir(light);
    let amp = 30000.0;
    let sign = if invert { -1.0 } else { 1.0 };
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let shade = (height(x, y) - height(x + lx, y + ly)) * sign;
            let d = shade * rel * amp * cov;
            let p = i * 4;
            for k in 0..3 {
                px[p + k] = (px[p + k] as f32 + d).clamp(0.0, 65535.0) as u16;
            }
        }
    }
}

// Filter ▸ Sketch ▸ Graphic Pen — render the image as fine directional ink strokes
// in the FOREGROUND colour over a BACKGROUND-colour paper, the ink density following
// the tones. `stroke_length` 0..1 → stroke spacing, `balance` 0..1 shifts how much is
// inked (0.5 = neutral), `direction` 0 Right-Diag / 1 Horizontal / 2 Left-Diag / 3 Vertical.
pub fn graphic_pen(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    stroke_length: f32,
    balance: f32,
    direction: u8,
    fg: [u8; 3],
    bg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let spacing = 2.0 + 10.0 * stroke_length.clamp(0.0, 1.0);
    let bal = balance.clamp(0.0, 1.0) - 0.5;
    let to16 = |c: u8| (c as u16) * 257;
    let fg16 = [to16(fg[0]), to16(fg[1]), to16(fg[2])];
    let bg16 = [to16(bg[0]), to16(bg[1]), to16(bg[2])];
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let p = i * 4;
            let luma = (0.299 * px[p] as f32 + 0.587 * px[p + 1] as f32 + 0.114 * px[p + 2] as f32)
                / 65535.0;
            let darkness = (1.0 - luma + bal).clamp(0.0, 1.0);
            let coord = match direction {
                1 => y as f32,
                2 => (x - y) as f32,
                3 => x as f32,
                _ => (x + y) as f32,
            };
            let ramp = coord.rem_euclid(spacing) / spacing; // 0..1 along the stroke
            let c = if darkness > ramp { fg16 } else { bg16 };
            for k in 0..3 {
                let v = px[p + k] as f32;
                px[p + k] = (v + (c[k] as f32 - v) * cov).clamp(0.0, 65535.0) as u16;
            }
        }
    }
}

// Filter ▸ Sketch ▸ Charcoal: redraws the image as charcoal on paper — major EDGES
// are boldly inked in the foreground colour, while midtones are sketched with a
// diagonal charcoal stroke; the background colour is the paper. `thickness` 1..7
// widens the diagonal strokes, `detail` 0..5 lowers the edge threshold (more edges
// drawn), `balance` 0..1 (Light/Dark Balance) shifts the tone→charcoal cutoff.
// Deterministic 2-tone fg/bg map; reads a source snapshot so edge detection sees
// the original luma. RGB only, alpha preserved, blended by selection coverage.
pub fn charcoal(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    thickness: i32,
    detail: i32,
    balance: f32,
    fg: [u8; 3],
    bg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let spacing = 2.0 + thickness.clamp(1, 7) as f32; // wider strokes = thicker charcoal
    let bal = balance.clamp(0.0, 1.0) - 0.5;
    let edge_thr = (1.0 - detail.clamp(0, 5) as f32 / 5.0) * 0.5 + 0.05; // more detail → lower threshold
    let to16 = |c: u8| (c as u16) * 257;
    let fg16 = [to16(fg[0]), to16(fg[1]), to16(fg[2])];
    let bg16 = [to16(bg[0]), to16(bg[1]), to16(bg[2])];
    let src = px.to_vec();
    let lum = |x: i32, y: i32| -> f32 {
        let q = idx(x, y, wi, hi);
        (src[q] as f32 * 0.299 + src[q + 1] as f32 * 0.587 + src[q + 2] as f32 * 0.114) / 65535.0
    };
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let p = i * 4;
            let l = lum(x, y);
            let darkness = (1.0 - l + bal).clamp(0.0, 1.0);
            let edge =
                (lum(x + 1, y) - lum(x - 1, y)).abs() + (lum(x, y + 1) - lum(x, y - 1)).abs();
            let coord = (x + y) as f32;
            let ramp = coord.rem_euclid(spacing) / spacing; // 0..1 along the diagonal stroke
            let charcoal = edge > edge_thr || darkness > ramp; // bold edge, else stroke shading
            let c = if charcoal { fg16 } else { bg16 };
            for k in 0..3 {
                let v = px[p + k] as f32;
                px[p + k] = (v + (c[k] as f32 - v) * cov).clamp(0.0, 65535.0) as u16;
            }
        }
    }
}

// Filter ▸ Sketch ▸ Halftone Pattern: lay a periodic halftone screen over the
// image in the foreground colour on the background-colour paper — the dot / line /
// ring coverage following the tones, so dark areas ink more. `size` is the screen
// cell size (px), `contrast` (0..1) steepens the tone→coverage response, `pattern`
// selects the screen (0 Circle, 1 Dot, 2 Line). Deterministic; 2-tone fg/bg.
pub fn halftone_pattern(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    size: f32,
    contrast: f32,
    pattern: u8,
    fg: [u8; 3],
    bg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let cell = size.max(1.0);
    let k = 1.0 + 6.0 * contrast.clamp(0.0, 1.0); // steepen the tone response around mid-gray
    let to16 = |c: u8| (c as u16) * 257;
    let fg16 = [to16(fg[0]), to16(fg[1]), to16(fg[2])];
    let bg16 = [to16(bg[0]), to16(bg[1]), to16(bg[2])];
    let (cx, cy) = (wi as f32 / 2.0, hi as f32 / 2.0);
    let tri = |f: f32| 1.0 - (f.rem_euclid(1.0) * 2.0 - 1.0).abs(); // 0..1 triangle wave, peak mid-period
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let p = i * 4;
            let luma = (0.299 * px[p] as f32 + 0.587 * px[p + 1] as f32 + 0.114 * px[p + 2] as f32)
                / 65535.0;
            let t = ((luma - 0.5) * k + 0.5).clamp(0.0, 1.0); // light tone → high t → less ink
            let (xf, yf) = (x as f32, y as f32);
            let screen = match pattern {
                // Dot: 1 at the cell centre falling to 0 at the corner (0.7071 = half-diagonal)
                1 => {
                    let dx = xf.rem_euclid(cell) / cell - 0.5;
                    let dy = yf.rem_euclid(cell) / cell - 0.5;
                    (1.0 - (dx * dx + dy * dy).sqrt() / 0.7071).clamp(0.0, 1.0)
                }
                2 => tri(yf / cell), // Line: horizontal stripes
                _ => tri((xf - cx).hypot(yf - cy) / cell), // Circle: concentric rings from centre
            };
            let c = if screen > t { fg16 } else { bg16 }; // ink fg where the screen exceeds the tone
            for ch in 0..3 {
                let v = px[p + ch] as f32;
                px[p + ch] = (v + (c[ch] as f32 - v) * cov).clamp(0.0, 65535.0) as u16;
            }
        }
    }
}

// Filter ▸ Sketch ▸ Bas Relief: render the image as a low bas-relief carving lit
// from a chosen direction, recoloured into the foreground colour (slopes in shadow)
// and the background colour (slopes catching the light); flat areas settle to the
// neutral fg↔bg mid blend. A 2-tone fg/bg Sketch filter, like Photocopy / Graphic
// Pen / Halftone Pattern. `detail` 1..15 scales the emboss gain (sharper, stronger
// relief), `smoothness` 1..15 box-blurs the luma first (softer, less-detailed
// relief), `light` 0..7 is the lighting direction (0 Top · 1 Top-Right · 2 Right ·
// 3 Bottom-Right · 4 Bottom · 5 Bottom-Left · 6 Left · 7 Top-Left). Deterministic;
// off the hot path. Reuses the directional-gradient idea from Emboss / Accented
// Edges and the fg/bg recolour wiring from the other Sketch filters.
pub fn bas_relief(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    detail: i32,
    smoothness: i32,
    light: u8,
    fg: [u8; 3],
    bg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let n = (wi * hi) as usize;
    let src = px.to_vec();
    let lum = |i: usize| {
        (src[i * 4] as f32 * 0.299 + src[i * 4 + 1] as f32 * 0.587 + src[i * 4 + 2] as f32 * 0.114)
            / 65535.0
    };
    let at = |x: i32, y: i32| (y.clamp(0, hi - 1) * wi + x.clamp(0, wi - 1)) as usize;
    // Smoothness 1..15 → box-blur radius 0..5 (a higher Smoothness softens the relief).
    let r = ((smoothness.clamp(1, 15) - 1) / 3).clamp(0, 5);
    // Precompute the (optionally smoothed) luma field once, so the main pass is O(1)/px.
    let mut ls = vec![0f32; n];
    if r == 0 {
        for i in 0..n {
            ls[i] = lum(i);
        }
    } else {
        for y in 0..hi {
            for x in 0..wi {
                let mut sum = 0.0;
                let mut cnt = 0.0;
                for dy in -r..=r {
                    for dx in -r..=r {
                        sum += lum(at(x + dx, y + dy));
                        cnt += 1.0;
                    }
                }
                ls[(y * wi + x) as usize] = sum / cnt;
            }
        }
    }
    // The unit offset the surface is lit *from* (so the +offset side reads as lit).
    let (ox, oy): (i32, i32) = match light {
        1 => (1, -1),  // Top-Right
        2 => (1, 0),   // Right
        3 => (1, 1),   // Bottom-Right
        4 => (0, 1),   // Bottom
        5 => (-1, 1),  // Bottom-Left
        6 => (-1, 0),  // Left
        7 => (-1, -1), // Top-Left
        _ => (0, -1),  // Top
    };
    // Detail 1..15 → emboss gain: a black↔white slope should saturate the carve.
    let gain = 1.5 + 0.6 * detail.clamp(1, 15) as f32; // 2.1 .. 10.5
    let fg16 = [
        fg[0] as f32 * 257.0,
        fg[1] as f32 * 257.0,
        fg[2] as f32 * 257.0,
    ];
    let bg16 = [
        bg[0] as f32 * 257.0,
        bg[1] as f32 * 257.0,
        bg[2] as f32 * 257.0,
    ];
    let mut filtered = src.clone();
    for y in 0..hi {
        for x in 0..wi {
            let p = (y * wi + x) as usize * 4;
            let slope = ls[at(x + ox, y + oy)] - ls[at(x - ox, y - oy)]; // >0 lit (→bg), <0 shadow (→fg)
            let rel = (0.5 + slope * gain).clamp(0.0, 1.0);
            for k in 0..3 {
                filtered[p + k] = (fg16[k] + (bg16[k] - fg16[k]) * rel).clamp(0.0, 65535.0) as u16;
            }
            // alpha preserved from the clone
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Sketch ▸ Chrome: convert luminance into a reflective grayscale metal
// surface. `detail` 1..10 increases the chrome ripples/edge gain; `smoothness`
// 1..10 box-blurs the luminance field first, softening the relief.
pub fn chrome(px: &mut [u16], w: u32, h: u32, sel: &Selection, detail: i32, smoothness: i32) {
    let (wi, hi) = (w as i32, h as i32);
    let n = (wi * hi) as usize;
    let src = px.to_vec();
    let lum = |i: usize| {
        (src[i * 4] as f32 * 0.299 + src[i * 4 + 1] as f32 * 0.587 + src[i * 4 + 2] as f32 * 0.114)
            / 65535.0
    };
    let at = |x: i32, y: i32| (y.clamp(0, hi - 1) * wi + x.clamp(0, wi - 1)) as usize;
    let r = ((smoothness.clamp(1, 10) - 1) / 2).clamp(0, 4);
    let mut field = vec![0f32; n];
    if r == 0 {
        for i in 0..n {
            field[i] = lum(i);
        }
    } else {
        for y in 0..hi {
            for x in 0..wi {
                let mut sum = 0.0;
                let mut cnt = 0.0;
                for dy in -r..=r {
                    for dx in -r..=r {
                        sum += lum(at(x + dx, y + dy));
                        cnt += 1.0;
                    }
                }
                field[(y * wi + x) as usize] = sum / cnt;
            }
        }
    }

    let gain = 1.5 + detail.clamp(1, 10) as f32 * 0.45;
    let mut filtered = src.clone();
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let p = i * 4;
            let gx = field[at(x + 1, y)] - field[at(x - 1, y)];
            let gy = field[at(x, y + 1)] - field[at(x, y - 1)];
            let slope = (gx * gx + gy * gy).sqrt();
            let wave = ((field[i] - 0.5) * std::f32::consts::TAU * gain + slope * 18.0).sin();
            let metal = ((0.5 + 0.5 * wave - slope * 0.75) * (1.1 + gain * 0.08) + slope * 1.2)
                .clamp(0.0, 1.0);
            let v = to16(metal);
            filtered[p] = v;
            filtered[p + 1] = v;
            filtered[p + 2] = v;
        }
    }
    blend_back(px, &filtered, sel);
}

// Find edges via Sobel magnitude (per channel), result inverted like Photoshop.
pub fn find_edges(px: &mut [u16], w: u32, h: u32, sel: &Selection) {
    let (w, h) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    for y in 0..h {
        for x in 0..w {
            let di = (y * w + x) as usize * 4;
            for k in 0..3 {
                let gx = -(src[idx(x - 1, y - 1, w, h) + k] as f32)
                    - 2.0 * src[idx(x - 1, y, w, h) + k] as f32
                    - src[idx(x - 1, y + 1, w, h) + k] as f32
                    + src[idx(x + 1, y - 1, w, h) + k] as f32
                    + 2.0 * src[idx(x + 1, y, w, h) + k] as f32
                    + src[idx(x + 1, y + 1, w, h) + k] as f32;
                let gy = -(src[idx(x - 1, y - 1, w, h) + k] as f32)
                    - 2.0 * src[idx(x, y - 1, w, h) + k] as f32
                    - src[idx(x + 1, y - 1, w, h) + k] as f32
                    + src[idx(x - 1, y + 1, w, h) + k] as f32
                    + 2.0 * src[idx(x, y + 1, w, h) + k] as f32
                    + src[idx(x + 1, y + 1, w, h) + k] as f32;
                let mag = (gx * gx + gy * gy).sqrt().min(65535.0);
                filtered[di + k] = (65535.0 - mag) as u16;
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Glowing Edges: the inverse of Find Edges — edges become bright glows on a
// black field. `width` is the gradient sampling distance, `brightness` scales
// the edge magnitude. Per channel, so the glows take the edge colour.
pub fn glowing_edges(px: &mut [u16], w: u32, h: u32, sel: &Selection, width: i32, brightness: f32) {
    let (w, h) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let d = width.max(1);
    for y in 0..h {
        for x in 0..w {
            let di = (y * w + x) as usize * 4;
            for k in 0..3 {
                let gx = src[idx(x + d, y, w, h) + k] as f32 - src[idx(x - d, y, w, h) + k] as f32;
                let gy = src[idx(x, y + d, w, h) + k] as f32 - src[idx(x, y - d, w, h) + k] as f32;
                let mag = (gx * gx + gy * gy).sqrt() * brightness;
                filtered[di + k] = mag.clamp(0.0, 65535.0) as u16;
            }
            // keep the original alpha
        }
    }
    blend_back(px, &filtered, sel);
}

// Sharpen Edges: a one-click sharpen applied only where there are strong edges
// (gated by the local luminance gradient), so flat areas and low-contrast noise
// stay untouched — unlike plain Sharpen which sharpens everything.
pub fn sharpen_edges(px: &mut [u16], w: u32, h: u32, sel: &Selection) {
    let (w, h) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let threshold = 15000.0f32; // 16-bit edge magnitude for full effect (≈58 of 255)
    let lum =
        |i: usize| 0.299 * src[i] as f32 + 0.587 * src[i + 1] as f32 + 0.114 * src[i + 2] as f32;
    for y in 0..h {
        for x in 0..w {
            let gx = lum(idx(x + 1, y, w, h)) - lum(idx(x - 1, y, w, h));
            let gy = lum(idx(x, y + 1, w, h)) - lum(idx(x, y - 1, w, h));
            let edge = ((gx * gx + gy * gy).sqrt() / threshold).min(1.0);
            if edge <= 0.0 {
                continue; // flat → leave it (filtered already == src)
            }
            let di = (y * w + x) as usize * 4;
            for k in 0..3 {
                let lap = 4.0 * src[di + k] as f32
                    - src[idx(x - 1, y, w, h) + k] as f32
                    - src[idx(x + 1, y, w, h) + k] as f32
                    - src[idx(x, y - 1, w, h) + k] as f32
                    - src[idx(x, y + 1, w, h) + k] as f32;
                let base = src[di + k] as f32;
                filtered[di + k] = (base + edge * lap).clamp(0.0, 65535.0) as u16;
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Trace Contour: thinly outline, per channel, where the value crosses `level`
// (0..255) — like the contour lines on a map. `upper` draws the outline on the
// above-level side of a crossing; otherwise the below-level side. Result is a
// black contour on white (per-channel, so colours give coloured lines).
pub fn trace_contour(px: &mut [u16], w: u32, h: u32, sel: &Selection, level: u8, upper: bool) {
    let (w, h) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let lv = (level as u16) * 257; // 8-bit level → 16-bit
    for y in 0..h {
        for x in 0..w {
            let di = (y * w + x) as usize * 4;
            for k in 0..3 {
                let c = src[di + k];
                let c_above = c >= lv;
                let on_side = if upper { c_above } else { !c_above };
                let mut contour = false;
                if on_side {
                    for (nx, ny) in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
                        let n = src[idx(nx, ny, w, h) + k];
                        if (n >= lv) != c_above {
                            contour = true; // a level crossing touches this pixel
                            break;
                        }
                    }
                }
                filtered[di + k] = if contour { 0 } else { 65535 };
            }
            // alpha is preserved from the clone
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Artistic ▸ Poster Edges: posterize the colours to `levels` bands and
// draw dark lines on the edges. Edge strength = max luminance gradient over a
// `thickness`-radius window; where it is strong the posterized colour is
// darkened toward black, scaled by `intensity`.
pub fn poster_edges(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    levels: i32,
    thickness: i32,
    intensity: f32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let lv = (levels.max(2) - 1) as f32;
    let r = thickness.max(1);
    let src = px.to_vec();
    let lum = |i: usize| -> f32 {
        (src[i] as f32 * 0.299 + src[i + 1] as f32 * 0.587 + src[i + 2] as f32 * 0.114) / 65535.0
    };
    let mut filtered = src.clone();
    for y in 0..hi {
        for x in 0..wi {
            let ci = (y * wi + x) as usize * 4;
            // edge strength: the largest luminance jump in the neighbourhood
            let lc = lum(ci);
            let mut maxd = 0f32;
            for dy in -r..=r {
                for dx in -r..=r {
                    let nx = (x + dx).clamp(0, wi - 1);
                    let ny = (y + dy).clamp(0, hi - 1);
                    let d = (lum((ny * wi + nx) as usize * 4) - lc).abs();
                    if d > maxd {
                        maxd = d;
                    }
                }
            }
            let dark = 1.0 - (maxd * intensity).clamp(0.0, 1.0);
            for k in 0..3 {
                // posterize, then darken the edges
                let q = (src[ci + k] as f32 / 65535.0 * lv).round() / lv;
                filtered[ci + k] = to16((q * dark).clamp(0.0, 1.0));
            }
            // alpha preserved
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Artistic ▸ Cutout: portray the image as though made from roughly cut
// pieces of coloured paper — flatten it into a few solid-colour regions with
// simplified edges. A box-smoothing pass (radius from Edge Simplicity, reduced by
// Edge Fidelity so higher fidelity keeps sharper edges) merges nearby detail into
// flat areas, then each RGB channel is quantized to `levels` tiers (paper layers).
// `levels` 2..8, `edge_simplicity` 0..10, `edge_fidelity` 1..3. Off the hot path.
pub fn cutout(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    levels: i32,
    edge_simplicity: i32,
    edge_fidelity: i32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let lv = (levels.clamp(2, 8) - 1) as f32;
    // More simplicity → larger smoothing; higher fidelity → less smoothing (sharper).
    let r = ((edge_simplicity.clamp(0, 10) * (4 - edge_fidelity.clamp(1, 3))) as f32 / 3.0)
        .round()
        .clamp(0.0, 8.0) as i32;
    let src = px.to_vec();
    let mut filtered = src.clone();
    for y in 0..hi {
        for x in 0..wi {
            let ci = (y * wi + x) as usize * 4;
            for k in 0..3 {
                // box-average this channel over the neighbourhood to flatten regions
                let mut sum = 0f32;
                let mut n = 0f32;
                for dy in -r..=r {
                    for dx in -r..=r {
                        let nx = (x + dx).clamp(0, wi - 1);
                        let ny = (y + dy).clamp(0, hi - 1);
                        sum += src[(ny * wi + nx) as usize * 4 + k] as f32;
                        n += 1.0;
                    }
                }
                // quantize the smoothed value to `levels` flat tiers
                let q = ((sum / n / 65535.0) * lv).round() / lv;
                filtered[ci + k] = to16(q.clamp(0.0, 1.0));
            }
            // alpha preserved
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Artistic ▸ Dry Brush: simplify colour into broad, local brush-sized
// strokes while retaining high-contrast detail and adding a deterministic dry
// media tooth. Brush Size 0..10 sets the averaging radius, Brush Detail 0..10
// controls how much edge detail survives, and Texture 0..3 darkens rough gaps.
pub fn dry_brush(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    brush_size: i32,
    detail: i32,
    texture: i32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let r = brush_size.clamp(0, 10);
    let detail = detail.clamp(0, 10) as f32 / 10.0;
    let texture = texture.clamp(0, 3) as f32 / 3.0;
    if r == 0 && texture <= 0.0 {
        return;
    }
    let src = px.to_vec();
    let mut filtered = src.clone();
    let lum = |i: usize| -> f32 {
        (src[i] as f32 * 0.299 + src[i + 1] as f32 * 0.587 + src[i + 2] as f32 * 0.114) / 65535.0
    };
    let hash = |x: i32, y: i32| -> f32 {
        let mut v = (x as u32).wrapping_mul(73_856_093) ^ (y as u32).wrapping_mul(19_349_663);
        v ^= v >> 13;
        v = v.wrapping_mul(1_274_126_177);
        ((v >> 24) as f32) / 255.0
    };

    for y in 0..hi {
        for x in 0..wi {
            let p = (y * wi + x) as usize * 4;
            let mut sum = [0f32; 3];
            let mut count = 0f32;
            let mut min_l = 1.0f32;
            let mut max_l = 0.0f32;
            for dy in -r..=r {
                for dx in -r..=r {
                    let ni = idx(x + dx, y + dy, wi, hi);
                    for k in 0..3 {
                        sum[k] += src[ni + k] as f32;
                    }
                    let l = lum(ni);
                    min_l = min_l.min(l);
                    max_l = max_l.max(l);
                    count += 1.0;
                }
            }

            let edge = ((lum(idx(x + 1, y, wi, hi)) - lum(idx(x - 1, y, wi, hi))).abs()
                + (lum(idx(x, y + 1, wi, hi)) - lum(idx(x, y - 1, wi, hi))).abs())
            .min(1.0);
            let keep_detail = (edge * (1.4 + detail * 7.0)).clamp(0.0, 0.2 + detail * 0.8);
            let simplify = ((max_l - min_l) * (1.35 - detail * 0.75)).clamp(0.0, 0.95);
            let levels = 3.0 + detail * 9.0;
            let dry = 1.0 - texture * 0.16 * (0.35 + hash(x / (r + 1).max(1), y));

            for k in 0..3 {
                let avg = sum[k] / count / 65535.0;
                let quant = (avg * levels).round() / levels;
                let simplified = avg + (quant - avg) * simplify;
                let orig = src[p + k] as f32 / 65535.0;
                let with_edge = simplified + (orig - simplified) * keep_detail;
                filtered[p + k] = to16((with_edge * dry).clamp(0.0, 1.0));
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Artistic ▸ Watercolor: wash neighbouring pigment together, retain
// more local colour at higher Brush Detail values, darken high-contrast pools by
// Shadow Intensity, and add deterministic paper tooth from Texture.
// Brush Detail 1..14, Shadow Intensity 0..10, Texture 0..3.
pub fn watercolor(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    brush_detail: i32,
    shadow_intensity: i32,
    texture: i32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let detail = (brush_detail.clamp(1, 14) - 1) as f32 / 13.0;
    let r = (8.0 - detail * 7.0).round().clamp(1.0, 8.0) as i32;
    let shadow = shadow_intensity.clamp(0, 10) as f32 / 10.0;
    let texture = texture.clamp(0, 3) as f32 / 3.0;
    let src = px.to_vec();
    let mut filtered = src.clone();
    let lum = |i: usize| -> f32 {
        (src[i] as f32 * 0.299 + src[i + 1] as f32 * 0.587 + src[i + 2] as f32 * 0.114) / 65535.0
    };
    let tooth = |x: i32, y: i32| -> f32 {
        let mut v = (x as u32).wrapping_mul(374_761_393)
            ^ (y as u32).wrapping_mul(668_265_263)
            ^ ((x + y) as u32).wrapping_mul(2_246_822_519);
        v ^= v >> 15;
        v = v.wrapping_mul(2_654_435_761);
        ((v >> 24) as f32 / 255.0) - 0.5
    };

    for y in 0..hi {
        for x in 0..wi {
            let p = (y * wi + x) as usize * 4;
            let center_l = lum(p);
            let mut sum = [0f32; 3];
            let mut weight_sum = 0f32;
            let mut min_l = 1.0f32;
            let mut max_l = 0.0f32;
            for dy in -r..=r {
                for dx in -r..=r {
                    let ni = idx(x + dx, y + dy, wi, hi);
                    let nl = lum(ni);
                    min_l = min_l.min(nl);
                    max_l = max_l.max(nl);
                    let dist = ((dx * dx + dy * dy) as f32).sqrt() / (r as f32 + 1.0);
                    let same_tone = 1.0 - (nl - center_l).abs().min(1.0) * (0.35 + detail * 0.65);
                    let weight = (1.0 - dist * 0.45).max(0.05) * same_tone.max(0.1);
                    for k in 0..3 {
                        sum[k] += src[ni + k] as f32 * weight;
                    }
                    weight_sum += weight;
                }
            }

            let grad = ((lum(idx(x + 1, y, wi, hi)) - lum(idx(x - 1, y, wi, hi))).abs()
                + (lum(idx(x, y + 1, wi, hi)) - lum(idx(x, y - 1, wi, hi))).abs())
            .min(1.0);
            let local_contrast = (max_l - min_l).min(1.0);
            let pool = (grad * 0.6 + local_contrast * 0.55).clamp(0.0, 1.0);
            let shadow_mul = 1.0 - shadow * pool * 0.55;
            let paper = 1.0 + texture * 0.12 * tooth(x / 2, y / 2);
            let keep = (detail * 0.72 + grad * detail * 0.38).clamp(0.0, 0.92);
            let levels = 5.0 + detail * 15.0;

            for k in 0..3 {
                let wash = sum[k] / weight_sum / 65535.0;
                let quantized = (wash * levels).round() / levels;
                let orig = src[p + k] as f32 / 65535.0;
                let mixed = quantized + (orig - quantized) * keep;
                filtered[p + k] = to16((mixed * shadow_mul * paper).clamp(0.0, 1.0));
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Artistic ▸ Colored Pencil: redraw the image as diagonal colored-pencil
// hatch strokes on paper. Flat/light areas lighten toward the paper (white); edges
// and darker tones gain crosshatch strokes that keep the original hue (multiplicative
// darkening). Deterministic (pattern-based, no RNG), so it round-trips. Pencil Width
// 1..24 = hatch spacing, Stroke Pressure 0..15 = stroke darkness, Paper Brightness
// 0..50 = how far flat areas lighten toward white.
pub fn colored_pencil(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    pencil_width: i32,
    stroke_pressure: i32,
    paper_brightness: i32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let width = pencil_width.clamp(1, 24);
    let pressure = stroke_pressure.clamp(0, 15) as f32 / 15.0;
    let paper = paper_brightness.clamp(0, 50) as f32 / 50.0;
    if pressure <= 0.0 && paper <= 0.0 {
        return; // no strokes, no paper → identity
    }
    let src = px.to_vec();
    let mut filtered = src.clone();
    let lum = |i: usize| -> f32 {
        (src[i] as f32 * 0.299 + src[i + 1] as f32 * 0.587 + src[i + 2] as f32 * 0.114) / 65535.0
    };
    let band = width as f32 * 0.4; // a hatch line covers 40% of each band
    for y in 0..hi {
        for x in 0..wi {
            let p = (y * wi + x) as usize * 4;
            let darkness = 1.0 - lum(p); // 0 at white, 1 at black
                                         // Edge magnitude → stronger pencil strokes along contours.
            let edge = ((lum(idx(x + 1, y, wi, hi)) - lum(idx(x - 1, y, wi, hi))).abs()
                + (lum(idx(x, y + 1, wi, hi)) - lum(idx(x, y - 1, wi, hi))).abs())
            .min(1.0);
            // Two diagonal hatch fields; the counter-diagonal only kicks in for
            // shadows, so midtones get single hatching and darks get crosshatch.
            let on1 = if ((x + y).rem_euclid(width) as f32) < band {
                1.0
            } else {
                0.0
            };
            let on2 = if ((x - y).rem_euclid(width) as f32) < band {
                1.0
            } else {
                0.0
            };
            let hatch = on1 * darkness + on2 * (darkness - 0.5).max(0.0) * 2.0;
            let stroke = ((hatch + edge * 1.5) * pressure).clamp(0.0, 1.0);
            for k in 0..3 {
                let orig = src[p + k] as f32 / 65535.0;
                // Lighten toward paper white, most in light/flat areas.
                let lightened = orig + (1.0 - orig) * paper * (1.0 - darkness * 0.5);
                // Darken along strokes, keeping hue (multiplicative).
                filtered[p + k] = to16(lightened * (1.0 - stroke * 0.85));
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Artistic ▸ Smudge Stick: soften with short diagonal strokes that smear
// the darker areas, while lighter areas brighten and lose detail (the Photoshop
// description). Deterministic (pure averaging + tone threshold, no RNG). Stroke
// Length 0..10 = diagonal smear radius, Highlight Area 0..20 = how much of the top
// tonal range brightens, Intensity 0..10 = brightening strength.
pub fn smudge_stick(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    stroke_length: i32,
    highlight_area: i32,
    intensity: i32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let len = stroke_length.clamp(0, 10);
    let highlight = highlight_area.clamp(0, 20) as f32 / 20.0;
    let inten = intensity.clamp(0, 10) as f32 / 10.0;
    if len == 0 && (highlight <= 0.0 || inten <= 0.0) {
        return; // no smear and no highlight lift → identity
    }
    let src = px.to_vec();
    let mut filtered = src.clone();
    let lum = |i: usize| -> f32 {
        (src[i] as f32 * 0.299 + src[i + 1] as f32 * 0.587 + src[i + 2] as f32 * 0.114) / 65535.0
    };
    let threshold = 1.0 - highlight; // highlights are pixels above this luminance
    for y in 0..hi {
        for x in 0..wi {
            let p = (y * wi + x) as usize * 4;
            let l = lum(p);
            // Short diagonal stroke: average along the main diagonal (±len).
            let mut sum = [0f32; 3];
            let mut count = 0f32;
            for d in -len..=len {
                let ni = idx(x + d, y + d, wi, hi);
                for k in 0..3 {
                    sum[k] += src[ni + k] as f32;
                }
                count += 1.0;
            }
            let smear_amt = (1.0 - l) * 0.9; // darker areas smudge more
                                             // Highlight lift: ramps from 0 at the threshold to 1 at white.
            let hl = if highlight > 0.0 && l > threshold {
                ((l - threshold) / (1.0 - threshold)).clamp(0.0, 1.0)
            } else {
                0.0
            };
            for k in 0..3 {
                let orig = src[p + k] as f32 / 65535.0;
                let stroke = sum[k] / count / 65535.0;
                let smudged = orig + (stroke - orig) * smear_amt;
                let brightened = smudged + (1.0 - smudged) * hl * inten * 0.7;
                filtered[p + k] = to16(brightened);
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Artistic ▸ Sponge: soften the image into irregular paint dabs and
// modulate them with a clumped value-noise field. Brush Size 0..10 controls dab
// scale, Definition 0..25 increases tonal separation, and Smoothness 1..15
// removes fine texture and original detail. Deterministic; alpha is preserved.
pub fn sponge(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    brush_size: i32,
    definition: i32,
    smoothness: i32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let size = brush_size.clamp(0, 10);
    let definition = definition.clamp(0, 25) as f32 / 25.0;
    let smooth = (smoothness.clamp(1, 15) - 1) as f32 / 14.0;
    let radius = 1 + size / 2;
    let scale = 2.0 + size as f32 * 1.8;
    let src = px.to_vec();
    let mut filtered = src.clone();

    for y in 0..hi {
        for x in 0..wi {
            let p = (y * wi + x) as usize * 4;
            let mut sum = [0f32; 3];
            let mut count = 0f32;
            for dy in -radius..=radius {
                for dx in -radius..=radius {
                    let ni = idx(x + dx, y + dy, wi, hi);
                    for k in 0..3 {
                        sum[k] += src[ni + k] as f32;
                    }
                    count += 1.0;
                }
            }

            let coarse = tex_noise(x as f32 / scale, y as f32 / scale);
            let fine = tex_noise(
                x as f32 / (scale * 0.35) + 19.0,
                y as f32 / (scale * 0.35) + 7.0,
            );
            let field = coarse + (fine - coarse) * (1.0 - smooth) * 0.65;
            let texture = ((field - 0.5) * (1.0 + definition * 3.0)).clamp(-0.5, 0.5);
            let shade = (0.8 + texture * (0.7 + definition * 0.45)).clamp(0.35, 1.25);
            let avg = [sum[0] / count, sum[1] / count, sum[2] / count];
            let avg_luma = (avg[0] * 0.299 + avg[1] * 0.587 + avg[2] * 0.114) / 65535.0;
            let keep = (1.0 - smooth) * 0.35;

            for k in 0..3 {
                let local = avg[k] / 65535.0;
                let orig = src[p + k] as f32 / 65535.0;
                let base = local + (orig - local) * keep;
                let defined = avg_luma + (base - avg_luma) * (1.0 + definition * 0.5);
                filtered[p + k] = to16((defined * shade).clamp(0.0, 1.0));
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Artistic ▸ Palette Knife: reduce detail to a thinly-painted look —
// flatten each pixel toward its local (Stroke Size) neighbourhood average, keeping
// strong edges in proportion to Stroke Detail, then soften by Softness. Deterministic
// (pure averaging, no RNG). Stroke Size 1..50 (radius, mapped to ≤12), Stroke Detail
// 1..3 (edge retention), Softness 0..10 (extra smoothing of the flattened result).
pub fn palette_knife(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    stroke_size: i32,
    stroke_detail: i32,
    softness: i32,
) {
    let (wi, hi) = (w as i32, h as i32);
    // Map Stroke Size 1..50 to a bounded box radius so large sizes stay affordable.
    let r = (((stroke_size.clamp(1, 50) as f32) / 50.0 * 12.0).round() as i32).max(1);
    let detail = (stroke_detail.clamp(1, 3) - 1) as f32 / 2.0; // 0..1 edge retention
    let soft = softness.clamp(0, 10) as f32 / 10.0;
    let src = px.to_vec();
    let mut filtered = src.clone();
    let lum = |i: usize| -> f32 {
        (src[i] as f32 * 0.299 + src[i + 1] as f32 * 0.587 + src[i + 2] as f32 * 0.114) / 65535.0
    };
    for y in 0..hi {
        for x in 0..wi {
            let p = (y * wi + x) as usize * 4;
            let mut sum = [0f32; 3];
            let mut count = 0f32;
            for dy in -r..=r {
                for dx in -r..=r {
                    let ni = idx(x + dx, y + dy, wi, hi);
                    for k in 0..3 {
                        sum[k] += src[ni + k] as f32;
                    }
                    count += 1.0;
                }
            }
            // Edge magnitude → keep more of the original where Stroke Detail is high.
            let edge = ((lum(idx(x + 1, y, wi, hi)) - lum(idx(x - 1, y, wi, hi))).abs()
                + (lum(idx(x, y + 1, wi, hi)) - lum(idx(x, y - 1, wi, hi))).abs())
            .min(1.0);
            let keep = (edge * detail).min(1.0);
            for k in 0..3 {
                let orig = src[p + k] as f32 / 65535.0;
                let avg = sum[k] / count / 65535.0;
                // Flatten toward the neighbourhood average, restoring edges by `keep`.
                let flattened = avg + (orig - avg) * keep;
                // Softness pulls the flattened result the rest of the way to the average.
                filtered[p + k] = to16(flattened + (avg - flattened) * soft * 0.5);
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Artistic ▸ Paint Daubs: painterly dabs — smooth each pixel toward its
// local (Brush Size) average, then restore high-frequency detail scaled by Sharpness.
// Brush Type: 0 Simple, 1 Light Rough, 2 Dark Rough, 3 Wide Sharp, 4 Wide Blurry,
// 5 Sparkle. Brush Size 1..50 (radius mapped to ≤8), Sharpness 0..40.
pub fn paint_daubs(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    brush_size: i32,
    sharpness: i32,
    brush_type: i32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let r = (((brush_size.clamp(1, 50) as f32) / 50.0 * 8.0).round() as i32).max(1);
    let sharp = sharpness.clamp(0, 40) as f32 / 40.0;
    let brush_type = brush_type.clamp(0, 5);
    let (rx, ry, detail_gain) = match brush_type {
        3 => (r * 2, (r + 1) / 2, 2.4),
        4 => (r * 2, (r + 1) / 2, 0.7),
        _ => (r, r, 1.8),
    };
    let src = px.to_vec();
    let mut filtered = src.clone();
    for y in 0..hi {
        for x in 0..wi {
            let p = (y * wi + x) as usize * 4;
            let mut sum = [0f32; 3];
            let mut count = 0f32;
            for dy in -ry..=ry {
                for dx in -rx..=rx {
                    if brush_type == 5 && dx != 0 && dy != 0 && dx.abs() != dy.abs() {
                        continue;
                    }
                    let ni = idx(x + dx, y + dy, wi, hi);
                    let lum = (src[ni] as f32 * 0.299
                        + src[ni + 1] as f32 * 0.587
                        + src[ni + 2] as f32 * 0.114)
                        / 65535.0;
                    let tooth = 0.75 + tex_hash(x + dx * 31, y + dy * 31) * 0.5;
                    let weight = match brush_type {
                        1 => (0.35 + lum * 0.65) * tooth,
                        2 => (0.35 + (1.0 - lum) * 0.65) * tooth,
                        _ => 1.0,
                    };
                    for k in 0..3 {
                        sum[k] += src[ni + k] as f32 * weight;
                    }
                    count += weight;
                }
            }
            for k in 0..3 {
                let orig = src[p + k] as f32 / 65535.0;
                let avg = sum[k] / count / 65535.0;
                let out = avg + (orig - avg) * sharp * detail_gain;
                filtered[p + k] = to16(out);
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Artistic ▸ Fresco: a coarse, dark plaster look — dab the image into
// short rounded strokes (Brush Size), keep detail at edges (Brush Detail), then
// deepen the tone with a gamma darkening plus darker edges (the fresco signature)
// and add deterministic plaster tooth (Texture). Deterministic (no RNG). Brush Size
// 0..10 (dab radius), Brush Detail 0..10 (edge retention), Texture 0..3 (tooth).
pub fn fresco(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    brush_size: i32,
    brush_detail: i32,
    texture: i32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let r = brush_size.clamp(0, 10);
    let detail = brush_detail.clamp(0, 10) as f32 / 10.0;
    let tex = texture.clamp(0, 3) as f32 / 3.0;
    let src = px.to_vec();
    let mut filtered = src.clone();
    let lum = |i: usize| -> f32 {
        (src[i] as f32 * 0.299 + src[i + 1] as f32 * 0.587 + src[i + 2] as f32 * 0.114) / 65535.0
    };
    let hash = |x: i32, y: i32| -> f32 {
        let mut v = (x as u32).wrapping_mul(73_856_093) ^ (y as u32).wrapping_mul(19_349_663);
        v ^= v >> 13;
        v = v.wrapping_mul(1_274_126_177);
        ((v >> 24) as f32) / 255.0
    };
    for y in 0..hi {
        for x in 0..wi {
            let p = (y * wi + x) as usize * 4;
            let mut sum = [0f32; 3];
            let mut count = 0f32;
            for dy in -r..=r {
                for dx in -r..=r {
                    let ni = idx(x + dx, y + dy, wi, hi);
                    for k in 0..3 {
                        sum[k] += src[ni + k] as f32;
                    }
                    count += 1.0;
                }
            }
            let edge = ((lum(idx(x + 1, y, wi, hi)) - lum(idx(x - 1, y, wi, hi))).abs()
                + (lum(idx(x, y + 1, wi, hi)) - lum(idx(x, y - 1, wi, hi))).abs())
            .min(1.0);
            let keep = (edge * detail).min(1.0);
            // Darker along edges (dark fresco outlines) + deterministic plaster tooth.
            let edge_dark = 1.0 - edge * 0.4;
            let tooth = 1.0 - tex * 0.14 * hash(x / (r + 1).max(1), y / (r + 1).max(1));
            for k in 0..3 {
                let orig = src[p + k] as f32 / 65535.0;
                let avg = sum[k] / count / 65535.0;
                let base = avg + (orig - avg) * keep; // coarse dab, edges retained
                                                      // Fresco deepening: gamma 1.5 darkens midtones, keeps 0/1 fixed.
                filtered[p + k] = to16(base.powf(1.5) * edge_dark * tooth);
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Artistic ▸ Rough Pastels: strokes of coloured pastel on a textured
// ground. Photoshop's signature: bright areas take thick chalk (little texture),
// darker areas are scraped to reveal the texture — so the relief emboss is MODULATED
// BY DARKNESS here (the distinction from Texturizer's uniform relief). Deterministic
// (reuses the shared canvas/sandstone/brick/burlap surface + directional light).
// Stroke Length 0..40 (pastel smear radius), texture 0..3, scaling/relief 0..1,
// light 0..7.
pub fn rough_pastels(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    stroke_length: i32,
    texture: u8,
    scaling: f32,
    relief: f32,
    light: u8,
) {
    let (wi, hi) = (w as i32, h as i32);
    let len = ((stroke_length.clamp(0, 40) as f32) / 40.0 * 4.0).round() as i32; // smear radius
    let rel = relief.clamp(0.0, 1.0);
    if len == 0 && rel <= 0.0 {
        return; // no strokes and no relief → identity
    }
    let period = texture_period(scaling);
    let (lx, ly) = texture_light_dir(light);
    let amp = 30000.0;
    let src = px.to_vec();
    let mut filtered = src.clone();
    let lum = |i: usize| -> f32 {
        (src[i] as f32 * 0.299 + src[i + 1] as f32 * 0.587 + src[i + 2] as f32 * 0.114) / 65535.0
    };
    for y in 0..hi {
        for x in 0..wi {
            let p = (y * wi + x) as usize * 4;
            // Pastel stroke: short diagonal smear (chalk strokes).
            let mut sm = [0f32; 3];
            let mut count = 0f32;
            for d in -len..=len {
                let ni = idx(x + d, y + d, wi, hi);
                for k in 0..3 {
                    sm[k] += src[ni + k] as f32;
                }
                count += 1.0;
            }
            let dark = 1.0 - lum(p);
            // Relief emboss, deeper where the image is dark (chalk scraped off).
            let shade = texture_surface_height(texture, period, x, y)
                - texture_surface_height(texture, period, x + lx, y + ly);
            let d = shade * rel * amp * (0.35 + dark * 0.65);
            for k in 0..3 {
                filtered[p + k] = (sm[k] / count + d).clamp(0.0, 65535.0) as u16;
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Artistic ▸ Underpainting — paints the image on a textured background:
// a low-detail base (heavy box smoothing sized by `brush_size` 0..40, the
// "underpainting" pass) with a surface texture (Canvas/Sandstone/Brick/Burlap)
// embossed over it. Unlike Rough Pastels (whose relief deepens in the shadows),
// the texture here is applied UNIFORMLY and its strength is set by
// `texture_coverage` 0..40; `scaling`/`relief`/`light` size, deepen, and light
// the surface (same helpers as Texturizer). Deterministic → round-trips.
pub fn underpainting(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    brush_size: i32,
    texture_coverage: i32,
    texture: u8,
    scaling: f32,
    relief: f32,
    light: u8,
) {
    let (wi, hi) = (w as i32, h as i32);
    let r = ((brush_size.clamp(0, 40) as f32) / 40.0 * 8.0).round() as i32; // smoothing radius (0..8)
    let cov = (texture_coverage.clamp(0, 40) as f32) / 40.0; // texture strength 0..1
    let rel = relief.clamp(0.0, 1.0);
    if r == 0 && cov * rel <= 0.0 {
        return; // no underpaint smoothing and no texture → identity
    }
    let period = texture_period(scaling);
    let (lx, ly) = texture_light_dir(light);
    let amp = 30000.0;
    let src = px.to_vec();
    let mut filtered = src.clone();
    for y in 0..hi {
        for x in 0..wi {
            let p = (y * wi + x) as usize * 4;
            // Underpaint base: heavy box average → low-detail ground.
            let mut sm = [0f32; 3];
            let mut count = 0f32;
            for dy in -r..=r {
                for dx in -r..=r {
                    let ni = idx(x + dx, y + dy, wi, hi);
                    for k in 0..3 {
                        sm[k] += src[ni + k] as f32;
                    }
                    count += 1.0;
                }
            }
            // Uniform relief emboss, scaled by texture coverage.
            let shade = texture_surface_height(texture, period, x, y)
                - texture_surface_height(texture, period, x + lx, y + ly);
            let d = shade * rel * cov * amp;
            for k in 0..3 {
                filtered[p + k] = (sm[k] / count + d).clamp(0.0, 65535.0) as u16;
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Render ▸ Fibers: weave vertical fibers from the foreground and
// background colours. Each column carries its own slowly-varying noise (so the
// fibers run vertically); `strength` sets the fibre length, `variance` the
// contrast between the two colours. Deterministic (hash-seeded), so it
// round-trips. Replaces the selection's pixels (a render filter).
pub fn fibers(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    variance: f32,
    strength: f32,
    fg: [u8; 3],
    bg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let contrast = (variance / 50.0).clamp(0.1, 4.0);
    let fiber_len = strength.max(1.0) + 2.0;
    let fgf = [
        fg[0] as f32 / 255.0,
        fg[1] as f32 / 255.0,
        fg[2] as f32 / 255.0,
    ];
    let bgf = [
        bg[0] as f32 / 255.0,
        bg[1] as f32 / 255.0,
        bg[2] as f32 / 255.0,
    ];
    let norm = u32::MAX as f32;
    let mut filtered = px.to_vec();
    for x in 0..wi {
        for y in 0..hi {
            // smoothly interpolate the column's per-segment noise down the fibre
            let pos = y as f32 / fiber_len;
            let seg = pos.floor() as i32;
            let frac = pos - seg as f32;
            let base = hash2(x, seg) as f32 / norm;
            let next = hash2(x, seg + 1) as f32 / norm;
            let mut t = base + (next - base) * frac;
            t = (0.5 + (t - 0.5) * contrast).clamp(0.0, 1.0);
            let di = (y * wi + x) as usize * 4;
            for k in 0..3 {
                filtered[di + k] = to16(fgf[k] + (bgf[k] - fgf[k]) * t);
            }
            filtered[di + 3] = 65535; // opaque
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Sketch ▸ Photocopy: simulate a photocopy — large dark areas copy only
// around their edges. A pixel is painted in the foreground colour where it is
// darker than its local average (the edge of a dark region), otherwise the
// background colour. `detail` is the averaging radius, `darkness` lowers the
// threshold so more of each dark edge prints.
pub fn photocopy(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    detail: i32,
    darkness: f32,
    fg: [u8; 3],
    bg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let r = detail.max(1);
    let thr = 0.5 / darkness.max(0.1);
    let src = px.to_vec();
    let lum = |i: usize| -> f32 {
        (src[i] as f32 * 0.299 + src[i + 1] as f32 * 0.587 + src[i + 2] as f32 * 0.114) / 65535.0
    };
    let fg16 = [fg[0] as u16 * 257, fg[1] as u16 * 257, fg[2] as u16 * 257];
    let bg16 = [bg[0] as u16 * 257, bg[1] as u16 * 257, bg[2] as u16 * 257];
    let mut filtered = src.clone();
    for y in 0..hi {
        for x in 0..wi {
            let ci = (y * wi + x) as usize * 4;
            let lc = lum(ci);
            // local average luminance over the (2r+1)² window
            let mut sum = 0f32;
            let mut cnt = 0f32;
            for dy in -r..=r {
                for dx in -r..=r {
                    let nx = (x + dx).clamp(0, wi - 1);
                    let ny = (y + dy).clamp(0, hi - 1);
                    sum += lum((ny * wi + nx) as usize * 4);
                    cnt += 1.0;
                }
            }
            let avg = sum / cnt;
            let ink = if avg - lc > thr { &fg16 } else { &bg16 };
            filtered[ci..ci + 3].copy_from_slice(ink);
            // alpha preserved
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Sketch ▸ Stamp: simplify the image to a hard 2-tone "rubber stamp" — the
// smoothed luminance is thresholded into the foreground colour (dark) on the
// background colour (light). `balance` 0..1 is the Light/Dark Balance (the threshold;
// higher → more foreground/dark), `smoothness` 0..1 box-blurs the luma first
// (radius 0..8) to clean the detail edges. Deterministic; 2-tone fg/bg, off the hot path.
pub fn stamp(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    balance: f32,
    smoothness: f32,
    fg: [u8; 3],
    bg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let thr = balance.clamp(0.0, 1.0);
    let r = (smoothness.clamp(0.0, 1.0) * 8.0).round() as i32; // 0..8 px blur radius
    let src = px.to_vec();
    let lum = |i: usize| {
        (src[i * 4] as f32 * 0.299 + src[i * 4 + 1] as f32 * 0.587 + src[i * 4 + 2] as f32 * 0.114)
            / 65535.0
    };
    let at = |x: i32, y: i32| (y.clamp(0, hi - 1) * wi + x.clamp(0, wi - 1)) as usize;
    let to16 = |c: u8| (c as u16) * 257;
    let fg16 = [to16(fg[0]), to16(fg[1]), to16(fg[2])];
    let bg16 = [to16(bg[0]), to16(bg[1]), to16(bg[2])];
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            // smoothed luma over the (2r+1)² window (r=0 → just this pixel)
            let mut sum = 0.0;
            let mut cnt = 0.0;
            for dy in -r..=r {
                for dx in -r..=r {
                    sum += lum(at(x + dx, y + dy));
                    cnt += 1.0;
                }
            }
            let c = if sum / cnt < thr { fg16 } else { bg16 }; // dark → foreground, light → background
            let p = i * 4;
            for k in 0..3 {
                let v = px[p + k] as f32;
                px[p + k] = (v + (c[k] as f32 - v) * cov).clamp(0.0, 65535.0) as u16;
            }
        }
    }
}

// Filter ▸ Sketch ▸ Note Paper: redraw the image as ink pressed into textured
// paper. Darker tones pull toward the foreground colour, lighter tones toward the
// background colour; Graininess adds paper tooth, and Relief shades the tooth as a
// shallow surface. Deterministic; fg/bg, RGB only, alpha preserved.
pub fn note_paper(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    image_balance: f32,
    graininess: f32,
    relief: f32,
    fg: [u8; 3],
    bg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let threshold = 0.25 + 0.5 * image_balance.clamp(0.0, 1.0);
    let grain = graininess.clamp(0.0, 1.0);
    let rel = relief.clamp(0.0, 1.0);
    let contrast = 3.0 + grain * 7.0;
    let to16 = |c: u8| (c as u16 * 257) as f32;
    let fg16 = [to16(fg[0]), to16(fg[1]), to16(fg[2])];
    let bg16 = [to16(bg[0]), to16(bg[1]), to16(bg[2])];
    let paper = |x: i32, y: i32| -> f32 {
        let xf = x as f32;
        let yf = y as f32;
        let low = tex_noise(xf * 0.37, yf * 0.37);
        let fine = tex_noise((xf + 31.0) * 0.91, (yf - 17.0) * 0.91);
        low * 0.55 + fine * 0.30 + tex_hash(x, y) * 0.15
    };
    let sample_paper = |x: i32, y: i32| paper(x.clamp(0, wi - 1), y.clamp(0, hi - 1));
    let src = px.to_vec();
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let p = i * 4;
            let luma =
                (src[p] as f32 * 0.299 + src[p + 1] as f32 * 0.587 + src[p + 2] as f32 * 0.114)
                    / 65535.0;
            let tooth = paper(x, y) - 0.5;
            let ink = ((threshold - luma + tooth * grain * 0.5) * contrast + 0.5).clamp(0.0, 1.0);
            let slope = (sample_paper(x - 1, y) + sample_paper(x, y - 1)
                - sample_paper(x + 1, y)
                - sample_paper(x, y + 1))
                * 0.5;
            let shade = (tooth * grain * 0.18 + slope * rel * 0.45) * 65535.0;
            for c in 0..3 {
                let target = bg16[c] + (fg16[c] - bg16[c]) * ink + shade;
                let v = px[p + c] as f32;
                px[p + c] = (v + (target.clamp(0.0, 65535.0) - v) * cov).clamp(0.0, 65535.0) as u16;
            }
        }
    }
}

// Filter ▸ Sketch ▸ Torn Edges: reconstruct high-contrast regions as ragged,
// torn pieces of foreground/background paper. Image Balance shifts ink coverage,
// Smoothness washes small detail before thresholding, and Contrast hardens the
// foreground/background split. Deterministic; fg/bg, RGB only, alpha preserved.
pub fn torn_edges(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    image_balance: f32,
    smoothness: f32,
    contrast: f32,
    fg: [u8; 3],
    bg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let threshold = 0.25 + 0.5 * image_balance.clamp(0.0, 1.0);
    let smooth = smoothness.clamp(0.0, 1.0);
    let gain = 0.75 + 10.0 * contrast.clamp(0.0, 1.0);
    let ragged_amp = 0.70 * (1.0 - smooth * 0.85);
    let radius = 1 + (smooth * 6.0).round() as i32;
    let src = px.to_vec();
    let lum = |i: usize| -> f32 {
        (src[i * 4] as f32 * 0.299 + src[i * 4 + 1] as f32 * 0.587 + src[i * 4 + 2] as f32 * 0.114)
            / 65535.0
    };
    let at = |x: i32, y: i32| (y.clamp(0, hi - 1) * wi + x.clamp(0, wi - 1)) as usize;
    let to16 = |c: u8| (c as u16 * 257) as f32;
    let fg16 = [to16(fg[0]), to16(fg[1]), to16(fg[2])];
    let bg16 = [to16(bg[0]), to16(bg[1]), to16(bg[2])];
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let mut sum = 0.0;
            let mut cnt = 0.0;
            for dy in -radius..=radius {
                for dx in -radius..=radius {
                    sum += lum(at(x + dx, y + dy));
                    cnt += 1.0;
                }
            }
            let luma = sum / cnt;
            let xf = x as f32;
            let yf = y as f32;
            let serration = (y
                .wrapping_mul(37)
                .wrapping_add(x.wrapping_mul(11))
                .rem_euclid(23) as f32)
                / 22.0;
            let tear = tex_noise(xf * 0.31, yf * 0.31) * 0.10
                + tex_noise((xf + 23.0) * 0.73, (yf - 41.0) * 0.73) * 0.10
                + tex_hash(x, y) * 0.05
                + tex_hash(0, y) * 0.15
                + serration * 0.60
                - 0.5;
            let ink = ((threshold - luma + tear * ragged_amp) * gain + 0.5).clamp(0.0, 1.0);
            let p = i * 4;
            for c in 0..3 {
                let target = bg16[c] + (fg16[c] - bg16[c]) * ink;
                let v = px[p + c] as f32;
                px[p + c] = (v + (target - v) * cov).clamp(0.0, 65535.0) as u16;
            }
        }
    }
}

// Filter ▸ Sketch ▸ Water Paper: paint the source colours onto fibrous, damp
// paper. Fiber Length controls how far pigment flows along the paper grain,
// Brightness shifts the damp-paper exposure, and Contrast hardens the blotchy
// daubs/tooth. Deterministic; RGB only, alpha preserved, blended by selection.
pub fn water_paper(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    fiber_length: f32,
    brightness: f32,
    contrast: f32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let fiber = fiber_length.clamp(0.0, 1.0);
    let bright = brightness.clamp(0.0, 1.0);
    let ctr = contrast.clamp(0.0, 1.0);
    let radius = 1 + (fiber * 14.0).round() as i32;
    let flow = 0.18 + fiber * 0.74;
    let gain = 0.55 + ctr * 1.85;
    let bright_shift = (bright - 0.5) * 0.42;
    let tooth_amp = 0.03 + ctr * 0.13;
    let src = px.to_vec();
    let mut filtered = src.clone();

    for y in 0..hi {
        let row_slope = (tex_noise(y as f32 * 0.11, 19.0) - 0.5) * 1.15;
        for x in 0..wi {
            let p = (y * wi + x) as usize * 4;
            let daub = tex_noise(x as f32 * 0.16, y as f32 * 0.16) * 0.65
                + tex_noise((x as f32 + 37.0) * 0.41, (y as f32 - 23.0) * 0.41) * 0.35;
            let grain = tex_noise(x as f32 * 0.05, y as f32 * 0.22) * 0.55
                + tex_noise((x as f32 + 11.0) * 0.31, (y as f32 + 7.0) * 0.79) * 0.30
                + tex_hash(x, y) * 0.15
                - 0.5;

            let mut sum = [0.0f32; 3];
            let mut weight_sum = 0.0f32;
            for t in -radius..=radius {
                let ft = t as f32;
                let jy = ((tex_noise((x + t) as f32 * 0.21, y as f32 * 0.21) - 0.5) * fiber * 2.0)
                    .round() as i32;
                let ni = idx(x + t, y + (ft * row_slope).round() as i32 + jy, wi, hi);
                let dist = ft.abs() / (radius as f32 + 1.0);
                let local_tooth = 0.75 + tex_noise((x + t) as f32 * 0.37, y as f32 * 0.37) * 0.25;
                let weight = (1.0 - dist).max(0.0) * local_tooth;
                for c in 0..3 {
                    sum[c] += src[ni + c] as f32 * weight;
                }
                weight_sum += weight;
            }

            let stain = (daub - 0.5) * (0.04 + fiber * 0.05) + grain * tooth_amp;
            for c in 0..3 {
                let orig = src[p + c] as f32 / 65535.0;
                let washed = (sum[c] / weight_sum) / 65535.0;
                let flowed = orig + (washed - orig) * flow;
                let toned = ((flowed + stain + bright_shift - 0.5) * gain + 0.5).clamp(0.0, 1.0);
                filtered[p + c] = to16(toned);
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Sketch ▸ Chalk & Charcoal: reduce the image to three tones — shadows become
// the foreground (charcoal), highlights the background (chalk), and the midtones a solid
// 50% gray. `charcoal_area` 0..1 expands the shadow→fg zone, `chalk_area` 0..1 the
// highlight→bg zone, `stroke_pressure` 0..1 the effect strength (1 = full 3-tone, lower
// blends back toward the original). Deterministic; fg/bg tonal map, off the hot path.
pub fn chalk_charcoal(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    charcoal_area: f32,
    chalk_area: f32,
    stroke_pressure: f32,
    fg: [u8; 3],
    bg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let lo = charcoal_area.clamp(0.0, 1.0); // L < lo → charcoal (foreground)
    let hi_thr = 1.0 - chalk_area.clamp(0.0, 1.0); // L > hi_thr → chalk (background)
    let keep = 1.0 - stroke_pressure.clamp(0.0, 1.0); // blend back toward the original
    let to16 = |c: u8| (c as u16 * 257) as f32;
    let fg16 = [to16(fg[0]), to16(fg[1]), to16(fg[2])];
    let bg16 = [to16(bg[0]), to16(bg[1]), to16(bg[2])];
    let mid = [32768.0f32; 3]; // 50% gray — the default third tone
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let p = i * 4;
            let l = (px[p] as f32 * 0.299 + px[p + 1] as f32 * 0.587 + px[p + 2] as f32 * 0.114)
                / 65535.0;
            let target = if l < lo {
                fg16
            } else if l > hi_thr {
                bg16
            } else {
                mid
            };
            for c in 0..3 {
                let v = px[p + c] as f32;
                let out = target[c] + (v - target[c]) * keep; // stroke pressure 1 → out = target
                px[p + c] = (v + (out - v) * cov).clamp(0.0, 65535.0) as u16;
            }
            // alpha preserved
        }
    }
}

// Filter ▸ Sketch ▸ Conte Crayon: redraw tones as dense foreground crayon in
// shadows and background crayon in highlights, with the same Canvas/Sandstone/
// Brick/Burlap relief surface as Texturizer. Foreground/Background Level expand
// each tonal zone; Scaling, Relief, and Light control the paper texture. RGB only,
// alpha preserved, blended by active selection coverage.
pub fn conte_crayon(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    foreground_level: f32,
    background_level: f32,
    texture: u8,
    scaling: f32,
    relief: f32,
    light: u8,
    fg: [u8; 3],
    bg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let fg_level = foreground_level.clamp(0.0, 1.0);
    let bg_level = background_level.clamp(0.0, 1.0);
    let rel = relief.clamp(0.0, 1.0);
    let period = texture_period(scaling);
    let height = |x: i32, y: i32| texture_surface_height(texture, period, x, y);
    let (lx, ly) = texture_light_dir(light);
    let to16 = |c: u8| (c as u16 * 257) as f32;
    let fg16 = [to16(fg[0]), to16(fg[1]), to16(fg[2])];
    let bg16 = [to16(bg[0]), to16(bg[1]), to16(bg[2])];
    let mid = [32768.0f32; 3];
    let src = px.to_vec();

    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let p = i * 4;
            let luma =
                (src[p] as f32 * 0.299 + src[p + 1] as f32 * 0.587 + src[p + 2] as f32 * 0.114)
                    / 65535.0;
            let surf = height(x, y);
            let ridge = (0.65 + surf * 0.55).clamp(0.0, 1.0);
            let dark = if fg_level <= 0.0 {
                0.0
            } else {
                ((fg_level - luma) / fg_level.max(0.001)).clamp(0.0, 1.0) * ridge
            };
            let light = if bg_level <= 0.0 {
                0.0
            } else {
                ((luma - (1.0 - bg_level)) / bg_level.max(0.001)).clamp(0.0, 1.0) * ridge
            };
            let total = dark + light;
            let scale = if total > 1.0 { 1.0 / total } else { 1.0 };
            let dark_w = dark * scale;
            let light_w = light * scale;
            let mid_w = (1.0 - total).max(0.0);
            let shade = (height(x, y) - height(x + lx, y + ly)) * rel * 42000.0;
            for c in 0..3 {
                let target = mid[c] * mid_w + fg16[c] * dark_w + bg16[c] * light_w + shade;
                let v = src[p + c] as f32;
                px[p + c] = (v + (target.clamp(0.0, 65535.0) - v) * cov).clamp(0.0, 65535.0) as u16;
            }
        }
    }
}

// Filter ▸ Sketch ▸ Reticulation: simulate clustered film-emulsion grain. Dark
// clumps pull toward the foreground colour, highlights toward the background,
// and Density controls how strongly the noise field breaks tones into clusters.
// Foreground/Background Level expand the shadow/highlight crayon zones. RGB only,
// alpha preserved, blended by active selection coverage.
pub fn reticulation(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    density: f32,
    foreground_level: f32,
    background_level: f32,
    fg: [u8; 3],
    bg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let den = density.clamp(0.0, 1.0);
    let fg_level = foreground_level.clamp(0.0, 1.0);
    let bg_level = background_level.clamp(0.0, 1.0);
    let gain = 1.0 + den * 5.0;
    let to16 = |c: u8| (c as u16 * 257) as f32;
    let fg16 = [to16(fg[0]), to16(fg[1]), to16(fg[2])];
    let bg16 = [to16(bg[0]), to16(bg[1]), to16(bg[2])];
    let src = px.to_vec();

    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let p = i * 4;
            let luma =
                (src[p] as f32 * 0.299 + src[p + 1] as f32 * 0.587 + src[p + 2] as f32 * 0.114)
                    / 65535.0;
            let clump = tex_noise(x as f32 * 0.23, y as f32 * 0.23) * 0.70
                + tex_noise((x as f32 + 19.0) * 0.61, (y as f32 - 7.0) * 0.61) * 0.20
                + tex_hash(x, y) * 0.10
                - 0.5;
            let tonal = (luma + clump * den * 0.42).clamp(0.0, 1.0);
            let dark = if fg_level <= 0.0 {
                0.0
            } else {
                ((fg_level - tonal) / fg_level.max(0.001) * gain).clamp(0.0, 1.0)
            };
            let light = if bg_level <= 0.0 {
                0.0
            } else {
                ((tonal - (1.0 - bg_level)) / bg_level.max(0.001) * gain).clamp(0.0, 1.0)
            };
            let total = dark + light;
            let scale = if total > 1.0 { 1.0 / total } else { 1.0 };
            let dark_w = dark * scale;
            let light_w = light * scale;
            let keep = (1.0 - total).max(0.0) * (1.0 - den * 0.65);
            for c in 0..3 {
                let target = src[p + c] as f32 * keep + fg16[c] * dark_w + bg16[c] * light_w;
                let v = src[p + c] as f32;
                px[p + c] = (v + (target.clamp(0.0, 65535.0) - v) * cov).clamp(0.0, 65535.0) as u16;
            }
        }
    }
}

// Filter ▸ Sketch ▸ Plaster: mold the layer into a fg/bg coloured relief where
// dark areas are raised and light areas are sunken. Image Balance shifts midtones
// toward the raised foreground or sunken background; Smoothness pre-blurs the
// height field; Light picks the relief direction. RGB only, alpha preserved,
// blended by active selection coverage.
pub fn plaster(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    image_balance: f32,
    smoothness: f32,
    light: u8,
    fg: [u8; 3],
    bg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let n = (wi * hi) as usize;
    let src = px.to_vec();
    let at = |x: i32, y: i32| (y.clamp(0, hi - 1) * wi + x.clamp(0, wi - 1)) as usize;
    let lum = |i: usize| {
        (src[i * 4] as f32 * 0.299 + src[i * 4 + 1] as f32 * 0.587 + src[i * 4 + 2] as f32 * 0.114)
            / 65535.0
    };
    let radius = (smoothness.clamp(0.0, 1.0) * 7.0).round() as i32;
    let mut field = vec![0.0f32; n];
    if radius == 0 {
        for i in 0..n {
            field[i] = lum(i);
        }
    } else {
        for y in 0..hi {
            for x in 0..wi {
                let mut sum = 0.0;
                let mut count = 0.0;
                for dy in -radius..=radius {
                    for dx in -radius..=radius {
                        sum += lum(at(x + dx, y + dy));
                        count += 1.0;
                    }
                }
                field[(y * wi + x) as usize] = sum / count;
            }
        }
    }

    let balance_shift = (image_balance.clamp(0.0, 1.0) - 0.5) * 0.55;
    let (lx, ly) = texture_light_dir(light);
    let to16 = |c: u8| c as f32 * 257.0;
    let fg16 = [to16(fg[0]), to16(fg[1]), to16(fg[2])];
    let bg16 = [to16(bg[0]), to16(bg[1]), to16(bg[2])];
    let mut filtered = src.clone();

    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let p = i * 4;
            let l = field[i];
            let bg_mix = (l - balance_shift).clamp(0.0, 1.0);
            let height = 1.0 - l;
            let height_toward_light = 1.0 - field[at(x + lx, y + ly)];
            let shade = (height - height_toward_light) * 38000.0;
            for c in 0..3 {
                let base = fg16[c] + (bg16[c] - fg16[c]) * bg_mix;
                filtered[p + c] = (base + shade).clamp(0.0, 65535.0) as u16;
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Texture ▸ Grain: simulate film grain with ten grain types (the last unshipped
// member of the Texture group). `intensity` 0..1 is the grain amplitude (0 = no-op),
// `contrast` 0..1 amplifies the grain/blend, `grain_type` 0..9 selects the noise pattern.
// Two families: additive monochromatic grain (the same signed delta added to R/G/B, so a
// gray field stays neutral) and a background-colour speckle (Sprinkles/Stippled drop bg-
// coloured specks). Deterministic via tex_hash/tex_noise; RGB only; blended by coverage.
// Distinct from Artistic ▸ Film Grain (single-mode, no grain-type/contrast/bg-colour).
pub fn texture_grain(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    intensity: f32,
    contrast: f32,
    grain_type: u8,
    bg: [u8; 3],
) {
    let it = intensity.clamp(0.0, 1.0);
    if it <= 0.0 {
        return;
    }
    let (wi, hi) = (w as i32, h as i32);
    let ct = contrast.clamp(0.0, 1.0);
    let amp = it * 0.6 * 65535.0; // additive grain swing
    let cgain = 1.0 + 2.0 * ct; // contrast amplifies the delta
    let to16 = |c: u8| (c as u16 * 257) as f32;
    let bg16 = [to16(bg[0]), to16(bg[1]), to16(bg[2])];
    let blend = 0.5 + 0.5 * ct; // bg-blend strength for Sprinkles/Stippled
    let thr = 1.0 - it * 0.5; // higher intensity → more specks pass
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let p = i * 4;
            // Sprinkles (coarse value noise) / Stippled (fine per-pixel hash): bg-colour specks.
            if grain_type == 2 || grain_type == 6 {
                let hit = if grain_type == 2 {
                    tex_noise(x as f32 * 0.5, y as f32 * 0.5) > thr
                } else {
                    tex_hash(x, y) > thr
                };
                if hit {
                    for c in 0..3 {
                        let v = px[p + c] as f32;
                        px[p + c] = (v + (bg16[c] - v) * blend * cov).clamp(0.0, 65535.0) as u16;
                    }
                }
                continue;
            }
            // Additive monochromatic grain: one signed delta dn ∈ [-1,1] added to R/G/B.
            let dn = match grain_type {
                1 => (tex_noise(x as f32 * 0.25, y as f32 * 0.25) - 0.5) * 2.0, // Soft (low-freq)
                3 => {
                    ((tex_noise(x as f32 * 0.5, y as f32 * 0.5)
                        + tex_noise(x as f32 * 0.12, y as f32 * 0.12))
                        * 0.5
                        - 0.5)
                        * 2.0
                } // Clumped (two octaves)
                4 => ((tex_hash(x, y) - 0.5) * 4.0).clamp(-1.0, 1.0), // Contrasty (steeper → saturates)
                5 => (tex_noise(x as f32 * 0.05, y as f32 * 0.05) - 0.5) * 2.0, // Enlarged (coarse cells)
                7 => (tex_hash(0, y) - 0.5) * 2.0, // Horizontal (constant per row)
                8 => (tex_hash(x, 0) - 0.5) * 2.0, // Vertical (constant per column)
                9 => {
                    if tex_hash(x, y) < it * 0.3 {
                        if tex_hash(x + 7, y + 3) < 0.5 {
                            -1.0
                        } else {
                            1.0
                        }
                    } else {
                        0.0
                    }
                } // Speckle (sparse bimodal)
                _ => (tex_hash(x, y) - 0.5) * 2.0, // 0 Regular
            };
            let d = (dn * cgain).clamp(-1.0, 1.0) * amp * cov;
            for c in 0..3 {
                px[p + c] = (px[p + c] as f32 + d).clamp(0.0, 65535.0) as u16;
            }
        }
    }
}

// Filter ▸ Artistic ▸ Plastic Wrap: coat the image in shiny plastic — a white specular
// highlight forms along the surface curvature (the luma gradient), as though shrink-wrapped.
// Unlike the edge/relief family (find_edges/emboss/bas_relief/accented_edges/ink_outlines)
// it KEEPS the full-colour image and only ADDS a sheen at ridges, leaving flats untouched.
// `highlight_strength` 0..1 is the sheen gain (0 = no-op), `detail` 0..1 the gradient sampling
// distance, `smoothness` 0..1 the luma pre-blur (wider, softer sheen). RGB only; by coverage.
pub fn plastic_wrap(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    highlight_strength: f32,
    detail: f32,
    smoothness: f32,
) {
    let hs = highlight_strength.clamp(0.0, 1.0);
    if hs <= 0.0 {
        return;
    }
    let (wi, hi) = (w as i32, h as i32);
    let n = (wi * hi) as usize;
    let r = (smoothness.clamp(0.0, 1.0) * 6.0).round() as i32; // 0..6 luma smoothing radius
    let d = 1 + (detail.clamp(0.0, 1.0) * 3.0).round() as i32; // 1..4 gradient sampling distance
    let at = |x: i32, y: i32| (y.clamp(0, hi - 1) * wi + x.clamp(0, wi - 1)) as usize;
    // Snapshot the luma, then box-blur it by `r` into the field the gradient samples.
    let mut luma = vec![0.0f32; n];
    for i in 0..n {
        let p = i * 4;
        luma[i] = px[p] as f32 * 0.299 + px[p + 1] as f32 * 0.587 + px[p + 2] as f32 * 0.114;
    }
    let field = if r == 0 {
        luma
    } else {
        let mut f = vec![0.0f32; n];
        for y in 0..hi {
            for x in 0..wi {
                let (mut s, mut c) = (0.0, 0.0);
                for dy in -r..=r {
                    for dx in -r..=r {
                        s += luma[at(x + dx, y + dy)];
                        c += 1.0;
                    }
                }
                f[(y * wi + x) as usize] = s / c;
            }
        }
        f
    };
    let gain = 0.5 + hs * 3.0;
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            // central-difference gradient of the smoothed luma at distance d → specular sheen
            let gx = field[at(x + d, y)] - field[at(x - d, y)];
            let gy = field[at(x, y + d)] - field[at(x, y - d)];
            let mag = (gx * gx + gy * gy).sqrt();
            let hl = ((mag / 65535.0) * gain).clamp(0.0, 1.0).sqrt();
            let p = i * 4;
            for c in 0..3 {
                let v = px[p + c] as f32;
                let out = v + (65535.0 - v) * hl; // additive toward white at curvature
                px[p + c] = (v + (out - v) * cov).clamp(0.0, 65535.0) as u16;
            }
        }
    }
}

// Filter ▸ Distort ▸ Diffuse Glow: bloom the highlights toward the background
// colour, as though viewed through a soft diffusion filter. A pixel above the
// `clear_amount` luminance threshold is blended toward the background colour by
// `glow_amount`; `graininess` sprinkles deterministic noise into the glow mask.
// Shadows below the threshold are left clear.
pub fn diffuse_glow(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    graininess: f32,
    glow_amount: f32,
    clear_amount: f32,
    bg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let clear_thr = (clear_amount / 20.0).clamp(0.0, 0.99);
    let glow = (glow_amount / 10.0).max(0.0);
    let grain = (graininess / 10.0).max(0.0);
    let bgf = [
        bg[0] as f32 / 255.0,
        bg[1] as f32 / 255.0,
        bg[2] as f32 / 255.0,
    ];
    let src = px.to_vec();
    let mut filtered = src.clone();
    for y in 0..hi {
        for x in 0..wi {
            let ci = (y * wi + x) as usize * 4;
            let lc =
                (src[ci] as f32 * 0.299 + src[ci + 1] as f32 * 0.587 + src[ci + 2] as f32 * 0.114)
                    / 65535.0;
            let mut t = ((lc - clear_thr) / (1.0 - clear_thr)).clamp(0.0, 1.0);
            if grain > 0.0 {
                let n = hash2(x, y) as f32 / u32::MAX as f32 - 0.5; // [-0.5, 0.5]
                t = (t + n * grain).clamp(0.0, 1.0);
            }
            let m = (t * glow).clamp(0.0, 1.0);
            for k in 0..3 {
                let c = src[ci + k] as f32 / 65535.0;
                filtered[ci + k] = to16(c + (bgf[k] - c) * m);
            }
            // alpha preserved
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Artistic ▸ Neon Glow: a neon recolour — map each pixel's tone into the
// glow colour, with shadows going dark and highlights blowing toward white. `glow_size`
// −1..1 shifts where the glow peaks (low → shadows, high → highlights); `glow_brightness`
// 0..1 the glow intensity; `glow` is the glow colour (Vision passes the foreground). The
// glow peaks at `mid`: below it black ramps up to the glow, above it the glow ramps to
// white. Deterministic, off the hot path; RGB only (alpha preserved).
pub fn neon_glow(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    glow_size: f32,
    glow_brightness: f32,
    glow: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let mid = (0.5 + 0.4 * glow_size.clamp(-1.0, 1.0)).clamp(0.1, 0.9);
    let br = glow_brightness.clamp(0.0, 1.0);
    // the glow colour pre-scaled by brightness (u8 → u16 ×257)
    let g = [
        glow[0] as f32 * 257.0 * br,
        glow[1] as f32 * 257.0 * br,
        glow[2] as f32 * 257.0 * br,
    ];
    let src = px.to_vec();
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let p = i * 4;
            let l = (src[p] as f32 * 0.299 + src[p + 1] as f32 * 0.587 + src[p + 2] as f32 * 0.114)
                / 65535.0;
            for c in 0..3 {
                let out = if l < mid {
                    g[c] * (l / mid) // shadows: black ramps up to the glow colour
                } else {
                    g[c] + (65535.0 - g[c]) * ((l - mid) / (1.0 - mid)) // highlights: glow ramps to white
                };
                let v = src[p + c] as f32;
                px[p + c] = (v + (out - v) * cov).clamp(0.0, 65535.0) as u16;
            }
            // alpha preserved
        }
    }
}

// Filter ▸ Stylize ▸ Wind: streak edges horizontally to simulate wind. Each
// pixel takes the brightest *upwind* value within a short tail, faded by
// distance, so a bright feature grows a one-sided downwind streak while its
// upwind edge stays sharp. `method` 0 Wind · 1 Blast (longer, stronger) ·
// 2 Stagger (alternate rows offset). `from_left` true = wind from the left, so
// streaks blow to the right. Per channel, so coloured features streak in colour.
pub fn wind(px: &mut [u16], w: u32, h: u32, sel: &Selection, method: u8, from_left: bool) {
    let (w, h) = (w as i32, h as i32);
    let src = px.to_vec();
    let len = if method == 1 { 24 } else { 10 }; // Blast reaches further
    let dir = if from_left { 1 } else { -1 }; // streak direction; sample upwind
    let mut filtered = src.clone();
    for y in 0..h {
        let stagger = if method == 2 && (y & 1 == 1) { 2 } else { 0 };
        for x in 0..w {
            let di = (y * w + x) as usize * 4;
            for c in 0..3 {
                let mut best = src[di + c] as f32; // k = 0 (self), full strength
                for k in 1..=len {
                    let sx = x - dir * (k + stagger);
                    if sx < 0 || sx >= w {
                        continue;
                    }
                    let faded = src[(y * w + sx) as usize * 4 + c] as f32
                        * (1.0 - k as f32 / (len as f32 + 1.0));
                    if faded > best {
                        best = faded;
                    }
                }
                filtered[di + c] = best.round() as u16;
            }
            // alpha is preserved from the clone
        }
    }
    blend_back(px, &filtered, sel);
}

// Emboss: directional gradient mapped to grey, `angle` in degrees.
pub fn emboss(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    angle: f32,
    amount: f32,
    height: f32,
) {
    let (w, h) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let rad = angle.to_radians();
    // Photoshop's Height = the relief thickness: the neighbour is sampled this
    // many px along `angle` (min 1). height 1 reproduces the original 1-px offset.
    let height = height.max(1.0);
    let dx = rad.cos() * height;
    let dy = rad.sin() * height;
    for y in 0..h {
        for x in 0..w {
            let di = (y * w + x) as usize * 4;
            let sx = (x as f32 + dx).round() as i32;
            let sy = (y as f32 + dy).round() as i32;
            for k in 0..3 {
                let a = src[idx(x, y, w, h) + k] as f32;
                let b = src[idx(sx, sy, w, h) + k] as f32;
                let v = 32768.0 + (a - b) * amount;
                filtered[di + k] = v.clamp(0.0, 65535.0) as u16;
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Motion blur along `angle` (deg) over `distance` px.
pub fn motion_blur(px: &mut [u16], w: u32, h: u32, sel: &Selection, angle: f32, distance: f32) {
    if distance < 1.0 {
        return;
    }
    let (w, h) = (w as i32, h as i32);
    let n = (w * h) as usize;
    let src = px.to_vec();
    let mut filtered = vec![0u16; n * 4];
    let rad = angle.to_radians();
    let dx = rad.cos();
    let dy = rad.sin();
    let steps = distance.round() as i32;
    let half = steps / 2;
    for y in 0..h {
        for x in 0..w {
            // Premultiplied accumulate (see box_blur) — no halos at edges.
            let mut acc = [0f32; 4];
            let mut cnt = 0f32;
            for s in -half..=half {
                let sx = (x as f32 + dx * s as f32).round() as i32;
                let sy = (y as f32 + dy * s as f32).round() as i32;
                let si = idx(sx, sy, w, h);
                let a = src[si + 3] as f32 / 65535.0;
                acc[0] += src[si] as f32 / 65535.0 * a;
                acc[1] += src[si + 1] as f32 / 65535.0 * a;
                acc[2] += src[si + 2] as f32 / 65535.0 * a;
                acc[3] += a;
                cnt += 1.0;
            }
            let di = (y * w + x) as usize * 4;
            let a = acc[3] / cnt;
            if a > 1e-4 {
                filtered[di] = to16(acc[0] / cnt / a);
                filtered[di + 1] = to16(acc[1] / cnt / a);
                filtered[di + 2] = to16(acc[2] / cnt / a);
            }
            filtered[di + 3] = to16(a);
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Blur ▸ Path Blur: a directional blur along the path `angle`, `speed` px
// long. Unlike Motion Blur (a symmetric smear), Path Blur can TRAIL: with
// `centered` off it samples only backward along the path, producing a one-sided
// motion streak (a comet trail). `taper` 0..1 fades the samples toward the far end
// of the streak (0 = even, 1 = the far end barely contributes). Premultiplied
// accumulate (no edge halos). speed < 1 is a no-op.
pub fn path_blur(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    angle: f32,
    speed: f32,
    taper: f32,
    centered: bool,
) {
    path_blur_paths(px, w, h, sel, &[], angle, speed, taper, centered, false);
}

/// Path Blur path record — variable length and self-describing, so several
/// drawn paths pack into one flat array:
/// `[point_count, speed_start, speed_end, x0, y0, x1, y1, …]`
///
/// The points are the UI's already-flattened Bezier polyline in document px
/// (`blurPathStrokes.ts` owns the curve maths); `speed_start`/`speed_end` are
/// Adobe's draggable End Point Speed handles as multipliers on the global
/// `speed`, lerped along the path by arc length.
pub const PATH_BLUR_HEADER: usize = 3;

struct BlurPath {
    pts: Vec<(f32, f32)>,
    /// Arc length at each point; the last entry is the path total.
    cum: Vec<f32>,
    s0: f32,
    s1: f32,
}

// Walk the flat record array. Anything malformed (NaN count, < 2 points, a
// truncated tail) stops the walk rather than reading past the record — this is
// a trust boundary: the array comes from JS and from persisted filter params.
fn parse_blur_paths(flat: &[f32]) -> Vec<BlurPath> {
    let mut out = Vec::new();
    let mut i = 0usize;
    while i + PATH_BLUR_HEADER <= flat.len() {
        let count = flat[i];
        if !count.is_finite() || !(2.0..=1e6).contains(&count) {
            break;
        }
        let n = count as usize;
        let head = i;
        let end = head + PATH_BLUR_HEADER + n * 2;
        if end > flat.len() {
            break;
        }
        i = end;
        let pts: Vec<(f32, f32)> = (0..n)
            .map(|k| {
                (
                    flat[head + PATH_BLUR_HEADER + k * 2],
                    flat[head + PATH_BLUR_HEADER + k * 2 + 1],
                )
            })
            .collect();
        if pts.iter().any(|p| !p.0.is_finite() || !p.1.is_finite()) {
            continue;
        }
        let mut cum = Vec::with_capacity(n);
        let mut acc = 0.0f32;
        cum.push(0.0);
        for k in 1..n {
            acc += (pts[k].0 - pts[k - 1].0).hypot(pts[k].1 - pts[k - 1].1);
            cum.push(acc);
        }
        if acc <= 1e-3 {
            continue; // a zero-length path carries no direction
        }
        let s0 = flat[head + 1];
        let s1 = flat[head + 2];
        out.push(BlurPath {
            pts,
            cum,
            s0: if s0.is_finite() { s0.max(0.0) } else { 1.0 },
            s1: if s1.is_finite() { s1.max(0.0) } else { 1.0 },
        });
    }
    out
}

// Nearest point on the path to (fx, fy): squared distance, the unit tangent
// there and the 0..1 arc-length position (which drives the end-point speed lerp).
fn nearest_on_path(p: &BlurPath, fx: f32, fy: f32) -> (f32, f32, f32, f32) {
    let total = p.cum.last().copied().unwrap_or(1.0).max(1e-3);
    let mut best = (f32::MAX, 1.0f32, 0.0f32, 0.0f32);
    for k in 1..p.pts.len() {
        let (ax, ay) = p.pts[k - 1];
        let (bx, by) = p.pts[k];
        let (ex, ey) = (bx - ax, by - ay);
        let len2 = ex * ex + ey * ey;
        if len2 < 1e-9 {
            continue;
        }
        let t = (((fx - ax) * ex + (fy - ay) * ey) / len2).clamp(0.0, 1.0);
        let d2 = (fx - (ax + ex * t)).powi(2) + (fy - (ay + ey * t)).powi(2);
        if d2 < best.0 {
            let len = len2.sqrt();
            best = (d2, ex / len, ey / len, (p.cum[k - 1] + len * t) / total);
        }
    }
    best
}

// Rear Sync Flash: a rear-curtain flash freezes the subject at the END of the
// exposure, so the sample at the pixel's own position outweighs the trail.
const REAR_SYNC_FLASH: f32 = 6.0;

/// Filter ▸ Blur Gallery ▸ Path Blur with user-drawn paths. Each pixel takes its
/// streak direction and length from the paths around it — nearest point per
/// path, blended between paths by inverse-square distance — so the blur follows
/// the drawn motion instead of one global angle. With no paths this is exactly
/// the global-`angle` streak (`path_blur`, byte-frozen).
///
/// `rear_sync` switches Adobe's Basic Blur ▸ Rear Sync Flash: the sharp frame
/// lands at the head of the trail rather than smearing evenly.
#[allow(clippy::too_many_arguments)]
pub fn path_blur_paths(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    paths: &[f32],
    angle: f32,
    speed: f32,
    taper: f32,
    centered: bool,
    rear_sync: bool,
) {
    if speed < 1.0 {
        return;
    }
    let paths = parse_blur_paths(paths);
    let (w, h) = (w as i32, h as i32);
    let n = (w * h) as usize;
    let src = px.to_vec();
    let mut filtered = vec![0u16; n * 4];
    let rad = angle.to_radians();
    let (fallback_x, fallback_y) = (rad.cos(), rad.sin());
    let t = taper.clamp(0.0, 1.0);
    for y in 0..h {
        for x in 0..w {
            let di = (y * w + x) as usize * 4;
            // Local direction + speed multiplier from the drawn paths.
            let (dx, dy, mul) = if paths.is_empty() {
                (fallback_x, fallback_y, 1.0)
            } else {
                let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
                let (mut vx, mut vy, mut vs, mut den) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
                for p in &paths {
                    let (d2, tx, ty, at) = nearest_on_path(p, fx, fy);
                    let wgt = 1.0 / (d2 + 1.0); // +1 px² keeps the pole finite on the path
                    vx += tx * wgt;
                    vy += ty * wgt;
                    vs += (p.s0 + (p.s1 - p.s0) * at) * wgt;
                    den += wgt;
                }
                let mag = vx.hypot(vy);
                if den <= 0.0 || mag < 1e-4 {
                    // Opposed paths cancel — fall back to the global angle.
                    (fallback_x, fallback_y, 1.0)
                } else {
                    (vx / mag, vy / mag, vs / den)
                }
            };
            let steps = (speed * mul).round() as i32;
            if steps < 1 {
                // An end-point speed of 0 means "no motion here": keep the pixel.
                filtered[di..di + 4].copy_from_slice(&src[di..di + 4]);
                continue;
            }
            let half = (steps / 2).max(1);
            // Sample range + the divisor that maps a sample to 0..1 "distance toward the far end".
            let (lo, hi_s, denom) = if centered {
                (-half, half, half as f32)
            } else {
                (-steps, 0, steps as f32)
            };
            let mut acc = [0f32; 4];
            let mut cnt = 0f32;
            for s in lo..=hi_s {
                let frac = (s.abs() as f32) / denom; // 0 near the pixel, 1 at the far end
                let mut wgt = 1.0 - t * frac; // taper fades the far samples
                if rear_sync && s == 0 {
                    wgt *= REAR_SYNC_FLASH;
                }
                let sx = (x as f32 + dx * s as f32).round() as i32;
                let sy = (y as f32 + dy * s as f32).round() as i32;
                let si = idx(sx, sy, w, h);
                let a = src[si + 3] as f32 / 65535.0;
                acc[0] += src[si] as f32 / 65535.0 * a * wgt;
                acc[1] += src[si + 1] as f32 / 65535.0 * a * wgt;
                acc[2] += src[si + 2] as f32 / 65535.0 * a * wgt;
                acc[3] += a * wgt;
                cnt += wgt;
            }
            let a = acc[3] / cnt;
            if a > 1e-4 {
                filtered[di] = to16(acc[0] / cnt / a);
                filtered[di + 1] = to16(acc[1] / cnt / a);
                filtered[di + 2] = to16(acc[2] / cnt / a);
            }
            filtered[di + 3] = to16(a);
        }
    }
    blend_back(px, &filtered, sel);
}

// High Pass: keep only edges/detail above the blur radius (grey base).
pub fn high_pass(px: &mut [u16], w: u32, h: u32, sel: &Selection, radius: f32) {
    let orig = px.to_vec();
    let mut blurred = px.to_vec();
    let full = Selection {
        w,
        h,
        active: false,
        mask: Vec::new(),
        antialias: true,
    };
    gaussian_blur(&mut blurred, w, h, &full, radius.max(0.5));
    let n = (w * h) as usize;
    let mut filtered = orig.clone();
    for i in 0..n {
        for k in 0..3 {
            let v = 32768.0 + (orig[i * 4 + k] as f32 - blurred[i * 4 + k] as f32);
            filtered[i * 4 + k] = v.clamp(0.0, 65535.0) as u16;
        }
    }
    blend_back(px, &filtered, sel);
}

// Mosaic / pixelate: average square blocks of `size` px.
pub fn mosaic(px: &mut [u16], w: u32, h: u32, sel: &Selection, size: i32) {
    if size < 2 {
        return;
    }
    let (w, h) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let mut by = 0;
    while by < h {
        let mut bx = 0;
        while bx < w {
            // Premultiplied block average (see box_blur) — a block straddling
            // a transparent edge keeps the content's color, not a darkened mix.
            let mut acc = [0f32; 4];
            let mut cnt = 0f32;
            for y in by..(by + size).min(h) {
                for x in bx..(bx + size).min(w) {
                    let i = (y * w + x) as usize * 4;
                    let a = src[i + 3] as f32 / 65535.0;
                    acc[0] += src[i] as f32 / 65535.0 * a;
                    acc[1] += src[i + 1] as f32 / 65535.0 * a;
                    acc[2] += src[i + 2] as f32 / 65535.0 * a;
                    acc[3] += a;
                    cnt += 1.0;
                }
            }
            let a = acc[3] / cnt.max(1.0);
            let mut block = [0u16; 4];
            if a > 1e-4 {
                block[0] = to16(acc[0] / cnt.max(1.0) / a);
                block[1] = to16(acc[1] / cnt.max(1.0) / a);
                block[2] = to16(acc[2] / cnt.max(1.0) / a);
            }
            block[3] = to16(a);
            for y in by..(by + size).min(h) {
                for x in bx..(bx + size).min(w) {
                    let i = (y * w + x) as usize * 4;
                    filtered[i..i + 4].copy_from_slice(&block);
                }
            }
            bx += size;
        }
        by += size;
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Pixelate ▸ Fragment: average four copies of the image offset to the
// four diagonal corners of a small square — the one-click "earthquake" jitter.
// Photoshop's Fragment takes no parameters; the displacement is a fixed pixel
// offset. Like the other averaging filters it mixes premultiplied so a copy
// straddling a transparent edge doesn't darken the result.
pub fn fragment(px: &mut [u16], w: u32, h: u32, sel: &Selection) {
    const OFF: i32 = 4; // half-size of the square the four copies are spread across
    let (w, h) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    for y in 0..h {
        for x in 0..w {
            let di = (y * w + x) as usize * 4;
            let mut acc = [0f32; 4];
            for (ox, oy) in [(-OFF, -OFF), (OFF, -OFF), (-OFF, OFF), (OFF, OFF)] {
                let i = idx(x + ox, y + oy, w, h);
                let a = src[i + 3] as f32 / 65535.0;
                acc[0] += src[i] as f32 / 65535.0 * a;
                acc[1] += src[i + 1] as f32 / 65535.0 * a;
                acc[2] += src[i + 2] as f32 / 65535.0 * a;
                acc[3] += a;
            }
            let a = acc[3] / 4.0;
            if a > 1e-4 {
                filtered[di] = to16(acc[0] / 4.0 / a);
                filtered[di + 1] = to16(acc[1] / 4.0 / a);
                filtered[di + 2] = to16(acc[2] / 4.0 / a);
            }
            filtered[di + 3] = to16(a);
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Pixelate ▸ Color Halftone: simulate an enlarged halftone screen on
// each channel. Each channel is screened independently at its own angle: the
// image is covered by a rotated grid of cells pitched at ~2·max_radius, and in
// each cell a dot is inked whose AREA grows with that channel's brightness at
// the cell centre — bright areas get big overlapping dots, dark areas none.
pub fn color_halftone(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    max_radius: f32,
    angles: [f32; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let spacing = (max_radius * 2.0).max(2.0); // cell pitch
    let half_diag = spacing * 0.5 * std::f32::consts::SQRT_2; // value 1.0 fills the cell
    let cx = wi as f32 / 2.0;
    let cy = hi as f32 / 2.0;
    for c in 0..3 {
        let (sin, cos) = angles[c].to_radians().sin_cos();
        for y in 0..hi {
            for x in 0..wi {
                let dx = x as f32 - cx;
                let dy = y as f32 - cy;
                // rotate the pixel into the screen's grid space (−angle)
                let u = dx * cos + dy * sin;
                let v = -dx * sin + dy * cos;
                let cu0 = (u / spacing).round();
                let cv0 = (v / spacing).round();
                // inked if the pixel falls inside ANY nearby cell's dot (dots overlap)
                let mut ink = 0u16;
                'cells: for gj in -1..=1 {
                    for gi in -1..=1 {
                        let cu = (cu0 + gi as f32) * spacing;
                        let cv = (cv0 + gj as f32) * spacing;
                        // rotate the cell centre back to image space to read its value
                        let sx = (u_back(cu, cv, cos, sin) + cx)
                            .round()
                            .clamp(0.0, (wi - 1) as f32) as i32;
                        let sy = (v_back(cu, cv, cos, sin) + cy)
                            .round()
                            .clamp(0.0, (hi - 1) as f32) as i32;
                        let val = src[(sy * wi + sx) as usize * 4 + c] as f32 / 65535.0;
                        let radius = val.sqrt() * half_diag; // area ∝ value
                        let dist = ((u - cu).powi(2) + (v - cv).powi(2)).sqrt();
                        if dist < radius {
                            // strict, so a zero-radius (black) cell inks nothing
                            ink = 65535;
                            break 'cells;
                        }
                    }
                }
                filtered[(y * wi + x) as usize * 4 + c] = ink;
            }
        }
    }
    blend_back(px, &filtered, sel);
}
#[inline]
fn u_back(u: f32, v: f32, cos: f32, sin: f32) -> f32 {
    u * cos - v * sin
}
#[inline]
fn v_back(u: f32, v: f32, cos: f32, sin: f32) -> f32 {
    u * sin + v * cos
}

// A small integer hash → used to scatter Crystallize's cell seeds reproducibly.
fn hash2(x: i32, y: i32) -> u32 {
    let mut v = (x as u32).wrapping_mul(0x9E37_79B1) ^ (y as u32).wrapping_mul(0x85EB_CA6B);
    v ^= v >> 15;
    v = v.wrapping_mul(0x2C1B_3C6D);
    v ^= v >> 12;
    v = v.wrapping_mul(0x297A_2D39);
    v ^= v >> 15;
    v
}

// Filter ▸ Pixelate ▸ Crystallize: clump pixels into solid-coloured polygonal
// cells (a Voronoi diagram). Seeds sit on a grid pitched at `cell_size`, jittered
// within each grid cell by a position hash; every pixel takes the colour sampled
// at its nearest seed, so smoothly-varying regions become flat faceted cells.
// Deterministic — no global RNG — so it round-trips and tests reproducibly.
pub fn crystallize(px: &mut [u16], w: u32, h: u32, sel: &Selection, cell_size: i32) {
    let (wi, hi) = (w as i32, h as i32);
    let cs = cell_size.max(2);
    let csf = cs as f32;
    let src = px.to_vec();
    let mut filtered = src.clone();
    let seed_pos = |gx: i32, gy: i32| -> (f32, f32) {
        let hsh = hash2(gx, gy);
        let jx = (hsh & 0xffff) as f32 / 65535.0;
        let jy = ((hsh >> 16) & 0xffff) as f32 / 65535.0;
        ((gx as f32 + jx) * csf, (gy as f32 + jy) * csf)
    };
    for y in 0..hi {
        for x in 0..wi {
            let gx = x.div_euclid(cs);
            let gy = y.div_euclid(cs);
            // nearest seed lies in this grid cell or one of its 8 neighbours
            let mut best = f32::MAX;
            let (mut sx, mut sy) = (x, y);
            for dgy in -1..=1 {
                for dgx in -1..=1 {
                    let (px_, py_) = seed_pos(gx + dgx, gy + dgy);
                    let d = (px_ - x as f32).powi(2) + (py_ - y as f32).powi(2);
                    if d < best {
                        best = d;
                        sx = (px_.round() as i32).clamp(0, wi - 1);
                        sy = (py_.round() as i32).clamp(0, hi - 1);
                    }
                }
            }
            let si = (sy * wi + sx) as usize * 4;
            let di = (y * wi + x) as usize * 4;
            filtered[di..di + 4].copy_from_slice(&src[si..si + 4]);
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Texture ▸ Stained Glass: like Crystallize (solid Voronoi cells taking
// the source colour at each seed) but the seams between cells are drawn in the
// foreground colour — the "lead" of the stained glass. `border` widens the lead;
// `light` adds a soft radial glow from the image centre. Deterministic seeds.
pub fn stained_glass(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    cell_size: i32,
    border: i32,
    light: f32,
    fg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let cs = cell_size.max(2);
    let csf = cs as f32;
    let bw = border.max(1);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let fg16 = [fg[0] as u16 * 257, fg[1] as u16 * 257, fg[2] as u16 * 257];
    let seed_pos = |gx: i32, gy: i32| -> (f32, f32) {
        let hsh = hash2(gx, gy);
        let jx = (hsh & 0xffff) as f32 / 65535.0;
        let jy = ((hsh >> 16) & 0xffff) as f32 / 65535.0;
        ((gx as f32 + jx) * csf, (gy as f32 + jy) * csf)
    };
    // each pixel's owning cell (gx,gy) and the seed sample location it pulls from
    let owner = |x: i32, y: i32| -> (i32, i32, usize) {
        let gx = x.div_euclid(cs);
        let gy = y.div_euclid(cs);
        let mut best = f32::MAX;
        let (mut bgx, mut bgy, mut sx, mut sy) = (gx, gy, x, y);
        for dgy in -1..=1 {
            for dgx in -1..=1 {
                let (px_, py_) = seed_pos(gx + dgx, gy + dgy);
                let d = (px_ - x as f32).powi(2) + (py_ - y as f32).powi(2);
                if d < best {
                    best = d;
                    bgx = gx + dgx;
                    bgy = gy + dgy;
                    sx = (px_.round() as i32).clamp(0, wi - 1);
                    sy = (py_.round() as i32).clamp(0, hi - 1);
                }
            }
        }
        (bgx, bgy, (sy * wi + sx) as usize * 4)
    };
    // precompute each pixel's owning cell so the border test is cheap
    let mut cell = vec![(0i32, 0i32); (wi * hi) as usize];
    let mut seed = vec![0usize; (wi * hi) as usize];
    for y in 0..hi {
        for x in 0..wi {
            let (gx, gy, si) = owner(x, y);
            cell[(y * wi + x) as usize] = (gx, gy);
            seed[(y * wi + x) as usize] = si;
        }
    }
    let (cx, cy) = (wi as f32 / 2.0, hi as f32 / 2.0);
    let maxd = (cx * cx + cy * cy).sqrt().max(1.0);
    for y in 0..hi {
        for x in 0..wi {
            let me = cell[(y * wi + x) as usize];
            // a lead pixel if any neighbour within `bw` belongs to a different cell
            let mut lead = false;
            'b: for dy in -bw..=bw {
                for dx in -bw..=bw {
                    let nx = (x + dx).clamp(0, wi - 1);
                    let ny = (y + dy).clamp(0, hi - 1);
                    if cell[(ny * wi + nx) as usize] != me {
                        lead = true;
                        break 'b;
                    }
                }
            }
            let di = (y * wi + x) as usize * 4;
            if lead {
                filtered[di..di + 3].copy_from_slice(&fg16);
            } else {
                let si = seed[(y * wi + x) as usize];
                // cell colour, optionally brightened by the central glow
                let glow = if light > 0.0 {
                    let d = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt();
                    1.0 + light * (1.0 - d / maxd)
                } else {
                    1.0
                };
                for k in 0..3 {
                    filtered[di + k] = (src[si + k] as f32 * glow).clamp(0.0, 65535.0) as u16;
                }
            }
            // alpha preserved from the clone
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Pixelate ▸ Pointillize: scatter the image as solid round dots — each
// dot coloured by the image under its (jittered-grid) seed — over a canvas of
// the background colour that shows through the gaps. Like Crystallize but the
// cells are circles with empty space between them. Deterministic (hashed seeds).
pub fn pointillize(px: &mut [u16], w: u32, h: u32, sel: &Selection, cell_size: i32, bg: [u8; 3]) {
    let (wi, hi) = (w as i32, h as i32);
    let cs = cell_size.max(2);
    let csf = cs as f32;
    let r2 = (csf * 0.5).powi(2); // dot radius = half the cell pitch
    let bg16 = [
        bg[0] as u16 * 257,
        bg[1] as u16 * 257,
        bg[2] as u16 * 257,
        65535,
    ];
    let src = px.to_vec();
    let mut filtered = src.clone();
    let seed_pos = |gx: i32, gy: i32| -> (f32, f32) {
        let hsh = hash2(gx, gy);
        let jx = (hsh & 0xffff) as f32 / 65535.0;
        let jy = ((hsh >> 16) & 0xffff) as f32 / 65535.0;
        ((gx as f32 + jx) * csf, (gy as f32 + jy) * csf)
    };
    for y in 0..hi {
        for x in 0..wi {
            let gx = x.div_euclid(cs);
            let gy = y.div_euclid(cs);
            let mut best = f32::MAX;
            let (mut sx, mut sy) = (x, y);
            for dgy in -1..=1 {
                for dgx in -1..=1 {
                    let (px_, py_) = seed_pos(gx + dgx, gy + dgy);
                    let d = (px_ - x as f32).powi(2) + (py_ - y as f32).powi(2);
                    if d < best {
                        best = d;
                        sx = (px_.round() as i32).clamp(0, wi - 1);
                        sy = (py_.round() as i32).clamp(0, hi - 1);
                    }
                }
            }
            let di = (y * wi + x) as usize * 4;
            if best <= r2 {
                let si = (sy * wi + sx) as usize * 4;
                filtered[di..di + 4].copy_from_slice(&src[si..si + 4]); // inside a dot
            } else {
                filtered[di..di + 4].copy_from_slice(&bg16); // gap → background colour
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Stylize ▸ Tiles: break the image into a grid of tiles and offset each
// from its original position by a (hashed, so deterministic) amount up to
// `max_offset` of the tile size; the area uncovered between tiles is filled with
// `fill_mode` 0 Background · 1 Foreground · 2 Inverse Image · 3 Unaltered Image.
#[allow(clippy::too_many_arguments)]
pub fn tiles(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    num_tiles: u32,
    max_offset: f32,
    fill_mode: u8,
    fg: [u8; 3],
    bg: [u8; 3],
) {
    let (wi, hi) = (w as i32, h as i32);
    let nt = num_tiles.max(1) as i32;
    let src = px.to_vec();
    // the canvas the tiles sit on (shows through the gaps)
    let mut filtered = match fill_mode {
        3 => src.clone(), // unaltered image
        2 => {
            let mut f = src.clone(); // inverse image
            for i in 0..(wi * hi) as usize {
                f[i * 4] = 65535 - f[i * 4];
                f[i * 4 + 1] = 65535 - f[i * 4 + 1];
                f[i * 4 + 2] = 65535 - f[i * 4 + 2];
            }
            f
        }
        1 => solid(&src, fg), // foreground colour
        _ => solid(&src, bg), // background colour
    };
    for tj in 0..nt {
        for ti in 0..nt {
            let (x0, x1) = (ti * wi / nt, (ti + 1) * wi / nt);
            let (y0, y1) = (tj * hi / nt, (tj + 1) * hi / nt);
            let (tw, th) = ((x1 - x0) as f32, (y1 - y0) as f32);
            let hsh = hash2(ti, tj);
            let ox = (((hsh & 0xffff) as f32 / 65535.0) * 2.0 - 1.0) * tw * max_offset;
            let oy = ((((hsh >> 16) & 0xffff) as f32 / 65535.0) * 2.0 - 1.0) * th * max_offset;
            let (ox, oy) = (ox.round() as i32, oy.round() as i32);
            for y in y0..y1 {
                for x in x0..x1 {
                    let (dx, dy) = (x + ox, y + oy);
                    if dx >= 0 && dx < wi && dy >= 0 && dy < hi {
                        let si = (y * wi + x) as usize * 4;
                        let di = (dy * wi + dx) as usize * 4;
                        filtered[di..di + 4].copy_from_slice(&src[si..si + 4]);
                    }
                }
            }
        }
    }
    blend_back(px, &filtered, sel);
}
// a solid opaque fill of colour `c`, the size of `src`.
fn solid(src: &[u16], c: [u8; 3]) -> Vec<u16> {
    let mut f = vec![0u16; src.len()];
    for i in 0..src.len() / 4 {
        f[i * 4] = c[0] as u16 * 257;
        f[i * 4 + 1] = c[1] as u16 * 257;
        f[i * 4 + 2] = c[2] as u16 * 257;
        f[i * 4 + 3] = 65535;
    }
    f
}

// Filter ▸ Noise ▸ Despeckle (one-click): blur low-contrast areas to remove
// noise, but leave high-contrast edges crisp to preserve detail. Edge strength
// is the max per-channel difference to the 4 orthogonal neighbours; pixels at or
// above a fixed threshold keep their original value, the rest get a 3×3 box
// average (premultiplied, like the other averaging filters).
pub fn despeckle(px: &mut [u16], w: u32, h: u32, sel: &Selection) {
    const EDGE: u16 = 38 * 257; // ~0.15 of full range — separates noise from real edges
    let (w, h) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    for y in 0..h {
        for x in 0..w {
            let di = (y * w + x) as usize * 4;
            let mut edge = 0u16;
            for (nx, ny) in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
                let ni = idx(nx, ny, w, h);
                for k in 0..3 {
                    edge = edge.max(src[di + k].abs_diff(src[ni + k]));
                }
            }
            if edge >= EDGE {
                continue; // an edge — keep the original (already in `filtered`)
            }
            let mut acc = [0f32; 4];
            let mut cnt = 0f32;
            for ny in (y - 1)..=(y + 1) {
                for nx in (x - 1)..=(x + 1) {
                    let ni = idx(nx, ny, w, h);
                    let a = src[ni + 3] as f32 / 65535.0;
                    acc[0] += src[ni] as f32 / 65535.0 * a;
                    acc[1] += src[ni + 1] as f32 / 65535.0 * a;
                    acc[2] += src[ni + 2] as f32 / 65535.0 * a;
                    acc[3] += a;
                    cnt += 1.0;
                }
            }
            let a = acc[3] / cnt;
            if a > 1e-4 {
                filtered[di] = to16(acc[0] / cnt / a);
                filtered[di + 1] = to16(acc[1] / cnt / a);
                filtered[di + 2] = to16(acc[2] / cnt / a);
            }
            filtered[di + 3] = to16(a);
        }
    }
    blend_back(px, &filtered, sel);
}

// Vignette: radial darkening toward the corners (amount 0..1).
pub fn vignette(px: &mut [u16], w: u32, h: u32, sel: &Selection, amount: f32) {
    let (wi, hi) = (w as f32, h as f32);
    let cx = wi / 2.0;
    let cy = hi / 2.0;
    let maxd = (cx * cx + cy * cy).sqrt().max(1.0);
    let (w, h) = (w as i32, h as i32);
    let mut filtered = px.to_vec();
    for y in 0..h {
        for x in 0..w {
            let dx = (x as f32 - cx) / maxd;
            let dy = (y as f32 - cy) / maxd;
            let d = (dx * dx + dy * dy).sqrt();
            let f = (1.0 - amount * d * d * 2.0).clamp(0.0, 1.0);
            let i = (y * w + x) as usize * 4;
            for k in 0..3 {
                filtered[i + k] = (px[i + k] as f32 * f) as u16;
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Kuwahara filter — oil-paint / stylize. Each pixel takes the mean of the
// least-variance quadrant of its neighborhood, producing painterly flat regions.
pub fn kuwahara(px: &mut [u16], w: u32, h: u32, sel: &Selection, radius: i32) {
    if radius < 1 {
        return;
    }
    let (w, h) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let quads = [
        (-radius, 0, -radius, 0),
        (0, radius, -radius, 0),
        (-radius, 0, 0, radius),
        (0, radius, 0, radius),
    ];
    for y in 0..h {
        for x in 0..w {
            let mut best_var = f32::MAX;
            let mut best = [0f32; 3];
            for &(x0, x1, y0, y1) in &quads {
                let mut sum = [0f32; 3];
                let mut sq = [0f32; 3];
                let mut n = 0f32;
                for yy in y0..=y1 {
                    for xx in x0..=x1 {
                        let i = idx(x + xx, y + yy, w, h);
                        for k in 0..3 {
                            let v = src[i + k] as f32;
                            sum[k] += v;
                            sq[k] += v * v;
                        }
                        n += 1.0;
                    }
                }
                let mut var = 0.0;
                let mut mean = [0f32; 3];
                for k in 0..3 {
                    mean[k] = sum[k] / n;
                    var += sq[k] / n - mean[k] * mean[k];
                }
                if var < best_var {
                    best_var = var;
                    best = mean;
                }
            }
            let di = (y * w + x) as usize * 4;
            for k in 0..3 {
                filtered[di + k] = best[k].clamp(0.0, 65535.0) as u16;
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Stylize ▸ Oil Paint — Photoshop's six controls on top of the Kuwahara
// sectors above (`kuwahara` itself stays bit-exact for its TS mirror):
//   scale       0.1..10 → dab radius in px (the sector size)
//   cleanliness 0..10   → how hard the flattest sector wins: 10 is close to the
//                         Kuwahara arg-min, lower values blend the sectors by
//                         exp(-q·variance) so more surface texture survives
//   stylization 0.1..10 → stroke length: the dabs are smeared along the local
//                         edge tangent for `stylization × radius / 2` px each way
//   bristle     0..10   → a hashed grain streaked along that same tangent, so
//                         each stroke reads as bristles
//   angle/shine 0..360 / 0..10 → relief lighting: the painted luminance is a
//                         height field lit from `angle`, `shine` is its gain
// ponytail: the smear is a straight line along the tangent, not a
// field-following LIC; long strokes on tight curves need the latter.
#[allow(clippy::too_many_arguments)]
pub fn oil_paint(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    stylization: f32,
    cleanliness: f32,
    scale: f32,
    bristle: f32,
    angle_deg: f32,
    shine: f32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let n = (wi * hi) as usize;
    let radius = scale.clamp(0.1, 10.0).round().max(1.0) as i32;
    let q = cleanliness.clamp(0.0, 10.0) * 64.0;
    let src = px.to_vec();
    let inv = 1.0 / 65535.0;
    // 1. dabs — the four Kuwahara quadrants, softly weighted by their variance.
    let quads = [
        (-radius, 0, -radius, 0),
        (0, radius, -radius, 0),
        (-radius, 0, 0, radius),
        (0, radius, 0, radius),
    ];
    let mut base = vec![0f32; n * 3];
    for y in 0..hi {
        for x in 0..wi {
            let mut means = [[0f32; 3]; 4];
            let mut vars = [0f32; 4];
            for (k, &(x0, x1, y0, y1)) in quads.iter().enumerate() {
                let mut sum = [0f32; 3];
                let mut sq = [0f32; 3];
                let mut cnt = 0f32;
                for yy in y0..=y1 {
                    for xx in x0..=x1 {
                        let i = idx(x + xx, y + yy, wi, hi);
                        for c in 0..3 {
                            let v = src[i + c] as f32 * inv;
                            sum[c] += v;
                            sq[c] += v * v;
                        }
                        cnt += 1.0;
                    }
                }
                for c in 0..3 {
                    means[k][c] = sum[c] / cnt;
                    vars[k] += (sq[c] / cnt - means[k][c] * means[k][c]).max(0.0);
                }
            }
            let vmin = vars.iter().copied().fold(f32::MAX, f32::min);
            let mut acc = [0f32; 3];
            let mut wsum = 0f32;
            for k in 0..4 {
                let wt = (-(vars[k] - vmin) * q).exp();
                wsum += wt;
                for c in 0..3 {
                    acc[c] += means[k][c] * wt;
                }
            }
            let o = (y * wi + x) as usize * 3;
            for c in 0..3 {
                base[o + c] = acc[c] / wsum;
            }
        }
    }
    let luma = |p: &[f32], i: usize| 0.299 * p[i * 3] + 0.587 * p[i * 3 + 1] + 0.114 * p[i * 3 + 2];
    // 2. strokes — smear each dab along the local edge tangent and streak a
    //    hashed grain along it.
    let len = (stylization.clamp(0.0, 10.0) * radius as f32 * 0.5).round() as i32;
    let grain = bristle.clamp(0.0, 10.0) / 10.0 * 0.35;
    let mut painted = base.clone();
    if len > 0 || grain > 0.0 {
        for y in 0..hi {
            for x in 0..wi {
                let l = |xx: i32, yy: i32| luma(&base, idx(xx, yy, wi, hi) / 4);
                let gx = l(x + radius, y) - l(x - radius, y);
                let gy = l(x, y + radius) - l(x, y - radius);
                let mag = (gx * gx + gy * gy).sqrt();
                // the tangent runs along the edge; flat areas stroke diagonally
                let (tx, ty) = if mag > 1e-4 {
                    (-gy / mag, gx / mag)
                } else {
                    (std::f32::consts::FRAC_1_SQRT_2, std::f32::consts::FRAC_1_SQRT_2)
                };
                let mut acc = [0f32; 3];
                let mut noise = 0f32;
                let mut cnt = 0f32;
                for s in -len..=len {
                    let sx = (x as f32 + tx * s as f32).round() as i32;
                    let sy = (y as f32 + ty * s as f32).round() as i32;
                    let i = idx(sx, sy, wi, hi) / 4;
                    for c in 0..3 {
                        acc[c] += base[i * 3 + c];
                    }
                    noise += (hash2(sx, sy) & 0xffff) as f32 / 65535.0 - 0.5;
                    cnt += 1.0;
                }
                // the mean of k uniform samples has 1/√k the contrast of one;
                // restore it so bristles stay visible under long strokes.
                let streak = (noise / cnt * cnt.sqrt()).clamp(-0.5, 0.5);
                let f = 1.0 + grain * 2.0 * streak;
                let o = (y * wi + x) as usize * 3;
                for c in 0..3 {
                    painted[o + c] = (acc[c] / cnt * f).clamp(0.0, 1.0);
                }
            }
        }
    }
    // 3. lighting — the painted luminance as a height field lit from `angle`
    //    (0° = from the right, 90° = from the top).
    let gain = shine.clamp(0.0, 10.0) / 10.0 * 0.6;
    let (lx, ly) = (angle_deg.to_radians().cos(), -angle_deg.to_radians().sin());
    let mut filtered = src.clone();
    for y in 0..hi {
        for x in 0..wi {
            let hgt = |xx: i32, yy: i32| luma(&painted, idx(xx, yy, wi, hi) / 4);
            let relief = if gain > 0.0 {
                -((hgt(x + 1, y) - hgt(x - 1, y)) * lx + (hgt(x, y + 1) - hgt(x, y - 1)) * ly)
                    * 0.5
                    * gain
            } else {
                0.0
            };
            let o = (y * wi + x) as usize;
            for c in 0..3 {
                filtered[o * 4 + c] = crate::raster::color::to16(painted[o * 3 + c] + relief);
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Distort ▸ Displace: shift each pixel by an amount read from a
// displacement map. Photoshop uses a separate file; here the image's OWN red
// channel drives the horizontal shift and green the vertical (a self-displace),
// giving a liquify-like warp. Inverse-mapped, bilinear, edge-clamped.
pub fn displace(px: &mut [u16], w: u32, h: u32, sel: &Selection, scale_h: f32, scale_v: f32) {
    let (wi, hi) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let sample = |fx: f32, fy: f32| -> [f32; 4] {
        let x0 = fx.floor() as i32;
        let y0 = fy.floor() as i32;
        let (tx, ty) = (fx - x0 as f32, fy - y0 as f32);
        let mut out = [0f32; 4];
        for (oy, wy) in [(0, 1.0 - ty), (1, ty)] {
            for (ox, wx) in [(0, 1.0 - tx), (1, tx)] {
                let si = idx(
                    (x0 + ox).clamp(0, wi - 1),
                    (y0 + oy).clamp(0, hi - 1),
                    wi,
                    hi,
                );
                let g = wx * wy;
                for (k, o) in out.iter_mut().enumerate() {
                    *o += src[si + k] as f32 * g;
                }
            }
        }
        out
    };
    for y in 0..hi {
        for x in 0..wi {
            let di = (y * wi + x) as usize * 4;
            let dh = (src[di] as f32 / 65535.0 - 0.5) * scale_h;
            let dv = (src[di + 1] as f32 / 65535.0 - 0.5) * scale_v;
            let s = sample(x as f32 + dh, y as f32 + dv);
            for k in 0..4 {
                filtered[di + k] = s[k].round() as u16;
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Plot a filled disc of `col` (straight-alpha RGBA u16) centred at (cx, cy).
fn plot_disc(px: &mut [u16], w: i32, h: i32, cx: f32, cy: f32, radius: f32, col: [u16; 4]) {
    let r = radius.max(0.5);
    let r2 = r * r;
    let (x0, x1) = ((cx - r).floor() as i32, (cx + r).ceil() as i32);
    let (y0, y1) = ((cy - r).floor() as i32, (cy + r).ceil() as i32);
    for y in y0..=y1 {
        for x in x0..=x1 {
            if x < 0 || y < 0 || x >= w || y >= h {
                continue;
            }
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            if dx * dx + dy * dy <= r2 {
                let i = (y * w + x) as usize * 4;
                px[i..i + 4].copy_from_slice(&col);
            }
        }
    }
}

// Draw a `thick`-radius line from (x0,y0) to (x1,y1) by stamping discs along it.
fn draw_thick_line(
    px: &mut [u16],
    w: i32,
    h: i32,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    thick: f32,
    col: [u16; 4],
) {
    let len = ((x1 - x0).powi(2) + (y1 - y0).powi(2)).sqrt();
    let steps = (len.ceil() as i32).max(1);
    for s in 0..=steps {
        let t = s as f32 / steps as f32;
        plot_disc(px, w, h, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thick, col);
    }
}

// Seeded value noise in 0..1 (bilinear, smoothstep-eased) and its 4-octave fbm.
fn vnoise(x: f32, y: f32, seed: u32) -> f32 {
    let (x0, y0) = (x.floor(), y.floor());
    let (fx, fy) = (x - x0, y - y0);
    let (fx, fy) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
    let (x0, y0) = (x0 as i32, y0 as i32);
    let at = |ix: i32, iy: i32| (hash2(hash2(ix, seed as i32) as i32, iy) & 0xffff) as f32 / 65535.0;
    let top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    let bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    top + (bot - top) * fy
}
fn fbm(x: f32, y: f32, seed: u32) -> f32 {
    let (mut sum, mut norm, mut amp, mut f) = (0.0, 0.0, 0.5, 1.0);
    for o in 0..4u32 {
        sum += vnoise(x * f, y * f, seed.wrapping_add(o.wrapping_mul(0x9E37_79B9))) * amp;
        norm += amp;
        amp *= 0.5;
        f *= 2.0;
    }
    sum / norm
}

// Filter ▸ Render ▸ Flame: procedural fire rising from the bottom edge of the
// selection bounds (the whole plane with no selection). Photoshop draws its
// flame along a path; the bounds' bottom edge is the path here. `length` px
// tall, one tongue per `width` px, `turbulence` 0..100 bends and ruffles the
// tongues, `opacity` 0..1 scales the alpha, and every value is hashed from
// `seed`, so one seed always renders the same fire. Composited over the
// layer's existing pixels (straight-alpha "over").
// ponytail: bounds-driven, not path-driven — a path version walks the path and
// rotates this column renderer onto each segment's normal.
#[allow(clippy::too_many_arguments)]
pub fn flame(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    seed: u32,
    r: u8,
    g: u8,
    b: u8,
    length: f32,
    width: f32,
    turbulence: f32,
    opacity: f32,
) {
    use crate::raster::color::to16;
    use std::f32::consts::TAU;
    let (wi, hi) = (w as i32, h as i32);
    let [bx, by, bw, bh] = sel.bounds();
    if bw <= 0 || bh <= 0 {
        return;
    }
    let base_y = (by + bh) as f32;
    let length = length.max(1.0);
    let width = width.max(1.0);
    let t = (turbulence / 100.0).clamp(0.0, 1.0);
    let opacity = opacity.clamp(0.0, 1.0);
    let tint = [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0];
    let src = px.to_vec();
    let mut filtered = src.clone();
    let y0 = (base_y - length).floor().max(0.0) as i32;
    for y in y0..(by + bh).min(hi) {
        let v = (base_y - (y as f32 + 0.5)) / length; // 0 at the base, 1 at full length
        if !(0.0..=1.0).contains(&v) {
            continue;
        }
        for x in bx.max(0)..(bx + bw).min(wi) {
            let u = (x as f32 + 0.5 - bx as f32) / width;
            let n1 = fbm(u * 1.3, v * 2.0, seed) * 2.0 - 1.0;
            let n2 = fbm(u * 0.7 + 37.0, v * 1.1 + 11.0, seed ^ 0x5BD1_E995) * 2.0 - 1.0;
            let uw = u + t * n2 * 0.6 * v; // tongues bend more toward the tip
            let tongue = 0.5 + 0.5 * (uw * TAU).cos();
            let tip = (0.4 + 0.6 * tongue) * (1.0 - 0.6 * t * (0.5 + 0.5 * n1));
            let heat = (1.0 - v / tip.max(0.05)).clamp(0.0, 1.0) * (0.55 + 0.45 * tongue);
            if heat <= 0.0 {
                continue;
            }
            let core = ((heat - 0.6) / 0.4).clamp(0.0, 1.0);
            let core = core * core * (3.0 - 2.0 * core); // white-hot centre
            let a = heat.sqrt() * opacity;
            let i = (y * wi + x) as usize * 4;
            let sa = src[i + 3] as f32 / 65535.0;
            let oa = a + sa * (1.0 - a);
            for c in 0..3 {
                let fc = tint[c] * (0.35 + 0.65 * heat) * (1.0 - core) + core;
                let sc = src[i + c] as f32 / 65535.0;
                filtered[i + c] = to16(if oa > 0.0 { (fc * a + sc * sa * (1.0 - a)) / oa } else { 0.0 });
            }
            filtered[i + 3] = to16(oa);
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Render ▸ Tree: draw a recursive fractal tree into the active layer
// (trunk at the bottom centre, branching by ±`angle`, `depth` levels deep).
// Photoshop's other controls: `height` and `thickness` are percentages of the
// default trunk length / branch width, `leaves_amount` 0..100 is the share of
// the outer two branch levels that end in a leaf (a green disc scaled by
// `leaves_size` %), and `light_deg` 0..180 sweeps the light from the left over
// the top to the right, shading every branch and leaf by how far it faces it.
// ponytail: default (green) leaves only — Photoshop's custom-leaf image and the
// tree-type presets would layer on top of this one renderer.
#[allow(clippy::too_many_arguments)]
pub fn tree(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    angle_deg: f32,
    depth: i32,
    r: u8,
    g: u8,
    b: u8,
    leaves_amount: f32,
    leaves_size: f32,
    height: f32,
    thickness: f32,
    light_deg: f32,
) {
    use crate::raster::color::to16;
    let (wi, hi) = (w as i32, h as i32);
    let ang = angle_deg.to_radians();
    let depth = depth.clamp(1, 13);
    let trunk = hi as f32 * 0.24 * (height / 100.0).clamp(0.1, 4.0);
    let thick = (thickness / 100.0).clamp(0.0, 4.0);
    let leaf_share = (leaves_amount / 100.0).clamp(0.0, 1.0);
    let leaf_r = (2.0 + trunk * 0.06) * (leaves_size / 100.0).clamp(0.0, 4.0);
    let (bx, by) = (wi as f32 / 2.0, hi as f32 - 1.0);
    let light = light_deg.clamp(0.0, 180.0).to_radians();
    let (lx, ly) = (-light.cos(), -light.sin());
    // brightness of a point on the tree, from how far it faces the light
    let shade = |x: f32, y: f32| {
        let (nx, ny) = (x - bx, y - by);
        let m = (nx * nx + ny * ny).sqrt().max(1e-3);
        0.8 + 0.2 * (nx / m * lx + ny / m * ly)
    };
    let lit = |c: [f32; 3], s: f32| [to16(c[0] * s), to16(c[1] * s), to16(c[2] * s), 65535u16];
    let wood = [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0];
    let leaf = [60.0 / 255.0, 140.0 / 255.0, 45.0 / 255.0];
    let src = px.to_vec();
    let mut filtered = src.clone();
    let mut leaves = Vec::new();
    let mut node = 0i32;
    // explicit stack: (x, y, length, direction, remaining depth)
    let mut stack = vec![(bx, by, trunk, -std::f32::consts::FRAC_PI_2, depth)];
    while let Some((x, y, len, dir, d)) = stack.pop() {
        if d == 0 || len < 1.0 {
            continue;
        }
        let ex = x + len * dir.cos();
        let ey = y + len * dir.sin();
        let col = lit(wood, shade((x + ex) / 2.0, (y + ey) / 2.0));
        draw_thick_line(
            &mut filtered,
            wi,
            hi,
            x,
            y,
            ex,
            ey,
            (d as f32 * 0.45 * thick).max(0.6),
            col,
        );
        node += 1;
        if d <= 2 && leaf_r > 0.0 && (hash2(node, 7) & 0xffff) as f32 / 65535.0 < leaf_share {
            leaves.push((ex, ey));
        }
        stack.push((ex, ey, len * 0.72, dir - ang, d - 1));
        stack.push((ex, ey, len * 0.72, dir + ang, d - 1));
    }
    for (x, y) in leaves {
        plot_disc(&mut filtered, wi, hi, x, y, leaf_r, lit(leaf, shade(x, y)));
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Lens Correction: radial geometric distortion + vignette correction.
// `distortion` <0 corrects barrel (pulls edges in) / >0 adds it; `vignette` >0
// brightens the corners to remove a dark vignette. Inverse-mapped, bilinear.
//
// `aberration` is the equal-and-opposite shorthand: red out, blue in by the
// same amount. Photoshop drives red/cyan and blue/yellow independently — see
// `lens_correction_ca`, which this delegates to.
// ponytail: the develop path stays on this shorthand because the frozen 1086-
// float ABI has one CA slot (p[1051]); give it a second axis on the advanced
// tail and develop.rs can call `lens_correction_ca` directly.
pub fn lens_correction(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    distortion: f32,
    vignette: f32,
    aberration: f32,
    scale: f32,
    vignette_mid: f32,
) {
    lens_correction_ca(
        px,
        w,
        h,
        sel,
        distortion,
        vignette,
        aberration,
        -aberration,
        scale,
        vignette_mid,
    );
}

// Filter ▸ Lens Correction with Photoshop's two independent fringe sliders.
// `red_cyan` scales the red sample along the radius, `blue_yellow` the blue one
// (green/alpha never move); positive = sampled further out. Either at 0 leaves
// that channel byte-identical, so a lens with only blue/yellow fringing no
// longer picks up a red/cyan shift.
#[allow(clippy::too_many_arguments)]
pub fn lens_correction_ca(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    distortion: f32,
    vignette: f32,
    red_cyan: f32,
    blue_yellow: f32,
    scale: f32,
    vignette_mid: f32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let (cx, cy) = (wi as f32 / 2.0, hi as f32 / 2.0);
    let maxr = (cx * cx + cy * cy).sqrt().max(1.0);
    // Transform ▸ Scale zooms the image within the frame (>1 crops the blank
    // wedges distortion/vignette correction leaves at the edges). 1.0 = no-op.
    let scale = if scale > 0.0 { scale } else { 1.0 };
    // Vignette ▸ Midpoint pushes the correction outward: 0 affects the whole
    // image (r²), higher values restrict it to the edges. 0 = the old falloff.
    let mid = vignette_mid.clamp(0.0, 0.95);
    let sample = |fx: f32, fy: f32| -> [f32; 4] {
        let x0 = fx.floor() as i32;
        let y0 = fy.floor() as i32;
        let (tx, ty) = (fx - x0 as f32, fy - y0 as f32);
        let mut out = [0f32; 4];
        if x0 < -1 || y0 < -1 || x0 > wi || y0 > hi {
            return out; // outside → transparent
        }
        for (oy, wy) in [(0, 1.0 - ty), (1, ty)] {
            for (ox, wx) in [(0, 1.0 - tx), (1, tx)] {
                let sx = (x0 + ox).clamp(0, wi - 1);
                let sy = (y0 + oy).clamp(0, hi - 1);
                let si = (sy * wi + sx) as usize * 4;
                let g = wx * wy;
                for (k, o) in out.iter_mut().enumerate() {
                    *o += src[si + k] as f32 * g;
                }
            }
        }
        out
    };
    for y in 0..hi {
        for x in 0..wi {
            let di = (y * wi + x) as usize * 4;
            let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
            let r = (dx * dx + dy * dy).sqrt() / maxr;
            let factor = (1.0 + distortion * r * r) / scale;
            let base = sample(cx + dx * factor - 0.5, cy + dy * factor - 0.5);
            // Chromatic aberration: each fringe axis shifts its own channel
            // along the radius (green/alpha stay put), so an axis left at 0
            // leaves that channel exactly where the base sample put it.
            let (rc, by) = (red_cyan * r, blue_yellow * r);
            let s = if rc != 0.0 || by != 0.0 {
                let shift = |f: f32| {
                    let fs = factor * (1.0 + f);
                    sample(cx + dx * fs - 0.5, cy + dy * fs - 0.5)
                };
                let sr = if rc != 0.0 { shift(rc) } else { base };
                let sb = if by != 0.0 { shift(by) } else { base };
                [sr[0], base[1], sb[2], base[3]]
            } else {
                base
            };
            let rr = if mid > 0.0 {
                ((r - mid) / (1.0 - mid)).max(0.0)
            } else {
                r
            };
            let gain = (1.0 + vignette * rr * rr).clamp(0.0, 4.0);
            for k in 0..3 {
                filtered[di + k] = (s[k] * gain).round().clamp(0.0, 65535.0) as u16;
            }
            filtered[di + 3] = s[3].round() as u16;
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Stylize ▸ Oil Paint's six controls (#448).
#[cfg(test)]
mod oil_paint_tests {
    use super::*;

    const W: u32 = 24;
    const H: u32 = 24;

    // A diagonal ramp under hashed grain: texture for the dabs, gradient for the light.
    fn textured() -> Vec<u16> {
        let mut px = vec![0u16; (W * H * 4) as usize];
        for y in 0..H as i32 {
            for x in 0..W as i32 {
                let i = idx(x, y, W as i32, H as i32);
                let ramp = ((x + y) * 1200) as u32;
                let grain = hash2(x, y) & 0x3fff;
                for c in 0..3 {
                    px[i + c] = (ramp + grain * (c as u32 + 1) / 2).min(65535) as u16;
                }
                px[i + 3] = 65535;
            }
        }
        px
    }
    fn paint(src: &[u16], stylization: f32, cleanliness: f32, scale: f32, bristle: f32, angle: f32, shine: f32) -> Vec<u16> {
        let mut px = src.to_vec();
        oil_paint(&mut px, W, H, &Selection::new(W, H), stylization, cleanliness, scale, bristle, angle, shine);
        px
    }

    #[test]
    fn every_control_changes_the_render() {
        let src = textured();
        let base = paint(&src, 2.0, 5.0, 3.0, 0.0, 0.0, 0.0);
        assert_ne!(base, src, "the paint changes the image");
        assert_ne!(base, paint(&src, 8.0, 5.0, 3.0, 0.0, 0.0, 0.0), "stylization lengthens the strokes");
        assert_ne!(base, paint(&src, 2.0, 0.0, 3.0, 0.0, 0.0, 0.0), "cleanliness blends the sectors");
        assert_ne!(base, paint(&src, 2.0, 5.0, 1.0, 0.0, 0.0, 0.0), "scale resizes the dabs");
        assert_ne!(base, paint(&src, 2.0, 5.0, 3.0, 8.0, 0.0, 0.0), "bristle detail adds grain");
        assert_ne!(base, paint(&src, 2.0, 5.0, 3.0, 0.0, 0.0, 5.0), "shine lights the relief");
        assert_eq!(base, paint(&src, 2.0, 5.0, 3.0, 0.0, 180.0, 0.0), "the angle is inert without shine");
    }

    #[test]
    fn shine_lights_the_relief_from_the_angular_direction() {
        // a hard vertical step: dark left half, bright right half
        let mut src = vec![0u16; (W * H * 4) as usize];
        for i in 0..(W * H) as usize {
            let v = if (i as u32 % W) < W / 2 { 10_000 } else { 55_000 };
            src[i * 4..i * 4 + 3].fill(v);
            src[i * 4 + 3] = 65535;
        }
        let luma_at = |px: &[u16], x: i32| {
            let i = idx(x, H as i32 / 2, W as i32, H as i32);
            px[i] as i32 + px[i + 1] as i32 + px[i + 2] as i32
        };
        let flat = paint(&src, 1.0, 10.0, 2.0, 0.0, 0.0, 0.0);
        let from_right = paint(&src, 1.0, 10.0, 2.0, 0.0, 0.0, 8.0);
        let from_left = paint(&src, 1.0, 10.0, 2.0, 0.0, 180.0, 8.0);
        let foot = W as i32 / 2 - 1; // the dark pixel at the foot of the step
        assert!(luma_at(&from_right, foot) < luma_at(&flat, foot), "a step facing away from the light falls into shadow");
        assert!(luma_at(&from_left, foot) > luma_at(&flat, foot), "the same step lit from the other side brightens");
        assert_eq!(luma_at(&from_left, 2), luma_at(&flat, 2), "flat areas are untouched by the light");
    }
}

#[cfg(test)]
mod lens_correction_ca_tests {
    use super::*;

    // A white square pushed off-centre, so every channel has radial detail to
    // smear when its fringe axis moves.
    fn off_centre_square(w: u32, h: u32) -> Vec<u16> {
        let mut px = vec![0u16; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let i = ((y * w + x) * 4) as usize;
                let lit = (2..w / 2).contains(&x) && (2..h / 2).contains(&y);
                let v = if lit { 60_000u16 } else { 3_000u16 };
                px[i] = v;
                px[i + 1] = v;
                px[i + 2] = v;
                px[i + 3] = 65535;
            }
        }
        px
    }

    fn channel(px: &[u16], k: usize) -> Vec<u16> {
        px.chunks_exact(4).map(|p| p[k]).collect()
    }

    #[test]
    fn each_fringe_axis_moves_only_its_own_channel() {
        let (w, h) = (16u32, 16u32);
        let sel = Selection::new(w, h);
        let src = off_centre_square(w, h);

        // Blue/yellow alone: blue moves, red (and green) stay exactly put. This
        // is the whole point — a blue/yellow-only lens gets no red/cyan shift.
        let mut by_only = src.clone();
        lens_correction_ca(&mut by_only, w, h, &sel, 0.0, 0.0, 0.0, 0.2, 1.0, 0.0);
        assert_eq!(channel(&by_only, 0), channel(&src, 0), "red untouched");
        assert_eq!(channel(&by_only, 1), channel(&src, 1), "green untouched");
        assert_ne!(channel(&by_only, 2), channel(&src, 2), "blue shifted");

        // Red/cyan alone: the mirror image.
        let mut rc_only = src.clone();
        lens_correction_ca(&mut rc_only, w, h, &sel, 0.0, 0.0, 0.2, 0.0, 1.0, 0.0);
        assert_ne!(channel(&rc_only, 0), channel(&src, 0), "red shifted");
        assert_eq!(channel(&rc_only, 1), channel(&src, 1), "green untouched");
        assert_eq!(channel(&rc_only, 2), channel(&src, 2), "blue untouched");

        // Both at 0 is a no-op.
        let mut neutral = src.clone();
        lens_correction_ca(&mut neutral, w, h, &sel, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0);
        assert_eq!(neutral, src, "no fringe correction is byte-identical");
    }

    #[test]
    fn the_single_aberration_scalar_is_the_equal_and_opposite_pair() {
        let (w, h) = (16u32, 16u32);
        let sel = Selection::new(w, h);
        let src = off_centre_square(w, h);

        let mut legacy = src.clone();
        lens_correction(&mut legacy, w, h, &sel, -0.1, 0.3, 0.15, 1.0, 0.0);
        let mut split = src.clone();
        lens_correction_ca(&mut split, w, h, &sel, -0.1, 0.3, 0.15, -0.15, 1.0, 0.0);
        assert_eq!(legacy, split, "lens_correction == (ab, -ab)");
    }
}

// Filter ▸ Render ▸ Picture Frame: draw a bevelled solid frame around the image
// edge. `width` px wide in colour (r,g,b); the inner/outer bevel lightens the
// top-left and darkens the bottom-right for a raised look.
pub fn picture_frame(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    width: i32,
    r: u8,
    g: u8,
    b: u8,
) {
    let width = width.max(1);
    let (wi, hi) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let base = [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0];
    let bevel = (width / 4).max(1);
    for y in 0..hi {
        for x in 0..wi {
            let d = x.min(y).min(wi - 1 - x).min(hi - 1 - y); // distance to the nearest edge
            if d >= width {
                continue; // interior untouched
            }
            // raised-bevel shade: lighter near the top-left edges, darker near
            // the bottom-right, flat in the band middle.
            let shade = if d < bevel {
                if x <= y && x <= wi - 1 - x || y <= x && y <= hi - 1 - y {
                    1.0 + (bevel - d) as f32 * 0.12 // top/left bevel → lighter
                } else {
                    1.0 - (bevel - d) as f32 * 0.12 // bottom/right → darker
                }
            } else if d >= width - bevel {
                1.0 - (d - (width - bevel)) as f32 * 0.08 // inner lip slightly darker
            } else {
                1.0
            };
            let di = (y * wi + x) as usize * 4;
            for k in 0..3 {
                filtered[di + k] = ((base[k] * shade).clamp(0.0, 1.0) * 65535.0).round() as u16;
            }
            filtered[di + 3] = 65535;
        }
    }
    blend_back(px, &filtered, sel);
}


// Filter ▸ Render ▸ Lighting Effects: light the layer over a bump surface derived
// from its own luminance relief. `(lx,ly)` is the light
// position in pixels, `lz` its height above the plane; `bump` scales the relief,
// `intensity`/`ambient` the diffuse/fill levels, `(r,g,b)` (0..1) tint the light.
// `light_type` matches Photoshop's Light Type selector:
//   0 Point    — an omni light at (lx,ly,lz); the ray direction varies per pixel
//                so a flat plane is brightest under the light and dims outward.
//   1 Spot     — a Point light gated by a circular cone whose radius tracks the
//                light height (ponytail: cone∝height, add an explicit cone param
//                if the UI ever needs to drag the pool size).
//   2 Infinite — a distant/directional light: one constant ray direction (image
//                centre → light) for every pixel, so a flat plane is lit evenly.
// Each pixel: shade = ambient + intensity·max(0,N·L)·cone.
#[allow(clippy::too_many_arguments)]
pub fn lighting_effects(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    lx: f32,
    ly: f32,
    lz: f32,
    intensity: f32,
    ambient: f32,
    bump: f32,
    r: f32,
    g: f32,
    b: f32,
    light_type: u8,
) {
    let (wi, hi) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let lum = |x: i32, y: i32| -> f32 {
        let i = idx(x, y, wi, hi);
        (0.299 * src[i] as f32 + 0.587 * src[i + 1] as f32 + 0.114 * src[i + 2] as f32) / 65535.0
    };
    let light = [r, g, b];
    // Infinite light: one constant, pre-normalised direction (image centre → light).
    let (dcx, dcy) = (wi as f32 / 2.0, hi as f32 / 2.0);
    let dir = {
        let (vx, vy, vz) = (lx - dcx, ly - dcy, lz);
        let inv = 1.0 / (vx * vx + vy * vy + vz * vz).sqrt().max(1e-6);
        (vx * inv, vy * inv, vz * inv)
    };
    let cone_r = (lz * 1.5).max(1.0); // spot pool radius, tied to light height
    let smoothstep = |a: f32, e: f32, t: f32| -> f32 {
        let u = ((t - a) / (e - a)).clamp(0.0, 1.0);
        u * u * (3.0 - 2.0 * u)
    };
    for y in 0..hi {
        for x in 0..wi {
            let di = (y * wi + x) as usize * 4;
            // Surface normal from the luminance relief.
            let dx = (lum(x + 1, y) - lum(x - 1, y)) * bump;
            let dy = (lum(x, y + 1) - lum(x, y - 1)) * bump;
            let inv_n = 1.0 / (dx * dx + dy * dy + 1.0).sqrt();
            let (nx, ny, nz) = (-dx * inv_n, -dy * inv_n, inv_n);
            // Ray direction (unit) and cone gate depend on the light type.
            let (lvx, lvy, lvz, cone) = if light_type == 2 {
                (dir.0, dir.1, dir.2, 1.0)
            } else {
                let (vx, vy, vz) = (lx - x as f32, ly - y as f32, lz);
                let inv_l = 1.0 / (vx * vx + vy * vy + vz * vz).sqrt().max(1e-6);
                let cone = if light_type == 1 {
                    let d = ((x as f32 - lx).powi(2) + (y as f32 - ly).powi(2)).sqrt();
                    1.0 - smoothstep(cone_r * 0.6, cone_r, d)
                } else {
                    1.0
                };
                (vx * inv_l, vy * inv_l, vz * inv_l, cone)
            };
            let ndotl = (nx * lvx + ny * lvy + nz * lvz).max(0.0);
            let shade = ambient + intensity * ndotl * cone;
            for k in 0..3 {
                let v = src[di + k] as f32 * shade * light[k];
                filtered[di + k] = v.clamp(0.0, 65535.0) as u16;
            }
            filtered[di + 3] = src[di + 3];
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Blur Gallery ▸ Spin Blur: rotational motion blur around a pin —
// each pixel is averaged with samples swept ±angle/2 along its circle.
// Legacy entry: one full-frame pin spinning about the image centre.
pub fn spin_blur(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    angle_deg: f32,
    samples: i32,
    strobe_flashes: i32,
) {
    let big = (w + h) as f32 * 1000.0; // ellipse far beyond the frame → strength 1 everywhere
    let pin = [w as f32 / 2.0, h as f32 / 2.0, big, big, 0.0, 0.01];
    spin_blur_pins(px, w, h, sel, angle_deg, samples, strobe_flashes, &pin);
}

/// Spin pin record: `[x, y, rx, ry, rotation, feather]` — an ellipse (semi-axes
/// rx/ry px, rotated `rotation` rad) spun about its own centre. Spin strength
/// is 1 inside the inner ring and eases to 0 at the ellipse edge over the outer
/// `feather` fraction of the normalized radius; pixels outside the ellipse are
/// untouched. Pins apply in order, later pins reading the earlier result.
pub const SPIN_PIN_STRIDE: usize = 6;

#[allow(clippy::too_many_arguments)]
pub fn spin_blur_pins(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    angle_deg: f32,
    samples: i32,
    strobe_flashes: i32,
    pins: &[f32],
) {
    let (wi, hi) = (w as i32, h as i32);
    let arc = angle_deg.to_radians();
    // Motion Effects ▸ Strobe: `strobe_flashes` discrete exposures across the arc
    // instead of a smooth continuous smear. Few, widely-spaced samples read as
    // distinct ghost images (each 1/N as bright) with gaps between them; 0 keeps
    // the smooth blur. (ponytail: pure discrete flashes — PS also blends a
    // continuous pass by Strobe Strength; add that if it's ever wanted.)
    let n = if strobe_flashes >= 2 {
        strobe_flashes.clamp(2, 64)
    } else {
        samples.clamp(2, 64)
    };
    let mut work = px.to_vec();
    for pin in pins.chunks_exact(SPIN_PIN_STRIDE) {
        let src = work.clone();
        let (cx, cy) = (pin[0], pin[1]);
        let (rx, ry) = (pin[2].max(1.0), pin[3].max(1.0));
        let (rs, rc) = pin[4].sin_cos();
        let feather = pin[5].clamp(0.01, 1.0);
        let sample = |fx: f32, fy: f32| -> [f32; 4] {
            let x0 = fx.floor() as i32;
            let y0 = fy.floor() as i32;
            let (tx, ty) = (fx - x0 as f32, fy - y0 as f32);
            let mut out = [0f32; 4];
            for (oy, wy) in [(0, 1.0 - ty), (1, ty)] {
                for (ox, wx) in [(0, 1.0 - tx), (1, tx)] {
                    let si = idx(x0 + ox, y0 + oy, wi, hi);
                    let wgt = wx * wy;
                    for (k, o) in out.iter_mut().enumerate() {
                        *o += src[si + k] as f32 * wgt;
                    }
                }
            }
            out
        };
        for y in 0..hi {
            for x in 0..wi {
                let di = (y * wi + x) as usize * 4;
                let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
                // Normalized elliptical distance in the pin's rotated frame.
                let (ex, ey) = ((dx * rc + dy * rs) / rx, (-dx * rs + dy * rc) / ry);
                let strength = ((1.0 - (ex * ex + ey * ey).sqrt()) / feather).clamp(0.0, 1.0);
                if strength <= 0.0 {
                    continue; // outside the pin's ellipse — untouched
                }
                let r = (dx * dx + dy * dy).sqrt();
                let base = dy.atan2(dx);
                let swept = arc * strength;
                let mut acc = [0f32; 4];
                for s in 0..n {
                    let t = s as f32 / (n - 1) as f32 - 0.5;
                    let a = base + t * swept;
                    let c = sample(cx + r * a.cos() - 0.5, cy + r * a.sin() - 0.5);
                    for (k, v) in acc.iter_mut().enumerate() {
                        *v += c[k];
                    }
                }
                for (k, v) in acc.iter().enumerate() {
                    work[di + k] = (v / n as f32).round().clamp(0.0, 65535.0) as u16;
                }
            }
        }
    }
    blend_back(px, &work, sel);
}

// Filter ▸ Blur ▸ Blur Gallery (Field / Iris / Tilt-Shift): a focus-region blur
// driven by on-canvas pins. Legacy entry: one centred pin whose `focus` 0..1
// sizes the in-focus region (kind 0 Field = blurred everywhere; 1 Iris = sharp
// inside a centred ellipse; 2 Tilt-Shift = sharp in a centred horizontal band).
pub fn gallery_blur(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    kind: u8,
    radius: f32,
    focus: f32,
    light_bokeh: f32,
    bokeh_color: f32,
) {
    let (cx, cy) = (w as f32 / 2.0, h as f32 / 2.0);
    let fr = focus.clamp(0.05, 1.0);
    // A centred single pin reproducing the pre-pin maths exactly (iris feather
    // ring at half the ellipse; tilt ramp as wide as the sharp band).
    let pin = match kind {
        1 => [cx, cy, 1.0, 2.0 * cx * fr, 0.5, 0.0, cy / cx.max(1e-3)],
        2 => [cx, cy, 1.0, cy * fr, cy * fr, 0.0, 1.0],
        _ => [cx, cy, 1.0, 0.0, 0.0, 0.0, 1.0],
    };
    gallery_blur_pins(px, w, h, sel, kind, radius, &pin, light_bokeh, bokeh_color);
}

/// Gallery pin record: `[x, y, amount, focus, feather, rotation, aspect]`.
///  kind 0 Field — `amount` is the pin's blur 0..1; pins blend into one focus
///    map by inverse-square-distance weighting.
///  kind 1 Iris — sharp inside the feather ring (`feather` = ring position as
///    a fraction 0..0.95 of the ellipse), ramping to full blur at the ellipse
///    edge. `focus` = semi-axis rx px, `aspect` = ry/rx roundness,
///    `rotation` rad.
///  kind 2 Tilt-Shift — sharp within `focus` px either side of the pin's band
///    axis (`rotation` rad), ramping to full blur over a further `feather` px.
/// Multiple iris/tilt pins union their sharp zones (blur = min over pins).
pub const GALLERY_PIN_STRIDE: usize = 7;

#[allow(clippy::too_many_arguments)]
pub fn gallery_blur_pins(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    kind: u8,
    radius: f32,
    pins: &[f32],
    light_bokeh: f32,
    bokeh_color: f32,
) {
    let src = px.to_vec();
    let mut blurred = src.clone();
    let full = Selection::new(w, h);
    gaussian_blur(&mut blurred, w, h, &full, radius);
    // Light Bokeh (Blur Gallery "Effects" tab): blur bright highlights in a
    // gamma-EXPANDED (squared) space so defocused points bloom into bright bokeh
    // discs, then compress back (sqrt) and mix in by `light_bokeh`. sqrt of the
    // averaged-squared highlights is brighter than a plain linear blur
    // (RMS ≥ mean), which is what makes the discs glow. Bokeh Color saturates
    // those bloomed highlights about their own luminance so coloured bokeh keeps
    // its hue instead of washing toward white.
    let lb = light_bokeh.clamp(0.0, 1.0);
    if lb > 0.0 {
        let mut expanded = src.clone();
        for i in (0..expanded.len()).step_by(4) {
            for k in 0..3 {
                let v = expanded[i + k] as f32 / 65535.0;
                expanded[i + k] = (v * v * 65535.0).round() as u16;
            }
        }
        gaussian_blur(&mut expanded, w, h, &full, radius);
        let sat = 1.0 + bokeh_color.clamp(0.0, 1.0) * 1.5;
        for i in (0..blurred.len()).step_by(4) {
            let mut e = [
                (expanded[i] as f32 / 65535.0).sqrt() * 65535.0,
                (expanded[i + 1] as f32 / 65535.0).sqrt() * 65535.0,
                (expanded[i + 2] as f32 / 65535.0).sqrt() * 65535.0,
            ];
            if sat != 1.0 {
                let l = 0.299 * e[0] + 0.587 * e[1] + 0.114 * e[2];
                for c in e.iter_mut() {
                    *c = (l + (*c - l) * sat).clamp(0.0, 65535.0);
                }
            }
            for k in 0..3 {
                let b = blurred[i + k] as f32;
                blurred[i + k] = (b + (e[k] - b) * lb).round().clamp(0.0, 65535.0) as u16;
            }
        }
    }
    let (wi, hi) = (w as i32, h as i32);
    let pin_list: Vec<&[f32]> = pins.chunks_exact(GALLERY_PIN_STRIDE).collect();
    let mut filtered = src.clone();
    for y in 0..hi {
        for x in 0..wi {
            let di = (y * wi + x) as usize * 4;
            let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
            // b = 0 fully sharp, 1 fully blurred
            let b = match kind {
                1 | 2 => pin_list
                    .iter()
                    .map(|p| gallery_pin_blur(kind, p, fx, fy))
                    .fold(1.0f32, f32::min),
                _ => field_pin_blur(&pin_list, fx, fy),
            };
            let f = 1.0 - b;
            for k in 0..4 {
                let s = src[di + k] as f32;
                let b = blurred[di + k] as f32;
                filtered[di + k] = (b + (s - b) * f).round() as u16;
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// One iris/tilt pin's blur fraction at a pixel (0 sharp .. 1 fully blurred).
fn gallery_pin_blur(kind: u8, p: &[f32], fx: f32, fy: f32) -> f32 {
    let (dx, dy) = (fx - p[0], fy - p[1]);
    let amount = p[2].clamp(0.0, 1.0);
    let (rs, rc) = p[5].sin_cos();
    if kind == 1 {
        let rx = p[3].max(1e-3);
        let ry = (rx * p[6]).max(1e-3);
        let (ex, ey) = ((dx * rc + dy * rs) / rx, (-dx * rs + dy * rc) / ry);
        let d = (ex * ex + ey * ey).sqrt();
        let ring = p[4].clamp(0.0, 0.95);
        amount * ((d - ring) / (1.0 - ring)).clamp(0.0, 1.0)
    } else {
        // Tilt-Shift: perpendicular distance to the band axis through the pin.
        let d = (dy * rc - dx * rs).abs();
        amount * ((d - p[3].max(0.0)) / p[4].max(1e-3)).clamp(0.0, 1.0)
    }
}

// Field pins: inverse-square-distance blend of per-pin blur amounts into one
// focus map (a pixel sitting on a pin takes exactly that pin's amount).
fn field_pin_blur(pins: &[&[f32]], fx: f32, fy: f32) -> f32 {
    let (mut num, mut den) = (0.0f32, 0.0f32);
    for p in pins {
        let d2 = (fx - p[0]).powi(2) + (fy - p[1]).powi(2);
        if d2 < 1e-6 {
            return p[2].clamp(0.0, 1.0);
        }
        let w = 1.0 / d2;
        num += p[2].clamp(0.0, 1.0) * w;
        den += w;
    }
    if den > 0.0 {
        num / den
    } else {
        1.0 // no pins: uniform blur (legacy Field)
    }
}

// Filter ▸ Stylize ▸ Extrude: break the image into a grid of `size`-px blocks,
// each "extruded" toward the viewer — the block's average colour fills a top
// face that shrinks (and the darkened sides grow) with the extrusion depth.
// `depth` 0..1; the per-block depth follows brightness, or a random value.
pub fn extrude(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    size: i32,
    depth: f32,
    by_brightness: bool,
    seed: u32,
    kind: u8,
    solid_front: bool,
    mask_incomplete: bool,
) {
    let cell = size.max(2);
    let (wi, hi) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let depth = depth.clamp(0.0, 1.0);
    let hash = |a: i32, b: i32| -> f32 {
        let mut v =
            (a as u32).wrapping_mul(0x9E37_79B1) ^ (b as u32).wrapping_mul(0x85EB_CA6B) ^ seed;
        v ^= v >> 16;
        v = v.wrapping_mul(0x7FEB_352D);
        v ^= v >> 15;
        (v & 0xFFFF) as f32 / 65536.0
    };
    let mut cy0 = 0;
    while cy0 < hi {
        let cy1 = (cy0 + cell).min(hi);
        let mut cx0 = 0;
        while cx0 < wi {
            let cx1 = (cx0 + cell).min(wi);
            let complete = cx1 - cx0 == cell
                && cy1 - cy0 == cell
                && (cy0..cy1)
                    .all(|y| (cx0..cx1).all(|x| sel.coverage((y * wi + x) as usize) >= 1.0));
            if mask_incomplete && !complete {
                cx0 = cx1;
                continue;
            }
            // average colour + luminance over the cell
            let (mut sr, mut sg, mut sb, mut cnt) = (0u64, 0u64, 0u64, 0u64);
            for y in cy0..cy1 {
                for x in cx0..cx1 {
                    let si = (y * wi + x) as usize * 4;
                    sr += src[si] as u64;
                    sg += src[si + 1] as u64;
                    sb += src[si + 2] as u64;
                    cnt += 1;
                }
            }
            let (ar, ag, ab) = ((sr / cnt) as u16, (sg / cnt) as u16, (sb / cnt) as u16);
            let lum = (0.299 * ar as f32 + 0.587 * ag as f32 + 0.114 * ab as f32) / 65535.0;
            let f = if by_brightness {
                lum
            } else {
                hash(cx0 / cell, cy0 / cell)
            };
            let inset = (depth * f * (cell as f32 / 2.0)).round() as i32;
            // Pyramids shade continuously from a bright apex at the cell centre
            // to dark base edges; Blocks keep a flat top face and darkened sides.
            let half = cell as f32 / 2.0;
            let (ccx, ccy) = (cx0 as f32 + half, cy0 as f32 + half);
            for y in cy0..cy1 {
                for x in cx0..cx1 {
                    let di = (y * wi + x) as usize * 4;
                    let (k, image_front) = if kind == 1 {
                        let t = ((x as f32 + 0.5 - ccx)
                            .abs()
                            .max((y as f32 + 0.5 - ccy).abs())
                            / half)
                            .min(1.0);
                        ((1.0 - depth * f * t).max(0.2), false)
                    } else {
                        let on_top = x >= cx0 + inset
                            && x < cx1 - inset
                            && y >= cy0 + inset
                            && y < cy1 - inset;
                        (if on_top { 1.0 } else { 0.45 }, on_top && !solid_front)
                    };
                    filtered[di] = if image_front {
                        src[di]
                    } else {
                        (ar as f32 * k) as u16
                    };
                    filtered[di + 1] = if image_front {
                        src[di + 1]
                    } else {
                        (ag as f32 * k) as u16
                    };
                    filtered[di + 2] = if image_front {
                        src[di + 2]
                    } else {
                        (ab as f32 * k) as u16
                    };
                    filtered[di + 3] = src[di + 3];
                }
            }
            cx0 = cx1;
        }
        cy0 = cy1;
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Video ▸ NTSC Colors: bring the image into the broadcast-safe gamut —
// chroma is reduced 15% (illegal over-saturation) and levels are clamped to the
// studio-swing range (~16..235 of 255) so super-blacks/whites are removed.
pub fn ntsc_colors(px: &mut [u16], w: u32, h: u32, sel: &Selection) {
    let n = (w * h) as usize;
    let src = px.to_vec();
    let mut filtered = src.clone();
    let (lo, hi) = (16.0 / 255.0, 235.0 / 255.0);
    for i in 0..n {
        let r = src[i * 4] as f32 / 65535.0;
        let g = src[i * 4 + 1] as f32 / 65535.0;
        let b = src[i * 4 + 2] as f32 / 65535.0;
        let lum = 0.299 * r + 0.587 * g + 0.114 * b;
        let ch = |c: f32| (lum + (c - lum) * 0.85).clamp(0.0, 1.0) * (hi - lo) + lo;
        filtered[i * 4] = (ch(r) * 65535.0).round() as u16;
        filtered[i * 4 + 1] = (ch(g) * 65535.0).round() as u16;
        filtered[i * 4 + 2] = (ch(b) * 65535.0).round() as u16;
        filtered[i * 4 + 3] = src[i * 4 + 3];
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Video ▸ De-Interlace: remove interlacing artifacts by discarding one
// field (odd or even scanlines) and rebuilding it — either by duplicating the
// kept neighbour line or interpolating between the two neighbours.
pub fn deinterlace(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    eliminate_odd: bool,
    interpolate: bool,
) {
    let (wi, hi) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    for y in 0..hi {
        let elim = if eliminate_odd {
            y % 2 == 1
        } else {
            y % 2 == 0
        };
        if !elim {
            continue;
        }
        for x in 0..wi {
            let di = (y * wi + x) as usize * 4;
            let above = idx(x, y - 1, wi, hi);
            let below = idx(x, y + 1, wi, hi);
            for k in 0..4 {
                filtered[di + k] = if interpolate {
                    ((src[above + k] as u32 + src[below + k] as u32) / 2) as u16
                } else {
                    src[above + k]
                };
            }
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Other ▸ HSB/HSL: reinterpret each pixel's hue/saturation/brightness
// (mode 0 = HSB) or hue/saturation/lightness (mode 1 = HSL) into the R/G/B
// channels — a technical false-colour transform Adobe ships for channel work.
pub fn hsb_hsl(px: &mut [u16], w: u32, h: u32, sel: &Selection, mode: u8) {
    let n = (w * h) as usize;
    let src = px.to_vec();
    let mut filtered = src.clone();
    let enc = |v: f32| (v.clamp(0.0, 1.0) * 65535.0).round() as u16;
    for i in 0..n {
        let r = src[i * 4] as f32 / 65535.0;
        let g = src[i * 4 + 1] as f32 / 65535.0;
        let b = src[i * 4 + 2] as f32 / 65535.0;
        let (hue, s, v) = crate::raster::color::rgb_to_hsv(r, g, b);
        let (c0, c1, c2) = if mode == 0 {
            (hue / 360.0, s, v)
        } else {
            let (max, min) = (r.max(g).max(b), r.min(g).min(b));
            let l = (max + min) / 2.0;
            let sl = if l <= 0.0 || l >= 1.0 {
                0.0
            } else {
                (max - min) / (1.0 - (2.0 * l - 1.0).abs())
            };
            (hue / 360.0, sl, l)
        };
        filtered[i * 4] = enc(c0);
        filtered[i * 4 + 1] = enc(c1);
        filtered[i * 4 + 2] = enc(c2);
        filtered[i * 4 + 3] = src[i * 4 + 3];
    }
    blend_back(px, &filtered, sel);
}

// Separable 3-pass box blur of a single-channel f32 plane (≈ Gaussian). Used as
// the point-spread function for Richardson-Lucy deconvolution.
fn box3_f32(buf: &mut [f32], w: i32, h: i32, radius: i32) {
    if radius < 1 {
        return;
    }
    let win = (2 * radius + 1) as f32;
    for _ in 0..3 {
        // horizontal
        let src = buf.to_vec();
        for y in 0..h {
            for x in 0..w {
                let mut s = 0.0;
                for dx in -radius..=radius {
                    s += src[(y * w + (x + dx).clamp(0, w - 1)) as usize];
                }
                buf[(y * w + x) as usize] = s / win;
            }
        }
        // vertical
        let src = buf.to_vec();
        for y in 0..h {
            for x in 0..w {
                let mut s = 0.0;
                for dy in -radius..=radius {
                    s += src[((y + dy).clamp(0, h - 1) * w + x) as usize];
                }
                buf[(y * w + x) as usize] = s / win;
            }
        }
    }
}

// Filter ▸ Sharpen ▸ Shake Reduction: Richardson-Lucy deconvolution assuming a
// box/Gaussian point-spread function of the given `radius`. Iteratively recovers
// detail lost to a small blur (camera shake). `iterations` controls strength.
pub fn shake_reduction(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    radius: i32,
    iterations: i32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let n = (wi * hi) as usize;
    let radius = radius.clamp(1, 10);
    let iterations = iterations.clamp(1, 30);
    let src = px.to_vec();
    let mut filtered = src.clone();
    for c in 0..3 {
        let obs: Vec<f32> = (0..n).map(|i| src[i * 4 + c] as f32 / 65535.0).collect();
        let mut est = obs.clone();
        for _ in 0..iterations {
            let mut reblur = est.clone();
            box3_f32(&mut reblur, wi, hi, radius);
            let mut ratio = vec![0f32; n];
            for i in 0..n {
                ratio[i] = if reblur[i] > 1e-4 {
                    obs[i] / reblur[i]
                } else {
                    1.0
                };
            }
            box3_f32(&mut ratio, wi, hi, radius); // correlate with the symmetric PSF
            for i in 0..n {
                est[i] = (est[i] * ratio[i]).clamp(0.0, 2.0);
            }
        }
        for i in 0..n {
            filtered[i * 4 + c] = (est[i].clamp(0.0, 1.0) * 65535.0).round() as u16;
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Noise ▸ Reduce Noise: edge-preserving bilateral smoothing. Each pixel
// is a weighted average of a 5×5 neighbourhood where the weight falls off with
// both spatial distance and colour difference, so noise is smoothed while edges
// (large colour jumps) survive. `strength` 0..1 widens the colour sigma.
pub fn reduce_noise(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    strength: f32,
    reduce_color: f32,
    preserve_details: f32,
    sharpen_details: f32,
) {
    reduce_noise_ex(
        px,
        w,
        h,
        sel,
        strength,
        reduce_color,
        preserve_details,
        sharpen_details,
        0.0,
        50.0,
        50.0,
    );
}

// Camera Raw ▸ Detail's Noise Reduction with its Contrast, Color Detail and Color
// Smoothness sliders (ACR units 0..100). Contrast 0 / Detail 50 / Smoothness 50 is
// exactly `reduce_noise`. Contrast narrows the bilateral colour sigma so more
// local contrast survives; Color Detail and Smoothness steer the chroma pass.
#[allow(clippy::too_many_arguments)]
pub fn reduce_noise_ex(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    strength: f32,
    reduce_color: f32,
    preserve_details: f32,
    sharpen_details: f32,
    contrast: f32,
    color_detail: f32,
    color_smoothness: f32,
) {
    let radius = 2i32;
    let (wi, hi) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let sigma_s = 2.0f32;
    let mut sigma_c = 0.04 + strength.clamp(0.0, 1.0) * 0.20;
    if contrast > 0.0 {
        sigma_c *= 1.0 - 0.6 * contrast.min(100.0) / 100.0;
    }
    let inv2s2 = 1.0 / (2.0 * sigma_s * sigma_s);
    let inv2c2 = 1.0 / (2.0 * sigma_c * sigma_c);
    // Preserve Details blends the original back over the denoised result, trading
    // noise reduction for retained texture/edges (0 = full denoise, 1 = untouched).
    let keep = preserve_details.clamp(0.0, 1.0);
    for y in 0..hi {
        for x in 0..wi {
            let ci = (y * wi + x) as usize * 4;
            let (cr, cg, cb) = (
                src[ci] as f32 / 65535.0,
                src[ci + 1] as f32 / 65535.0,
                src[ci + 2] as f32 / 65535.0,
            );
            let mut acc = [0f32; 3];
            let mut wsum = 0f32;
            for dy in -radius..=radius {
                for dx in -radius..=radius {
                    let si = idx(x + dx, y + dy, wi, hi);
                    let (sr, sg, sb) = (
                        src[si] as f32 / 65535.0,
                        src[si + 1] as f32 / 65535.0,
                        src[si + 2] as f32 / 65535.0,
                    );
                    let dc = (sr - cr).powi(2) + (sg - cg).powi(2) + (sb - cb).powi(2);
                    let ds = (dx * dx + dy * dy) as f32;
                    let wgt = (-ds * inv2s2 - dc * inv2c2).exp();
                    acc[0] += sr * wgt;
                    acc[1] += sg * wgt;
                    acc[2] += sb * wgt;
                    wsum += wgt;
                }
            }
            for (k, a) in acc.iter().enumerate() {
                let denoised = a / wsum;
                let orig = src[ci + k] as f32 / 65535.0;
                let val = denoised + keep * (orig - denoised);
                filtered[ci + k] = (val * 65535.0).round().clamp(0.0, 65535.0) as u16;
            }
            filtered[ci + 3] = src[ci + 3];
        }
    }
    if reduce_color > 0.0 {
        reduce_color_noise(&mut filtered, w, h, reduce_color, color_detail, color_smoothness);
    }
    // Sharpen Details: a light unsharp pass over the whole result (denoising softens
    // fine edges; this restores their crispness). Reuses the Unsharp Mask filter.
    let sharpen = sharpen_details.clamp(0.0, 1.0);
    if sharpen > 0.0 {
        let full = Selection {
            w,
            h,
            active: false,
            mask: Vec::new(),
            antialias: true,
        };
        unsharp_mask(&mut filtered, w, h, &full, 1.5, sharpen * 2.0, 0.0);
    }
    blend_back(px, &filtered, sel);
}

// Reduce Color Noise: smooth chroma while preserving each pixel's luma exactly.
// Y = Rec.601 luminance; the Cb/Cr-ish opponents (b−Y, r−Y) are box-blurred, then
// RGB is reconstructed from the ORIGINAL Y so luma detail survives untouched.
// Color Smoothness (ACR 0..100, neutral 50) scales the blur radius ×0.5..×1.5.
// Color Detail (neutral 50) trades smoothing for chroma detail: above 50 it
// blends the unblurred chroma back in, below 50 it blends toward a second pass
// of the same blur (a wider tent, at the cost of one more blur — not two).
fn reduce_color_noise(px: &mut [u16], w: u32, h: u32, amount: f32, detail: f32, smoothness: f32) {
    let radius = ((1.0 + amount.clamp(0.0, 1.0) * 3.0) * (0.5 + smoothness.clamp(0.0, 100.0) / 100.0))
        .round()
        .max(1.0) as i32; // 1..=6
    let (wi, hi) = (w as i32, h as i32);
    let n = (w * h) as usize;
    let src = px.to_vec();
    let mut y = vec![0f32; n];
    let mut cb = vec![0f32; n];
    let mut cr = vec![0f32; n];
    for i in 0..n {
        let (r, g, b) = (
            src[i * 4] as f32,
            src[i * 4 + 1] as f32,
            src[i * 4 + 2] as f32,
        );
        y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
        cb[i] = b - y[i];
        cr[i] = r - y[i];
    }
    let blur = |c: &[f32]| -> Vec<f32> {
        let mut out = vec![0f32; n];
        for yy in 0..hi {
            for xx in 0..wi {
                let (mut acc, mut cnt) = (0f32, 0f32);
                for dy in -radius..=radius {
                    for dx in -radius..=radius {
                        let sx = (xx + dx).clamp(0, wi - 1);
                        let sy = (yy + dy).clamp(0, hi - 1);
                        acc += c[(sy * wi + sx) as usize];
                        cnt += 1.0;
                    }
                }
                out[(yy * wi + xx) as usize] = acc / cnt;
            }
        }
        out
    };
    let (mut cbb, mut crb) = (blur(&cb), blur(&cr));
    let blend = |out: &mut [f32], toward: &[f32], k: f32| {
        for (o, t) in out.iter_mut().zip(toward) {
            *o += (t - *o) * k;
        }
    };
    let t = (detail.clamp(0.0, 100.0) - 50.0) / 50.0;
    if t > 0.0 {
        blend(&mut cbb, &cb, t);
        blend(&mut crb, &cr, t);
    } else if t < 0.0 {
        let (cb2, cr2) = (blur(&cbb), blur(&crb));
        blend(&mut cbb, &cb2, -t);
        blend(&mut crb, &cr2, -t);
    }
    for i in 0..n {
        let yi = y[i];
        let r = (yi + crb[i]).clamp(0.0, 65535.0);
        let b = (yi + cbb[i]).clamp(0.0, 65535.0);
        // Solve g from the luma equation so Y is preserved after chroma smoothing.
        let g = ((yi - 0.299 * r - 0.114 * b) / 0.587).clamp(0.0, 65535.0);
        px[i * 4] = r.round() as u16;
        px[i * 4 + 1] = g.round() as u16;
        px[i * 4 + 2] = b.round() as u16;
    }
}

// Reduce JPEG Artifacts: soften the 8×8 DCT block seams JPEG introduces by
// blending the two pixels straddling each block boundary toward their average.
// A classical deblocker (not Photoshop's ML Neural Filter). `strength` 0..1.
pub fn deblock(px: &mut [u16], w: u32, h: u32, sel: &Selection, strength: f32) {
    let (wi, hi) = (w as i32, h as i32);
    let s = strength.clamp(0.0, 1.0) * 0.5; // up to a half-step toward the seam average
                                            // Vertical seams (columns that are multiples of 8): blend x-1 and x.
    let src = px.to_vec();
    for y in 0..hi {
        for bx in (8..wi).step_by(8) {
            for (dx, other) in [(bx - 1, bx), (bx, bx - 1)] {
                let i = (y * wi + dx) as usize;
                if sel.coverage(i) <= 0.0 {
                    continue;
                }
                let j = (y * wi + other) as usize;
                let cov = sel.coverage(i);
                for k in 0..3 {
                    let a = src[i * 4 + k] as f32;
                    let avg = (a + src[j * 4 + k] as f32) * 0.5;
                    px[i * 4 + k] = (a + (avg - a) * s * cov).round().clamp(0.0, 65535.0) as u16;
                }
            }
        }
    }
    // Horizontal seams (rows that are multiples of 8): blend y-1 and y.
    let src = px.to_vec();
    for x in 0..wi {
        for by in (8..hi).step_by(8) {
            for (dy, other) in [(by - 1, by), (by, by - 1)] {
                let i = (dy * wi + x) as usize;
                if sel.coverage(i) <= 0.0 {
                    continue;
                }
                let j = (other * wi + x) as usize;
                let cov = sel.coverage(i);
                for k in 0..3 {
                    let a = src[i * 4 + k] as f32;
                    let avg = (a + src[j * 4 + k] as f32) * 0.5;
                    px[i * 4 + k] = (a + (avg - a) * s * cov).round().clamp(0.0, 65535.0) as u16;
                }
            }
        }
    }
}

// Filter ▸ Sharpen ▸ Smart Sharpen: an unsharp mask that suppresses noise — the
// detail (src − Gaussian low-pass) is gated by `|detail|/(|detail|+floor)` so
// small fluctuations (noise) are amplified far less than real edges. `amount`
// 0..~3 strength, `radius` the low-pass radius, `reduce_noise` 0..1 the floor.
pub fn smart_sharpen(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    amount: f32,
    radius: f32,
    reduce_noise: f32,
    remove: u8,
    angle: f32,
    shadow_fade: f32,
    highlight_fade: f32,
) {
    smart_sharpen_ex(
        px,
        w,
        h,
        sel,
        amount,
        radius,
        reduce_noise,
        remove,
        angle,
        shadow_fade,
        highlight_fade,
        25.0,
        0.0,
    );
}

/// Detail below 25 raises the noise floor by up to this much.
const SHARPEN_DETAIL_FLOOR: f32 = 0.05;
/// Detail above 25 boosts detail smaller than about this magnitude.
const SHARPEN_DETAIL_BOOST: f32 = 0.02;
/// Low-pass luma gradient that counts as a full edge at Masking 100.
const SHARPEN_MASK_EDGE: f32 = 0.25;

// Camera Raw ▸ Detail's Sharpening with its Detail and Masking sliders (ACR
// units 0..100); Detail 25 / Masking 0 is exactly `smart_sharpen`. Adobe: lower
// Detail mostly sharpens edges, higher Detail makes texture more pronounced — so
// below 25 the noise floor that gates small-amplitude detail rises, and above 25
// small-amplitude detail is boosted. Masking keeps the sharpening to edges: each
// pixel is weighted by a smoothstep of the low-pass luma's Sobel magnitude.
#[allow(clippy::too_many_arguments)]
pub fn smart_sharpen_ex(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    amount: f32,
    radius: f32,
    reduce_noise: f32,
    remove: u8,
    angle: f32,
    shadow_fade: f32,
    highlight_fade: f32,
    detail_level: f32,
    masking: f32,
) {
    let src = px.to_vec();
    let mut blur = src.clone();
    let full = Selection::new(w, h); // full-coverage low-pass, independent of `sel`
                                     // Photoshop's Remove dropdown chooses the low-pass whose detail is sharpened:
                                     //   0 Gaussian Blur — isotropic soft low-pass (classic unsharp).
                                     //   1 Lens Blur     — disc (circular-aperture) low-pass; finer detail, fewer halos.
                                     //   2 Motion Blur   — directional low-pass along `angle`, counteracting motion blur.
    match remove {
        1 => lens_blur(&mut blur, w, h, &full, radius.round().max(1.0) as i32, 0.0),
        2 => motion_blur(&mut blur, w, h, &full, angle, radius),
        _ => gaussian_blur(&mut blur, w, h, &full, radius),
    }
    let detail_floor = if detail_level < 25.0 {
        (25.0 - detail_level.max(0.0)) / 25.0 * SHARPEN_DETAIL_FLOOR
    } else {
        0.0
    };
    // detail magnitude treated as noise
    let floor = reduce_noise.clamp(0.0, 1.0) * 0.15 + detail_floor;
    let boost = if detail_level > 25.0 {
        (detail_level.min(100.0) - 25.0) / 75.0
    } else {
        0.0
    };
    let n = (w * h) as usize;
    let edge_weight = (masking > 0.0).then(|| {
        let (wi, hi) = (w as i32, h as i32);
        let edge = masking.min(100.0) / 100.0 * SHARPEN_MASK_EDGE;
        let luma = |x: i32, y: i32| {
            let i = (y.clamp(0, hi - 1) * wi + x.clamp(0, wi - 1)) as usize * 4;
            (0.299 * blur[i] as f32 + 0.587 * blur[i + 1] as f32 + 0.114 * blur[i + 2] as f32)
                / 65535.0
        };
        let mut weight = vec![0f32; n];
        for y in 0..hi {
            for x in 0..wi {
                let gx = luma(x + 1, y - 1) + 2.0 * luma(x + 1, y) + luma(x + 1, y + 1)
                    - luma(x - 1, y - 1)
                    - 2.0 * luma(x - 1, y)
                    - luma(x - 1, y + 1);
                let gy = luma(x - 1, y + 1) + 2.0 * luma(x, y + 1) + luma(x + 1, y + 1)
                    - luma(x - 1, y - 1)
                    - 2.0 * luma(x, y - 1)
                    - luma(x + 1, y - 1);
                // smoothstep(edge/2, edge, |∇|): flat areas get exactly 0.
                let s = (((gx * gx + gy * gy).sqrt() - edge * 0.5) / (edge * 0.5)).clamp(0.0, 1.0);
                weight[(y * wi + x) as usize] = s * s * (3.0 - 2.0 * s);
            }
        }
        weight
    });
    // Shadow/Highlight fade (Smart Sharpen "More Accurate"): attenuate the
    // sharpening in the darkest and brightest tones so haloing there is reduced.
    // Weight from the low-pass luminance (smoother than the raw channel); 0 fades
    // leave the sharpen unchanged.
    let sh_fade = shadow_fade.clamp(0.0, 1.0);
    let hi_fade = highlight_fade.clamp(0.0, 1.0);
    let mut filtered = src.clone();
    for i in 0..n {
        let lum = (0.299 * blur[i * 4] as f32
            + 0.587 * blur[i * 4 + 1] as f32
            + 0.114 * blur[i * 4 + 2] as f32)
            / 65535.0;
        let sh_w = (1.0 - lum * 2.0).clamp(0.0, 1.0); // 1 in deep shadows → 0 by mid
        let hi_w = ((lum - 0.5) * 2.0).clamp(0.0, 1.0); // 0 at mid → 1 in highlights
        let fade = (1.0 - sh_fade * sh_w) * (1.0 - hi_fade * hi_w);
        for k in 0..3 {
            let s = src[i * 4 + k] as f32 / 65535.0;
            let lo = blur[i * 4 + k] as f32 / 65535.0;
            let detail = s - lo;
            let gate = if floor > 0.0 {
                detail.abs() / (detail.abs() + floor)
            } else {
                1.0
            };
            let mut term = amount * detail * gate * fade;
            if boost > 0.0 {
                term *= 1.0 + boost * SHARPEN_DETAIL_BOOST / (detail.abs() + SHARPEN_DETAIL_BOOST);
            }
            if let Some(weight) = &edge_weight {
                term *= weight[i];
            }
            let out = (s + term).clamp(0.0, 1.0);
            filtered[i * 4 + k] = (out * 65535.0).round() as u16;
        }
        filtered[i * 4 + 3] = src[i * 4 + 3];
    }
    blend_back(px, &filtered, sel);
}

/// Camera Raw ▸ Optics ▸ Defringe hue arcs: the 0..100 hue sliders map linearly
/// onto (start°, span°).
const DEFRINGE_PURPLE_ARC: (f32, f32) = (180.0, 180.0);
const DEFRINGE_GREEN_ARC: (f32, f32) = (30.0, 180.0);
/// Luma Sobel magnitude ramp (0..1 luma) from "not an edge" to "full edge".
const DEFRINGE_EDGE: [f32; 2] = [0.25, 0.5];
/// Fringe reach from an edge, in full-resolution px (scaled to the proxy).
const DEFRINGE_REACH: f32 = 5.0;

// Camera Raw ▸ Optics ▸ Defringe (#444): desaturate purple and green colour
// fringes within a few pixels of a high-contrast luma edge, toward their own
// Rec.601 luma. `purple`/`green` are the 0..1 amounts; the hue windows are ACR's
// 0..100 slider units on the arcs above. Unlike Layer ▸ Matting ▸ Defringe
// (`defringe`) it needs no transparency, so it works on an opaque photo.
#[allow(clippy::too_many_arguments)]
pub fn defringe_color(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    purple: f32,
    purple_hue: [f32; 2],
    green: f32,
    green_hue: [f32; 2],
    proxy_scale: f32,
) {
    let (purple, green) = (purple.clamp(0.0, 1.0), green.clamp(0.0, 1.0));
    if purple <= 0.0 && green <= 0.0 {
        return;
    }
    let (wi, hi) = (w as i32, h as i32);
    let n = (w * h) as usize;
    let src = px.to_vec();
    let luma = |x: i32, y: i32| {
        let i = (y.clamp(0, hi - 1) * wi + x.clamp(0, wi - 1)) as usize * 4;
        (0.299 * src[i] as f32 + 0.587 * src[i + 1] as f32 + 0.114 * src[i + 2] as f32) / 65535.0
    };
    let mut near = vec![0f32; n];
    for y in 0..hi {
        for x in 0..wi {
            let gx = luma(x + 1, y - 1) + 2.0 * luma(x + 1, y) + luma(x + 1, y + 1)
                - luma(x - 1, y - 1)
                - 2.0 * luma(x - 1, y)
                - luma(x - 1, y + 1);
            let gy = luma(x - 1, y + 1) + 2.0 * luma(x, y + 1) + luma(x + 1, y + 1)
                - luma(x - 1, y - 1)
                - 2.0 * luma(x, y - 1)
                - luma(x + 1, y - 1);
            let magnitude = (gx * gx + gy * gy).sqrt();
            near[(y * wi + x) as usize] =
                ((magnitude - DEFRINGE_EDGE[0]) / (DEFRINGE_EDGE[1] - DEFRINGE_EDGE[0])).clamp(0.0, 1.0);
        }
    }
    // Spread each edge over the reach, falling off linearly: one horizontal and
    // one vertical max pass.
    let reach = (DEFRINGE_REACH * proxy_scale).round().max(1.0) as i32;
    for (sx, sy) in [(1, 0), (0, 1)] {
        let from = near.clone();
        for y in 0..hi {
            for x in 0..wi {
                let mut best = 0f32;
                for d in -reach..=reach {
                    let (nx, ny) = (x + d * sx, y + d * sy);
                    if nx >= 0 && ny >= 0 && nx < wi && ny < hi {
                        let falloff = 1.0 - d.abs() as f32 / (reach + 1) as f32;
                        best = best.max(from[(ny * wi + nx) as usize] * falloff);
                    }
                }
                near[(y * wi + x) as usize] = best;
            }
        }
    }
    let in_window = |hue: f32, arc: (f32, f32), window: [f32; 2]| {
        hue >= arc.0 + window[0].clamp(0.0, 100.0) / 100.0 * arc.1
            && hue <= arc.0 + window[1].clamp(0.0, 100.0) / 100.0 * arc.1
    };
    let mut filtered = src.clone();
    for (i, &proximity) in near.iter().enumerate() {
        if proximity <= 0.0 {
            continue;
        }
        let o = i * 4;
        let (r, g, b) = (
            src[o] as f32 / 65535.0,
            src[o + 1] as f32 / 65535.0,
            src[o + 2] as f32 / 65535.0,
        );
        let (hue, sat, _) = crate::raster::color::rgb_to_hsl(r, g, b);
        if sat <= 0.0 {
            continue;
        }
        let amount = if purple > 0.0 && in_window(hue, DEFRINGE_PURPLE_ARC, purple_hue) {
            purple
        } else if green > 0.0 && in_window(hue, DEFRINGE_GREEN_ARC, green_hue) {
            green
        } else {
            continue;
        };
        let k = amount * proximity;
        let y = 0.299 * r + 0.587 * g + 0.114 * b;
        for (c, v) in [r, g, b].into_iter().enumerate() {
            filtered[o + c] = ((v + (y - v) * k) * 65535.0).round().clamp(0.0, 65535.0) as u16;
        }
    }
    blend_back(px, &filtered, sel);
}

#[cfg(test)]
mod camera_raw_detail_tests {
    use super::*;

    const W: u32 = 24;
    const H: u32 = 24;

    /// Low-amplitude texture everywhere, one hard luma step at x = 12.
    fn edge_and_texture() -> Vec<u16> {
        let mut px = vec![0u16; (W * H * 4) as usize];
        for y in 0..H {
            for x in 0..W {
                let o = ((y * W + x) * 4) as usize;
                let base: u16 = if x >= 12 { 50000 } else { 15000 };
                let v = base + ((x * 31 + y * 17) % 7) as u16 * 180;
                px[o..o + 4].copy_from_slice(&[v, v, v, 65535]);
            }
        }
        px
    }

    fn sharpened(detail: f32, masking: f32) -> Vec<u16> {
        let mut out = edge_and_texture();
        smart_sharpen_ex(&mut out, W, H, &Selection::new(W, H), 1.0, 1.0, 0.0, 0, 0.0, 0.0, 0.0, detail, masking);
        out
    }

    /// Summed |Δ| over the texture pixels at least 4 px from the edge.
    fn texture_change(detail: f32, masking: f32) -> u64 {
        let src = edge_and_texture();
        let out = sharpened(detail, masking);
        let mut sum = 0u64;
        for y in 0..H {
            for x in (0..W).filter(|x| !(8..16).contains(x)) {
                let o = ((y * W + x) * 4) as usize;
                sum += (out[o] as i64 - src[o] as i64).unsigned_abs();
            }
        }
        sum
    }

    #[test]
    fn sharpen_detail_trades_texture_for_edges_like_camera_raw() {
        // Adobe: lower Detail mostly sharpens edges, higher Detail makes
        // textures more pronounced.
        let (low, mid, high) = (
            texture_change(0.0, 0.0),
            texture_change(25.0, 0.0),
            texture_change(100.0, 0.0),
        );
        assert!(low < mid, "Detail 0 sharpens texture less ({low} vs {mid})");
        assert!(high > mid, "Detail 100 sharpens texture more ({high} vs {mid})");
    }

    #[test]
    fn masking_keeps_sharpening_on_edges() {
        let (plain, masked) = (texture_change(25.0, 0.0), texture_change(25.0, 100.0));
        assert!(masked * 4 < plain, "Masking 100 spares flat texture ({masked} vs {plain})");
        let src = edge_and_texture();
        let edge = ((5 * W + 11) * 4) as usize;
        assert_ne!(sharpened(25.0, 100.0)[edge], src[edge], "the edge still sharpens");
    }

    /// Dark left / bright right, with a fringe column of `fringe` at x = 11.
    fn fringed(fringe: [u16; 3]) -> Vec<u16> {
        let mut px = vec![0u16; (W * H * 4) as usize];
        for y in 0..H {
            for x in 0..W {
                let o = ((y * W + x) * 4) as usize;
                let v = if x >= 12 { 56000 } else { 8000 };
                px[o..o + 4].copy_from_slice(&[v, v, v, 65535]);
                if x == 11 {
                    px[o..o + 3].copy_from_slice(&fringe);
                }
                if x == 2 {
                    // A purple column in the flat dark field, far from the edge.
                    px[o..o + 3].copy_from_slice(&[9000, 5000, 11000]);
                }
            }
        }
        px
    }

    fn chroma(px: &[u16], x: u32, y: u32) -> u16 {
        let o = ((y * W + x) * 4) as usize;
        px[o..o + 3].iter().max().unwrap() - px[o..o + 3].iter().min().unwrap()
    }

    #[test]
    fn color_defringe_desaturates_in_window_fringes_next_to_edges() {
        let purple = [30000, 10000, 40000]; // hue ≈ 280°
        let src = fringed(purple);
        let mut out = src.clone();
        defringe_color(&mut out, W, H, &Selection::new(W, H), 1.0, [30.0, 70.0], 0.0, [40.0, 60.0], 1.0);
        assert!(chroma(&out, 11, 6) < chroma(&src, 11, 6), "purple fringe desaturates");
        assert_eq!(chroma(&out, 2, 6), chroma(&src, 2, 6), "purple far from an edge is untouched");

        // The same fringe outside the hue window is left alone.
        let mut narrow = src.clone();
        defringe_color(&mut narrow, W, H, &Selection::new(W, H), 1.0, [0.0, 20.0], 0.0, [40.0, 60.0], 1.0);
        assert_eq!(narrow, src, "out-of-window hue is untouched");

        // A red fringe (hue 0°) is in neither arc.
        let red = fringed([40000, 8000, 8000]);
        let mut red_out = red.clone();
        defringe_color(&mut red_out, W, H, &Selection::new(W, H), 1.0, [0.0, 100.0], 1.0, [0.0, 100.0], 1.0);
        assert_eq!(red_out, red, "a red fringe is not purple or green");

        let mut off = src.clone();
        defringe_color(&mut off, W, H, &Selection::new(W, H), 0.0, [30.0, 70.0], 0.0, [40.0, 60.0], 1.0);
        assert_eq!(off, src, "zero amounts are a no-op");
    }

    #[test]
    fn green_defringe_uses_its_own_amount_and_window() {
        let green = fringed([20000, 50000, 24000]); // hue ≈ 128°
        let mut purple_only = green.clone();
        defringe_color(&mut purple_only, W, H, &Selection::new(W, H), 1.0, [0.0, 100.0], 0.0, [40.0, 60.0], 1.0);
        assert_eq!(purple_only, green, "Purple Defringe leaves green fringes");
        let mut out = green.clone();
        defringe_color(&mut out, W, H, &Selection::new(W, H), 0.0, [30.0, 70.0], 1.0, [40.0, 60.0], 1.0);
        assert!(chroma(&out, 11, 6) < chroma(&green, 11, 6), "Green Defringe desaturates it");
    }
}

// Filter ▸ Blur ▸ Lens Blur: a circular-aperture (disc) blur giving the flat-
// edged bokeh of a real lens, unlike Gaussian's soft falloff. `radius` is the
// aperture in px (capped at 20 — a disc kernel isn't separable, so cost is
// O(r²·N)); `brightness` (0..1) blooms highlights by averaging in a gamma-
// expanded space so bright points form bright bokeh discs.
pub fn lens_blur(px: &mut [u16], w: u32, h: u32, sel: &Selection, radius: i32, brightness: f32) {
    let radius = radius.clamp(1, 20);
    let (wi, hi) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let r2 = radius * radius;
    let mut offs: Vec<(i32, i32)> = Vec::new();
    for dy in -radius..=radius {
        for dx in -radius..=radius {
            if dx * dx + dy * dy <= r2 {
                offs.push((dx, dy));
            }
        }
    }
    let g = 1.0 + brightness.clamp(0.0, 1.0) * 4.0; // highlight-bloom exponent
    let inv_g = 1.0 / g as f64;
    let n = offs.len() as f64;
    for y in 0..hi {
        for x in 0..wi {
            let di = (y * wi + x) as usize * 4;
            let mut acc = [0f64; 4];
            for &(dx, dy) in &offs {
                let si = idx(x + dx, y + dy, wi, hi);
                for (k, a) in acc.iter_mut().enumerate().take(3) {
                    *a += (src[si + k] as f64 / 65535.0).powf(g as f64);
                }
                acc[3] += src[si + 3] as f64;
            }
            for (k, a) in acc.iter().enumerate().take(3) {
                let avg = (a / n).powf(inv_g);
                filtered[di + k] = (avg * 65535.0).round().clamp(0.0, 65535.0) as u16;
            }
            filtered[di + 3] = (acc[3] / n).round() as u16;
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Pixelate ▸ Mezzotint: convert the image to a high-contrast random
// dot/line pattern — each channel is thresholded against a deterministic random
// value (per dot-block, or per row/column for lines), pushing it to 0 or full.
// kind: 0/1/2 = fine/medium/coarse dots, 3 = horizontal lines, 4 = vertical lines.
pub fn mezzotint(px: &mut [u16], w: u32, h: u32, sel: &Selection, kind: u8, seed: u32) {
    let (wi, hi) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let block = match kind {
        0 => 1,
        1 => 2,
        _ => 3,
    };
    let hash = |a: u32, b: u32, c: u32| -> f32 {
        let mut v = a.wrapping_mul(0x9E37_79B1)
            ^ b.wrapping_mul(0x85EB_CA6B)
            ^ c.wrapping_mul(0xC2B2_AE35)
            ^ seed;
        v ^= v >> 16;
        v = v.wrapping_mul(0x7FEB_352D);
        v ^= v >> 15;
        (v & 0xFFFF) as f32 / 65536.0
    };
    for y in 0..hi {
        for x in 0..wi {
            let di = (y * wi + x) as usize * 4;
            for k in 0..3 {
                let val = src[di + k] as f32 / 65535.0;
                let (bx, by) = match kind {
                    3 => (0u32, y as u32),                         // horizontal lines
                    4 => (x as u32, 0u32),                         // vertical lines
                    _ => ((x / block) as u32, (y / block) as u32), // dots
                };
                filtered[di + k] = if val >= hash(bx, by, k as u32) {
                    65535
                } else {
                    0
                };
            }
            filtered[di + 3] = src[di + 3];
        }
    }
    blend_back(px, &filtered, sel);
}

// Filter ▸ Pixelate ▸ Facet: clump blocks of similarly coloured pixels into one
// flat colour. Each pixel takes the average colour of the largest group (by a
// coarse 5-bit-per-channel quantisation) within its 3×3 neighbourhood — flat
// areas are untouched, noisy/banded areas collapse into solid facets.
pub fn facet(px: &mut [u16], w: u32, h: u32, sel: &Selection) {
    let (wi, hi) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let mut buckets: Vec<(u32, [u64; 3], u32)> = Vec::with_capacity(9);
    for y in 0..hi {
        for x in 0..wi {
            let di = (y * wi + x) as usize * 4;
            buckets.clear();
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let si = idx(x + dx, y + dy, wi, hi);
                    let (r, g, b) = (src[si], src[si + 1], src[si + 2]);
                    let key = ((r as u32 >> 11) << 10) | ((g as u32 >> 11) << 5) | (b as u32 >> 11);
                    if let Some(bk) = buckets.iter_mut().find(|bk| bk.0 == key) {
                        bk.1[0] += r as u64;
                        bk.1[1] += g as u64;
                        bk.1[2] += b as u64;
                        bk.2 += 1;
                    } else {
                        buckets.push((key, [r as u64, g as u64, b as u64], 1));
                    }
                }
            }
            let best = buckets.iter().max_by_key(|bk| bk.2).unwrap();
            filtered[di] = (best.1[0] / best.2 as u64) as u16;
            filtered[di + 1] = (best.1[1] / best.2 as u64) as u16;
            filtered[di + 2] = (best.1[2] / best.2 as u64) as u16;
            filtered[di + 3] = src[di + 3];
        }
    }
    blend_back(px, &filtered, sel);
}

pub fn median(px: &mut [u16], w: u32, h: u32, sel: &Selection, radius: i32) {
    if radius < 1 {
        return;
    }
    let (w, h) = (w as i32, h as i32);
    let src = px.to_vec();
    let mut filtered = src.clone();
    let mut window: Vec<u16> = Vec::with_capacity(((2 * radius + 1) * (2 * radius + 1)) as usize);
    for y in 0..h {
        for x in 0..w {
            let di = (y * w + x) as usize * 4;
            for k in 0..3 {
                window.clear();
                for dy in -radius..=radius {
                    for dx in -radius..=radius {
                        window.push(src[idx(x + dx, y + dy, w, h) + k]);
                    }
                }
                window.sort_unstable();
                filtered[di + k] = window[window.len() / 2];
            }
        }
    }
    blend_back(px, &filtered, sel);
}

#[cfg(test)]
mod texture_tests {
    use super::*;

    #[test]
    fn texture_boost_raises_midfreq_contrast_but_preserves_flat_regions() {
        let (w, h) = (8u32, 8u32);
        let sel = Selection::new(w, h);

        // Flat field: gaussian(lum) == lum everywhere → zero detail → no change,
        // even at a strong amount.
        let mut flat = vec![20_000u16; (w * h * 4) as usize];
        for px in flat.chunks_exact_mut(4) {
            px[3] = 65535;
        }
        let before_flat = flat.clone();
        texture_boost(&mut flat, w, h, &sel, 0.8, 3.0);
        assert_eq!(flat, before_flat, "flat regions are byte-identical");

        // A vertical edge: half dark, half bright. The boundary columns carry
        // high-frequency detail → texture pushes them further apart.
        let mut edge = vec![0u16; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let v = if x < w / 2 { 15_000u16 } else { 45_000u16 };
                let p = ((y * w + x) * 4) as usize;
                edge[p] = v;
                edge[p + 1] = v;
                edge[p + 2] = v;
                edge[p + 3] = 65535;
            }
        }
        let before_edge = edge.clone();
        texture_boost(&mut edge, w, h, &sel, 0.8, 3.0);
        assert_ne!(edge, before_edge, "an edge gains local contrast");

        // amount 0 is a no-op.
        let mut noop = before_edge.clone();
        texture_boost(&mut noop, w, h, &sel, 0.0, 3.0);
        assert_eq!(noop, before_edge, "amount 0 is byte-identical");
    }
}

#[cfg(test)]
mod blur_pin_tests {
    use super::*;

    // Vertical stripes: blur-sensitive detail everywhere in the frame.
    fn stripes(w: u32, h: u32) -> Vec<u16> {
        let mut px = vec![0u16; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let v = if x % 8 < 4 { 60_000u16 } else { 5_000u16 };
                let i = ((y * w + x) * 4) as usize;
                px[i] = v;
                px[i + 1] = v;
                px[i + 2] = v;
                px[i + 3] = 65535;
            }
        }
        px
    }

    fn pixel(px: &[u16], w: u32, x: u32, y: u32) -> &[u16] {
        let i = ((y * w + x) * 4) as usize;
        &px[i..i + 3]
    }

    #[test]
    fn iris_pin_is_sharp_at_the_pin_and_fully_blurred_far_away() {
        let (w, h) = (48u32, 24u32);
        let sel = Selection::new(w, h);
        let src = stripes(w, h);
        let mut blurred = src.clone();
        gaussian_blur(&mut blurred, w, h, &sel, 4.0);

        // Off-centre pin at (10, 12), small ellipse: inside the feather ring the
        // pixel is byte-identical to the source; far outside the ellipse it is
        // byte-identical to the fully blurred image.
        let mut out = src.clone();
        let pin = [10.0, 12.0, 1.0, 6.0, 0.5, 0.0, 1.0];
        gallery_blur_pins(&mut out, w, h, &sel, 1, 4.0, &pin, 0.0, 0.0);
        assert_eq!(pixel(&out, w, 10, 12), pixel(&src, w, 10, 12), "pin core stays sharp");
        assert_eq!(pixel(&out, w, 40, 12), pixel(&blurred, w, 40, 12), "far pixel fully blurred");

        // The old image centre (24, 12) is outside the pin → blurred, proving the
        // focus region followed the pin instead of the canvas centre.
        assert_eq!(pixel(&out, w, 24, 12), pixel(&blurred, w, 24, 12), "old centre now blurred");
    }

    #[test]
    fn rotated_tilt_band_follows_the_pin_axis() {
        let (w, h) = (32u32, 32u32);
        let sel = Selection::new(w, h);
        let src = stripes(w, h);
        let mut blurred = src.clone();
        gaussian_blur(&mut blurred, w, h, &sel, 3.0);

        // Vertical band (rotation 90°) through a pin at (8, 16), half-width 4.
        let mut out = src.clone();
        let pin = [8.0, 16.0, 1.0, 4.0, 3.0, std::f32::consts::FRAC_PI_2, 1.0];
        gallery_blur_pins(&mut out, w, h, &sel, 2, 3.0, &pin, 0.0, 0.0);
        // Along the band axis (same x, far y) → sharp; perpendicular → blurred.
        assert_eq!(pixel(&out, w, 8, 2), pixel(&src, w, 8, 2), "band axis stays sharp");
        assert_eq!(pixel(&out, w, 26, 16), pixel(&blurred, w, 26, 16), "off-band blurred");
    }

    #[test]
    fn field_pins_blend_per_pin_amounts() {
        let (w, h) = (48u32, 16u32);
        let sel = Selection::new(w, h);
        let src = stripes(w, h);
        let mut blurred = src.clone();
        gaussian_blur(&mut blurred, w, h, &sel, 4.0);

        // Two pins on pixel centres: sharp (amount 0) at (6, 8) and full blur
        // (amount 1) at (42, 8) — a pixel on a pin takes exactly its amount.
        let mut out = src.clone();
        let pins = [
            6.5, 8.5, 0.0, 0.0, 0.0, 0.0, 1.0, //
            42.5, 8.5, 1.0, 0.0, 0.0, 0.0, 1.0,
        ];
        gallery_blur_pins(&mut out, w, h, &sel, 0, 4.0, &pins, 0.0, 0.0);
        assert_eq!(pixel(&out, w, 6, 8), pixel(&src, w, 6, 8), "amount-0 pin is sharp");
        assert_eq!(pixel(&out, w, 42, 8), pixel(&blurred, w, 42, 8), "amount-1 pin fully blurred");
    }

    #[test]
    fn legacy_gallery_blur_matches_its_centred_pin() {
        let (w, h) = (32u32, 24u32);
        let sel = Selection::new(w, h);
        for kind in [0u8, 1, 2] {
            let mut legacy = stripes(w, h);
            gallery_blur(&mut legacy, w, h, &sel, kind, 3.0, 0.4, 0.0, 0.0);
            // Sharp at the centre for iris/tilt, blurred at the frame corner.
            let src = stripes(w, h);
            if kind != 0 {
                assert_eq!(
                    pixel(&legacy, w, 16, 12),
                    pixel(&src, w, 16, 12),
                    "kind {kind}: centre stays sharp through the pin wrapper"
                );
            }
            assert_ne!(
                pixel(&legacy, w, 1, 1),
                pixel(&src, w, 1, 1),
                "kind {kind}: corner is blurred"
            );
        }
    }

    #[test]
    fn spin_pin_only_spins_inside_its_ellipse() {
        let (w, h) = (48u32, 24u32);
        let sel = Selection::new(w, h);
        let src = stripes(w, h);

        // Small spin ellipse around (12, 12): pixels outside are byte-identical,
        // pixels near the ellipse interior (off the exact centre, where the spin
        // radius is non-zero) change.
        let mut out = src.clone();
        let pin = [12.0, 12.0, 8.0, 8.0, 0.0, 0.25];
        spin_blur_pins(&mut out, w, h, &sel, 60.0, 16, 0, &pin);
        assert_eq!(pixel(&out, w, 40, 12), pixel(&src, w, 40, 12), "outside the ellipse untouched");
        assert_ne!(pixel(&out, w, 16, 12), pixel(&src, w, 16, 12), "inside the ellipse spun");
    }
}
