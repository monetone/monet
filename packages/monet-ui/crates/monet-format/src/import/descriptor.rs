// ─────────────────────────────────────────────────────────────
// Adobe "Descriptor" walker + the PSD full-fidelity pass.
//
// The descriptor is a self-describing key/OSType tree used by PSD for text
// (`TySh`), layer effects (`lfx2`) and several adjustment/fill layers. This
// module decodes that tree generically (`read_descriptor` / `read_ostype`) and
// then maps the blocks the structural reader collected into the IR's semantic
// `Adjustment`, `Effect` and `Text` types.
//
// All parsing is best-effort: a malformed or unrecognized block is skipped (the
// structural import — pixels, blend, opacity, masks, groups — is unaffected).
// ─────────────────────────────────────────────────────────────
#![allow(dead_code)]

use crate::import::document::*;
use crate::import::error::{FormatError, Result};
use crate::import::psd::RawLayer;
use crate::import::reader::Reader;

const MAX_DESCRIPTOR_INPUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_DESCRIPTOR_ALLOCATED_BYTES: usize = 32 * 1024 * 1024;
const MAX_DESCRIPTOR_DEPTH: usize = 64;
const MAX_DESCRIPTOR_NODES: usize = 16_384;
const MAX_DESCRIPTOR_ITEMS: usize = 32_768;
const MIN_DESCRIPTOR_ITEM_BYTES: usize = 12; // key length/key + OSType
const MIN_LIST_ITEM_BYTES: usize = 5; // OSType + smallest scalar (`bool`)
const MIN_OBJECT_ARRAY_ITEM_BYTES: usize = 20;

#[derive(Default)]
struct DescriptorBudget {
    nodes: usize,
    items: usize,
    allocated_bytes: usize,
}

impl DescriptorBudget {
    fn new(r: &Reader<'_>) -> Result<Self> {
        if r.remaining() > MAX_DESCRIPTOR_INPUT_BYTES {
            return Err(FormatError::Unsupported(
                "Photoshop descriptor exceeds input byte limit".into(),
            ));
        }
        Ok(Self::default())
    }

    fn visit_node(&mut self, depth: usize) -> Result<()> {
        if depth > MAX_DESCRIPTOR_DEPTH {
            return Err(FormatError::Unsupported(
                "Photoshop descriptor nesting exceeds depth limit".into(),
            ));
        }
        self.nodes = self
            .nodes
            .checked_add(1)
            .ok_or_else(|| FormatError::Malformed("descriptor node count overflow".into()))?;
        if self.nodes > MAX_DESCRIPTOR_NODES {
            return Err(FormatError::Unsupported(
                "Photoshop descriptor exceeds node limit".into(),
            ));
        }
        Ok(())
    }

    fn reserve_items(
        &mut self,
        count: usize,
        remaining: usize,
        min_wire_bytes: usize,
        context: &str,
    ) -> Result<()> {
        if count > remaining / min_wire_bytes {
            return Err(FormatError::Malformed(format!(
                "{context} count exceeds remaining descriptor input"
            )));
        }
        self.items = self
            .items
            .checked_add(count)
            .ok_or_else(|| FormatError::Malformed("descriptor item count overflow".into()))?;
        if self.items > MAX_DESCRIPTOR_ITEMS {
            return Err(FormatError::Unsupported(
                "Photoshop descriptor exceeds item limit".into(),
            ));
        }
        Ok(())
    }

    fn reserve_allocation(&mut self, bytes: usize) -> Result<()> {
        self.allocated_bytes = self
            .allocated_bytes
            .checked_add(bytes)
            .ok_or_else(|| FormatError::Malformed("descriptor allocation overflow".into()))?;
        if self.allocated_bytes > MAX_DESCRIPTOR_ALLOCATED_BYTES {
            return Err(FormatError::Unsupported(
                "Photoshop descriptor exceeds allocation limit".into(),
            ));
        }
        Ok(())
    }

    fn reserve_capacity<T>(&mut self, count: usize) -> Result<()> {
        let bytes = count
            .checked_mul(std::mem::size_of::<T>())
            .ok_or_else(|| FormatError::Malformed("descriptor allocation overflow".into()))?;
        self.reserve_allocation(bytes)
    }
}

// ── Descriptor value tree ──────────────────────────────────────

#[derive(Debug, Clone)]
pub(crate) enum Value {
    Descriptor(Descriptor),
    List(Vec<Value>),
    Double(f64),
    Unit { unit: [u8; 4], value: f64 },
    Text(String),
    Enum { type_id: String, value: String },
    Integer(i32),
    Large { low: u32, high: u32 },
    Bool(bool),
    Class { class_id: String },
    Alias(Vec<u8>),
    Data(Vec<u8>),
    ObjectArray(Vec<(String, Vec<f64>)>),
}

#[derive(Debug, Clone)]
pub(crate) struct Descriptor {
    pub class_id: String,
    pub items: Vec<(String, Value)>,
}

impl Descriptor {
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.items.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }
}

impl Value {
    fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Double(v) => Some(*v),
            Value::Unit { value, .. } => Some(*value),
            Value::Integer(v) => Some(*v as f64),
            _ => None,
        }
    }
    fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(b) => Some(*b),
            _ => None,
        }
    }
    fn as_text(&self) -> Option<&str> {
        match self {
            Value::Text(s) => Some(s),
            _ => None,
        }
    }
    fn as_enum(&self) -> Option<&str> {
        match self {
            Value::Enum { value, .. } => Some(value),
            _ => None,
        }
    }
    fn as_desc(&self) -> Option<&Descriptor> {
        match self {
            Value::Descriptor(d) => Some(d),
            _ => None,
        }
    }
    fn as_list(&self) -> Option<&[Value]> {
        match self {
            Value::List(v) => Some(v),
            _ => None,
        }
    }
    fn as_data(&self) -> Option<&[u8]> {
        match self {
            Value::Data(d) => Some(d),
            _ => None,
        }
    }
}

