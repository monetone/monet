// ─────────────────────────────────────────────────────────────
// Selection — a per-pixel coverage mask (0..255). When `active` is
// false the whole document is considered selected and ops apply
// everywhere. Supports marquee (rect/ellipse), select-all/none/invert,
// and a flood-fill magic wand.
// ─────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SelMode {
    Replace,
    Add,
    Subtract,
    Intersect,
}

impl SelMode {
    pub fn from_u8(v: u8) -> SelMode {
        match v {
            1 => SelMode::Add,
            2 => SelMode::Subtract,
            3 => SelMode::Intersect,
            _ => SelMode::Replace,
        }
    }
}

pub struct Selection {
    pub w: u32,
    pub h: u32,
    pub active: bool,
    pub mask: Vec<u8>,
    // Anti-alias the marquee/lasso edge (Photoshop's "Anti-alias" option). When
    // on, boundary pixels get fractional coverage for a smooth edge; off gives a
    // hard 1-bit edge. Default on, matching Photoshop's elliptical-marquee default.
    pub antialias: bool,
}

impl Selection {
    pub fn new(w: u32, h: u32) -> Self {
        Selection {
            w,
            h,
            active: false,
            mask: vec![0u8; (w * h) as usize],
            antialias: true,
        }
    }

    pub fn resize(&mut self, w: u32, h: u32) {
        self.w = w;
        self.h = h;
        self.mask = vec![0u8; (w * h) as usize];
        self.active = false;
    }

    #[inline]
    pub fn coverage(&self, i: usize) -> f32 {
        if !self.active {
            1.0
        } else {
            self.mask[i] as f32 / 255.0
        }
    }

    pub fn select_all(&mut self) {
        self.active = false;
        for v in self.mask.iter_mut() {
            *v = 255;
        }
    }

    pub fn deselect(&mut self) {
        self.active = false;
        for v in self.mask.iter_mut() {
            *v = 0;
        }
    }

    pub fn invert(&mut self) {
        if !self.active {
            // everything was selected -> nothing selected
            self.active = true;
            for v in self.mask.iter_mut() {
                *v = 0;
            }
            return;
        }
        for v in self.mask.iter_mut() {
            *v = 255 - *v;
        }
    }

    // Replace the coverage mask wholesale (e.g. from an ML segmentation
    // such as Select Subject). Length must match the document.
    pub fn set_mask(&mut self, src: &[u8]) {
        if src.len() != self.mask.len() {
            return;
        }
        self.active = true;
        self.mask.copy_from_slice(src);
    }

    // Write a binary matched grid (one bool per document pixel) into the mask
    // under `mode`. With Anti-alias on the boundary gets a 1px soft edge — each
    // pixel's coverage is the fraction of its 3×3 neighbourhood that matched —
    // smoothing a flood's jagged boundary. Shared by every flood-style tool
    // (Magic Wand, Object Selection).
    pub fn apply_matched(&mut self, matched: &[bool], mode: SelMode) {
        if matched.len() != self.mask.len() {
            return;
        }
        self.begin(mode);
        let w = self.w as i32;
        let h = self.h as i32;
        if self.antialias {
            for y in 0..h {
                for x in 0..w {
                    let (mut cnt, mut tot) = (0i32, 0i32);
                    for dy in -1..=1 {
                        for dx in -1..=1 {
                            let (nx, ny) = (x + dx, y + dy);
                            if nx >= 0 && ny >= 0 && nx < w && ny < h {
                                tot += 1;
                                if matched[(ny * w + nx) as usize] {
                                    cnt += 1;
                                }
                            }
                        }
                    }
                    let cov = (cnt * 255 / tot) as u8;
                    if cov > 0 || mode == SelMode::Intersect {
                        self.combine((y * w + x) as usize, cov, mode);
                    }
                }
            }
        } else {
            for i in 0..(w * h) as usize {
                if matched[i] {
                    self.combine(i, 255, mode);
                } else if mode == SelMode::Intersect {
                    self.combine(i, 0, mode);
                }
            }
        }
    }

    // Combine a freshly-rasterized coverage value into the mask per mode.
    fn combine(&mut self, i: usize, cov: u8, mode: SelMode) {
        let cur = self.mask[i];
        self.mask[i] = match mode {
            SelMode::Replace => cov,
            SelMode::Add => cur.max(cov),
            SelMode::Subtract => cur.saturating_sub(cov),
            SelMode::Intersect => cur.min(cov),
        };
    }

    fn begin(&mut self, mode: SelMode) {
        if mode == SelMode::Replace {
            for v in self.mask.iter_mut() {
                *v = 0;
            }
        }
        self.active = true;
    }

    pub fn rect(&mut self, x: i32, y: i32, w: i32, h: i32, mode: SelMode) {
        self.begin(mode);
        let x0 = x.max(0);
        let y0 = y.max(0);
        let x1 = (x + w).min(self.w as i32);
        let y1 = (y + h).min(self.h as i32);
        // For intersect we must zero outside the rect; handle by building coverage row-wise.
        if mode == SelMode::Intersect {
            for yy in 0..self.h as i32 {
                for xx in 0..self.w as i32 {
                    let inside = xx >= x0 && xx < x1 && yy >= y0 && yy < y1;
                    let i = (yy as u32 * self.w + xx as u32) as usize;
                    let cov = if inside { 255 } else { 0 };
                    self.combine(i, cov, mode);
                }
            }
            return;
        }
        for yy in y0..y1 {
            for xx in x0..x1 {
                let i = (yy as u32 * self.w + xx as u32) as usize;
                self.combine(i, 255, mode);
            }
        }
    }

