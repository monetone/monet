// ─────────────────────────────────────────────────────────────
// pathfinder — boolean shape ops (Rust port of ops/pathfinder shape modes)
// ─────────────────────────────────────────────────────────────
// Operates on the FLATTENED, world-space outlines of the selected items via the
// i_overlay boolean-clipping library, replacing them with one compound path —
// matching the TS engine's unite/minus-front/intersect/exclude/minus-back.
// (The GROUP-producing pathfinders divide/trim/merge/crop/outline are not yet
// ported — they need the full planar-arrangement pass.)

use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::float::simplify::SimplifyShape;
use i_overlay::float::single::SingleFloatOverlay;

use crate::vector::model::{Anchor, Document, Item, PathGeometry, Point};
use crate::vector::{factory, geom, ops, query, shapes};

type Contour = Vec<[f64; 2]>;

fn item_world_contours(doc: &Document, id: &str) -> Vec<Contour> {
    let Some((item, pw)) = query::find_item(doc, id) else {
        return Vec::new();
    };
    let world = geom::m_mul(pw, item.transform);
    let mut out = Vec::new();
    for sp in shapes::local_paths(item) {
        // (#19) Flatten in WORLD space: flattening first meant the 0.3 tolerance
        // was in pre-transform units, so a curve on a scaled-up item was faceted
        // by 0.3 × scale document pixels.
        let poly = geom::flatten(&geom::transform_geometry(&sp, world), 0.3);
        let mut ring: Contour = poly.iter().map(|p| [p.x as f64, p.y as f64]).collect();
        // i_overlay auto-closes; a trailing duplicate point is a degenerate edge.
        if ring.len() > 1 && ring[0] == ring[ring.len() - 1] {
            ring.pop();
        }
        if ring.len() >= 3 {
            out.push(ring);
        }
    }
    // (#121) The renderer fills an even-odd item with FillRule::EvenOdd, but the
    // booleans below evaluate every input as NonZero. An authored even-odd
    // compound whose subpaths share winding (a donut) would silently lose its
    // hole, so normalize its rings to nonzero-equivalent winding first.
    if item.even_odd && out.len() > 1 {
        out = out
            .simplify_shape(FillRule::EvenOdd, 0.0)
            .into_iter()
            .flatten()
            .collect();
    }
    out
}

/// The ids that actually fed the boolean. Only these are consumed — a selected
/// item with no flattenable outline (a group, an image) contributes nothing, so
/// removing it too would delete art the op never used.
fn consumed_ids(entries: &[(String, Vec<Contour>)]) -> Vec<String> {
    entries.iter().map(|(id, _)| id.clone()).collect()
}

/// (#129) Where the result belongs: the slot the frontmost consumed top-level
/// item occupied, corrected for the consumed items removed below it. Pushing to
/// the last layer instead (as this used to) reorders the art and can drop it
/// into a hidden/template layer, where it vanishes after the sources are gone.
/// `None` when nothing consumed sat at the top level (all nested in groups).
fn result_slot(doc: &Document, consumed: &[String]) -> Option<(usize, usize)> {
    let (li, ii) = consumed
        .iter()
        .rev()
        .find_map(|id| ops::top_level_pos(doc, id))?;
    let below = consumed
        .iter()
        .filter_map(|id| ops::top_level_pos(doc, id))
        .filter(|(l, i)| *l == li && *i < ii)
        .count();
    Some((li, ii - below))
}

/// Insert a pathfinder result at `slot`, falling back to the topmost layer.
fn place_result(doc: &mut Document, item: Item, slot: Option<(usize, usize)>) {
    if let Some((li, ii)) = slot {
        if let Some(layer) = doc.layers.get_mut(li) {
            let at = ii.min(layer.items.len());
            layer.items.insert(at, item);
            return;
        }
    }
    if let Some(layer) = doc.layers.last_mut() {
        layer.items.push(item);
    }
}

fn boolean(subj: &[Contour], clip: &[Contour], rule: OverlayRule) -> Vec<Contour> {
    let shapes = subj
        .to_vec()
        .overlay(&clip.to_vec(), rule, FillRule::NonZero);
    // shapes: Vec<Shape> where Shape = Vec<Contour>; flatten to a contour list.
    shapes.into_iter().flatten().collect()
}

