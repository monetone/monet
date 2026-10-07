// ─────────────────────────────────────────────────────────────
// geom — the geometry core (Rust port of src/engine/geometry/*)
// ─────────────────────────────────────────────────────────────
// Pure functions over the model's Point/Matrix/Anchor/PathGeometry: vectors,
// affine matrices (SVG [a b c d e f] convention), axis-aligned rects, cubic
// beziers, and anchor-path helpers (segments / bounds / flatten / hit / area).
// This is the foundation the query + ops layers build on.

use crate::vector::model::{Anchor, Matrix, PathGeometry, Point};

pub const KAPPA: f32 = 0.552_284_75;

#[inline]
pub fn pt(x: f32, y: f32) -> Point {
    Point { x, y }
}

// ── vec ──────────────────────────────────────────────────────
pub fn add(a: Point, b: Point) -> Point {
    pt(a.x + b.x, a.y + b.y)
}
pub fn sub(a: Point, b: Point) -> Point {
    pt(a.x - b.x, a.y - b.y)
}
pub fn scale(a: Point, s: f32) -> Point {
    pt(a.x * s, a.y * s)
}
pub fn dot(a: Point, b: Point) -> f32 {
    a.x * b.x + a.y * b.y
}
pub fn cross(a: Point, b: Point) -> f32 {
    a.x * b.y - a.y * b.x
}
pub fn len(a: Point) -> f32 {
    (a.x * a.x + a.y * a.y).sqrt()
}
pub fn dist(a: Point, b: Point) -> f32 {
    len(sub(a, b))
}
pub fn lerp(a: Point, b: Point, t: f32) -> Point {
    pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
}
pub fn mid(a: Point, b: Point) -> Point {
    lerp(a, b, 0.5)
}
pub fn normalize(a: Point) -> Point {
    let l = len(a);
    if l < 1e-12 {
        pt(0.0, 0.0)
    } else {
        scale(a, 1.0 / l)
    }
}
pub fn perp(a: Point) -> Point {
    pt(-a.y, a.x)
}
pub fn rotate(p: Point, ang: f32) -> Point {
    let (s, c) = ang.sin_cos();
    pt(p.x * c - p.y * s, p.x * s + p.y * c)
}
pub fn rotate_around(p: Point, center: Point, ang: f32) -> Point {
    add(rotate(sub(p, center), ang), center)
}

// ── matrix (x' = a·x + c·y + e ; y' = b·x + d·y + f) ─────────
pub fn m_identity() -> Matrix {
    Matrix::default()
}
pub fn m_mul(m: Matrix, n: Matrix) -> Matrix {
    Matrix {
        a: m.a * n.a + m.c * n.b,
        b: m.b * n.a + m.d * n.b,
        c: m.a * n.c + m.c * n.d,
        d: m.b * n.c + m.d * n.d,
        e: m.a * n.e + m.c * n.f + m.e,
        f: m.b * n.e + m.d * n.f + m.f,
    }
}
pub fn m_translation(tx: f32, ty: f32) -> Matrix {
    Matrix {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: tx,
        f: ty,
    }
}
pub fn m_scaling(sx: f32, sy: f32) -> Matrix {
    Matrix {
        a: sx,
        b: 0.0,
        c: 0.0,
        d: sy,
        e: 0.0,
        f: 0.0,
    }
}
pub fn m_rotation(ang: f32) -> Matrix {
    let (s, c) = ang.sin_cos();
    Matrix {
        a: c,
        b: s,
        c: -s,
        d: c,
        e: 0.0,
        f: 0.0,
    }
}
pub fn m_determinant(m: Matrix) -> f32 {
    m.a * m.d - m.b * m.c
}
pub fn m_invert(m: Matrix) -> Option<Matrix> {
    let det = m_determinant(m);
    if det.abs() < 1e-12 {
        return None;
    }
    let id = 1.0 / det;
    Some(Matrix {
        a: m.d * id,
        b: -m.b * id,
        c: -m.c * id,
        d: m.a * id,
        e: (m.c * m.f - m.d * m.e) * id,
        f: (m.b * m.e - m.a * m.f) * id,
    })
}
pub fn apply_point(m: Matrix, p: Point) -> Point {
    pt(m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f)
}
pub fn apply_vector(m: Matrix, p: Point) -> Point {
    pt(m.a * p.x + m.c * p.y, m.b * p.x + m.d * p.y)
}
/// Geometric-mean scale factor (uniform-equivalent), used for stroke/handle sizing.
pub fn mean_scale(m: Matrix) -> f32 {
    m_determinant(m).abs().sqrt()
}