    pub fn ellipse(&mut self, x: i32, y: i32, w: i32, h: i32, mode: SelMode) {
        self.begin(mode);
        let cx = x as f32 + w as f32 / 2.0;
        let cy = y as f32 + h as f32 / 2.0;
        let rx = (w as f32 / 2.0).max(0.5);
        let ry = (h as f32 / 2.0).max(0.5);
        let aa = self.antialias;
        for yy in 0..self.h as i32 {
            for xx in 0..self.w as i32 {
                let nx = (xx as f32 + 0.5 - cx) / rx;
                let ny = (yy as f32 + 0.5 - cy) / ry;
                let d = nx * nx + ny * ny;
                let cov = if aa {
                    // Smooth edge: convert the implicit value (d=1 on the boundary)
                    // to a signed pixel distance via the local gradient magnitude
                    // and ramp coverage 0..1 over the ~1px band straddling the edge.
                    let grad = 2.0 * ((nx / rx).powi(2) + (ny / ry).powi(2)).sqrt();
                    if grad < 1e-6 {
                        if d <= 1.0 {
                            255u8
                        } else {
                            0u8
                        } // centre / degenerate
                    } else {
                        let signed = (1.0 - d) / grad; // pixels inside (+) the boundary
                        ((signed + 0.5).clamp(0.0, 1.0) * 255.0).round() as u8
                    }
                } else if d <= 1.0 {
                    255u8
                } else {
                    0u8
                };
                let i = (yy as u32 * self.w + xx as u32) as usize;
                if mode == SelMode::Intersect {
                    self.combine(i, cov, mode);
                } else if cov > 0 {
                    self.combine(i, cov, mode);
                }
            }
        }
    }

    // Magic wand: flood from (sx,sy) selecting pixels within `tol` (0..1) of the
    // seed color. If `contiguous`, only the connected region; otherwise global.
    pub fn magic_wand(
        &mut self,
        pixels: &[u8],
        sx: i32,
        sy: i32,
        tol: f32,
        contiguous: bool,
        mode: SelMode,
    ) {
        if sx < 0 || sy < 0 || sx >= self.w as i32 || sy >= self.h as i32 {
            return;
        }
        let w = self.w as i32;
        let h = self.h as i32;
        let seed_i = (sy * w + sx) as usize * 4;
        let sr = pixels[seed_i] as f32;
        let sg = pixels[seed_i + 1] as f32;
        let sb = pixels[seed_i + 2] as f32;
        let sa = pixels[seed_i + 3] as f32;
        let t = tol * 255.0;
        let matches = |i: usize| -> bool {
            let p = i * 4;
            (pixels[p] as f32 - sr).abs() <= t
                && (pixels[p + 1] as f32 - sg).abs() <= t
                && (pixels[p + 2] as f32 - sb).abs() <= t
                && (pixels[p + 3] as f32 - sa).abs() <= t
        };

        // Build the binary matched grid (global scan or contiguous flood)…
        let mut matched = vec![false; (w * h) as usize];
        if !contiguous {
            for i in 0..(w * h) as usize {
                matched[i] = matches(i);
            }
        } else {
            let mut stack = vec![(sx, sy)];
            let mut seen = vec![false; (w * h) as usize];
            seen[(sy * w + sx) as usize] = true;
            while let Some((cx, cy)) = stack.pop() {
                let i = (cy * w + cx) as usize;
                if !matches(i) {
                    continue;
                }
                matched[i] = true;
                for (nx, ny) in [(cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)] {
                    if nx >= 0 && ny >= 0 && nx < w && ny < h {
                        let ni = (ny * w + nx) as usize;
                        if !seen[ni] {
                            seen[ni] = true;
                            stack.push((nx, ny));
                        }
                    }
                }
            }
        }

        // …then write it into the mask under the combine mode + Anti-alias.
        self.apply_matched(&matched, mode);
    }