/// i32 length; if 0 a 4-byte 4cc follows, else `length` ASCII bytes (key/classID).
/// Keys are kept verbatim — 4ccs are space-padded (`Sz  `, `Md  `, `Clr `) and
/// lookups must use the exact padded form.
fn read_key(r: &mut Reader, budget: &mut DescriptorBudget) -> Result<String> {
    let len = r.i32()?;
    if len < 0 {
        return Err(FormatError::Malformed(
            "negative Photoshop descriptor key length".into(),
        ));
    }
    let n = if len == 0 { 4 } else { len as usize };
    if n > r.remaining() {
        return Err(FormatError::Malformed(
            "Photoshop descriptor key exceeds remaining input".into(),
        ));
    }
    // Invalid UTF-8 can expand to a three-byte replacement character.
    budget.reserve_allocation(
        n.checked_mul(3)
            .ok_or_else(|| FormatError::Malformed("descriptor key length overflow".into()))?,
    )?;
    let bytes = r.read_bytes(n)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn checked_i32_count(value: i32, context: &str) -> Result<usize> {
    if value < 0 {
        return Err(FormatError::Malformed(format!(
            "negative {context} count"
        )));
    }
    Ok(value as usize)
}

fn unicode_span(r: &mut Reader) -> Result<usize> {
    let count = r.u32()? as usize;
    let byte_len = count
        .checked_mul(2)
        .ok_or_else(|| FormatError::Malformed("descriptor Unicode length overflow".into()))?;
    if byte_len > r.remaining() {
        return Err(FormatError::Malformed(
            "descriptor Unicode string exceeds remaining input".into(),
        ));
    }
    Ok(count)
}

fn skip_unicode(r: &mut Reader) -> Result<()> {
    let count = unicode_span(r)?;
    r.skip(count * 2)
}

fn read_unicode(r: &mut Reader, budget: &mut DescriptorBudget) -> Result<String> {
    let count = unicode_span(r)?;
    budget.reserve_capacity::<u16>(count)?;
    budget.reserve_allocation(
        count
            .checked_mul(3)
            .ok_or_else(|| FormatError::Malformed("descriptor Unicode length overflow".into()))?,
    )?;
    let mut units = Vec::with_capacity(count);
    for _ in 0..count {
        units.push(r.u16()?);
    }
    if units.last() == Some(&0) {
        units.pop();
    }
    Ok(String::from_utf16_lossy(&units))
}

fn read_class(r: &mut Reader, budget: &mut DescriptorBudget) -> Result<String> {
    skip_unicode(r)?; // class display name is not used by the neutral IR
    read_key(r, budget)
}

/// Read `u32 version (=16) + Descriptor`, the framing of lfx2 and the TySh
/// inner descriptors.
pub(crate) fn read_version_and_descriptor(r: &mut Reader) -> Result<Descriptor> {
    let mut budget = DescriptorBudget::new(r)?;
    let _version = r.u32()?; // 16
    read_descriptor_inner(r, &mut budget, 0)
}

pub(crate) fn read_descriptor(r: &mut Reader) -> Result<Descriptor> {
    let mut budget = DescriptorBudget::new(r)?;
    read_descriptor_inner(r, &mut budget, 0)
}

fn read_descriptor_inner(
    r: &mut Reader,
    budget: &mut DescriptorBudget,
    depth: usize,
) -> Result<Descriptor> {
    budget.visit_node(depth)?;
    let class_id = read_class(r, budget)?;
    let count = r.u32()? as usize;
    budget.reserve_items(
        count,
        r.remaining(),
        MIN_DESCRIPTOR_ITEM_BYTES,
        "descriptor item",
    )?;
    budget.reserve_capacity::<(String, Value)>(count)?;
    let mut items = Vec::with_capacity(count);
    for _ in 0..count {
        let key = read_key(r, budget)?;
        let ostype = r.fourcc()?;
        let value = read_ostype(r, &ostype, budget, depth)?;
        items.push((key, value));
    }
    Ok(Descriptor { class_id, items })
}

fn read_ostype(
    r: &mut Reader,
    ostype: &[u8; 4],
    budget: &mut DescriptorBudget,
    depth: usize,
) -> Result<Value> {
    budget.visit_node(depth)?;
    match ostype {
        b"Objc" | b"GlbO" => Ok(Value::Descriptor(read_descriptor_inner(
            r,
            budget,
            depth + 1,
        )?)),
        b"VlLs" => {
            let n = checked_i32_count(r.i32()?, "descriptor list")?;
            budget.reserve_items(
                n,
                r.remaining(),
                MIN_LIST_ITEM_BYTES,
                "descriptor list item",
            )?;
            budget.reserve_capacity::<Value>(n)?;
            let mut items = Vec::with_capacity(n);
            for _ in 0..n {
                let t = r.fourcc()?;
                items.push(read_ostype(r, &t, budget, depth + 1)?);
            }
            Ok(Value::List(items))
        }
        b"doub" => Ok(Value::Double(r.f64()?)),
        b"UntF" => {
            let unit = r.fourcc()?;
            Ok(Value::Unit {
                unit,
                value: r.f64()?,
            })
        }
        b"UnFl" => {
            let unit = r.fourcc()?;
            Ok(Value::Unit {
                unit,
                value: r.f32()? as f64,
            })
        }
        b"TEXT" => Ok(Value::Text(read_unicode(r, budget)?.replace('\r', "\n"))),
        b"enum" => {
            let type_id = read_key(r, budget)?;
            let value = read_key(r, budget)?;
            Ok(Value::Enum { type_id, value })
        }
        b"long" => Ok(Value::Integer(r.i32()?)),
        b"comp" => Ok(Value::Large {
            low: r.u32()?,
            high: r.u32()?,
        }),
        b"bool" => Ok(Value::Bool(r.u8()? != 0)),
        b"type" | b"GlbC" => Ok(Value::Class {
            class_id: read_class(r, budget)?,
        }),
        b"alis" => {
            let n = checked_i32_count(r.i32()?, "descriptor alias byte")?;
            if n > r.remaining() {
                return Err(FormatError::Malformed(
                    "descriptor alias exceeds remaining input".into(),
                ));
            }
            budget.reserve_allocation(n)?;
            Ok(Value::Alias(r.read_vec(n)?))
        }
        b"tdta" => {
            let n = checked_i32_count(r.i32()?, "descriptor data byte")?;
            if n > r.remaining() {
                return Err(FormatError::Malformed(
                    "descriptor data exceeds remaining input".into(),
                ));
            }
            budget.reserve_allocation(n)?;
            Ok(Value::Data(r.read_vec(n)?))
        }
        b"ObAr" => {
            let _version = r.i32()?;
            skip_unicode(r)?;
            let _ty = read_key(r, budget)?;
            let n = checked_i32_count(r.i32()?, "descriptor object-array")?;
            budget.reserve_items(
                n,
                r.remaining(),
                MIN_OBJECT_ARRAY_ITEM_BYTES,
                "descriptor object-array item",
            )?;
            budget.reserve_capacity::<(String, Vec<f64>)>(n)?;
            let mut items = Vec::with_capacity(n);
            for _ in 0..n {
                let t = read_key(r, budget)?;
                let _sig = r.fourcc()?; // UnFl
                let _unit = r.fourcc()?;
                let vc = checked_i32_count(r.i32()?, "descriptor object-array value")?;
                budget.reserve_items(
                    vc,
                    r.remaining(),
                    std::mem::size_of::<f64>(),
                    "descriptor object-array value",
                )?;
                budget.reserve_capacity::<f64>(vc)?;
                let mut vals = Vec::with_capacity(vc);
                for _ in 0..vc {
                    vals.push(r.f64()?);
                }
                items.push((t, vals));
            }
            Ok(Value::ObjectArray(items))
        }
        other => Err(crate::import::error::FormatError::Unsupported(format!(
            "descriptor OSType {:?}",
            String::from_utf8_lossy(other)
        ))),
    }
}

// ── Mapping helpers ────────────────────────────────────────────

/// Descriptor blend enum (`BlnM` values) → neutral BlendMode.
fn blend_from_enum(v: &str) -> BlendMode {
    use crate::import::BlendMode::*;
    match v {
        "Nrml" => Normal,
        "Dslv" => Dissolve,
        "Drkn" => Darken,
        "Mltp" => Multiply,
        "CBrn" => ColorBurn,
        "linearBurn" => LinearBurn,
        "darkerColor" => DarkerColor,
        "Lghn" => Lighten,
        "Scrn" => Screen,
        "CDdg" => ColorDodge,
        "linearDodge" => LinearDodge,
        "lighterColor" => LighterColor,
        "Ovrl" => Overlay,
        "SftL" => SoftLight,
        "HrdL" => HardLight,
        "vividLight" => VividLight,
        "linearLight" => LinearLight,
        "pinLight" => PinLight,
        "hardMix" => HardMix,
        "Dfrn" => Difference,
        "Xclu" => Exclusion,
        "blendSubtraction" => Subtract,
        "blendDivide" => Divide,
        "H   " => Hue,
        "Strt" => Saturation,
        "Clr " => Color,
        "Lmns" => Luminosity,
        _ => Normal,
    }
}

fn d_blend(d: &Descriptor) -> BlendMode {
    d.get("Md  ")
        .and_then(|v| v.as_enum())
        .map(blend_from_enum)
        .unwrap_or(BlendMode::Normal)
}
/// Opacity stored as a percent unit (0..100) → 0..1.
fn d_opacity(d: &Descriptor) -> f32 {
    d.get("Opct")
        .and_then(|v| v.as_f64())
        .and_then(|v| {
            let value = (v / 100.0) as f32;
            value.is_finite().then_some(value)
        })
        .unwrap_or(1.0)
}
fn d_f32(d: &Descriptor, key: &str, default: f32) -> f32 {
    d.get(key)
        .and_then(|v| v.as_f64())
        .and_then(|v| {
            let value = v as f32;
            value.is_finite().then_some(value)
        })
        .unwrap_or(default)
}
fn d_pct(d: &Descriptor, key: &str, default: f32) -> f32 {
    d.get(key)
        .and_then(|v| v.as_f64())
        .and_then(|v| {
            let value = (v / 100.0) as f32;
            value.is_finite().then_some(value)
        })
        .unwrap_or(default)
}
fn d_bool(d: &Descriptor, key: &str) -> bool {
    d.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}
fn d_enabled(d: &Descriptor) -> bool {
    // enab defaults to on when absent.
    d.get("enab").and_then(|v| v.as_bool()).unwrap_or(true)
}

/// A descriptor colour object (`Rd  `/`Grn `/`Bl  ` doubles 0..255) → Color3 0..1.
pub(crate) fn color_from(v: Option<&Value>) -> Color3 {
    let d = match v.and_then(|v| v.as_desc()) {
        Some(d) => d,
        None => return Color3::new(0.0, 0.0, 0.0),
    };
    let c = |k: &str| {
        d.get(k)
            .and_then(|v| v.as_f64())
            .and_then(|v| {
                let value = v as f32 / 255.0;
                value.is_finite().then_some(value)
            })
            .unwrap_or(0.0)
    };
    Color3::new(c("Rd  "), c("Grn "), c("Bl  "))
}

// ── Effects (lfx2) ─────────────────────────────────────────────

pub(crate) fn parse_effects(bytes: &[u8]) -> Vec<Effect> {
    let mut out = Vec::new();
    let mut r = Reader::new(bytes);
    // lfx2: u32 object-version(=0) + version-and-descriptor.
    if r.u32().unwrap_or(1) != 0 {
        return out;
    }
    let desc = match read_version_and_descriptor(&mut r) {
        Ok(d) => d,
        Err(_) => return out,
    };

    if let Some(d) = desc
        .get("DrSh")
        .and_then(|v| v.as_desc())
        .filter(|d| d_enabled(d))
    {
        out.push(Effect::DropShadow {
            blend: d_blend(d),
            opacity: d_opacity(d),
            color: color_from(d.get("Clr ")),
            angle: d_f32(d, "Angl", 120.0),
            distance: d_f32(d, "Dstn", 0.0),
            spread: d_pct(d, "Ckmt", 0.0),
            size: d_f32(d, "blur", 0.0),
        });
    }
    if let Some(d) = desc
        .get("IrSh")
        .and_then(|v| v.as_desc())
        .filter(|d| d_enabled(d))
    {
        out.push(Effect::InnerShadow {
            blend: d_blend(d),
            opacity: d_opacity(d),
            color: color_from(d.get("Clr ")),
            angle: d_f32(d, "Angl", 120.0),
            distance: d_f32(d, "Dstn", 0.0),
            choke: d_pct(d, "Ckmt", 0.0),
            size: d_f32(d, "blur", 0.0),
        });
    }
    if let Some(d) = desc
        .get("OrGl")
        .and_then(|v| v.as_desc())
        .filter(|d| d_enabled(d))
    {
        out.push(Effect::OuterGlow {
            blend: d_blend(d),
            opacity: d_opacity(d),
            color: color_from(d.get("Clr ")),
            spread: d_pct(d, "Ckmt", 0.0),
            size: d_f32(d, "blur", 0.0),
        });
    }
    if let Some(d) = desc
        .get("IrGl")
        .and_then(|v| v.as_desc())
        .filter(|d| d_enabled(d))
    {
        let center = d
            .get("glwS")
            .and_then(|v| v.as_enum())
            .map(|e| e == "SrcC")
            .unwrap_or(false);
        out.push(Effect::InnerGlow {
            blend: d_blend(d),
            opacity: d_opacity(d),
            color: color_from(d.get("Clr ")),
            choke: d_pct(d, "Ckmt", 0.0),
            size: d_f32(d, "blur", 0.0),
            center,
        });
    }
    if let Some(d) = desc
        .get("ebbl")
        .and_then(|v| v.as_desc())
        .filter(|d| d_enabled(d))
    {
        let style = match d.get("bvlS").and_then(|v| v.as_enum()).unwrap_or("InrB") {
            "OtrB" => 1,
            "Embs" => 2,
            "PlEb" => 3,
            _ => 0,
        };
        out.push(Effect::Bevel {
            hl_blend: d
                .get("hglM")
                .and_then(|v| v.as_enum())
                .map(blend_from_enum)
                .unwrap_or(BlendMode::Screen),
            hl_opacity: d_pct(d, "hglO", 0.75),
            hl_color: color_from(d.get("hglC")),
            sh_blend: d
                .get("sdwM")
                .and_then(|v| v.as_enum())
                .map(blend_from_enum)
                .unwrap_or(BlendMode::Multiply),
            sh_opacity: d_pct(d, "sdwO", 0.75),
            sh_color: color_from(d.get("sdwC")),
            angle: d_f32(d, "lagl", 120.0),
            altitude: d_f32(d, "Lald", 30.0),
            depth: (d_f32(d, "srgR", 100.0) / 100.0).max(0.1),
            size: d_f32(d, "blur", 8.0),
            soften: d_f32(d, "Sftn", 0.0),
            style,
        });
    }
    if let Some(d) = desc
        .get("ChFX")
        .and_then(|v| v.as_desc())
        .filter(|d| d_enabled(d))
    {
        out.push(Effect::Satin {
            blend: d_blend(d),
            opacity: d_opacity(d),
            color: color_from(d.get("Clr ")),
            angle: d_f32(d, "Angl", 19.0),
            distance: d_f32(d, "Dstn", 11.0),
            size: d_f32(d, "blur", 14.0),
            invert: d_bool(d, "Invr"),
        });
    }
    if let Some(d) = desc
        .get("SoFi")
        .and_then(|v| v.as_desc())
        .filter(|d| d_enabled(d))
    {
        out.push(Effect::ColorOverlay {
            blend: d_blend(d),
            opacity: d_opacity(d),
            color: color_from(d.get("Clr ")),
        });
    }
    if let Some(d) = desc
        .get("GrFl")
        .and_then(|v| v.as_desc())
        .filter(|d| d_enabled(d))
    {
        let (start, end) = gradient_endpoints(d.get("Grad"));
        let radial = d
            .get("Type")
            .and_then(|v| v.as_enum())
            .map(|e| e == "Rdl ")
            .unwrap_or(false);
        out.push(Effect::GradientOverlay {
            blend: d_blend(d),
            opacity: d_opacity(d),
            angle: d_f32(d, "Angl", 90.0),
            scale: (d_f32(d, "Scl ", 100.0) / 100.0).max(0.01),
            radial,
            reverse: d_bool(d, "Rvrs"),
            start,
            end,
        });
    }
    if let Some(d) = desc
        .get("patternFill")
        .and_then(|v| v.as_desc())
        .filter(|d| d_enabled(d))
    {
        out.push(Effect::PatternOverlay {
            blend: d_blend(d),
            opacity: d_opacity(d),
            scale: (d_f32(d, "Scl ", 100.0) / 100.0 * 16.0).max(1.0),
            kind: 0,
        });
    }
    if let Some(d) = desc
        .get("FrFX")
        .and_then(|v| v.as_desc())
        .filter(|d| d_enabled(d))
    {
        let position = match d.get("Styl").and_then(|v| v.as_enum()).unwrap_or("OutF") {
            "InsF" => 1,
            "CtrF" => 2,
            _ => 0,
        };
        out.push(Effect::Stroke {
            blend: d_blend(d),
            opacity: d_opacity(d),
            color: color_from(d.get("Clr ")),
            size: d_f32(d, "Sz  ", 3.0),
            position,
        });
    }
    out
}

/// Pull the first and last colour stop from a gradient (`Grad`) descriptor.
fn gradient_endpoints(v: Option<&Value>) -> (Color3, Color3) {
    let default = (Color3::new(0.1, 0.2, 0.6), Color3::new(0.9, 0.4, 0.1));
    let d = match v.and_then(|v| v.as_desc()) {
        Some(d) => d,
        None => return default,
    };
    let stops = match d.get("Clrs").and_then(|v| v.as_list()) {
        Some(s) if !s.is_empty() => s,
        _ => return default,
    };
    let stop_color = |val: &Value| color_from(val.as_desc().and_then(|sd| sd.get("Clr ")));
    let start = stop_color(&stops[0]);
    let end = stop_color(&stops[stops.len() - 1]);
    (start, end)
}

// ── Text (TySh) ────────────────────────────────────────────────

fn warp_index(style: &str) -> u8 {
    match style {
        "warpArc" => 1,
        "warpArcLower" => 2,
        "warpArcUpper" => 3,
        "warpArch" => 4,
        "warpBulge" => 5,
        "warpShellLower" => 6,
        "warpShellUpper" => 7,
        "warpFlag" => 8,
        "warpWave" => 9,
        "warpFish" => 10,
        "warpRise" => 11,
        "warpFisheye" => 12,
        "warpInflate" => 13,
        "warpSqueeze" => 14,
        "warpTwist" => 15,
        _ => 0, // warpNone
    }
}

fn antialias_index(v: &str) -> u8 {
    match v {
        "antiAliasSharp" => 1,
        "antiAliasCrisp" => 2,
        "antiAliasStrong" => 3,
        "antiAliasSmooth" => 4,
        _ => 0,
    }
}

pub(crate) fn parse_text(bytes: &[u8]) -> Option<Text> {
    let mut r = Reader::new(bytes);
    if r.i16().ok()? != 1 {
        return None;
    }
    let mut transform = [0.0f64; 6];
    for t in transform.iter_mut() {
        *t = r.f64().ok()?;
        if !t.is_finite() {
            return None;
        }
    }
    if r.i16().ok()? != 50 {
        return None;
    }
    let text_desc = read_version_and_descriptor(&mut r).ok()?;
    let _warp_ver = r.i16().ok()?;
    let warp_desc = read_version_and_descriptor(&mut r).ok();

    let string = text_desc
        .get("Txt ")
        .and_then(|v| v.as_text())
        .unwrap_or("")
        .to_string();
    let point = text_desc
        .get("TextShape")
        .or_else(|| text_desc.get("textShape"))
        .is_none(); // paragraph layers carry a bounding box / shape
    let vertical = text_desc
        .get("Ornt")
        .and_then(|v| v.as_enum())
        .map(|e| e == "Vrtc")
        .unwrap_or(false);
    let antialias = text_desc
        .get("AntA")
        .and_then(|v| v.as_enum())
        .map(antialias_index)
        .unwrap_or(1);

    let mut text = Text {
        string,
        point,
        vertical,
        antialias,
        size: 0.0,
        color: [255, 255, 255, 255],
        align: 0,
        origin: (transform[4].round() as i32, transform[5].round() as i32),
        ..Default::default()
    };

    // EngineData parsing is transactional: only a completely valid bounded
    // style/paragraph tree is applied. Malformed canonical data leaves the
    // editable approximation at its defaults; the layer's rendered pixels are
    // retained by the structural importer.
    if let Some(eng) = text_desc.get("EngineData").and_then(|v| v.as_data()) {
        scan_engine_data(eng, &mut text, transform[3] as f32);
    }
    if text.size <= 0.0 {
        text.size = 48.0;
    }

    if let Some(w) = warp_desc {
        text.warp_style = w
            .get("warpStyle")
            .and_then(|v| v.as_enum())
            .map(warp_index)
            .unwrap_or(0);
        text.warp_bend = d_pct(&w, "warpValue", 0.0);
        text.warp_h = d_pct(&w, "warpPerspective", 0.0);
        text.warp_v = d_pct(&w, "warpPerspectiveOther", 0.0);
    }
    Some(text)
}

const MAX_ENGINE_DATA_BYTES: usize = 1024 * 1024;
const MAX_ENGINE_DATA_NODES: usize = 32_768;
const MAX_ENGINE_DATA_DEPTH: usize = 64;
const MAX_ENGINE_DATA_ITEMS: usize = 4096;
const MAX_ENGINE_DATA_STRING_BYTES: usize = 512 * 1024;
const MAX_ENGINE_TEXT_RUNS: usize = 4096;
const MAX_ENGINE_FONTS: usize = 1024;

fn scan_engine_data(data: &[u8], text: &mut Text, transform_scale: f32) {
    if data.len() > MAX_ENGINE_DATA_BYTES {
        return;
    }
    if let Some(parsed) = parse_engine_text(data, &text.string) {
        parsed.apply(text, transform_scale);
        return;
    }
    // Preserve compatibility with the old Monet ASCII-only EngineData writer.
    // Canonical Photoshop strings carry a UTF-16BE BOM; if one of those trees
    // is malformed, do not scrape and partially apply it.
    if !data.windows(2).any(|window| window == [0xfe, 0xff]) {
        scan_legacy_engine_data(data, text, transform_scale);
    }
}

fn scan_legacy_engine_data(data: &[u8], text: &mut Text, transform_scale: f32) {
    let s = String::from_utf8_lossy(data);
    if let Some(sz) = find_number_after(&s, "/FontSize") {
        let scale = if transform_scale.is_finite() && transform_scale > 0.0 {
            transform_scale
        } else {
            1.0
        };
        text.size = sz * scale;
    }
    if let Some(idx) = s.find("/FillColor") {
        if let Some(vstart) = s[idx..].find("/Values").map(|p| idx + p) {
            if let Some(lb) = s[vstart..].find('[').map(|p| vstart + p) {
                if let Some(rb) = s[lb..].find(']').map(|p| lb + p) {
                    let nums: Vec<f32> = s[lb + 1..rb]
                        .split_whitespace()
                        .filter_map(|t| t.parse::<f32>().ok())
                        .collect();
                    if nums.len() >= 4 {
                        // Values are [A, R, G, B] in 0..1.
                        let to8 = |v: f32| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
                        text.color = [to8(nums[1]), to8(nums[2]), to8(nums[3]), to8(nums[0])];
                    }
                }
            }
        }
    }
    if let Some(name) = find_paren_after(&s, "/Name") {
        if !name.is_empty() {
            text.font = Some(name);
        }
    }
}

#[derive(Clone, Debug)]
enum EngineValue {
    Dict(Vec<(String, EngineValue)>),
    Array(Vec<EngineValue>),
    Number(f64),
    Bool(bool),
    Text(String),
    Name,
    Null,
}

impl EngineValue {
    fn dict(&self) -> Option<&[(String, EngineValue)]> {
        match self {
            Self::Dict(value) => Some(value),
            _ => None,
        }
    }

    fn array(&self) -> Option<&[EngineValue]> {
        match self {
            Self::Array(value) => Some(value),
            _ => None,
        }
    }

    fn number(&self) -> Option<f64> {
        match self {
            Self::Number(value) => Some(*value),
            _ => None,
        }
    }

    fn boolean(&self) -> Option<bool> {
        match self {
            Self::Bool(value) => Some(*value),
            _ => None,
        }
    }

    fn text(&self) -> Option<&str> {
        match self {
            Self::Text(value) => Some(value),
            _ => None,
        }
    }
}

fn engine_get<'a>(dict: &'a [(String, EngineValue)], key: &str) -> Option<&'a EngineValue> {
    dict.iter().find(|(name, _)| name == key).map(|(_, value)| value)
}

