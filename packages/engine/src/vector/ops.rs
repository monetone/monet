// ─────────────────────────────────────────────────────────────
// ops — document mutations (Rust port of engine/ops/*)
// ─────────────────────────────────────────────────────────────
// Operate on an owned &mut Document by item id. World-space transforms are
// re-expressed into each item's parent space (matching TS transformItems), so
// nested items move correctly. The store (lib.rs) wraps these with undo snapshots.

use std::collections::{HashMap, HashSet};

use crate::vector::geom;
use crate::vector::model::{Anchor, Document, Item, Matrix, Paint, PathGeometry, Point};
use crate::vector::query;

/// Mutable find: returns the item plus its PARENT's world transform. Implemented
/// as an immutable locate (index path + parent world) followed by a by-index
/// descent — sidesteps the borrow-checker limit on returning `&mut` from a loop.
pub fn find_mut<'a>(doc: &'a mut Document, id: &str) -> Option<(&'a mut Item, Matrix)> {
    let (li, path, pw) = locate(doc, id)?;
    let mut items = &mut doc.layers[li].items;
    for &i in &path[..path.len() - 1] {
        items = items[i].children.as_mut()?;
    }
    let last = *path.last()?;
    Some((&mut items[last], pw))
}

fn locate(doc: &Document, id: &str) -> Option<(usize, Vec<usize>, Matrix)> {
    for (li, layer) in doc.layers.iter().enumerate() {
        if let Some((path, pw)) = locate_in(&layer.items, id, geom::m_identity()) {
            return Some((li, path, pw));
        }
    }
    None
}

fn locate_in(items: &[Item], id: &str, parent_world: Matrix) -> Option<(Vec<usize>, Matrix)> {
    for (i, it) in items.iter().enumerate() {
        if it.id == id {
            return Some((vec![i], parent_world));
        }
        if it.kind == "group" {
            if let Some(ch) = &it.children {
                let w = geom::m_mul(parent_world, it.transform);
                if let Some((mut sub, spw)) = locate_in(ch, id, w) {
                    let mut path = vec![i];
                    path.append(&mut sub);
                    return Some((path, spw));
                }
            }
        }
    }
    None
}

fn for_each_id<F: FnMut(&mut Item)>(doc: &mut Document, ids: &[String], mut f: F) {
    for id in ids {
        if let Some((item, _)) = find_mut(doc, id) {
            f(item);
        }
    }
}

/// Apply a WORLD-space matrix to each item (its local transform is rewritten so
/// the world result is `m · oldWorld`).
pub fn transform_items(doc: &mut Document, ids: &[String], m: Matrix) {
    for id in ids {
        if let Some((item, pw)) = find_mut(doc, id) {
            if let Some(ipw) = geom::m_invert(pw) {
                item.transform = geom::m_mul(ipw, geom::m_mul(m, geom::m_mul(pw, item.transform)));
            }
        }
    }
}

pub fn translate_items(doc: &mut Document, ids: &[String], dx: f32, dy: f32) {
    transform_items(doc, ids, geom::m_translation(dx, dy));
}

/// Scale/rotate around a world-space pivot.
pub fn transform_around(
    doc: &mut Document,
    ids: &[String],
    pivot: crate::vector::model::Point,
    m: Matrix,
) {
    let to = geom::m_translation(pivot.x, pivot.y);
    let from = geom::m_translation(-pivot.x, -pivot.y);
    transform_items(doc, ids, geom::m_mul(to, geom::m_mul(m, from)));
}

pub fn remove_items(doc: &mut Document, ids: &[String]) {
    let set: HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
    for layer in &mut doc.layers {
        prune(&mut layer.items, &set);
    }
}

fn prune(items: &mut Vec<Item>, set: &HashSet<&str>) {
    items.retain(|it| !set.contains(it.id.as_str()));
    for it in items.iter_mut() {
        if it.kind == "group" {
            if let Some(ch) = it.children.as_mut() {
                prune(ch, set);
            }
        }
    }
}

pub fn set_fill(doc: &mut Document, ids: &[String], paint: &Paint) {
    for_each_id(doc, ids, |it| apply_fill(it, paint));
}
fn apply_fill(it: &mut Item, paint: &Paint) {
    if it.kind == "group" {
        if let Some(ch) = it.children.as_mut() {
            for c in ch {
                apply_fill(c, paint);
            }
        }
    } else {
        it.fill = paint.clone();
    }
}

pub fn set_stroke_paint(doc: &mut Document, ids: &[String], paint: &Paint) {
    for_each_id(doc, ids, |it| apply_stroke_paint(it, paint));
}
fn apply_stroke_paint(it: &mut Item, paint: &Paint) {
    if it.kind == "group" {
        if let Some(ch) = it.children.as_mut() {
            for c in ch {
                apply_stroke_paint(c, paint);
            }
        }
    } else {
        it.stroke.paint = paint.clone();
    }
}

pub fn set_stroke_width(doc: &mut Document, ids: &[String], width: f32) {
    for_each_id(doc, ids, |it| apply_stroke_width(it, width));
}
fn apply_stroke_width(it: &mut Item, width: f32) {
    if it.kind == "group" {
        if let Some(ch) = it.children.as_mut() {
            for c in ch {
                apply_stroke_width(c, width);
            }
        }
    } else {
        it.stroke.width = width;
    }
}

pub fn set_opacity(doc: &mut Document, ids: &[String], opacity: f32) {
    for_each_id(doc, ids, |it| it.opacity = opacity.clamp(0.0, 1.0));
}

pub fn set_visible(doc: &mut Document, ids: &[String], visible: bool) {
    for_each_id(doc, ids, |it| it.visible = visible);
}

pub fn set_locked(doc: &mut Document, ids: &[String], locked: bool) {
    for_each_id(doc, ids, |it| it.locked = locked);
}

fn densify(g: &crate::vector::model::PathGeometry) -> crate::vector::model::PathGeometry {
    let mut out = g.clone();
    let seg_count = geom::segments(g).len();
    for s in (0..seg_count).rev() {
        out = geom::insert_anchor(&out, s, 0.5);
    }
    out
}

/// Object ▸ Path ▸ Add Anchor Points — insert a midpoint anchor on every segment
/// of each selected path/compound without changing its shape. Returns ids touched.
pub fn add_anchor_points(doc: &mut Document, ids: &[String]) -> Vec<String> {
    let mut done = Vec::new();
    for id in ids {
        if let Some((item, _)) = find_mut(doc, id) {
            if item.kind == "path" {
                if let Some(g) = item.geometry.clone() {
                    item.geometry = Some(densify(&g));
                    done.push(id.clone());
                }
            } else if item.kind == "compound" {
                if let Some(subs) = item.subpaths.clone() {
                    item.subpaths = Some(subs.iter().map(densify).collect());
                    done.push(id.clone());
                }
            }
        }
    }
    done
}

/// Convert live shapes (rect/ellipse/polygon/star/line) to editable paths,
/// preserving id + attributes. No-op for path/compound/group/text/image.
pub fn convert_to_path(doc: &mut Document, ids: &[String]) {
    for id in ids {
        if let Some((item, _)) = find_mut(doc, id) {
            if !matches!(
                item.kind.as_str(),
                "rect" | "ellipse" | "polygon" | "star" | "line"
            ) {
                continue;
            }
            let paths = crate::vector::shapes::local_paths(item); // owned; borrow ends here
            if paths.is_empty() {
                continue;
            }
            if paths.len() == 1 {
                item.kind = "path".into();
                item.geometry = Some(paths.into_iter().next().unwrap());
                item.subpaths = None;
            } else {
                item.kind = "compound".into();
                item.subpaths = Some(paths);
                item.geometry = None;
            }
        }
    }
}

fn anchor_to_world(a: &Anchor, m: Matrix) -> Anchor {
    Anchor {
        point: geom::apply_point(m, a.point),
        handle_in: geom::apply_vector(m, a.handle_in),
        handle_out: geom::apply_vector(m, a.handle_out),
    }
}
fn reverse_anchors(v: &[Anchor]) -> Vec<Anchor> {
    v.iter()
        .rev()
        .map(|a| Anchor {
            point: a.point,
            handle_in: a.handle_out,
            handle_out: a.handle_in,
        })
        .collect()
}

