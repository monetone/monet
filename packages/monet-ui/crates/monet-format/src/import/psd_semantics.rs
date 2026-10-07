//! Regeneration of PSD semantic additional-info blocks from the neutral IR.
//!
//! This is deliberately not a PSD container writer. It gives a writer the
//! authoritative tagged blocks for editable semantics while retaining opaque
//! blocks it does not own. Imported semantic bytes remain authoritative until
//! their neutral projection changes, and are replaced only after a lossless
//! parse-to-encode proof.

use super::descriptor::{
    color_from, parse_adjustment_block, parse_effects, parse_text, read_version_and_descriptor,
    Descriptor, Value,
};
use super::reader::Reader;
use super::document::{
    Adjustment, BlendMode, Bounds, Color3, Effect, Layer, LayerKind, PsdTaggedBlock, Text,
    TextRun,
};
use super::error::{FormatError, Result};
use super::psd::PSD_ADJUSTMENT_KEYS;

const SMART_KEYS: [[u8; 4]; 3] = [*b"SoLd", *b"SoLE", *b"PlLd"];
const LINK_KEYS: [[u8; 4]; 4] = [*b"lnk2", *b"lnkD", *b"lnk3", *b"lnkE"];
const MAX_ENGINE_DATA_BYTES: usize = 1024 * 1024;
const MAX_TEXT_RUNS: usize = 4096;
const MAX_TEXT_UTF16_UNITS: usize = 262_144;
const MAX_TEXT_FONTS: usize = 1024;
const MAX_FONT_UTF16_UNITS: usize = 1024;
const HUE_RANGE_BOUNDS: [[i16; 4]; 6] = [
    [315, 345, 15, 45],
    [15, 45, 75, 105],
    [75, 105, 135, 165],
    [135, 165, 195, 225],
    [195, 225, 255, 285],
    [255, 285, 315, 345],
];

/// Fill-layer keys are intentionally opaque for now: the neutral import IR has
/// no solid/gradient/pattern fill payload from which they could be regenerated.
/// They therefore survive reconciliation unchanged rather than being replaced
/// with invented or stale-looking metadata.
pub const OPAQUE_FILL_KEYS: [[u8; 4]; 3] = [*b"SoCo", *b"GdFl", *b"PtFl"];

/// Reconcile retained PSD semantic blocks with the neutral layer.
///
/// Unknown and currently-opaque fill blocks retain their original order and
/// bytes. An owned text (`TySh`), adjustment, or layer-style (`lfx2`/legacy
/// `lrFX`) block also retains its original order and bytes while its parsed
/// neutral projection is unchanged. If that projection was edited, the source
/// may be replaced only when every duplicate is a canonical, complete
/// parse-to-encode round trip. Unsupported IR detail is an explicit error,
/// never a lossy fallback.
pub fn reconcile_psd_layer_blocks(
    layer: &Layer,
    preserved: &[PsdTaggedBlock],
) -> Result<Vec<PsdTaggedBlock>> {
    if layer.text.is_some() && layer.kind != LayerKind::Text {
        return Err(FormatError::Malformed(
            "text payload belongs to a non-text layer".into(),
        ));
    }
    if layer.adjustment.is_some() && layer.kind != LayerKind::Adjustment {
        return Err(FormatError::Malformed(
            "adjustment payload belongs to a non-adjustment layer".into(),
        ));
    }

    let has_text = preserved.iter().any(|block| is_text_key(block.key));
    let has_adjustment = preserved
        .iter()
        .any(|block| is_adjustment_key(block.key));
    let has_effects = preserved.iter().any(|block| is_effect_key(block.key));
    let adjustment_context_key = preserved
        .iter()
        .find(|block| is_adjustment_key(block.key))
        .map(|block| block.key)
        .unwrap_or(*b"Adj ");

    // Match the importer's authority rules exactly: TySh determines a text
    // layer before adjustment keys are considered, adjustments use their
    // fixed key-preference order, and only lfx2 has a neutral effects parser.
    let source_text = preserved
        .iter()
        .find(|block| is_text_key(block.key))
        .and_then(|block| parse_text(&block.data));
    let source_adjustment = projected_adjustment(preserved);
    let source_effects = preserved
        .iter()
        .find(|block| &block.key == b"lfx2")
        .map(|block| parse_effects(&block.data))
        .unwrap_or_default();

    let text_unchanged = if has_text {
        layer.kind == LayerKind::Text && layer.text.as_ref() == source_text.as_ref()
    } else {
        layer.text.is_none()
    };
    let adjustment_unchanged = if has_adjustment {
        if has_text {
            // TySh won kind detection on import, so co-located adjustment
            // blocks were opaque rather than projected into this layer.
            layer.kind == LayerKind::Text && layer.adjustment.is_none()
        } else {
            layer.kind == LayerKind::Adjustment
                && layer.adjustment.as_ref() == source_adjustment.as_ref()
        }
    } else {
        layer.adjustment.is_none()
    };
    let effects_unchanged = if has_effects {
        layer.effects == source_effects
    } else {
        layer.effects.is_empty()
    };

    if has_text && !text_unchanged {
        ensure_canonical_text_sources(layer, preserved)?;
    }
    if has_adjustment && !adjustment_unchanged {
        ensure_canonical_adjustment_sources(layer, preserved)?;
    }
    if has_effects && !effects_unchanged {
        ensure_canonical_effect_sources(layer, preserved)?;
    }

    let mut blocks: Vec<PsdTaggedBlock> = preserved
        .iter()
        .filter(|block| {
            if is_text_key(block.key) {
                text_unchanged
            } else if is_adjustment_key(block.key) {
                adjustment_unchanged
            } else if is_effect_key(block.key) {
                effects_unchanged
            } else {
                !SMART_KEYS.contains(&block.key)
            }
        })
        .cloned()
        .collect();

    if !text_unchanged {
        if let Some(text) = &layer.text {
            let data = encode_text(text, layer.bounds)
                .map_err(|error| semantic_encode_error(layer, *b"TySh", error))?;
            blocks.push(PsdTaggedBlock {
                key: *b"TySh",
                data,
            });
        }
    }
    if !adjustment_unchanged {
        if let Some(adjustment) = &layer.adjustment {
            blocks.push(
                encode_adjustment(adjustment)
                    .map_err(|error| {
                        semantic_encode_error(layer, adjustment_context_key, error)
                    })?,
            );
        }
    }
    if !effects_unchanged && !layer.effects.is_empty() {
        let data = encode_effects(&layer.effects)
            .map_err(|error| semantic_encode_error(layer, *b"lfx2", error))?;
        blocks.push(PsdTaggedBlock {
            key: *b"lfx2",
            data,
        });
    }
    if layer.kind == LayerKind::SmartObject {
        append_last_by_key(&mut blocks, &layer.psd_smart_blocks, &SMART_KEYS);
    }

    Ok(blocks)
}

/// Reconcile document-level linked/embedded Smart Object payload blocks.
///
/// `authoritative` is normally `Document::psd_linked_blocks`. Unknown global
/// blocks are preserved, while each known `lnk*` key is replaced by the last
/// authoritative instance so stale duplicates cannot leak into an export.
pub fn reconcile_psd_linked_blocks(
    authoritative: &[PsdTaggedBlock],
    preserved: &[PsdTaggedBlock],
) -> Vec<PsdTaggedBlock> {
    let mut blocks: Vec<PsdTaggedBlock> = preserved
        .iter()
        .filter(|block| !LINK_KEYS.contains(&block.key))
        .cloned()
        .collect();
    append_last_by_key(&mut blocks, authoritative, &LINK_KEYS);
    blocks
}

// ── Embedded Smart Object sources ──────────────────────────────
// A placed layer's `SoLd`/`SoLE` descriptor (or legacy `PlLd` record) names
// its source by a unique ID and says where the source's pixel rect lands on
// the canvas. An embedded source is a `liFD` record carrying that ID in the
// document's lnk2/lnkD/lnk3 blocks; lnkE records point at files outside it.

const EMBEDDED_LINK_KEYS: [[u8; 4]; 3] = [*b"lnk2", *b"lnkD", *b"lnk3"];
/// Bound for the file-open descriptor ahead of an embedded file's bytes, so
/// the descriptor walker never sees a multi-megabyte payload as its input.
const MAX_OPEN_FILE_DESCRIPTOR_BYTES: usize = 1024 * 1024;

/// Where a Smart Object's source sits: the unique ID of its file record and
/// the canvas corners (top-left, top-right, bottom-right, bottom-left) that
/// the source's pixel rect lands on.
#[derive(Clone, Debug, PartialEq)]
pub struct PsdPlacedLayer {
    pub id: String,
    pub corners: [f64; 8],
}

/// The placement a layer's retained blocks state, from `SoLd`, else `SoLE`,
/// else `PlLd` (the last block of a key wins, as it does on export). `None`
/// when the layer has none or none can be read.
pub fn psd_placed_layer(blocks: &[PsdTaggedBlock]) -> Option<PsdPlacedLayer> {
    SMART_KEYS.iter().find_map(|key| {
        let block = blocks.iter().rev().find(|block| block.key == *key)?;
        if key == b"PlLd" {
            legacy_placed_layer(&block.data)
        } else {
            placed_layer_descriptor(&block.data)
        }
    })
}

fn placed_layer_descriptor(data: &[u8]) -> Option<PsdPlacedLayer> {
    let mut reader = Reader::new(data);
    if &reader.fourcc().ok()? != b"soLD" {
        return None;
    }
    reader.u32().ok()?; // version 4 or 5
    let descriptor = read_version_and_descriptor(&mut reader).ok()?;
    let Some(Value::Text(id)) = descriptor.get("Idnt") else {
        return None;
    };
    // Trnf is the affine placement; a perspective distort states its real
    // quad in nonAffineTransform.
    let corners = ["nonAffineTransform", "Trnf"]
        .iter()
        .find_map(|key| corner_list(descriptor.get(key)?))?;
    Some(PsdPlacedLayer {
        id: id.clone(),
        corners,
    })
}

fn corner_list(value: &Value) -> Option<[f64; 8]> {
    let Value::List(values) = value else {
        return None;
    };
    if values.len() != 8 {
        return None;
    }
    let mut corners = [0.0; 8];
    for (corner, value) in corners.iter_mut().zip(values) {
        *corner = match value {
            Value::Double(v) | Value::Unit { value: v, .. } => *v,
            _ => return None,
        };
    }
    corners.iter().all(|v| v.is_finite()).then_some(corners)
}

fn legacy_placed_layer(data: &[u8]) -> Option<PsdPlacedLayer> {
    let mut reader = Reader::new(data);
    if &reader.fourcc().ok()? != b"plcL" || reader.u32().ok()? != 3 {
        return None;
    }
    let id = reader.pascal_string(1).ok()?;
    reader.skip(16).ok()?; // page, page count, anti-alias policy, layer type
    let mut corners = [0.0; 8];
    for corner in &mut corners {
        *corner = reader.f64().ok()?;
    }
    corners
        .iter()
        .all(|v| v.is_finite())
        .then_some(PsdPlacedLayer { id, corners })
}

/// One record of a linked-file block: `at..next` spans its u64 length, the
/// record and its padding; `end` is where the record itself stops.
struct LinkedFileRecord {
    at: usize,
    end: usize,
    next: usize,
    embedded: Option<EmbeddedFile>,
}

/// The parts of a `liFD` record a replacement splices around, as offsets
/// into the block.
struct EmbeddedFile {
    id: String,
    length_at: usize,
    data: std::ops::Range<usize>,
}

/// Every record of a linked-file block, up to one whose length overruns it.
fn linked_file_records(block: &[u8]) -> Vec<LinkedFileRecord> {
    let mut records = Vec::new();
    let mut at = 0usize;
    while block.len().saturating_sub(at) > 8 {
        let size = u64::from_be_bytes(block[at..at + 8].try_into().expect("8 bytes"));
        let Some(end) = usize::try_from(size)
            .ok()
            .and_then(|size| (at + 8).checked_add(size))
            .filter(|&end| end <= block.len())
        else {
            break;
        };
        let next = (at + 8 + (end - at - 8).next_multiple_of(4)).min(block.len());
        records.push(LinkedFileRecord {
            at,
            end,
            next,
            embedded: embedded_file(block, at + 8, end),
        });
        at = next;
    }
    records
}

fn embedded_file(block: &[u8], start: usize, end: usize) -> Option<EmbeddedFile> {
    let mut reader = Reader::new(&block[start..end]);
    if &reader.fourcc().ok()? != b"liFD" {
        return None;
    }
    reader.u32().ok()?; // version
    let id = reader.pascal_string(1).ok()?;
    reader.unicode_string(1).ok()?; // original file name
    reader.skip(8).ok()?; // file type, creator
    let length_at = start + reader.position();
    let length = usize::try_from(reader.u64().ok()?).ok()?;
    if reader.u8().ok()? != 0 {
        let rest = reader.rest();
        let mut descriptor = Reader::new(&rest[..rest.len().min(MAX_OPEN_FILE_DESCRIPTOR_BYTES)]);
        read_version_and_descriptor(&mut descriptor).ok()?;
        reader.skip(descriptor.position()).ok()?;
    }
    let data_at = start + reader.position();
    let data_end = data_at.checked_add(length).filter(|&data_end| data_end <= end)?;
    Some(EmbeddedFile {
        id,
        length_at,
        data: data_at..data_end,
    })
}

/// The bytes of the file an embedded Smart Object source `id` names.
pub fn psd_embedded_file<'a>(linked: &'a [PsdTaggedBlock], id: &str) -> Option<&'a [u8]> {
    linked
        .iter()
        .rev()
        .filter(|block| EMBEDDED_LINK_KEYS.contains(&block.key))
        .find_map(|block| {
            linked_file_records(&block.data)
                .into_iter()
                .filter_map(|record| record.embedded)
                .find(|file| file.id == id)
                .map(|file| &block.data[file.data])
        })
}

/// `linked` with the embedded file `id` names holding `data` instead. Its
/// record keeps its name, type and trailing fields. With no such record, a
/// new `liFD` record named `name`, of Photoshop file type `file_type`, joins
/// the last lnk2 block (the one an export keeps), or a new one.
pub fn psd_linked_blocks_with_file(
    linked: &[PsdTaggedBlock],
    id: &str,
    name: &str,
    file_type: [u8; 4],
    data: &[u8],
) -> Vec<PsdTaggedBlock> {
    let mut replaced = false;
    let mut blocks: Vec<PsdTaggedBlock> = linked
        .iter()
        .map(|block| {
            if !EMBEDDED_LINK_KEYS.contains(&block.key) {
                return block.clone();
            }
            let bytes = &block.data;
            let mut out = Vec::new();
            let mut copied = 0;
            for record in linked_file_records(bytes) {
                let Some(file) = record.embedded.filter(|file| file.id == id) else {
                    continue;
                };
                out.extend_from_slice(&bytes[copied..record.at]);
                let mut spliced = bytes[record.at + 8..file.length_at].to_vec();
                spliced.extend_from_slice(&(data.len() as u64).to_be_bytes());
                spliced.extend_from_slice(&bytes[file.length_at + 8..file.data.start]);
                spliced.extend_from_slice(data);
                spliced.extend_from_slice(&bytes[file.data.end..record.end]);
                push_linked_record(&mut out, &spliced);
                copied = record.next;
                replaced = true;
            }
            out.extend_from_slice(&bytes[copied..]);
            PsdTaggedBlock {
                key: block.key,
                data: out,
            }
        })
        .collect();
    if !replaced {
        let mut record = b"liFD".to_vec();
        push_u32(&mut record, 2);
        let id = &id.as_bytes()[..id.len().min(255)];
        record.push(id.len() as u8);
        record.extend_from_slice(id);
        write_unicode(&mut record, name, true);
        record.extend_from_slice(&file_type);
        record.extend_from_slice(b"8BIM");
        record.extend_from_slice(&(data.len() as u64).to_be_bytes());
        record.push(0); // no file-open descriptor
        record.extend_from_slice(data);
        match blocks.iter_mut().rev().find(|block| &block.key == b"lnk2") {
            Some(block) => push_linked_record(&mut block.data, &record),
            None => {
                let mut block = Vec::new();
                push_linked_record(&mut block, &record);
                blocks.push(PsdTaggedBlock {
                    key: *b"lnk2",
                    data: block,
                });
            }
        }
    }
    blocks
}

fn push_linked_record(output: &mut Vec<u8>, record: &[u8]) {
    output.extend_from_slice(&(record.len() as u64).to_be_bytes());
    output.extend_from_slice(record);
    output.resize(output.len() + (4 - record.len() % 4) % 4, 0);
}

