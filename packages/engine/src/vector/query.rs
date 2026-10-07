// ─────────────────────────────────────────────────────────────
// query — read-only document interrogation (Rust port of model/query.ts)
// ─────────────────────────────────────────────────────────────
// Walks the layer/item tree threading each item's world transform, and answers
// the geometry questions the tools/UI need: find by id, world bounds, hit-test
// (topmost item under a point), marquee, and selection/document bounds.
//
// Invariant (same as the TS engine): item ids are unique within a Document;
// find_item returns the FIRST match.

use crate::vector::geom::{self, Rect};
use crate::vector::model::{Document, Item, Matrix, Paint, Point};
use crate::vector::shapes::{local_bounds, local_paths};

fn is_fillable(kind: &str) -> bool {
    matches!(
        kind,
        "rect" | "ellipse" | "polygon" | "star" | "path" | "compound"
    )
}

/// Find an item by id, returning it plus its PARENT's world transform (so the
/// item's own world transform is `parent_world · item.transform`).
pub fn find_item<'a>(doc: &'a Document, id: &str) -> Option<(&'a Item, Matrix)> {
    for layer in &doc.layers {
        if let Some(r) = find_in(&layer.items, id, geom::m_identity()) {
            return Some(r);
        }
    }
    None
}

fn find_in<'a>(items: &'a [Item], id: &str, parent_world: Matrix) -> Option<(&'a Item, Matrix)> {
    for it in items {
        if it.id == id {
            return Some((it, parent_world));
        }
        if it.kind == "group" {
            if let Some(children) = &it.children {
                let w = geom::m_mul(parent_world, it.transform);
                if let Some(r) = find_in(children, id, w) {
                    return Some(r);
                }
            }
        }
    }
    None
}

/// World-space bounds of one item (geometry only).
pub fn world_bounds(doc: &Document, id: &str) -> Option<Rect> {
    let (item, parent_world) = find_item(doc, id)?;
    let lb = local_bounds(item)?;
    Some(lb.transform(geom::m_mul(parent_world, item.transform)))
}

/// Union of the world bounds of several ids.
pub fn selection_bounds(doc: &Document, ids: &[String]) -> Option<Rect> {
    let mut r: Option<Rect> = None;
    for id in ids {
        if let Some(b) = world_bounds(doc, id) {
            r = Some(geom::union(r, b));
        }
    }
    r
}

/// World bounds of the whole document (all artwork + artboards).
pub fn document_bounds(doc: &Document) -> Option<Rect> {
    let mut r: Option<Rect> = None;
    for ab in &doc.artboards {
        if ab.width > 0.0 && ab.height > 0.0 {
            r = Some(geom::union(
                r,
                Rect {
                    x: ab.x,
                    y: ab.y,
                    w: ab.width,
                    h: ab.height,
                },
            ));
        }
    }
    for layer in &doc.layers {
        collect_bounds(&layer.items, geom::m_identity(), &mut r);
    }
    r
}

fn collect_bounds(items: &[Item], parent_world: Matrix, out: &mut Option<Rect>) {
    for it in items {
        let w = geom::m_mul(parent_world, it.transform);
        if it.kind == "group" {
            if let Some(ch) = &it.children {
                collect_bounds(ch, w, out);
            }
        } else if let Some(lb) = local_bounds(it) {
            *out = Some(geom::union(*out, lb.transform(w)));
        }
    }
}

/// Selected ids in document paint order (bottom→top, depth-first).
pub fn order_ids(doc: &Document, ids: &[String]) -> Vec<String> {
    let set: std::collections::HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
    let mut out = Vec::new();
    for layer in &doc.layers {
        order_in(&layer.items, &set, &mut out);
    }
    out
}
fn order_in(items: &[Item], set: &std::collections::HashSet<&str>, out: &mut Vec<String>) {
    for it in items {
        if set.contains(it.id.as_str()) {
            out.push(it.id.clone());
        }
        if it.kind == "group" {
            if let Some(ch) = &it.children {
                order_in(ch, set, out);
            }
        }
    }
}

