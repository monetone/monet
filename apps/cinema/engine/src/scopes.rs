//! Video scopes computed from the composited output buffer: luma histogram,
//! luma waveform (per output column), and a vectorscope (U/V 2D histogram).
//! Each returns a `Vec<f32>` normalized 0..1 for direct drawing on the TS side.

#[inline]
fn luma(r: u8, g: u8, b: u8) -> f32 {
    (0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32) / 255.0
}

/// Luma histogram with `bins` buckets, normalized so the tallest bar is 1.0
/// (log-scaled for a readable curve).
pub fn histogram(out: &[u8], bins: usize) -> Vec<f32> {
    let bins = bins.max(1);
    let mut h = vec![0.0f32; bins];
    let mut i = 0;
    while i + 3 < out.len() {
        let l = luma(out[i], out[i + 1], out[i + 2]);
        let b = ((l * bins as f32) as usize).min(bins - 1);
        h[b] += 1.0;
        i += 4;
    }
    let mut max = 1.0f32;
    for v in &h {
        if *v > max {
            max = *v;
        }
    }
    let lmax = (max + 1.0).ln();
    for v in &mut h {
        *v = (*v + 1.0).ln() / lmax;
    }
    h
}

/// Luma waveform: for each of `cols` output columns, the mean luma 0..1.
pub fn waveform(out: &[u8], width: usize, height: usize, cols: usize) -> Vec<f32> {
    let cols = cols.max(1).min(width.max(1));
    let mut wf = vec![0.0f32; cols];
    if width == 0 || height == 0 {
        return wf;
    }
    let mut counts = vec![0u32; cols];
    for y in 0..height {
        let row = y * width * 4;
        for x in 0..width {
            let i = row + x * 4;
            if i + 2 >= out.len() {
                break;
            }
            let c = (x * cols) / width;
            wf[c] += luma(out[i], out[i + 1], out[i + 2]);
            counts[c] += 1;
        }
    }
    for c in 0..cols {
        if counts[c] > 0 {
            wf[c] /= counts[c] as f32;
        }
    }
    wf
}

/// Vectorscope: an `n x n` U/V chroma histogram, row-major, normalized 0..1.
pub fn vectorscope(out: &[u8], n: usize) -> Vec<f32> {
    let n = n.max(2);
    let mut grid = vec![0.0f32; n * n];
    let mut i = 0;
    while i + 3 < out.len() {
        let r = out[i] as f32 / 255.0;
        let g = out[i + 1] as f32 / 255.0;
        let b = out[i + 2] as f32 / 255.0;
        let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        // U/V in -0.5..0.5, mapped to 0..n.
        let u = (b - y) * 0.565 + 0.5;
        let v = (r - y) * 0.713 + 0.5;
        let gx = (u * n as f32).max(0.0).min(n as f32 - 1.0) as usize;
        let gy = ((1.0 - v) * n as f32).max(0.0).min(n as f32 - 1.0) as usize;
        grid[gy * n + gx] += 1.0;
        i += 4;
    }
    let mut max = 1.0f32;
    for v in &grid {
        if *v > max {
            max = *v;
        }
    }
    let lmax = (max + 1.0).ln();
    for v in &mut grid {
        *v = (*v + 1.0).ln() / lmax;
    }
    grid
}
