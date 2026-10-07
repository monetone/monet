// ─────────────────────────────────────────────────────────────
// shapes — live-shape → path geometry + local bounds (Rust port of model/shapes.ts)
// ─────────────────────────────────────────────────────────────
// Shared by the renderer and the query layer: expands rect/ellipse/polygon/star/
// line into the SAME path geometry as the TS engine, and computes item bounds.

use crate::vector::geom::{self, Rect, KAPPA};
use crate::vector::model::{Anchor, Item, PathGeometry, Point};

fn anchor(px: f32, py: f32, ix: f32, iy: f32, ox: f32, oy: f32) -> Anchor {
    Anchor {
        point: Point { x: px, y: py },
        handle_in: Point { x: ix, y: iy },
        handle_out: Point { x: ox, y: oy },
    }
}

fn corner(px: f32, py: f32) -> Anchor {
    anchor(px, py, 0.0, 0.0, 0.0, 0.0)
}

/// ONE rounded-rect builder behind both the uniform `rx`/`ry` pair and the
/// four per-corner radii: `corners` are [top-left, top-right, bottom-right,
/// bottom-left] as (rx, ry), each clamped PER AXIS (rx ≤ w/2, ry ≤ h/2) and
/// walked clockwise from the top-left arc's end, so a uniform set is anchor-
/// for-anchor the classic 8-anchor cycle. A corner whose radius clamps to zero
/// on either axis stays sharp (one anchor); a rounded one contributes the two
/// ends of its quarter arc, handles KAPPA of the way to the corner.
fn rounded_rect(w: f32, h: f32, corners: [(f32, f32); 4]) -> PathGeometry {
    // (#120) Scene JSON (vector_set_scene / .monetgfx import) can carry a
    // negative or NaN size; f32::clamp panics when min > max, which would abort
    // the whole engine on render/hit-test. Degenerate rects collapse to empty,
    // and a NaN radius reads as a sharp corner.
    let w = if w > 0.0 { w } else { 0.0 };
    let h = if h > 0.0 { h } else { 0.0 };
    let clamp = |v: f32, lim: f32| if v.is_finite() { v.clamp(0.0, lim) } else { 0.0 };
    let [(rx0, ry0), (rx1, ry1), (rx2, ry2), (rx3, ry3)] =
        corners.map(|(rx, ry)| (clamp(rx, w / 2.0), clamp(ry, h / 2.0)));
    let k = KAPPA;
    let rounded = |rx: f32, ry: f32| rx >= 1e-6 && ry >= 1e-6;
    // Per corner: (rounded?, arc start, arc end, the sharp corner point). The
    // handles are spelled out per corner so a uniform set is bit-identical to
    // the classic cycle, not a rounding away from it.
    let arcs = [
        (
            rounded(rx0, ry0),
            anchor(0.0, ry0, 0.0, 0.0, 0.0, -ry0 * k),
            anchor(rx0, 0.0, -rx0 * k, 0.0, 0.0, 0.0),
            corner(0.0, 0.0),
        ),
        (
            rounded(rx1, ry1),
            anchor(w - rx1, 0.0, 0.0, 0.0, rx1 * k, 0.0),
            anchor(w, ry1, 0.0, -ry1 * k, 0.0, 0.0),
            corner(w, 0.0),
        ),
        (
            rounded(rx2, ry2),
            anchor(w, h - ry2, 0.0, 0.0, 0.0, ry2 * k),
            anchor(w - rx2, h, rx2 * k, 0.0, 0.0, 0.0),
            corner(w, h),
        ),
        (
            rounded(rx3, ry3),
            anchor(rx3, h, 0.0, 0.0, -rx3 * k, 0.0),
            anchor(0.0, h - ry3, 0.0, ry3 * k, 0.0, 0.0),
            corner(0.0, h),
        ),
    ];
    // The cycle opens on the top-left arc's END (the top edge) and closes on its
    // START (the left edge) — the historic `rect_path` order.
    let mut anchors = Vec::with_capacity(8);
    let (tl_rounded, tl_start, tl_end, tl_sharp) = &arcs[0];
    anchors.push(if *tl_rounded { tl_end.clone() } else { tl_sharp.clone() });
    for (is_rounded, start, end, sharp) in &arcs[1..] {
        if *is_rounded {
            anchors.push(start.clone());
            anchors.push(end.clone());
        } else {
            anchors.push(sharp.clone());
        }
    }
    if *tl_rounded {
        anchors.push(tl_start.clone());
    }
    PathGeometry {
        closed: true,
        anchors,
    }
}