    // Quick Selection: a brush-drag region grow. Each dab floods outward from the
    // cursor (contiguous, within `radius` px) to pixels matching the colour under
    // the cursor within `tol`, combining into the mask with `mode`. Dragging unions
    // successive dabs (the caller passes Add after the first). Anti-alias softens
    // the flooded boundary just like the Magic Wand.
    pub fn quick_selection_paint(
        &mut self,
        pixels: &[u8],
        cx: i32,
        cy: i32,
        radius: i32,
        tol: f32,
        mode: SelMode,
    ) {
        let w = self.w as i32;
        let h = self.h as i32;
        if cx < 0 || cy < 0 || cx >= w || cy >= h {
            return;
        }
        self.begin(mode);
        let seed_i = (cy * w + cx) as usize * 4;
        let (sr, sg, sb) = (
            pixels[seed_i] as f32,
            pixels[seed_i + 1] as f32,
            pixels[seed_i + 2] as f32,
        );
        let t = tol * 255.0;
        let matches = |i: usize| -> bool {
            let p = i * 4;
            (pixels[p] as f32 - sr).abs() <= t
                && (pixels[p + 1] as f32 - sg).abs() <= t
                && (pixels[p + 2] as f32 - sb).abs() <= t
        };
        // Contiguous flood from the cursor, bounded to a disc of `radius`.
        let reach2 = (radius as i64) * (radius as i64);
        let mut matched = vec![false; (w * h) as usize];
        let mut seen = vec![false; (w * h) as usize];
        let mut stack = vec![(cx, cy)];
        seen[(cy * w + cx) as usize] = true;
        while let Some((x, y)) = stack.pop() {
            let (ddx, ddy) = ((x - cx) as i64, (y - cy) as i64);
            if ddx * ddx + ddy * ddy > reach2 {
                continue;
            }
            let i = (y * w + x) as usize;
            if !matches(i) {
                continue;
            }
            matched[i] = true;
            for (nx, ny) in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)] {
                if nx >= 0 && ny >= 0 && nx < w && ny < h {
                    let ni = (ny * w + nx) as usize;
                    if !seen[ni] {
                        seen[ni] = true;
                        stack.push((nx, ny));
                    }
                }
            }
        }
        if self.antialias {
            for y in 0..h {
                for x in 0..w {
                    let (mut cnt, mut tot) = (0i32, 0i32);
                    for dy in -1..=1 {
                        for dx in -1..=1 {
                            let (nx, ny) = (x + dx, y + dy);
                            if nx >= 0 && ny >= 0 && nx < w && ny < h {
                                tot += 1;
                                if matched[(ny * w + nx) as usize] {
                                    cnt += 1;
                                }
                            }
                        }
                    }
                    let cov = (cnt * 255 / tot) as u8;
                    if cov > 0 || mode == SelMode::Intersect {
                        self.combine((y * w + x) as usize, cov, mode);
                    }
                }
            }
        } else {
            for i in 0..(w * h) as usize {
                if matched[i] {
                    self.combine(i, 255, mode);
                } else if mode == SelMode::Intersect {
                    self.combine(i, 0, mode);
                }
            }
        }
    }

    /// Quick Selection ▸ Auto-Enhance: re-matte just the dab's neighbourhood with
    /// the Refine Edge guided filter, so the stroke's flood boundary snaps to
    /// image structure instead of keeping the wand's jagged staircase. Scoped to a
    /// disc around the dab — the rest of the selection is left alone.
    pub fn auto_enhance_dab(&mut self, guide: &[u8], cx: i32, cy: i32, radius: i32) {
        if !self.active {
            return;
        }
        let w = self.w as i32;
        let h = self.h as i32;
        // A little wider than the brush so the dab's own boundary sits inside it.
        let r = radius.max(1) + 2;
        let r2 = (r as i64) * (r as i64);
        let mut region = vec![0u8; (w * h) as usize];
        for y in (cy - r).max(0)..=(cy + r).min(h - 1) {
            for x in (cx - r).max(0)..=(cx + r).min(w - 1) {
                let (dx, dy) = ((x - cx) as i64, (y - cy) as i64);
                if dx * dx + dy * dy <= r2 {
                    region[(y * w + x) as usize] = 255;
                }
            }
        }
        // ponytail: rides Refine Edge's brush-only path, so the matting window is
        // its fixed 5×5 and the guided filter still runs over the whole doc per
        // dab. Enough to kill flood staircasing; thread a window size + a bbox
        // through refine_edge if wide hair mattes or big-doc stroke latency bite.
        self.refine_edge(guide, 0, false, Some(&region));
    }

    // Magnetic Lasso: snap each freehand point to the strongest luma-gradient
    // edge within `edge_radius` (so the path clings to high-contrast boundaries),
    // then rasterize the snapped polygon. Points whose neighbourhood has no edge
    // above `threshold` keep their raw position. `threshold` 0..1 → gradient/255.
    pub fn magnetic_lasso_apply(
        &mut self,
        pixels: &[u8],
        xs: &[f32],
        ys: &[f32],
        edge_radius: i32,
        threshold: f32,
        mode: SelMode,
    ) {
        let n = xs.len().min(ys.len());
        if n < 3 {
            return;
        }
        let w = self.w as i32;
        let h = self.h as i32;
        let lum = |x: i32, y: i32| -> f32 {
            let xc = x.clamp(0, w - 1);
            let yc = y.clamp(0, h - 1);
            let p = (yc * w + xc) as usize * 4;
            0.299 * pixels[p] as f32 + 0.587 * pixels[p + 1] as f32 + 0.114 * pixels[p + 2] as f32
        };
        let grad = |x: i32, y: i32| -> f32 {
            let gx = lum(x + 1, y) - lum(x - 1, y);
            let gy = lum(x, y + 1) - lum(x, y - 1);
            (gx * gx + gy * gy).sqrt()
        };
        let thr = threshold * 255.0;
        let r = edge_radius.max(0);
        let rf = r as f32 + 1.0;
        let mut sxs = Vec::with_capacity(n);
        let mut sys = Vec::with_capacity(n);
        for k in 0..n {
            let px = xs[k].round() as i32;
            let py = ys[k].round() as i32;
            // Prefer strong edges, but weight each candidate by closeness to the
            // drawn point, so a far unrelated edge can't capture the path (a plain
            // global-max search pulls interior points sideways onto stronger edges).
            let center_g = grad(px, py);
            let (mut best_score, mut best_g, mut bx, mut by) = (center_g, center_g, px, py);
            for dy in -r..=r {
                for dx in -r..=r {
                    let (nx, ny) = (px + dx, py + dy);
                    if nx < 0 || ny < 0 || nx >= w || ny >= h {
                        continue;
                    }
                    let g = grad(nx, ny);
                    let dist = (((dx * dx + dy * dy) as f32).sqrt() / rf).min(1.0);
                    let score = g * (1.0 - dist);
                    if score > best_score {
                        best_score = score;
                        best_g = g;
                        bx = nx;
                        by = ny;
                    }
                }
            }
            if best_g >= thr {
                sxs.push(bx as f32);
                sys.push(by as f32);
            } else {
                sxs.push(px as f32);
                sys.push(py as f32);
            }
        }
        self.polygon(&sxs, &sys, mode);
    }

    // Type Mask: build a selection from a rasterized alpha buffer (e.g. anti-
    // aliased glyphs) placed at (px,py). Coverage = the alpha value, so the
    // selection inherits the glyph anti-aliasing. Combined via `mode`.
    pub fn from_alpha(&mut self, px: i32, py: i32, aw: i32, ah: i32, alpha: &[u8], mode: SelMode) {
        self.begin(mode);
        let w = self.w as i32;
        let h = self.h as i32;
        for y in 0..ah {
            let dy = py + y;
            if dy < 0 || dy >= h {
                continue;
            }
            for x in 0..aw {
                let dx = px + x;
                if dx < 0 || dx >= w {
                    continue;
                }
                let a = alpha[(y * aw + x) as usize];
                if a > 0 || mode == SelMode::Intersect {
                    self.combine((dy * w + dx) as usize, a, mode);
                }
            }
        }
    }

    // Select ▸ Color Range: select pixels by similarity to a sampled colour,
    // with a soft *partial* coverage falloff set by `fuzziness` (0..200). Unlike
    // the magic wand this scans the whole image (non-contiguous) and writes a
    // graded mask — pixels closer to the target are more fully selected.
    pub fn color_range(&mut self, pixels: &[u8], target: [u8; 3], fuzziness: f32, mode: SelMode) {
        self.begin(mode);
        let (tr, tg, tb) = (
            target[0] as f32 / 255.0,
            target[1] as f32 / 255.0,
            target[2] as f32 / 255.0,
        );
        // Falloff radius in RGB space (max possible distance is √3); fuzziness
        // 200 reaches the whole colour space, 0 selects only the exact colour.
        let radius = (fuzziness / 200.0 * 3.0_f32.sqrt()).max(1e-3);
        for i in 0..(self.w * self.h) as usize {
            let p = i * 4;
            let r = pixels[p] as f32 / 255.0;
            let g = pixels[p + 1] as f32 / 255.0;
            let b = pixels[p + 2] as f32 / 255.0;
            let dist = ((r - tr).powi(2) + (g - tg).powi(2) + (b - tb).powi(2)).sqrt();
            let cov = ((1.0 - dist / radius).clamp(0.0, 1.0) * 255.0).round() as u8;
            if cov > 0 || mode == SelMode::Intersect {
                self.combine(i, cov, mode);
            }
        }
    }

    /// Color Range ▸ Highlights / Midtones / Shadows. Photoshop grades these by
    /// luminance rather than by colour distance, so they cannot be faked with an
    /// RGB cluster. `kind` 0 shadows / 1 midtones / 2 highlights; `range` 0..1 is
    /// the dialog's Range slider — how far from the band's centre still counts.
    /// Rec.601 luma, matching every other tonal read in the engine.
    pub fn tonal_range(&mut self, pixels: &[u8], kind: u8, range: f32, mode: SelMode) {
        self.begin(mode);
        let range = range.clamp(0.02, 1.0);
        for i in 0..(self.w * self.h) as usize {
            let p = i * 4;
            let l = (0.299 * pixels[p] as f32
                + 0.587 * pixels[p + 1] as f32
                + 0.114 * pixels[p + 2] as f32)
                / 255.0;
            // Shadows and highlights are one-sided ramps from the ends; midtones
            // is a symmetric tent about 0.5. All reach full coverage at the band
            // centre and fall linearly to nothing at `range`.
            let cov = match kind {
                0 => 1.0 - (l / range),
                2 => 1.0 - ((1.0 - l) / range),
                _ => 1.0 - ((l - 0.5).abs() / range),
            };
            let cov = (cov.clamp(0.0, 1.0) * 255.0).round() as u8;
            if cov > 0 || mode == SelMode::Intersect {
                self.combine(i, cov, mode);
            }
        }
    }

    /// Color Range ▸ Localized Color Clusters: fade a colour match out by how far
    /// the pixel sits from the sampled point, so the same colour elsewhere in the
    /// frame is left alone. `cx`/`cy` are the sample's document pixel; `radius` is
    /// the dialog's Range slider in pixels (0 = off, no spatial limit).
    pub fn color_range_localized(
        &mut self,
        pixels: &[u8],
        target: [u8; 3],
        fuzziness: f32,
        cx: f32,
        cy: f32,
        radius: f32,
        mode: SelMode,
    ) {
        if radius <= 0.0 {
            self.color_range(pixels, target, fuzziness, mode);
            return;
        }
        self.begin(mode);
        let (tr, tg, tb) = (
            target[0] as f32 / 255.0,
            target[1] as f32 / 255.0,
            target[2] as f32 / 255.0,
        );
        let colour_radius = (fuzziness / 200.0 * 3.0_f32.sqrt()).max(1e-3);
        for i in 0..(self.w * self.h) as usize {
            let p = i * 4;
            let r = pixels[p] as f32 / 255.0;
            let g = pixels[p + 1] as f32 / 255.0;
            let b = pixels[p + 2] as f32 / 255.0;
            let dist = ((r - tr).powi(2) + (g - tg).powi(2) + (b - tb).powi(2)).sqrt();
            let colour = (1.0 - dist / colour_radius).clamp(0.0, 1.0);
            let x = (i as u32 % self.w) as f32;
            let y = (i as u32 / self.w) as f32;
            let spatial = (1.0 - (x - cx).hypot(y - cy) / radius).clamp(0.0, 1.0);
            let cov = ((colour * spatial) * 255.0).round() as u8;
            if cov > 0 || mode == SelMode::Intersect {
                self.combine(i, cov, mode);
            }
        }
    }

    // Select ▸ Load Selection: bring a saved coverage mask back into the active
    // selection, combining with whatever is currently selected per `mode`
    // (Replace / Add / Subtract / Intersect).
    pub fn apply_saved(&mut self, mask: &[u8], mode: SelMode) {
        if mask.len() != self.mask.len() {
            return;
        }
        self.begin(mode);
        for i in 0..self.mask.len() {
            let cov = mask[i];
            if cov > 0 || mode == SelMode::Intersect {
                self.combine(i, cov, mode);
            }
        }
    }

    // Freehand / polygon selection via even-odd scanline fill.
    pub fn polygon(&mut self, xs: &[f32], ys: &[f32], mode: SelMode) {
        let n = xs.len();
        if n < 3 || ys.len() != n {
            return;
        }
        self.begin(mode);

        // Anti-aliased path: supersample each pixel in the polygon's bounding box
        // and use the fraction of sub-samples inside as coverage, for a smooth edge
        // (Photoshop's lasso "Anti-alias"). Only edge pixels end up fractional.
        if self.antialias {
            const SS: i32 = 4; // 4×4 sub-samples per pixel
            let (mut minx, mut miny, mut maxx, mut maxy) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
            for i in 0..n {
                minx = minx.min(xs[i]);
                maxx = maxx.max(xs[i]);
                miny = miny.min(ys[i]);
                maxy = maxy.max(ys[i]);
            }
            let bx0 = (minx.floor() as i32).max(0);
            let by0 = (miny.floor() as i32).max(0);
            let bx1 = (maxx.ceil() as i32).min(self.w as i32 - 1);
            let by1 = (maxy.ceil() as i32).min(self.h as i32 - 1);
            for y in 0..self.h as i32 {
                let in_band = y >= by0 && y <= by1;
                for x in 0..self.w as i32 {
                    let inside_bbox = in_band && x >= bx0 && x <= bx1;
                    let cov = if inside_bbox {
                        let mut hits = 0i32;
                        for sy in 0..SS {
                            let py = y as f32 + (sy as f32 + 0.5) / SS as f32;
                            for sx in 0..SS {
                                let px = x as f32 + (sx as f32 + 0.5) / SS as f32;
                                if point_in_poly(px, py, xs, ys) {
                                    hits += 1;
                                }
                            }
                        }
                        (hits * 255 / (SS * SS)) as u8
                    } else {
                        0
                    };
                    // Intersect must touch every pixel (min with 0 outside); the
                    // other modes only need the covered ones.
                    if cov > 0 || mode == SelMode::Intersect {
                        let idx = (y * self.w as i32 + x) as usize;
                        self.combine(idx, cov, mode);
                    }
                }
            }
            return;
        }

        // Rasterize the row into an explicit coverage line first: Intersect has to
        // touch every pixel (min with 0 outside the spans), and combining only the
        // covered ones left the mask byte-identical — a silent no-op. (#52)
        let mut row = vec![0u8; self.w as usize];
        for y in 0..self.h as i32 {
            row.iter_mut().for_each(|v| *v = 0);
            let yc = y as f32 + 0.5;
            let mut xints: Vec<f32> = Vec::new();
            let mut j = n - 1;
            for i in 0..n {
                let (yi, yj) = (ys[i], ys[j]);
                if (yi <= yc && yj > yc) || (yj <= yc && yi > yc) {
                    let t = (yc - yi) / (yj - yi);
                    xints.push(xs[i] + t * (xs[j] - xs[i]));
                }
                j = i;
            }
            xints.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let mut k = 0;
            while k + 1 < xints.len() {
                let x0 = xints[k].ceil().max(0.0) as i32;
                let x1 = xints[k + 1].floor().min(self.w as f32 - 1.0) as i32;
                for x in x0..=x1 {
                    row[x as usize] = 255;
                }
                k += 2;
            }
            for x in 0..self.w as i32 {
                let cov = row[x as usize];
                if cov > 0 || mode == SelMode::Intersect {
                    let idx = (y * self.w as i32 + x) as usize;
                    self.combine(idx, cov, mode);
                }
            }
        }
    }

    // Tight bounds of the active selection: [x, y, w, h]; empty -> [0,0,0,0].
    pub fn bounds(&self) -> [i32; 4] {
        if !self.active {
            return [0, 0, self.w as i32, self.h as i32];
        }
        let (mut minx, mut miny, mut maxx, mut maxy) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
        for y in 0..self.h as i32 {
            for x in 0..self.w as i32 {
                if self.mask[(y * self.w as i32 + x) as usize] > 0 {
                    minx = minx.min(x);
                    miny = miny.min(y);
                    maxx = maxx.max(x);
                    maxy = maxy.max(y);
                }
            }
        }
        if minx > maxx {
            return [0, 0, 0, 0];
        }
        [minx, miny, maxx - minx + 1, maxy - miny + 1]
    }

    // Grow (n > 0) or shrink (n < 0) the active selection by |n| pixels, with a
    // circular (Euclidean) kernel — Photoshop's Select ▸ Modify ▸ Expand /
    // Contract. Treats the mask as binary (>= 128) and writes a hard result.
    pub fn morph(&mut self, n: i32) {
        if !self.active || n == 0 {
            return;
        }
        let w = self.w as i32;
        let h = self.h as i32;
        let cur: Vec<bool> = self.mask.iter().map(|&v| v >= 128).collect();
        let r = n.abs();
        let r2 = (r * r) as i64;
        let mut out = vec![0u8; self.mask.len()];
        for y in 0..h {
            for x in 0..w {
                // expand: ANY selected pixel within the radius → select.
                // contract: ANY unselected pixel within the radius → deselect.
                let mut sel = n < 0;
                'scan: for dy in -r..=r {
                    for dx in -r..=r {
                        if (dx * dx + dy * dy) as i64 > r2 {
                            continue;
                        }
                        let (nx, ny) = (x + dx, y + dy);
                        let s =
                            nx >= 0 && ny >= 0 && nx < w && ny < h && cur[(ny * w + nx) as usize];
                        if n > 0 && s {
                            sel = true;
                            break 'scan;
                        }
                        if n < 0 && !s {
                            sel = false;
                            break 'scan;
                        }
                    }
                }
                out[(y * w + x) as usize] = if sel { 255 } else { 0 };
            }
        }
        self.mask = out;
    }

    // Feather the selection edge by `radius` pixels — a separable Gaussian blur of
    // the coverage mask (Photoshop's Select ▸ Modify ▸ Feather), turning a hard
    // edge into a soft transition band.
    pub fn feather(&mut self, radius: f32) {
        if !self.active || radius < 0.5 {
            return;
        }
        let w = self.w as i32;
        let h = self.h as i32;
        let sigma = radius;
        let kr = (sigma * 2.5).ceil() as i32;
        // normalised 1D Gaussian kernel
        let mut kernel = vec![0f32; (2 * kr + 1) as usize];
        let mut sum = 0.0;
        for i in -kr..=kr {
            let v = (-((i * i) as f32) / (2.0 * sigma * sigma)).exp();
            kernel[(i + kr) as usize] = v;
            sum += v;
        }
        for v in kernel.iter_mut() {
            *v /= sum;
        }
        let src: Vec<f32> = self.mask.iter().map(|&v| v as f32).collect();
        // horizontal pass (edge-clamped)
        let mut tmp = vec![0f32; (w * h) as usize];
        for y in 0..h {
            for x in 0..w {
                let mut acc = 0.0;
                for i in -kr..=kr {
                    let sx = (x + i).clamp(0, w - 1);
                    acc += src[(y * w + sx) as usize] * kernel[(i + kr) as usize];
                }
                tmp[(y * w + x) as usize] = acc;
            }
        }
        // vertical pass
        for y in 0..h {
            for x in 0..w {
                let mut acc = 0.0;
                for i in -kr..=kr {
                    let sy = (y + i).clamp(0, h - 1);
                    acc += tmp[(sy * w + x) as usize] * kernel[(i + kr) as usize];
                }
                self.mask[(y * w + x) as usize] = acc.round().clamp(0.0, 255.0) as u8;
            }
        }
    }

    // Replace the selection with a band straddling its current edge (Photoshop's
    // Select ▸ Modify ▸ Border). A pixel joins the band when, within radius `n`,
    // there is BOTH a selected and an unselected pixel — i.e. it sits within `n`
    // of the boundary. The interior and far exterior become deselected.
    pub fn border(&mut self, n: i32) {
        if !self.active || n <= 0 {
            return;
        }
        let w = self.w as i32;
        let h = self.h as i32;
        let cur: Vec<bool> = self.mask.iter().map(|&v| v >= 128).collect();
        let r2 = (n * n) as i64;
        let mut out = vec![0u8; self.mask.len()];
        for y in 0..h {
            for x in 0..w {
                let (mut has_sel, mut has_unsel) = (false, false);
                'scan: for dy in -n..=n {
                    for dx in -n..=n {
                        if (dx * dx + dy * dy) as i64 > r2 {
                            continue;
                        }
                        let (nx, ny) = (x + dx, y + dy);
                        let s =
                            nx >= 0 && ny >= 0 && nx < w && ny < h && cur[(ny * w + nx) as usize];
                        if s {
                            has_sel = true;
                        } else {
                            has_unsel = true;
                        }
                        if has_sel && has_unsel {
                            break 'scan;
                        }
                    }
                }
                out[(y * w + x) as usize] = if has_sel && has_unsel { 255 } else { 0 };
            }
        }
        self.mask = out;
    }

    // Round off corners and spikes (Photoshop's Select ▸ Modify ▸ Smooth). A
    // majority filter over a circular `radius`: a pixel is selected when more than
    // half of the in-bounds neighbours within the radius are selected — rounding
    // sharp corners, filling pinholes and removing isolated specks.
    pub fn smooth(&mut self, radius: i32) {
        if !self.active || radius <= 0 {
            return;
        }
        let w = self.w as i32;
        let h = self.h as i32;
        let cur: Vec<bool> = self.mask.iter().map(|&v| v >= 128).collect();
        let r2 = (radius * radius) as i64;
        let mut out = vec![0u8; self.mask.len()];
        for y in 0..h {
            for x in 0..w {
                let (mut sel, mut tot) = (0i32, 0i32);
                for dy in -radius..=radius {
                    for dx in -radius..=radius {
                        if (dx * dx + dy * dy) as i64 > r2 {
                            continue;
                        }
                        let (nx, ny) = (x + dx, y + dy);
                        if nx >= 0 && ny >= 0 && nx < w && ny < h {
                            tot += 1;
                            if cur[(ny * w + nx) as usize] {
                                sel += 1;
                            }
                        }
                    }
                }
                out[(y * w + x) as usize] = if sel * 2 > tot { 255 } else { 0 };
            }
        }
        self.mask = out;
    }

    // Select and Mask ▸ Contrast: steepen the coverage transition around 50%,
    // pulling a soft matte toward a crisp edge (`amount` 0..1, 1 ≈ near-binary).
    pub fn contrast(&mut self, amount: f32) {
        if !self.active || amount <= 0.0 {
            return;
        }
        let k = 1.0 + amount.min(1.0) * 9.0;
        for v in self.mask.iter_mut() {
            let c = (*v as f32 / 255.0 - 0.5) * k + 0.5;
            *v = (c.clamp(0.0, 1.0) * 255.0).round() as u8;
        }
    }

    /// Refine the selection edge with a guided-filter matte (Photoshop's Refine
    /// Edge "Radius"): re-estimate coverage in the transition band using the
    /// composite `guide` (RGBA8) as edge-aware guidance, so soft/hairy edges gain
    /// partial coverage that snaps to image structure. Solid interior/exterior
    /// (outside the band) is left crisp so refine never erodes clean regions.
    /// `radius` = band / guided-filter window half-width in px. `region` is the
    /// Refine Edge Brush's painted coverage (doc-sized): those pixels are matted
    /// even outside the global band, and radius 0 = brush-only refine. `smart` =
    /// Smart Radius: the full-width band applies only where the guide is
    /// textured, so hair/fur refines wide while clean hard edges stay crisp.
    pub fn refine_edge(&mut self, guide: &[u8], radius: i32, smart: bool, region: Option<&[u8]>) {
        let w = self.w as i32;
        let h = self.h as i32;
        let n = (w * h) as usize;
        let region = region.filter(|m| m.len() == n);
        if !self.active || (radius <= 0 && region.is_none()) {
            return;
        }
        if guide.len() != n * 4 {
            return;
        }
        // Brush-only refine (radius 0) still needs a matting window.
        let r = radius.max(2);
        // Separable O(N) box sum with zero padding; mean = sum / sum(ones), which
        // makes border windows exact (He et al.'s guided-filter box trick).
        fn box_sum(src: &[f32], w: i32, h: i32, r: i32) -> Vec<f32> {
            let n = (w * h) as usize;
            let mut tmp = vec![0f32; n];
            for y in 0..h {
                let base = (y * w) as usize;
                let mut pref = vec![0f32; (w + 1) as usize];
                for x in 0..w {
                    pref[(x + 1) as usize] = pref[x as usize] + src[base + x as usize];
                }
                for x in 0..w {
                    let x0 = (x - r).max(0);
                    let x1 = (x + r + 1).min(w);
                    tmp[base + x as usize] = pref[x1 as usize] - pref[x0 as usize];
                }
            }
            let mut out = vec![0f32; n];
            for x in 0..w {
                let mut pref = vec![0f32; (h + 1) as usize];
                for y in 0..h {
                    pref[(y + 1) as usize] = pref[y as usize] + tmp[(y * w + x) as usize];
                }
                for y in 0..h {
                    let y0 = (y - r).max(0);
                    let y1 = (y + r + 1).min(h);
                    out[(y * w + x) as usize] = pref[y1 as usize] - pref[y0 as usize];
                }
            }
            out
        }

        // Guidance I = luminance (Rec.601) 0..1; input p = current coverage 0..1.
        let lum: Vec<f32> = (0..n)
            .map(|i| {
                let p = i * 4;
                (0.299 * guide[p] as f32
                    + 0.587 * guide[p + 1] as f32
                    + 0.114 * guide[p + 2] as f32)
                    / 255.0
            })
            .collect();
        let cov: Vec<f32> = self.mask.iter().map(|&v| v as f32 / 255.0).collect();

        let ones = vec![1f32; n];
        let cnt = box_sum(&ones, w, h, r);
        let mean = |src: &[f32]| -> Vec<f32> {
            let s = box_sum(src, w, h, r);
            s.iter().zip(&cnt).map(|(a, c)| a / c).collect()
        };
        let mean_i = mean(&lum);
        let mean_p = mean(&cov);
        let ip: Vec<f32> = lum.iter().zip(&cov).map(|(a, b)| a * b).collect();
        let mean_ip = mean(&ip);
        let ii: Vec<f32> = lum.iter().map(|a| a * a).collect();
        let mean_ii = mean(&ii);

        // eps regularises flat regions; small so the matte sticks to real edges.
        let eps = 1e-4f32;
        let mut a = vec![0f32; n];
        let mut b = vec![0f32; n];
        let mut edge_var = vec![0f32; n];
        for i in 0..n {
            let var = mean_ii[i] - mean_i[i] * mean_i[i];
            let cov_ip = mean_ip[i] - mean_i[i] * mean_p[i];
            a[i] = cov_ip / (var + eps);
            b[i] = mean_p[i] - a[i] * mean_i[i];
            edge_var[i] = var;
        }
        let mean_a = mean(&a);
        let mean_b = mean(&b);

        // Smart Radius: a second, narrow band (quarter window) that always
        // refines; the full-width band adds only guide-textured areas.
        // ponytail: two-level adaptive band, not a true per-pixel radius — keeps
        // hard edges crisp; re-run the filter per level if that's not enough.
        let mean_p_narrow: Vec<f32> = if smart && radius > 0 {
            let rn = (r / 4).max(1);
            let cn = box_sum(&ones, w, h, rn);
            box_sum(&cov, w, h, rn)
                .iter()
                .zip(&cn)
                .map(|(s, c)| s / c)
                .collect()
        } else {
            Vec::new()
        };

        // Rewrite eligibility: the global Radius covers the transition band
        // (window mean neither ~0 nor ~1); the Refine Edge Brush `region` forces
        // matting wherever it painted, at any radius.
        for i in 0..n {
            let in_band = mean_p[i] > 0.02 && mean_p[i] < 0.98;
            let global = radius > 0
                && in_band
                && (!smart
                    || (mean_p_narrow[i] > 0.02 && mean_p_narrow[i] < 0.98)
                    || edge_var[i] > 2e-3);
            if global || region.is_some_and(|m| m[i] > 0) {
                let q = (mean_a[i] * lum[i] + mean_b[i]).clamp(0.0, 1.0);
                self.mask[i] = (q * 255.0).round() as u8;
            }
        }
    }

    // Per-channel colour range (min/max) of the currently-selected pixels.
    fn seed_range(&self, px: &[u8]) -> Option<([u8; 4], [u8; 4])> {
        let (mut lo, mut hi, mut any) = ([255u8; 4], [0u8; 4], false);
        for i in 0..(self.w * self.h) as usize {
            if self.mask[i] >= 128 {
                any = true;
                let p = i * 4;
                for k in 0..4 {
                    lo[k] = lo[k].min(px[p + k]);
                    hi[k] = hi[k].max(px[p + k]);
                }
            }
        }
        if any {
            Some((lo, hi))
        } else {
            None
        }
    }

    fn within(px: &[u8], i: usize, lo: &[u8; 4], hi: &[u8; 4], t: f32) -> bool {
        let p = i * 4;
        for k in 0..4 {
            let c = px[p + k] as f32;
            if c < lo[k] as f32 - t || c > hi[k] as f32 + t {
                return false;
            }
        }
        true
    }

    // Select ▸ Grow: extend the selection to CONTIGUOUS pixels whose colour falls
    // within `tol` of the selection's colour range (a magic-wand flood from the
    // current selection).
    pub fn grow(&mut self, px: &[u8], tol: f32) {
        if !self.active {
            return;
        }
        let (lo, hi) = match self.seed_range(px) {
            Some(r) => r,
            None => return,
        };
        let t = tol * 255.0;
        let w = self.w as i32;
        let h = self.h as i32;
        let mut stack: Vec<(i32, i32)> = Vec::new();
        let mut seen = vec![false; (w * h) as usize];
        for i in 0..(w * h) as usize {
            if self.mask[i] >= 128 {
                stack.push((i as i32 % w, i as i32 / w));
                seen[i] = true;
            }
        }
        while let Some((cx, cy)) = stack.pop() {
            self.mask[(cy * w + cx) as usize] = 255;
            for (nx, ny) in [(cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)] {
                if nx < 0 || ny < 0 || nx >= w || ny >= h {
                    continue;
                }
                let ni = (ny * w + nx) as usize;
                if seen[ni] {
                    continue;
                }
                seen[ni] = true;
                if Self::within(px, ni, &lo, &hi, t) {
                    stack.push((nx, ny));
                }
            }
        }
    }

    // Select ▸ Similar: select EVERY pixel (anywhere) whose colour falls within
    // `tol` of the selection's colour range.
    pub fn similar(&mut self, px: &[u8], tol: f32) {
        if !self.active {
            return;
        }
        let (lo, hi) = match self.seed_range(px) {
            Some(r) => r,
            None => return,
        };
        let t = tol * 255.0;
        for i in 0..(self.w * self.h) as usize {
            if Self::within(px, i, &lo, &hi, t) {
                self.mask[i] = 255;
            }
        }
    }

    // Pixels to paint for Edit ▸ Stroke: a band along the selection edge.
    // `location`: 0 inside (width px inside the edge), 1 center (width/2 either
    // side), 2 outside (width px outside). Returns a per-pixel bool mask.
    pub fn stroke_band(&self, width: i32, location: u8) -> Vec<bool> {
        let w = self.w as i32;
        let h = self.h as i32;
        let cur: Vec<bool> = self.mask.iter().map(|&v| v >= 128).collect();
        let r = if location == 1 {
            (width / 2).max(1)
        } else {
            width.max(1)
        };
        let r2 = (r * r) as i64;
        let mut band = vec![false; (w * h) as usize];
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) as usize;
                let sel = cur[i];
                match location {
                    0 if !sel => continue, // inside: only the selected side
                    2 if sel => continue,  // outside: only the unselected side
                    _ => {}
                }
                // near the boundary: an opposite-state pixel within radius r
                let mut near = false;
                'scan: for dy in -r..=r {
                    for dx in -r..=r {
                        if (dx * dx + dy * dy) as i64 > r2 {
                            continue;
                        }
                        let (nx, ny) = (x + dx, y + dy);
                        let s =
                            nx >= 0 && ny >= 0 && nx < w && ny < h && cur[(ny * w + nx) as usize];
                        if s != sel {
                            near = true;
                            break 'scan;
                        }
                    }
                }
                band[i] = near;
            }
        }
        band
    }
}