struct EngineParser<'a> {
    data: &'a [u8],
    position: usize,
    end: usize,
    nodes: usize,
}

impl<'a> EngineParser<'a> {
    fn new(data: &'a [u8]) -> Option<Self> {
        if data.len() > MAX_ENGINE_DATA_BYTES {
            return None;
        }
        let mut end = data.len();
        while end > 0 && data[end - 1] == 0 {
            end -= 1;
        }
        Some(Self {
            data,
            position: 0,
            end,
            nodes: 0,
        })
    }

    fn parse(mut self) -> Option<EngineValue> {
        self.skip_space();
        let value = self.value(0)?;
        self.skip_space();
        (self.position == self.end).then_some(value)
    }

    fn value(&mut self, depth: usize) -> Option<EngineValue> {
        if depth > MAX_ENGINE_DATA_DEPTH || self.nodes >= MAX_ENGINE_DATA_NODES {
            return None;
        }
        self.nodes += 1;
        self.skip_space();
        if self.consume(b"<<") {
            self.dictionary(depth + 1)
        } else if self.consume(b"[") {
            self.array(depth + 1)
        } else if self.consume(b"(") {
            self.string()
        } else if self.consume_keyword(b"true") {
            Some(EngineValue::Bool(true))
        } else if self.consume_keyword(b"false") {
            Some(EngineValue::Bool(false))
        } else if self.consume_keyword(b"null") {
            Some(EngineValue::Null)
        } else if self.peek() == Some(b'/') {
            let _name = self.name()?;
            Some(EngineValue::Name)
        } else {
            self.number().map(EngineValue::Number)
        }
    }