fn contours_to_subpaths(contours: &[Contour]) -> Vec<PathGeometry> {
    let mut out = Vec::new();
    for ring in contours {
        let mut pts = ring.clone();
        if pts.len() > 1 && pts[0] == pts[pts.len() - 1] {
            pts.pop();
        }
        if pts.len() < 3 {
            continue;
        }
        let anchors = pts
            .iter()
            .map(|[x, y]| Anchor {
                point: Point {
                    x: *x as f32,
                    y: *y as f32,
                },
                handle_in: Point::default(),
                handle_out: Point::default(),
            })
            .collect();
        out.push(PathGeometry {
            closed: true,
            anchors,
        });
    }
    out
}

fn make_compound_item(
    subpaths: Vec<PathGeometry>,
    fill: crate::vector::model::Paint,
    stroke: crate::vector::model::Stroke,
    opacity: f32,
    counter: &mut u64,
) -> Item {
    let mut comp = factory::default_item("compound");
    comp.subpaths = Some(subpaths);
    comp.fill = fill;
    comp.stroke = stroke;
    comp.opacity = opacity;
    comp.even_odd = true;
    *counter += 1;
    comp.id = format!("c{counter}");
    comp
}

fn item_style(
    doc: &Document,
    id: &str,
) -> (
    crate::vector::model::Paint,
    crate::vector::model::Stroke,
    f32,
) {
    query::find_item(doc, id)
        .map(|(it, _)| (it.fill.clone(), it.stroke.clone(), it.opacity))
        .unwrap_or((
            crate::vector::model::Paint::None,
            crate::vector::model::Stroke::default(),
            1.0,
        ))
}

/// GROUP-producing pathfinders. `trim` removes each object's parts hidden behind
/// objects in front of it; `crop` keeps only art inside the frontmost object.
/// (divide/merge/outline are not yet ported.) Returns the new group id.
pub fn pathfinder_group(
    doc: &mut Document,
    ids: &[String],
    op: &str,
    counter: &mut u64,
) -> Option<String> {
    let ordered = query::order_ids(doc, ids); // bottom→top
    let mut entries: Vec<(String, Vec<Contour>)> = Vec::new();
    for id in &ordered {
        let c = item_world_contours(doc, id);
        if !c.is_empty() {
            entries.push((id.clone(), c));
        }
    }
    if entries.len() < 2 {
        return None;
    }

    let mut pieces: Vec<Item> = Vec::new();
    match op {
        "crop" => {
            let front = entries.last().unwrap().1.clone();
            for (id, c) in &entries[..entries.len() - 1] {
                let r = boolean(c, &front, OverlayRule::Intersect);
                let subs = contours_to_subpaths(&r);
                if !subs.is_empty() {
                    let (f, s, o) = item_style(doc, id);
                    pieces.push(make_compound_item(subs, f, s, o, counter));
                }
            }
        }
        "trim" => {
            for i in 0..entries.len() {
                let mut r = entries[i].1.clone();
                for j in i + 1..entries.len() {
                    r = boolean(&r, &entries[j].1, OverlayRule::Difference);
                }
                let subs = contours_to_subpaths(&r);
                if !subs.is_empty() {
                    let (f, s, o) = item_style(doc, &entries[i].0);
                    pieces.push(make_compound_item(subs, f, s, o, counter));
                }
            }
        }
        "divide" => {
            // Build the planar arrangement incrementally: split every accumulated
            // region by each shape into inside/outside parts.
            let all: Vec<&Vec<Contour>> = entries.iter().map(|(_, c)| c).collect();
            let mut regions: Vec<Vec<Contour>> = vec![all[0].clone()];
            let mut union_so_far = all[0].clone();
            for si in &all[1..] {
                let mut next: Vec<Vec<Contour>> = Vec::new();
                for r in &regions {
                    let inter = boolean(r, si, OverlayRule::Intersect);
                    if !inter.is_empty() {
                        next.push(inter);
                    }
                    let diff = boolean(r, si, OverlayRule::Difference);
                    if !diff.is_empty() {
                        next.push(diff);
                    }
                }
                let si_outside = boolean(si, &union_so_far, OverlayRule::Difference);
                if !si_outside.is_empty() {
                    next.push(si_outside);
                }
                union_so_far = boolean(&union_so_far, si, OverlayRule::Union);
                regions = next;
            }
            for region in regions {
                let subs = contours_to_subpaths(&region);
                if subs.is_empty() {
                    continue;
                }
                // Style each face by the TOPMOST shape covering it (Illustrator parity).
                let mut style = item_style(doc, &entries[0].0);
                for (id, c) in entries.iter().rev() {
                    if !boolean(&region, c, OverlayRule::Intersect).is_empty() {
                        style = item_style(doc, id);
                        break;
                    }
                }
                pieces.push(make_compound_item(subs, style.0, style.1, style.2, counter));
            }
        }
        "merge" => {
            // Trim, then union the trimmed pieces that share a fill.
            let mut groups: Vec<(
                String,
                Vec<Contour>,
                (
                    crate::vector::model::Paint,
                    crate::vector::model::Stroke,
                    f32,
                ),
            )> = Vec::new();
            for i in 0..entries.len() {
                let mut r = entries[i].1.clone();
                for j in i + 1..entries.len() {
                    r = boolean(&r, &entries[j].1, OverlayRule::Difference);
                }
                if r.is_empty() {
                    continue;
                }
                let style = item_style(doc, &entries[i].0);
                let key = serde_json::to_string(&style.0).unwrap_or_default();
                if let Some(grp) = groups.iter_mut().find(|g| g.0 == key) {
                    grp.1 = boolean(&grp.1, &r, OverlayRule::Union);
                } else {
                    groups.push((key, r, style));
                }
            }
            for (_, contours, (f, s, o)) in groups {
                let subs = contours_to_subpaths(&contours);
                if !subs.is_empty() {
                    pieces.push(make_compound_item(subs, f, s, o, counter));
                }
            }
        }
        _ => return None,
    }

    if pieces.is_empty() {
        return None;
    }
    let consumed = consumed_ids(&entries);
    let slot = result_slot(doc, &consumed);
    ops::remove_items(doc, &consumed);
    let mut g = factory::make_group(pieces);
    *counter += 1;
    g.id = format!("g{counter}");
    let id = g.id.clone();
    place_result(doc, g, slot);
    Some(id)
}

