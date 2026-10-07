// ─────────────────────────────────────────────────────────────
// The neutral Monet document IR. PSD/PSB/XCF all parse into this; the engine
// adapter (in monet-vision's `engine/`) maps it 1:1 onto its `Layer` structs.
//
// Conventions, chosen to line up with the engine with zero translation:
//   • `layers` is BOTTOM-TO-TOP (index 0 = bottommost), matching the engine's
//     internal layer vec and `.mvision` order.
//   • `BlendMode` variants are in the engine's exact enum order, so
//     `to_index()` is the engine `BlendMode` u8.
//   • Pixels are 8-bit straight-alpha RGBA, layer-local (w*h*4 for `bounds`).
//     The engine widens to u16 via *257 and blits at the layer offset.
//   • Adjustment / Effect / Text are SEMANTIC (not engine param floats); the
//     adapter owns the engine's numeric encodings.
// ─────────────────────────────────────────────────────────────

use serde::{Deserialize, Serialize};

/// Which file the document was parsed from.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceFormat {
    Psd,
    Psb,
    Xcf,
}

/// Document colour model (from the PSD header / XCF base type).
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorMode {
    Bitmap,
    Grayscale,
    Indexed,
    Rgb,
    Cmyk,
    Multichannel,
    Duotone,
    Lab,
}

/// Layer compositing mode. Order == the engine's `BlendMode` enum, so the
/// adapter uses `to_index()` directly as the engine blend byte.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlendMode {
    Normal,
    Dissolve,
    Darken,
    Multiply,
    ColorBurn,
    LinearBurn,
    Lighten,
    Screen,
    ColorDodge,
    LinearDodge,
    Overlay,
    SoftLight,
    HardLight,
    VividLight,
    LinearLight,
    PinLight,
    HardMix,
    Difference,
    Exclusion,
    Subtract,
    Divide,
    Hue,
    Saturation,
    Color,
    Luminosity,
    // Whole-pixel comparison modes. The engine reserves index 25 for the
    // group-only PassThrough mode, so these map to 26/27 (see `to_index`).
    DarkerColor,
    LighterColor,
}

impl BlendMode {
    /// The engine `BlendMode` index. Most variants map 1:1 by declaration
    /// order, but the engine reserves 25 for PassThrough (which has no
    /// monet-format variant), so the comparison modes jump to 26/27.
    pub fn to_index(self) -> u8 {
        match self {
            BlendMode::DarkerColor => 26,
            BlendMode::LighterColor => 27,
            other => other as u8,
        }
    }

    /// Inverse of `to_index`. The engine reserves 25 for PassThrough (a
    /// group-only mode with no `import` variant) — callers must represent that
    /// via the layer's `pass_through` flag and pass any non-mapping index here
    /// (it falls back to `Normal`).
    pub fn from_index(i: u8) -> BlendMode {
        use BlendMode::*;
        match i {
            0 => Normal,
            1 => Dissolve,
            2 => Darken,
            3 => Multiply,
            4 => ColorBurn,
            5 => LinearBurn,
            6 => Lighten,
            7 => Screen,
            8 => ColorDodge,
            9 => LinearDodge,
            10 => Overlay,
            11 => SoftLight,
            12 => HardLight,
            13 => VividLight,
            14 => LinearLight,
            15 => PinLight,
            16 => HardMix,
            17 => Difference,
            18 => Exclusion,
            19 => Subtract,
            20 => Divide,
            21 => Hue,
            22 => Saturation,
            23 => Color,
            24 => Luminosity,
            26 => DarkerColor,
            27 => LighterColor,
            _ => Normal, // 25 (PassThrough) and any unknown
        }
    }
}

/// What sort of layer this is. Maps to the engine `kind` byte (0/1/2/6/7).
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayerKind {
    Raster,
    Adjustment,
    Text,
    Group,
    SmartObject,
}