    fn dictionary(&mut self, depth: usize) -> Option<EngineValue> {
        let mut values = Vec::new();
        loop {
            self.skip_space();
            if self.consume(b">>") {
                return Some(EngineValue::Dict(values));
            }
            if values.len() >= MAX_ENGINE_DATA_ITEMS {
                return None;
            }
            let key = self.name()?;
            let value = self.value(depth)?;
            values.push((key, value));
        }
    }

    fn array(&mut self, depth: usize) -> Option<EngineValue> {
        let mut values = Vec::new();
        loop {
            self.skip_space();
            if self.consume(b"]") {
                return Some(EngineValue::Array(values));
            }
            if values.len() >= MAX_ENGINE_DATA_ITEMS {
                return None;
            }
            values.push(self.value(depth)?);
        }
    }

    fn string(&mut self) -> Option<EngineValue> {
        if self.position + 2 <= self.end
            && self.data[self.position..self.position + 2] == [0xfe, 0xff]
        {
            self.position += 2;
            let mut bytes = Vec::new();
            loop {
                let byte = self.take()?;
                if byte == b')' {
                    break;
                }
                let byte = if byte == b'\\' { self.take()? } else { byte };
                if bytes.len() >= MAX_ENGINE_DATA_STRING_BYTES {
                    return None;
                }
                bytes.push(byte);
            }
            if bytes.len() % 2 != 0 {
                return None;
            }
            let units = bytes
                .chunks_exact(2)
                .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
                .collect::<Vec<_>>();
            String::from_utf16(&units).ok().map(EngineValue::Text)
        } else {
            let mut bytes = Vec::new();
            loop {
                let byte = self.take()?;
                if byte == b')' {
                    break;
                }
                let byte = if byte == b'\\' {
                    match self.take()? {
                        b'r' => b'\r',
                        b'n' => b'\n',
                        b't' => b'\t',
                        b'b' => 8,
                        b'f' => 12,
                        escaped => escaped,
                    }
                } else {
                    byte
                };
                if bytes.len() >= MAX_ENGINE_DATA_STRING_BYTES {
                    return None;
                }
                bytes.push(byte);
            }
            String::from_utf8(bytes).ok().map(EngineValue::Text)
        }
    }