/// Object ▸ Path ▸ Join — close a single open path, or concatenate 2+ open paths
/// (in world space, connecting nearest endpoints) into one open path.
pub fn join_paths(doc: &mut Document, ids: &[String], counter: &mut u64) -> Option<String> {
    const EPS: f32 = 1e-4;
    let mut locs: Vec<(String, Matrix, Vec<Anchor>)> = Vec::new();
    for id in ids {
        if let Some((item, pw)) = query::find_item(doc, id) {
            if item.kind == "path" {
                if let Some(g) = &item.geometry {
                    if !g.closed {
                        locs.push((
                            id.clone(),
                            geom::m_mul(pw, item.transform),
                            g.anchors.clone(),
                        ));
                    }
                }
            }
        }
    }
    if locs.len() == 1 {
        let id = locs[0].0.clone();
        if let Some((item, _)) = find_mut(doc, &id) {
            if let Some(g) = item.geometry.as_mut() {
                let n = g.anchors.len();
                if n >= 2 && geom::dist(g.anchors[0].point, g.anchors[n - 1].point) < EPS {
                    g.anchors[0].handle_in = g.anchors[n - 1].handle_in;
                    g.anchors.pop();
                }
                g.closed = true;
            }
        }
        return Some(id);
    }
    if locs.len() < 2 {
        return None;
    }
    let mut chain: Vec<Anchor> = locs[0]
        .2
        .iter()
        .map(|a| anchor_to_world(a, locs[0].1))
        .collect();
    let next1: Vec<Anchor> = locs[1]
        .2
        .iter()
        .map(|a| anchor_to_world(a, locs[1].1))
        .collect();
    let head_best = geom::dist(chain[0].point, next1[0].point)
        .min(geom::dist(chain[0].point, next1[next1.len() - 1].point));
    let tail_best = geom::dist(chain[chain.len() - 1].point, next1[0].point).min(geom::dist(
        chain[chain.len() - 1].point,
        next1[next1.len() - 1].point,
    ));
    if head_best < tail_best {
        chain = reverse_anchors(&chain);
    }
    for loc in &locs[1..] {
        let mut next: Vec<Anchor> = loc.2.iter().map(|a| anchor_to_world(a, loc.1)).collect();
        if next.is_empty() {
            continue;
        }
        let tail = chain[chain.len() - 1].point;
        if geom::dist(tail, next[next.len() - 1].point) < geom::dist(tail, next[0].point) {
            next = reverse_anchors(&next);
        }
        if geom::dist(tail, next[0].point) < EPS {
            let last = chain.len() - 1;
            chain[last].handle_out = next[0].handle_out;
            next.remove(0);
        }
        chain.extend(next);
    }
    let first_id = locs[0].0.clone();
    let (fill, stroke) = query::find_item(doc, &first_id)
        .map(|(it, _)| (it.fill.clone(), it.stroke.clone()))
        .unwrap_or((Paint::None, crate::vector::model::Stroke::default()));
    let pos = top_level_pos(doc, &first_id);
    let remove_ids: Vec<String> = locs.iter().map(|l| l.0.clone()).collect();
    remove_items(doc, &remove_ids);
    let mut p = crate::vector::factory::default_item("path");
    p.geometry = Some(PathGeometry {
        closed: false,
        anchors: chain,
    });
    p.fill = fill;
    p.stroke = stroke;
    *counter += 1;
    p.id = format!("p{counter}");
    let id = p.id.clone();
    match pos {
        Some((li, ii)) => {
            let layer = doc.layers.get_mut(li)?;
            let at = ii.min(layer.items.len());
            layer.items.insert(at, p);
        }
        None => doc.layers.last_mut()?.items.push(p),
    }
    Some(id)
}

pub(crate) fn top_level_pos(doc: &Document, id: &str) -> Option<(usize, usize)> {
    for (li, l) in doc.layers.iter().enumerate() {
        if let Some(ii) = l.items.iter().position(|it| it.id == id) {
            return Some((li, ii));
        }
    }
    None
}

/// Object ▸ Compound Path ▸ Make — combine 2+ paths/shapes into ONE compound
/// (even-odd holes), adopting the backmost object's paint. Returns the new id.
pub fn make_compound_path(doc: &mut Document, ids: &[String], counter: &mut u64) -> Option<String> {
    let ordered = query::order_ids(doc, ids);
    let contributing: Vec<String> = ordered
        .into_iter()
        .filter(|id| {
            query::find_item(doc, id)
                .map(|(it, _)| !crate::vector::shapes::local_paths(it).is_empty())
                .unwrap_or(false)
        })
        .collect();
    if contributing.len() < 2 {
        return None;
    }
    let back_id = contributing[0].clone();
    let mut subpaths = Vec::new();
    for id in &contributing {
        if let Some((it, pw)) = query::find_item(doc, id) {
            let world = geom::m_mul(pw, it.transform);
            for g in crate::vector::shapes::local_paths(it) {
                subpaths.push(geom::transform_geometry(&g, world));
            }
        }
    }
    let (fill, stroke, opacity) = match query::find_item(doc, &back_id) {
        Some((it, _)) => (it.fill.clone(), it.stroke.clone(), it.opacity),
        None => return None,
    };
    let pos = top_level_pos(doc, &back_id);
    remove_items(doc, &contributing);

    let mut comp = crate::vector::factory::default_item("compound");
    comp.subpaths = Some(subpaths);
    comp.fill = fill;
    comp.stroke = stroke;
    comp.opacity = opacity;
    comp.even_odd = true;
    *counter += 1;
    comp.id = format!("c{counter}");
    let id = comp.id.clone();
    match pos {
        Some((li, ii)) => {
            let layer = doc.layers.get_mut(li)?;
            let at = ii.min(layer.items.len());
            layer.items.insert(at, comp);
        }
        None => doc.layers.last_mut()?.items.push(comp),
    }
    Some(id)
}

/// Object ▸ Compound Path ▸ Release — split each selected compound into its
/// component paths, each keeping the compound's appearance + transform.
pub fn release_compound_path(doc: &mut Document, ids: &[String], counter: &mut u64) -> Vec<String> {
    let set: HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
    let mut out = Vec::new();
    for layer in &mut doc.layers {
        release_in(&mut layer.items, &set, counter, &mut out);
    }
    out
}
fn release_in(
    items: &mut Vec<Item>,
    set: &HashSet<&str>,
    counter: &mut u64,
    out: &mut Vec<String>,
) {
    let mut i = 0;
    while i < items.len() {
        if items[i].kind == "compound" && set.contains(items[i].id.as_str()) {
            let comp = items.remove(i);
            let subs = comp.subpaths.clone().unwrap_or_default();
            let mut pieces = Vec::new();
            for sp in subs {
                let mut p = crate::vector::factory::default_item("path");
                p.geometry = Some(sp);
                p.fill = comp.fill.clone();
                p.stroke = comp.stroke.clone();
                p.transform = comp.transform;
                p.opacity = comp.opacity;
                *counter += 1;
                p.id = format!("p{counter}");
                out.push(p.id.clone());
                pieces.push(p);
            }
            let n = pieces.len();
            for (k, p) in pieces.into_iter().enumerate() {
                items.insert(i + k, p);
            }
            i += n.max(1);
        } else {
            if items[i].kind == "group" {
                if let Some(ch) = items[i].children.as_mut() {
                    release_in(ch, set, counter, out);
                }
            }
            i += 1;
        }
    }
}

fn path_geometry_mut<'a>(doc: &'a mut Document, id: &str) -> Option<&'a mut PathGeometry> {
    let (item, _) = find_mut(doc, id)?;
    if item.kind != "path" {
        return None;
    }
    item.geometry.as_mut()
}

/// The outline holding flat anchor `index`, and that anchor's index within it.
/// An ordinary path has exactly one outline, so this is the identity for it; a
/// `compound` — what Type ▸ Convert to Shape emits, its contours in `subpaths` —
/// addresses them in order, which is what lets the point tools reach a converted
/// glyph at all. (#452)
fn outline_for_index<'a>(
    doc: &'a mut Document,
    id: &str,
    index: usize,
) -> Option<(&'a mut PathGeometry, usize)> {
    let (item, _) = find_mut(doc, id)?;
    if item.kind != "path" && item.kind != "compound" {
        return None;
    }
    let (slot, local) = item.outline_at(index)?;
    Some((item.outline_mut(slot)?, local))
}

/// Every anchor the item carries, across all of its outlines.
fn total_anchors(doc: &mut Document, id: &str) -> usize {
    find_mut(doc, id)
        .map(|(item, _)| item.outlines().map(|g| g.anchors.len()).sum())
        .unwrap_or(0)
}

fn path_anchors_mut<'a>(doc: &'a mut Document, id: &str) -> Option<&'a mut Vec<Anchor>> {
    path_geometry_mut(doc, id).map(|g| &mut g.anchors)
}