// ── Rect ─────────────────────────────────────────────────────
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    pub fn right(&self) -> f32 {
        self.x + self.w
    }
    pub fn bottom(&self) -> f32 {
        self.y + self.h
    }
    pub fn contains_point(&self, p: Point) -> bool {
        p.x >= self.x && p.x <= self.right() && p.y >= self.y && p.y <= self.bottom()
    }
    pub fn from_two_points(a: Point, b: Point) -> Rect {
        let x = a.x.min(b.x);
        let y = a.y.min(b.y);
        Rect {
            x,
            y,
            w: (a.x - b.x).abs(),
            h: (a.y - b.y).abs(),
        }
    }
    pub fn from_points(pts: &[Point]) -> Option<Rect> {
        let first = pts.first()?;
        let mut minx = first.x;
        let mut miny = first.y;
        let mut maxx = first.x;
        let mut maxy = first.y;
        for p in &pts[1..] {
            minx = minx.min(p.x);
            miny = miny.min(p.y);
            maxx = maxx.max(p.x);
            maxy = maxy.max(p.y);
        }
        Some(Rect {
            x: minx,
            y: miny,
            w: maxx - minx,
            h: maxy - miny,
        })
    }
    pub fn corners(&self) -> [Point; 4] {
        [
            pt(self.x, self.y),
            pt(self.right(), self.y),
            pt(self.right(), self.bottom()),
            pt(self.x, self.bottom()),
        ]
    }
    /// Transform a rect by a matrix → the AABB of its transformed corners.
    pub fn transform(&self, m: Matrix) -> Rect {
        let c: Vec<Point> = self.corners().iter().map(|&p| apply_point(m, p)).collect();
        Rect::from_points(&c).unwrap()
    }
}

pub fn union(a: Option<Rect>, b: Rect) -> Rect {
    match a {
        None => b,
        Some(a) => {
            let x = a.x.min(b.x);
            let y = a.y.min(b.y);
            let r = a.right().max(b.right());
            let bo = a.bottom().max(b.bottom());
            Rect {
                x,
                y,
                w: r - x,
                h: bo - y,
            }
        }
    }
}

// ── cubic bezier ─────────────────────────────────────────────
#[derive(Clone, Copy, Debug)]
pub struct Cubic {
    pub p0: Point,
    pub p1: Point,
    pub p2: Point,
    pub p3: Point,
}

impl Cubic {
    /// From two anchors' on-curve points and relative handles (path.ts segments).
    pub fn from_handles(p0: Point, h_out: Point, p3: Point, h_in: Point) -> Cubic {
        Cubic {
            p0,
            p1: add(p0, h_out),
            p2: add(p3, h_in),
            p3,
        }
    }
    pub fn eval(&self, t: f32) -> Point {
        let u = 1.0 - t;
        let a = u * u * u;
        let b = 3.0 * u * u * t;
        let c = 3.0 * u * t * t;
        let d = t * t * t;
        pt(
            a * self.p0.x + b * self.p1.x + c * self.p2.x + d * self.p3.x,
            a * self.p0.y + b * self.p1.y + c * self.p2.y + d * self.p3.y,
        )
    }
    pub fn split(&self, t: f32) -> (Cubic, Cubic) {
        let ab = lerp(self.p0, self.p1, t);
        let bc = lerp(self.p1, self.p2, t);
        let cd = lerp(self.p2, self.p3, t);
        let abc = lerp(ab, bc, t);
        let bcd = lerp(bc, cd, t);
        let m = lerp(abc, bcd, t);
        (
            Cubic {
                p0: self.p0,
                p1: ab,
                p2: abc,
                p3: m,
            },
            Cubic {
                p0: m,
                p1: bcd,
                p2: cd,
                p3: self.p3,
            },
        )
    }
    fn is_flat(&self, tol: f32) -> bool {
        // Max distance of the control points from the p0→p3 chord.
        let d = sub(self.p3, self.p0);
        let len2 = dot(d, d);
        if len2 < 1e-12 {
            return dist(self.p1, self.p0).max(dist(self.p2, self.p0)) <= tol;
        }
        let inv_len = 1.0 / len2.sqrt();
        // (#127) The perpendicular deviation alone calls a control point that is
        // collinear with the chord but far OUTSIDE p0..p3 "flat", so the curve's
        // overshoot lobe never gets flattened — it is painted but missing from
        // bounds, hit-testing and the booleans. Bound the along-chord projection
        // too (with `tol` of slack, expressed in chord parameter units).
        let slack = tol * inv_len;
        let flat = |p: Point| -> bool {
            let v = sub(p, self.p0);
            let t = dot(v, d) / len2;
            cross(v, d).abs() * inv_len <= tol && t >= -slack && t <= 1.0 + slack
        };
        flat(self.p1) && flat(self.p2)
    }
    /// Adaptive flatten → points AFTER p0 (caller seeds the first point).
    pub fn flatten_into(&self, tol: f32, depth: u32, out: &mut Vec<Point>) {
        if depth >= 18 || self.is_flat(tol) {
            out.push(self.p3);
            return;
        }
        let (l, r) = self.split(0.5);
        l.flatten_into(tol, depth + 1, out);
        r.flatten_into(tol, depth + 1, out);
    }
}