    fn number(&mut self) -> Option<f64> {
        let start = self.position;
        while self.position < self.end && !is_engine_delimiter(self.data[self.position]) {
            self.position += 1;
            if self.position - start > 64 {
                return None;
            }
        }
        if self.position == start {
            return None;
        }
        let value = std::str::from_utf8(&self.data[start..self.position])
            .ok()?
            .parse::<f64>()
            .ok()?;
        value.is_finite().then_some(value)
    }

    fn name(&mut self) -> Option<String> {
        if self.take()? != b'/' {
            return None;
        }
        let start = self.position;
        while self.position < self.end && !is_engine_delimiter(self.data[self.position]) {
            self.position += 1;
            if self.position - start > 256 {
                return None;
            }
        }
        if self.position == start {
            return None;
        }
        std::str::from_utf8(&self.data[start..self.position])
            .ok()
            .map(str::to_string)
    }

    fn consume_keyword(&mut self, keyword: &[u8]) -> bool {
        if self.position + keyword.len() > self.end
            || &self.data[self.position..self.position + keyword.len()] != keyword
        {
            return false;
        }
        let next = self.position + keyword.len();
        if next < self.end && !is_engine_delimiter(self.data[next]) {
            return false;
        }
        self.position = next;
        true
    }

    fn consume(&mut self, token: &[u8]) -> bool {
        if self.position + token.len() <= self.end
            && &self.data[self.position..self.position + token.len()] == token
        {
            self.position += token.len();
            true
        } else {
            false
        }
    }

    fn skip_space(&mut self) {
        while self.position < self.end && self.data[self.position].is_ascii_whitespace() {
            self.position += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        (self.position < self.end).then(|| self.data[self.position])
    }

    fn take(&mut self) -> Option<u8> {
        let value = self.peek()?;
        self.position += 1;
        Some(value)
    }
}

fn is_engine_delimiter(value: u8) -> bool {
    value.is_ascii_whitespace() || matches!(value, b'<' | b'>' | b'[' | b']' | b'(' | b')' | b'/')
}

#[derive(Clone, Default)]
struct EngineStyle {
    font: Option<usize>,
    size: Option<f32>,
    color: Option<[u8; 4]>,
    faux_bold: Option<bool>,
    faux_italic: Option<bool>,
    underline: Option<bool>,
    strike: Option<bool>,
    tracking: Option<f32>,
    h_scale: Option<f32>,
    v_scale: Option<f32>,
    baseline: Option<f32>,
    caps: Option<u8>,
    auto_leading: Option<bool>,
    leading: Option<f32>,
}

impl EngineStyle {
    fn overlay(&self, overlay: &Self) -> Self {
        macro_rules! choose {
            ($field:ident) => {
                overlay.$field.or(self.$field)
            };
        }
        Self {
            font: choose!(font),
            size: choose!(size),
            color: overlay.color.or(self.color),
            faux_bold: choose!(faux_bold),
            faux_italic: choose!(faux_italic),
            underline: choose!(underline),
            strike: choose!(strike),
            tracking: choose!(tracking),
            h_scale: choose!(h_scale),
            v_scale: choose!(v_scale),
            baseline: choose!(baseline),
            caps: choose!(caps),
            auto_leading: choose!(auto_leading),
            leading: choose!(leading),
        }
    }