/// The uniform pair: every corner is the same (rx, ry) ellipse quarter.
pub fn rect_path(w: f32, h: f32, rx: f32, ry: f32) -> PathGeometry {
    rounded_rect(w, h, [(rx, ry); 4])
}

/// FOUR independent corner radii — [top-left, top-right, bottom-right,
/// bottom-left], Photoshop's live-shape corners (#450). Same builder and the
/// same per-axis clamp as `rect_path`, so four equal radii ARE the uniform pair.
pub fn rect_corner_path(w: f32, h: f32, radii: [f32; 4]) -> PathGeometry {
    rounded_rect(w, h, radii.map(|r| (r, r)))
}

pub fn ellipse_path(w: f32, h: f32) -> PathGeometry {
    let rx = w / 2.0;
    let ry = h / 2.0;
    let ox = rx * KAPPA;
    let oy = ry * KAPPA;
    PathGeometry {
        closed: true,
        anchors: vec![
            anchor(rx, 0.0, -ox, 0.0, ox, 0.0),
            anchor(w, ry, 0.0, -oy, 0.0, oy),
            anchor(rx, h, ox, 0.0, -ox, 0.0),
            anchor(0.0, ry, 0.0, oy, 0.0, -oy),
        ],
    }
}

pub fn polygon_path(radius: f32, sides: f32) -> PathGeometry {
    let n = (sides.round() as i32).max(3);
    let phase = -std::f32::consts::FRAC_PI_2;
    let anchors = (0..n)
        .map(|i| {
            let ang = phase + (i as f32 / n as f32) * std::f32::consts::TAU;
            corner(ang.cos() * radius, ang.sin() * radius)
        })
        .collect();
    PathGeometry {
        closed: true,
        anchors,
    }
}

pub fn star_path(radius1: f32, radius2: f32, points: f32) -> PathGeometry {
    let n = (points.round() as i32).max(3);
    let total = n * 2;
    let phase = -std::f32::consts::FRAC_PI_2;
    let anchors = (0..total)
        .map(|i| {
            let r = if i % 2 == 0 { radius1 } else { radius2 };
            let ang = phase + (i as f32 / total as f32) * std::f32::consts::TAU;
            corner(ang.cos() * r, ang.sin() * r)
        })
        .collect();
    PathGeometry {
        closed: true,
        anchors,
    }
}

pub fn line_path(x1: f32, y1: f32, x2: f32, y2: f32) -> PathGeometry {
    PathGeometry {
        closed: false,
        anchors: vec![corner(x1, y1), corner(x2, y2)],
    }
}

/// Outline subpaths of an item in LOCAL coordinates (empty for group/image/text).
pub fn local_paths(item: &Item) -> Vec<PathGeometry> {
    match item.kind.as_str() {
        "path" => item.geometry.clone().into_iter().collect(),
        "compound" => item.subpaths.clone().unwrap_or_default(),
        "rect" => vec![match item.radii[..] {
            [tl, tr, br, bl] => rect_corner_path(item.width, item.height, [tl, tr, br, bl]),
            _ => rect_path(item.width, item.height, item.rx, item.ry),
        }],
        "ellipse" => vec![ellipse_path(item.width, item.height)],
        "polygon" => vec![polygon_path(item.radius, item.sides)],
        "star" => vec![star_path(item.radius1, item.radius2, item.points)],
        "line" => vec![line_path(item.x1, item.y1, item.x2, item.y2)],
        _ => Vec::new(),
    }
}