/// The `PlLd` and `SoLd` blocks, as Photoshop writes the pair, for an
/// embedded raster source of `width`×`height` pixels that file record `id`
/// holds, placed at `corners` (see `PsdPlacedLayer`).
pub fn encode_psd_placed_layer(
    id: &str,
    width: u32,
    height: u32,
    corners: [f64; 8],
) -> [PsdTaggedBlock; 2] {
    let long = |value: i32| Value::Integer(value);
    let pixels = |value: f64| Value::Unit {
        unit: *b"#Pxl",
        value,
    };
    let fraction = |denominator: i32| {
        Value::Descriptor(Descriptor {
            class_id: "null".into(),
            items: vec![
                ("numerator".into(), long(0)),
                ("denominator".into(), long(denominator)),
            ],
        })
    };
    let quad = || Value::List(corners.iter().map(|&v| Value::Double(v)).collect());
    let (width_f, height_f) = (f64::from(width), f64::from(height));
    let warp = Descriptor {
        class_id: "warp".into(),
        items: vec![
            (
                "warpStyle".into(),
                Value::Enum {
                    type_id: "warpStyle".into(),
                    value: "warpNone".into(),
                },
            ),
            ("warpValue".into(), Value::Double(0.0)),
            ("warpPerspective".into(), Value::Double(0.0)),
            ("warpPerspectiveOther".into(), Value::Double(0.0)),
            (
                "warpRotate".into(),
                Value::Enum {
                    type_id: "Ornt".into(),
                    value: "Hrzn".into(),
                },
            ),
            (
                "bounds".into(),
                Value::Descriptor(Descriptor {
                    class_id: "Rctn".into(),
                    items: vec![
                        ("Top ".into(), pixels(0.0)),
                        ("Left".into(), pixels(0.0)),
                        ("Btom".into(), pixels(height_f)),
                        ("Rght".into(), pixels(width_f)),
                    ],
                }),
            ),
            ("uOrder".into(), long(4)),
            ("vOrder".into(), long(4)),
        ],
    };
    // The legacy record carries the link and placement without the size.
    let id_bytes = &id.as_bytes()[..id.len().min(255)];
    let mut legacy = b"plcL".to_vec();
    push_u32(&mut legacy, 3);
    legacy.push(id_bytes.len() as u8);
    legacy.extend_from_slice(id_bytes);
    for value in [1, 1, 16, 2] {
        push_u32(&mut legacy, value); // page, page count, anti-alias, raster
    }
    for corner in corners {
        push_f64(&mut legacy, corner);
    }
    push_u32(&mut legacy, 0); // warp version
    write_version_and_descriptor(&mut legacy, &warp);
    legacy.resize(legacy.len().next_multiple_of(4), 0);
    let descriptor = Descriptor {
        class_id: "null".into(),
        items: vec![
            ("Idnt".into(), Value::Text(id.into())),
            ("placed".into(), Value::Text(id.into())),
            ("PgNm".into(), long(1)),
            ("totalPages".into(), long(1)),
            ("frameStep".into(), fraction(600)),
            ("duration".into(), fraction(600)),
            ("frameCount".into(), long(0)),
            ("Annt".into(), long(16)),
            ("Type".into(), long(2)), // raster
            ("Trnf".into(), quad()),
            ("nonAffineTransform".into(), quad()),
            ("warp".into(), Value::Descriptor(warp)),
            (
                "Sz  ".into(),
                Value::Descriptor(Descriptor {
                    class_id: "Pnt ".into(),
                    items: vec![
                        ("Wdth".into(), Value::Double(width_f)),
                        ("Hght".into(), Value::Double(height_f)),
                    ],
                }),
            ),
            (
                "Rslt".into(),
                Value::Unit {
                    unit: *b"#Rsl",
                    value: 72.0,
                },
            ),
        ],
    };
    let mut data = b"soLD".to_vec();
    push_u32(&mut data, 4);
    write_version_and_descriptor(&mut data, &descriptor);
    data.resize(data.len().next_multiple_of(4), 0);
    [
        PsdTaggedBlock {
            key: *b"PlLd",
            data: legacy,
        },
        PsdTaggedBlock {
            key: *b"SoLd",
            data,
        },
    ]
}

/// `GdFl` payload for a linear gradient fill layer. Each stop is
/// `[location, r, g, b, a]` in 0..1; colour and alpha clamp the way a fill
/// renderer clamps them, and alpha travels as its own transparency stop list.
/// Stops Photoshop cannot state the same way — fewer than two, non-finite, or
/// locations that fall back or leave 0..1 — are refused.
pub fn encode_gradient_fill(stops: &[[f32; 5]], angle: f32) -> Result<Vec<u8>> {
    if stops.len() < 2 {
        return unsupported("gradient fill needs at least two stops");
    }
    let angle = angle_item("Angl", angle, "gradient fill angle")?;
    let mut colors = Vec::with_capacity(stops.len());
    let mut opacities = Vec::with_capacity(stops.len());
    let mut previous = 0.0;
    for &[location, r, g, b, a] in stops {
        if [location, r, g, b, a].iter().any(|value| !value.is_finite()) {
            return unsupported("gradient fill stop must be finite");
        }
        if !(previous..=1.0).contains(&location) {
            return unsupported("gradient fill stop locations must rise within 0..1");
        }
        previous = location;
        let location = ("Lctn".to_string(), Value::Integer((location * 4096.0).round() as i32));
        let midpoint = ("Mdpn".to_string(), Value::Integer(50));
        colors.push(Value::Descriptor(Descriptor {
            class_id: "Clrt".into(),
            items: vec![
                (
                    "Clr ".into(),
                    Value::Descriptor(color_descriptor(Color3::new(
                        r.clamp(0.0, 1.0),
                        g.clamp(0.0, 1.0),
                        b.clamp(0.0, 1.0),
                    ))),
                ),
                (
                    "Type".into(),
                    Value::Enum {
                        type_id: "Clry".into(),
                        value: "UsrS".into(),
                    },
                ),
                location.clone(),
                midpoint.clone(),
            ],
        }));
        opacities.push(Value::Descriptor(Descriptor {
            class_id: "TrnS".into(),
            items: vec![
                percent_item("Opct", a.clamp(0.0, 1.0), "gradient fill stop opacity")?,
                location,
                midpoint,
            ],
        }));
    }
    Ok(layer_block_descriptor(&Descriptor {
        class_id: "null".into(),
        items: vec![
            angle,
            (
                "Type".into(),
                Value::Enum {
                    type_id: "GrdT".into(),
                    value: "Lnr ".into(),
                },
            ),
            ("Rvrs".into(), Value::Bool(false)),
            ("Dthr".into(), Value::Bool(false)),
            ("Algn".into(), Value::Bool(true)),
            (
                "Scl ".into(),
                Value::Unit {
                    unit: *b"#Prc",
                    value: 100.0,
                },
            ),
            (
                "Grad".into(),
                Value::Descriptor(Descriptor {
                    class_id: "Grdn".into(),
                    items: vec![
                        ("Nm  ".into(), Value::Text("Custom".into())),
                        (
                            "GrdF".into(),
                            Value::Enum {
                                type_id: "GrdF".into(),
                                value: "CstS".into(),
                            },
                        ),
                        ("Intr".into(), Value::Double(4096.0)),
                        ("Clrs".into(), Value::List(colors)),
                        ("Trns".into(), Value::List(opacities)),
                    ],
                }),
            ),
        ],
    }))
}

/// `PtFl` payload for a pattern fill layer that tiles the document pattern
/// record `id` at `scale` percent, clamped to Photoshop's 1..1000 range.
pub fn encode_pattern_fill(name: &str, id: &str, scale: f32) -> Result<Vec<u8>> {
    if id.is_empty() {
        return unsupported("pattern fill needs a pattern id");
    }
    let scale = finite(scale, "pattern fill scale")?.clamp(1.0, 1000.0);
    Ok(layer_block_descriptor(&Descriptor {
        class_id: "null".into(),
        items: vec![
            (
                "Ptrn".into(),
                Value::Descriptor(Descriptor {
                    class_id: "Ptrn".into(),
                    items: vec![
                        ("Nm  ".into(), Value::Text(name.into())),
                        ("Idnt".into(), Value::Text(id.into())),
                    ],
                }),
            ),
            (
                "Scl ".into(),
                Value::Unit {
                    unit: *b"#Prc",
                    value: f64::from(scale),
                },
            ),
            ("Algn".into(), Value::Bool(true)),
        ],
    }))
}

/// One subpath of a Photoshop shape outline. Each knot is the preceding
/// control, the anchor and the leaving control as x/y pairs in document pixels.
#[derive(Clone, Debug, PartialEq)]
pub struct PsdShapeSubpath {
    pub closed: bool,
    pub knots: Vec<[f32; 6]>,
}

/// A shape layer stated entirely by an outline and one solid RGB fill.
#[derive(Clone, Debug, PartialEq)]
pub struct PsdSolidShape {
    pub subpaths: Vec<PsdShapeSubpath>,
    pub color: Color3,
}

/// Mirrors the engine's cap on the path records it writes back.
const MAX_SHAPE_PATH_RECORDS: usize = 8192;

/// Read a layer's retained Photoshop blocks as a solid, unstroked shape: one
/// `vmsk`/`vsms` outline plus one `SoCo` fill, or a `vscg` holding one.
///
/// `Ok(None)` is valid data that is not such a shape (no outline or fill,
/// gradient or pattern content, an enabled stroke, a non-RGB colour, an
/// inverted or disabled mask, anything but a union of subpaths); the layer
/// stays a raster proxy. `Err` is an outline or fill that cannot be read.
pub fn decode_psd_solid_shape(
    blocks: &[PsdTaggedBlock],
    width: u32,
    height: u32,
) -> Result<Option<PsdSolidShape>> {
    let with_keys = |keys: &[&[u8; 4]]| -> Vec<&PsdTaggedBlock> {
        blocks.iter().filter(|block| keys.contains(&&block.key)).collect()
    };
    let outlines = with_keys(&[b"vmsk", b"vsms"]);
    let fills = with_keys(&[b"SoCo", b"vscg"]);
    let strokes = with_keys(&[b"vstk"]);
    // Decided before anything is parsed, so a layer that is plainly not one
    // solid shape never reports its other blocks as unreadable.
    if outlines.len() != 1
        || fills.len() != 1
        || strokes.len() > 1
        || !with_keys(&[b"GdFl", b"PtFl"]).is_empty()
    {
        return Ok(None);
    }

    if let Some(stroke) = strokes.first() {
        let stroke = read_version_and_descriptor(&mut Reader::new(&stroke.data))?;
        if matches!(stroke.get("strokeEnabled"), Some(Value::Bool(true)))
            || matches!(stroke.get("fillEnabled"), Some(Value::Bool(false)))
        {
            return Ok(None);
        }
    }

    let fill = fills[0];
    let mut reader = Reader::new(&fill.data);
    if &fill.key == b"vscg" && &reader.fourcc()? != b"SoCo" {
        return Ok(None);
    }
    let fill = read_version_and_descriptor(&mut reader)?;
    let Some(Value::Descriptor(rgb)) = fill.get("Clr ") else {
        return Err(FormatError::Malformed("solid fill has no colour".into()));
    };
    if rgb.class_id != "RGBC" || ["Rd  ", "Grn ", "Bl  "].iter().any(|key| rgb.get(key).is_none()) {
        return Ok(None);
    }
    let color = color_from(fill.get("Clr "));

    let outline = &outlines[0].data;
    let mut reader = Reader::new(outline);
    if reader.u32()? != 3 {
        return Err(FormatError::Malformed("vector mask version is not 3".into()));
    }
    if reader.u32()? & (1 | 4) != 0 {
        return Ok(None); // inverted or disabled
    }
    // Photoshop counts a layer block's alignment padding in its length.
    let records = &outline[8..];
    let padding = &records[records.len() / 26 * 26..];
    if padding.len() >= 4 || padding.iter().any(|byte| *byte != 0) {
        return Err(FormatError::Malformed(
            "vector mask is not a whole number of path records".into(),
        ));
    }
    if records.len() / 26 > MAX_SHAPE_PATH_RECORDS {
        return Ok(None); // readable, but past the size Vision's export writes back
    }

    let fixed = |value: i32, extent: u32| (f64::from(value) / 16_777_216.0 * f64::from(extent)) as f32;
    let mut subpaths: Vec<PsdShapeSubpath> = Vec::new();
    let mut owed = 0usize;
    for record in records.chunks_exact(26) {
        let mut reader = Reader::new(record);
        match reader.u16()? {
            selector @ (0 | 3) => {
                if owed != 0 {
                    return Err(FormatError::Malformed(
                        "vector mask subpath has fewer knots than its length record".into(),
                    ));
                }
                owed = usize::from(reader.u16()?);
                // Vision fills separate items as a union; only "combine" (or the
                // unset -1) after the first subpath means the same thing.
                if !subpaths.is_empty() && !matches!(reader.i16()?, -1 | 1) {
                    return Ok(None);
                }
                subpaths.push(PsdShapeSubpath {
                    closed: selector == 0,
                    knots: Vec::with_capacity(owed),
                });
            }
            1 | 2 | 4 | 5 => {
                let Some(subpath) = subpaths.last_mut().filter(|_| owed > 0) else {
                    return Err(FormatError::Malformed(
                        "vector mask knot lies outside its subpath".into(),
                    ));
                };
                let mut knot = [0.0; 6];
                for point in knot.chunks_exact_mut(2) {
                    point[1] = fixed(reader.i32()?, height);
                    point[0] = fixed(reader.i32()?, width);
                }
                subpath.knots.push(knot);
                owed -= 1;
            }
            6 | 7 => {} // fill rule, clipboard
            8 => {
                if reader.u16()? == 1 {
                    return Ok(None); // the fill starts from all pixels
                }
            }
            other => {
                return Err(FormatError::Malformed(format!(
                    "vector mask has unknown path record {other}"
                )));
            }
        }
    }
    if owed != 0 {
        return Err(FormatError::Malformed(
            "vector mask subpath has fewer knots than its length record".into(),
        ));
    }
    subpaths.retain(|subpath| !subpath.knots.is_empty());
    Ok((!subpaths.is_empty()).then_some(PsdSolidShape { subpaths, color }))
}

fn is_text_key(key: [u8; 4]) -> bool {
    &key == b"TySh"
}

fn is_effect_key(key: [u8; 4]) -> bool {
    matches!(&key, b"lfx2" | b"lrFX")
}

fn is_adjustment_key(key: [u8; 4]) -> bool {
    PSD_ADJUSTMENT_KEYS.contains(&&key)
}

fn projected_adjustment(blocks: &[PsdTaggedBlock]) -> Option<Adjustment> {
    for &&key in PSD_ADJUSTMENT_KEYS {
        if let Some(block) = blocks.iter().find(|block| block.key == key) {
            if let Some(adjustment) = parse_adjustment_block(key, &block.data) {
                return Some(adjustment);
            }
        }
    }
    None
}

fn ensure_canonical_text_sources(layer: &Layer, blocks: &[PsdTaggedBlock]) -> Result<()> {
    let mut projection: Option<Text> = None;
    for block in blocks.iter().filter(|block| is_text_key(block.key)) {
        let parsed = parse_text(&block.data)
            .ok_or_else(|| unsafe_semantic_edit(layer, block.key, "block does not fully parse"))?;
        let encoded = encode_text(&parsed, layer.bounds).map_err(|_| {
            unsafe_semantic_edit(layer, block.key, "parsed payload is not fully representable")
        })?;
        if !same_payload(&encoded, &block.data) {
            return Err(unsafe_semantic_edit(
                layer,
                block.key,
                "parse-to-encode bytes differ",
            ));
        }
        if projection.as_ref().is_some_and(|known| known != &parsed) {
            return Err(unsafe_semantic_edit(
                layer,
                block.key,
                "duplicate blocks project to different text",
            ));
        }
        projection = Some(parsed);
    }
    Ok(())
}

fn ensure_canonical_adjustment_sources(
    layer: &Layer,
    blocks: &[PsdTaggedBlock],
) -> Result<()> {
    let mut projection: Option<Adjustment> = None;
    for block in blocks
        .iter()
        .filter(|block| is_adjustment_key(block.key))
    {
        let parsed = parse_adjustment_block(block.key, &block.data)
            .ok_or_else(|| unsafe_semantic_edit(layer, block.key, "block does not fully parse"))?;
        let encoded = encode_adjustment(&parsed).map_err(|_| {
            unsafe_semantic_edit(layer, block.key, "parsed payload is not fully representable")
        })?;
        if encoded.key != block.key || !same_payload(&encoded.data, &block.data) {
            return Err(unsafe_semantic_edit(
                layer,
                block.key,
                "parse-to-encode bytes differ",
            ));
        }
        if projection.as_ref().is_some_and(|known| known != &parsed) {
            return Err(unsafe_semantic_edit(
                layer,
                block.key,
                "duplicate blocks project to different adjustments",
            ));
        }
        projection = Some(parsed);
    }
    Ok(())
}

fn ensure_canonical_effect_sources(layer: &Layer, blocks: &[PsdTaggedBlock]) -> Result<()> {
    let mut projection: Option<Vec<Effect>> = None;
    for block in blocks.iter().filter(|block| is_effect_key(block.key)) {
        if &block.key == b"lrFX" {
            return Err(unsafe_semantic_edit(
                layer,
                block.key,
                "legacy effects have no complete neutral parser",
            ));
        }
        let parsed = parse_effects(&block.data);
        let encoded = encode_effects(&parsed).map_err(|_| {
            unsafe_semantic_edit(layer, block.key, "parsed payload is not fully representable")
        })?;
        if !same_payload(&encoded, &block.data) {
            return Err(unsafe_semantic_edit(
                layer,
                block.key,
                "parse-to-encode bytes differ",
            ));
        }
        if projection.as_ref().is_some_and(|known| known != &parsed) {
            return Err(unsafe_semantic_edit(
                layer,
                block.key,
                "duplicate blocks project to different effects",
            ));
        }
        projection = Some(parsed);
    }
    Ok(())
}

/// A retained block is its encoded payload plus the alignment zeros its
/// length counts, as Photoshop pads every layer block to 4 bytes.
fn same_payload(encoded: &[u8], retained: &[u8]) -> bool {
    retained.len() - encoded.len().min(retained.len()) < 4
        && retained.starts_with(encoded)
        && retained[encoded.len()..].iter().all(|&byte| byte == 0)
}