/// An opaque Photoshop additional-info payload retained for lossless foreign
/// round-tripping. The parser stores a bounded allow-list of editable semantic
/// blocks (text, adjustments, and layer effects), Smart Object,
/// vector-mask/shape, fill-layer, and linked-source blocks it can place back
/// into a PSD; arbitrary untrusted blocks are not retained.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct PsdTaggedBlock {
    pub key: [u8; 4],
    pub data: Vec<u8>,
}

/// Photoshop channel display metadata (image resource 1077). Raw colour-space
/// components are retained because spot inks may be RGB, CMYK, Lab, Gray, or
/// another Photoshop colour space that the RGB compositor does not own.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChannelDisplayInfo {
    pub color_space: u16,
    pub color: [u16; 4],
    /// Photoshop stores channel opacity/solidity as an integer percentage.
    pub opacity: u16,
    /// 0 = masked-area alpha, 1 = selected-area alpha, 2 = spot colour.
    /// Unknown values remain intact for forward-compatible round-tripping.
    pub mode: u8,
}

/// One ordered document-level alpha or spot channel. Ordering is significant:
/// Photoshop permits alpha and spot plates to be interleaved in image data.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct DocumentChannel {
    pub name: Option<String>,
    pub identifier: Option<u32>,
    pub display: Option<ChannelDisplayInfo>,
    /// 8-bit authority, or a compatibility preview for a native plane below.
    pub data: Vec<u8>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data16: Vec<u16>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data32: Vec<f32>,
}

/// Maximum aggregate opaque Photoshop data retained by one document. Embedded
/// Smart Object sources are untrusted input and must not grow memory without a
/// hard ceiling.
pub const MAX_PSD_PRESERVED_BYTES: usize = 128 * 1024 * 1024;
pub const MAX_PSD_PRESERVED_BLOCKS: usize = 256;

/// Largest accepted absolute RGB value in a native float raster. PSD stores
/// IEEE-754 f32 channels, so every finite f32 is valid authority; allocation
/// limits are enforced by dimensions/sample counts instead of color magnitude.
/// Alpha is separately constrained to 0..1.
pub const MAX_HDR_SAMPLE: f32 = f32::MAX;

/// A layer's pixel rectangle: top-left offset on the canvas plus size. The
/// active pixel payload (`rgba`, `rgba16`, or `rgba32`) is exactly `w*h*4`
/// samples in this rect's local space.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// A layer mask: a grayscale coverage plane (255 = reveal) with its own rect
/// and an out-of-rect default colour.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Mask {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    /// 8-bit coverage authority, or a compatibility preview when one of the
    /// native high-depth planes below is populated.
    pub data: Vec<u8>,
    /// Native 16-bit mask samples retained for exact PSD/PSB round-tripping.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data16: Vec<u16>,
    /// Native 32-bit float mask samples retained for exact PSD/PSB
    /// round-tripping. The 8-bit `data` field remains the render preview.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data32: Vec<f32>,
    pub default: u8,
    pub disabled: bool,
    /// PSD bit 0: mask coordinates move with the layer. Defaults true for
    /// non-PSD and older unified documents, matching the engine default.
    #[serde(default = "default_true")]
    pub relative: bool,
    /// PSD bit 2: invert mask values while compositing.
    #[serde(default)]
    pub invert: bool,
    /// Optional Photoshop user-mask density byte (0..255).
    #[serde(default)]
    pub density: Option<u8>,
    /// Optional Photoshop user-mask feather radius, in pixels.
    #[serde(default)]
    pub feather: Option<f64>,
    /// Optional Photoshop vector-mask density byte (0..255).
    #[serde(default)]
    pub vector_density: Option<u8>,
    /// Optional Photoshop vector-mask feather radius, in pixels.
    #[serde(default)]
    pub vector_feather: Option<f64>,
    /// Photoshop's optional real user mask (`-3` channel), which has its own
    /// geometry, flags, default value, and native-depth coverage plane.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub real: Option<Box<Mask>>,
}

fn default_true() -> bool {
    true
}

/// An RGB triple in 0..1, as layer-style effects store colour.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub struct Color3 {
    pub r: f32,
    pub g: f32,
    pub b: f32,
}