// ── path (anchor list) ───────────────────────────────────────
fn handle_zero(h: Point) -> bool {
    h.x.abs() < 1e-9 && h.y.abs() < 1e-9
}

/// Insert an on-curve anchor at parameter `t` of segment `seg_index` (de
/// Casteljau split — lossless: the path shape is unchanged).
pub fn insert_anchor(g: &PathGeometry, seg_index: usize, t: f32) -> PathGeometry {
    let n = g.anchors.len();
    if n < 2 || seg_index >= n {
        return g.clone();
    }
    let i = seg_index;
    let j = (i + 1) % n;
    let a = &g.anchors[i];
    let b = &g.anchors[j];
    let c = Cubic::from_handles(a.point, a.handle_out, b.point, b.handle_in);
    let (l, r) = c.split(t);
    let m = l.p3;
    let mut anchors = g.anchors.clone();
    anchors[i].handle_out = sub(l.p1, a.point);
    anchors[j].handle_in = sub(r.p2, b.point);
    let new_anchor = Anchor {
        point: m,
        handle_in: sub(l.p2, m),
        handle_out: sub(r.p1, m),
    };
    let insert_pos = if j == 0 { n } else { i + 1 };
    anchors.insert(insert_pos, new_anchor);
    PathGeometry {
        closed: g.closed,
        anchors,
    }
}

/// Transform a path's geometry by a matrix: points map affinely, relative
/// handles map by the linear part (so curves transform correctly).
pub fn transform_geometry(g: &PathGeometry, m: Matrix) -> PathGeometry {
    PathGeometry {
        closed: g.closed,
        anchors: g
            .anchors
            .iter()
            .map(|a| Anchor {
                point: apply_point(m, a.point),
                handle_in: apply_vector(m, a.handle_in),
                handle_out: apply_vector(m, a.handle_out),
            })
            .collect(),
    }
}

pub fn segments(p: &PathGeometry) -> Vec<Cubic> {
    let n = p.anchors.len();
    if n < 2 {
        return Vec::new();
    }
    let mut out = Vec::new();
    for i in 0..n - 1 {
        let a = &p.anchors[i];
        let b = &p.anchors[i + 1];
        out.push(Cubic::from_handles(
            a.point,
            a.handle_out,
            b.point,
            b.handle_in,
        ));
    }
    if p.closed {
        let a = &p.anchors[n - 1];
        let b = &p.anchors[0];
        out.push(Cubic::from_handles(
            a.point,
            a.handle_out,
            b.point,
            b.handle_in,
        ));
    }
    out
}