fn unsafe_semantic_edit(layer: &Layer, key: [u8; 4], reason: &str) -> FormatError {
    FormatError::Unsupported(format!(
        "Photoshop layer {} {:?} key {:?} cannot be safely regenerated after a semantic edit: {reason}",
        layer.id,
        layer.name,
        String::from_utf8_lossy(&key),
    ))
}

fn semantic_encode_error(layer: &Layer, key: [u8; 4], error: FormatError) -> FormatError {
    FormatError::Unsupported(format!(
        "Photoshop layer {} {:?} key {:?} cannot be regenerated: {error}",
        layer.id,
        layer.name,
        String::from_utf8_lossy(&key),
    ))
}

fn append_last_by_key(
    output: &mut Vec<PsdTaggedBlock>,
    authoritative: &[PsdTaggedBlock],
    keys: &[[u8; 4]],
) {
    for key in keys {
        if let Some(block) = authoritative.iter().rev().find(|block| block.key == *key) {
            output.push(block.clone());
        }
    }
}

fn encode_text(text: &Text, bounds: Bounds) -> Result<Vec<u8>> {
    if !text.size.is_finite() || text.size <= 0.0 {
        return unsupported("text size must be finite and positive");
    }
    if text.size > 1_000_000.0 {
        return unsupported("text size is outside the Photoshop EngineData range");
    }
    if text.align > 3 {
        return unsupported("unknown paragraph alignment");
    }
    for (name, value) in [("text leading", text.leading), ("text tracking", text.tracking)] {
        if !value.is_finite() || value.abs() > 1_000_000.0 {
            return unsupported(&format!("{name} is outside the Photoshop EngineData range"));
        }
    }
    match (text.point, text.box_size) {
        (true, None) => {}
        (false, Some((width, height)))
            if width.is_finite()
                && height.is_finite()
                && width > 0.0
                && height > 0.0
                && width <= 1_000_000.0
                && height <= 1_000_000.0 => {}
        (false, None) => return unsupported("paragraph text requires a finite text box"),
        (true, Some(_)) => return unsupported("point text cannot also carry a paragraph text box"),
        (false, Some(_)) => {
            return unsupported("paragraph text box is outside the Photoshop EngineData range")
        }
    }
    if text.runs.len() > MAX_TEXT_RUNS {
        return unsupported("text has too many Photoshop EngineData style runs");
    }
    if text.string.encode_utf16().count() > MAX_TEXT_UTF16_UNITS {
        return unsupported("text is too large for bounded Photoshop EngineData export");
    }
    if text.string.contains('\r') {
        return unsupported("text must use normalized newline characters before PSD export");
    }
    if !text.runs.is_empty() {
        let mut byte_offset = 0usize;
        for (index, run) in text.runs.iter().enumerate() {
            if run.text.is_empty() {
                return unsupported(&format!("text run {index} is empty"));
            }
            if run.bold || run.italic {
                return unsupported(
                    "Photoshop EngineData has no independent bold/italic run flag; select the bold/italic PostScript font face or use faux styling",
                );
            }
            validate_text_run(run, index)?;
            let end = byte_offset
                .checked_add(run.text.len())
                .ok_or_else(|| FormatError::Unsupported("text run length overflow".into()))?;
            if text.string.get(byte_offset..end) != Some(run.text.as_str()) {
                return unsupported("text runs do not concatenate to the layer text");
            }
            byte_offset = end;
        }
        if byte_offset != text.string.len() {
            return unsupported("text runs do not concatenate to the layer text");
        }
    }
    if text.antialias > 4 {
        return unsupported("unknown text antialias mode");
    }
    if text.warp_style > 15
        || !text.warp_bend.is_finite()
        || !text.warp_h.is_finite()
        || !text.warp_v.is_finite()
    {
        return unsupported("invalid text warp settings");
    }
    validate_font_name(text.font.as_deref())?;

    let mut items = vec![
        ("Txt ".into(), Value::Text(text.string.replace('\n', "\r"))),
        (
            "Ornt".into(),
            Value::Enum {
                type_id: "Ornt".into(),
                value: if text.vertical { "Vrtc" } else { "Hrzn" }.into(),
            },
        ),
        (
            "AntA".into(),
            Value::Enum {
                type_id: "Annt".into(),
                value: antialias_name(text.antialias).into(),
            },
        ),
        ("EngineData".into(), Value::Data(text_engine_data(text)?)),
    ];
    // Keep deterministic item order even as optional fields are added later.
    items.shrink_to_fit();
    let text_descriptor = Descriptor {
        class_id: "TxLr".into(),
        items,
    };
    let warp_descriptor = Descriptor {
        class_id: "warp".into(),
        items: vec![
            (
                "warpStyle".into(),
                Value::Enum {
                    type_id: "warpStyle".into(),
                    value: warp_name(text.warp_style).into(),
                },
            ),
            (
                "warpValue".into(),
                Value::Unit {
                    unit: *b"#Prc",
                    value: f64::from(text.warp_bend) * 100.0,
                },
            ),
            (
                "warpPerspective".into(),
                Value::Unit {
                    unit: *b"#Prc",
                    value: f64::from(text.warp_h) * 100.0,
                },
            ),
            (
                "warpPerspectiveOther".into(),
                Value::Unit {
                    unit: *b"#Prc",
                    value: f64::from(text.warp_v) * 100.0,
                },
            ),
        ],
    };

    let mut output = Vec::new();
    push_i16(&mut output, 1);
    for value in [
        1.0,
        0.0,
        0.0,
        1.0,
        f64::from(text.origin.0),
        f64::from(text.origin.1),
    ] {
        push_f64(&mut output, value);
    }
    push_i16(&mut output, 50);
    write_version_and_descriptor(&mut output, &text_descriptor);
    push_i16(&mut output, 1);
    write_version_and_descriptor(&mut output, &warp_descriptor);

    // TySh's trailing text rectangle. Point text uses the layer bounds as a
    // conservative box; the editable origin remains in the transform above.
    push_f32(&mut output, bounds.x as f32);
    push_f32(&mut output, bounds.y as f32);
    push_f32(
        &mut output,
        bounds
            .x
            .saturating_add(i32::try_from(bounds.w).unwrap_or(i32::MAX)) as f32,
    );
    push_f32(
        &mut output,
        bounds
            .y
            .saturating_add(i32::try_from(bounds.h).unwrap_or(i32::MAX)) as f32,
    );
    Ok(output)
}

fn validate_text_run(run: &TextRun, index: usize) -> Result<()> {
    validate_font_name(run.font.as_deref())?;
    if let Some(size) = run.size {
        if !size.is_finite() || size <= 0.0 || size > 1_000_000.0 {
            return unsupported(&format!("text run {index} size is outside the Photoshop range"));
        }
    }
    for (name, value) in [
        ("tracking", run.tracking),
        ("horizontal scale", run.h_scale),
        ("vertical scale", run.v_scale),
        ("baseline", run.baseline),
    ] {
        if let Some(value) = value {
            let invalid_scale = matches!(name, "horizontal scale" | "vertical scale") && value <= 0.0;
            if !value.is_finite() || invalid_scale || value.abs() > 1_000_000.0 {
                return unsupported(&format!(
                    "text run {index} {name} is outside the Photoshop EngineData range"
                ));
            }
        }
    }
    if run.caps.is_some_and(|caps| caps > 2) {
        return unsupported(&format!("text run {index} has an unknown caps mode"));
    }
    Ok(())
}

fn validate_font_name(font: Option<&str>) -> Result<()> {
    if let Some(font) = font {
        if font.is_empty() || font.chars().any(char::is_control) {
            return unsupported("font name is not a valid PostScript font name");
        }
        if font.encode_utf16().count() > MAX_FONT_UTF16_UNITS {
            return unsupported("font name is too large for bounded Photoshop EngineData export");
        }
    }
    Ok(())
}

fn text_engine_data(text: &Text) -> Result<Vec<u8>> {
    let mut fonts = vec!["AdobeInvisFont".to_string()];
    for font in std::iter::once(text.font.as_ref()).chain(text.runs.iter().map(|run| run.font.as_ref())) {
        if let Some(font) = font {
            if !fonts.iter().any(|known| known == font) {
                if fonts.len() >= MAX_TEXT_FONTS {
                    return unsupported("text has too many Photoshop EngineData fonts");
                }
                fonts.push(font.clone());
            }
        }
    }

    let text_units = text.string.encode_utf16().count();
    let editor_units = text_units
        .checked_add(1)
        .ok_or_else(|| FormatError::Unsupported("text run length overflow".into()))?;
    let mut output = Vec::with_capacity((text.string.len() * 2).saturating_add(2048));
    engine_ascii(&mut output, "<< /EngineDict << /Editor << /Text ");
    engine_utf16_string_with_return(&mut output, &text.string);
    engine_ascii(&mut output, " >> /ParagraphRun << /DefaultRunData << /ParagraphSheet << /DefaultStyleSheet 0 /Properties << >> >> /Adjustments << /Axis [ 1.0 0.0 1.0 ] /XY [ 0.0 0.0 ] >> >> /RunArray [ << /ParagraphSheet << /DefaultStyleSheet 0 /Properties << /Justification ");
    engine_usize(&mut output, usize::from(text.align));
    engine_ascii(&mut output, " /AutoLeading 1.2 >> >> /Adjustments << /Axis [ 1.0 0.0 1.0 ] /XY [ 0.0 0.0 ] >> >> ] /RunLengthArray [ ");
    engine_usize(&mut output, editor_units);
    engine_ascii(&mut output, " ] /IsJoinable 1 >> /StyleRun << /DefaultRunData << /StyleSheet << /StyleSheetData << ");
    write_engine_style(&mut output, text, None, &fonts);
    engine_ascii(&mut output, " >> >> >> /RunArray [ ");

    if text.runs.is_empty() {
        engine_ascii(&mut output, "<< /StyleSheet << /StyleSheetData << ");
        write_engine_style(&mut output, text, None, &fonts);
        engine_ascii(&mut output, " >> >> >> ");
    } else {
        for run in &text.runs {
            engine_ascii(&mut output, "<< /StyleSheet << /StyleSheetData << ");
            write_engine_style(&mut output, text, Some(run), &fonts);
            engine_ascii(&mut output, " >> >> >> ");
        }
    }
    engine_ascii(&mut output, "] /RunLengthArray [ ");
    if text.runs.is_empty() {
        engine_usize(&mut output, editor_units);
        engine_ascii(&mut output, " ");
    } else {
        for (index, run) in text.runs.iter().enumerate() {
            let mut units = run.text.encode_utf16().count();
            if index + 1 == text.runs.len() {
                units += 1;
            }
            engine_usize(&mut output, units);
            engine_ascii(&mut output, " ");
        }
    }
    engine_ascii(&mut output, "] /IsJoinable 2 >> /GridInfo << /GridIsOn false /ShowGrid false /GridSize 18.0 /GridLeading 22.0 /GridColor << /Type 1 /Values [ 1.0 0.0 0.0 1.0 ] >> /GridLeadingFillColor << /Type 1 /Values [ 1.0 0.0 0.0 1.0 ] >> /AlignLineHeightToGridFlags false >> /AntiAlias ");
    engine_usize(&mut output, engine_antialias_index(text.antialias));
    engine_ascii(&mut output, " /UseFractionalGlyphWidths true /Rendered << /Version 1 /Shapes << /WritingDirection ");
    engine_usize(&mut output, if text.vertical { 2 } else { 0 });
    engine_ascii(&mut output, " /Children [ << /ShapeType ");
    engine_usize(&mut output, if text.point { 0 } else { 1 });
    engine_ascii(&mut output, " /Procession ");
    engine_usize(&mut output, if text.vertical { 1 } else { 0 });
    engine_ascii(&mut output, " /Lines << /WritingDirection ");
    engine_usize(&mut output, if text.vertical { 2 } else { 0 });
    engine_ascii(&mut output, " /Children [ ] >> /Cookie << /Photoshop << /ShapeType ");
    engine_usize(&mut output, if text.point { 0 } else { 1 });
    if text.point {
        engine_ascii(&mut output, " /PointBase [ 0.0 0.0 ]");
    } else if let Some((width, height)) = text.box_size {
        engine_ascii(&mut output, " /BoxBounds [ 0.0 0.0 ");
        engine_f32(&mut output, width);
        engine_ascii(&mut output, " ");
        engine_f32(&mut output, height);
        engine_ascii(&mut output, " ]");
    }
    engine_ascii(&mut output, " /Base << /ShapeType ");
    engine_usize(&mut output, if text.point { 0 } else { 1 });
    engine_ascii(&mut output, " /TransformPoint0 [ 1.0 0.0 ] /TransformPoint1 [ 0.0 1.0 ] /TransformPoint2 [ 0.0 0.0 ] >> >> >> >> ] >> >> >> /ResourceDict ");
    write_engine_resources(&mut output, text, &fonts);
    engine_ascii(&mut output, " /DocumentResources ");
    write_engine_resources(&mut output, text, &fonts);
    engine_ascii(&mut output, " >>");

    if output.len() > MAX_ENGINE_DATA_BYTES {
        return unsupported("generated Photoshop EngineData exceeds the bounded size limit");
    }
    Ok(output)
}

fn write_engine_resources(output: &mut Vec<u8>, text: &Text, fonts: &[String]) {
    engine_ascii(output, "<< /KinsokuSet [ ] /MojiKumiSet [ ] /TheNormalStyleSheet 0 /TheNormalParagraphSheet 0 /ParagraphSheetSet [ << /Name ");
    engine_utf16_string(output, "Normal RGB");
    engine_ascii(output, " /DefaultStyleSheet 0 /Properties << /Justification ");
    engine_usize(output, usize::from(text.align));
    engine_ascii(output, " /AutoLeading 1.2 >> >> ] /StyleSheetSet [ << /Name ");
    engine_utf16_string(output, "Normal RGB");
    engine_ascii(output, " /StyleSheetData << ");
    write_engine_style(output, text, None, fonts);
    engine_ascii(output, " >> >> ] /FontSet [ ");
    for font in fonts {
        engine_ascii(output, "<< /Name ");
        engine_utf16_string(output, font);
        engine_ascii(output, " /Script 0 /FontType 0 /Synthetic 0 >> ");
    }
    engine_ascii(output, "] /SuperscriptSize .583 /SuperscriptPosition .333 /SubscriptSize .583 /SubscriptPosition .333 /SmallCapSize .7 >>");
}

fn write_engine_style(output: &mut Vec<u8>, text: &Text, run: Option<&TextRun>, fonts: &[String]) {
    let font = run.and_then(|run| run.font.as_ref()).or(text.font.as_ref());
    if let Some(font) = font {
        if let Some(index) = fonts.iter().position(|known| known == font) {
            engine_ascii(output, "/Font ");
            engine_usize(output, index);
            engine_ascii(output, " ");
        }
    }
    engine_ascii(output, "/FontSize ");
    engine_f32(output, run.and_then(|run| run.size).unwrap_or(text.size));
    engine_ascii(output, " /FauxBold ");
    engine_bool(output, run.is_some_and(|run| run.faux_bold));
    engine_ascii(output, " /FauxItalic ");
    engine_bool(output, run.is_some_and(|run| run.faux_italic));
    engine_ascii(output, " /AutoLeading ");
    engine_bool(output, text.leading == 0.0);
    engine_ascii(output, " /Leading ");
    engine_f32(output, text.leading);
    engine_ascii(output, " /HorizontalScale ");
    engine_f32(output, run.and_then(|run| run.h_scale).unwrap_or(1.0));
    engine_ascii(output, " /VerticalScale ");
    engine_f32(output, run.and_then(|run| run.v_scale).unwrap_or(1.0));
    engine_ascii(output, " /Tracking ");
    engine_f32(output, run.and_then(|run| run.tracking).unwrap_or(text.tracking));
    engine_ascii(output, " /BaselineShift ");
    engine_f32(output, run.and_then(|run| run.baseline).unwrap_or(0.0));
    engine_ascii(output, " /FontCaps ");
    engine_usize(output, usize::from(run.and_then(|run| run.caps).unwrap_or(0)));
    engine_ascii(output, " /FontBaseline 0 /Underline ");
    engine_bool(output, run.is_some_and(|run| run.underline));
    engine_ascii(output, " /Strikethrough ");
    engine_bool(output, run.is_some_and(|run| run.strike));
    engine_ascii(output, " /AutoKerning true /Kerning 0 /FillColor << /Type 1 /Values [ ");
    let [red, green, blue, alpha] = run.and_then(|run| run.color).unwrap_or(text.color);
    for value in [alpha, red, green, blue] {
        engine_f32(output, f32::from(value) / 255.0);
        engine_ascii(output, " ");
    }
    engine_ascii(output, "] >>");
}

fn engine_ascii(output: &mut Vec<u8>, value: &str) {
    output.extend_from_slice(value.as_bytes());
}

fn engine_bool(output: &mut Vec<u8>, value: bool) {
    engine_ascii(output, if value { "true" } else { "false" });
}

fn engine_usize(output: &mut Vec<u8>, value: usize) {
    engine_ascii(output, &value.to_string());
}

fn engine_f32(output: &mut Vec<u8>, value: f32) {
    engine_ascii(output, &value.to_string());
}

fn engine_utf16_string(output: &mut Vec<u8>, value: &str) {
    output.push(b'(');
    output.extend_from_slice(&[0xfe, 0xff]);
    for unit in value.encode_utf16() {
        engine_utf16_unit(output, unit);
    }
    output.push(b')');
}