/// Topmost item id under a world-space point (within `tol` device-ish units),
/// front-to-back across layers and z-order.
pub fn hit_test(doc: &Document, world: Point, tol: f32) -> Option<String> {
    for layer in doc.layers.iter().rev() {
        if !layer.visible || layer.locked || layer.template {
            continue;
        }
        if let Some(id) = hit_items(&layer.items, world, tol, geom::m_identity()) {
            return Some(id);
        }
    }
    None
}

fn hit_items(items: &[Item], world: Point, tol: f32, parent_world: Matrix) -> Option<String> {
    for it in items.iter().rev() {
        // (#124) Item-level lock has to block click-select too, not just the
        // marquee (marquee_items below) — otherwise the tools happily translate
        // and edit an item the user locked.
        if !it.visible || it.locked {
            continue;
        }
        let w = geom::m_mul(parent_world, it.transform);
        if it.kind == "group" {
            if let Some(children) = &it.children {
                if let Some(id) = hit_items(children, world, tol, w) {
                    return Some(id);
                }
            }
            continue;
        }
        if leaf_hit(it, world, w, tol) {
            return Some(it.id.clone());
        }
    }
    None
}

fn leaf_hit(item: &Item, world: Point, world_t: Matrix, tol: f32) -> bool {
    let Some(inv) = geom::m_invert(world_t) else {
        return false;
    };
    let local = geom::apply_point(inv, world);
    let scale = geom::mean_scale(world_t).max(1e-6);
    let local_tol = tol / scale;
    let half_stroke = if matches!(item.stroke.paint, Paint::None) {
        0.0
    } else {
        item.stroke.width / 2.0
    };
    let paths = local_paths(item);
    // The FILL is decided across every subpath at once — a compound path's hole
    // is only a hole because its rings combine. Testing each ring on its own
    // reports a hit in the middle of a donut, where the renderer paints nothing.
    if is_fillable(&item.kind) && !matches!(item.fill, Paint::None) {
        let filled = if item.even_odd {
            paths
                .iter()
                .filter(|p| geom::contains_point(p, local, true))
                .count()
                % 2
                == 1
        } else {
            paths.iter().map(|p| geom::winding_number(p, local)).sum::<i32>() != 0
        };
        if filled {
            return true;
        }
    }
    // The OUTLINE is per subpath: every ring is drawn, hole or not.
    paths
        .iter()
        .any(|p| geom::distance_to_outline(p, local) <= local_tol + half_stroke)
}

/// Ids of items whose world AABB intersects (`crossing`) or is contained by
/// (`window`) the marquee rect.
pub fn items_in_rect(doc: &Document, marquee: Rect, crossing: bool) -> Vec<String> {
    let mut out = Vec::new();
    for layer in &doc.layers {
        if !layer.visible || layer.locked || layer.template {
            continue;
        }
        marquee_items(
            &layer.items,
            marquee,
            crossing,
            geom::m_identity(),
            &mut out,
        );
    }
    out
}

fn marquee_items(
    items: &[Item],
    marquee: Rect,
    crossing: bool,
    parent_world: Matrix,
    out: &mut Vec<String>,
) {
    for it in items {
        if !it.visible || it.locked {
            continue;
        }
        let w = geom::m_mul(parent_world, it.transform);
        let Some(lb) = local_bounds(it) else { continue };
        let wb = lb.transform(w);
        let hit = if crossing {
            rects_intersect(wb, marquee)
        } else {
            rect_contains(marquee, wb)
        };
        if hit {
            out.push(it.id.clone());
        } else if it.kind == "group" {
            if let Some(ch) = &it.children {
                marquee_items(ch, marquee, crossing, w, out);
            }
        }
    }
}