/// Set one handle of an anchor (local vector); mirror keeps the opposite symmetric.
pub fn set_handle(
    doc: &mut Document,
    id: &str,
    index: usize,
    is_in: bool,
    vx: f32,
    vy: f32,
    mirror: bool,
) {
    if let Some((geo, index)) = outline_for_index(doc, id, index) {
        if let Some(a) = geo.anchors.get_mut(index) {
            if is_in {
                a.handle_in = Point { x: vx, y: vy };
                if mirror {
                    a.handle_out = Point { x: -vx, y: -vy };
                }
            } else {
                a.handle_out = Point { x: vx, y: vy };
                if mirror {
                    a.handle_in = Point { x: -vx, y: -vy };
                }
            }
        }
    }
}

/// Toggle an anchor between corner (no handles) and smooth (tangent from neighbors).
pub fn toggle_anchor_smooth(doc: &mut Document, id: &str, index: usize) {
    if let Some(g) = path_geometry_mut(doc, id) {
        let closed = g.closed;
        let anchors = &mut g.anchors;
        let n = anchors.len();
        if index >= n {
            return;
        }
        let a = &anchors[index];
        let has = a.handle_in.x != 0.0
            || a.handle_in.y != 0.0
            || a.handle_out.x != 0.0
            || a.handle_out.y != 0.0;
        if has {
            anchors[index].handle_in = Point::default();
            anchors[index].handle_out = Point::default();
        } else {
            // (#123) Only a CLOSED path wraps around: on an open path the
            // endpoints' missing neighbour is the point itself (one-sided
            // tangent), not the anchor at the far end of the path.
            let prev = if index == 0 && !closed {
                anchors[index].point
            } else {
                anchors[(index + n - 1) % n].point
            };
            let next = if index + 1 == n && !closed {
                anchors[index].point
            } else {
                anchors[(index + 1) % n].point
            };
            let tx = (next.x - prev.x) / 6.0;
            let ty = (next.y - prev.y) / 6.0;
            anchors[index].handle_out = Point { x: tx, y: ty };
            anchors[index].handle_in = Point { x: -tx, y: -ty };
        }
    }
}

/// Make an anchor a corner (drop handles). Returns false if already a corner.
pub fn corner_anchor(doc: &mut Document, id: &str, index: usize) -> bool {
    if let Some(anchors) = path_anchors_mut(doc, id) {
        if let Some(a) = anchors.get_mut(index) {
            if a.handle_in.x == 0.0
                && a.handle_in.y == 0.0
                && a.handle_out.x == 0.0
                && a.handle_out.y == 0.0
            {
                return false;
            }
            a.handle_in = Point::default();
            a.handle_out = Point::default();
            return true;
        }
    }
    false
}

/// Delete anchors (by index) from a path; removes the item if < 2 remain.
pub fn delete_anchors(doc: &mut Document, id: &str, indices: &[usize]) {
    let mut idx: Vec<usize> = indices.to_vec();
    idx.sort_unstable_by(|a, b| b.cmp(a)); // descending so earlier indices stay valid
    idx.dedup();
    // Resolved one at a time: each removal renumbers the flat index, and taking
    // them highest-first keeps the ones still to come pointing where they did.
    for i in idx {
        if let Some((geo, local)) = outline_for_index(doc, id, i) {
            if local < geo.anchors.len() {
                geo.anchors.remove(local);
            }
        }
    }
    // A compound is judged whole: emptying one contour of a glyph must not take
    // the rest of it with them.
    if total_anchors(doc, id) < 2 {
        remove_items(doc, &[id.to_string()]);
    }
}

/// Laplacian smoothing of anchors within `radius` of a local-space center.
pub fn smooth_near(doc: &mut Document, id: &str, cx: f32, cy: f32, radius: f32, amount: f32) {
    if let Some(g) = path_geometry_mut(doc, id) {
        let closed = g.closed;
        let anchors = &mut g.anchors;
        let n = anchors.len();
        if n < 3 || radius <= 0.0 {
            return;
        }
        let center = Point { x: cx, y: cy };
        let pts: Vec<Point> = anchors.iter().map(|a| a.point).collect();
        let mut next = pts.clone();
        for i in 0..n {
            // (#123) An open path's endpoints have only one neighbour — averaging
            // with the wrapped-around far end would drag them across the canvas.
            if !closed && (i == 0 || i + 1 == n) {
                continue;
            }
            let d = geom::dist(pts[i], center);
            if d >= radius {
                continue;
            }
            let t = (1.0 - d / radius) * amount;
            let prev = pts[(i + n - 1) % n];
            let nxt = pts[(i + 1) % n];
            let avg = Point {
                x: (prev.x + nxt.x) / 2.0,
                y: (prev.y + nxt.y) / 2.0,
            };
            next[i] = Point {
                x: pts[i].x + (avg.x - pts[i].x) * t,
                y: pts[i].y + (avg.y - pts[i].y) * t,
            };
        }
        for (i, a) in anchors.iter_mut().enumerate() {
            a.point = next[i];
        }
    }
}

/// Object ▸ Path ▸ Outline Stroke — replace each stroked item with a group of
/// {original fill (if any), stroke outline as a filled compound}. Returns new group ids.
pub fn outline_stroke(doc: &mut Document, ids: &[String], counter: &mut u64) -> Vec<String> {
    let set: HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
    let mut out = Vec::new();
    for layer in &mut doc.layers {
        outline_in(&mut layer.items, &set, counter, &mut out);
    }
    out
}
fn outline_in(
    items: &mut Vec<Item>,
    set: &HashSet<&str>,
    counter: &mut u64,
    out: &mut Vec<String>,
) {
    let mut i = 0;
    while i < items.len() {
        let needs = set.contains(items[i].id.as_str())
            && items[i].stroke.width > 0.0
            && !matches!(items[i].stroke.paint, Paint::None);
        if needs {
            let geos = crate::vector::shapes::local_paths(&items[i]);
            let outline = crate::vector::render::stroke_to_geometry(&geos, &items[i].stroke);
            if !outline.is_empty() {
                let fill = items[i].fill.clone();
                let even_odd = items[i].even_odd;
                let stroke_paint = items[i].stroke.paint.clone();
                let transform = items[i].transform;
                let opacity = items[i].opacity;
                let mut children = Vec::new();
                if !matches!(fill, Paint::None) && !geos.is_empty() {
                    let mut fc = crate::vector::factory::default_item("compound");
                    fc.subpaths = Some(geos);
                    fc.fill = fill;
                    fc.even_odd = even_odd;
                    *counter += 1;
                    fc.id = format!("c{counter}");
                    children.push(fc);
                }
                let mut sc = crate::vector::factory::default_item("compound");
                sc.subpaths = Some(outline);
                sc.fill = stroke_paint;
                *counter += 1;
                sc.id = format!("c{counter}");
                children.push(sc);
                let mut g = crate::vector::factory::make_group(children);
                g.transform = transform;
                g.opacity = opacity;
                *counter += 1;
                g.id = format!("g{counter}");
                out.push(g.id.clone());
                items[i] = g;
            }
            i += 1;
        } else {
            if items[i].kind == "group" {
                if let Some(ch) = items[i].children.as_mut() {
                    outline_in(ch, set, counter, out);
                }
            }
            i += 1;
        }
    }
}

/// Object ▸ Path ▸ Average — move selected anchors (per-path indices) to their
/// world-space average. axis "horizontal" shares Y, "vertical" shares X, "both"
/// collapses to one point. Needs 2+ anchors.
pub fn average_anchors(doc: &mut Document, sel: &HashMap<String, Vec<usize>>, axis: &str) {
    let mut refs: Vec<(String, usize, Point, Matrix)> = Vec::new();
    for (id, idxs) in sel {
        if let Some((item, pw)) = query::find_item(doc, id) {
            if item.kind != "path" {
                continue;
            }
            let world = geom::m_mul(pw, item.transform);
            let Some(w2l) = geom::m_invert(world) else {
                continue;
            };
            if let Some(g) = &item.geometry {
                for &i in idxs {
                    if let Some(a) = g.anchors.get(i) {
                        refs.push((id.clone(), i, geom::apply_point(world, a.point), w2l));
                    }
                }
            }
        }
    }
    if refs.len() < 2 {
        return;
    }
    let avg_x = refs.iter().map(|r| r.2.x).sum::<f32>() / refs.len() as f32;
    let avg_y = refs.iter().map(|r| r.2.y).sum::<f32>() / refs.len() as f32;
    for (id, idx, world_pt, to_local) in refs {
        let nw = Point {
            x: if axis == "horizontal" {
                world_pt.x
            } else {
                avg_x
            },
            y: if axis == "vertical" {
                world_pt.y
            } else {
                avg_y
            },
        };
        let local = geom::apply_point(to_local, nw);
        if let Some((item, _)) = find_mut(doc, &id) {
            if let Some(g) = item.geometry.as_mut() {
                if let Some(a) = g.anchors.get_mut(idx) {
                    a.point = local;
                }
            }
        }
    }
}