impl Color3 {
    pub fn new(r: f32, g: f32, b: f32) -> Color3 {
        Color3 { r, g, b }
    }

    pub(crate) fn hue_saturation(self) -> (f32, f32) {
        let max = self.r.max(self.g).max(self.b);
        let min = self.r.min(self.g).min(self.b);
        let lightness = (max + min) * 0.5;
        if (max - min).abs() < 1e-6 {
            return (0.0, 0.0);
        }
        let delta = max - min;
        let saturation = if lightness > 0.5 {
            delta / (2.0 - max - min)
        } else {
            delta / (max + min)
        };
        let hue = if max == self.r {
            (self.g - self.b) / delta + if self.g < self.b { 6.0 } else { 0.0 }
        } else if max == self.g {
            (self.b - self.r) / delta + 2.0
        } else {
            (self.r - self.g) / delta + 4.0
        };
        (hue * 60.0, saturation)
    }

    pub(crate) fn from_hue_saturation(hue: f32, saturation: f32) -> Color3 {
        fn hue_channel(p: f32, q: f32, mut hue: f32) -> f32 {
            if hue < 0.0 {
                hue += 1.0;
            }
            if hue > 1.0 {
                hue -= 1.0;
            }
            if hue < 1.0 / 6.0 {
                p + (q - p) * 6.0 * hue
            } else if hue < 0.5 {
                q
            } else if hue < 2.0 / 3.0 {
                p + (q - p) * (2.0 / 3.0 - hue) * 6.0
            } else {
                p
            }
        }

        let hue = hue.rem_euclid(360.0) / 360.0;
        let saturation = saturation.clamp(0.0, 1.0);
        let p = 0.5 - saturation * 0.5;
        let q = 0.5 + saturation * 0.5;
        Color3::new(
            hue_channel(p, q, hue + 1.0 / 3.0),
            hue_channel(p, q, hue),
            hue_channel(p, q, hue - 1.0 / 3.0),
        )
    }
}

/// A non-destructive adjustment carried by an adjustment layer. Fields are in
/// the engine's *units* (signed-normalized / 0..1), ready for the adapter to
/// pack into `adj_params`.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum Adjustment {
    BrightnessContrast {
        brightness: f32,
        contrast: f32,
    },
    Levels {
        in_black: f32,
        in_white: f32,
        gamma: f32,
        out_black: f32,
        out_white: f32,
    },
    HueSaturation {
        hue: f32,
        saturation: f32,
        lightness: f32,
    },
    /// Photoshop's full Hue/Saturation model: the active master/colorize
    /// triple plus six `[hue, saturation, lightness]` colour ranges. The
    /// legacy three-field variant above remains the serialized form for old
    /// Monet documents and master-only engine payloads.
    HueSaturationFull {
        hue: f32,
        saturation: f32,
        lightness: f32,
        colorize: bool,
        ranges: [[f32; 3]; 6],
    },
    Vibrance {
        vibrance: f32,
        saturation: f32,
    },
    Invert,
    Desaturate,
    BlackWhite {
        r: f32,
        g: f32,
        b: f32,
    },
    /// Photoshop's six hue-band Black & White model. `bands` and tint
    /// saturation use normalized engine units; tint hue is in degrees.
    BlackWhiteFull {
        bands: [f32; 6],
        tint: bool,
        tint_hue: f32,
        tint_saturation: f32,
    },
    Posterize {
        levels: f32,
    },
    Threshold {
        level: f32,
    },
    Exposure {
        exposure: f32,
        offset: f32,
        gamma: f32,
    },
    ColorBalance {
        shadows: [f32; 3],
        midtones: [f32; 3],
        highlights: [f32; 3],
    },
    PhotoFilter {
        color: Color3,
        density: f32,
    },
    Curves {
        lut: Vec<f32>,
    }, // 256 outputs in 0..1
    GradientMap {
        lut: Vec<f32>,
    }, // 256*3 RGB outputs in 0..1
}