// Even-odd (ray-casting) point-in-polygon test for the anti-aliased lasso fill.
pub(crate) fn point_in_poly(px: f32, py: f32, xs: &[f32], ys: &[f32]) -> bool {
    let n = xs.len();
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        if (ys[i] > py) != (ys[j] > py)
            && px < (xs[j] - xs[i]) * (py - ys[i]) / (ys[j] - ys[i]) + xs[i]
        {
            inside = !inside;
        }
        j = i;
    }
    inside
}

// Quick Selection ▸ Auto-Enhance: the dab's flood boundary is a staircase; the
// refine pass must pull it onto the guide's real edge, and must not touch the
// selection outside the dab.
#[cfg(test)]
mod auto_enhance {
    use super::*;

    const W: i32 = 32;
    const H: i32 = 32;

    // Guide: hard vertical edge at x = 16 (black left, white right).
    fn guide() -> Vec<u8> {
        let mut g = vec![0u8; (W * H) as usize * 4];
        for y in 0..H {
            for x in 0..W {
                let p = ((y * W + x) as usize) * 4;
                let v = if x < 16 { 0 } else { 255 };
                g[p] = v;
                g[p + 1] = v;
                g[p + 2] = v;
                g[p + 3] = 255;
            }
        }
        g
    }

    // A staircase mask: the boundary alternates between x = 14 and x = 17, i.e.
    // exactly the jagged edge a flood leaves.
    fn staircase() -> Selection {
        let mut s = Selection::new(W as u32, H as u32);
        s.active = true;
        for y in 0..H {
            let edge = if y % 2 == 0 { 14 } else { 17 };
            for x in 0..W {
                s.mask[(y * W + x) as usize] = if x < edge { 255 } else { 0 };
            }
        }
        s
    }