/// Scissors: cut a path at (segment, t). A closed path opens at the cut; an open
/// path splits into two (the second piece keeps the appearance + transform).
pub fn cut_path_at(doc: &mut Document, id: &str, seg_index: usize, t: f32, counter: &mut u64) {
    for layer in &mut doc.layers {
        if cut_in(&mut layer.items, id, seg_index, t, counter) {
            return;
        }
    }
}
fn cut_in(items: &mut Vec<Item>, id: &str, seg: usize, t: f32, counter: &mut u64) -> bool {
    if let Some(idx) = items.iter().position(|it| it.id == id && it.kind == "path") {
        let Some(g) = items[idx].geometry.clone() else {
            return true;
        };
        let was_closed = g.closed;
        let split = geom::insert_anchor(&g, seg, t);
        let anchors = split.anchors;
        if anchors.is_empty() {
            return true;
        }
        let k = (seg + 1) % anchors.len();
        if was_closed {
            let mut reordered: Vec<Anchor> = anchors[k..]
                .iter()
                .chain(anchors[..k].iter())
                .cloned()
                .collect();
            let mut tail = reordered[0].clone();
            reordered[0].handle_in = Point::default();
            tail.handle_out = Point::default();
            reordered.push(tail);
            items[idx].geometry = Some(PathGeometry {
                closed: false,
                anchors: reordered,
            });
        } else {
            let first: Vec<Anchor> = anchors[..=k].to_vec();
            let second: Vec<Anchor> = anchors[k..].to_vec();
            if first.len() >= 2 {
                items[idx].geometry = Some(PathGeometry {
                    closed: false,
                    anchors: first,
                });
            }
            if second.len() >= 2 {
                let mut p2 = crate::vector::factory::default_item("path");
                p2.geometry = Some(PathGeometry {
                    closed: false,
                    anchors: second,
                });
                p2.fill = items[idx].fill.clone();
                p2.stroke = items[idx].stroke.clone();
                p2.transform = items[idx].transform;
                p2.opacity = items[idx].opacity;
                *counter += 1;
                p2.id = format!("p{counter}");
                items.insert(idx + 1, p2);
            }
        }
        return true;
    }
    for it in items.iter_mut() {
        if it.kind == "group" {
            if let Some(ch) = it.children.as_mut() {
                if cut_in(ch, id, seg, t, counter) {
                    return true;
                }
            }
        }
    }
    false
}

/// Translate anchor points of a path by a local-space delta.
pub fn move_anchors(doc: &mut Document, id: &str, indices: &[usize], ldx: f32, ldy: f32) {
    if let Some((item, _)) = find_mut(doc, id) {
        if let Some(g) = item.geometry.as_mut() {
            for &i in indices {
                if let Some(a) = g.anchors.get_mut(i) {
                    a.point.x += ldx;
                    a.point.y += ldy;
                }
            }
        }
    }
}

/// Add Anchor Point tool ▸ locate the path point nearest a WORLD-space click:
/// returns (item id, segment index, t) when within `tol` world units. Read-only —
/// the caller applies `geom::insert_anchor` (and owns the undo snapshot).
/// ponytail: coarse t-scan, 32 samples per segment; a slightly-off t still
/// splits losslessly, so only the new anchor's exact spot can be a hair off.
/// Live shapes/compounds are skipped — run convert_to_path first if that matters.
/// The nearest point on any segment: item id, which OUTLINE of that item, the
/// segment within it, and the parameter along that segment. A converted glyph is
/// one `compound` item whose contours are all in `subpaths`, so the outline has
/// to come back too — otherwise Add Anchor would insert into the wrong one. (#452)
pub fn nearest_segment_point(
    doc: &Document,
    wx: f32,
    wy: f32,
    tol: f32,
) -> Option<(String, usize, usize, f32)> {
    fn walk(
        items: &[Item],
        parent: Matrix,
        q: Point,
        best: &mut Option<(String, usize, usize, f32, f32)>,
    ) {
        for it in items {
            let w = geom::m_mul(parent, it.transform);
            if let Some(ch) = &it.children {
                walk(ch, w, q, best);
            }
            if it.kind != "path" && it.kind != "compound" {
                continue;
            }
            for (slot, g) in it.outlines().enumerate() {
                for (si, c) in geom::segments(g).iter().enumerate() {
                    // t=0/1 are the segment's own anchors — skip them so a click on
                    // an existing anchor stays a miss (Add over an anchor is a no-op).
                    for k in 1..32 {
                        let t = k as f32 / 32.0;
                        let d = geom::dist(geom::apply_point(w, c.eval(t)), q);
                        if best.as_ref().map_or(true, |b| d < b.4) {
                            *best = Some((it.id.clone(), slot, si, t, d));
                        }
                    }
                }
            }
        }
    }
    let q = Point { x: wx, y: wy };
    let mut best = None;
    for layer in &doc.layers {
        walk(&layer.items, geom::m_identity(), q, &mut best);
    }
    match best {
        Some((id, slot, seg, t, d)) if d <= tol => Some((id, slot, seg, t)),
        _ => None,
    }
}

/// Insert an item into a layer (by id, else the topmost layer), re-minting its
/// ids so it can't collide. Returns the new top-level id.
pub fn add_item(doc: &mut Document, mut item: Item, layer_id: &str, counter: &mut u64) -> String {
    reid(&mut item, counter);
    let id = item.id.clone();
    let idx = doc
        .layers
        .iter()
        .position(|l| l.id == layer_id)
        .unwrap_or(doc.layers.len().saturating_sub(1));
    if let Some(layer) = doc.layers.get_mut(idx) {
        layer.items.push(item);
    }
    id
}

/// Duplicate items in place (fresh ids, offset by dx/dy in parent space). Returns new ids.
pub fn duplicate_items(
    doc: &mut Document,
    ids: &[String],
    dx: f32,
    dy: f32,
    counter: &mut u64,
) -> Vec<String> {
    let mut out = Vec::new();
    for id in ids {
        for layer in &mut doc.layers {
            if let Some(nid) = dup_in(&mut layer.items, id, dx, dy, counter) {
                out.push(nid);
                break;
            }
        }
    }
    out
}

fn dup_in(items: &mut Vec<Item>, id: &str, dx: f32, dy: f32, counter: &mut u64) -> Option<String> {
    if let Some(idx) = items.iter().position(|it| it.id == id) {
        let mut copy = items[idx].clone();
        reid(&mut copy, counter);
        copy.transform = geom::m_mul(geom::m_translation(dx, dy), copy.transform);
        let nid = copy.id.clone();
        items.insert(idx + 1, copy);
        return Some(nid);
    }
    for it in items.iter_mut() {
        if it.kind == "group" {
            if let Some(ch) = it.children.as_mut() {
                if let Some(r) = dup_in(ch, id, dx, dy, counter) {
                    return Some(r);
                }
            }
        }
    }
    None
}

/// Reassign fresh ids to an item subtree (the id space `find_*` rely on).
pub fn reid(it: &mut Item, counter: &mut u64) {
    *counter += 1;
    let prefix = it.kind.chars().next().unwrap_or('i');
    it.id = format!("{prefix}{counter}");
    if let Some(ch) = it.children.as_mut() {
        for c in ch {
            reid(c, counter);
        }
    }
}

/// Align / distribute items to a world-space reference rect (Illustrator parity).
/// action ∈ left|center-h|right|top|middle-v|bottom|dist-h|dist-v.
pub fn align(doc: &mut Document, ids: &[String], action: &str, r: geom::Rect) {
    if ids.is_empty() {
        return;
    }
    if action == "dist-h" || action == "dist-v" {
        distribute(doc, ids, action == "dist-h", r);
        return;
    }
    for id in ids {
        let Some(b) = query::world_bounds(doc, id) else {
            continue;
        };
        let mut dx = 0.0;
        let mut dy = 0.0;
        match action {
            "left" => dx = r.x - b.x,
            "center-h" => dx = r.x + r.w / 2.0 - (b.x + b.w / 2.0),
            "right" => dx = r.x + r.w - (b.x + b.w),
            "top" => dy = r.y - b.y,
            "middle-v" => dy = r.y + r.h / 2.0 - (b.y + b.h / 2.0),
            "bottom" => dy = r.y + r.h - (b.y + b.h),
            _ => {}
        }
        if dx != 0.0 || dy != 0.0 {
            translate_items(doc, std::slice::from_ref(id), dx, dy);
        }
    }
}

