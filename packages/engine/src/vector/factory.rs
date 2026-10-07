// ─────────────────────────────────────────────────────────────
// factory — construct model items with sane defaults (Rust port of model/factory)
// ─────────────────────────────────────────────────────────────

use crate::vector::model::{Item, Matrix, Paint, Stroke};

/// A blank item of the given `type`, all fields at their neutral defaults.
pub fn default_item(kind: &str) -> Item {
    Item {
        kind: kind.to_string(),
        id: String::new(),
        transform: Matrix::default(),
        fill: Paint::None,
        stroke: Stroke::default(),
        opacity: 1.0,
        blend_mode: "normal".into(),
        visible: true,
        locked: false,
        even_odd: false,
        effects: Vec::new(),
        mask: None,
        mask_type: None,
        geometry: None,
        subpaths: None,
        children: None,
        clip: false,
        width: 0.0,
        height: 0.0,
        rx: 0.0,
        ry: 0.0,
        radii: Vec::new(),
        radius: 0.0,
        sides: 0.0,
        radius1: 0.0,
        radius2: 0.0,
        points: 0.0,
        href: String::new(),
        x1: 0.0,
        y1: 0.0,
        x2: 0.0,
        y2: 0.0,
        extra: serde_json::Map::new(),
    }
}

pub fn make_group(children: Vec<Item>) -> Item {
    let mut g = default_item("group");
    g.children = Some(children);
    g
}