    fn effective_leading(&self) -> f32 {
        if self.auto_leading.unwrap_or(false) {
            0.0
        } else {
            self.leading.unwrap_or(0.0)
        }
    }
}

struct ParsedEngineText {
    size: Option<f32>,
    color: Option<[u8; 4]>,
    font: Option<String>,
    runs: Vec<TextRun>,
    align: Option<u8>,
    leading: Option<f32>,
    tracking: Option<f32>,
    point: Option<bool>,
    box_size: Option<(f32, f32)>,
}

impl ParsedEngineText {
    fn apply(self, text: &mut Text, transform_scale: f32) {
        let scale = if transform_scale.is_finite() && transform_scale > 0.0 {
            transform_scale
        } else {
            1.0
        };
        if let Some(size) = self.size {
            text.size = size * scale;
        }
        if let Some(color) = self.color {
            text.color = color;
        }
        if let Some(font) = self.font {
            text.font = Some(font);
        }
        text.runs = self.runs;
        for run in &mut text.runs {
            if let Some(size) = &mut run.size {
                *size *= scale;
            }
            if let Some(baseline) = &mut run.baseline {
                *baseline *= scale;
            }
        }
        if let Some(align) = self.align {
            text.align = align;
        }
        if let Some(leading) = self.leading {
            text.leading = leading * scale;
        }
        if let Some(tracking) = self.tracking {
            text.tracking = tracking;
        }
        if let Some(point) = self.point {
            text.point = point;
            text.box_size = if point { None } else { self.box_size };
        }
    }
}

fn parse_engine_text(data: &[u8], descriptor_text: &str) -> Option<ParsedEngineText> {
    let root = EngineParser::new(data)?.parse()?;
    let root = root.dict()?;
    let engine = engine_get(root, "EngineDict")?.dict()?;
    let editor = engine_get(engine, "Editor")?.dict()?;
    let editor_text = engine_get(editor, "Text")?.text()?.replace('\r', "\n");
    let trailing_units = if editor_text == descriptor_text {
        0
    } else if editor_text
        .strip_suffix('\n')
        .is_some_and(|without_return| without_return == descriptor_text)
    {
        1
    } else {
        return None;
    };
    let editor_units = editor_text.encode_utf16().count();

    let resources = engine_get(root, "ResourceDict")?.dict()?;
    let fonts = parse_engine_fonts(resources)?;
    let resource_style = parse_resource_style(resources)?;
    let mut base_style = resource_style.clone().unwrap_or_default();
    let style_run = engine_get(engine, "StyleRun")?.dict()?;
    let run_values = engine_get(style_run, "RunArray")?.array()?;
    let run_lengths = parse_run_lengths(engine_get(style_run, "RunLengthArray")?, editor_units)?;
    if run_values.len() != run_lengths.len() || run_values.len() > MAX_ENGINE_TEXT_RUNS {
        return None;
    }
    let raw_styles = run_values
        .iter()
        .map(parse_style_run)
        .collect::<Option<Vec<_>>>()?;
    if resource_style.is_none() {
        if let Some(first) = raw_styles.first() {
            base_style = base_style.overlay(first);
        }
    }
    if base_style.font.is_none() {
        let named = fonts
            .iter()
            .enumerate()
            .filter(|(_, name)| name.as_deref().is_some_and(|name| name != "AdobeInvisFont"))
            .collect::<Vec<_>>();
        if named.len() == 1 {
            base_style.font = Some(named[0].0);
        }
    }

    let styles = raw_styles
        .iter()
        .map(|style| base_style.overlay(style))
        .collect::<Vec<_>>();
    if base_style.font.is_some() && engine_font_name(base_style.font, &fonts).is_none() {
        return None;
    }
    let base_leading = base_style.effective_leading();
    if styles
        .iter()
        .any(|style| !close_engine_number(style.effective_leading(), base_leading))
    {
        // The neutral IR has paragraph leading, not per-character leading.
        return None;
    }

    let mut semantic_lengths = run_lengths;
    if trailing_units == 1 {
        let last = semantic_lengths.last_mut()?;
        *last = last.checked_sub(1)?;
    }
    let mut remaining = descriptor_text;
    let mut runs = Vec::with_capacity(styles.len());
    for (style, units) in styles.iter().zip(semantic_lengths) {
        let (run_text, rest) = take_utf16_prefix(remaining, units)?;
        remaining = rest;
        if units == 0 {
            continue;
        }
        runs.push(engine_style_to_text_run(
            run_text,
            style,
            &base_style,
            &fonts,
        )?);
    }
    if !remaining.is_empty() {
        return None;
    }
    if runs.len() == 1 && text_run_is_default(&runs[0]) {
        runs.clear();
    }

    let (align, _paragraph_seen) = parse_engine_paragraph(engine, editor_units)?;
    let (point, box_size) = parse_engine_shape(engine)?;
    let base_font = engine_font_name(base_style.font, &fonts).map(str::to_string);
    Some(ParsedEngineText {
        size: base_style.size,
        color: base_style.color,
        font: base_font,
        runs,
        align,
        leading: Some(base_leading),
        tracking: base_style.tracking,
        point,
        box_size,
    })
}

fn parse_engine_fonts(resources: &[(String, EngineValue)]) -> Option<Vec<Option<String>>> {
    let values = engine_get(resources, "FontSet")?.array()?;
    if values.len() > MAX_ENGINE_FONTS {
        return None;
    }
    values
        .iter()
        .map(|value| {
            let dict = value.dict()?;
            match engine_get(dict, "Name") {
                Some(value) => Some(Some(value.text()?.to_string())),
                None => Some(None),
            }
        })
        .collect()
}

fn parse_resource_style(resources: &[(String, EngineValue)]) -> Option<Option<EngineStyle>> {
    let Some(values) = engine_get(resources, "StyleSheetSet") else {
        return Some(None);
    };
    let values = values.array()?;
    let Some(first) = values.first() else {
        return Some(None);
    };
    let first = first.dict()?;
    let style = engine_get(first, "StyleSheetData")?.dict()?;
    parse_engine_style(style).map(Some)
}

fn parse_style_run(value: &EngineValue) -> Option<EngineStyle> {
    let run = value.dict()?;
    let sheet = engine_get(run, "StyleSheet")?.dict()?;
    let style = engine_get(sheet, "StyleSheetData")?.dict()?;
    parse_engine_style(style)
}

fn parse_engine_style(style: &[(String, EngineValue)]) -> Option<EngineStyle> {
    let font = optional_engine_usize(style, "Font", MAX_ENGINE_FONTS)?;
    let size = optional_engine_f32(style, "FontSize")?;
    if size.is_some_and(|value| value <= 0.0 || value > 1_000_000.0) {
        return None;
    }
    let color = match engine_get(style, "FillColor") {
        Some(value) => Some(parse_engine_color(value)?),
        None => None,
    };
    let h_scale = optional_engine_f32(style, "HorizontalScale")?;
    let v_scale = optional_engine_f32(style, "VerticalScale")?;
    if h_scale.is_some_and(|value| value <= 0.0 || value > 1_000_000.0)
        || v_scale.is_some_and(|value| value <= 0.0 || value > 1_000_000.0)
    {
        return None;
    }
    let caps = optional_engine_u8(style, "FontCaps", 2)?;
    Some(EngineStyle {
        font,
        size,
        color,
        faux_bold: optional_engine_bool(style, "FauxBold")?,
        faux_italic: optional_engine_bool(style, "FauxItalic")?,
        underline: optional_engine_bool(style, "Underline")?,
        strike: optional_engine_bool(style, "Strikethrough")?,
        tracking: bounded_optional_engine_f32(style, "Tracking")?,
        h_scale,
        v_scale,
        baseline: bounded_optional_engine_f32(style, "BaselineShift")?,
        caps,
        auto_leading: optional_engine_bool(style, "AutoLeading")?,
        leading: bounded_optional_engine_f32(style, "Leading")?,
    })
}

fn parse_engine_color(value: &EngineValue) -> Option<[u8; 4]> {
    let color = value.dict()?;
    if optional_engine_usize(color, "Type", 2)? != Some(1) {
        return None;
    }
    let values = engine_get(color, "Values")?.array()?;
    if values.len() != 4 {
        return None;
    }
    let mut channels = [0u8; 4];
    for (output, value) in channels.iter_mut().zip(values) {
        let value = value.number()?;
        if !(0.0..=1.0).contains(&value) {
            return None;
        }
        *output = (value * 255.0 + 0.5) as u8;
    }
    Some([channels[1], channels[2], channels[3], channels[0]])
}

fn parse_run_lengths(value: &EngineValue, expected_units: usize) -> Option<Vec<usize>> {
    let values = value.array()?;
    if values.is_empty() || values.len() > MAX_ENGINE_TEXT_RUNS {
        return None;
    }
    let mut total = 0usize;
    let mut lengths = Vec::with_capacity(values.len());
    for value in values {
        let length = engine_usize(value, MAX_ENGINE_DATA_STRING_BYTES)?;
        if length == 0 {
            return None;
        }
        total = total.checked_add(length)?;
        lengths.push(length);
    }
    (total == expected_units).then_some(lengths)
}

fn parse_engine_paragraph(
    engine: &[(String, EngineValue)],
    editor_units: usize,
) -> Option<(Option<u8>, bool)> {
    let Some(paragraph) = engine_get(engine, "ParagraphRun") else {
        return Some((None, false));
    };
    let paragraph = paragraph.dict()?;
    let values = engine_get(paragraph, "RunArray")?.array()?;
    let lengths = parse_run_lengths(engine_get(paragraph, "RunLengthArray")?, editor_units)?;
    if values.len() != lengths.len() || values.len() > MAX_ENGINE_TEXT_RUNS {
        return None;
    }
    let mut align = None;
    for value in values {
        let run = value.dict()?;
        let sheet = engine_get(run, "ParagraphSheet")?.dict()?;
        let properties = engine_get(sheet, "Properties")?.dict()?;
        let current = match optional_engine_usize(properties, "Justification", 6)? {
            Some(0) | None => 0,
            Some(1) => 1,
            Some(2) => 2,
            Some(3..=6) => 3,
            Some(_) => return None,
        };
        if align.is_some_and(|known| known != current) {
            // Per-paragraph alignment cannot be flattened into Text::align.
            return None;
        }
        align = Some(current);
    }
    Some((align, true))
}

fn parse_engine_shape(
    engine: &[(String, EngineValue)],
) -> Option<(Option<bool>, Option<(f32, f32)>)> {
    let Some(rendered) = engine_get(engine, "Rendered") else {
        return Some((None, None));
    };
    let rendered = rendered.dict()?;
    let shapes = engine_get(rendered, "Shapes")?.dict()?;
    let children = engine_get(shapes, "Children")?.array()?;
    if children.len() > 1 {
        return None;
    }
    let Some(first) = children.first() else {
        return Some((None, None));
    };
    let first = first.dict()?;
    let cookie = engine_get(first, "Cookie")?.dict()?;
    let photoshop = engine_get(cookie, "Photoshop")?.dict()?;
    match optional_engine_usize(photoshop, "ShapeType", 1)? {
        Some(0) | None => Some((Some(true), None)),
        Some(1) => {
            let bounds = engine_get(photoshop, "BoxBounds")?.array()?;
            if bounds.len() != 4 {
                return None;
            }
            let numbers = bounds
                .iter()
                .map(|value| engine_f32(value, 1_000_000.0))
                .collect::<Option<Vec<_>>>()?;
            let width = numbers[2] - numbers[0];
            let height = numbers[3] - numbers[1];
            if width <= 0.0 || height <= 0.0 {
                return None;
            }
            Some((Some(false), Some((width, height))))
        }
        Some(_) => None,
    }
}

fn engine_style_to_text_run(
    run_text: &str,
    style: &EngineStyle,
    base: &EngineStyle,
    fonts: &[Option<String>],
) -> Option<TextRun> {
    let font = match style.font {
        Some(index) => Some(fonts.get(index)?.as_deref()?),
        None => None,
    };
    let base_font = match base.font {
        Some(index) => Some(fonts.get(index)?.as_deref()?),
        None => None,
    };
    Some(TextRun {
        text: run_text.to_string(),
        font: (font != base_font).then(|| font.map(str::to_string)).flatten(),
        size: different_engine_f32(style.size, base.size),
        color: (style.color != base.color).then_some(style.color).flatten(),
        bold: false,
        italic: false,
        faux_bold: style.faux_bold.unwrap_or(false),
        faux_italic: style.faux_italic.unwrap_or(false),
        underline: style.underline.unwrap_or(false),
        strike: style.strike.unwrap_or(false),
        tracking: different_engine_f32(style.tracking, base.tracking),
        h_scale: different_from_engine_default(style.h_scale, 1.0),
        v_scale: different_from_engine_default(style.v_scale, 1.0),
        baseline: different_from_engine_default(style.baseline, 0.0),
        caps: style.caps.filter(|caps| *caps != 0),
    })
}

fn text_run_is_default(run: &TextRun) -> bool {
    run.font.is_none()
        && run.size.is_none()
        && run.color.is_none()
        && !run.bold
        && !run.italic
        && !run.faux_bold
        && !run.faux_italic
        && !run.underline
        && !run.strike
        && run.tracking.is_none()
        && run.h_scale.is_none()
        && run.v_scale.is_none()
        && run.baseline.is_none()
        && run.caps.is_none()
}

fn take_utf16_prefix(value: &str, units: usize) -> Option<(&str, &str)> {
    if units == 0 {
        return Some(("", value));
    }
    let mut count = 0usize;
    for (index, character) in value.char_indices() {
        count += character.len_utf16();
        if count == units {
            let end = index + character.len_utf8();
            return Some(value.split_at(end));
        }
        if count > units {
            return None;
        }
    }
    None
}

fn engine_font_name<'a>(index: Option<usize>, fonts: &'a [Option<String>]) -> Option<&'a str> {
    index.and_then(|index| fonts.get(index))?.as_deref()
}

