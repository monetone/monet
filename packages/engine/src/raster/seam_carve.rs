// Edit ▸ Content-Aware Scale.
//
// The seam is chosen on one composite. A pass removes several non-overlapping
// seams from that energy map (one per band), then rebuilds energy once for the
// next pass. Layers are not touched here: the caller applies the finished
// source map in a single resample. Cancelling drops the job and leaves the
// document alone.

/// Columns per seam inside one pass. Wider bands route around detail; a pass
/// still costs one dynamic-programming sweep, not one sweep per removed column.
const SEAM_PASS_BAND: usize = 32;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Vertical,
    Horizontal,
    Done,
}

pub(crate) struct SeamJob {
    target_w: usize,
    target_h: usize,
    orig_w: usize,
    orig_h: usize,
    image: SeamImage,
    phase: Phase,
    /// `vx[orig_y * target_w + final_x] = original x`, after the width carve.
    vx: Vec<u32>,
    /// `hx[final_x * target_h + final_y] = original y`, after the height carve.
    hx: Vec<u32>,
}

pub(crate) struct SeamMaps {
    pub target_w: usize,
    pub target_h: usize,
    pub vx: Vec<u32>,
    pub hx: Vec<u32>,
}

impl SeamMaps {
    /// New canvas pixel → the original canvas pixel it keeps.
    pub(crate) fn map_xy(&self, nx: i32, ny: i32) -> (i32, i32) {
        let nx = nx.max(0) as usize;
        let ny = ny.max(0) as usize;
        let oy = self.hx[nx * self.target_h + ny] as i32;
        let ox = self.vx[oy as usize * self.target_w + nx] as i32;
        (ox, oy)
    }
}

impl SeamJob {
    pub(crate) fn start(
        rgba: Vec<u8>,
        w: usize,
        h: usize,
        target_w: usize,
        target_h: usize,
    ) -> Self {
        let image = SeamImage::from_rgba(rgba, w, h);
        let mut job = Self {
            target_w,
            target_h,
            orig_w: w,
            orig_h: h,
            image,
            phase: Phase::Vertical,
            vx: Vec::new(),
            hx: Vec::new(),
        };
        job.enter_phase();
        job
    }

    pub(crate) fn remaining(&self) -> usize {
        match self.phase {
            Phase::Done => 0,
            Phase::Vertical => {
                self.image.w.saturating_sub(self.target_w) + self.orig_h.saturating_sub(self.target_h)
            }
            Phase::Horizontal => self.image.w.saturating_sub(self.target_h),
        }
    }

    pub(crate) fn is_done(&self) -> bool {
        self.phase == Phase::Done
    }

    /// One scheduling pass. Returns false when there is nothing left to remove.
    pub(crate) fn step_pass(&mut self) -> bool {
        if self.phase == Phase::Done {
            return false;
        }
        let target = match self.phase {
            Phase::Vertical => self.target_w,
            Phase::Horizontal => self.target_h,
            Phase::Done => return false,
        };
        if self.image.w <= target || self.image.w < 2 || self.image.h == 0 {
            self.finish_phase();
            return false;
        }
        let before = self.image.w;
        self.image.remove_pass(target);
        if self.image.w >= before {
            return false;
        }
        if self.image.w <= target {
            self.finish_phase();
        }
        true
    }

    pub(crate) fn maps(&self) -> Option<SeamMaps> {
        if self.phase != Phase::Done {
            return None;
        }
        Some(SeamMaps {
            target_w: self.target_w,
            target_h: self.target_h,
            vx: self.vx.clone(),
            hx: self.hx.clone(),
        })
    }

    fn enter_phase(&mut self) {
        if self.phase == Phase::Vertical && self.image.w <= self.target_w {
            self.vx = self.image.src.clone();
            self.phase = Phase::Horizontal;
        }
        if self.phase == Phase::Horizontal && self.orig_h <= self.target_h {
            self.hx = identity_rows(self.target_w, self.target_h);
            self.phase = Phase::Done;
        } else if self.phase == Phase::Horizontal && self.image.w == self.orig_w && self.vx.len() == self.orig_h * self.target_w {
            // Width carve just finished (or was a no-op) and the image is still
            // in original orientation. Turn height into the width of a transpose
            // so the same pass removes rows.
            if self.image.h == self.orig_h && self.image.w == self.target_w {
                let next = self.image.transpose();
                self.image = next;
            }
        }
    }