/// A layer-style effect. Mirrors the engine's `effects.rs` effect set; the
/// adapter packs each into `(effect_id, params)`.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum Effect {
    DropShadow {
        blend: BlendMode,
        opacity: f32,
        color: Color3,
        angle: f32,
        distance: f32,
        spread: f32,
        size: f32,
    },
    InnerShadow {
        blend: BlendMode,
        opacity: f32,
        color: Color3,
        angle: f32,
        distance: f32,
        choke: f32,
        size: f32,
    },
    OuterGlow {
        blend: BlendMode,
        opacity: f32,
        color: Color3,
        spread: f32,
        size: f32,
    },
    InnerGlow {
        blend: BlendMode,
        opacity: f32,
        color: Color3,
        choke: f32,
        size: f32,
        center: bool,
    },
    Bevel {
        hl_blend: BlendMode,
        hl_opacity: f32,
        hl_color: Color3,
        sh_blend: BlendMode,
        sh_opacity: f32,
        sh_color: Color3,
        angle: f32,
        altitude: f32,
        depth: f32,
        size: f32,
        soften: f32,
        style: u8,
    },
    Satin {
        blend: BlendMode,
        opacity: f32,
        color: Color3,
        angle: f32,
        distance: f32,
        size: f32,
        invert: bool,
    },
    ColorOverlay {
        blend: BlendMode,
        opacity: f32,
        color: Color3,
    },
    GradientOverlay {
        blend: BlendMode,
        opacity: f32,
        angle: f32,
        scale: f32,
        radial: bool,
        reverse: bool,
        start: Color3,
        end: Color3,
    },
    PatternOverlay {
        blend: BlendMode,
        opacity: f32,
        scale: f32,
        kind: u8,
    },
    Stroke {
        blend: BlendMode,
        opacity: f32,
        color: Color3,
        size: f32,
        position: u8,
    },
    /// A layer style the user switched off but kept. Photoshop stores it with
    /// `enab = false`; the neutral parser drops disabled effects on import, so
    /// this variant exists only so an export can round-trip the retained
    /// settings instead of failing the whole document (#509).
    Disabled(Box<Effect>),
}

/// One styled span of a text layer.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct TextRun {
    pub text: String,
    pub font: Option<String>,
    pub size: Option<f32>,
    pub color: Option<[u8; 4]>,
    pub bold: bool,
    pub italic: bool,
    pub faux_bold: bool,
    pub faux_italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub tracking: Option<f32>,
    pub h_scale: Option<f32>,
    pub v_scale: Option<f32>,
    pub baseline: Option<f32>,
    pub caps: Option<u8>, // 0 none, 1 small, 2 all
}

/// A re-editable text layer's content + paragraph defaults + warp. The layer's
/// `rgba` keeps the source's already-rendered pixels for faithful display until
/// the user edits (the engine re-rasterizes host-side on edit).
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct Text {
    pub string: String,
    pub runs: Vec<TextRun>,
    pub point: bool,
    pub vertical: bool,
    pub size: f32,
    pub color: [u8; 4],
    pub font: Option<String>,
    pub align: u8,    // 0 left, 1 right, 2 center, 3 justify
    pub leading: f32, // 0 = auto
    pub tracking: f32,
    pub origin: (i32, i32),
    pub box_size: Option<(f32, f32)>,
    pub warp_style: u8, // index into the engine WarpStyle order; 0 = none
    pub warp_bend: f32,
    pub warp_h: f32,
    pub warp_v: f32,
    pub antialias: u8, // 0 none, 1 sharp, 2 crisp, 3 strong, 4 smooth
}

/// Every R/G/B bit set — a layer that blends into all three channels.
pub const ALL_BLEND_CHANNELS: u8 = 0b111;
fn all_blend_channels() -> u8 {
    ALL_BLEND_CHANNELS
}

fn transparency_shapes_default() -> bool {
    true
}