    // Last selected x per row — the boundary the eye reads as jagged.
    fn edges(s: &Selection, rows: std::ops::Range<i32>) -> Vec<i32> {
        rows.map(|y| {
            (0..W)
                .filter(|&x| s.mask[(y * W + x) as usize] >= 128)
                .next_back()
                .unwrap_or(-1)
        })
        .collect()
    }

    fn spread(e: &[i32]) -> i32 {
        e.iter().max().unwrap() - e.iter().min().unwrap()
    }

    #[test]
    fn straightens_the_dab_boundary_and_leaves_the_rest_alone() {
        let g = guide();
        let mut s = staircase();
        let before = s.mask.clone();
        // Dab centred on the edge, well away from the bottom rows.
        s.auto_enhance_dab(&g, 16, 8, 4);

        let rows = 6..11; // inside the dab disc (radius 4 + 2 margin)
        assert!(
            spread(&edges(&s, rows.clone())) < spread(&edges_of(&before, rows)),
            "the staircase inside the dab gets straighter"
        );

        // Outside the dab the selection is byte-identical.
        for y in 20..H {
            for x in 0..W {
                let i = (y * W + x) as usize;
                assert_eq!(s.mask[i], before[i], "untouched outside the dab at {x},{y}");
            }
        }
    }

    fn edges_of(mask: &[u8], rows: std::ops::Range<i32>) -> Vec<i32> {
        rows.map(|y| {
            (0..W)
                .filter(|&x| mask[(y * W + x) as usize] >= 128)
                .next_back()
                .unwrap_or(-1)
        })
        .collect()
    }
}
