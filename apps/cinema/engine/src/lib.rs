// ─────────────────────────────────────────────────────────────
// Cinema Engine — Rust/WASM compositing core for Monet Cinema.
//
// Owns the program raster (one RGBA8 output buffer) and a per-frame stack of
// source layers. For each displayed frame the host (TS) decodes the visible
// clips with WebCodecs, writes their pixels into each layer's source buffer
// (zero-copy, via `alloc_source`), sets the layer's transform / opacity /
// blend / crop / color grade, then calls `composite()`. JS blits the output
// buffer straight out of linear memory (`output_ptr()`) onto the program
// <canvas> — exactly the Monet Vision blit pattern.
//
// Decode + audio are platform jobs (WebCodecs / Web Audio); this engine is the
// pixel pipeline: affine transform, blend modes, Lumetri color, wipe/iris
// transitions and scopes.
// ─────────────────────────────────────────────────────────────

mod blend;
mod color;
mod scopes;

use blend::{blend_rgb, BlendMode};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// One source layer in the current frame's composite (bottom-to-top order).
#[derive(Clone)]
struct Layer {
    src: Vec<u8>, // straight-alpha RGBA8, sw*sh*4
    sw: u32,
    sh: u32,
    visible: bool,
    opacity: f32, // 0..1
    blend: BlendMode,
    // Affine placement, in the engine's (preview) pixel space:
    // out = t + R(rot) * S(scale) * (src - anchor)
    tx: f32,
    ty: f32,
    sx: f32,
    sy: f32,
    rot: f32, // radians
    ax: f32,  // anchor x, source px
    ay: f32,  // anchor y, source px
    // Normalized crop insets (0..1) from each edge of the source.
    crop_l: f32,
    crop_t: f32,
    crop_r: f32,
    crop_b: f32,
    color: Vec<f32>, // Lumetri grade params (see color.rs)
    /// Creative Look: an imported 3D LUT applied AFTER the primary grade.
    /// Persists across frames — the host re-uploads only when it changes.
    lut: Option<color::Lut3d>,
    wipe_kind: u32, // 0 none, 1 linear, 2 iris
    wipe_progress: f32,
    wipe_angle: f32, // radians (linear wipe direction)
}

impl Layer {
    fn new() -> Layer {
        Layer {
            src: Vec::new(),
            sw: 0,
            sh: 0,
            visible: true,
            opacity: 1.0,
            blend: BlendMode::Normal,
            tx: 0.0,
            ty: 0.0,
            sx: 1.0,
            sy: 1.0,
            rot: 0.0,
            ax: 0.0,
            ay: 0.0,
            crop_l: 0.0,
            crop_t: 0.0,
            crop_r: 0.0,
            crop_b: 0.0,
            color: Vec::new(),
            lut: None,
            wipe_kind: 0,
            wipe_progress: 1.0,
            wipe_angle: 0.0,
        }
    }
}

#[wasm_bindgen]
pub struct Engine {
    width: u32,
    height: u32,
    bg: [f32; 3],
    output: Vec<u8>, // RGBA8, opaque program frame
    layers: Vec<Layer>,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Engine {
        let w = width.max(1);
        let h = height.max(1);
        Engine {
            width: w,
            height: h,
            bg: [0.0, 0.0, 0.0],
            output: vec![0u8; (w * h * 4) as usize],
            layers: Vec::new(),
        }
    }

    pub fn width(&self) -> u32 {
        self.width
    }
    pub fn height(&self) -> u32 {
        self.height
    }

    /// Resize the program raster (e.g. when switching preview quality or the
    /// sequence resolution). Clears the output to background.
    pub fn resize(&mut self, width: u32, height: u32) {
        self.width = width.max(1);
        self.height = height.max(1);
        self.output = vec![0u8; (self.width * self.height * 4) as usize];
        self.fill_background();
    }

    pub fn set_background(&mut self, r: f32, g: f32, b: f32) {
        self.bg = [r.clamp(0.0, 1.0), g.clamp(0.0, 1.0), b.clamp(0.0, 1.0)];
    }

    // ── layer stack management ────────────────────────────────────
    pub fn clear_layers(&mut self) {
        self.layers.clear();
    }

    pub fn layer_count(&self) -> usize {
        self.layers.len()
    }

    /// Ensure the stack holds exactly `n` layers (reused across frames so the
    /// source buffers don't churn). New layers default to identity placement.
    pub fn set_layer_count(&mut self, n: usize) {
        if n < self.layers.len() {
            self.layers.truncate(n);
        } else {
            while self.layers.len() < n {
                self.layers.push(Layer::new());
            }
        }
    }