/// A single layer in the document.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Layer {
    pub id: u32,
    pub parent: Option<u32>,
    pub name: String,
    pub kind: LayerKind,
    pub bounds: Bounds,
    pub opacity: f32,
    pub blend: BlendMode,
    pub visible: bool,
    pub clipping: bool,
    /// Photoshop's Lock All. The three below are its per-attribute locks and
    /// are independent of it (PSD `lspf` bits 0..2; bit 31 is Lock All).
    pub locked: bool,
    #[serde(default)]
    pub lock_transparent: bool,
    #[serde(default)]
    pub lock_image: bool,
    #[serde(default)]
    pub lock_position: bool,
    /// Advanced Blending ▸ Channels (PSD `brst`): the R/G/B bits this layer may
    /// blend into, bits 0/1/2. All three by default.
    #[serde(default = "all_blend_channels")]
    pub blend_channels: u8,
    /// Advanced Blending ▸ Transparency Shapes Layer (PSD `tsly`): the layer
    /// style is clipped to the layer's non-transparent pixels. On by default.
    #[serde(default = "transparency_shapes_default")]
    pub transparency_shapes: bool,
    /// Advanced Blending ▸ Blend Interior Effects as Group (PSD `infx`).
    #[serde(default)]
    pub blend_interior_group: bool,
    /// Advanced Blending ▸ Blend Clipped Layers as Group (PSD `clbl`).
    #[serde(default)]
    pub blend_clipped_group: bool,
    pub fill_opacity: f32,
    pub knockout: u8,
    pub blend_if: Option<[f32; 32]>,
    pub mask: Option<Mask>,
    /// w*h*4 straight-alpha RGBA, layer-local. Empty for group/adjustment.
    /// This is the authority for 1/8-bit documents and a compatibility preview
    /// only when a native high-depth payload is present.
    pub rgba: Vec<u8>,
    /// Native 16-bit straight-alpha RGBA. Mutually exclusive with `rgba32`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rgba16: Vec<u16>,
    /// Native 32-bit float straight-alpha RGBA. RGB may be outside 0..1; alpha
    /// is constrained to 0..1. All samples must be finite and bounded by the
    /// importer before entering the IR.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rgba32: Vec<f32>,
    pub adjustment: Option<Adjustment>,
    pub text: Option<Text>,
    pub effects: Vec<Effect>,
    /// Group layers only: pass-through (non-isolated) vs isolated.
    pub pass_through: bool,
    /// Original blend 4cc (PSD) preserved for diagnostics/round-trip.
    pub raw_blend_key: Option<[u8; 4]>,
    /// Original bounded opaque layer payloads. This includes TySh,
    /// lfx2/lrFX, adjustment blocks, SoLd/SoLE/PlLd descriptors (which
    /// reference document-level `psd_linked_blocks`), and vector-mask/shape
    /// and fill-layer blocks retained for foreign fidelity. The historical
    /// field name remains for unified-format compatibility.
    #[serde(default)]
    pub psd_smart_blocks: Vec<PsdTaggedBlock>,
}

impl Layer {
    /// A raster layer with engine-sane defaults.
    pub fn new(id: u32, name: impl Into<String>, kind: LayerKind, bounds: Bounds) -> Layer {
        Layer {
            id,
            parent: None,
            name: name.into(),
            kind,
            bounds,
            opacity: 1.0,
            blend: BlendMode::Normal,
            visible: true,
            clipping: false,
            locked: false,
            lock_transparent: false,
            lock_image: false,
            lock_position: false,
            blend_channels: ALL_BLEND_CHANNELS,
            transparency_shapes: true,
            blend_interior_group: false,
            blend_clipped_group: false,
            fill_opacity: 1.0,
            knockout: 0,
            blend_if: None,
            mask: None,
            rgba: Vec::new(),
            rgba16: Vec::new(),
            rgba32: Vec::new(),
            adjustment: None,
            text: None,
            effects: Vec::new(),
            pass_through: false,
            raw_blend_key: None,
            psd_smart_blocks: Vec::new(),
        }
    }
}