/// Local-space bounds of an item (geometry only; ignores stroke width).
pub fn local_bounds(item: &Item) -> Option<Rect> {
    match item.kind.as_str() {
        "group" => {
            let children = item.children.as_deref().unwrap_or(&[]);
            let mut r: Option<Rect> = None;
            for child in children {
                if let Some(cb) = local_bounds(child) {
                    r = Some(geom::union(r, cb.transform(child.transform)));
                }
            }
            r
        }
        "rect" | "ellipse" | "image" => Some(Rect {
            x: 0.0,
            y: 0.0,
            w: item.width,
            h: item.height,
        }),
        "line" => Some(Rect::from_two_points(
            Point {
                x: item.x1,
                y: item.y1,
            },
            Point {
                x: item.x2,
                y: item.y2,
            },
        )),
        _ => {
            let mut r: Option<Rect> = None;
            for path in local_paths(item) {
                if let Some(b) = geom::bounds(&path) {
                    r = Some(geom::union(r, b));
                }
            }
            r
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vector::factory;
    use crate::vector::geom;
    use crate::vector::model::Matrix;

    fn pt(path: &PathGeometry, index: usize) -> (f32, f32) {
        let p = path.anchors[index].point;
        (p.x, p.y)
    }

    #[test]
    fn rect_path_switches_between_square_and_rounded_geometry() {
        let plain = rect_path(20.0, 10.0, 0.0, 4.0);
        assert!(plain.closed);
        assert_eq!(plain.anchors.len(), 4);
        assert_eq!(pt(&plain, 2), (20.0, 10.0));

        let rounded = rect_path(20.0, 10.0, 50.0, 50.0);
        assert!(rounded.closed);
        assert_eq!(rounded.anchors.len(), 8);
        assert_eq!(pt(&rounded, 0), (10.0, 0.0));
        assert_eq!(pt(&rounded, 2), (20.0, 5.0));
        assert!(rounded.anchors[1].handle_out.x > 0.0);
        assert!(rounded.anchors[7].handle_out.y < 0.0);
    }

    #[test]
    fn rect_corner_path_rounds_each_corner_independently() {
        // (#450) Photoshop's four live-shape corner radii: only the corners with
        // a radius round, and each rounds by its OWN amount. Same cycle as
        // rect_path: opens on the top-left arc's END, closes on its START.
        let mixed = rect_corner_path(40.0, 20.0, [4.0, 0.0, 8.0, 0.0]);
        assert!(mixed.closed);
        // 2 anchors for each rounded corner, 1 for each sharp one.
        assert_eq!(mixed.anchors.len(), 6);
        assert_eq!(pt(&mixed, 0), (4.0, 0.0)); // top-left arc end
        assert_eq!(pt(&mixed, 1), (40.0, 0.0)); // top-right stays a sharp corner
        assert_eq!(pt(&mixed, 2), (40.0, 12.0)); // bottom-right arc start (r = 8)
        assert_eq!(pt(&mixed, 3), (32.0, 20.0));
        assert_eq!(pt(&mixed, 4), (0.0, 20.0)); // bottom-left stays sharp
        assert_eq!(pt(&mixed, 5), (0.0, 4.0)); // top-left arc start
        assert!(mixed.anchors[0].handle_in.x < 0.0); // handles bend toward the corner
        assert!(mixed.anchors[5].handle_out.y < 0.0);

        // A degenerate/NaN size collapses instead of panicking, and a NaN radius
        // is a sharp corner.
        assert_eq!(rect_corner_path(f32::NAN, 10.0, [4.0; 4]).anchors.len(), 4);
        assert_eq!(rect_corner_path(-8.0, 10.0, [f32::NAN; 4]).anchors.len(), 4);
    }

    #[test]
    fn four_equal_radii_are_the_uniform_pair_under_one_per_axis_clamp() {
        // ONE clamp rule for both paths: rx ≤ w/2 and ry ≤ h/2 PER AXIS, the way
        // rect_path always did. On a 40×10 rect a radius of 8 keeps its 8 along
        // the long side and squashes to 5 along the short one — an elliptical
        // corner, NOT a 5×5 circle — so a scene flipping between the list and
        // the pair (uniform corners write the pair) never reshapes its corners.
        let four = rect_corner_path(40.0, 10.0, [8.0; 4]);
        let pair = rect_path(40.0, 10.0, 8.0, 8.0);
        assert_eq!(four, pair, "anchors AND handles, in the same order");
        assert_eq!(pt(&four, 0), (8.0, 0.0), "rx stays 8 along the 40 side");
        assert_eq!(pt(&four, 2), (40.0, 5.0), "ry clamps to 5 along the 10 side");
        assert_eq!(four.anchors[0].handle_in.x, -8.0 * KAPPA);
        assert_eq!(four.anchors[2].handle_in.y, -5.0 * KAPPA);
        // Oversized radii clamp per axis too — never to the short side alone.
        assert_eq!(rect_corner_path(40.0, 10.0, [999.0; 4]), rect_path(40.0, 10.0, 999.0, 999.0));
        assert_eq!(pt(&rect_corner_path(40.0, 10.0, [999.0; 4]), 0), (20.0, 0.0));
        // And the sharp rect is the sharp rect.
        assert_eq!(rect_corner_path(40.0, 10.0, [0.0; 4]), rect_path(40.0, 10.0, 0.0, 0.0));
    }

    #[test]
    fn rect_item_prefers_four_radii_over_the_uniform_pair() {
        let mut item = factory::default_item("rect");
        item.width = 40.0;
        item.height = 20.0;
        item.rx = 2.0;
        item.ry = 2.0;
        // No per-corner radii → the uniform pair still drives the geometry.
        assert_eq!(local_paths(&item)[0].anchors.len(), 8);
        item.radii = vec![4.0, 0.0, 0.0, 0.0];
        let one = &local_paths(&item)[0];
        assert_eq!(one.anchors.len(), 5, "one rounded corner, three sharp");
        assert_eq!((one.anchors[1].point.x, one.anchors[1].point.y), (40.0, 0.0));
        assert_eq!((one.anchors[4].point.x, one.anchors[4].point.y), (0.0, 4.0));
        // A malformed list (not four) falls back rather than dropping the shape.
        item.radii = vec![4.0, 4.0];
        assert_eq!(local_paths(&item)[0].anchors.len(), 8);
    }

    #[test]
    fn four_radii_survive_a_scene_json_round_trip() {
        let json = r#"{"type":"rect","id":"r","width":40,"height":20,"radii":[4,0,8,0]}"#;
        let item: Item = serde_json::from_str(json).expect("parse");
        assert_eq!(item.radii, vec![4.0, 0.0, 8.0, 0.0]);
        let back: Item = serde_json::from_str(&serde_json::to_string(&item).unwrap()).unwrap();
        assert_eq!(back.radii, vec![4.0, 0.0, 8.0, 0.0]);
        // A rect without them serializes none (no noise in every saved scene).
        let plain = factory::default_item("rect");
        assert!(!serde_json::to_string(&plain).unwrap().contains("radii"));
    }

    #[test]
    fn rect_path_collapses_degenerate_sizes_instead_of_panicking() {
        // (#120) A crafted/foreign scene with a negative size must not abort the
        // engine on render or hit-test.
        let negative = rect_path(-10.0, 20.0, 4.0, 4.0);
        assert_eq!(negative.anchors.len(), 4);
        assert_eq!(pt(&negative, 2), (0.0, 20.0));
        let both = rect_path(-10.0, -20.0, 0.0, 0.0);
        assert_eq!(pt(&both, 2), (0.0, 0.0));
        let nan = rect_path(f32::NAN, 10.0, 2.0, 2.0);
        assert_eq!(pt(&nan, 2), (0.0, 10.0));
    }

    #[test]
    fn live_shape_builders_emit_expected_topology() {
        let ellipse = ellipse_path(30.0, 10.0);
        assert_eq!(ellipse.anchors.len(), 4);
        assert_eq!(pt(&ellipse, 1), (30.0, 5.0));
        assert!(ellipse.anchors[0].handle_in.x < 0.0);

        let triangle = polygon_path(12.0, 2.0);
        assert_eq!(triangle.anchors.len(), 3);
        assert!((triangle.anchors[0].point.y + 12.0).abs() < 1e-5);

        let star = star_path(20.0, 8.0, 2.0);
        assert_eq!(star.anchors.len(), 6);
        assert!((star.anchors[0].point.y + 20.0).abs() < 1e-5);
        assert!(star.anchors[1].point.y > -20.0);

        let line = line_path(-1.0, 2.0, 3.0, 4.0);
        assert!(!line.closed);
        assert_eq!(line.anchors.len(), 2);
        assert_eq!(pt(&line, 0), (-1.0, 2.0));
        assert_eq!(pt(&line, 1), (3.0, 4.0));
    }

    #[test]
    fn local_paths_expands_each_shape_kind() {
        let mut path = factory::default_item("path");
        path.geometry = Some(line_path(0.0, 0.0, 1.0, 1.0));
        assert_eq!(local_paths(&path).len(), 1);

        let mut compound = factory::default_item("compound");
        compound.subpaths = Some(vec![
            line_path(0.0, 0.0, 1.0, 1.0),
            rect_path(1.0, 1.0, 0.0, 0.0),
        ]);
        assert_eq!(local_paths(&compound).len(), 2);

        let mut rect = factory::default_item("rect");
        rect.width = 3.0;
        rect.height = 4.0;
        assert_eq!(local_paths(&rect)[0].anchors.len(), 4);

        let mut ellipse = factory::default_item("ellipse");
        ellipse.width = 3.0;
        ellipse.height = 4.0;
        assert_eq!(local_paths(&ellipse)[0].anchors.len(), 4);

        let mut polygon = factory::default_item("polygon");
        polygon.radius = 5.0;
        polygon.sides = 5.0;
        assert_eq!(local_paths(&polygon)[0].anchors.len(), 5);

        let mut star = factory::default_item("star");
        star.radius1 = 5.0;
        star.radius2 = 2.0;
        star.points = 4.0;
        assert_eq!(local_paths(&star)[0].anchors.len(), 8);

        let mut line = factory::default_item("line");
        line.x1 = 1.0;
        line.y1 = 2.0;
        line.x2 = 3.0;
        line.y2 = 4.0;
        assert!(!local_paths(&line)[0].closed);

        let text = factory::default_item("text");
        assert!(local_paths(&text).is_empty());
    }

    #[test]
    fn local_bounds_handles_groups_lines_images_and_empty_items() {
        let mut rect = factory::default_item("rect");
        rect.id = "r".into();
        rect.width = 10.0;
        rect.height = 6.0;
        rect.transform = Matrix {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            e: 4.0,
            f: 5.0,
        };

        let mut line = factory::default_item("line");
        line.id = "l".into();
        line.x1 = -2.0;
        line.y1 = 8.0;
        line.x2 = 3.0;
        line.y2 = -1.0;

        let group = factory::make_group(vec![rect, line.clone()]);
        let b = local_bounds(&group).unwrap();
        assert_eq!(
            b,
            Rect {
                x: -2.0,
                y: -1.0,
                w: 16.0,
                h: 12.0
            }
        );

        assert_eq!(
            local_bounds(&line).unwrap(),
            Rect::from_two_points(Point { x: -2.0, y: 8.0 }, Point { x: 3.0, y: -1.0 })
        );

        let mut image = factory::default_item("image");
        image.width = 7.0;
        image.height = 8.0;
        assert_eq!(
            local_bounds(&image),
            Some(Rect {
                x: 0.0,
                y: 0.0,
                w: 7.0,
                h: 8.0
            })
        );

        let empty_group = factory::make_group(Vec::new());
        assert!(local_bounds(&empty_group).is_none());

        let mut unknown = factory::default_item("text");
        unknown.geometry = Some(geom::transform_geometry(
            &rect_path(1.0, 1.0, 0.0, 0.0),
            Matrix::default(),
        ));
        assert!(local_bounds(&unknown).is_none());
    }
}