fn rects_intersect(a: Rect, b: Rect) -> bool {
    a.x < b.right() && b.x < a.right() && a.y < b.bottom() && b.y < a.bottom()
}
fn rect_contains(outer: Rect, inner: Rect) -> bool {
    inner.x >= outer.x
        && inner.y >= outer.y
        && inner.right() <= outer.right()
        && inner.bottom() <= outer.bottom()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc_with_two_rects() -> Document {
        // rect A at (10,10) 40x30 id="a"; rect B at (100,100) 20x20 id="b"
        let json = r#"{"artboards":[{"x":0,"y":0,"width":200,"height":200}],"layers":[{"visible":true,"items":[
            {"type":"rect","id":"a","transform":{"a":1,"b":0,"c":0,"d":1,"e":10,"f":10},
             "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},"width":40,"height":30},
            {"type":"rect","id":"b","transform":{"a":1,"b":0,"c":0,"d":1,"e":100,"f":100},
             "fill":{"type":"solid","color":{"r":0,"g":0,"b":255,"a":1}},"width":20,"height":20}
        ]}]}"#;
        Document::parse(json).unwrap()
    }

    #[test]
    fn find_and_world_bounds() {
        let doc = doc_with_two_rects();
        assert!(find_item(&doc, "a").is_some());
        assert!(find_item(&doc, "nope").is_none());
        let b = world_bounds(&doc, "a").unwrap();
        assert_eq!(
            b,
            Rect {
                x: 10.0,
                y: 10.0,
                w: 40.0,
                h: 30.0
            }
        );
    }

    #[test]
    fn hit_test_picks_topmost() {
        let doc = doc_with_two_rects();
        // Inside rect A's fill.
        assert_eq!(
            hit_test(&doc, Point { x: 20.0, y: 20.0 }, 4.0).as_deref(),
            Some("a")
        );
        // Inside rect B.
        assert_eq!(
            hit_test(&doc, Point { x: 110.0, y: 110.0 }, 4.0).as_deref(),
            Some("b")
        );
        // Empty space.
        assert_eq!(hit_test(&doc, Point { x: 80.0, y: 80.0 }, 4.0), None);
    }

    #[test]
    fn locked_items_are_unclickable_like_they_are_unmarqueeable() {
        // (#124) hit_items filtered only on `visible`, so click-select handed the
        // tools a locked item the marquee refuses to touch.
        let json = r#"{"artboards":[],"layers":[{"visible":true,"items":[
            {"type":"rect","id":"free","transform":{"a":1,"b":0,"c":0,"d":1,"e":10,"f":10},
             "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},"width":40,"height":30},
            {"type":"rect","id":"pinned","locked":true,"transform":{"a":1,"b":0,"c":0,"d":1,"e":100,"f":100},
             "fill":{"type":"solid","color":{"r":0,"g":0,"b":255,"a":1}},"width":20,"height":20}
        ]}]}"#;
        let doc = Document::parse(json).unwrap();
        assert_eq!(
            hit_test(&doc, Point { x: 20.0, y: 20.0 }, 4.0).as_deref(),
            Some("free")
        );
        assert_eq!(hit_test(&doc, Point { x: 110.0, y: 110.0 }, 4.0), None);
        // …and the marquee agrees.
        let all = items_in_rect(
            &doc,
            Rect {
                x: 0.0,
                y: 0.0,
                w: 200.0,
                h: 200.0,
            },
            true,
        );
        assert_eq!(all, vec!["free".to_string()]);
    }

    #[test]
    fn marquee_window_vs_crossing() {
        let doc = doc_with_two_rects();
        // Window fully containing only A.
        let win = items_in_rect(
            &doc,
            Rect {
                x: 0.0,
                y: 0.0,
                w: 60.0,
                h: 60.0,
            },
            false,
        );
        assert_eq!(win, vec!["a".to_string()]);
        // Crossing that clips A but not B.
        let cross = items_in_rect(
            &doc,
            Rect {
                x: 0.0,
                y: 0.0,
                w: 15.0,
                h: 15.0,
            },
            true,
        );
        assert_eq!(cross, vec!["a".to_string()]);
    }

    #[test]
    fn document_bounds_covers_artboard() {
        let doc = doc_with_two_rects();
        let b = document_bounds(&doc).unwrap();
        assert_eq!(
            b,
            Rect {
                x: 0.0,
                y: 0.0,
                w: 200.0,
                h: 200.0
            }
        );
    }
}