/// Apply a boolean op, replacing the selected items with one compound path.
/// op ∈ unite|minus-front|intersect|exclude|minus-back. Returns the new id.
pub fn pathfinder(
    doc: &mut Document,
    ids: &[String],
    op: &str,
    counter: &mut u64,
) -> Option<String> {
    if matches!(op, "divide" | "trim" | "merge" | "crop" | "outline") {
        return pathfinder_group(doc, ids, op, counter);
    }
    let ordered = query::order_ids(doc, ids);
    if ordered.len() < 2 {
        return None;
    }
    let mut entries: Vec<(String, Vec<Contour>)> = Vec::new();
    for id in &ordered {
        let c = item_world_contours(doc, id);
        if !c.is_empty() {
            entries.push((id.clone(), c));
        }
    }
    if entries.len() < 2 {
        return None;
    }

    let result: Vec<Contour> = match op {
        "unite" => fold(&entries, 0, OverlayRule::Union),
        "intersect" => fold(&entries, 0, OverlayRule::Intersect),
        "exclude" => fold(&entries, 0, OverlayRule::Xor),
        "minus-front" => fold(&entries, 0, OverlayRule::Difference),
        "minus-back" => fold_back(&entries),
        _ => return None,
    };

    let subpaths = contours_to_subpaths(&result);
    if subpaths.is_empty() {
        ops::remove_items(doc, &consumed_ids(&entries));
        return None;
    }

    // Style source: topmost survivor, except minus-front keeps the back-most.
    let style_id = if op == "minus-front" {
        entries.first()
    } else {
        entries.last()
    }
    .map(|(id, _)| id.clone());
    let (fill, stroke) = style_id
        .as_deref()
        .and_then(|sid| query::find_item(doc, sid))
        .map(|(it, _)| (it.fill.clone(), it.stroke.clone()))
        .unwrap_or((
            crate::vector::model::Paint::None,
            crate::vector::model::Stroke::default(),
        ));

    let consumed = consumed_ids(&entries);
    let slot = result_slot(doc, &consumed);
    ops::remove_items(doc, &consumed);

    let mut comp = factory::default_item("compound");
    comp.subpaths = Some(subpaths);
    comp.fill = fill;
    comp.stroke = stroke;
    comp.even_odd = true;
    *counter += 1;
    comp.id = format!("c{counter}");
    let id = comp.id.clone();
    place_result(doc, comp, slot);
    Some(id)
}

fn fold(entries: &[(String, Vec<Contour>)], start: usize, rule: OverlayRule) -> Vec<Contour> {
    let mut acc = entries[start].1.clone();
    for (_, c) in &entries[start + 1..] {
        acc = boolean(&acc, c, rule);
    }
    acc
}

fn fold_back(entries: &[(String, Vec<Contour>)]) -> Vec<Contour> {
    let last = entries.len() - 1;
    let mut acc = entries[last].1.clone();
    for (_, c) in &entries[..last] {
        acc = boolean(&acc, c, OverlayRule::Difference);
    }
    acc
}