fn distribute(doc: &mut Document, ids: &[String], horizontal: bool, r: geom::Rect) {
    let mut entries: Vec<(String, geom::Rect)> = ids
        .iter()
        .filter_map(|id| query::world_bounds(doc, id).map(|b| (id.clone(), b)))
        .collect();
    if entries.len() < 3 {
        return;
    }
    entries.sort_by(|a, b| {
        let (ka, kb) = if horizontal {
            (a.1.x, b.1.x)
        } else {
            (a.1.y, b.1.y)
        };
        ka.partial_cmp(&kb).unwrap_or(std::cmp::Ordering::Equal)
    });
    let start = if horizontal { r.x } else { r.y };
    let extent = if horizontal { r.w } else { r.h };
    let sum: f32 = entries
        .iter()
        .map(|e| if horizontal { e.1.w } else { e.1.h })
        .sum();
    let gap = (extent - sum) / (entries.len() as f32 - 1.0);
    let mut cursor = start;
    for (id, b) in &entries {
        if horizontal {
            let dx = cursor - b.x;
            if dx != 0.0 {
                translate_items(doc, std::slice::from_ref(id), dx, 0.0);
            }
            cursor += b.w + gap;
        } else {
            let dy = cursor - b.y;
            if dy != 0.0 {
                translate_items(doc, std::slice::from_ref(id), 0.0, dy);
            }
            cursor += b.h + gap;
        }
    }
}

pub fn bring_forward(doc: &mut Document, ids: &[String]) {
    let set: HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
    for layer in &mut doc.layers {
        forward_in(&mut layer.items, &set);
    }
}
fn forward_in(items: &mut Vec<Item>, set: &HashSet<&str>) {
    for it in items.iter_mut() {
        if it.kind == "group" {
            if let Some(ch) = it.children.as_mut() {
                forward_in(ch, set);
            }
        }
    }
    if items.len() >= 2 {
        for i in (0..items.len() - 1).rev() {
            if set.contains(items[i].id.as_str()) && !set.contains(items[i + 1].id.as_str()) {
                items.swap(i, i + 1);
            }
        }
    }
}

pub fn send_backward(doc: &mut Document, ids: &[String]) {
    let set: HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
    for layer in &mut doc.layers {
        backward_in(&mut layer.items, &set);
    }
}
fn backward_in(items: &mut Vec<Item>, set: &HashSet<&str>) {
    for it in items.iter_mut() {
        if it.kind == "group" {
            if let Some(ch) = it.children.as_mut() {
                backward_in(ch, set);
            }
        }
    }
    for i in 1..items.len() {
        if set.contains(items[i].id.as_str()) && !set.contains(items[i - 1].id.as_str()) {
            items.swap(i, i - 1);
        }
    }
}

// ── group / ungroup ──────────────────────────────────────────
fn dedupe_ids(ids: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.iter()
        .filter(|id| seen.insert((*id).clone()))
        .cloned()
        .collect()
}

fn item_at<'a>(doc: &'a Document, path: &[usize]) -> Option<&'a Item> {
    let li = *path.first()?;
    let mut items = &doc.layers.get(li)?.items;
    for (k, &i) in path[1..].iter().enumerate() {
        let it = items.get(i)?;
        if k == path.len() - 2 {
            return Some(it);
        }
        items = it.children.as_ref()?;
    }
    None
}

fn collect_selected_paths(doc: &Document, set: &HashSet<&str>) -> Vec<Vec<usize>> {
    let mut out = Vec::new();
    for (li, layer) in doc.layers.iter().enumerate() {
        let mut prefix = vec![li];
        collect_in(&layer.items, set, &mut prefix, &mut out);
    }
    out
}
fn collect_in(
    items: &[Item],
    set: &HashSet<&str>,
    prefix: &mut Vec<usize>,
    out: &mut Vec<Vec<usize>>,
) {
    for (i, it) in items.iter().enumerate() {
        prefix.push(i);
        if set.contains(it.id.as_str()) {
            out.push(prefix.clone());
        } else if it.kind == "group" {
            if let Some(ch) = &it.children {
                collect_in(ch, set, prefix, out);
            }
        }
        prefix.pop();
    }
}

/// Group selected items into one group at the frontmost selected item's
/// z-position (Illustrator parity). Needs 2+ items. Returns the new group id.
pub fn group(doc: &mut Document, ids: &[String], counter: &mut u64) -> Option<String> {
    let idlist = dedupe_ids(ids);
    if idlist.len() < 2 {
        return None;
    }
    let set: HashSet<&str> = idlist.iter().map(|s| s.as_str()).collect();

    let paths = collect_selected_paths(doc, &set);
    if paths.len() < 2 {
        return None;
    }
    // Children in document order (clone before removal).
    let children: Vec<Item> = paths
        .iter()
        .filter_map(|p| item_at(doc, p).cloned())
        .collect();

    let front = paths.last().unwrap().clone();
    let container_path = &front[..front.len() - 1];
    let top_index = *front.last().unwrap();
    let selected_below = paths
        .iter()
        .filter(|p| {
            p.len() == front.len()
                && p[..p.len() - 1] == front[..front.len() - 1]
                && *p.last().unwrap() < top_index
        })
        .count();
    let insert_at = top_index.saturating_sub(selected_below);
    // Identify the destination container's parent group by id (stable across removal).
    let parent_group_id: Option<String> = if container_path.len() > 1 {
        item_at(doc, container_path).map(|it| it.id.clone())
    } else {
        None
    };
    let layer_idx = container_path[0];

    remove_items(doc, &idlist);

    let mut g = crate::vector::factory::make_group(children);
    // Only the new wrapper gets a fresh id; the grouped children keep theirs.
    *counter += 1;
    g.id = format!("g{counter}");
    let gid = g.id.clone();

    let container: Option<&mut Vec<Item>> = match parent_group_id {
        Some(pid) => find_mut(doc, &pid).and_then(|(it, _)| it.children.as_mut()),
        None => doc.layers.get_mut(layer_idx).map(|l| &mut l.items),
    };
    if let Some(c) = container {
        let idx = insert_at.min(c.len());
        c.insert(idx, g);
        Some(gid)
    } else if let Some(layer) = doc.layers.first_mut() {
        layer.items.push(g);
        Some(gid)
    } else {
        None
    }
}

/// Ungroup selected groups (single level), baking the group transform + opacity
/// into each child. Returns the released child ids.
pub fn ungroup(doc: &mut Document, ids: &[String]) -> Vec<String> {
    let set: HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
    let mut released = Vec::new();
    for layer in &mut doc.layers {
        ungroup_in(&mut layer.items, &set, &mut released);
    }
    released
}
fn ungroup_in(items: &mut Vec<Item>, set: &HashSet<&str>, released: &mut Vec<String>) {
    let mut i = items.len();
    while i > 0 {
        i -= 1;
        if items[i].kind != "group" {
            continue;
        }
        if set.contains(items[i].id.as_str()) {
            let group = items.remove(i);
            let gt = group.transform;
            let go = group.opacity;
            let mut children = group.children.unwrap_or_default();
            for c in &mut children {
                c.transform = geom::m_mul(gt, c.transform);
                c.opacity *= go;
                released.push(c.id.clone());
            }
            for (k, c) in children.into_iter().enumerate() {
                items.insert(i + k, c);
            }
        } else if let Some(ch) = items[i].children.as_mut() {
            ungroup_in(ch, set, released);
        }
    }
}

pub fn bring_to_front(doc: &mut Document, ids: &[String]) {
    reorder(doc, ids, true);
}
pub fn send_to_back(doc: &mut Document, ids: &[String]) {
    reorder(doc, ids, false);
}

fn reorder(doc: &mut Document, ids: &[String], to_front: bool) {
    let set: HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
    for layer in &mut doc.layers {
        reorder_in(&mut layer.items, &set, to_front);
    }
}