    /// (Re)allocate layer `idx`'s source buffer to `w*h*4` bytes and return a
    /// pointer into wasm memory for the host to write the decoded frame into.
    /// WASM memory can relocate on growth — the host must rebuild its view
    /// from `memory.buffer` after this call and before writing.
    pub fn alloc_source(&mut self, idx: usize, w: u32, h: u32) -> *mut u8 {
        if idx >= self.layers.len() {
            return std::ptr::null_mut();
        }
        let layer = &mut self.layers[idx];
        let needed = (w as usize) * (h as usize) * 4;
        if layer.src.len() != needed {
            layer.src = vec![0u8; needed];
        }
        layer.sw = w;
        layer.sh = h;
        layer.src.as_mut_ptr()
    }

    pub fn set_visible(&mut self, idx: usize, v: bool) {
        if let Some(l) = self.layers.get_mut(idx) {
            l.visible = v;
        }
    }

    pub fn set_opacity(&mut self, idx: usize, o: f32) {
        if let Some(l) = self.layers.get_mut(idx) {
            l.opacity = o.clamp(0.0, 1.0);
        }
    }

    pub fn set_blend(&mut self, idx: usize, mode: u32) {
        if let Some(l) = self.layers.get_mut(idx) {
            l.blend = BlendMode::from_index(mode);
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_transform(&mut self, idx: usize, tx: f32, ty: f32, sx: f32, sy: f32, rot: f32, ax: f32, ay: f32) {
        if let Some(l) = self.layers.get_mut(idx) {
            l.tx = tx;
            l.ty = ty;
            l.sx = if sx == 0.0 { 1e-4 } else { sx };
            l.sy = if sy == 0.0 { 1e-4 } else { sy };
            l.rot = rot;
            l.ax = ax;
            l.ay = ay;
        }
    }

    pub fn set_crop(&mut self, idx: usize, l: f32, t: f32, r: f32, b: f32) {
        if let Some(layer) = self.layers.get_mut(idx) {
            layer.crop_l = l.clamp(0.0, 1.0);
            layer.crop_t = t.clamp(0.0, 1.0);
            layer.crop_r = r.clamp(0.0, 1.0);
            layer.crop_b = b.clamp(0.0, 1.0);
        }
    }

    pub fn set_color(&mut self, idx: usize, params: &[f32]) {
        if let Some(l) = self.layers.get_mut(idx) {
            l.color = params.to_vec();
        }
    }

    /// Upload layer `idx`'s creative-Look 3D LUT (red-fastest lattice, as parsed
    /// by `@monet-ui/monet-photo`). Returns false — and leaves the layer's Look
    /// untouched — if the lattice is malformed, so the host can report it. The
    /// LUT sticks until replaced or cleared; blend strength is the grade block's
    /// `P_LUT_MIX` slot, so intensity changes cost no re-upload.
    #[allow(clippy::too_many_arguments)]
    pub fn set_lut(
        &mut self,
        idx: usize,
        size: usize,
        data: &[f32],
        dmin_r: f32,
        dmin_g: f32,
        dmin_b: f32,
        dmax_r: f32,
        dmax_g: f32,
        dmax_b: f32,
    ) -> bool {
        let Some(lut) = color::Lut3d::new(size, data, [dmin_r, dmin_g, dmin_b], [dmax_r, dmax_g, dmax_b]) else {
            return false;
        };
        match self.layers.get_mut(idx) {
            Some(l) => {
                l.lut = Some(lut);
                true
            }
            None => false,
        }
    }

    pub fn clear_lut(&mut self, idx: usize) {
        if let Some(l) = self.layers.get_mut(idx) {
            l.lut = None;
        }
    }

    pub fn set_wipe(&mut self, idx: usize, kind: u32, progress: f32, angle: f32) {
        if let Some(l) = self.layers.get_mut(idx) {
            l.wipe_kind = kind;
            l.wipe_progress = progress.clamp(0.0, 1.0);
            l.wipe_angle = angle;
        }
    }

    // ── compositing ───────────────────────────────────────────────
    fn fill_background(&mut self) {
        let (r, g, b) = (
            (self.bg[0] * 255.0) as u8,
            (self.bg[1] * 255.0) as u8,
            (self.bg[2] * 255.0) as u8,
        );
        let mut i = 0;
        while i + 3 < self.output.len() {
            self.output[i] = r;
            self.output[i + 1] = g;
            self.output[i + 2] = b;
            self.output[i + 3] = 255;
            i += 4;
        }
    }

    /// Composite the whole layer stack into the program output buffer.
    pub fn composite(&mut self) {
        self.fill_background();
        let w = self.width as i32;
        let h = self.height as i32;
        // Snapshot layers to avoid borrow conflicts during the inner loop.
        for li in 0..self.layers.len() {
            if !self.layers[li].visible || self.layers[li].opacity <= 0.0 {
                continue;
            }
            if self.layers[li].sw == 0 || self.layers[li].sh == 0 {
                continue;
            }
            self.composite_layer(li, w, h);
        }
    }

    fn composite_layer(&mut self, li: usize, w: i32, h: i32) {
        // Copy the cheap scalar params out; keep a shared ref to src pixels.
        let (sw, sh) = (self.layers[li].sw as i32, self.layers[li].sh as i32);
        let (tx, ty) = (self.layers[li].tx, self.layers[li].ty);
        let (sx, sy) = (self.layers[li].sx, self.layers[li].sy);
        let rot = self.layers[li].rot;
        let (ax, ay) = (self.layers[li].ax, self.layers[li].ay);
        let opacity = self.layers[li].opacity;
        let mode = self.layers[li].blend;
        let cl = self.layers[li].crop_l * sw as f32;
        let ct = self.layers[li].crop_t * sh as f32;
        let cr = sw as f32 - self.layers[li].crop_r * sw as f32;
        let cb = sh as f32 - self.layers[li].crop_b * sh as f32;
        let wipe_kind = self.layers[li].wipe_kind;
        let wipe_p = self.layers[li].wipe_progress;
        let wipe_a = self.layers[li].wipe_angle;
        let graded = color::grade_enabled(&self.layers[li].color);
        // The Look rides on the same enable flag as the primary grade, so
        // "Disable Grade" bypasses both. 0 mix ⇒ skip the sample entirely.
        let lut_mix = if graded && self.layers[li].lut.is_some() {
            self.layers[li].color[color::P_LUT_MIX]
        } else {
            0.0
        };

        let cosr = rot.cos();
        let sinr = rot.sin();

        for oy in 0..h {
            for ox in 0..w {
                // Inverse map output → source.
                let dx = ox as f32 + 0.5 - tx;
                let dy = oy as f32 + 0.5 - ty;
                let rx = dx * cosr + dy * sinr;
                let ry = -dx * sinr + dy * cosr;
                let fx = ax + rx / sx;
                let fy = ay + ry / sy;
                if fx < cl || fx >= cr || fy < ct || fy >= cb {
                    continue;
                }
                let (mut sr, mut sg, mut sb, mut sa) = self.sample_bilinear(li, fx, fy, sw, sh);
                if sa <= 0.0 {
                    continue;
                }
                if graded {
                    let g = color::apply_grade(&self.layers[li].color, [sr, sg, sb]);
                    sr = g[0];
                    sg = g[1];
                    sb = g[2];
                }
                if lut_mix > 0.0 {
                    if let Some(lut) = &self.layers[li].lut {
                        let g = color::apply_lut(lut, [sr, sg, sb], lut_mix);
                        sr = g[0];
                        sg = g[1];
                        sb = g[2];
                    }
                }
                let wm = wipe_factor(wipe_kind, wipe_p, wipe_a, ox, oy, w, h);
                sa *= opacity * wm;
                if sa <= 0.0 {
                    continue;
                }
                let oi = ((oy * w + ox) * 4) as usize;
                let dr = self.output[oi] as f32 / 255.0;
                let dg = self.output[oi + 1] as f32 / 255.0;
                let db = self.output[oi + 2] as f32 / 255.0;
                let blended = blend_rgb(mode, [dr, dg, db], [sr, sg, sb]);
                let inv = 1.0 - sa;
                self.output[oi] = (((dr * inv) + blended[0] * sa) * 255.0).clamp(0.0, 255.0) as u8;
                self.output[oi + 1] = (((dg * inv) + blended[1] * sa) * 255.0).clamp(0.0, 255.0) as u8;
                self.output[oi + 2] = (((db * inv) + blended[2] * sa) * 255.0).clamp(0.0, 255.0) as u8;
                self.output[oi + 3] = 255;
            }
        }
    }

    /// Bilinear sample of layer `li`'s source at (fx,fy) in source px. Returns
    /// straight (r,g,b,a) in 0..1. Neighbor texels are CLAMPED to the source
    /// edge (edge-extend), so an opaque source stays fully opaque right up to
    /// its boundary even under heavy upscaling — the clip's drawn extent is
    /// already bounded by the crop check in `composite_layer`, which is what
    /// makes pixels outside the clip transparent.
    fn sample_bilinear(&self, li: usize, fx: f32, fy: f32, sw: i32, sh: i32) -> (f32, f32, f32, f32) {
        let src = &self.layers[li].src;
        let x0 = fx.floor() as i32;
        let y0 = fy.floor() as i32;
        let tx = fx - x0 as f32;
        let ty = fy - y0 as f32;
        let mut acc = [0.0f32; 4];
        let corners = [(x0, y0, (1.0 - tx) * (1.0 - ty)), (x0 + 1, y0, tx * (1.0 - ty)), (x0, y0 + 1, (1.0 - tx) * ty), (x0 + 1, y0 + 1, tx * ty)];
        for (cx, cy, wgt) in corners {
            if wgt <= 0.0 {
                continue;
            }
            let cxx = cx.max(0).min(sw - 1);
            let cyy = cy.max(0).min(sh - 1);
            let i = ((cyy * sw + cxx) * 4) as usize;
            if i + 3 >= src.len() {
                continue;
            }
            let a = src[i + 3] as f32 / 255.0;
            // Premultiply rgb by alpha for correct edge interpolation.
            acc[0] += (src[i] as f32 / 255.0) * a * wgt;
            acc[1] += (src[i + 1] as f32 / 255.0) * a * wgt;
            acc[2] += (src[i + 2] as f32 / 255.0) * a * wgt;
            acc[3] += a * wgt;
        }
        if acc[3] <= 0.0001 {
            return (0.0, 0.0, 0.0, 0.0);
        }
        // Un-premultiply back to straight alpha.
        (acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3], acc[3].min(1.0))
    }

    pub fn output_ptr(&self) -> *const u8 {
        self.output.as_ptr()
    }

    // ── scopes ────────────────────────────────────────────────────
    pub fn histogram(&self, bins: usize) -> Vec<f32> {
        scopes::histogram(&self.output, bins)
    }
    pub fn waveform(&self, cols: usize) -> Vec<f32> {
        scopes::waveform(&self.output, self.width as usize, self.height as usize, cols)
    }
    pub fn vectorscope(&self, n: usize) -> Vec<f32> {
        scopes::vectorscope(&self.output, n)
    }

    /// A scaled RGBA8 thumbnail of the current program frame (nearest-neighbor),
    /// returned as bytes for the host to paint onto a small canvas.
    pub fn thumb(&self, tw: u32, th: u32) -> Vec<u8> {
        let tw = tw.max(1);
        let th = th.max(1);
        let mut out = vec![0u8; (tw * th * 4) as usize];
        for y in 0..th {
            let sy = (y * self.height / th).min(self.height - 1);
            for x in 0..tw {
                let sx = (x * self.width / tw).min(self.width - 1);
                let si = ((sy * self.width + sx) * 4) as usize;
                let di = ((y * tw + x) * 4) as usize;
                out[di..di + 4].copy_from_slice(&self.output[si..si + 4]);
            }
        }
        out
    }
}

/// Per-pixel reveal factor (0..1) for a wipe transition on a layer.
#[inline]
fn wipe_factor(kind: u32, progress: f32, angle: f32, ox: i32, oy: i32, w: i32, h: i32) -> f32 {
    if kind == 0 {
        return 1.0;
    }
    let nx = (ox as f32 + 0.5) / w as f32;
    let ny = (oy as f32 + 0.5) / h as f32;
    match kind {
        1 => {
            // Linear wipe along `angle`; soft 4% edge.
            let dir = (angle.cos(), angle.sin());
            let d = (nx - 0.5) * dir.0 + (ny - 0.5) * dir.1 + 0.5;
            let edge = 0.04;
            ((progress - d) / edge + 0.5).clamp(0.0, 1.0)
        }
        2 => {
            // Iris (radial) wipe from center.
            let dx = nx - 0.5;
            let dy = ny - 0.5;
            let r = (dx * dx + dy * dy).sqrt() / 0.7071;
            let edge = 0.04;
            ((progress - r) / edge + 0.5).clamp(0.0, 1.0)
        }
        _ => 1.0,
    }
}