    fn finish_phase(&mut self) {
        match self.phase {
            Phase::Vertical => {
                self.vx = self.image.src.clone();
                self.phase = Phase::Horizontal;
                if self.orig_h > self.target_h {
                    let next = self.image.transpose();
                    self.image = next;
                } else {
                    self.hx = identity_rows(self.target_w, self.target_h);
                    self.phase = Phase::Done;
                }
            }
            Phase::Horizontal => {
                self.hx = self.image.src.clone();
                self.phase = Phase::Done;
            }
            Phase::Done => {}
        }
    }
}

struct SeamImage {
    w: usize,
    h: usize,
    rgba: Vec<u8>,
    energy: Vec<u32>,
    /// `src[y * w + x]` is the x this column had when this axis started.
    src: Vec<u32>,
}

impl SeamImage {
    fn from_rgba(rgba: Vec<u8>, w: usize, h: usize) -> Self {
        let energy = build_energy(&rgba, w, h);
        let src = identity_columns(w, h);
        Self { w, h, rgba, energy, src }
    }

    fn transpose(&self) -> Self {
        let w = self.h;
        let h = self.w;
        let mut rgba = vec![0u8; self.rgba.len()];
        for y in 0..self.h {
            for x in 0..self.w {
                let s = (y * self.w + x) * 4;
                let d = (x * self.h + y) * 4;
                rgba[d..d + 4].copy_from_slice(&self.rgba[s..s + 4]);
            }
        }
        Self::from_rgba(rgba, w, h)
    }

    /// Remove up to one band of seams, stopping at `target_w`.
    fn remove_pass(&mut self, target_w: usize) {
        let remaining = self.w.saturating_sub(target_w);
        if remaining == 0 || self.w < 2 || self.h == 0 {
            return;
        }
        let bands = remaining.min((self.w / SEAM_PASS_BAND).max(1)).min(self.w - 1);
        if bands == 0 {
            return;
        }
        let span = self.w / bands;
        let mut seams = Vec::with_capacity(bands);
        for band in 0..bands {
            let x0 = band * span;
            let x1 = if band + 1 == bands { self.w } else { x0 + span };
            if x1 <= x0 {
                continue;
            }
            seams.push(seam_in_band(&self.energy, self.w, self.h, x0, x1));
        }
        if seams.is_empty() {
            return;
        }
        self.compact(&seams);
        // One rebuild per pass. Updating energy only along each removed seam is
        // wrong once several disjoint seams land: vertical neighbors change
        // everywhere between the cuts, not just beside one of them.
        self.energy = build_energy(&self.rgba, self.w, self.h);
    }

    fn compact(&mut self, seams: &[Vec<usize>]) {
        let removed = seams.len();
        let nw = self.w - removed;
        let mut rgba = vec![0u8; nw * self.h * 4];
        let mut src = vec![0u32; nw * self.h];
        for y in 0..self.h {
            let mut cuts: Vec<usize> = seams.iter().map(|seam| seam[y]).collect();
            cuts.sort_unstable();
            cuts.dedup();
            let mut from = 0usize;
            let mut to = 0usize;
            let mut cut_at = 0usize;
            while from < self.w && to < nw {
                if cut_at < cuts.len() && from == cuts[cut_at] {
                    from += 1;
                    cut_at += 1;
                    continue;
                }
                let s = (y * self.w + from) * 4;
                let d = (y * nw + to) * 4;
                rgba[d..d + 4].copy_from_slice(&self.rgba[s..s + 4]);
                src[y * nw + to] = self.src[y * self.w + from];
                from += 1;
                to += 1;
            }
        }
        self.rgba = rgba;
        self.src = src;
        self.w = nw;
    }
}

fn identity_columns(w: usize, h: usize) -> Vec<u32> {
    let mut src = vec![0u32; w * h];
    for y in 0..h {
        for x in 0..w {
            src[y * w + x] = x as u32;
        }
    }
    src
}