fn reorder_in(items: &mut Vec<Item>, set: &HashSet<&str>, to_front: bool) {
    // Recurse first so nested containers are handled, then partition this level.
    for it in items.iter_mut() {
        if it.kind == "group" {
            if let Some(ch) = it.children.as_mut() {
                reorder_in(ch, set, to_front);
            }
        }
    }
    if !items.iter().any(|it| set.contains(it.id.as_str())) {
        return;
    }
    let mut sel = Vec::new();
    let mut rest = Vec::new();
    for it in items.drain(..) {
        if set.contains(it.id.as_str()) {
            sel.push(it);
        } else {
            rest.push(it);
        }
    }
    if to_front {
        rest.extend(sel);
        *items = rest;
    } else {
        sel.extend(rest);
        *items = sel;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vector::query;

    fn doc() -> Document {
        let json = r#"{"artboards":[],"layers":[{"visible":true,"items":[
            {"type":"rect","id":"a","transform":{"a":1,"b":0,"c":0,"d":1,"e":10,"f":10},
             "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},"width":40,"height":30},
            {"type":"rect","id":"b","transform":{"a":1,"b":0,"c":0,"d":1,"e":100,"f":100},
             "fill":{"type":"none"},"width":20,"height":20}
        ]}]}"#;
        Document::parse(json).unwrap()
    }

    #[test]
    fn translate_moves_world_bounds() {
        let mut d = doc();
        translate_items(&mut d, &["a".into()], 5.0, 7.0);
        let b = query::world_bounds(&d, "a").unwrap();
        assert_eq!((b.x, b.y), (15.0, 17.0));
    }

    #[test]
    fn remove_drops_item() {
        let mut d = doc();
        remove_items(&mut d, &["a".into()]);
        assert!(query::find_item(&d, "a").is_none());
        assert!(query::find_item(&d, "b").is_some());
    }

    #[test]
    fn duplicate_makes_a_fresh_offset_copy() {
        let mut d = doc();
        let mut counter = 0u64;
        let new = duplicate_items(&mut d, &["a".into()], 10.0, 10.0, &mut counter);
        assert_eq!(new.len(), 1);
        assert_ne!(new[0], "a");
        assert_eq!(d.layers[0].items.len(), 3);
        let b = query::world_bounds(&d, &new[0]).unwrap();
        assert_eq!((b.x, b.y), (20.0, 20.0)); // original at 10,10 offset by 10,10
    }

    #[test]
    fn set_fill_recolors() {
        let mut d = doc();
        let blue = Paint::Solid {
            color: crate::vector::model::Rgba {
                r: 0.0,
                g: 0.0,
                b: 255.0,
                a: 1.0,
            },
        };
        set_fill(&mut d, &["a".into()], &blue);
        let (item, _) = query::find_item(&d, "a").unwrap();
        match &item.fill {
            Paint::Solid { color } => assert_eq!((color.r, color.b), (0.0, 255.0)),
            _ => panic!("expected solid blue"),
        }
    }

    #[test]
    fn bring_to_front_reorders() {
        let mut d = doc();
        bring_to_front(&mut d, &["a".into()]);
        let ids: Vec<&str> = d.layers[0].items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, vec!["b", "a"]);
    }

    #[test]
    fn group_then_ungroup_roundtrips() {
        let mut d = doc();
        let mut counter = 0u64;
        let gid = group(&mut d, &["a".into(), "b".into()], &mut counter).unwrap();
        assert_eq!(d.layers[0].items.len(), 1);
        assert_eq!(d.layers[0].items[0].kind, "group");
        assert!(query::find_item(&d, "a").is_some()); // nested, still findable
                                                      // group transform is identity → child world bounds unchanged
        assert_eq!(query::world_bounds(&d, "a").unwrap().x, 10.0);

        let released = ungroup(&mut d, &[gid]);
        assert_eq!(released.len(), 2);
        assert_eq!(d.layers[0].items.len(), 2);
        assert!(d.layers[0].items.iter().all(|i| i.kind == "rect"));
        assert_eq!(query::world_bounds(&d, "a").unwrap().x, 10.0); // baked transform preserves position
    }

    #[test]
    fn group_requires_two_items() {
        let mut d = doc();
        let mut counter = 0u64;
        assert!(group(&mut d, &["a".into()], &mut counter).is_none());
        assert_eq!(d.layers[0].items.len(), 2); // unchanged
    }

    #[test]
    fn outline_stroke_makes_a_group_with_a_filled_outline() {
        let json = r#"{"artboards":[],"layers":[{"visible":true,"items":[
            {"type":"rect","id":"r","width":40,"height":30,
             "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},
             "stroke":{"paint":{"type":"solid","color":{"r":0,"g":0,"b":0,"a":1}},"width":6,"cap":"butt","join":"miter","miterLimit":4,"align":"center"}}
        ]}]}"#;
        let mut d = Document::parse(json).unwrap();
        let mut counter = 0u64;
        let gids = outline_stroke(&mut d, &["r".into()], &mut counter);
        assert_eq!(gids.len(), 1);
        let (g, _) = query::find_item(&d, &gids[0]).unwrap();
        assert_eq!(g.kind, "group");
        let kids = g.children.as_ref().unwrap();
        assert_eq!(kids.len(), 2); // fill compound + stroke-outline compound
        let stroke_outline = kids.last().unwrap();
        assert_eq!(stroke_outline.kind, "compound");
        assert!(!stroke_outline.subpaths.as_ref().unwrap().is_empty());
    }

    #[test]
    fn join_two_open_paths_merges_shared_endpoint() {
        let json = r#"{"artboards":[],"layers":[{"visible":true,"items":[
            {"type":"path","id":"p1","geometry":{"closed":false,"anchors":[{"point":{"x":0,"y":0}},{"point":{"x":50,"y":0}}]},"fill":{"type":"none"}},
            {"type":"path","id":"p2","geometry":{"closed":false,"anchors":[{"point":{"x":50,"y":0}},{"point":{"x":100,"y":0}}]},"fill":{"type":"none"}}
        ]}]}"#;
        let mut d = Document::parse(json).unwrap();
        let mut counter = 0u64;
        let id = join_paths(&mut d, &["p1".into(), "p2".into()], &mut counter).unwrap();
        assert_eq!(d.layers[0].items.len(), 1);
        let (it, _) = query::find_item(&d, &id).unwrap();
        let g = it.geometry.as_ref().unwrap();
        assert!(!g.closed);
        assert_eq!(g.anchors.len(), 3); // shared (50,0) merged
        assert_eq!(g.anchors[0].point.x, 0.0);
        assert_eq!(g.anchors[2].point.x, 100.0);
    }

    #[test]
    fn average_both_collapses_anchors() {
        let json = r#"{"artboards":[],"layers":[{"visible":true,"items":[
            {"type":"path","id":"p","geometry":{"closed":false,"anchors":[
              {"point":{"x":0,"y":0}},{"point":{"x":100,"y":0}},{"point":{"x":50,"y":60}}]},
             "fill":{"type":"none"}}]}]}"#;
        let mut d = Document::parse(json).unwrap();
        let mut sel = std::collections::HashMap::new();
        sel.insert("p".to_string(), vec![0usize, 1, 2]);
        average_anchors(&mut d, &sel, "both");
        let (item, _) = query::find_item(&d, "p").unwrap();
        let g = item.geometry.as_ref().unwrap();
        // centroid = ((0+100+50)/3, (0+0+60)/3) = (50, 20)
        for a in &g.anchors {
            assert!((a.point.x - 50.0).abs() < 0.01 && (a.point.y - 20.0).abs() < 0.01);
        }
    }

    #[test]
    fn cut_open_path_splits_into_two() {
        // open path with 3 anchors (2 segments)
        let json = r#"{"artboards":[],"layers":[{"visible":true,"items":[
            {"type":"path","id":"p","geometry":{"closed":false,"anchors":[
              {"point":{"x":0,"y":0}},{"point":{"x":50,"y":0}},{"point":{"x":100,"y":0}}]},
             "fill":{"type":"none"},"stroke":{"paint":{"type":"solid","color":{"r":0,"g":0,"b":0,"a":1}},"width":2}}
        ]}]}"#;
        let mut d = Document::parse(json).unwrap();
        let mut counter = 0u64;
        cut_path_at(&mut d, "p", 0, 0.5, &mut counter); // cut first segment midpoint
        assert_eq!(d.layers[0].items.len(), 2); // split into two open paths
        assert!(d.layers[0]
            .items
            .iter()
            .all(|i| i.kind == "path" && !i.geometry.as_ref().unwrap().closed));
    }

    #[test]
    fn add_anchor_points_doubles_and_keeps_shape() {
        let mut d = doc();
        convert_to_path(&mut d, &["a".into()]); // rect → path with 4 anchors
        let before = query::world_bounds(&d, "a").unwrap();
        let touched = add_anchor_points(&mut d, &["a".into()]);
        assert_eq!(touched, vec!["a".to_string()]);
        let (item, _) = query::find_item(&d, "a").unwrap();
        // 4 segments (closed) → 4 inserted → 8 anchors.
        assert_eq!(item.geometry.as_ref().unwrap().anchors.len(), 8);
        // Shape (bounds) unchanged by the lossless split.
        let after = query::world_bounds(&d, "a").unwrap();
        assert!(
            (before.x - after.x).abs() < 0.01
                && (before.w - after.w).abs() < 0.01
                && (before.h - after.h).abs() < 0.01
        );
    }

    #[test]
    fn make_then_release_compound() {
        let mut d = doc(); // rects a (x10) + b (x100)
        let mut counter = 0u64;
        let cid = make_compound_path(&mut d, &["a".into(), "b".into()], &mut counter).unwrap();
        assert_eq!(d.layers[0].items.len(), 1);
        let (comp, _) = query::find_item(&d, &cid).unwrap();
        assert_eq!(comp.kind, "compound");
        assert_eq!(comp.subpaths.as_ref().unwrap().len(), 2);
        // Combined bbox spans both rects: x 10..120.
        let b = query::world_bounds(&d, &cid).unwrap();
        assert!(
            (b.x - 10.0).abs() < 0.5 && (b.right() - 120.0).abs() < 0.5,
            "compound bbox {:?}",
            b
        );

        let released = release_compound_path(&mut d, &[cid], &mut counter);
        assert_eq!(released.len(), 2);
        assert_eq!(d.layers[0].items.len(), 2);
        assert!(d.layers[0].items.iter().all(|i| i.kind == "path"));
    }

    #[test]
    fn convert_rect_to_path_preserves_bounds() {
        let mut d = doc();
        convert_to_path(&mut d, &["a".into()]);
        let (item, _) = query::find_item(&d, "a").unwrap();
        assert_eq!(item.kind, "path");
        assert!(item.geometry.is_some());
        assert_eq!(
            query::world_bounds(&d, "a").unwrap(),
            geom::Rect {
                x: 10.0,
                y: 10.0,
                w: 40.0,
                h: 30.0
            }
        );
    }

    #[test]
    fn align_left_snaps_to_ref() {
        let mut d = doc(); // a at x=10, b at x=100
        align(
            &mut d,
            &["a".into(), "b".into()],
            "left",
            geom::Rect {
                x: 0.0,
                y: 0.0,
                w: 200.0,
                h: 200.0,
            },
        );
        assert_eq!(query::world_bounds(&d, "a").unwrap().x, 0.0);
        assert_eq!(query::world_bounds(&d, "b").unwrap().x, 0.0);
    }

    fn path_json(id: &str, points: &[(f32, f32)], closed: bool) -> String {
        let anchors = points
            .iter()
            .map(|(x, y)| format!("{{\"point\":{{\"x\":{x},\"y\":{y}}}}}"))
            .collect::<Vec<_>>()
            .join(",");
        format!(
            "{{\"type\":\"path\",\"id\":\"{id}\",\"geometry\":{{\"closed\":{closed},\"anchors\":[{anchors}]}},\"fill\":{{\"type\":\"none\"}}}}"
        )
    }

    #[test]
    fn nested_mutators_recurse_through_groups_and_clamp_values() {
        let json = r#"{"artboards":[],"layers":[{"visible":true,"items":[
            {"type":"group","id":"g","children":[
              {"type":"rect","id":"child","width":8,"height":6,
               "stroke":{"paint":{"type":"none"},"width":1}},
              {"type":"rect","id":"sibling","width":4,"height":4}
            ]},
            {"type":"rect","id":"top","width":3,"height":3}
        ]}]}"#;
        let mut d = Document::parse(json).unwrap();
        let blue = Paint::Solid {
            color: crate::vector::model::Rgba {
                r: 0.0,
                g: 0.0,
                b: 255.0,
                a: 1.0,
            },
        };
        let red = Paint::Solid {
            color: crate::vector::model::Rgba {
                r: 255.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            },
        };

        set_fill(&mut d, &["g".into()], &blue);
        set_stroke_paint(&mut d, &["g".into()], &red);
        set_stroke_width(&mut d, &["g".into()], 7.0);
        set_opacity(&mut d, &["child".into(), "missing".into()], 3.0);
        set_visible(&mut d, &["child".into()], false);
        set_locked(&mut d, &["child".into()], true);

        let (child, parent_world) = find_mut(&mut d, "child").unwrap();
        assert_eq!(
            (
                parent_world.a,
                parent_world.b,
                parent_world.c,
                parent_world.d,
                parent_world.e,
                parent_world.f
            ),
            (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
        );
        assert_eq!(child.opacity, 1.0);
        assert!(!child.visible);
        assert!(child.locked);
        assert_eq!(child.stroke.width, 7.0);
        match (&child.fill, &child.stroke.paint) {
            (Paint::Solid { color: fill }, Paint::Solid { color: stroke }) => {
                assert_eq!((fill.b, stroke.r), (255.0, 255.0));
            }
            _ => panic!("expected recursive fill and stroke paint"),
        }

        let (top, _) = query::find_item(&d, "top").unwrap();
        assert!(matches!(top.fill, Paint::None));
    }

    #[test]
    fn transform_around_nested_items_uses_world_space_pivot() {
        let json = r#"{"artboards":[],"layers":[{"visible":true,"items":[
            {"type":"group","id":"g","transform":{"a":1,"b":0,"c":0,"d":1,"e":20,"f":0},"children":[
              {"type":"rect","id":"child","width":10,"height":10,
               "transform":{"a":1,"b":0,"c":0,"d":1,"e":5,"f":0}}
            ]}
        ]}]}"#;
        let mut d = Document::parse(json).unwrap();
        transform_around(
            &mut d,
            &["child".into()],
            Point { x: 20.0, y: 0.0 },
            geom::m_scaling(2.0, 1.0),
        );
        let b = query::world_bounds(&d, "child").unwrap();
        assert!(
            (b.x - 30.0).abs() < 0.01,
            "bounds after world-space scale: {b:?}"
        );
        assert!((b.w - 20.0).abs() < 0.01);
    }

    #[test]
    fn convert_live_shape_variants_and_noop_for_existing_paths() {
        let json = r#"{"artboards":[],"layers":[{"visible":true,"items":[
            {"type":"ellipse","id":"e","width":20,"height":10},
            {"type":"polygon","id":"poly","radius":12,"sides":5},
            {"type":"star","id":"star","radius1":12,"radius2":4,"points":6},
            {"type":"line","id":"line","x1":1,"y1":2,"x2":3,"y2":4},
            {"type":"path","id":"p","geometry":{"closed":false,"anchors":[{"point":{"x":0,"y":0}},{"point":{"x":1,"y":1}}]}}
        ]}]}"#;
        let mut d = Document::parse(json).unwrap();
        convert_to_path(
            &mut d,
            &[
                "e".into(),
                "poly".into(),
                "star".into(),
                "line".into(),
                "p".into(),
            ],
        );
        for (id, anchors, closed) in [
            ("e", 4, true),
            ("poly", 5, true),
            ("star", 12, true),
            ("line", 2, false),
            ("p", 2, false),
        ] {
            let (item, _) = query::find_item(&d, id).unwrap();
            assert_eq!(item.kind, "path");
            let g = item.geometry.as_ref().unwrap();
            assert_eq!(g.anchors.len(), anchors);
            assert_eq!(g.closed, closed);
        }
    }

    fn open_l_path(closed: bool) -> Document {
        let json = format!(
            "{{\"artboards\":[],\"layers\":[{{\"visible\":true,\"items\":[{}]}}]}}",
            path_json("p", &[(0.0, 0.0), (100.0, 0.0), (100.0, 100.0)], closed)
        );
        Document::parse(&json).unwrap()
    }

    fn anchor0(d: &Document) -> Anchor {
        query::find_item(d, "p")
            .unwrap()
            .0
            .geometry
            .as_ref()
            .unwrap()
            .anchors[0]
            .clone()
    }

    #[test]
    fn convert_point_takes_one_sided_tangents_at_open_endpoints() {
        // (#123) prev/next wrapped modulo n regardless of `closed`, so an OPEN
        // path's first anchor took its tangent from the FAR end of the path —
        // a vertical handle on a horizontal opening segment.
        let mut d = open_l_path(false);
        toggle_anchor_smooth(&mut d, "p", 0);
        let a = anchor0(&d);
        assert!(
            (a.handle_out.x - 100.0 / 6.0).abs() < 1e-3 && a.handle_out.y.abs() < 1e-3,
            "open endpoint tangent {:?}",
            a.handle_out
        );

        // A CLOSED path still wraps: prev = (100,100), next = (100,0).
        let mut c = open_l_path(true);
        toggle_anchor_smooth(&mut c, "p", 0);
        let a = anchor0(&c);
        assert!(
            a.handle_out.x.abs() < 1e-3 && (a.handle_out.y + 100.0 / 6.0).abs() < 1e-3,
            "closed seam tangent {:?}",
            a.handle_out
        );
    }

    #[test]
    fn smooth_near_leaves_open_path_endpoints_put() {
        // (#123) Averaging with the wrapped-around far end dragged the endpoint
        // clear across the canvas.
        let mut d = open_l_path(false);
        smooth_near(&mut d, "p", 0.0, 0.0, 500.0, 1.0);
        let a = anchor0(&d);
        assert!(
            a.point.x.abs() < 1e-4 && a.point.y.abs() < 1e-4,
            "endpoint moved to {:?}",
            a.point
        );
    }

    #[test]
    fn anchor_editing_handles_mirrors_corners_deletes_and_smoothing() {
        let json = format!(
            "{{\"artboards\":[],\"layers\":[{{\"visible\":true,\"items\":[{}]}}]}}",
            path_json(
                "p",
                &[(0.0, 0.0), (10.0, 10.0), (20.0, 0.0), (30.0, 10.0)],
                false
            )
        );
        let mut d = Document::parse(&json).unwrap();

        set_handle(&mut d, "p", 1, true, 3.0, 4.0, true);
        let (item, _) = query::find_item(&d, "p").unwrap();
        let a = &item.geometry.as_ref().unwrap().anchors[1];
        assert_eq!((a.handle_in.x, a.handle_in.y), (3.0, 4.0));
        assert_eq!((a.handle_out.x, a.handle_out.y), (-3.0, -4.0));

        assert!(corner_anchor(&mut d, "p", 1));
        assert!(!corner_anchor(&mut d, "p", 1));
        toggle_anchor_smooth(&mut d, "p", 1);
        toggle_anchor_smooth(&mut d, "p", 99);
        {
            let (item, _) = query::find_item(&d, "p").unwrap();
            let a = &item.geometry.as_ref().unwrap().anchors[1];
            assert!(a.handle_in.x != 0.0 || a.handle_out.x != 0.0);
        }
        toggle_anchor_smooth(&mut d, "p", 1);

        smooth_near(&mut d, "p", 10.0, 10.0, 20.0, 1.0);
        let before_move = query::find_item(&d, "p")
            .unwrap()
            .0
            .geometry
            .as_ref()
            .unwrap()
            .anchors[0]
            .point
            .x;
        move_anchors(&mut d, "p", &[0, 99], 2.0, -1.0);
        let (item, _) = query::find_item(&d, "p").unwrap();
        assert!(
            (item.geometry.as_ref().unwrap().anchors[0].point.x - (before_move + 2.0)).abs() < 1e-5
        );

        delete_anchors(&mut d, "p", &[3, 2, 2]);
        assert_eq!(
            query::find_item(&d, "p")
                .unwrap()
                .0
                .geometry
                .as_ref()
                .unwrap()
                .anchors
                .len(),
            2
        );
        delete_anchors(&mut d, "p", &[1]);
        assert!(query::find_item(&d, "p").is_none());
    }

    #[test]
    fn path_join_cut_and_add_anchor_edge_cases() {
        let json = format!(
            "{{\"artboards\":[],\"layers\":[{{\"visible\":true,\"items\":[{},{{\"type\":\"compound\",\"id\":\"c\",\"subpaths\":[{{\"closed\":true,\"anchors\":[{{\"point\":{{\"x\":0,\"y\":0}}}},{{\"point\":{{\"x\":10,\"y\":0}}}},{{\"point\":{{\"x\":10,\"y\":10}}}}]}}]}}]}}]}}",
            path_json("p", &[(0.0, 0.0), (10.0, 0.0), (0.0, 0.0)], false)
        );
        let mut d = Document::parse(&json).unwrap();
        let mut counter = 10u64;

        assert_eq!(join_paths(&mut d, &["missing".into()], &mut counter), None);
        assert_eq!(
            join_paths(&mut d, &["p".into()], &mut counter),
            Some("p".into())
        );
        let (p, _) = query::find_item(&d, "p").unwrap();
        let g = p.geometry.as_ref().unwrap();
        assert!(g.closed);
        assert_eq!(g.anchors.len(), 2);

        let touched = add_anchor_points(&mut d, &["c".into(), "missing".into()]);
        assert_eq!(touched, vec!["c".to_string()]);
        let (c, _) = query::find_item(&d, "c").unwrap();
        assert_eq!(c.subpaths.as_ref().unwrap()[0].anchors.len(), 6);

        cut_path_at(&mut d, "p", 0, 0.5, &mut counter);
        let (p, _) = query::find_item(&d, "p").unwrap();
        assert!(!p.geometry.as_ref().unwrap().closed);
        assert!(p.geometry.as_ref().unwrap().anchors.len() >= 3);
    }

    #[test]
    fn add_and_duplicate_reid_nested_subtrees() {
        let mut d = doc();
        d.layers.push(crate::vector::model::Layer {
            id: "second".into(),
            name: String::new(),
            color: String::new(),
            visible: true,
            locked: false,
            opacity: 1.0,
            blend_mode: "normal".into(),
            template: false,
            items: Vec::new(),
        });
        let mut child = crate::vector::factory::default_item("rect");
        child.id = "old-child".into();
        child.width = 2.0;
        child.height = 2.0;
        let mut group_item = crate::vector::factory::make_group(vec![child]);
        group_item.id = "old-group".into();

        let mut counter = 40u64;
        let gid = add_item(&mut d, group_item, "missing-layer", &mut counter);
        assert_eq!(gid, "g41");
        assert_eq!(d.layers[1].items[0].children.as_ref().unwrap()[0].id, "r42");

        let copies = duplicate_items(&mut d, &["r42".into()], 5.0, 6.0, &mut counter);
        assert_eq!(copies, vec!["r43".to_string()]);
        let b = query::world_bounds(&d, "r43").unwrap();
        assert_eq!((b.x, b.y), (5.0, 6.0));
    }

    #[test]
    fn alignment_distribution_and_reordering_cover_all_actions() {
        let json = r#"{"artboards":[],"layers":[{"visible":true,"items":[
            {"type":"rect","id":"a","width":10,"height":10},
            {"type":"rect","id":"b","width":10,"height":10,"transform":{"a":1,"b":0,"c":0,"d":1,"e":30,"f":10}},
            {"type":"rect","id":"c","width":10,"height":10,"transform":{"a":1,"b":0,"c":0,"d":1,"e":80,"f":40}},
            {"type":"group","id":"g","children":[
              {"type":"rect","id":"ga","width":3,"height":3},
              {"type":"rect","id":"gb","width":3,"height":3}
            ]}
        ]}]}"#;
        let mut d = Document::parse(json).unwrap();
        let ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let r = geom::Rect {
            x: 10.0,
            y: 20.0,
            w: 120.0,
            h: 90.0,
        };
        for action in ["center-h", "right", "top", "middle-v", "bottom", "unknown"] {
            align(&mut d, &ids, action, r);
        }
        align(&mut d, &[], "left", r);
        align(&mut d, &ids[..2], "dist-h", r);
        align(&mut d, &ids, "dist-h", r);
        align(&mut d, &ids, "dist-v", r);
        assert!((query::world_bounds(&d, "a").unwrap().x - 10.0).abs() < 0.01);
        assert!((query::world_bounds(&d, "c").unwrap().bottom() - 110.0).abs() < 0.01);

        bring_forward(&mut d, &["a".into(), "ga".into()]);
        send_backward(&mut d, &["c".into(), "gb".into()]);
        bring_to_front(&mut d, &["a".into(), "ga".into()]);
        send_to_back(&mut d, &["c".into(), "gb".into()]);
        let top_ids: Vec<&str> = d.layers[0].items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(top_ids.first(), Some(&"c"));
        assert!(query::find_item(&d, "ga").is_some());
    }

    #[test]
    fn grouping_nested_selection_and_ungrouping_bakes_transform() {
        let json = r#"{"artboards":[],"layers":[{"visible":true,"items":[
            {"type":"group","id":"outer","children":[
              {"type":"rect","id":"a","width":4,"height":4},
              {"type":"rect","id":"b","width":5,"height":5},
              {"type":"rect","id":"c","width":6,"height":6}
            ]}
        ]}]}"#;
        let mut d = Document::parse(json).unwrap();
        let mut counter = 90u64;
        let gid = group(&mut d, &["a".into(), "a".into(), "b".into()], &mut counter).unwrap();
        let (g, _) = query::find_item(&d, &gid).unwrap();
        assert_eq!(g.kind, "group");
        assert_eq!(g.children.as_ref().unwrap().len(), 2);

        {
            let (g, _) = find_mut(&mut d, &gid).unwrap();
            g.transform = geom::m_translation(7.0, 8.0);
            g.opacity = 0.5;
        }
        let released = ungroup(&mut d, &[gid]);
        assert_eq!(released, vec!["a".to_string(), "b".to_string()]);
        let (a, _) = query::find_item(&d, "a").unwrap();
        assert_eq!((a.transform.e, a.transform.f, a.opacity), (7.0, 8.0, 0.5));
    }
}