fn different_engine_f32(value: Option<f32>, base: Option<f32>) -> Option<f32> {
    let value = value?;
    (!base.is_some_and(|base| close_engine_number(value, base))).then_some(value)
}

fn different_from_engine_default(value: Option<f32>, default: f32) -> Option<f32> {
    value.filter(|value| !close_engine_number(*value, default))
}

fn close_engine_number(left: f32, right: f32) -> bool {
    (left - right).abs() <= f32::EPSILON * left.abs().max(right.abs()).max(1.0) * 4.0
}

fn optional_engine_bool(dict: &[(String, EngineValue)], key: &str) -> Option<Option<bool>> {
    match engine_get(dict, key) {
        Some(value) => value.boolean().map(Some),
        None => Some(None),
    }
}

fn optional_engine_f32(dict: &[(String, EngineValue)], key: &str) -> Option<Option<f32>> {
    match engine_get(dict, key) {
        Some(value) => engine_f32(value, f32::MAX).map(Some),
        None => Some(None),
    }
}

fn bounded_optional_engine_f32(
    dict: &[(String, EngineValue)],
    key: &str,
) -> Option<Option<f32>> {
    match engine_get(dict, key) {
        Some(value) => engine_f32(value, 1_000_000.0).map(Some),
        None => Some(None),
    }
}

fn optional_engine_u8(
    dict: &[(String, EngineValue)],
    key: &str,
    max: u8,
) -> Option<Option<u8>> {
    match optional_engine_usize(dict, key, usize::from(max))? {
        Some(value) => Some(Some(u8::try_from(value).ok()?)),
        None => Some(None),
    }
}

fn optional_engine_usize(
    dict: &[(String, EngineValue)],
    key: &str,
    max: usize,
) -> Option<Option<usize>> {
    match engine_get(dict, key) {
        Some(value) => engine_usize(value, max).map(Some),
        None => Some(None),
    }
}

fn engine_usize(value: &EngineValue, max: usize) -> Option<usize> {
    let value = value.number()?;
    if value < 0.0 || value > max as f64 || value.fract() != 0.0 {
        return None;
    }
    Some(value as usize)
}

fn engine_f32(value: &EngineValue, max_abs: f32) -> Option<f32> {
    let value = value.number()?;
    if !value.is_finite() || value.abs() > f64::from(max_abs) {
        return None;
    }
    Some(value as f32)
}

fn find_number_after(s: &str, key: &str) -> Option<f32> {
    let i = s.find(key)? + key.len();
    let rest = s[i..].trim_start();
    let num: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
        .collect();
    num.parse::<f32>().ok()
}

fn find_paren_after(s: &str, key: &str) -> Option<String> {
    let i = s.find(key)? + key.len();
    let lp = s[i..].find('(').map(|p| i + p)?;
    let rp = s[lp..].find(')').map(|p| lp + p)?;
    Some(s[lp + 1..rp].to_string())
}

// ── Adjustments ────────────────────────────────────────────────

fn parse_adjustment(raw: &RawLayer) -> Option<Adjustment> {
    for &&key in super::psd::PSD_ADJUSTMENT_KEYS {
        if let Some(bytes) = raw.find(&key) {
            if let Some(adjustment) = parse_adjustment_block(key, bytes) {
                return Some(adjustment);
            }
        }
    }
    None
}

pub(crate) fn parse_adjustment_block(key: [u8; 4], b: &[u8]) -> Option<Adjustment> {
    if &key == b"brit" {
        let mut r = Reader::new(b);
        let brightness = r.i16().ok()? as f32;
        let contrast = r.i16().ok()? as f32;
        return Some(Adjustment::BrightnessContrast {
            brightness: (brightness / 100.0).clamp(-1.0, 1.0),
            contrast: (contrast / 100.0).clamp(-1.0, 1.0),
        });
    }
    if &key == b"nvrt" {
        return Some(Adjustment::Invert);
    }
    if &key == b"post" {
        let mut r = Reader::new(b);
        let _ver = r.u16().ok();
        let levels = r.i16().ok().unwrap_or(6).max(2) as f32;
        return Some(Adjustment::Posterize { levels });
    }
    if &key == b"thrs" {
        let mut r = Reader::new(b);
        let _ver = r.u16().ok();
        let level = r.i16().ok().unwrap_or(128) as f32 / 255.0;
        return Some(Adjustment::Threshold { level });
    }
    if &key == b"levl" {
        return parse_levels(b);
    }
    // Binary adjustment blocks. Photoshop writes Exposure / Hue-Saturation /
    // Color-Balance as fixed binary structures, NOT descriptors (matching
    // ag-psd's `expA`/`hue2`/`blnc` handlers).
    let binary = match &key {
        b"expA" => Some(parse_exposure_binary as fn(&[u8]) -> Option<Adjustment>),
        b"hue2" => Some(parse_hue_sat_binary as fn(&[u8]) -> Option<Adjustment>),
        b"blnc" => Some(parse_color_balance_binary as fn(&[u8]) -> Option<Adjustment>),
        _ => None,
    };
    if let Some(parse) = binary {
        return parse(b);
    }
    // Genuinely descriptor-based adjustments (Vibrance, Black & White; the
    // descriptor form of Photo Filter — its binary form needs a Lab colour decode).
    let descriptor = match &key {
        b"vibA" => Some(parse_vibrance as fn(&Descriptor) -> Option<Adjustment>),
        b"blwh" => Some(parse_black_white as fn(&Descriptor) -> Option<Adjustment>),
        b"phfl" => Some(parse_photo_filter as fn(&Descriptor) -> Option<Adjustment>),
        _ => None,
    };
    if let Some(parse) = descriptor {
        let mut r = Reader::new(b);
        return read_version_and_descriptor(&mut r)
            .ok()
            .and_then(|descriptor| parse(&descriptor));
    }
    None
}

/// Legacy `levl`: version u16, then 29 channels × 5×u16 (inLow, inHigh,
/// outLow, outHigh, gamma×100). Channel 0 is the composite/master.
fn parse_levels(b: &[u8]) -> Option<Adjustment> {
    let mut r = Reader::new(b);
    let _ver = r.u16().ok()?;
    let in_low = r.u16().ok()? as f32 / 255.0;
    let in_high = r.u16().ok()? as f32 / 255.0;
    let out_low = r.u16().ok()? as f32 / 255.0;
    let out_high = r.u16().ok()? as f32 / 255.0;
    let gamma = r.u16().ok()? as f32 / 100.0;
    Some(Adjustment::Levels {
        in_black: in_low,
        in_white: in_high.max(in_low + 1e-3),
        gamma: gamma.max(1e-3),
        out_black: out_low,
        out_white: out_high,
    })
}

/// `expA` (Exposure): version u16(=1), then exposure / offset / gamma as
/// big-endian f32. Photoshop writes this as binary, not a descriptor.
fn parse_exposure_binary(b: &[u8]) -> Option<Adjustment> {
    let mut r = Reader::new(b);
    if r.u16().ok()? != 1 {
        return None;
    }
    let exposure = r.f32().ok()?;
    let offset = r.f32().ok()?;
    let gamma = r.f32().ok()?;
    if !exposure.is_finite() || !offset.is_finite() || !gamma.is_finite() {
        return None;
    }
    Some(Adjustment::Exposure {
        exposure: exposure.clamp(-3.0, 3.0),
        offset,
        gamma: gamma.max(1e-3),
    })
}

fn read_hue_sat_triple(r: &mut Reader<'_>) -> Option<[f32; 3]> {
    Some([
        r.i16().ok()? as f32,
        (r.i16().ok()? as f32 / 100.0).clamp(-1.0, 1.0),
        (r.i16().ok()? as f32 / 100.0).clamp(-1.0, 1.0),
    ])
}