fn engine_utf16_string_with_return(output: &mut Vec<u8>, value: &str) {
    output.push(b'(');
    output.extend_from_slice(&[0xfe, 0xff]);
    for character in value.chars() {
        if character == '\n' {
            engine_utf16_unit(output, 13);
        } else {
            let mut units = [0u16; 2];
            for unit in character.encode_utf16(&mut units).iter().copied() {
                engine_utf16_unit(output, unit);
            }
        }
    }
    engine_utf16_unit(output, 13);
    output.push(b')');
}

fn engine_antialias_index(value: u8) -> usize {
    match value {
        1 => 4, // sharp
        2 => 1, // crisp
        3 => 2, // strong
        4 => 3, // smooth
        _ => 0,
    }
}

fn engine_utf16_unit(output: &mut Vec<u8>, unit: u16) {
    for byte in unit.to_be_bytes() {
        if matches!(byte, b'(' | b')' | b'\\') {
            output.push(b'\\');
        }
        output.push(byte);
    }
}

fn antialias_name(value: u8) -> &'static str {
    match value {
        1 => "antiAliasSharp",
        2 => "antiAliasCrisp",
        3 => "antiAliasStrong",
        4 => "antiAliasSmooth",
        _ => "antiAliasNone",
    }
}

fn warp_name(value: u8) -> &'static str {
    match value {
        1 => "warpArc",
        2 => "warpArcLower",
        3 => "warpArcUpper",
        4 => "warpArch",
        5 => "warpBulge",
        6 => "warpShellLower",
        7 => "warpShellUpper",
        8 => "warpFlag",
        9 => "warpWave",
        10 => "warpFish",
        11 => "warpRise",
        12 => "warpFisheye",
        13 => "warpInflate",
        14 => "warpSqueeze",
        15 => "warpTwist",
        _ => "warpNone",
    }
}

fn encode_adjustment(adjustment: &Adjustment) -> Result<PsdTaggedBlock> {
    let (key, data) = match adjustment {
        Adjustment::BrightnessContrast {
            brightness,
            contrast,
        } => {
            let mut data = Vec::new();
            push_i16(
                &mut data,
                scaled_i16(*brightness, 100.0, -100, 100, "brightness")?,
            );
            push_i16(
                &mut data,
                scaled_i16(*contrast, 100.0, -100, 100, "contrast")?,
            );
            push_u16(&mut data, 0);
            data.push(0);
            (*b"brit", data)
        }
        Adjustment::Levels {
            in_black,
            in_white,
            gamma,
            out_black,
            out_white,
        } => {
            let master = [
                unit_u16(*in_black, "levels input black")?,
                unit_u16(*in_white, "levels input white")?,
                unit_u16(*out_black, "levels output black")?,
                unit_u16(*out_white, "levels output white")?,
                scaled_u16(*gamma, 100.0, 1, 1000, "levels gamma")?,
            ];
            let defaults = [0, 255, 0, 255, 100];
            let mut data = Vec::with_capacity(2 + 29 * 10);
            push_u16(&mut data, 2);
            for channel in 0..29 {
                for value in if channel == 0 { master } else { defaults } {
                    push_u16(&mut data, value);
                }
            }
            (*b"levl", data)
        }
        Adjustment::HueSaturation {
            hue,
            saturation,
            lightness,
        } => (*b"hue2", hue_saturation_block(*hue, *saturation, *lightness)?),
        Adjustment::HueSaturationFull {
            hue,
            saturation,
            lightness,
            colorize,
            ranges,
        } => {
            let active = encoded_hue_sat_triple(
                *hue,
                *saturation,
                *lightness,
                *colorize,
            )?;
            let mut data = Vec::with_capacity(100);
            push_u16(&mut data, 2);
            data.extend_from_slice(&[u8::from(*colorize), 0]);
            for value in if *colorize { active } else { [0; 3] } {
                push_i16(&mut data, value);
            }
            for value in if *colorize { [0; 3] } else { active } {
                push_i16(&mut data, value);
            }
            for (range, bounds) in ranges.iter().zip(HUE_RANGE_BOUNDS) {
                for value in bounds {
                    push_i16(&mut data, value);
                }
                for value in encoded_hue_sat_triple(range[0], range[1], range[2], false)? {
                    push_i16(&mut data, value);
                }
            }
            (*b"hue2", data)
        }
        Adjustment::Vibrance {
            vibrance,
            saturation,
        } => {
            let descriptor = Descriptor {
                class_id: "vibrance".into(),
                items: vec![
                    (
                        "vibrance".into(),
                        Value::Integer(i32::from(scaled_i16(
                            *vibrance, 100.0, -100, 100, "vibrance",
                        )?)),
                    ),
                    (
                        "Strt".into(),
                        Value::Integer(i32::from(scaled_i16(
                            *saturation,
                            100.0,
                            -100,
                            100,
                            "saturation",
                        )?)),
                    ),
                ],
            };
            (*b"vibA", encoded_version_and_descriptor(&descriptor))
        }
        Adjustment::Invert => (*b"nvrt", Vec::new()),
        Adjustment::BlackWhite { r, g, b } => {
            for (name, value) in [("red", r), ("green", g), ("blue", b)] {
                finite(*value, name)?;
            }
            let descriptor = Descriptor {
                class_id: "blackAndWhite".into(),
                items: vec![
                    ("Rd  ".into(), Value::Double(f64::from(*r))),
                    ("Grn ".into(), Value::Double(f64::from(*g))),
                    ("Bl  ".into(), Value::Double(f64::from(*b))),
                ],
            };
            (*b"blwh", encoded_version_and_descriptor(&descriptor))
        }
        Adjustment::BlackWhiteFull {
            bands,
            tint,
            tint_hue,
            tint_saturation,
        } => {
            for (name, value) in [
                ("red", bands[0]),
                ("yellow", bands[1]),
                ("green", bands[2]),
                ("cyan", bands[3]),
                ("blue", bands[4]),
                ("magenta", bands[5]),
            ] {
                finite(value, name)?;
            }
            finite(*tint_hue, "black and white tint hue")?;
            unit(*tint_saturation, "black and white tint saturation")?;
            if !(0.0..=360.0).contains(tint_hue) {
                return unsupported("black and white tint hue is outside 0..360");
            }
            let tint_color = Color3::from_hue_saturation(*tint_hue, *tint_saturation);
            let descriptor = Descriptor {
                class_id: "blackAndWhite".into(),
                items: vec![
                    ("Rd  ".into(), Value::Double(f64::from(bands[0]) * 100.0)),
                    ("Yllw".into(), Value::Double(f64::from(bands[1]) * 100.0)),
                    ("Grn ".into(), Value::Double(f64::from(bands[2]) * 100.0)),
                    ("Cyn ".into(), Value::Double(f64::from(bands[3]) * 100.0)),
                    ("Bl  ".into(), Value::Double(f64::from(bands[4]) * 100.0)),
                    ("Mgnt".into(), Value::Double(f64::from(bands[5]) * 100.0)),
                    ("useTint".into(), Value::Bool(*tint)),
                    (
                        "tintColor".into(),
                        Value::Descriptor(color_descriptor(tint_color)),
                    ),
                ],
            };
            (*b"blwh", encoded_version_and_descriptor(&descriptor))
        }
        // `post`/`thrs` are `uint16 value` + 2 zero pad bytes — there is no
        // version field. Writing one shifted the value into the padding, so
        // Photoshop read the constant back as levels=2 / threshold=1 (#214).
        Adjustment::Posterize { levels } => {
            let mut data = Vec::new();
            push_i16(
                &mut data,
                scaled_i16(*levels, 1.0, 2, 255, "posterize levels")?,
            );
            push_u16(&mut data, 0);
            (*b"post", data)
        }
        Adjustment::Threshold { level } => {
            let mut data = Vec::new();
            push_i16(&mut data, unit_u16(*level, "threshold")? as i16);
            push_u16(&mut data, 0);
            (*b"thrs", data)
        }
        Adjustment::Exposure {
            exposure,
            offset,
            gamma,
        } => {
            finite(*exposure, "exposure")?;
            finite(*offset, "exposure offset")?;
            finite(*gamma, "exposure gamma")?;
            if !(-3.0..=3.0).contains(exposure) || *gamma <= 0.0 {
                return unsupported("exposure values exceed the neutral IR range");
            }
            let mut data = Vec::new();
            push_u16(&mut data, 1);
            push_f32(&mut data, *exposure);
            push_f32(&mut data, *offset);
            push_f32(&mut data, *gamma);
            (*b"expA", data)
        }
        Adjustment::ColorBalance {
            shadows,
            midtones,
            highlights,
        } => {
            let mut data = Vec::new();
            for (group, values) in [
                ("shadows", shadows),
                ("midtones", midtones),
                ("highlights", highlights),
            ] {
                for value in values {
                    push_i16(&mut data, scaled_i16(*value, 100.0, -100, 100, group)?);
                }
            }
            data.push(1); // preserve luminosity
            (*b"blnc", data)
        }
        Adjustment::PhotoFilter { color, density } => {
            validate_color(*color, "photo filter")?;
            unit(*density, "photo filter density")?;
            let mut data = Vec::new();
            push_u16(&mut data, 2);
            write_rgb_color(&mut data, *color);
            push_u32(&mut data, (*density * 100.0).round() as u32);
            data.push(1);
            data.extend_from_slice(&[0, 0, 0]);
            (*b"phfl", data)
        }
        Adjustment::Desaturate => (*b"hue2", hue_saturation_block(0.0, -1.0, 0.0)?),
        Adjustment::Curves { lut } => {
            if lut.len() < 256 {
                return unsupported("curves LUT needs 256 entries");
            }
            let lut = &lut[..256];
            let mut data = Vec::new();
            data.push(0);
            push_u16(&mut data, 1);
            push_u16(&mut data, 0);
            push_u16(&mut data, 1);
            write_curve_channel(&mut data, lut)?;
            data.extend_from_slice(b"Crv ");
            push_u16(&mut data, 4);
            push_u16(&mut data, 0);
            push_u16(&mut data, 1);
            push_u16(&mut data, 0);
            write_curve_channel(&mut data, lut)?;
            (*b"curv", data)
        }
        Adjustment::GradientMap { lut } => {
            if lut.len() < 256 * 3 {
                return unsupported("gradient map LUT needs 768 entries");
            }
            let mut data = Vec::new();
            push_u16(&mut data, 1);
            data.push(0);
            data.push(0);
            write_unicode(&mut data, "", false);
            push_u16(&mut data, 256);
            let interpolation = 4096u32;
            for index in 0..256 {
                let location = (index as f32 / 255.0 * interpolation as f32).round() as u32;
                push_u32(&mut data, location);
                push_u32(&mut data, 50);
                let color = Color3::new(lut[index * 3], lut[index * 3 + 1], lut[index * 3 + 2]);
                validate_color(color, "gradient map stop")?;
                write_rgb_color(&mut data, color);
                data.extend_from_slice(&[0, 0]);
            }
            push_u16(&mut data, 2);
            for location in [0u32, interpolation] {
                push_u32(&mut data, location);
                push_u32(&mut data, 50);
                push_u16(&mut data, 255);
            }
            push_u16(&mut data, 2);
            push_u16(&mut data, interpolation as u16);
            push_u16(&mut data, 32);
            push_u16(&mut data, 0);
            push_u32(&mut data, 0);
            push_u16(&mut data, 0);
            push_u16(&mut data, 0);
            push_u32(&mut data, 4096);
            push_u16(&mut data, 3);
            for _ in 0..4 {
                push_u16(&mut data, 0);
            }
            for _ in 0..4 {
                push_u16(&mut data, 0);
            }
            data.extend_from_slice(&[0, 0, 0, 0]);
            (*b"grdm", data)
        }
    };
    Ok(PsdTaggedBlock { key, data })
}

fn encode_effects(effects: &[Effect]) -> Result<Vec<u8>> {
    let mut groups: Vec<(&'static str, Vec<Descriptor>)> = Vec::new();
    for effect in effects {
        let (key, descriptor) = encode_effect(effect)?;
        match groups.iter_mut().find(|(existing, _)| *existing == key) {
            Some((_, descriptors)) => descriptors.push(descriptor),
            None => groups.push((key, vec![descriptor])),
        }
    }
    let mut items = Vec::with_capacity(groups.len());
    for (key, mut descriptors) in groups {
        let first = descriptors.remove(0);
        items.push((key.into(), Value::Descriptor(first)));
        if !descriptors.is_empty() {
            items.push((
                format!("{key}Multi"),
                Value::List(descriptors.into_iter().map(Value::Descriptor).collect()),
            ));
        }
    }
    let root = Descriptor {
        class_id: "Lefx".into(),
        items,
    };
    let mut output = Vec::new();
    push_u32(&mut output, 0);
    write_version_and_descriptor(&mut output, &root);
    Ok(output)
}

fn encode_effect(effect: &Effect) -> Result<(&'static str, Descriptor)> {
    if let Effect::Disabled(inner) = effect {
        let (key, mut descriptor) = encode_effect(inner)?;
        match descriptor.items.iter_mut().find(|(key, _)| key == "enab") {
            Some((_, value)) => *value = Value::Bool(false),
            None => descriptor
                .items
                .insert(0, ("enab".into(), Value::Bool(false))),
        }
        return Ok((key, descriptor));
    }
    let pair = match effect {
        Effect::DropShadow {
            blend,
            opacity,
            color,
            angle,
            distance,
            spread,
            size,
        } => (
            "DrSh",
            Descriptor {
                class_id: "DrSh".into(),
                items: shadow_items(*blend, *opacity, *color, *angle, *distance, *spread, *size)?,
            },
        ),
        Effect::InnerShadow {
            blend,
            opacity,
            color,
            angle,
            distance,
            choke,
            size,
        } => (
            "IrSh",
            Descriptor {
                class_id: "IrSh".into(),
                items: shadow_items(*blend, *opacity, *color, *angle, *distance, *choke, *size)?,
            },
        ),
        Effect::OuterGlow {
            blend,
            opacity,
            color,
            spread,
            size,
        } => {
            let mut items = base_effect_items(*blend, *opacity, *color)?;
            items.push(percent_item("Ckmt", *spread, "outer glow spread")?);
            items.push(pixel_item("blur", *size, "outer glow size")?);
            (
                "OrGl",
                Descriptor {
                    class_id: "OrGl".into(),
                    items,
                },
            )
        }
        Effect::InnerGlow {
            blend,
            opacity,
            color,
            choke,
            size,
            center,
        } => {
            let mut items = base_effect_items(*blend, *opacity, *color)?;
            items.push(percent_item("Ckmt", *choke, "inner glow choke")?);
            items.push(pixel_item("blur", *size, "inner glow size")?);
            items.push((
                "glwS".into(),
                Value::Enum {
                    type_id: "IGSr".into(),
                    value: if *center { "SrcC" } else { "SrcE" }.into(),
                },
            ));
            (
                "IrGl",
                Descriptor {
                    class_id: "IrGl".into(),
                    items,
                },
            )
        }
        Effect::Bevel {
            hl_blend,
            hl_opacity,
            hl_color,
            sh_blend,
            sh_opacity,
            sh_color,
            angle,
            altitude,
            depth,
            size,
            soften,
            style,
        } => {
            if *style > 3 {
                return unsupported("unknown bevel style");
            }
            let items = vec![
                ("enab".into(), Value::Bool(true)),
                blend_item("hglM", *hl_blend),
                percent_item("hglO", *hl_opacity, "bevel highlight opacity")?,
                (
                    "hglC".into(),
                    Value::Descriptor(checked_color_descriptor(*hl_color, "bevel highlight")?),
                ),
                blend_item("sdwM", *sh_blend),
                percent_item("sdwO", *sh_opacity, "bevel shadow opacity")?,
                (
                    "sdwC".into(),
                    Value::Descriptor(checked_color_descriptor(*sh_color, "bevel shadow")?),
                ),
                angle_item("lagl", *angle, "bevel angle")?,
                angle_item("Lald", *altitude, "bevel altitude")?,
                scale_percent_item("srgR", *depth, 0.1, "bevel depth")?,
                pixel_item("blur", *size, "bevel size")?,
                pixel_item("Sftn", *soften, "bevel soften")?,
                (
                    "bvlS".into(),
                    Value::Enum {
                        type_id: "BESl".into(),
                        value: match style {
                            1 => "OtrB",
                            2 => "Embs",
                            3 => "PlEb",
                            _ => "InrB",
                        }
                        .into(),
                    },
                ),
            ];
            (
                "ebbl",
                Descriptor {
                    class_id: "ebbl".into(),
                    items,
                },
            )
        }
        Effect::Satin {
            blend,
            opacity,
            color,
            angle,
            distance,
            size,
            invert,
        } => {
            let mut items = base_effect_items(*blend, *opacity, *color)?;
            items.push(angle_item("Angl", *angle, "satin angle")?);
            items.push(pixel_item("Dstn", *distance, "satin distance")?);
            items.push(pixel_item("blur", *size, "satin size")?);
            items.push(("Invr".into(), Value::Bool(*invert)));
            (
                "ChFX",
                Descriptor {
                    class_id: "ChFX".into(),
                    items,
                },
            )
        }
        Effect::ColorOverlay {
            blend,
            opacity,
            color,
        } => (
            "SoFi",
            Descriptor {
                class_id: "SoFi".into(),
                items: base_effect_items(*blend, *opacity, *color)?,
            },
        ),
        Effect::GradientOverlay {
            blend,
            opacity,
            angle,
            scale,
            radial,
            reverse,
            start,
            end,
        } => {
            let mut items = vec![
                ("enab".into(), Value::Bool(true)),
                blend_item("Md  ", *blend),
                percent_item("Opct", *opacity, "gradient opacity")?,
                angle_item("Angl", *angle, "gradient angle")?,
                scale_percent_item("Scl ", *scale, 0.0, "gradient scale")?,
                (
                    "Type".into(),
                    Value::Enum {
                        type_id: "GrdT".into(),
                        value: if *radial { "Rdl " } else { "Lnr " }.into(),
                    },
                ),
                ("Rvrs".into(), Value::Bool(*reverse)),
            ];
            items.push((
                "Grad".into(),
                Value::Descriptor(gradient_descriptor(*start, *end)?),
            ));
            (
                "GrFl",
                Descriptor {
                    class_id: "GrFl".into(),
                    items,
                },
            )
        }
        Effect::PatternOverlay { .. } => {
            return unsupported("pattern overlays lack a pattern identifier in the neutral IR")
        }
        Effect::Disabled(_) => unreachable!("disabled effects are unwrapped above"),
        Effect::Stroke {
            blend,
            opacity,
            color,
            size,
            position,
        } => {
            if *position > 2 {
                return unsupported("unknown stroke position");
            }
            let mut items = base_effect_items(*blend, *opacity, *color)?;
            items.push(pixel_item("Sz  ", *size, "stroke size")?);
            items.push((
                "Styl".into(),
                Value::Enum {
                    type_id: "FStl".into(),
                    value: match position {
                        1 => "InsF",
                        2 => "CtrF",
                        _ => "OutF",
                    }
                    .into(),
                },
            ));
            (
                "FrFX",
                Descriptor {
                    class_id: "FrFX".into(),
                    items,
                },
            )
        }
    };
    Ok(pair)
}

fn shadow_items(
    blend: BlendMode,
    opacity: f32,
    color: Color3,
    angle: f32,
    distance: f32,
    choke: f32,
    size: f32,
) -> Result<Vec<(String, Value)>> {
    let mut items = base_effect_items(blend, opacity, color)?;
    items.push(angle_item("Angl", angle, "shadow angle")?);
    items.push(pixel_item("Dstn", distance, "shadow distance")?);
    items.push(percent_item("Ckmt", choke, "shadow choke")?);
    items.push(pixel_item("blur", size, "shadow size")?);
    Ok(items)
}

fn base_effect_items(
    blend: BlendMode,
    opacity: f32,
    color: Color3,
) -> Result<Vec<(String, Value)>> {
    Ok(vec![
        ("enab".into(), Value::Bool(true)),
        blend_item("Md  ", blend),
        percent_item("Opct", opacity, "effect opacity")?,
        (
            "Clr ".into(),
            Value::Descriptor(checked_color_descriptor(color, "effect color")?),
        ),
    ])
}

fn gradient_descriptor(start: Color3, end: Color3) -> Result<Descriptor> {
    validate_color(start, "gradient start")?;
    validate_color(end, "gradient end")?;
    let stop = |color: Color3, location: i32| {
        Value::Descriptor(Descriptor {
            class_id: "Clrt".into(),
            items: vec![
                ("Clr ".into(), Value::Descriptor(color_descriptor(color))),
                ("Lctn".into(), Value::Integer(location)),
                ("Mdpn".into(), Value::Integer(50)),
            ],
        })
    };
    Ok(Descriptor {
        class_id: "Grdn".into(),
        items: vec![
            ("Nm  ".into(), Value::Text("Monet Gradient".into())),
            (
                "GrdF".into(),
                Value::Enum {
                    type_id: "GrdF".into(),
                    value: "CstS".into(),
                },
            ),
            ("Intr".into(), Value::Double(4096.0)),
            (
                "Clrs".into(),
                Value::List(vec![stop(start, 0), stop(end, 4096)]),
            ),
        ],
    })
}

fn blend_item(key: &str, blend: BlendMode) -> (String, Value) {
    (
        key.into(),
        Value::Enum {
            type_id: "BlnM".into(),
            value: blend_name(blend).into(),
        },
    )
}

fn blend_name(blend: BlendMode) -> &'static str {
    use BlendMode::*;
    match blend {
        Normal => "Nrml",
        Dissolve => "Dslv",
        Darken => "Drkn",
        Multiply => "Mltp",
        ColorBurn => "CBrn",
        LinearBurn => "linearBurn",
        Lighten => "Lghn",
        Screen => "Scrn",
        ColorDodge => "CDdg",
        LinearDodge => "linearDodge",
        Overlay => "Ovrl",
        SoftLight => "SftL",
        HardLight => "HrdL",
        VividLight => "vividLight",
        LinearLight => "linearLight",
        PinLight => "pinLight",
        HardMix => "hardMix",
        Difference => "Dfrn",
        Exclusion => "Xclu",
        Subtract => "blendSubtraction",
        Divide => "blendDivide",
        Hue => "H   ",
        Saturation => "Strt",
        Color => "Clr ",
        Luminosity => "Lmns",
        DarkerColor => "darkerColor",
        LighterColor => "lighterColor",
    }
}