fn identity_rows(tw: usize, th: usize) -> Vec<u32> {
    let mut src = vec![0u32; tw * th];
    for x in 0..tw {
        for y in 0..th {
            src[x * th + y] = y as u32;
        }
    }
    src
}

fn build_energy(rgba: &[u8], w: usize, h: usize) -> Vec<u32> {
    let mut energy = vec![0u32; w * h];
    if w == 0 || h == 0 {
        return energy;
    }
    let lum = |x: usize, y: usize| -> u32 {
        let i = (y * w + x) * 4;
        (rgba[i] as u32 * 299 + rgba[i + 1] as u32 * 587 + rgba[i + 2] as u32 * 114) / 1000
    };
    for y in 0..h {
        let ym = if y == 0 { 0 } else { y - 1 };
        let yp = if y + 1 == h { y } else { y + 1 };
        for x in 0..w {
            let xm = if x == 0 { 0 } else { x - 1 };
            let xp = if x + 1 == w { x } else { x + 1 };
            let gx = lum(xp, y).abs_diff(lum(xm, y));
            let gy = lum(x, yp).abs_diff(lum(x, ym));
            energy[y * w + x] = gx + gy;
        }
    }
    energy
}

/// Lowest-energy 8-connected vertical seam inside `x0..x1` (absolute columns).
fn seam_in_band(energy: &[u32], w: usize, h: usize, x0: usize, x1: usize) -> Vec<usize> {
    let bw = x1.saturating_sub(x0);
    if bw <= 1 || h == 0 {
        return vec![x0; h];
    }
    let mut cum = vec![0u32; bw * h];
    for x in 0..bw {
        cum[x] = energy[x0 + x];
    }
    for y in 1..h {
        let prev = (y - 1) * bw;
        let row = y * bw;
        let er = y * w + x0;
        cum[row] = energy[er] + cum[prev].min(cum[prev + 1]);
        for x in 1..bw - 1 {
            let best = cum[prev + x - 1].min(cum[prev + x]).min(cum[prev + x + 1]);
            cum[row + x] = energy[er + x] + best;
        }
        let last = bw - 1;
        cum[row + last] = energy[er + last] + cum[prev + last - 1].min(cum[prev + last]);
    }
    let mut seam = vec![0usize; h];
    let mut best = 0usize;
    let last = (h - 1) * bw;
    for x in 1..bw {
        if cum[last + x] < cum[last + best] {
            best = x;
        }
    }
    seam[h - 1] = x0 + best;
    for y in (0..h - 1).rev() {
        let prev = seam[y + 1] - x0;
        let row = y * bw;
        let mut choice = prev;
        if prev > 0 && cum[row + prev - 1] < cum[row + choice] {
            choice = prev - 1;
        }
        if prev + 1 < bw && cum[row + prev + 1] < cum[row + choice] {
            choice = prev + 1;
        }
        seam[y] = x0 + choice;
    }
    seam
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gray(w: usize, h: usize, v: u8) -> Vec<u8> {
        let mut rgba = vec![v; w * h * 4];
        for px in rgba.chunks_exact_mut(4) {
            px[3] = 255;
        }
        rgba
    }

    #[test]
    fn a_bright_column_survives_the_width_carve() {
        let w = 48usize;
        let h = 12usize;
        let mut rgba = gray(w, h, 20);
        for y in 0..h {
            let i = (y * w + 24) * 4;
            rgba[i] = 255;
            rgba[i + 1] = 255;
            rgba[i + 2] = 255;
        }
        let mut job = SeamJob::start(rgba, w, h, 40, h);
        let mut guard = 80;
        while job.remaining() > 0 {
            assert!(job.step_pass(), "a pass removes a seam");
            guard -= 1;
            assert!(guard > 0, "carve finished");
        }
        let maps = job.maps().expect("finished");
        assert_eq!((maps.target_w, maps.target_h), (40, h));
        let mut kept = 0usize;
        for y in 0..h {
            for x in 0..40 {
                if maps.map_xy(x as i32, y as i32) == (24, y as i32) {
                    kept += 1;
                }
            }
        }
        assert_eq!(kept, h, "every pixel of the bright column is kept");
    }
}