/// `hue2` (Hue/Saturation): version u16(=2), a byte colorize flag + pad,
/// colorization H/S/L, master H/S/L, then six colour-range records containing
/// four bounds and H/S/L. Bounds are retained by the raw PSD block; Monet's
/// semantic model needs only each range's adjustment triple.
fn parse_hue_sat_binary(b: &[u8]) -> Option<Adjustment> {
    let mut r = Reader::new(b);
    if r.u16().ok()? != 2 {
        return None;
    }
    let colorize = r.u8().ok()? != 0;
    r.u8().ok()?; // pad
    let colorization = read_hue_sat_triple(&mut r)?;
    let master = read_hue_sat_triple(&mut r)?;
    let mut ranges = [[0.0; 3]; 6];
    let mut has_range_bounds = false;
    for range in &mut ranges {
        for _ in 0..4 {
            has_range_bounds |= r.i16().ok()? != 0;
        }
        *range = read_hue_sat_triple(&mut r)?;
    }

    let [hue, saturation, lightness] = if colorize { colorization } else { master };
    if !colorize && !has_range_bounds && ranges.iter().flatten().all(|value| *value == 0.0) {
        Some(Adjustment::HueSaturation {
            hue,
            saturation,
            lightness,
        })
    } else {
        Some(Adjustment::HueSaturationFull {
            hue,
            saturation,
            lightness,
            colorize,
            ranges,
        })
    }
}

/// `blnc` (Color Balance): three i16 triples (shadows, midtones, highlights as
/// cyan-red / magenta-green / yellow-blue), then a preserve-luminosity byte.
/// There is no version field.
fn parse_color_balance_binary(b: &[u8]) -> Option<Adjustment> {
    let mut r = Reader::new(b);
    let mut trip = || -> Option<[f32; 3]> {
        Some([
            r.i16().ok()? as f32 / 100.0,
            r.i16().ok()? as f32 / 100.0,
            r.i16().ok()? as f32 / 100.0,
        ])
    };
    let shadows = trip()?;
    let midtones = trip()?;
    let highlights = trip()?;
    Some(Adjustment::ColorBalance {
        shadows,
        midtones,
        highlights,
    })
}

fn parse_vibrance(d: &Descriptor) -> Option<Adjustment> {
    Some(Adjustment::Vibrance {
        vibrance: (d_f32(d, "vibrance", 0.0) / 100.0).clamp(-1.0, 1.0),
        saturation: (d_f32(d, "Strt", 0.0) / 100.0).clamp(-1.0, 1.0),
    })
}

/// `blwh` (Black & White): a descriptor of per-hue grayscale weights (Rd/Yllw/
/// Grn/Cyn/Bl/Mgnt) plus an optional colour tint. Three-key blocks generated by
/// older Monet versions retain the legacy RGB-weight representation.
fn parse_black_white(d: &Descriptor) -> Option<Adjustment> {
    let is_full = ["Yllw", "Cyn ", "Mgnt", "useTint", "tintColor"]
        .iter()
        .any(|key| d.get(key).is_some());
    if !is_full {
        return Some(Adjustment::BlackWhite {
            r: d_f32(d, "Rd  ", 40.0),
            g: d_f32(d, "Grn ", 40.0),
            b: d_f32(d, "Bl  ", 20.0),
        });
    }

    let (tint_hue, tint_saturation) = color_from(d.get("tintColor")).hue_saturation();
    Some(Adjustment::BlackWhiteFull {
        bands: [
            d_f32(d, "Rd  ", 40.0) / 100.0,
            d_f32(d, "Yllw", 60.0) / 100.0,
            d_f32(d, "Grn ", 40.0) / 100.0,
            d_f32(d, "Cyn ", 60.0) / 100.0,
            d_f32(d, "Bl  ", 20.0) / 100.0,
            d_f32(d, "Mgnt", 80.0) / 100.0,
        ],
        tint: d_bool(d, "useTint"),
        tint_hue,
        tint_saturation,
    })
}

fn parse_photo_filter(d: &Descriptor) -> Option<Adjustment> {
    let color = color_from(d.get("Clr "));
    Some(Adjustment::PhotoFilter {
        color,
        density: d_pct(d, "Dnst", 0.25),
    })
}

// ── Orchestration ──────────────────────────────────────────────

/// Decode text / adjustment / effect detail from a layer's tagged blocks into
/// the IR layer. Best-effort: failures leave the structural import intact.
pub(crate) fn psd_fidelity(raw: &RawLayer, layer: &mut Layer, _depth: u16) {
    if let Some(bytes) = raw.find(b"lfx2") {
        let fx = parse_effects(bytes);
        if !fx.is_empty() {
            layer.effects = fx;
        }
    }
    match layer.kind {
        LayerKind::Text => {
            if let Some(bytes) = raw.find(b"TySh") {
                if let Some(t) = parse_text(bytes) {
                    layer.text = Some(t);
                }
            }
        }
        LayerKind::Adjustment => {
            layer.adjustment = parse_adjustment(raw);
        }
        _ => {}
    }
}

#[cfg(test)]
mod engine_data_tests {
    use super::*;

    #[test]
    fn oversized_engine_data_is_ignored_without_partial_mutation() {
        let mut text = Text {
            string: "keep".into(),
            size: 19.0,
            color: [1, 2, 3, 4],
            font: Some("KeepFont".into()),
            point: true,
            ..Default::default()
        };
        let expected = text.clone();
        scan_engine_data(&vec![b' '; MAX_ENGINE_DATA_BYTES + 1], &mut text, 1.0);
        assert_eq!(text, expected);
    }

    #[test]
    fn malformed_utf16_engine_data_is_transactional() {
        let mut text = Text {
            string: "keep".into(),
            size: 19.0,
            color: [1, 2, 3, 4],
            font: Some("KeepFont".into()),
            point: true,
            ..Default::default()
        };
        let expected = text.clone();
        scan_engine_data(
            b"<< /EngineDict << /Editor << /Text (\xfe\xff\0k) >>",
            &mut text,
            1.0,
        );
        assert_eq!(text, expected);
    }
}

#[cfg(test)]
mod descriptor_bounds_tests {
    use super::*;

    fn empty_class(out: &mut Vec<u8>) {
        out.extend_from_slice(&0u32.to_be_bytes()); // empty Unicode display name
        out.extend_from_slice(&0i32.to_be_bytes());
        out.extend_from_slice(b"null");
    }

    fn item_header(out: &mut Vec<u8>, key: &[u8; 4], ostype: &[u8; 4]) {
        out.extend_from_slice(&0i32.to_be_bytes());
        out.extend_from_slice(key);
        out.extend_from_slice(ostype);
    }

    fn nested_descriptor(out: &mut Vec<u8>, remaining: usize) {
        empty_class(out);
        if remaining == 0 {
            out.extend_from_slice(&0u32.to_be_bytes());
        } else {
            out.extend_from_slice(&1u32.to_be_bytes());
            item_header(out, b"nest", b"Objc");
            nested_descriptor(out, remaining - 1);
        }
    }

    fn rejects_without_panicking(bytes: &[u8]) -> FormatError {
        let result = std::panic::catch_unwind(|| {
            let mut reader = Reader::new(bytes);
            read_descriptor(&mut reader)
        });
        result
            .expect("hostile descriptor must not panic")
            .expect_err("hostile descriptor must be rejected")
    }

    #[test]
    fn compact_declared_counts_are_rejected_before_capacity_allocation() {
        let mut descriptor = Vec::new();
        empty_class(&mut descriptor);
        descriptor.extend_from_slice(&u32::MAX.to_be_bytes());
        assert!(matches!(
            rejects_without_panicking(&descriptor),
            FormatError::Malformed(_)
        ));

        let mut list = Vec::new();
        empty_class(&mut list);
        list.extend_from_slice(&1u32.to_be_bytes());
        item_header(&mut list, b"list", b"VlLs");
        list.extend_from_slice(&i32::MAX.to_be_bytes());
        assert!(matches!(
            rejects_without_panicking(&list),
            FormatError::Malformed(_)
        ));
    }

    #[test]
    fn recursive_descriptor_depth_is_bounded() {
        let mut bytes = Vec::new();
        nested_descriptor(&mut bytes, MAX_DESCRIPTOR_DEPTH + 2);
        assert!(bytes.len() < 4 * 1024);
        assert!(matches!(
            rejects_without_panicking(&bytes),
            FormatError::Unsupported(message) if message.contains("depth limit")
        ));
    }

    #[test]
    fn broad_descriptor_node_count_is_bounded() {
        let mut bytes = Vec::new();
        empty_class(&mut bytes);
        bytes.extend_from_slice(&1u32.to_be_bytes());
        item_header(&mut bytes, b"list", b"VlLs");
        bytes.extend_from_slice(&(MAX_DESCRIPTOR_NODES as i32).to_be_bytes());
        for _ in 0..MAX_DESCRIPTOR_NODES {
            bytes.extend_from_slice(b"bool");
            bytes.push(0);
        }
        assert!(bytes.len() < 128 * 1024);
        assert!(matches!(
            rejects_without_panicking(&bytes),
            FormatError::Unsupported(message) if message.contains("node limit")
        ));
    }
}