fn percent_item(key: &str, value: f32, name: &str) -> Result<(String, Value)> {
    let value = unit(value, name)?;
    Ok((
        key.into(),
        Value::Unit {
            unit: *b"#Prc",
            value: f64::from(value) * 100.0,
        },
    ))
}

fn scale_percent_item(key: &str, value: f32, minimum: f32, name: &str) -> Result<(String, Value)> {
    finite(value, name)?;
    if value < minimum {
        return unsupported(&format!("{name} must be at least {minimum}"));
    }
    Ok((
        key.into(),
        Value::Unit {
            unit: *b"#Prc",
            value: f64::from(value) * 100.0,
        },
    ))
}

fn pixel_item(key: &str, value: f32, name: &str) -> Result<(String, Value)> {
    finite(value, name)?;
    Ok((
        key.into(),
        Value::Unit {
            unit: *b"#Pxl",
            value: f64::from(value),
        },
    ))
}

fn angle_item(key: &str, value: f32, name: &str) -> Result<(String, Value)> {
    finite(value, name)?;
    Ok((
        key.into(),
        Value::Unit {
            unit: *b"#Ang",
            value: f64::from(value),
        },
    ))
}

fn checked_color_descriptor(color: Color3, name: &str) -> Result<Descriptor> {
    validate_color(color, name)?;
    Ok(color_descriptor(color))
}

fn color_descriptor(color: Color3) -> Descriptor {
    Descriptor {
        class_id: "RGBC".into(),
        items: vec![
            ("Rd  ".into(), Value::Double(f64::from(color.r) * 255.0)),
            ("Grn ".into(), Value::Double(f64::from(color.g) * 255.0)),
            ("Bl  ".into(), Value::Double(f64::from(color.b) * 255.0)),
        ],
    }
}

fn validate_color(color: Color3, name: &str) -> Result<()> {
    for (channel, value) in [("red", color.r), ("green", color.g), ("blue", color.b)] {
        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return unsupported(&format!("{name} {channel} is outside 0..1"));
        }
    }
    Ok(())
}

fn finite(value: f32, name: &str) -> Result<f32> {
    if value.is_finite() {
        Ok(value)
    } else {
        unsupported(&format!("{name} must be finite"))
    }
}

fn unit(value: f32, name: &str) -> Result<f32> {
    finite(value, name)?;
    if (0.0..=1.0).contains(&value) {
        Ok(value)
    } else {
        unsupported(&format!("{name} is outside 0..1"))
    }
}

fn unit_u16(value: f32, name: &str) -> Result<u16> {
    Ok((unit(value, name)? * 255.0).round() as u16)
}

fn encoded_hue_sat_triple(
    hue: f32,
    saturation: f32,
    lightness: f32,
    colorize: bool,
) -> Result<[i16; 3]> {
    Ok([
        scaled_i16(
            hue,
            1.0,
            if colorize { 0 } else { -180 },
            if colorize { 360 } else { 180 },
            "hue",
        )?,
        scaled_i16(
            saturation,
            100.0,
            if colorize { 0 } else { -100 },
            100,
            "saturation",
        )?,
        scaled_i16(lightness, 100.0, -100, 100, "lightness")?,
    ])
}

fn hue_saturation_block(hue: f32, saturation: f32, lightness: f32) -> Result<Vec<u8>> {
    let master = encoded_hue_sat_triple(hue, saturation, lightness, false)?;
    let mut data = Vec::with_capacity(100);
    push_u16(&mut data, 2);
    data.extend_from_slice(&[0, 0]);
    for value in [0i16; 3] {
        push_i16(&mut data, value);
    }
    for value in master {
        push_i16(&mut data, value);
    }
    for _ in 0..6 {
        for value in [0i16; 7] {
            push_i16(&mut data, value);
        }
    }
    Ok(data)
}

fn write_rgb_color(output: &mut Vec<u8>, color: Color3) {
    push_u16(output, 0);
    push_u16(output, (color.r * 257.0).round() as u16);
    push_u16(output, (color.g * 257.0).round() as u16);
    push_u16(output, (color.b * 257.0).round() as u16);
    push_u16(output, 0);
}

fn write_curve_channel(output: &mut Vec<u8>, lut: &[f32]) -> Result<()> {
    push_u16(output, lut.len() as u16);
    for (input, value) in lut.iter().enumerate() {
        let output_value = unit(*value, "curves LUT")?;
        push_u16(output, (output_value * 255.0).round() as u16);
        push_u16(output, input as u16);
    }
    Ok(())
}

fn scaled_i16(value: f32, scale: f32, min: i16, max: i16, name: &str) -> Result<i16> {
    finite(value, name)?;
    let scaled = (value * scale).round();
    if scaled < f32::from(min) || scaled > f32::from(max) {
        return unsupported(&format!("{name} is outside the PSD range"));
    }
    Ok(scaled as i16)
}

fn scaled_u16(value: f32, scale: f32, min: u16, max: u16, name: &str) -> Result<u16> {
    finite(value, name)?;
    let scaled = (value * scale).round();
    if scaled < f32::from(min) || scaled > f32::from(max) {
        return unsupported(&format!("{name} is outside the PSD range"));
    }
    Ok(scaled as u16)
}

fn unsupported<T>(message: &str) -> Result<T> {
    Err(FormatError::Unsupported(message.into()))
}

fn encoded_version_and_descriptor(descriptor: &Descriptor) -> Vec<u8> {
    let mut output = Vec::new();
    write_version_and_descriptor(&mut output, descriptor);
    output
}

/// A layer block's descriptor payload padded to 4 bytes. Photoshop counts a
/// layer block's padding in its length, so a reader that trusts the length
/// finds the next block signature right after it.
fn layer_block_descriptor(descriptor: &Descriptor) -> Vec<u8> {
    let mut output = encoded_version_and_descriptor(descriptor);
    output.resize(output.len().next_multiple_of(4), 0);
    output
}

fn write_version_and_descriptor(output: &mut Vec<u8>, descriptor: &Descriptor) {
    push_u32(output, 16);
    write_descriptor(output, descriptor);
}

fn write_descriptor(output: &mut Vec<u8>, descriptor: &Descriptor) {
    write_unicode(output, "", false);
    write_key(output, &descriptor.class_id);
    push_u32(output, descriptor.items.len() as u32);
    for (key, value) in &descriptor.items {
        write_key(output, key);
        write_value(output, value);
    }
}

fn write_value(output: &mut Vec<u8>, value: &Value) {
    match value {
        Value::Descriptor(descriptor) => {
            output.extend_from_slice(b"Objc");
            write_descriptor(output, descriptor);
        }
        Value::List(values) => {
            output.extend_from_slice(b"VlLs");
            push_i32(output, values.len() as i32);
            for value in values {
                write_value(output, value);
            }
        }
        Value::Double(value) => {
            output.extend_from_slice(b"doub");
            push_f64(output, *value);
        }
        Value::Unit { unit, value } => {
            output.extend_from_slice(b"UntF");
            output.extend_from_slice(unit);
            push_f64(output, *value);
        }
        Value::Text(value) => {
            output.extend_from_slice(b"TEXT");
            write_unicode(output, value, true);
        }
        Value::Enum { type_id, value } => {
            output.extend_from_slice(b"enum");
            write_key(output, type_id);
            write_key(output, value);
        }
        Value::Integer(value) => {
            output.extend_from_slice(b"long");
            push_i32(output, *value);
        }
        Value::Large { low, high } => {
            output.extend_from_slice(b"comp");
            push_u32(output, *low);
            push_u32(output, *high);
        }
        Value::Bool(value) => {
            output.extend_from_slice(b"bool");
            output.push(u8::from(*value));
        }
        Value::Class { class_id } => {
            output.extend_from_slice(b"type");
            write_unicode(output, "", false);
            write_key(output, class_id);
        }
        Value::Alias(value) => {
            output.extend_from_slice(b"alis");
            push_i32(output, value.len() as i32);
            output.extend_from_slice(value);
        }
        Value::Data(value) => {
            output.extend_from_slice(b"tdta");
            push_i32(output, value.len() as i32);
            output.extend_from_slice(value);
        }
        Value::ObjectArray(values) => {
            output.extend_from_slice(b"ObAr");
            push_i32(output, 16);
            write_unicode(output, "", false);
            write_key(output, "null");
            push_i32(output, values.len() as i32);
            for (key, numbers) in values {
                write_key(output, key);
                output.extend_from_slice(b"UnFl");
                output.extend_from_slice(b"#Pxl");
                push_i32(output, numbers.len() as i32);
                for number in numbers {
                    push_f64(output, *number);
                }
            }
        }
    }
}

fn write_key(output: &mut Vec<u8>, value: &str) {
    let bytes = value.as_bytes();
    if bytes.len() == 4 {
        push_i32(output, 0);
    } else {
        push_i32(output, bytes.len() as i32);
    }
    output.extend_from_slice(bytes);
}

fn write_unicode(output: &mut Vec<u8>, value: &str, terminated: bool) {
    let units: Vec<u16> = value.encode_utf16().collect();
    push_u32(output, units.len() as u32 + u32::from(terminated));
    for unit in units {
        push_u16(output, unit);
    }
    if terminated {
        push_u16(output, 0);
    }
}

fn push_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_be_bytes());
}

fn push_i16(output: &mut Vec<u8>, value: i16) {
    output.extend_from_slice(&value.to_be_bytes());
}

fn push_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_be_bytes());
}

fn push_i32(output: &mut Vec<u8>, value: i32) {
    output.extend_from_slice(&value.to_be_bytes());
}

fn push_f32(output: &mut Vec<u8>, value: f32) {
    output.extend_from_slice(&value.to_be_bytes());
}