/// Flatten a path to a polyline (one point per anchor + subdivisions).
pub fn flatten(p: &PathGeometry, tol: f32) -> Vec<Point> {
    let segs = segments(p);
    if p.anchors.is_empty() {
        return Vec::new();
    }
    let mut out = vec![p.anchors[0].point];
    for c in &segs {
        if handle_zero(sub(c.p1, c.p0)) && handle_zero(sub(c.p2, c.p3)) {
            out.push(c.p3);
        } else {
            c.flatten_into(tol, 0, &mut out);
        }
    }
    out
}

fn anchor_at(p: Point) -> Anchor {
    Anchor {
        point: p,
        handle_in: Point::default(),
        handle_out: Point::default(),
    }
}

/// Build the filled ribbon geometry for a variable-width stroke profile.
/// Matches Artisan's `Path.widthOutline`: profile multipliers are sampled per
/// anchor, interpolated along flattened segments, and converted to one closed
/// ring for open paths or two rings for closed paths.
pub fn width_outline(p: &PathGeometry, multipliers: &[f32], base_width: f32) -> Vec<PathGeometry> {
    if base_width <= 0.0 {
        return Vec::new();
    }
    let segs = segments(p);
    if segs.is_empty() || p.anchors.len() < 2 {
        return Vec::new();
    }
    let n = p.anchors.len();
    let m_at = |i: usize| -> f32 { multipliers.get(i % n).copied().unwrap_or(1.0).max(0.0) };
    let mut samples: Vec<(Point, f32)> = Vec::new();
    for (si, seg) in segs.iter().enumerate() {
        let mut flat = vec![seg.p0];
        if handle_zero(sub(seg.p1, seg.p0)) && handle_zero(sub(seg.p2, seg.p3)) {
            flat.push(seg.p3);
        } else {
            seg.flatten_into(0.6, 0, &mut flat);
        }
        let w0 = base_width * m_at(si);
        let w1 = base_width * m_at(si + 1);
        let denom = (flat.len().saturating_sub(1)).max(1) as f32;
        for (k, point) in flat.iter().enumerate() {
            if si > 0 && k == 0 {
                continue;
            }
            let t = k as f32 / denom;
            samples.push((*point, w0 + (w1 - w0) * t));
        }
    }
    // (#126) A closed path's sample list ends on the same on-curve point it
    // started on (segments() appends the closing segment). Keeping both copies
    // gave the seam anchor two one-sided normals — a notch/self-overlap at the
    // start anchor — so drop the duplicate and wrap the neighbour lookup instead.
    if p.closed && samples.len() > 2 && dist(samples[0].0, samples[samples.len() - 1].0) < 1e-6 {
        samples.pop();
    }
    let m = samples.len();
    if m < 2 {
        return Vec::new();
    }
    let wrap = p.closed;
    let normal_at = |i: usize| -> Point {
        let a = if i == 0 && wrap {
            samples[m - 1].0
        } else {
            samples[i.saturating_sub(1)].0
        };
        let b = if i + 1 == m && wrap {
            samples[0].0
        } else {
            samples[(i + 1).min(m - 1)].0
        };
        normalize(perp(sub(b, a)))
    };
    let mut left = Vec::with_capacity(m);
    let mut right = Vec::with_capacity(m);
    for (i, (point, width)) in samples.iter().enumerate() {
        let normal = normal_at(i);
        let half_width = width / 2.0;
        left.push(add(*point, scale(normal, half_width)));
        right.push(sub(*point, scale(normal, half_width)));
    }
    let ring = |pts: Vec<Point>| PathGeometry {
        closed: true,
        anchors: pts.into_iter().map(anchor_at).collect(),
    };
    if p.closed {
        right.reverse();
        vec![ring(left), ring(right)]
    } else {
        right.reverse();
        left.extend(right);
        vec![ring(left)]
    }
}

pub fn bounds(p: &PathGeometry) -> Option<Rect> {
    let poly = flatten(p, 0.1);
    Rect::from_points(&poly)
}

pub fn signed_area(p: &PathGeometry) -> f32 {
    let poly = flatten(p, 0.25);
    let n = poly.len();
    if n < 3 {
        return 0.0;
    }
    let mut area = 0.0;
    for i in 0..n {
        let a = poly[i];
        let b = poly[(i + 1) % n];
        area += a.x * b.y - b.x * a.y;
    }
    area / 2.0
}