/// A named Photoshop path (image resources 2000-2997), in document pixels.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct DocumentPath {
    pub name: String,
    /// 6 floats per anchor, `[x, y, inX, inY, outX, outY]`, handles relative to
    /// their anchor — the Paths panel's anchor form.
    pub anchors: Vec<f32>,
    /// Knot count of each closed subpath when the path has several (a glyph
    /// outline's loops); empty = one.
    #[serde(default)]
    pub contours: Vec<u32>,
    /// Flatness in device pixels when resource 2999 names this path as the
    /// document's clipping path.
    #[serde(default)]
    pub clip_flatness: Option<f32>,
}

/// A parsed layered document.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Document {
    pub width: u32,
    pub height: u32,
    /// Source bit depth (8/16/32). High-depth documents keep native samples in
    /// `Layer::rgba16` or `Layer::rgba32`; `rgba` remains the legacy 8-bit path.
    pub depth: u8,
    pub color_mode: ColorMode,
    pub source: SourceFormat,
    /// Bottom-to-top.
    pub layers: Vec<Layer>,
    /// Ordered Photoshop document alpha/spot channels. Empty for formats that
    /// do not expose them or documents without saved channels.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channels: Vec<DocumentChannel>,
    /// Named Photoshop paths, the clipping path marked. Empty for formats and
    /// documents without them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<DocumentPath>,
    /// Path entries the import could not read: open or malformed paths, and a
    /// clipping path naming no path. Hosts report them, since a save drops them.
    #[serde(default)]
    pub skipped_paths: usize,
    /// Pattern records past the preservation limit, left out rather than
    /// refusing the file. Hosts report it, since a save cannot carry them.
    #[serde(default)]
    pub skipped_patterns: bool,
    /// Original lnk2/lnkD/lnk3/lnkE payloads, including embedded source bytes,
    /// and the Patt/Pat2/Pat3 pattern records fills and overlays name by id.
    /// Kept opaque so imports can re-export data the renderer need not decode.
    #[serde(default)]
    pub psd_linked_blocks: Vec<PsdTaggedBlock>,
    /// A Duotone file's ink specification: its colour mode data, laid out like a
    /// Duotone Options (`.ado`) file, kept verbatim. Empty for every other mode.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub duotone: Vec<u8>,
    /// A Duotone file's Alternate Duotone Colors (image resource 1066): the
    /// inks as Lab, kept verbatim for colour-book inks the spec cannot show.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub duotone_alternates: Vec<u8>,
}

impl Document {
    pub fn new(width: u32, height: u32, source: SourceFormat) -> Document {
        Document {
            width,
            height,
            depth: 8,
            color_mode: ColorMode::Rgb,
            source,
            layers: Vec::new(),
            channels: Vec::new(),
            paths: Vec::new(),
            skipped_paths: 0,
            skipped_patterns: false,
            psd_linked_blocks: Vec::new(),
            duotone: Vec::new(),
            duotone_alternates: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Adjustment;

    #[test]
    fn legacy_three_value_adjustments_keep_their_serialized_shape() {
        let hue_json = r#"{"HueSaturation":{"hue":12.0,"saturation":0.5,"lightness":-0.25}}"#;
        assert_eq!(
            serde_json::from_str::<Adjustment>(hue_json).unwrap(),
            Adjustment::HueSaturation {
                hue: 12.0,
                saturation: 0.5,
                lightness: -0.25,
            },
        );
        assert_eq!(
            serde_json::to_string(&Adjustment::HueSaturation {
                hue: 12.0,
                saturation: 0.5,
                lightness: -0.25,
            })
            .unwrap(),
            hue_json,
        );

        let black_white_json = r#"{"BlackWhite":{"r":0.3,"g":0.59,"b":0.11}}"#;
        assert_eq!(
            serde_json::from_str::<Adjustment>(black_white_json).unwrap(),
            Adjustment::BlackWhite {
                r: 0.3,
                g: 0.59,
                b: 0.11,
            },
        );
        assert_eq!(
            serde_json::to_string(&Adjustment::BlackWhite {
                r: 0.3,
                g: 0.59,
                b: 0.11,
            })
            .unwrap(),
            black_white_json,
        );
    }
}