fn push_f64(output: &mut Vec<u8>, value: f64) {
    output.extend_from_slice(&value.to_be_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::descriptor::{parse_adjustment_block, parse_effects, parse_text};

    fn block(key: &[u8; 4], data: &[u8]) -> PsdTaggedBlock {
        PsdTaggedBlock {
            key: *key,
            data: data.to_vec(),
        }
    }

    fn base_text() -> Text {
        Text {
            string: "Hello Ω\nworld".into(),
            point: true,
            vertical: true,
            size: 36.5,
            color: [12, 34, 56, 200],
            font: Some("Inter".into()),
            origin: (17, -9),
            warp_style: 9,
            warp_bend: 0.25,
            warp_h: -0.1,
            warp_v: 0.2,
            antialias: 4,
            ..Default::default()
        }
    }

    fn assert_noncanonical_adjustment_preserved_then_edit_rejected(
        source: PsdTaggedBlock,
        edited: Adjustment,
    ) {
        let projection = parse_adjustment_block(source.key, &source.data)
            .expect("test adjustment block has a neutral projection");
        assert_ne!(projection, edited, "test must exercise a semantic edit");
        let mut layer = Layer::new(
            52,
            "Rich adjustment",
            LayerKind::Adjustment,
            Bounds::default(),
        );
        layer.adjustment = Some(projection);
        let preserved = vec![source.clone()];
        assert_eq!(
            reconcile_psd_layer_blocks(&layer, &preserved).unwrap(),
            preserved,
            "untouched source bytes remain authoritative"
        );

        layer.adjustment = Some(edited);
        let error = reconcile_psd_layer_blocks(&layer, &preserved).unwrap_err();
        assert!(matches!(error, FormatError::Unsupported(_)));
        assert!(
            error
                .to_string()
                .contains(String::from_utf8_lossy(&source.key).as_ref()),
            "{error}"
        );
    }

    #[test]
    fn canonical_text_and_effects_regenerate_once_while_unknown_blocks_survive() {
        let mut layer = Layer::new(
            7,
            "Text",
            LayerKind::Text,
            Bounds {
                x: 3,
                y: 4,
                w: 50,
                h: 20,
            },
        );
        layer.text = Some(base_text());
        layer.effects = vec![
            Effect::DropShadow {
                blend: BlendMode::Multiply,
                opacity: 0.75,
                color: Color3::new(0.1, 0.2, 0.3),
                angle: 120.0,
                distance: 7.0,
                spread: 0.2,
                size: 9.0,
            },
            Effect::Stroke {
                blend: BlendMode::Screen,
                opacity: 0.5,
                color: Color3::new(1.0, 0.0, 0.5),
                size: 3.0,
                position: 2,
            },
        ];
        let mut source_text = base_text();
        source_text.string = "Before edit".into();
        let source_effects = vec![Effect::ColorOverlay {
            blend: BlendMode::Normal,
            opacity: 0.4,
            color: Color3::new(0.2, 0.4, 0.6),
        }];
        let preserved = vec![
            block(b"zzzz", b"unknown"),
            block(b"TySh", &encode_text(&source_text, layer.bounds).unwrap()),
            block(b"lfx2", &encode_effects(&source_effects).unwrap()),
            block(b"GdFl", b"opaque fill"),
        ];

        let blocks = reconcile_psd_layer_blocks(&layer, &preserved).unwrap();
        assert_eq!(
            blocks.iter().filter(|block| &block.key == b"TySh").count(),
            1
        );
        assert_eq!(
            blocks.iter().filter(|block| &block.key == b"lfx2").count(),
            1
        );
        assert_eq!(blocks[0], preserved[0]);
        assert_eq!(
            blocks[1], preserved[3],
            "opaque fill bytes remain untouched"
        );

        let text_block = blocks.iter().find(|block| &block.key == b"TySh").unwrap();
        let decoded = parse_text(&text_block.data).expect("generated TySh decodes");
        let expected = layer.text.as_ref().unwrap();
        assert_eq!(decoded.string, expected.string);
        assert_eq!(decoded.vertical, expected.vertical);
        assert_eq!(decoded.size, expected.size);
        assert_eq!(decoded.color, expected.color);
        assert_eq!(decoded.font, expected.font);
        assert_eq!(decoded.origin, expected.origin);
        assert_eq!(decoded.warp_style, expected.warp_style);
        assert_eq!(decoded.warp_bend, expected.warp_bend);
        assert_eq!(decoded.warp_h, expected.warp_h);
        assert_eq!(decoded.warp_v, expected.warp_v);
        assert_eq!(decoded.antialias, expected.antialias);

        let effects_block = blocks.iter().find(|block| &block.key == b"lfx2").unwrap();
        assert_eq!(parse_effects(&effects_block.data), layer.effects);
    }

    #[test]
    fn padded_canonical_sources_still_regenerate_after_an_edit() {
        // A reopened file's blocks carry the alignment zeros their length
        // counts; they are still the canonical encoding.
        let bounds = Bounds { x: 0, y: 0, w: 40, h: 20 };
        let mut source = base_text();
        source.string = "Logo".into();
        let text = encode_text(&source, bounds).unwrap();
        let effects = encode_effects(&[Effect::ColorOverlay {
            blend: BlendMode::Normal,
            opacity: 0.4,
            color: Color3::new(0.2, 0.4, 0.6),
        }])
        .unwrap();
        assert_ne!(text.len() % 4, 0, "the fixture needs padding");
        let mut padded_text = text.clone();
        padded_text.resize(text.len().next_multiple_of(4), 0);
        let preserved = vec![block(b"TySh", &padded_text), block(b"lfx2", &effects)];
        let mut layer = Layer::new(1, "Logo", LayerKind::Text, bounds);
        layer.text = Some(source.clone());
        layer.effects = parse_effects(&effects);
        layer.text.as_mut().unwrap().string = "Logo v2".into();
        let blocks = reconcile_psd_layer_blocks(&layer, &preserved).expect("a padded TySh is canonical");
        let regenerated = blocks.iter().find(|block| &block.key == b"TySh").unwrap();
        assert_eq!(parse_text(&regenerated.data).unwrap().string, "Logo v2");

        // Anything but zeros past the payload is not padding.
        let mut trailing = padded_text.clone();
        *trailing.last_mut().unwrap() = 1;
        assert!(reconcile_psd_layer_blocks(&layer, &[block(b"TySh", &trailing)]).is_err());
    }

    #[test]
    fn semantic_duplicates_have_deterministic_authority_and_safe_replacement() {
        let bounds = Bounds {
            x: 2,
            y: 3,
            w: 90,
            h: 30,
        };
        let source_text = base_text();
        let source_data = encode_text(&source_text, bounds).unwrap();
        let duplicates = vec![
            block(b"TySh", &source_data),
            block(b"note", b"ordered"),
            block(b"TySh", &source_data),
        ];
        let mut layer = Layer::new(9, "Duplicate text", LayerKind::Text, bounds);
        layer.text = Some(source_text.clone());
        assert_eq!(
            reconcile_psd_layer_blocks(&layer, &duplicates).unwrap(),
            duplicates,
            "untouched identical duplicates retain order and bytes"
        );

        layer.text.as_mut().unwrap().string.push('!');
        let regenerated = reconcile_psd_layer_blocks(&layer, &duplicates).unwrap();
        assert_eq!(regenerated[0], block(b"note", b"ordered"));
        assert_eq!(
            regenerated
                .iter()
                .filter(|block| &block.key == b"TySh")
                .count(),
            1
        );

        let mut other_text = source_text;
        other_text.string = "Different duplicate".into();
        let divergent = vec![
            block(b"TySh", &source_data),
            block(b"TySh", &encode_text(&other_text, bounds).unwrap()),
        ];
        layer.text = Some(parse_text(&source_data).unwrap());
        assert_eq!(
            reconcile_psd_layer_blocks(&layer, &divergent).unwrap(),
            divergent,
            "the first duplicate matches importer authority while untouched"
        );
        layer.text.as_mut().unwrap().tracking += 1.0;
        let error = reconcile_psd_layer_blocks(&layer, &divergent).unwrap_err();
        assert!(matches!(error, FormatError::Unsupported(_)));
        assert!(error.to_string().contains("duplicate blocks"), "{error}");
    }

    #[test]
    fn rich_paragraph_text_round_trips_with_utf16_runs_and_deduplicated_fonts() {
        let text = Text {
            string: "A😀β\nbox".into(),
            runs: vec![
                TextRun {
                    text: "A😀".into(),
                    font: Some("Inter Display".into()),
                    size: Some(31.25),
                    color: Some([210, 20, 90, 180]),
                    faux_bold: true,
                    underline: true,
                    tracking: Some(2.5),
                    h_scale: Some(1.25),
                    v_scale: Some(0.75),
                    baseline: Some(3.0),
                    caps: Some(2),
                    ..Default::default()
                },
                TextRun {
                    text: "β\nbox".into(),
                    font: Some("Inter Display".into()),
                    faux_italic: true,
                    strike: true,
                    caps: Some(1),
                    ..Default::default()
                },
            ],
            point: false,
            vertical: false,
            size: 24.0,
            color: [10, 30, 50, 255],
            font: Some("Inter Regular".into()),
            align: 3,
            leading: 40.0,
            tracking: 1.25,
            origin: (11, 17),
            box_size: Some((240.5, 80.25)),
            antialias: 2,
            ..Default::default()
        };
        let engine = text_engine_data(&text).unwrap();
        assert!(engine
            .windows(b"/RunLengthArray [ 3 6 ]".len())
            .any(|window| window == b"/RunLengthArray [ 3 6 ]"));
        let mut encoded_font = Vec::new();
        engine_utf16_string(&mut encoded_font, "Inter Display");
        assert_eq!(
            engine
                .windows(encoded_font.len())
                .filter(|window| *window == encoded_font.as_slice())
                .count(),
            2,
            "one deduplicated FontSet entry in each standard resource dictionary"
        );

        let encoded = encode_text(
            &text,
            Bounds {
                x: 0,
                y: 0,
                w: 300,
                h: 120,
            },
        )
        .unwrap();
        let decoded = parse_text(&encoded).expect("generated rich TySh decodes");
        assert_eq!(decoded.string, text.string);
        assert!(!decoded.point);
        assert_eq!(decoded.box_size, text.box_size);
        assert_eq!(decoded.align, 3);
        assert_eq!(decoded.leading, 40.0);
        assert_eq!(decoded.tracking, 1.25);
        assert_eq!(decoded.size, 24.0);
        assert_eq!(decoded.color, [10, 30, 50, 255]);
        assert_eq!(decoded.font.as_deref(), Some("Inter Regular"));
        assert_eq!(decoded.runs.len(), 2);
        assert_eq!(decoded.runs[0].text, "A😀");
        assert_eq!(decoded.runs[0].font.as_deref(), Some("Inter Display"));
        assert_eq!(decoded.runs[0].size, Some(31.25));
        assert_eq!(decoded.runs[0].color, Some([210, 20, 90, 180]));
        assert!(decoded.runs[0].faux_bold);
        assert!(decoded.runs[0].underline);
        assert_eq!(decoded.runs[0].tracking, Some(2.5));
        assert_eq!(decoded.runs[0].h_scale, Some(1.25));
        assert_eq!(decoded.runs[0].v_scale, Some(0.75));
        assert_eq!(decoded.runs[0].baseline, Some(3.0));
        assert_eq!(decoded.runs[0].caps, Some(2));
        assert_eq!(decoded.runs[1].text, "β\nbox");
        assert_eq!(decoded.runs[1].font.as_deref(), Some("Inter Display"));
        assert!(decoded.runs[1].faux_italic);
        assert!(decoded.runs[1].strike);
        assert_eq!(decoded.runs[1].caps, Some(1));
    }

    #[test]
    fn malformed_canonical_engine_data_falls_back_without_partial_styles() {
        let text = base_text();
        let engine = text_engine_data(&text).unwrap();
        let mut encoded = encode_text(
            &text,
            Bounds {
                x: 0,
                y: 0,
                w: 100,
                h: 40,
            },
        )
        .unwrap();
        let offset = encoded
            .windows(engine.len())
            .position(|window| window == engine)
            .expect("EngineData payload is embedded in TySh");
        encoded[offset] = b'!';

        let decoded = parse_text(&encoded).expect("malformed EngineData does not drop TySh");
        assert_eq!(decoded.string, text.string);
        assert_eq!(decoded.size, 48.0);
        assert_eq!(decoded.color, [255, 255, 255, 255]);
        assert_eq!(decoded.font, None);
        assert!(decoded.runs.is_empty());

        let bounds = Bounds {
            x: 0,
            y: 0,
            w: 100,
            h: 40,
        };
        let mut layer = Layer::new(41, "Malformed EngineData", LayerKind::Text, bounds);
        layer.text = Some(decoded);
        let source = vec![block(b"TySh", &encoded)];
        assert_eq!(
            reconcile_psd_layer_blocks(&layer, &source).unwrap(),
            source,
            "untouched malformed EngineData remains byte-for-byte authoritative"
        );

        layer.text.as_mut().unwrap().size += 1.0;
        let error = reconcile_psd_layer_blocks(&layer, &source).unwrap_err();
        assert!(matches!(error, FormatError::Unsupported(_)));
        assert!(error.to_string().contains("TySh"), "{error}");
    }

    #[test]
    fn every_supported_adjustment_round_trips_through_its_tagged_block() {
        let adjustments = vec![
            Adjustment::BrightnessContrast {
                brightness: 0.25,
                contrast: -0.4,
            },
            Adjustment::Levels {
                in_black: 32.0 / 255.0,
                in_white: 224.0 / 255.0,
                gamma: 1.25,
                out_black: 16.0 / 255.0,
                out_white: 240.0 / 255.0,
            },
            Adjustment::HueSaturation {
                hue: 30.0,
                saturation: -0.4,
                lightness: 0.05,
            },
            Adjustment::HueSaturationFull {
                hue: 210.0,
                saturation: 0.6,
                lightness: -0.1,
                colorize: true,
                ranges: [
                    [10.0, 0.2, -0.1],
                    [-20.0, -0.3, 0.4],
                    [30.0, 0.0, 0.0],
                    [0.0, 0.1, -0.2],
                    [-15.0, 0.5, 0.25],
                    [45.0, -0.4, -0.5],
                ],
            },
            Adjustment::Vibrance {
                vibrance: 0.2,
                saturation: -0.1,
            },
            Adjustment::Invert,
            Adjustment::BlackWhite {
                r: -40.0,
                g: 144.0,
                b: -3.0,
            },
            // Posterize/Threshold are deliberately absent: their decoder reads
            // the same phantom version u16 this encoder used to write (#213),
            // so round-tripping them here only re-proves the mirror-image
            // agreement that hid #214. They are pinned byte-exactly below.
            Adjustment::Exposure {
                exposure: -2.0,
                offset: 0.125,
                gamma: 1.0,
            },
            Adjustment::ColorBalance {
                shadows: [0.0, 0.0, 0.0],
                midtones: [0.16, -0.21, 0.33],
                highlights: [0.38, 0.35, 0.38],
            },
        ];

        for adjustment in adjustments {
            let encoded = encode_adjustment(&adjustment).unwrap();
            let decoded = parse_adjustment_block(encoded.key, &encoded.data)
                .unwrap_or_else(|| panic!("generated {:?} block decodes", encoded.key));
            assert_eq!(decoded, adjustment, "round-trip for {:?}", encoded.key);
        }
    }

    #[test]
    fn previously_unsupported_adjustments_encode_to_their_photoshop_blocks() {
        for (adjustment, key) in [
            (Adjustment::Desaturate, *b"hue2"),
            (
                Adjustment::PhotoFilter {
                    color: Color3::new(0.93, 0.54, 0.0),
                    density: 0.25,
                },
                *b"phfl",
            ),
            (
                Adjustment::Curves {
                    lut: (0..256).map(|value| value as f32 / 255.0).collect(),
                },
                *b"curv",
            ),
            (
                Adjustment::GradientMap {
                    lut: (0..768).map(|value| value as f32 / 767.0).collect(),
                },
                *b"grdm",
            ),
        ] {
            let encoded = encode_adjustment(&adjustment)
                .unwrap_or_else(|error| panic!("{adjustment:?}: {error}"));
            assert_eq!(encoded.key, key, "{adjustment:?}");
            assert!(!encoded.data.is_empty(), "{adjustment:?}");
        }
    }

    #[test]
    fn stacked_effects_encode_as_photoshop_multi_lists() {
        let stroke = |size: f32| Effect::Stroke {
            blend: BlendMode::Normal,
            opacity: 1.0,
            color: Color3::new(1.0, 0.0, 0.0),
            size,
            position: 0,
        };
        let encoded = encode_effects(&[stroke(4.0), stroke(2.0)]).unwrap();
        let root = read_version_and_descriptor(&mut Reader::new(&encoded[4..])).unwrap();
        assert!(root.get("FrFX").is_some(), "first stroke stays FrFX");
        assert!(
            matches!(root.get("FrFXMulti"), Some(Value::List(items)) if items.len() == 1),
            "the second stroke becomes a one-entry FrFXMulti list"
        );
    }

    #[test]
    fn disabled_effects_encode_with_enab_false() {
        let effect = Effect::Disabled(Box::new(Effect::ColorOverlay {
            blend: BlendMode::Normal,
            opacity: 1.0,
            color: Color3::new(1.0, 0.0, 0.0),
        }));
        let encoded = encode_effects(&[effect]).unwrap();
        let root = read_version_and_descriptor(&mut Reader::new(&encoded[4..])).unwrap();
        let Some(Value::Descriptor(overlay)) = root.get("SoFi") else {
            panic!("missing SoFi descriptor");
        };
        assert!(matches!(overlay.get("enab"), Some(Value::Bool(false))));
    }

    #[test]
    fn full_hue_and_black_white_payloads_keep_all_photoshop_semantics() {
        let hue = Adjustment::HueSaturationFull {
            hue: 210.0,
            saturation: 0.6,
            lightness: -0.1,
            colorize: true,
            ranges: [
                [10.0, 0.2, -0.1],
                [-20.0, -0.3, 0.4],
                [30.0, 0.0, 0.0],
                [0.0, 0.1, -0.2],
                [-15.0, 0.5, 0.25],
                [45.0, -0.4, -0.5],
            ],
        };
        let hue_block = encode_adjustment(&hue).unwrap();
        assert_eq!(hue_block.data.len(), 100);
        assert_eq!(&hue_block.data[2..4], &[1, 0], "colorize flag + pad");
        let read_i16 = |offset: usize| {
            i16::from_be_bytes([hue_block.data[offset], hue_block.data[offset + 1]])
        };
        assert_eq!(
            [read_i16(16), read_i16(18), read_i16(20), read_i16(22)],
            HUE_RANGE_BOUNDS[0],
        );
        assert_eq!(
            [read_i16(86), read_i16(88), read_i16(90), read_i16(92)],
            HUE_RANGE_BOUNDS[5],
        );
        assert_eq!(
            parse_adjustment_block(hue_block.key, &hue_block.data),
            Some(hue),
        );

        let black_white = Adjustment::BlackWhiteFull {
            bands: [0.4, 0.6, 0.35, 0.8, 0.2, -0.15],
            tint: true,
            tint_hue: 40.0,
            tint_saturation: 0.4,
        };
        let black_white_block = encode_adjustment(&black_white).unwrap();
        let decoded = parse_adjustment_block(black_white_block.key, &black_white_block.data)
            .expect("generated Black & White descriptor decodes");
        let Adjustment::BlackWhiteFull {
            bands,
            tint,
            tint_hue,
            tint_saturation,
        } = decoded
        else {
            panic!("expected full Black & White projection");
        };
        assert_eq!(bands, [0.4, 0.6, 0.35, 0.8, 0.2, -0.15]);
        assert!(tint);
        assert!((tint_hue - 40.0).abs() < 1e-3, "tint hue {tint_hue}");
        assert!(
            (tint_saturation - 0.4).abs() < 1e-5,
            "tint saturation {tint_saturation}",
        );
        let canonical = Adjustment::BlackWhiteFull {
            bands,
            tint,
            tint_hue,
            tint_saturation,
        };
        assert_eq!(
            encode_adjustment(&canonical).unwrap(),
            black_white_block,
            "generated tinted descriptors remain editable after re-import",
        );
    }

    #[test]
    fn posterize_and_threshold_encode_value_first_then_two_pad_bytes() {
        // Photoshop's `post`/`thrs` layout is `uint16 value` + 2 zero pad bytes
        // (ag-psd: writeUint16(value); writeZeros(2)); the real fixture's
        // Posterize block is 00 10 00 00 for levels = 16. Writing a leading
        // version u16 shifted the value into the padding (#214).
        let posterize = encode_adjustment(&Adjustment::Posterize { levels: 16.0 }).unwrap();
        assert_eq!(posterize.key, *b"post");
        assert_eq!(posterize.data, [0x00, 0x10, 0x00, 0x00]);

        let threshold = encode_adjustment(&Adjustment::Threshold {
            level: 182.0 / 255.0,
        })
        .unwrap();
        assert_eq!(threshold.key, *b"thrs");
        assert_eq!(threshold.data, [0x00, 0xB6, 0x00, 0x00]);
    }

    #[test]
    fn unrepresented_adjustment_channels_and_flags_are_never_silently_lost() {
        let levels = Adjustment::Levels {
            in_black: 16.0 / 255.0,
            in_white: 240.0 / 255.0,
            gamma: 1.2,
            out_black: 8.0 / 255.0,
            out_white: 248.0 / 255.0,
        };
        let mut levels_block = encode_adjustment(&levels).unwrap();
        levels_block.data[13] = 7; // non-master channel 1 input-black
        assert_noncanonical_adjustment_preserved_then_edit_rejected(
            levels_block,
            Adjustment::Levels {
                in_black: 16.0 / 255.0,
                in_white: 240.0 / 255.0,
                gamma: 1.3,
                out_black: 8.0 / 255.0,
                out_white: 248.0 / 255.0,
            },
        );

        let hue_sat = Adjustment::HueSaturation {
            hue: 12.0,
            saturation: -0.2,
            lightness: 0.1,
        };
        let mut hue_block = encode_adjustment(&hue_sat).unwrap();
        hue_block.data[17] = 9; // first non-master colour-range bound
        assert_noncanonical_adjustment_preserved_then_edit_rejected(
            hue_block,
            Adjustment::HueSaturation {
                hue: 13.0,
                saturation: -0.2,
                lightness: 0.1,
            },
        );

        let balance = Adjustment::ColorBalance {
            shadows: [0.1, -0.1, 0.0],
            midtones: [0.2, -0.2, 0.3],
            highlights: [0.4, 0.0, -0.4],
        };
        let mut balance_block = encode_adjustment(&balance).unwrap();
        *balance_block.data.last_mut().unwrap() = 0; // preserve luminosity = false
        assert_noncanonical_adjustment_preserved_then_edit_rejected(
            balance_block,
            Adjustment::ColorBalance {
                shadows: [0.1, -0.1, 0.0],
                midtones: [0.21, -0.2, 0.3],
                highlights: [0.4, 0.0, -0.4],
            },
        );

        let rich_black_white = Descriptor {
            class_id: "blackAndWhite".into(),
            items: vec![
                ("Rd  ".into(), Value::Double(40.0)),
                ("Grn ".into(), Value::Double(35.0)),
                ("Bl  ".into(), Value::Double(25.0)),
                ("Yllw".into(), Value::Double(60.0)),
                ("Cyn ".into(), Value::Double(80.0)),
                ("Mgnt".into(), Value::Double(20.0)),
                ("useTint".into(), Value::Bool(true)),
                (
                    "tintColor".into(),
                    Value::Descriptor(color_descriptor(Color3::new(0.9, 0.7, 0.2))),
                ),
            ],
        };
        assert_noncanonical_adjustment_preserved_then_edit_rejected(
            PsdTaggedBlock {
                key: *b"blwh",
                data: encoded_version_and_descriptor(&rich_black_white),
            },
            Adjustment::BlackWhite {
                r: 41.0,
                g: 35.0,
                b: 25.0,
            },
        );
    }

    #[test]
    fn all_representable_layer_effects_round_trip() {
        let effects = vec![
            Effect::InnerShadow {
                blend: BlendMode::LinearBurn,
                opacity: 0.6,
                color: Color3::new(0.1, 0.2, 0.3),
                angle: 42.0,
                distance: 5.0,
                choke: 0.15,
                size: 6.0,
            },
            Effect::OuterGlow {
                blend: BlendMode::LinearDodge,
                opacity: 0.4,
                color: Color3::new(0.2, 0.3, 0.4),
                spread: 0.1,
                size: 8.0,
            },
            Effect::InnerGlow {
                blend: BlendMode::Overlay,
                opacity: 0.8,
                color: Color3::new(0.3, 0.4, 0.5),
                choke: 0.2,
                size: 4.0,
                center: true,
            },
            Effect::Bevel {
                hl_blend: BlendMode::Screen,
                hl_opacity: 0.75,
                hl_color: Color3::new(1.0, 0.9, 0.8),
                sh_blend: BlendMode::Multiply,
                sh_opacity: 0.5,
                sh_color: Color3::new(0.1, 0.2, 0.3),
                angle: 120.0,
                altitude: 30.0,
                depth: 1.5,
                size: 8.0,
                soften: 1.0,
                style: 2,
            },
            Effect::Satin {
                blend: BlendMode::Difference,
                opacity: 0.7,
                color: Color3::new(0.2, 0.1, 0.4),
                angle: 19.0,
                distance: 11.0,
                size: 14.0,
                invert: true,
            },
            Effect::ColorOverlay {
                blend: BlendMode::Color,
                opacity: 0.65,
                color: Color3::new(0.9, 0.2, 0.1),
            },
            Effect::GradientOverlay {
                blend: BlendMode::SoftLight,
                opacity: 0.55,
                angle: 90.0,
                scale: 0.8,
                radial: true,
                reverse: true,
                start: Color3::new(0.1, 0.2, 0.6),
                end: Color3::new(0.9, 0.4, 0.1),
            },
        ];
        let encoded = encode_effects(&effects).unwrap();
        assert_eq!(parse_effects(&encoded), effects);
    }

    #[test]
    fn rich_and_legacy_effect_blocks_are_preserved_or_rejected_without_loss() {
        let gradient_effect = Effect::GradientOverlay {
            blend: BlendMode::SoftLight,
            opacity: 0.7,
            angle: 45.0,
            scale: 0.8,
            radial: false,
            reverse: false,
            start: Color3::new(0.1, 0.2, 0.3),
            end: Color3::new(0.8, 0.9, 1.0),
        };
        let (_, mut gradient) = encode_effect(&gradient_effect).unwrap();
        let middle_stop = match gradient_descriptor(
            Color3::new(0.5, 0.1, 0.7),
            Color3::new(0.5, 0.1, 0.7),
        )
        .unwrap()
        .get("Clrs")
        {
            Some(Value::List(stops)) => stops[0].clone(),
            _ => unreachable!(),
        };
        match gradient
            .items
            .iter_mut()
            .find(|(key, _)| key == "Grad")
            .map(|(_, value)| value)
        {
            Some(Value::Descriptor(descriptor)) => match descriptor
                .items
                .iter_mut()
                .find(|(key, _)| key == "Clrs")
                .map(|(_, value)| value)
            {
                Some(Value::List(stops)) => stops.insert(1, middle_stop),
                _ => unreachable!(),
            },
            _ => unreachable!(),
        }
        gradient
            .items
            .push(("Nose".into(), Value::Double(23.0)));
        gradient.items.push((
            "TrnS".into(),
            Value::Descriptor(Descriptor {
                class_id: "ShpC".into(),
                items: vec![("Nm  ".into(), Value::Text("Cone".into()))],
            }),
        ));

        let disabled_shadow = Effect::DropShadow {
            blend: BlendMode::Multiply,
            opacity: 0.5,
            color: Color3::new(0.0, 0.0, 0.0),
            angle: 120.0,
            distance: 5.0,
            spread: 0.0,
            size: 8.0,
        };
        let (_, mut disabled) = encode_effect(&disabled_shadow).unwrap();
        let enabled = disabled
            .items
            .iter_mut()
            .find(|(key, _)| key == "enab")
            .expect("generated effect has enabled flag");
        enabled.1 = Value::Bool(false);

        let root = Descriptor {
            class_id: "Lefx".into(),
            items: vec![
                ("DrSh".into(), Value::Descriptor(disabled)),
                ("GrFl".into(), Value::Descriptor(gradient)),
            ],
        };
        let mut rich_data = Vec::new();
        push_u32(&mut rich_data, 0);
        write_version_and_descriptor(&mut rich_data, &root);
        let rich_block = block(b"lfx2", &rich_data);

        let mut layer = Layer::new(61, "Rich effects", LayerKind::Raster, Bounds::default());
        layer.effects = parse_effects(&rich_data);
        assert_eq!(layer.effects, vec![gradient_effect]);
        assert_eq!(
            reconcile_psd_layer_blocks(&layer, std::slice::from_ref(&rich_block)).unwrap(),
            vec![rich_block.clone()],
            "disabled, contour, noise, and middle-stop data remain byte-exact"
        );

        if let Effect::GradientOverlay { angle, .. } = &mut layer.effects[0] {
            *angle += 1.0;
        }
        let error = reconcile_psd_layer_blocks(&layer, std::slice::from_ref(&rich_block))
            .unwrap_err();
        assert!(matches!(error, FormatError::Unsupported(_)));
        assert!(error.to_string().contains("lfx2"), "{error}");

        let legacy = block(b"lrFX", &[0, 0, 0, 0]);
        let mut legacy_layer =
            Layer::new(62, "Legacy effects", LayerKind::Raster, Bounds::default());
        assert_eq!(
            reconcile_psd_layer_blocks(&legacy_layer, std::slice::from_ref(&legacy)).unwrap(),
            vec![legacy.clone()]
        );
        legacy_layer.effects.push(Effect::ColorOverlay {
            blend: BlendMode::Normal,
            opacity: 1.0,
            color: Color3::new(1.0, 0.0, 0.0),
        });
        let error = reconcile_psd_layer_blocks(&legacy_layer, &[legacy]).unwrap_err();
        assert!(matches!(error, FormatError::Unsupported(_)));
        assert!(error.to_string().contains("lrFX"), "{error}");
    }

    #[test]
    fn every_effect_blend_mode_round_trips() {
        for index in (0..=27).filter(|index| *index != 25) {
            let blend = BlendMode::from_index(index);
            let effect = Effect::ColorOverlay {
                blend,
                opacity: 1.0,
                color: Color3::new(0.0, 0.0, 0.0),
            };
            let encoded = encode_effects(std::slice::from_ref(&effect)).unwrap();
            assert_eq!(parse_effects(&encoded), vec![effect], "blend index {index}");
        }
    }

    #[test]
    fn smart_and_linked_blocks_replace_stale_duplicates_deterministically() {
        let mut smart = Layer::new(1, "Smart", LayerKind::SmartObject, Bounds::default());
        smart.psd_smart_blocks = vec![
            block(b"SoLd", b"older authoritative"),
            block(b"PlLd", b"placement"),
            block(b"SoLd", b"latest authoritative"),
        ];
        let preserved = vec![
            block(b"abcd", b"unknown"),
            block(b"SoLd", b"stale"),
            block(b"SoLE", b"stale extended"),
            block(b"GdFl", b"opaque fill"),
        ];
        let blocks = reconcile_psd_layer_blocks(&smart, &preserved).unwrap();
        assert_eq!(blocks[0], preserved[0]);
        assert_eq!(blocks[1], preserved[3]);
        assert_eq!(blocks[2], block(b"SoLd", b"latest authoritative"));
        assert_eq!(blocks[3], block(b"PlLd", b"placement"));
        assert!(!blocks.iter().any(|block| &block.key == b"SoLE"));

        let linked = reconcile_psd_linked_blocks(
            &[
                block(b"lnk2", b"old authority"),
                block(b"lnkD", b"external"),
                block(b"lnk2", b"latest authority"),
            ],
            &[
                block(b"glob", b"unknown global"),
                block(b"lnk2", b"stale linked"),
                block(b"lnkE", b"stale external"),
            ],
        );
        assert_eq!(linked[0], block(b"glob", b"unknown global"));
        assert_eq!(linked[1], block(b"lnk2", b"latest authority"));
        assert_eq!(linked[2], block(b"lnkD", b"external"));
    }

    const SOURCE_ID: &str = "20953ddb-9391-11ec-b4f1-c15674f50bc4";

    #[test]
    fn placed_layer_descriptor_round_trips_its_source_id_and_corners() {
        let corners = [10.5, 20.0, 110.5, 20.0, 110.5, 70.0, 10.5, 70.0];
        let [plld, sold] = encode_psd_placed_layer(SOURCE_ID, 200, 100, corners);
        assert_eq!(&plld.key, b"PlLd");
        assert_eq!(plld.data.len() % 4, 0);
        assert_eq!(legacy_placed_layer(&plld.data), Some(PsdPlacedLayer { id: SOURCE_ID.into(), corners }));
        assert_eq!(&sold.key, b"SoLd");
        assert_eq!(sold.data.len() % 4, 0);
        let placed = psd_placed_layer(std::slice::from_ref(&sold)).expect("SoLd reads back");
        assert_eq!(placed, PsdPlacedLayer { id: SOURCE_ID.into(), corners });

        let mut reader = Reader::new(&sold.data[8..]);
        let descriptor = read_version_and_descriptor(&mut reader).unwrap();
        let Some(Value::Descriptor(size)) = descriptor.get("Sz  ") else {
            panic!("SoLd states its source size");
        };
        assert!(matches!(size.get("Wdth"), Some(Value::Double(w)) if *w == 200.0));
        assert!(matches!(size.get("Hght"), Some(Value::Double(h)) if *h == 100.0));

        // A perspective distort states its real quad apart from Trnf.
        let mut skewed = descriptor.clone();
        let quad = [0.0, 0.0, 50.0, 5.0, 45.0, 40.0, 3.0, 35.0];
        for (key, value) in &mut skewed.items {
            if key == "nonAffineTransform" {
                *value = Value::List(quad.iter().map(|&v| Value::Double(v)).collect());
            }
        }
        let mut data = b"soLD".to_vec();
        push_u32(&mut data, 4);
        write_version_and_descriptor(&mut data, &skewed);
        assert_eq!(psd_placed_layer(&[block(b"SoLd", &data)]).unwrap().corners, quad);

        // The legacy PlLd record carries the same link, without a size.
        let mut legacy = b"plcL".to_vec();
        push_u32(&mut legacy, 3);
        legacy.push(SOURCE_ID.len() as u8);
        legacy.extend_from_slice(SOURCE_ID.as_bytes());
        for value in [1, 1, 16, 2] {
            push_u32(&mut legacy, value);
        }
        for value in corners {
            push_f64(&mut legacy, value);
        }
        assert_eq!(
            psd_placed_layer(&[block(b"PlLd", &legacy)]),
            Some(PsdPlacedLayer { id: SOURCE_ID.into(), corners })
        );
        // Opaque or foreign bytes are simply not a placement.
        assert_eq!(psd_placed_layer(&[block(b"SoLd", b"soLD-descriptor")]), None);
        assert_eq!(psd_placed_layer(&[block(b"vmsk", &sold.data)]), None);
    }

    #[test]
    fn embedded_files_are_found_by_id_and_replaced_in_place() {
        let blocks = psd_linked_blocks_with_file(&[], SOURCE_ID, "Logo.psb", *b"8BPB", b"first!");
        assert_eq!(blocks.len(), 1);
        assert_eq!(&blocks[0].key, b"lnk2");
        assert_eq!(blocks[0].data.len() % 4, 0);
        assert_eq!(psd_embedded_file(&blocks, SOURCE_ID), Some(&b"first!"[..]));
        assert_eq!(psd_embedded_file(&blocks, "missing"), None);

        // A second source joins the same block; replacing the first keeps the
        // other record and the replaced record's name and type.
        let other = "a0000000-0000-0000-0000-00000000000b";
        let blocks = psd_linked_blocks_with_file(&blocks, other, "Other.psd", *b"8BPS", b"xy");
        assert_eq!(blocks.len(), 1);
        let glob = block(b"glob", b"unrelated");
        let with_glob = [glob.clone(), blocks[0].clone()];
        let replaced =
            psd_linked_blocks_with_file(&with_glob, SOURCE_ID, "ignored", *b"png ", b"second payload");
        assert_eq!(replaced[0], glob);
        assert_eq!(psd_embedded_file(&replaced, SOURCE_ID), Some(&b"second payload"[..]));
        assert_eq!(psd_embedded_file(&replaced, other), Some(&b"xy"[..]));
        let mut reader = Reader::new(&replaced[1].data[8..]);
        assert_eq!(&reader.fourcc().unwrap(), b"liFD");
        reader.u32().unwrap();
        assert_eq!(reader.pascal_string(1).unwrap(), SOURCE_ID);
        assert_eq!(reader.unicode_string(1).unwrap(), "Logo.psb");
        assert_eq!(&reader.fourcc().unwrap(), b"8BPB");

        // A record carrying a file-open descriptor, then trailing v7 fields,
        // is spliced around rather than rebuilt.
        let mut record = b"liFD".to_vec();
        push_u32(&mut record, 7);
        record.push(SOURCE_ID.len() as u8);
        record.extend_from_slice(SOURCE_ID.as_bytes());
        write_unicode(&mut record, "Nested.psb", true);
        record.extend_from_slice(b"8BPB8BIM");
        record.extend_from_slice(&3u64.to_be_bytes());
        record.push(1);
        write_version_and_descriptor(
            &mut record,
            &Descriptor { class_id: "null".into(), items: vec![("compID".into(), Value::Integer(-1))] },
        );
        record.extend_from_slice(b"old");
        write_unicode(&mut record, "child", true);
        push_f64(&mut record, 1.5);
        record.push(0);
        let mut data = Vec::new();
        push_linked_record(&mut data, &record);
        let original = [block(b"lnkD", &data)];
        assert_eq!(psd_embedded_file(&original, SOURCE_ID), Some(&b"old"[..]));
        let spliced = psd_linked_blocks_with_file(&original, SOURCE_ID, "x", *b"8BPB", b"fresh bytes");
        assert_eq!(&spliced[0].key, b"lnkD");
        assert_eq!(psd_embedded_file(&spliced, SOURCE_ID), Some(&b"fresh bytes"[..]));
        let tail = &spliced[0].data[8..];
        let length_at = record.windows(8).position(|w| w == b"8BPB8BIM").unwrap() + 8;
        let old_data_at = record.len() - 25 - 3; // before "old", childDocumentID, mod time, lock
        let new_data_at = tail.windows(11).position(|w| w == b"fresh bytes").unwrap();
        assert_eq!(&tail[..length_at], &record[..length_at]);
        assert_eq!(&tail[length_at..length_at + 8], &11u64.to_be_bytes());
        assert_eq!(&tail[length_at + 8..new_data_at], &record[length_at + 8..old_data_at]);
        assert_eq!(&tail[new_data_at + 11..new_data_at + 11 + 25], &record[record.len() - 25..]);

        // Records that are not embedded files, or lengths that overrun the
        // block, are left alone.
        let garbage = [block(b"lnk2", b"liFD\0embedded-source-bytes")];
        assert_eq!(psd_embedded_file(&garbage, SOURCE_ID), None);
    }

    #[test]
    fn missing_ir_detail_fails_explicitly_instead_of_emitting_fake_metadata() {
        for adjustment in [
            Adjustment::Desaturate,
            Adjustment::Curves {
                lut: vec![0.0; 256],
            },
            Adjustment::GradientMap {
                lut: vec![0.0; 768],
            },
            Adjustment::PhotoFilter {
                color: Color3::new(1.0, 0.5, 0.0),
                density: 0.25,
            },
        ] {
            assert!(
                encode_adjustment(&adjustment).is_ok(),
                "{adjustment:?} now has a PSD encoder"
            );
        }
        assert!(matches!(
            encode_effects(&[Effect::PatternOverlay {
                blend: BlendMode::Normal,
                opacity: 1.0,
                scale: 16.0,
                kind: 0,
            }]),
            Err(FormatError::Unsupported(_))
        ));

        let mut rich_text = base_text();
        rich_text.runs.push(TextRun {
            text: rich_text.string.clone(),
            bold: true,
            ..Default::default()
        });
        let mut layer = Layer::new(1, "Rich", LayerKind::Text, Bounds::default());
        layer.text = Some(rich_text);
        assert!(matches!(
            reconcile_psd_layer_blocks(&layer, &[]),
            Err(FormatError::Unsupported(_))
        ));
    }

    fn decoded(bytes: &[u8]) -> Descriptor {
        crate::import::descriptor::read_version_and_descriptor(
            &mut crate::import::reader::Reader::new(bytes),
        )
        .expect("fill descriptor decodes")
    }

    fn number(descriptor: &Descriptor, key: &str) -> f64 {
        match descriptor.get(key) {
            Some(Value::Double(value) | Value::Unit { value, .. }) => *value,
            Some(Value::Integer(value)) => f64::from(*value),
            other => panic!("{key} is not a number: {other:?}"),
        }
    }

    fn object<'a>(descriptor: &'a Descriptor, key: &str) -> &'a Descriptor {
        match descriptor.get(key) {
            Some(Value::Descriptor(inner)) => inner,
            other => panic!("{key} is not an object: {other:?}"),
        }
    }

    fn list<'a>(descriptor: &'a Descriptor, key: &str) -> Vec<&'a Descriptor> {
        match descriptor.get(key) {
            Some(Value::List(values)) => values
                .iter()
                .map(|value| match value {
                    Value::Descriptor(inner) => inner,
                    other => panic!("{key} holds a non-object: {other:?}"),
                })
                .collect(),
            other => panic!("{key} is not a list: {other:?}"),
        }
    }

    fn text<'a>(descriptor: &'a Descriptor, key: &str) -> &'a str {
        match descriptor.get(key) {
            Some(Value::Text(value)) => value.trim_end_matches('\0'),
            other => panic!("{key} is not text: {other:?}"),
        }
    }

    #[test]
    fn fill_descriptors_decode_to_their_stops_and_pattern() {
        let gradient = decoded(
            &encode_gradient_fill(
                &[
                    [0.0, 1.0, 0.0, 0.0, 1.0],
                    [0.5, 0.2, 0.4, 0.6, 0.5],
                    [1.0, 0.0, 0.0, 1.0, 0.25],
                ],
                -90.0,
            )
            .unwrap(),
        );
        assert_eq!(gradient.class_id, "null");
        assert!(matches!(
            gradient.get("Type"),
            Some(Value::Enum { type_id, value }) if type_id == "GrdT" && value == "Lnr "
        ));
        assert_eq!(number(&gradient, "Angl"), -90.0);
        let grad = object(&gradient, "Grad");
        assert_eq!(number(grad, "Intr"), 4096.0);
        let colors = list(grad, "Clrs");
        let opacities = list(grad, "Trns");
        let expected = [
            (0, [255.0, 0.0, 0.0], 100.0),
            (2048, [51.0, 102.0, 153.0], 50.0),
            (4096, [0.0, 0.0, 255.0], 25.0),
        ];
        assert_eq!(colors.len(), expected.len());
        assert_eq!(opacities.len(), expected.len());
        for ((color, opacity), (location, rgb, percent)) in
            colors.iter().zip(&opacities).zip(expected)
        {
            assert_eq!(number(color, "Lctn"), f64::from(location));
            assert_eq!(number(opacity, "Lctn"), f64::from(location));
            assert_eq!(number(color, "Mdpn"), 50.0);
            let rgbc = object(color, "Clr ");
            for (key, channel) in ["Rd  ", "Grn ", "Bl  "].into_iter().zip(rgb) {
                assert!((number(rgbc, key) - channel).abs() < 1e-3, "{key}");
            }
            assert!((number(opacity, "Opct") - percent).abs() < 1e-3);
        }

        let pattern = decoded(&encode_pattern_fill("Tile", "0a1b-2c", 250.0).unwrap());
        let ptrn = object(&pattern, "Ptrn");
        assert_eq!(text(ptrn, "Nm  "), "Tile");
        assert_eq!(text(ptrn, "Idnt"), "0a1b-2c");
        assert_eq!(number(&pattern, "Scl "), 250.0);
        assert_eq!(
            number(&decoded(&encode_pattern_fill("Tile", "id", 5000.0).unwrap()), "Scl "),
            1000.0,
            "scale clamps to the range the fill renders"
        );
    }

    #[test]
    fn fill_descriptor_encoders_refuse_what_photoshop_cannot_state() {
        let ends = [[0.0, 0.0, 0.0, 0.0, 1.0], [1.0, 1.0, 1.0, 1.0, 1.0]];
        for stops in [
            vec![ends[0]],
            vec![ends[0], [1.0, f32::NAN, 0.0, 0.0, 1.0]],
            vec![[0.6, 0.0, 0.0, 0.0, 1.0], [0.4, 1.0, 1.0, 1.0, 1.0]],
            vec![ends[0], [1.5, 1.0, 1.0, 1.0, 1.0]],
        ] {
            assert!(
                matches!(encode_gradient_fill(&stops, -90.0), Err(FormatError::Unsupported(_))),
                "{stops:?}"
            );
        }
        assert!(encode_gradient_fill(&ends, f32::NAN).is_err());
        assert!(encode_pattern_fill("Tile", "", 100.0).is_err());
        assert!(encode_pattern_fill("Tile", "id", f32::NAN).is_err());
    }

    // Dyadic fractions of 100x80, so 8.24 fixed point states them exactly.
    const RECT: [[f32; 2]; 4] = [[25.0, 20.0], [75.0, 20.0], [75.0, 60.0], [25.0, 60.0]];

    /// A `vmsk`/`vsms` payload for a 100x80 document: version 3, `flags`, a
    /// fill-rule record, then each `(closed, op, anchors)` subpath as a length
    /// record and unlinked knots whose controls sit on their anchor.
    fn outline(flags: u32, subpaths: &[(bool, i16, &[[f32; 2]])]) -> Vec<u8> {
        let mut out = Vec::new();
        push_u32(&mut out, 3);
        push_u32(&mut out, flags);
        out.extend(path_record(6, 0));
        for (closed, op, anchors) in subpaths {
            push_u16(&mut out, if *closed { 0 } else { 3 });
            push_u16(&mut out, anchors.len() as u16);
            push_i16(&mut out, *op);
            out.extend_from_slice(&[0; 20]);
            for [x, y] in anchors.iter() {
                push_u16(&mut out, if *closed { 2 } else { 5 });
                for _ in 0..3 {
                    push_i32(&mut out, (y / 80.0 * 16_777_216.0).round() as i32);
                    push_i32(&mut out, (x / 100.0 * 16_777_216.0).round() as i32);
                }
            }
        }
        out
    }

    fn path_record(selector: u16, value: u16) -> Vec<u8> {
        let mut out = Vec::new();
        push_u16(&mut out, selector);
        push_u16(&mut out, value);
        out.extend_from_slice(&[0; 22]);
        out
    }

    fn fill_with(color: Descriptor) -> Vec<u8> {
        encoded_version_and_descriptor(&Descriptor {
            class_id: "null".into(),
            items: vec![("Clr ".into(), Value::Descriptor(color))],
        })
    }

    fn red_fill() -> Vec<u8> {
        fill_with(color_descriptor(Color3::new(220.0 / 255.0, 40.0 / 255.0, 30.0 / 255.0)))
    }

    fn stroke_style(stroke: bool, fill: bool) -> Vec<u8> {
        encoded_version_and_descriptor(&Descriptor {
            class_id: "strokeStyle".into(),
            items: vec![
                ("strokeEnabled".into(), Value::Bool(stroke)),
                ("fillEnabled".into(), Value::Bool(fill)),
            ],
        })
    }

    fn rect_shape(blocks: &[PsdTaggedBlock]) -> Result<Option<PsdSolidShape>> {
        decode_psd_solid_shape(blocks, 100, 80)
    }

    #[test]
    fn solid_shapes_decode_from_either_photoshop_block_form() {
        let rect = outline(0, &[(true, -1, &RECT)]);
        let mut vscg = b"SoCo".to_vec();
        vscg.extend(red_fill());
        for blocks in [
            vec![block(b"vmsk", &rect), block(b"SoCo", &red_fill())],
            vec![
                block(b"vsms", &rect),
                block(b"vscg", &vscg),
                block(b"vstk", &stroke_style(false, true)),
                block(b"vogk", b"live shape"),
            ],
        ] {
            let shape = rect_shape(&blocks).unwrap().expect("a solid shape");
            let knots: Vec<[f32; 6]> = RECT.iter().map(|&[x, y]| [x, y, x, y, x, y]).collect();
            assert_eq!(shape.subpaths, vec![PsdShapeSubpath { closed: true, knots }]);
            for (channel, expected) in [shape.color.r, shape.color.g, shape.color.b]
                .into_iter()
                .zip([220.0, 40.0, 30.0])
            {
                assert!((channel * 255.0 - expected).abs() < 1e-3, "{channel}");
            }
        }

        // A second, open subpath that combines, not-linked flags, and the
        // alignment padding Photoshop counts in a block's length.
        let mut padded = outline(2, &[(true, -1, &RECT), (false, 1, &[[0.0, 0.0], [12.5, 10.0]])]);
        padded.extend_from_slice(&[0, 0]);
        let shape = rect_shape(&[block(b"vmsk", &padded), block(b"SoCo", &red_fill())])
            .unwrap()
            .expect("a two-part shape");
        assert_eq!(shape.subpaths.len(), 2);
        assert!(!shape.subpaths[1].closed);
        assert_eq!(shape.subpaths[1].knots[1], [12.5, 10.0, 12.5, 10.0, 12.5, 10.0]);
    }

    #[test]
    fn unreadable_shape_outlines_and_fills_are_errors() {
        let rect = outline(0, &[(true, -1, &RECT)]);
        let mut bad_version = rect.clone();
        bad_version[..4].copy_from_slice(&2u32.to_be_bytes());
        let mut ragged = rect.clone();
        ragged.extend_from_slice(&[0; 5]);
        let mut dirty_padding = rect.clone();
        dirty_padding.extend_from_slice(&[0, 7]);
        let mut unknown = rect.clone();
        unknown.extend(path_record(9, 0));
        let mut orphan_knot = outline(0, &[]);
        orphan_knot.extend(path_record(2, 0));
        let mut short_count = rect.clone();
        short_count[36..38].copy_from_slice(&5u16.to_be_bytes());
        let mut long_count = rect.clone();
        long_count[36..38].copy_from_slice(&3u16.to_be_bytes());
        for (case, outline, fill) in [
            ("version", bad_version, red_fill()),
            ("ragged records", ragged, red_fill()),
            ("dirty padding", dirty_padding, red_fill()),
            ("unknown selector", unknown, red_fill()),
            ("knot before a length record", orphan_knot, red_fill()),
            ("fewer knots than counted", short_count, red_fill()),
            ("more knots than counted", long_count, red_fill()),
            ("truncated fill", rect.clone(), vec![0, 0, 0]),
            (
                "fill without a colour",
                rect,
                encoded_version_and_descriptor(&Descriptor {
                    class_id: "null".into(),
                    items: Vec::new(),
                }),
            ),
        ] {
            assert!(
                rect_shape(&[block(b"vmsk", &outline), block(b"SoCo", &fill)]).is_err(),
                "{case}"
            );
        }
    }

    #[test]
    fn shapes_vision_cannot_own_stay_proxies_without_an_error() {
        let rect = outline(0, &[(true, -1, &RECT)]);
        let soco = || block(b"SoCo", &red_fill());
        let garbage: Vec<PsdTaggedBlock> = [
            b"vmsk", b"vsms", b"vogk", b"vstk", b"vscg", b"SoCo", b"GdFl", b"PtFl",
        ]
        .iter()
        .enumerate()
        .map(|(index, key)| block(key, &[0xC3, index as u8, 0x3C]))
        .collect();
        let mut gradient_vscg = b"GdFl".to_vec();
        gradient_vscg.extend(red_fill());
        let hsb = fill_with(Descriptor {
            class_id: "HSBC".into(),
            items: vec![
                ("H   ".into(), Value::Unit { unit: *b"#Ang", value: 10.0 }),
                ("Strt".into(), Value::Double(50.0)),
                ("Brgh".into(), Value::Double(50.0)),
            ],
        });
        let float_rgb = fill_with(Descriptor {
            class_id: "RGBC".into(),
            items: vec![
                ("redFloat".into(), Value::Double(0.5)),
                ("greenFloat".into(), Value::Double(0.5)),
                ("blueFloat".into(), Value::Double(0.5)),
            ],
        });
        let mut all_pixels = rect.clone();
        all_pixels.extend(path_record(8, 1));
        let two = |op| outline(0, &[(true, -1, &RECT), (true, op, &RECT)]);
        let mut oversized = outline(0, &[]);
        for _ in 0..MAX_SHAPE_PATH_RECORDS {
            oversized.extend(path_record(6, 0));
        }

        for (case, blocks) in [
            ("outline only", vec![block(b"vmsk", &rect)]),
            ("fill only", vec![soco()]),
            ("every proxy key as garbage", garbage),
            ("garbage outline alone", vec![block(b"vmsk", &[0xC3, 0, 0x3C])]),
            ("gradient", vec![block(b"vmsk", &rect), soco(), block(b"GdFl", &[1])]),
            ("pattern", vec![block(b"vmsk", &rect), soco(), block(b"PtFl", &[1])]),
            ("gradient behind vscg", vec![block(b"vmsk", &rect), block(b"vscg", &gradient_vscg)]),
            ("stroked", vec![block(b"vmsk", &rect), soco(), block(b"vstk", &stroke_style(true, true))]),
            ("unfilled", vec![block(b"vmsk", &rect), soco(), block(b"vstk", &stroke_style(false, false))]),
            ("hsb colour", vec![block(b"vmsk", &rect), block(b"SoCo", &hsb)]),
            ("float colour", vec![block(b"vmsk", &rect), block(b"SoCo", &float_rgb)]),
            ("inverted", vec![block(b"vmsk", &outline(1, &[(true, -1, &RECT)])), soco()]),
            ("disabled", vec![block(b"vmsk", &outline(4, &[(true, -1, &RECT)])), soco()]),
            ("fill starts with all pixels", vec![block(b"vmsk", &all_pixels), soco()]),
            ("subtract", vec![block(b"vmsk", &two(2)), soco()]),
            ("exclude", vec![block(b"vmsk", &two(0)), soco()]),
            ("more records than Vision exports", vec![block(b"vmsk", &oversized), soco()]),
            ("no subpaths", vec![block(b"vmsk", &outline(0, &[])), soco()]),
            ("empty subpath", vec![block(b"vmsk", &outline(0, &[(true, -1, &[])])), soco()]),
            ("two outlines", vec![block(b"vmsk", &rect), block(b"vsms", &rect), soco()]),
        ] {
            assert_eq!(rect_shape(&blocks), Ok(None), "{case}");
        }
    }
}