#[cfg(test)]
mod tests {
    use super::*;

    fn two_overlapping_squares() -> Document {
        // square A (0..50) and B (25..75) overlapping; expect union area > either.
        let json = r#"{"artboards":[],"layers":[{"visible":true,"items":[
            {"type":"rect","id":"a","fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},"width":50,"height":50},
            {"type":"rect","id":"b","transform":{"a":1,"b":0,"c":0,"d":1,"e":25,"f":25},"fill":{"type":"solid","color":{"r":0,"g":0,"b":255,"a":1}},"width":50,"height":50}
        ]}]}"#;
        Document::parse(json).unwrap()
    }

    #[test]
    fn unite_two_squares_makes_one_compound() {
        let mut d = two_overlapping_squares();
        let mut counter = 0u64;
        let id = pathfinder(&mut d, &["a".into(), "b".into()], "unite", &mut counter).unwrap();
        assert_eq!(d.layers[0].items.len(), 1);
        let (it, _) = query::find_item(&d, &id).unwrap();
        assert_eq!(it.kind, "compound");
        // Union of two 50x50 squares overlapping by 25 → bbox 75x75.
        let b = query::world_bounds(&d, &id).unwrap();
        assert!(
            (b.w - 75.0).abs() < 0.5 && (b.h - 75.0).abs() < 0.5,
            "union bbox {:?}",
            b
        );
    }

    #[test]
    fn a_selected_group_is_not_eaten_by_a_boolean_it_never_fed() {
        // A group has no flattenable outline of its own, so it contributes no
        // contours — consuming it anyway would delete art the op never used.
        let json = r#"{"artboards":[],"layers":[{"visible":true,"items":[
            {"type":"rect","id":"a","width":50,"height":50},
            {"type":"rect","id":"b","transform":{"a":1,"b":0,"c":0,"d":1,"e":25,"f":25},"width":50,"height":50},
            {"type":"group","id":"g","children":[{"type":"rect","id":"c","width":10,"height":10}]}
        ]}]}"#;
        let mut d = Document::parse(json).unwrap();
        let mut counter = 0u64;
        let id = pathfinder(
            &mut d,
            &["a".into(), "b".into(), "g".into()],
            "unite",
            &mut counter,
        )
        .unwrap();
        assert!(query::find_item(&d, &id).is_some(), "no compound produced");
        assert!(query::find_item(&d, "a").is_none(), "a should be consumed");
        assert!(query::find_item(&d, "g").is_some(), "group was eaten");
    }

    #[test]
    fn intersect_two_squares_is_the_overlap() {
        let mut d = two_overlapping_squares();
        let mut counter = 0u64;
        let id = pathfinder(&mut d, &["a".into(), "b".into()], "intersect", &mut counter).unwrap();
        let b = query::world_bounds(&d, &id).unwrap();
        // Overlap region is 25x25 at (25,25).
        assert!(
            (b.w - 25.0).abs() < 0.5 && (b.h - 25.0).abs() < 0.5,
            "intersect bbox {:?}",
            b
        );
    }

    #[test]
    fn crop_keeps_only_overlap_inside_front() {
        let mut d = two_overlapping_squares();
        let mut counter = 0u64;
        let gid = pathfinder(&mut d, &["a".into(), "b".into()], "crop", &mut counter).unwrap();
        let (g, _) = query::find_item(&d, &gid).unwrap();
        assert_eq!(g.kind, "group");
        // Only a∩b survives (b is the frontmost, consumed) → one piece.
        assert_eq!(g.children.as_ref().unwrap().len(), 1);
        let b = query::world_bounds(&d, &gid).unwrap();
        assert!(
            (b.w - 25.0).abs() < 0.5 && (b.h - 25.0).abs() < 0.5,
            "crop bbox {:?}",
            b
        );
    }

    #[test]
    fn divide_two_squares_into_three_faces() {
        let mut d = two_overlapping_squares();
        let mut counter = 0u64;
        let gid = pathfinder(&mut d, &["a".into(), "b".into()], "divide", &mut counter).unwrap();
        let (g, _) = query::find_item(&d, &gid).unwrap();
        assert_eq!(g.kind, "group");
        // A−B, A∩B, B−A → three faces.
        assert_eq!(g.children.as_ref().unwrap().len(), 3);
    }

    #[test]
    fn scaled_curves_are_flattened_in_world_space() {
        // (#19) A unit circle scaled 100× used to be flattened with the 0.3
        // tolerance in LOCAL units (0.3 × 100 px of error) → an octagon.
        let json = r#"{"artboards":[],"layers":[{"visible":true,"items":[
            {"type":"ellipse","id":"e","transform":{"a":100,"b":0,"c":0,"d":100,"e":0,"f":0},"width":2,"height":2},
            {"type":"rect","id":"r","transform":{"a":1,"b":0,"c":0,"d":1,"e":90,"f":90},"width":20,"height":20}
        ]}]}"#;
        let mut d = Document::parse(json).unwrap();
        let mut counter = 0u64;
        let id = pathfinder(&mut d, &["e".into(), "r".into()], "unite", &mut counter).unwrap();
        let (it, _) = query::find_item(&d, &id).unwrap();
        let subs = it.subpaths.as_ref().unwrap();
        assert_eq!(subs.len(), 1, "union of a circle and an enclosed rect");
        // True area is π·100² = 31416; the local-space flatten gave 28284 (octagon).
        let area = geom::signed_area(&subs[0]).abs();
        assert!(area > 31_000.0, "faceted union area {area}");
    }

    #[test]
    fn even_odd_compound_keeps_its_hole_through_a_boolean() {
        // (#121) A donut authored as two SAME-winding rings + even_odd renders
        // with a hole; the boolean evaluated every input as NonZero and filled it.
        let mut d =
            Document::parse(r#"{"artboards":[],"layers":[{"visible":true,"items":[]}]}"#).unwrap();
        let mut donut = factory::default_item("compound");
        donut.id = "d".into();
        donut.even_odd = true;
        donut.subpaths = Some(vec![
            shapes::rect_path(100.0, 100.0, 0.0, 0.0),
            geom::transform_geometry(
                &shapes::rect_path(50.0, 50.0, 0.0, 0.0),
                geom::m_translation(25.0, 25.0),
            ),
        ]);
        let mut far = factory::default_item("rect");
        far.id = "r".into();
        far.width = 10.0;
        far.height = 10.0;
        far.transform = geom::m_translation(200.0, 200.0);
        d.layers[0].items.push(donut);
        d.layers[0].items.push(far);

        let mut counter = 0u64;
        let id = pathfinder(&mut d, &["d".into(), "r".into()], "unite", &mut counter).unwrap();
        let (it, _) = query::find_item(&d, &id).unwrap();
        let subs = it.subpaths.as_ref().unwrap();
        // Holes come back with the opposite winding, so the signed areas cancel:
        // 100² − 50² + 10² = 7600. Losing the hole would give 10100.
        let total: f32 = subs.iter().map(geom::signed_area).sum();
        assert!(
            (total.abs() - 7600.0).abs() < 5.0,
            "hole lost: signed area {total} from {} subpaths",
            subs.len()
        );
    }

    #[test]
    fn result_stays_on_the_source_layer() {
        // (#129) The result used to be pushed onto the LAST layer — reordering the
        // art, and vanishing entirely when that layer is hidden or a template.
        let json = r#"{"artboards":[],"layers":[
            {"visible":true,"items":[
                {"type":"rect","id":"a","width":50,"height":50},
                {"type":"rect","id":"b","transform":{"a":1,"b":0,"c":0,"d":1,"e":25,"f":25},"width":50,"height":50},
                {"type":"rect","id":"top","transform":{"a":1,"b":0,"c":0,"d":1,"e":300,"f":300},"width":10,"height":10}
            ]},
            {"visible":false,"items":[]}
        ]}"#;
        let mut d = Document::parse(json).unwrap();
        let mut counter = 0u64;
        let id = pathfinder(&mut d, &["a".into(), "b".into()], "unite", &mut counter).unwrap();
        assert!(
            d.layers[1].items.is_empty(),
            "result dumped on the hidden top layer"
        );
        assert_eq!(d.layers[0].items.len(), 2);
        // b was the frontmost consumed item; with a removed below it the result
        // lands at index 0 — still under "top", exactly where b sat.
        assert_eq!(d.layers[0].items[0].id, id);
        assert_eq!(d.layers[0].items[1].id, "top");
    }

    #[test]
    fn trim_produces_a_group_of_pieces() {
        let mut d = two_overlapping_squares();
        let mut counter = 0u64;
        let gid = pathfinder(&mut d, &["a".into(), "b".into()], "trim", &mut counter).unwrap();
        let (g, _) = query::find_item(&d, &gid).unwrap();
        assert_eq!(g.kind, "group");
        // A-minus-B (L-shape) + B (whole) → two pieces.
        assert_eq!(g.children.as_ref().unwrap().len(), 2);
    }
}