/// Point-in-path via ray casting on the flattened polygon. `even_odd` toggles
/// the fill rule (parity vs. nonzero winding).
pub fn contains_point(p: &PathGeometry, q: Point, even_odd: bool) -> bool {
    let poly = flatten(p, 0.6);
    let n = poly.len();
    if n < 3 {
        return false;
    }
    if even_odd {
        let mut inside = false;
        let mut j = n - 1;
        for i in 0..n {
            let a = poly[i];
            let b = poly[j];
            if (a.y > q.y) != (b.y > q.y) {
                let x = (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x;
                if q.x < x {
                    inside = !inside;
                }
            }
            j = i;
        }
        inside
    } else {
        winding_number(p, q) != 0
    }
}

/// Signed winding number of `p` around `q`. Exposed because a COMPOUND path's
/// fill is decided across all its subpaths at once: nonzero sums the windings
/// (an oppositely-wound inner ring cancels the outer one, making a hole), and
/// even-odd counts containments. Deciding per subpath instead reports a hit in
/// the middle of a donut, where nothing is painted.
pub fn winding_number(p: &PathGeometry, q: Point) -> i32 {
    let poly = flatten(p, 0.6);
    let n = poly.len();
    if n < 3 {
        return 0;
    }
    let mut wind = 0i32;
    for i in 0..n {
        let a = poly[i];
        let b = poly[(i + 1) % n];
        if a.y <= q.y {
            if b.y > q.y && cross(sub(b, a), sub(q, a)) > 0.0 {
                wind += 1;
            }
        } else if b.y <= q.y && cross(sub(b, a), sub(q, a)) < 0.0 {
            wind -= 1;
        }
    }
    wind
}

/// Nearest distance from `q` to the path outline (flattened).
pub fn distance_to_outline(p: &PathGeometry, q: Point) -> f32 {
    let poly = flatten(p, 0.4);
    if poly.len() < 2 {
        return f32::INFINITY;
    }
    let mut best = f32::INFINITY;
    let n = poly.len();
    let count = if p.closed { n } else { n - 1 };
    for i in 0..count {
        let a = poly[i];
        let b = poly[(i + 1) % n];
        best = best.min(seg_dist(q, a, b));
    }
    best
}

fn seg_dist(p: Point, a: Point, b: Point) -> f32 {
    let ab = sub(b, a);
    let len2 = dot(ab, ab);
    let t = if len2 < 1e-12 {
        0.0
    } else {
        (dot(sub(p, a), ab) / len2).clamp(0.0, 1.0)
    };
    dist(p, add(a, scale(ab, t)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vector::model::Anchor;

    fn p(x: f32, y: f32) -> Point {
        pt(x, y)
    }

    #[test]
    fn matrix_invert_roundtrips() {
        let m = m_mul(
            m_translation(30.0, -10.0),
            m_mul(m_rotation(0.5), m_scaling(2.0, 3.0)),
        );
        let inv = m_invert(m).unwrap();
        let q = apply_point(m, p(7.0, 4.0));
        let back = apply_point(inv, q);
        assert!((back.x - 7.0).abs() < 1e-3 && (back.y - 4.0).abs() < 1e-3);
    }

    #[test]
    fn mean_scale_of_2x3() {
        assert!((mean_scale(m_scaling(2.0, 3.0)) - 6.0_f32.sqrt()).abs() < 1e-4);
    }

    #[test]
    fn cubic_endpoints_and_midpoint() {
        let c = Cubic {
            p0: p(0.0, 0.0),
            p1: p(0.0, 10.0),
            p2: p(10.0, 10.0),
            p3: p(10.0, 0.0),
        };
        assert_eq!(c.eval(0.0).x, 0.0);
        assert_eq!(c.eval(1.0).x, 10.0);
        let m = c.eval(0.5);
        assert!((m.x - 5.0).abs() < 1e-4 && (m.y - 7.5).abs() < 1e-4);
    }

    #[test]
    fn rect_union_and_transform() {
        let u = union(
            Some(Rect {
                x: 0.0,
                y: 0.0,
                w: 10.0,
                h: 10.0,
            }),
            Rect {
                x: 5.0,
                y: 5.0,
                w: 10.0,
                h: 10.0,
            },
        );
        assert_eq!(
            u,
            Rect {
                x: 0.0,
                y: 0.0,
                w: 15.0,
                h: 15.0
            }
        );
        let r = Rect {
            x: 0.0,
            y: 0.0,
            w: 10.0,
            h: 10.0,
        }
        .transform(m_translation(5.0, 5.0));
        assert_eq!(
            r,
            Rect {
                x: 5.0,
                y: 5.0,
                w: 10.0,
                h: 10.0
            }
        );
    }

    fn corner_anchor(x: f32, y: f32) -> Anchor {
        Anchor {
            point: p(x, y),
            handle_in: p(0.0, 0.0),
            handle_out: p(0.0, 0.0),
        }
    }

    #[test]
    fn overshooting_control_points_are_not_flat() {
        // (#127) p1/p2 collinear with the chord but far past p3 have ZERO
        // perpendicular deviation, so the curve was emitted as the bare chord —
        // the overshoot lobe (max x = 23.75 at t=0.5) was painted but missing
        // from bounds, hit-testing and the booleans.
        let curve = PathGeometry {
            closed: false,
            anchors: vec![
                Anchor {
                    point: p(0.0, 0.0),
                    handle_in: p(0.0, 0.0),
                    handle_out: p(30.0, 0.0),
                },
                Anchor {
                    point: p(10.0, 0.0),
                    handle_in: p(20.0, 0.0),
                    handle_out: p(0.0, 0.0),
                },
            ],
        };
        let b = bounds(&curve).unwrap();
        assert!(b.right() > 23.0, "overshoot truncated: {b:?}");
        // (20,0) sits ON the curve (t ≈ 0.32); against the bare chord it was 10 away.
        assert!(
            distance_to_outline(&curve, p(20.0, 0.0)) < 0.5,
            "lobe not hit-testable"
        );
    }

    #[test]
    fn closed_width_outline_has_one_normal_at_the_seam() {
        // (#126) The closed square's sample list started and ended on the same
        // point, and each copy got its own one-sided normal — a duplicated ring
        // anchor and a notch at the start anchor of every variable-width stroke.
        let square = PathGeometry {
            closed: true,
            anchors: vec![
                corner_anchor(0.0, 0.0),
                corner_anchor(10.0, 0.0),
                corner_anchor(10.0, 10.0),
                corner_anchor(0.0, 10.0),
            ],
        };
        let rings = width_outline(&square, &[1.0, 1.0, 1.0, 1.0], 2.0);
        assert_eq!(rings.len(), 2, "closed paths make an inner + outer ring");
        assert_eq!(rings[0].anchors.len(), 4, "seam sample duplicated");
        // The seam corner is now averaged like every other corner: ±(√½, √½).
        let seam = rings[0].anchors[0].point;
        let half = 0.5f32.sqrt();
        assert!(
            (seam.x.abs() - half).abs() < 1e-3 && (seam.y.abs() - half).abs() < 1e-3,
            "seam offset {seam:?}"
        );
    }

    #[test]
    fn square_bounds_area_and_hit() {
        let sq = PathGeometry {
            closed: true,
            anchors: vec![
                Anchor {
                    point: p(0.0, 0.0),
                    handle_in: p(0.0, 0.0),
                    handle_out: p(0.0, 0.0),
                },
                Anchor {
                    point: p(10.0, 0.0),
                    handle_in: p(0.0, 0.0),
                    handle_out: p(0.0, 0.0),
                },
                Anchor {
                    point: p(10.0, 10.0),
                    handle_in: p(0.0, 0.0),
                    handle_out: p(0.0, 0.0),
                },
                Anchor {
                    point: p(0.0, 10.0),
                    handle_in: p(0.0, 0.0),
                    handle_out: p(0.0, 0.0),
                },
            ],
        };
        let b = bounds(&sq).unwrap();
        assert_eq!(
            b,
            Rect {
                x: 0.0,
                y: 0.0,
                w: 10.0,
                h: 10.0
            }
        );
        assert!((signed_area(&sq).abs() - 100.0).abs() < 1e-2);
        assert!(contains_point(&sq, p(5.0, 5.0), false));
        assert!(!contains_point(&sq, p(15.0, 5.0), false));
        assert!(contains_point(&sq, p(5.0, 5.0), true));
    }
}
