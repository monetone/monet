// ─────────────────────────────────────────────────────────────
// model — serde mirror of the Monet Artisan `.artisan` document JSON
// ─────────────────────────────────────────────────────────────
// Field shapes match `src/engine/model/types.ts` exactly (camelCase), so the
// engine consumes the SAME serialized document the TS `serializeDocument`/SVG
// exporter already produce. Items are parsed into one flat struct keyed by
// `type`, with every variant-specific field optional — robust to schema drift
// and forward-compatible with fields the renderer does not yet handle.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
pub struct Matrix {
    pub a: f32,
    pub b: f32,
    pub c: f32,
    pub d: f32,
    pub e: f32,
    pub f: f32,
}

impl Default for Matrix {
    fn default() -> Self {
        Matrix {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            e: 0.0,
            f: 0.0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default)]
pub struct Rgba {
    #[serde(default)]
    pub r: f32, // 0..255
    #[serde(default)]
    pub g: f32,
    #[serde(default)]
    pub b: f32,
    #[serde(default = "one")]
    pub a: f32, // 0..1
}

fn one() -> f32 {
    1.0
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    #[serde(default)]
    pub x: f32,
    #[serde(default)]
    pub y: f32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Anchor {
    #[serde(default)]
    pub point: Point,
    #[serde(default, rename = "handleIn")]
    pub handle_in: Point,
    #[serde(default, rename = "handleOut")]
    pub handle_out: Point,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct PathGeometry {
    #[serde(default)]
    pub anchors: Vec<Anchor>,
    #[serde(default)]
    pub closed: bool,
}

impl Item {
    /// Every outline this item carries, in the order anchors are addressed:
    /// `geometry` first, then each subpath. A glyph converted from type is one
    /// `compound` item whose contours all live in `subpaths`, so the vector
    /// tools have to see through both or they see nothing at all. (#452)
    pub fn outlines(&self) -> impl Iterator<Item = &PathGeometry> {
        self.geometry.iter().chain(self.subpaths.iter().flatten())
    }

    pub fn outlines_mut(&mut self) -> impl Iterator<Item = &mut PathGeometry> {
        self.geometry
            .iter_mut()
            .chain(self.subpaths.iter_mut().flatten())
    }

    /// Split a flat anchor index into the outline holding it and the index
    /// within that outline. `None` when the index is past the last anchor.
    pub fn outline_at(&self, mut index: usize) -> Option<(usize, usize)> {
        for (slot, geo) in self.outlines().enumerate() {
            if index < geo.anchors.len() {
                return Some((slot, index));
            }
            index -= geo.anchors.len();
        }
        None
    }

    /// The outline in slot `slot` of `outlines()`.
    pub fn outline_mut(&mut self, slot: usize) -> Option<&mut PathGeometry> {
        self.outlines_mut().nth(slot)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GradientStop {
    #[serde(default)]
    pub offset: f32,
    #[serde(default)]
    pub color: Rgba,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub midpoint: Option<f32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Gradient {
    #[serde(rename = "type", default = "linear_type")]
    pub kind: String, // "linear" | "radial"
    #[serde(default)]
    pub stops: Vec<GradientStop>,
    #[serde(default)]
    pub x1: f32,
    #[serde(default)]
    pub y1: f32,
    #[serde(default = "one")]
    pub x2: f32,
    #[serde(default)]
    pub y2: f32,
    #[serde(default = "half")]
    pub cx: f32,
    #[serde(default = "half")]
    pub cy: f32,
    #[serde(default = "half")]
    pub r: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fx: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fy: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spread: Option<String>, // "pad" | "reflect" | "repeat"
}

fn linear_type() -> String {
    "linear".into()
}
fn half() -> f32 {
    0.5
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PatternPaint {
    #[serde(default)]
    pub tile: Vec<Item>,
    #[serde(default)]
    pub width: f32,
    #[serde(default)]
    pub height: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform: Option<Matrix>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Paint {
    None,
    Solid {
        #[serde(default)]
        color: Rgba,
    },
    Gradient {
        gradient: Gradient,
    },
    Pattern {
        #[serde(default)]
        pattern: PatternPaint,
    },
}

impl Default for Paint {
    fn default() -> Self {
        Paint::None
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Stroke {
    #[serde(default)]
    pub paint: Paint,
    #[serde(default)]
    pub width: f32,
    #[serde(default = "cap_butt")]
    pub cap: String,
    #[serde(default = "join_miter")]
    pub join: String,
    #[serde(default = "four")]
    pub miter_limit: f32,
    #[serde(default)]
    pub dash: Vec<f32>,
    #[serde(default)]
    pub dash_offset: f32,
    #[serde(default = "align_center")]
    pub align: String,
    #[serde(
        default,
        rename = "widthProfile",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub width_profile: Vec<f32>,
}

impl Default for Stroke {
    fn default() -> Self {
        Stroke {
            paint: Paint::None,
            width: 0.0,
            cap: cap_butt(),
            join: join_miter(),
            miter_limit: four(),
            dash: Vec::new(),
            dash_offset: 0.0,
            align: align_center(),
            width_profile: Vec::new(),
        }
    }
}

fn cap_butt() -> String {
    "butt".into()
}
fn join_miter() -> String {
    "miter".into()
}
fn align_center() -> String {
    "center".into()
}
fn four() -> f32 {
    4.0
}

#[derive(Clone, Debug)]
pub enum Effect {
    DropShadow {
        dx: f32,
        dy: f32,
        blur: f32,
        color: Rgba,
    },
    Blur {
        radius: f32,
    },
    Feather {
        radius: f32,
    },
    Glow {
        blur: f32,
        color: Rgba,
    },
    InnerGlow {
        blur: f32,
        color: Rgba,
    },
    Unsupported(serde_json::Value),
}

impl<'de> Deserialize<'de> for Effect {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        let Some(kind) = value.get("type").and_then(|v| v.as_str()) else {
            return Ok(Effect::Unsupported(value));
        };
        let number =
            |name: &str| -> f32 { value.get(name).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32 };
        let color = || -> Rgba {
            value
                .get("color")
                .cloned()
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default()
        };
        Ok(match kind {
            "drop-shadow" => Effect::DropShadow {
                dx: number("dx"),
                dy: number("dy"),
                blur: number("blur"),
                color: color(),
            },
            "blur" => Effect::Blur {
                radius: number("radius"),
            },
            "feather" => Effect::Feather {
                radius: number("radius"),
            },
            "glow" => Effect::Glow {
                blur: number("blur"),
                color: color(),
            },
            "inner-glow" => Effect::InnerGlow {
                blur: number("blur"),
                color: color(),
            },
            _ => Effect::Unsupported(value),
        })
    }
}

impl Serialize for Effect {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let value = match self {
            Effect::DropShadow {
                dx,
                dy,
                blur,
                color,
            } => serde_json::json!({
                "type": "drop-shadow",
                "dx": dx,
                "dy": dy,
                "blur": blur,
                "color": color,
            }),
            Effect::Blur { radius } => serde_json::json!({
                "type": "blur",
                "radius": radius,
            }),
            Effect::Feather { radius } => serde_json::json!({
                "type": "feather",
                "radius": radius,
            }),
            Effect::Glow { blur, color } => serde_json::json!({
                "type": "glow",
                "blur": blur,
                "color": color,
            }),
            Effect::InnerGlow { blur, color } => serde_json::json!({
                "type": "inner-glow",
                "blur": blur,
                "color": color,
            }),
            Effect::Unsupported(value) => value.clone(),
        };
        value.serialize(serializer)
    }
}

/// One flat item record keyed by `type`. Variant-specific fields are optional so
/// any item type parses; the renderer reads only the fields its `kind` needs.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub transform: Matrix,
    #[serde(default)]
    pub fill: Paint,
    #[serde(default)]
    pub stroke: Stroke,
    #[serde(default = "one")]
    pub opacity: f32,
    #[serde(default = "normal_blend")]
    pub blend_mode: String,
    #[serde(default = "yes")]
    pub visible: bool,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub even_odd: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<Effect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<Vec<Item>>,
    #[serde(default, rename = "maskType", skip_serializing_if = "Option::is_none")]
    pub mask_type: Option<String>,

    // path / compound
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geometry: Option<PathGeometry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subpaths: Option<Vec<PathGeometry>>,

    // group
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<Item>>,
    #[serde(default)]
    pub clip: bool,

    // rect / ellipse / image
    #[serde(default)]
    pub width: f32,
    #[serde(default)]
    pub height: f32,
    #[serde(default)]
    pub rx: f32,
    #[serde(default)]
    pub ry: f32,
    /// A rect's FOUR independent corner radii — [top-left, top-right,
    /// bottom-right, bottom-left], Photoshop's live-shape corners. Empty (the
    /// default) keeps the uniform `rx`/`ry` pair; four entries win over it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub radii: Vec<f32>,

    // polygon / star
    #[serde(default)]
    pub radius: f32,
    #[serde(default)]
    pub sides: f32,
    #[serde(default)]
    pub radius1: f32,
    #[serde(default)]
    pub radius2: f32,
    #[serde(default)]
    pub points: f32,

    // image
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub href: String,

    // line
    #[serde(default)]
    pub x1: f32,
    #[serde(default)]
    pub y1: f32,
    #[serde(default)]
    pub x2: f32,
    #[serde(default)]
    pub y2: f32,

    /// Every item field the engine doesn't model explicitly (name, text runs/font
    /// properties, image natural size, …) is captured here so the
    /// engine round-trips the document losslessly via `document_json` — essential
    /// once the engine owns the document.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

fn normal_blend() -> String {
    "normal".into()
}
fn yes() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default = "yes")]
    pub visible: bool,
    #[serde(default)]
    pub locked: bool,
    #[serde(default = "one")]
    pub opacity: f32,
    #[serde(default = "normal_blend")]
    pub blend_mode: String,
    #[serde(default)]
    pub template: bool,
    #[serde(default)]
    pub items: Vec<Item>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Artboard {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub x: f32,
    #[serde(default)]
    pub y: f32,
    #[serde(default)]
    pub width: f32,
    #[serde(default)]
    pub height: f32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<serde_json::Value>,
    #[serde(default)]
    pub active_artboard: i64,
    #[serde(default)]
    pub artboards: Vec<Artboard>,
    #[serde(default)]
    pub layers: Vec<Layer>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub swatches: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slices: Option<serde_json::Value>,

    /// Every document-level field the engine doesn't model explicitly (Artisan's
    /// brushes, graphic/character/paragraph styles, actions, …) is captured here
    /// so a document round-tripping through the engine — which is what a
    /// `.monetgfx` save now does — keeps them. Mirrors `Item::extra`; without it
    /// saving an Artisan document as a container silently drops every brush and
    /// style it defines.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Document {
    /// Parse either a raw document object or the `{format,version,document}`
    /// wrapper produced by `serializeDocument`.
    pub fn parse(json: &str) -> Result<Document, serde_json::Error> {
        let v: serde_json::Value = serde_json::from_str(json)?;
        let doc_val = if v.get("document").is_some() {
            v.get("document").unwrap().clone()
        } else {
            v
        };
        serde_json::from_value(doc_val)
    }

    pub(crate) fn map_colors(&mut self, map: &mut impl FnMut(&mut Rgba)) {
        for layer in &mut self.layers {
            map_items(&mut layer.items, map);
        }
    }

    pub(crate) fn needs_rasterized_color_conversion(&self) -> bool {
        self.layers
            .iter()
            .any(|layer| items_need_rasterized_color_conversion(&layer.items))
    }
}

fn items_need_rasterized_color_conversion(items: &[Item]) -> bool {
    items.iter().any(|item| {
        (item.kind == "image" && !item.href.is_empty())
            || paint_needs_rasterized_color_conversion(&item.fill)
            || paint_needs_rasterized_color_conversion(&item.stroke.paint)
            || item
                .mask
                .as_deref()
                .is_some_and(items_need_rasterized_color_conversion)
            || item
                .children
                .as_deref()
                .is_some_and(items_need_rasterized_color_conversion)
    })
}

fn paint_needs_rasterized_color_conversion(paint: &Paint) -> bool {
    match paint {
        Paint::Gradient { .. } => true,
        Paint::Pattern { pattern } => items_need_rasterized_color_conversion(&pattern.tile),
        Paint::None | Paint::Solid { .. } => false,
    }
}

fn map_items(items: &mut [Item], map: &mut impl FnMut(&mut Rgba)) {
    for item in items {
        map_paint(&mut item.fill, map);
        map_paint(&mut item.stroke.paint, map);
        for effect in &mut item.effects {
            match effect {
                Effect::DropShadow { color, .. }
                | Effect::Glow { color, .. }
                | Effect::InnerGlow { color, .. } => map(color),
                Effect::Unsupported(value) => map_json_colors(value, map),
                Effect::Blur { .. } | Effect::Feather { .. } => {}
            }
        }
        if let Some(mask) = &mut item.mask {
            map_items(mask, map);
        }
        if let Some(children) = &mut item.children {
            map_items(children, map);
        }
        if let Some(runs) = item
            .extra
            .get_mut("runs")
            .and_then(|value| value.as_array_mut())
        {
            for run in runs {
                map_json_colors(run, map);
            }
        }
    }
}

fn map_paint(paint: &mut Paint, map: &mut impl FnMut(&mut Rgba)) {
    match paint {
        Paint::None => {}
        Paint::Solid { color } => map(color),
        Paint::Gradient { gradient } => {
            for stop in &mut gradient.stops {
                map(&mut stop.color);
            }
        }
        Paint::Pattern { pattern } => map_items(&mut pattern.tile, map),
    }
}

fn map_json_colors(value: &mut serde_json::Value, map: &mut impl FnMut(&mut Rgba)) {
    match value {
        serde_json::Value::Array(values) => {
            for value in values {
                map_json_colors(value, map);
            }
        }
        serde_json::Value::Object(object) => {
            let rgba = object
                .get("r")
                .and_then(serde_json::Value::as_f64)
                .zip(object.get("g").and_then(serde_json::Value::as_f64))
                .zip(object.get("b").and_then(serde_json::Value::as_f64))
                .zip(object.get("a").and_then(serde_json::Value::as_f64));
            if let Some((((r, g), b), a)) = rgba {
                let mut color = Rgba {
                    r: r as f32,
                    g: g as f32,
                    b: b as f32,
                    a: a as f32,
                };
                map(&mut color);
                for (key, value) in [
                    ("r", color.r),
                    ("g", color.g),
                    ("b", color.b),
                    ("a", color.a),
                ] {
                    if let Some(number) = serde_json::Number::from_f64(value as f64) {
                        object.insert(key.into(), serde_json::Value::Number(number));
                    }
                }
            }
            for value in object.values_mut() {
                map_json_colors(value, map);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod document_courier_tests {
    use super::Document;

    /// Artisan owns document-level vocabulary the engine deliberately does not
    /// model (brushes, graphic/character/paragraph styles, actions). A
    /// `.monetgfx` save routes the scene through this struct, so anything not
    /// captured by `extra` is silently destroyed on the round trip.
    #[test]
    fn document_couriers_unmodelled_artisan_fields() {
        let src = r#"{
            "id": "doc1",
            "name": "Poster",
            "activeArtboard": 0,
            "artboards": [],
            "layers": [],
            "brushes": [{ "id": "b1", "kind": "scatter" }],
            "graphicStyles": [{ "id": "gs1" }],
            "characterStyles": [{ "id": "cs1" }],
            "paragraphStyles": [{ "id": "ps1" }],
            "actions": [{ "id": "a1", "steps": 3 }]
        }"#;

        let doc = Document::parse(src).expect("parses");
        let out: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&doc).expect("serializes")).unwrap();

        for key in [
            "brushes",
            "graphicStyles",
            "characterStyles",
            "paragraphStyles",
            "actions",
        ] {
            let want: serde_json::Value = serde_json::from_str(src).unwrap();
            assert_eq!(
                out.get(key),
                want.get(key),
                "document-level `{key}` must survive an engine round trip"
            );
        }
        // The modelled fields still land in their typed homes, not in `extra`.
        assert_eq!(doc.name, "Poster");
        assert!(!doc.extra.contains_key("name"));
    }
}
