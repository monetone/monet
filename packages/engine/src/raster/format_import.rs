// ─────────────────────────────────────────────────────────────
// Adapter: monet_format::import::Document (PSD/PSB/XCF) → Engine layer model.
//
// monet-format parses any supported layered file into a neutral, Monet-shaped
// IR (bottom-to-top layers, neutral blend modes, semantic adjustments/effects/
// text). This module maps that IR 1:1 onto the engine's private `Layer` vec —
// widening 8-bit source pixels to the engine's u16 store (×257), retaining
// ordinary raster pixels in their exact local bounds, and translating
// adjustments/effects/text into the engine's numeric encodings. Proxy-backed
// editable kinds remain canvas-sized until they carry separate source bounds.
// ─────────────────────────────────────────────────────────────

use crate::raster::blend::BlendMode;
use crate::raster::{color, Engine, Layer};
use monet_format::import::{
    Adjustment, Bounds, Color3, Document, DocumentChannel, Effect, LayerKind, Mask,
    PsdTaggedBlock, SourceFormat, Text, TextRun, MAX_PSD_PRESERVED_BLOCKS,
    MAX_PSD_PRESERVED_BYTES,
};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::{borrow::Cow, collections::HashSet};

pub(super) const PSD_PRESERVED_LAYER_KEYS: [[u8; 4]; 31] = [
    *b"SoLd", *b"SoLE", *b"PlLd", *b"vmsk", *b"vsms", *b"vogk", *b"vstk", *b"vscg",
    *b"SoCo", *b"GdFl", *b"PtFl", *b"TySh", *b"lfx2", *b"lrFX", *b"brit", *b"levl",
    *b"curv", *b"hue2", *b"hue ", *b"blnc", *b"expA", *b"vibA", *b"blwh", *b"post",
    *b"thrs", *b"nvrt", *b"grdm", *b"mixr", *b"selc", *b"phfl", *b"clrL",
];
const PSD_RASTER_PROXY_KEYS: [[u8; 4]; 8] = [
    *b"vmsk", *b"vsms", *b"vogk", *b"vstk", *b"vscg", *b"SoCo", *b"GdFl", *b"PtFl",
];
const PSD_RENDERED_PROXY_KEYS: [[u8; 4]; 6] = [
    *b"vogk", *b"vstk", *b"vscg", *b"SoCo", *b"GdFl", *b"PtFl",
];
const PSD_RASTER_PROXY_BASELINE_EXTRA: &str = "enginePsdRasterProxyBaselineV1";
const PSD_RASTER_PROXY_FINGERPRINT_DOMAIN: &[u8] = b"Monet PSD raster proxy provenance\0v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PsdRasterProxyAuthority {
    VectorMaskOnly,
    RenderedShapeOrFill,
}

fn psd_raster_proxy_authority(layer: &Layer) -> Option<PsdRasterProxyAuthority> {
    if layer.kind != 0 {
        return None;
    }
    let has_proxy = layer
        .psd_smart_blocks
        .iter()
        .any(|block| PSD_RASTER_PROXY_KEYS.contains(&block.key));
    if !has_proxy {
        return None;
    }
    Some(
        if layer
            .psd_smart_blocks
            .iter()
            .any(|block| PSD_RENDERED_PROXY_KEYS.contains(&block.key))
        {
            PsdRasterProxyAuthority::RenderedShapeOrFill
        } else {
            PsdRasterProxyAuthority::VectorMaskOnly
        },
    )
}

fn has_psd_raster_proxy_blocks(layer: &Layer) -> bool {
    layer
        .psd_smart_blocks
        .iter()
        .any(|block| PSD_RASTER_PROXY_KEYS.contains(&block.key))
}

pub(super) fn duplicate_psd_raster_proxy_ids(layers: &[Layer]) -> HashSet<u32> {
    let mut seen = HashSet::new();
    let mut duplicates = HashSet::new();
    let mut proxy_ids = HashSet::new();
    for layer in layers {
        if layer.kind == 0 && has_psd_raster_proxy_blocks(layer) {
            proxy_ids.insert(layer.id);
        }
        if !seen.insert(layer.id) {
            duplicates.insert(layer.id);
        }
    }
    duplicates.retain(|id| proxy_ids.contains(id));
    duplicates
}

pub(super) fn clear_duplicate_psd_raster_proxy_baselines(layers: &mut [Layer]) {
    let duplicates = duplicate_psd_raster_proxy_ids(layers);
    for layer in layers {
        if duplicates.contains(&layer.id) {
            layer.psd_raster_proxy_baseline = None;
        }
    }
}

fn hash_u16_samples(hasher: &mut Sha256, samples: &[u16]) {
    let mut encoded = [0u8; 8192];
    for chunk in samples.chunks(encoded.len() / 2) {
        for (sample, bytes) in chunk.iter().zip(encoded.chunks_exact_mut(2)) {
            bytes.copy_from_slice(&sample.to_le_bytes());
        }
        hasher.update(&encoded[..chunk.len() * 2]);
    }
}

fn hash_f32_samples(hasher: &mut Sha256, samples: &[f32]) {
    let mut encoded = [0u8; 8192];
    for chunk in samples.chunks(encoded.len() / 4) {
        for (sample, bytes) in chunk.iter().zip(encoded.chunks_exact_mut(4)) {
            bytes.copy_from_slice(&sample.to_bits().to_le_bytes());
        }
        hasher.update(&encoded[..chunk.len() * 4]);
    }
}

/// Bind retained Photoshop vector authority to the fields it owns. Independent
/// vector masks bind identity, effective geometry, and exact descriptor bytes;
/// rendered shape/fill proxies additionally bind depth and native RGB samples.
/// The digest is deterministic across native and GFX reloads.
pub(super) fn psd_raster_proxy_fingerprint(
    layer: &Layer,
    document_width: u32,
    document_height: u32,
    depth: u8,
) -> Option<[u8; 32]> {
    if layer.kind != 0 {
        return None;
    }
    let authority = psd_raster_proxy_authority(layer)?;
    let bounds = super::checked_translate_bounds(layer.pixel_bounds, layer.ox, layer.oy)?;
    let proxy_blocks = layer
        .psd_smart_blocks
        .iter()
        .filter(|block| PSD_RASTER_PROXY_KEYS.contains(&block.key));
    let proxy_block_count = proxy_blocks.clone().count();
    let proxy_block_count = u32::try_from(proxy_block_count).ok()?;

    let mut hasher = Sha256::new();
    hasher.update(PSD_RASTER_PROXY_FINGERPRINT_DOMAIN);
    hasher.update([match authority {
        PsdRasterProxyAuthority::VectorMaskOnly => 0,
        PsdRasterProxyAuthority::RenderedShapeOrFill => 1,
    }]);
    hasher.update(layer.id.to_le_bytes());
    hasher.update(document_width.to_le_bytes());
    hasher.update(document_height.to_le_bytes());
    hasher.update(bounds.x.to_le_bytes());
    hasher.update(bounds.y.to_le_bytes());
    hasher.update(bounds.w.to_le_bytes());
    hasher.update(bounds.h.to_le_bytes());
    if authority == PsdRasterProxyAuthority::RenderedShapeOrFill {
        let sample_len = super::checked_plane_len(layer.pixel_bounds, 4)?;
        hasher.update([depth]);
        hasher.update((sample_len as u64).to_le_bytes());
        match depth {
            8 | 16 if layer.pixels.len() == sample_len => {
                hasher.update([0]);
                hash_u16_samples(&mut hasher, &layer.pixels);
            }
            32 if layer.pixels_f32.len() == sample_len => {
                hasher.update([1]);
                hash_f32_samples(&mut hasher, &layer.pixels_f32);
            }
            _ => return None,
        }
    }
    hasher.update(proxy_block_count.to_le_bytes());
    for block in proxy_blocks {
        hasher.update(block.key);
        hasher.update((block.data.len() as u64).to_le_bytes());
        hasher.update(&block.data);
    }
    Some(hasher.finalize().into())
}

fn psd_raster_proxy_blocks_are_current(
    layer: &Layer,
    document_width: u32,
    document_height: u32,
    depth: u8,
) -> bool {
    layer.psd_raster_proxy_baseline.is_some_and(|baseline| {
        psd_raster_proxy_fingerprint(layer, document_width, document_height, depth)
            == Some(baseline)
    })
}

fn photoshop_blocks_for_export(
    layer: &Layer,
    document_width: u32,
    document_height: u32,
    depth: u8,
    proxy_id_is_unique: bool,
) -> Result<Vec<PsdTaggedBlock>, String> {
    let Some(authority) = psd_raster_proxy_authority(layer) else {
        // A layer authored here, or a shape converted on import, has no Adobe
        // shape authority left to preserve, so its vector semantics have to be
        // generated ahead of whatever it still retains (a layer style), as a
        // direct export orders them, or they leave as pixels.
        let mut blocks = if has_psd_raster_proxy_blocks(layer) {
            Vec::new()
        } else {
            synthesized_photoshop_vector_blocks(layer, document_width, document_height, depth)
        };
        blocks.extend_from_slice(&layer.psd_smart_blocks);
        return Ok(blocks);
    };
    let proxy_is_current = proxy_id_is_unique
        && psd_raster_proxy_blocks_are_current(layer, document_width, document_height, depth);
    if authority == PsdRasterProxyAuthority::VectorMaskOnly && !proxy_is_current {
        return Err(semantic_layer_error(
            layer,
            "vector-mask-only Photoshop authority has missing or stale geometry provenance",
        ));
    }
    Ok(layer
        .psd_smart_blocks
        .iter()
        .filter(|block| !PSD_RASTER_PROXY_KEYS.contains(&block.key) || proxy_is_current)
        .cloned()
        .collect())
}

// ── Vision-authored vector/fill layers → Photoshop vector authority ──────────
// An imported shape layer round-trips because its `vmsk`/`SoCo` blocks survive
// byte-for-byte. A shape authored HERE has none, so without these encoders it
// leaves Vision as flat pixels. `vmsk` carries the outline and `SoCo` the fill —
// the pair Photoshop reads to reopen the layer as a live shape/fill layer rather
// than a raster plane. Anything the pair cannot state exactly (per-item colours,
// strokes, gradients, group clips) keeps the rendered plane instead of exporting
// a lie.

/// The name a Vision pattern fill gives its document pattern record. Photoshop
/// resolves the fill by id; the name is what its pattern picker shows.
const PHOTOSHOP_PATTERN_NAME: &str = "Vision Pattern";

/// Path records are 26 bytes each; a pathological scene must not balloon a PSD.
/// Past the cap the layer exports as pixels, which is the prior behaviour.
const MAX_SYNTHESIZED_PATH_RECORDS: usize = 8192;

/// The one solid colour a whole vector scene reduces to, plus its outlines in
/// document pixel space.
struct SolidShape {
    subpaths: Vec<crate::vector::model::PathGeometry>,
    fill: Option<[f32; 3]>, // 0..1 per channel
}

fn synthesized_photoshop_vector_blocks(
    layer: &Layer,
    document_width: u32,
    document_height: u32,
    depth: u8,
) -> Vec<PsdTaggedBlock> {
    if document_width == 0 || document_height == 0 {
        return Vec::new();
    }
    match layer.kind {
        3 => {
            let Some(scene) = layer.vector_scene.as_deref() else {
                return Vec::new();
            };
            let view = vector_export_matrix(layer, document_width, document_height);
            let Some((subpaths, fill)) = solid_shape_from_scene(scene, view) else {
                return Vec::new();
            };
            let Some(vmsk) = encode_vector_mask(
                &subpaths,
                document_width as f32,
                document_height as f32,
            ) else {
                return Vec::new();
            };
            vec![
                PsdTaggedBlock {
                    key: *b"vmsk",
                    data: vmsk,
                },
                PsdTaggedBlock {
                    key: *b"SoCo",
                    data: encode_solid_color_fill(fill),
                },
            ]
        }
        4 if layer.adj_kind == 0 && layer.adj_params.len() >= 3 => {
            // SoCo carries no alpha, so a translucent fill stays a raster plane.
            if layer.adj_params.get(3).copied().unwrap_or(1.0) != 1.0 {
                return Vec::new();
            }
            let fill = [
                layer.adj_params[0].clamp(0.0, 1.0),
                layer.adj_params[1].clamp(0.0, 1.0),
                layer.adj_params[2].clamp(0.0, 1.0),
            ];
            vec![PsdTaggedBlock {
                key: *b"SoCo",
                data: encode_solid_color_fill(fill),
            }]
        }
        4 if layer.adj_kind == 1 => {
            // The renderer reads whole 5-value stops and ignores a remainder.
            let stops: Vec<[f32; 5]> = layer
                .adj_params
                .chunks_exact(5)
                .map(|stop| [stop[0], stop[1], stop[2], stop[3], stop[4]])
                .collect();
            // Vision paints the first stop along the top row; Photoshop's 90°
            // puts location 0 at the bottom, so the same ramp runs at -90°.
            match monet_format::import::encode_gradient_fill(&stops, -90.0) {
                Ok(data) => vec![PsdTaggedBlock { key: *b"GdFl", data }],
                Err(_) => Vec::new(),
            }
        }
        4 if layer.adj_kind == 2 => {
            let Some((_, _, id)) = photoshop_pattern_tile(layer, depth) else {
                return Vec::new();
            };
            match monet_format::import::encode_pattern_fill(
                PHOTOSHOP_PATTERN_NAME,
                &id,
                layer.adj_params[2],
            ) {
                Ok(data) => vec![PsdTaggedBlock { key: *b"PtFl", data }],
                Err(_) => Vec::new(),
            }
        }
        _ => Vec::new(),
    }
}

/// A pattern fill's tile by the renderer's own rule (`render_fill_layer`): a
/// whole `pw × ph` RGBA plane in `smart_src`. Returns its size and a UUID-shaped
/// id hashed from the tile, so equal tiles share one document record. None when
/// the params no longer describe the tile (it then renders nothing) or the
/// record's u32 lengths cannot hold it at this depth.
fn photoshop_pattern_tile(layer: &Layer, depth: u8) -> Option<(u32, u32, String)> {
    let params = &layer.adj_params;
    if layer.kind != 4 || layer.adj_kind != 2 || params.len() < 3 || !params[2].is_finite() {
        return None;
    }
    let pw = params[0].round().max(1.0) as u32;
    let ph = params[1].round().max(1.0) as u32;
    let texels = (pw as usize).checked_mul(ph as usize)?;
    if texels.checked_mul(4)? != layer.smart_src.len() {
        return None;
    }
    let sample_bytes = if depth == 8 { 1 } else { 2 };
    // Four written planes plus the record, name, id and VMAL headers.
    u32::try_from(texels.checked_mul(4 * sample_bytes)?.checked_add(1024)?).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(b"vision-pattern");
    hasher.update(pw.to_le_bytes());
    hasher.update(ph.to_le_bytes());
    hash_u16_samples(&mut hasher, &layer.smart_src);
    let hex: String = hasher.finalize()[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let id = format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    );
    Some((pw, ph, id))
}

/// The keys Photoshop files document pattern records under, by depth.
pub(super) const PHOTOSHOP_PATTERN_KEYS: [[u8; 4]; 3] = [*b"Patt", *b"Pat2", *b"Pat3"];

/// Document-level Photoshop blocks a document keeps for its next save: Smart
/// Object sources and pattern records.
pub(super) const PSD_DOCUMENT_BLOCK_KEYS: [[u8; 4]; 7] =
    [*b"lnk2", *b"lnkD", *b"lnk3", *b"lnkE", *b"Patt", *b"Pat2", *b"Pat3"];

/// A pattern record's id: the Pascal string after its length, version, image
/// mode, origin and Unicode name.
fn photoshop_pattern_record_id(record: &[u8]) -> Option<&[u8]> {
    let name_units = u32::from_be_bytes(record.get(16..20)?.try_into().ok()?) as usize;
    let at = name_units.checked_mul(2)?.checked_add(20)?;
    let len = usize::from(*record.get(at)?);
    record.get(at + 1..at + 1 + len)
}

/// The document-level pattern block every exported `PtFl` resolves against,
/// keyed by document depth as Photoshop keys it (`Patt`, `Pat2`, `Pat3`).
/// First the opened file's records that a `written` layer block still names by
/// id (a kept `PtFl`, a pattern overlay or stroke), byte for byte; then one
/// record per distinct Vision pattern fill tile not already among them: 8-bit
/// samples in an 8-bit document and 16-bit otherwise, R/G/B in the first
/// colour slots and alpha in the trailing sheet-mask slot, where Photoshop's
/// own patterns keep transparency.
///
/// ponytail: samples are written raw; RLE them if tile-sized patterns make
/// exported files too large.
pub(super) fn photoshop_patterns_block(
    layers: &[Layer],
    imported: &[PsdTaggedBlock],
    written: &[&[u8]],
    depth: u8,
) -> Option<PsdTaggedBlock> {
    fn push_u32s(out: &mut Vec<u8>, values: &[u32]) {
        for value in values {
            out.extend_from_slice(&value.to_be_bytes());
        }
    }
    fn patch_len(out: &mut [u8], at: usize) {
        let len = (out.len() - at - 4) as u32; // bounded by photoshop_pattern_tile
        out[at..at + 4].copy_from_slice(&len.to_be_bytes());
    }

    let sample_depth: u32 = if depth == 8 { 8 } else { 16 };
    let mut ids = HashSet::new();
    let mut data = Vec::new();
    // A descriptor names a pattern by its id as UTF-16 text.
    let named = |id: &[u8]| {
        let needle: Vec<u8> = id.iter().flat_map(|&byte| [0, byte]).collect();
        !needle.is_empty()
            && written.iter().any(|block| block.windows(needle.len()).any(|at| at == needle))
    };
    for block in imported.iter().filter(|block| PHOTOSHOP_PATTERN_KEYS.contains(&block.key)) {
        let mut at = 0;
        while let Some(len) = block.data.get(at..at + 4) {
            let end = (at + 4).saturating_add(u32::from_be_bytes(len.try_into().unwrap()) as usize);
            let Some(record) = block.data.get(at..end) else {
                break; // a damaged tail: the records before it still travel
            };
            if let Some(id) = photoshop_pattern_record_id(record) {
                if named(id) && ids.insert(String::from_utf8_lossy(id).into_owned()) {
                    data.extend_from_slice(record);
                    data.resize(data.len().next_multiple_of(4), 0);
                }
            }
            at = end.next_multiple_of(4);
        }
    }
    for layer in layers {
        // Only a layer whose blocks are synthesized here exports a `PtFl`.
        if has_psd_raster_proxy_blocks(layer) {
            continue;
        }
        let Some((pw, ph, id)) = photoshop_pattern_tile(layer, depth) else {
            continue;
        };
        if !ids.insert(id.clone()) {
            continue;
        }
        let record = data.len();
        push_u32s(&mut data, &[0, 1, 3]); // length (patched), version, RGB
        data.extend_from_slice(&[0; 4]); // origin point
        let name: Vec<u16> = PHOTOSHOP_PATTERN_NAME.encode_utf16().chain([0]).collect();
        push_u32s(&mut data, &[name.len() as u32]);
        for unit in name {
            data.extend_from_slice(&unit.to_be_bytes());
        }
        data.push(id.len() as u8);
        data.extend_from_slice(id.as_bytes());
        push_u32s(&mut data, &[3, 0]); // VMAL version, length (patched)
        let vmal = data.len() - 4;
        push_u32s(&mut data, &[0, 0, ph, pw, 24]);
        let channel_len = 23 + pw * ph * (sample_depth / 8);
        for slot in 0..26 {
            let channel = match slot {
                0..=2 => slot,
                25 => 3,
                _ => {
                    push_u32s(&mut data, &[0]);
                    continue;
                }
            };
            push_u32s(&mut data, &[1, channel_len, sample_depth, 0, 0, ph, pw]);
            data.extend_from_slice(&(sample_depth as u16).to_be_bytes());
            data.push(0); // raw
            for texel in layer.smart_src.chunks_exact(4) {
                if depth == 8 {
                    // The PSD plane writer's rounding back onto the 8-bit grid.
                    data.push(((u32::from(texel[channel]) + 128) / 257) as u8);
                } else {
                    data.extend_from_slice(&texel[channel].to_be_bytes());
                }
            }
        }
        patch_len(&mut data, vmal);
        patch_len(&mut data, record);
        data.resize(data.len().next_multiple_of(4), 0);
    }
    (!data.is_empty()).then(|| PsdTaggedBlock {
        key: match depth {
            8 => *b"Patt",
            16 => *b"Pat2",
            _ => *b"Pat3",
        },
        data,
    })
}

/// Scene world space → document pixel space: `Engine::vector_view_transform`
/// (rotate about the canvas centre · translate · scale) with the layer's live
/// move offset baked in, so the outline lands where the rendered plane does.
fn vector_export_matrix(
    layer: &Layer,
    document_width: u32,
    document_height: u32,
) -> crate::vector::model::Matrix {
    use crate::vector::geom::{m_mul, m_rotation, m_scaling, m_translation};
    let [tx, ty, zoom, angle] = layer.vector_view;
    let cx = document_width as f32 / 2.0;
    let cy = document_height as f32 / 2.0;
    let mut m = m_translation(layer.ox as f32, layer.oy as f32);
    if angle != 0.0 {
        m = m_mul(m, m_translation(cx, cy));
        m = m_mul(m, m_rotation(angle));
        m = m_mul(m, m_translation(-cx, -cy));
    }
    m = m_mul(m, m_translation(tx, ty));
    m_mul(m, m_scaling(zoom, zoom))
}

fn solid_shape_from_scene(
    scene: &crate::vector::VectorScene,
    view: crate::vector::model::Matrix,
) -> Option<(Vec<crate::vector::model::PathGeometry>, [f32; 3])> {
    let mut shape = SolidShape {
        subpaths: Vec::new(),
        fill: None,
    };
    for layer in &scene.layers {
        if !layer.visible || layer.template {
            continue;
        }
        if layer.opacity.clamp(0.0, 1.0) != 1.0 || layer.blend_mode != "normal" {
            return None;
        }
        collect_solid_items(&layer.items, view, &mut shape)?;
    }
    if shape.subpaths.is_empty() {
        return None;
    }
    Some((shape.subpaths, shape.fill?))
}

fn collect_solid_items(
    items: &[crate::vector::model::Item],
    transform: crate::vector::model::Matrix,
    shape: &mut SolidShape,
) -> Option<()> {
    use crate::vector::model::Paint;
    for item in items {
        if !item.visible {
            continue;
        }
        let stroked = !matches!(item.stroke.paint, Paint::None) && item.stroke.width > 0.0;
        if item.opacity.clamp(0.0, 1.0) != 1.0
            || item.even_odd
            || item.blend_mode != "normal"
            || stroked
            || !item.effects.is_empty()
            || item.mask.is_some()
        {
            return None;
        }
        let local = crate::vector::geom::m_mul(transform, item.transform);
        if item.kind == "group" {
            if item.clip {
                return None;
            }
            collect_solid_items(item.children.as_deref().unwrap_or(&[]), local, shape)?;
            continue;
        }
        let Paint::Solid { color } = &item.fill else {
            return None;
        };
        if color.a.clamp(0.0, 1.0) != 1.0 {
            return None;
        }
        let rgb = [
            (color.r / 255.0).clamp(0.0, 1.0),
            (color.g / 255.0).clamp(0.0, 1.0),
            (color.b / 255.0).clamp(0.0, 1.0),
        ];
        match shape.fill {
            Some(existing) if existing != rgb => return None,
            Some(_) => {}
            None => shape.fill = Some(rgb),
        }
        // Text, images and unknown item types have no outline Photoshop could
        // own; exporting the rest of the scene without them would drop content.
        let paths = crate::vector::shapes::local_paths(item);
        if paths.is_empty() {
            return None;
        }
        for path in &paths {
            shape
                .subpaths
                .push(crate::vector::geom::transform_geometry(path, local));
        }
    }
    Some(())
}

/// Photoshop stores path coordinates as signed 8.24 fixed point, normalized by
/// the document extent. Saturating float→int casts keep a wild coordinate from
/// wrapping into a valid-looking one.
fn push_path_fixed(out: &mut Vec<u8>, value: f32) {
    out.extend_from_slice(&(((value * 16_777_216.0).round()) as i32).to_be_bytes());
}

fn encode_vector_mask(
    subpaths: &[crate::vector::model::PathGeometry],
    width: f32,
    height: f32,
) -> Option<Vec<u8>> {
    let records = 1 + subpaths
        .iter()
        .map(|path| 1 + path.anchors.len())
        .sum::<usize>();
    if records > MAX_SYNTHESIZED_PATH_RECORDS {
        return None;
    }
    let mut out = Vec::with_capacity(8 + records * 26);
    out.extend_from_slice(&3u32.to_be_bytes()); // vector mask version
    out.extend_from_slice(&0u32.to_be_bytes()); // not inverted, linked, enabled
    // Operation 1 is "combine": Vision fills separate items as a union, and
    // 0 would read back as "exclude overlapping shapes".
    push_path_records(&mut out, subpaths, width, height, 1);
    // Photoshop counts a layer block's padding in its length; an odd record
    // count would otherwise hide the next block from readers that trust it.
    out.resize(out.len().next_multiple_of(4), 0);
    Some(out)
}

/// The path records `vmsk` and the document path resources (2000-2997) share:
/// a fill-rule record, then each subpath's length record, carrying `operation`,
/// and knots. Callers keep each subpath within the u16 knot count.
pub(crate) fn push_path_records(
    out: &mut Vec<u8>,
    subpaths: &[crate::vector::model::PathGeometry],
    width: f32,
    height: f32,
    operation: u16,
) {
    out.extend_from_slice(&6u16.to_be_bytes()); // path fill rule record
    out.extend_from_slice(&[0u8; 24]);
    for path in subpaths {
        // Handles stay independent, so the knots are the unlinked selectors —
        // "linked" would claim a mirror symmetry the scene never promised.
        let (length_record, knot_record) = if path.closed { (0u16, 2u16) } else { (3u16, 5u16) };
        out.extend_from_slice(&length_record.to_be_bytes());
        out.extend_from_slice(&(path.anchors.len() as u16).to_be_bytes());
        out.extend_from_slice(&operation.to_be_bytes());
        out.extend_from_slice(&2u16.to_be_bytes()); // non-zero winding; 1 is even-odd
        out.extend_from_slice(&[0u8; 18]);
        for anchor in &path.anchors {
            out.extend_from_slice(&knot_record.to_be_bytes());
            // Preceding control, anchor, leaving control — vertical before
            // horizontal, handles relative to their anchor.
            for point in [
                crate::vector::geom::add(anchor.point, anchor.handle_in),
                anchor.point,
                crate::vector::geom::add(anchor.point, anchor.handle_out),
            ] {
                push_path_fixed(out, point.y / height);
                push_path_fixed(out, point.x / width);
            }
        }
    }
}

/// ponytail: the descriptor writer that belongs under this lives in
/// monet-format's `psd_semantics`, but it is crate-private and only
/// `reconcile_psd_layer_blocks` is exported. Fifteen lines of literal bytes beat
/// widening that crate's public surface; move here if a second site needs one.
fn encode_solid_color_fill(fill: [f32; 3]) -> Vec<u8> {
    fn descriptor_head(out: &mut Vec<u8>, class_id: &[u8; 4], items: u32) {
        out.extend_from_slice(&0u32.to_be_bytes()); // empty unicode name
        out.extend_from_slice(&0u32.to_be_bytes()); // 4-byte key form
        out.extend_from_slice(class_id);
        out.extend_from_slice(&items.to_be_bytes());
    }
    fn descriptor_key(out: &mut Vec<u8>, key: &[u8; 4]) {
        out.extend_from_slice(&0u32.to_be_bytes());
        out.extend_from_slice(key);
    }

    let mut out = Vec::with_capacity(96);
    out.extend_from_slice(&16u32.to_be_bytes()); // descriptor version
    descriptor_head(&mut out, b"null", 1);
    descriptor_key(&mut out, b"Clr ");
    out.extend_from_slice(b"Objc");
    descriptor_head(&mut out, b"RGBC", 3);
    for (key, channel) in [
        (b"Rd  ", fill[0]),
        (b"Grn ", fill[1]),
        (b"Bl  ", fill[2]),
    ] {
        descriptor_key(&mut out, key);
        out.extend_from_slice(b"doub");
        out.extend_from_slice(&(f64::from(channel) * 255.0).to_be_bytes());
    }
    out
}

/// Build a fresh Engine from a parsed document.
pub(crate) fn from_doc(mut doc: Document) -> Engine {
    let photoshop_source = matches!(doc.source, SourceFormat::Psd | SourceFormat::Psb);
    let psd_linked_blocks = std::mem::take(&mut doc.psd_linked_blocks);
    let document_channels = std::mem::take(&mut doc.channels);
    let psd_paths = std::mem::take(&mut doc.paths);
    let psd_duotone = std::mem::take(&mut doc.duotone);
    let psd_duotone_alternates = std::mem::take(&mut doc.duotone_alternates);
    let cw = doc.width.max(1);
    let ch = doc.height.max(1);
    let mut e = Engine::new(cw, ch);
    e.layers.clear();

    let mut max_id = 0u32;
    for l in &doc.layers {
        max_id = max_id.max(l.id);
        let is_group = l.kind == LayerKind::Group;

        // Ordinary raster layers retain their exact local plane, including
        // negative/off-canvas bounds. Editable proxy kinds still use the legacy
        // document-sized plane until their renderers carry independent source
        // bounds (notably Smart Objects).
        let mut layer = Layer::transparent(l.id, &l.name, cw, ch);
        if l.kind == LayerKind::Raster {
            layer.pixel_bounds = l.bounds;
            layer.pixels = Arc::from(Vec::<u16>::new());
            layer.pixels_f32 = Arc::from(Vec::<f32>::new());
            if let Some(sample_len) = super::checked_plane_len(l.bounds, 4) {
                if !l.rgba32.is_empty() && l.rgba32.len() == sample_len {
                    layer.pixels_f32 = l.rgba32.clone().into();
                    layer.pixels = float_preview(&l.rgba32).into();
                } else if !l.rgba16.is_empty() && l.rgba16.len() == sample_len {
                    layer.pixels = l.rgba16.clone().into();
                } else if !l.rgba.is_empty() && l.rgba.len() == sample_len {
                    layer.pixels = widen_rgba8(&l.rgba).into();
                }
            }
        } else if !is_group {
            if !l.rgba32.is_empty() {
                layer.pixels_f32 = vec![0.0; layer.pixels.len()].into();
                place_pixels_f32(
                    Arc::make_mut(&mut layer.pixels),
                    Arc::make_mut(&mut layer.pixels_f32),
                    &l.rgba32,
                    l.bounds.x,
                    l.bounds.y,
                    l.bounds.w,
                    l.bounds.h,
                    cw,
                    ch,
                );
            } else if !l.rgba16.is_empty() {
                place_pixels_u16(
                    Arc::make_mut(&mut layer.pixels),
                    &l.rgba16,
                    l.bounds.x,
                    l.bounds.y,
                    l.bounds.w,
                    l.bounds.h,
                    cw,
                    ch,
                );
            } else if !l.rgba.is_empty() {
                place_pixels(
                    Arc::make_mut(&mut layer.pixels),
                    &l.rgba,
                    l.bounds.x,
                    l.bounds.y,
                    l.bounds.w,
                    l.bounds.h,
                    cw,
                    ch,
                );
            }
        }

        layer.visible = l.visible;
        layer.opacity = l.opacity.clamp(0.0, 1.0);
        layer.blend = BlendMode::from_u8(l.blend.to_index());
        // PSD/XCF groups distinguish "pass" from an isolated "norm" group; the
        // engine models that as a distinct PassThrough mode (groups only).
        if is_group && l.pass_through {
            layer.blend = BlendMode::PassThrough;
        }
        layer.locked = l.locked;
        layer.lock_transparent = l.lock_transparent;
        layer.lock_image = l.lock_image;
        layer.lock_position = l.lock_position;
        layer.blend_channels = l.blend_channels;
        layer.transparency_shapes = l.transparency_shapes;
        layer.blend_interior_group = l.blend_interior_group;
        layer.blend_clipped_group = l.blend_clipped_group;
        layer.clipping = l.clipping;
        layer.group = l.parent.unwrap_or(0);
        layer.fill_opacity = l.fill_opacity.clamp(0.0, 1.0);
        layer.knockout = l.knockout;
        if let Some(bi) = l.blend_if {
            layer.blend_if = bi.to_vec();
        }
        layer.effects = map_effects(&l.effects);
        layer.psd_smart_blocks = l.psd_smart_blocks.clone();

        // Mask → full-canvas coverage plane. Disabled masks stay editable and
        // are merely bypassed by the compositor; keep the compact PSD source
        // so offset/out-of-canvas bytes can be exported exactly.
        if let Some(m) = &l.mask {
            layer.mask = place_mask(m, cw, ch).into();
            layer.mask_enabled = !m.disabled;
            layer.mask_linked = m.relative;
            layer.psd_mask = Some(m.clone());
        }

        match l.kind {
            LayerKind::Group => {
                layer.kind = 6;
            }
            LayerKind::Adjustment => {
                layer.kind = 1;
                let (k, p) = l
                    .adjustment
                    .as_ref()
                    .map(map_adjustment)
                    .unwrap_or((0, Vec::new()));
                layer.adj_kind = k;
                layer.adj_params = p;
            }
            LayerKind::Text => {
                layer.kind = 2;
                if let Some(t) = &l.text {
                    apply_text(&mut layer, t);
                }
            }
            LayerKind::Raster => {
                layer.kind = 0;
            }
            // PSD/PSB only exposes the rendered layer proxy here, not the
            // embedded source document. Keep that proxy as the Smart Object's
            // source so the existing non-destructive lifecycle remains usable
            // instead of silently downgrading the layer to ordinary pixels.
            LayerKind::SmartObject => {
                layer.kind = 7;
                layer.set_smart_src(layer.pixels.clone());
                layer.smart_src_f32 = layer.pixels_f32.clone().into();
            }
        }

        e.layers.push(layer);
    }

    if e.layers.is_empty() {
        // Degenerate import: keep a usable empty document.
        e.layers.push(Layer::transparent(1, "Background", cw, ch));
        max_id = 1;
    }
    e.next_id = max_id + 1;
    e.psd_linked_blocks = psd_linked_blocks;
    if photoshop_source {
        link_embedded_photoshop_documents(&mut e);
    }
    e.document_channels = document_channels;
    e.psd_paths = super::sanitize_psd_paths(psd_paths.into_iter().map(|path| super::PsdPath {
        name: path.name,
        anchors: path.anchors,
        contours: path.contours,
        clip: path.clip_flatness,
    }));
    e.psd_paths_skipped = doc.skipped_paths;
    if doc.skipped_patterns {
        if !e.last_edit_error.is_empty() {
            e.last_edit_error.push('\n');
        }
        e.last_edit_error.push_str(
            "This file's pattern records are too large to keep, so it opened without them. Its pattern fills and overlays show as they were saved, but a Photoshop file saved from it cannot carry their patterns.",
        );
    }
    e.psd_duotone = psd_duotone;
    e.psd_duotone_alternates = psd_duotone_alternates;
    e.active = e.layers.len() - 1; // top layer active
    e.depth = match doc.depth {
        16 => 16,
        32 => 32,
        _ => 8,
    };
    e.mode = match doc.color_mode {
        // A duotone document is its gray plate; the inks ride in `psd_duotone`.
        monet_format::import::ColorMode::Grayscale | monet_format::import::ColorMode::Duotone => 1,
        monet_format::import::ColorMode::Cmyk => 2,
        monet_format::import::ColorMode::Lab => 3,
        monet_format::import::ColorMode::Multichannel => 4,
        _ => 0,
    };
    if photoshop_source && e.mode == 0 {
        for layer in e.layers.iter_mut().filter(|layer| layer.kind == 0) {
            let installed = match monet_format::import::decode_psd_solid_shape(&layer.psd_smart_blocks, cw, ch) {
                Ok(Some(shape)) => install_psd_solid_shape(layer, &shape),
                Ok(None) => Ok(()),
                Err(error) => Err(error.to_string()),
            };
            if let Err(error) = installed {
                if !e.last_edit_error.is_empty() {
                    e.last_edit_error.push('\n');
                }
                e.last_edit_error.push_str(&format!(
                    "Layer \"{}\": its shape outline could not be read ({error}), so it opened as pixels. The original shape data is kept for PSD export until the layer is edited.",
                    layer.name
                ));
            }
        }
        for layer in &mut e.layers {
            layer.psd_raster_proxy_baseline =
                psd_raster_proxy_fingerprint(layer, cw, ch, e.depth);
        }
        clear_duplicate_psd_raster_proxy_baselines(&mut e.layers);
    }
    e.composite();
    e
}

/// A Smart Object whose embedded source is itself a PSD/PSB keeps where that
/// document sits, so Edit Contents can open its layers (#460); the document
/// is decoded then, not here. Layers placing the same source share one
/// instance id, so an edit to one updates them all. Other embedded sources
/// (PNG, JPEG, PDF, …) and linked files keep the flat rendered source.
fn link_embedded_photoshop_documents(e: &mut Engine) {
    let mut sources: Vec<(String, u32)> = Vec::new();
    for layer in e.layers.iter_mut().filter(|layer| layer.kind == 7) {
        let Some(placed) = monet_format::import::psd_placed_layer(&layer.psd_smart_blocks) else {
            continue;
        };
        let Some(size) = monet_format::import::psd_embedded_file(&e.psd_linked_blocks, &placed.id)
            .and_then(super::photoshop_document_size)
        else {
            continue;
        };
        layer.smart_source_id = match sources.iter().find(|(id, _)| *id == placed.id) {
            Some(&(_, source)) => source,
            None => {
                sources.push((placed.id.clone(), e.next_id));
                e.next_id += 1;
                e.next_id - 1
            }
        };
        layer.smart_link = Some(super::SmartLink {
            id: placed.id,
            size,
            corners: placed.corners,
        });
    }
}

/// Make a decoded Photoshop solid shape the vector layer Vision edits: one
/// filled path item per subpath, already in document pixels (a fresh layer's
/// view is the identity). The import's closing composite renders the plane.
/// Only the shape's own proxy blocks go; export regenerates them from the scene.
fn install_psd_solid_shape(
    layer: &mut Layer,
    shape: &monet_format::import::PsdSolidShape,
) -> Result<(), String> {
    let point = |x: f32, y: f32| serde_json::json!({ "x": x, "y": y });
    let channel = |value: f32| value.clamp(0.0, 1.0) * 255.0;
    let fill = serde_json::json!({
        "type": "solid",
        "color": { "r": channel(shape.color.r), "g": channel(shape.color.g), "b": channel(shape.color.b), "a": 1 },
    });
    let items: Vec<Value> = shape
        .subpaths
        .iter()
        .enumerate()
        .map(|(index, subpath)| {
            let anchors: Vec<Value> = subpath
                .knots
                .iter()
                .map(|&[in_x, in_y, x, y, out_x, out_y]| {
                    serde_json::json!({
                        "point": point(x, y),
                        "handleIn": point(in_x - x, in_y - y),
                        "handleOut": point(out_x - x, out_y - y),
                    })
                })
                .collect();
            serde_json::json!({
                "type": "path",
                "id": format!("psd-shape-{}", index + 1),
                "geometry": { "closed": subpath.closed, "anchors": anchors },
                "fill": fill,
            })
        })
        .collect();
    let scene = serde_json::from_value::<crate::vector::model::Document>(
        serde_json::json!({ "layers": [{ "items": items }] }),
    )
    .map_err(|error| error.to_string())?;
    layer.kind = 3;
    layer.vector_scene = Some(Box::new(scene));
    layer
        .psd_smart_blocks
        .retain(|block| !PSD_RASTER_PROXY_KEYS.contains(&block.key));
    Ok(())
}

fn widen_rgba8(src: &[u8]) -> Vec<u16> {
    src.iter().copied().map(color::u8_to_16).collect()
}

fn float_preview(src: &[f32]) -> Vec<u16> {
    src.iter()
        .map(|sample| (sample.clamp(0.0, 1.0) * 65_535.0 + 0.5) as u16)
        .collect()
}

/// Place layer-local 8-bit RGBA into a full-canvas u16 buffer at (bx, by).
fn place_pixels(
    dst: &mut [u16],
    rgba8: &[u8],
    bx: i32,
    by: i32,
    bw: u32,
    bh: u32,
    cw: u32,
    ch: u32,
) {
    let (cw, ch) = (cw as i32, ch as i32);
    for y in 0..bh as i32 {
        let cy = by + y;
        if cy < 0 || cy >= ch {
            continue;
        }
        for x in 0..bw as i32 {
            let cx = bx + x;
            if cx < 0 || cx >= cw {
                continue;
            }
            let si = ((y * bw as i32 + x) * 4) as usize;
            let di = ((cy * cw + cx) * 4) as usize;
            if si + 4 <= rgba8.len() && di + 4 <= dst.len() {
                for k in 0..4 {
                    dst[di + k] = color::u8_to_16(rgba8[si + k]);
                }
            }
        }
    }
}

/// Place layer-local native-u16 RGBA into a full-canvas u16 buffer at (bx, by).
/// Unlike `place_pixels`, this is a straight copy with NO ×257 widen — the values
/// already ARE the engine's u16 store, so >8-bit precision is preserved exactly.
fn place_pixels_u16(
    dst: &mut [u16],
    src: &[u16],
    bx: i32,
    by: i32,
    bw: u32,
    bh: u32,
    cw: u32,
    ch: u32,
) {
    let (cw, ch) = (cw as i32, ch as i32);
    for y in 0..bh as i32 {
        let cy = by + y;
        if cy < 0 || cy >= ch {
            continue;
        }
        for x in 0..bw as i32 {
            let cx = bx + x;
            if cx < 0 || cx >= cw {
                continue;
            }
            let si = ((y * bw as i32 + x) * 4) as usize;
            let di = ((cy * cw + cx) * 4) as usize;
            if si + 4 <= src.len() && di + 4 <= dst.len() {
                dst[di..di + 4].copy_from_slice(&src[si..si + 4]);
            }
        }
    }
}

/// Place native float authority and its clamped u16 display proxy together.
fn place_pixels_f32(
    preview: &mut [u16],
    dst: &mut [f32],
    src: &[f32],
    bx: i32,
    by: i32,
    bw: u32,
    bh: u32,
    cw: u32,
    ch: u32,
) {
    let (cw, ch) = (cw as i32, ch as i32);
    for y in 0..bh as i32 {
        let cy = by + y;
        if cy < 0 || cy >= ch {
            continue;
        }
        for x in 0..bw as i32 {
            let cx = bx + x;
            if cx < 0 || cx >= cw {
                continue;
            }
            let si = ((y * bw as i32 + x) * 4) as usize;
            let di = ((cy * cw + cx) * 4) as usize;
            if si + 4 <= src.len() && di + 4 <= dst.len() && di + 4 <= preview.len() {
                dst[di..di + 4].copy_from_slice(&src[si..si + 4]);
                for channel in 0..4 {
                    preview[di + channel] =
                        (src[si + channel].clamp(0.0, 1.0) * 65_535.0 + 0.5) as u16;
                }
            }
        }
    }
}

/// Expand a layer-local mask into a full-canvas coverage plane.
fn place_mask(m: &Mask, cw: u32, ch: u32) -> Vec<u8> {
    super::expand_import_mask(m, cw, ch).unwrap_or_default()
}

fn map_adjustment(a: &Adjustment) -> (u8, Vec<f32>) {
    match a {
        Adjustment::BrightnessContrast {
            brightness,
            contrast,
        } => (0, vec![*brightness, *contrast]),
        Adjustment::Levels {
            in_black,
            in_white,
            gamma,
            out_black,
            out_white,
        } => (
            1,
            vec![*in_black, *in_white, *gamma, *out_black, *out_white],
        ),
        Adjustment::HueSaturation {
            hue,
            saturation,
            lightness,
        } => (2, vec![*hue, *saturation, *lightness]),
        Adjustment::HueSaturationFull {
            hue,
            saturation,
            lightness,
            colorize,
            ranges,
        } => {
            let mut params = Vec::with_capacity(22);
            params.extend_from_slice(&[*hue, *saturation, *lightness]);
            params.push(f32::from(*colorize));
            for range in ranges {
                params.extend_from_slice(range);
            }
            (2, params)
        }
        Adjustment::Vibrance {
            vibrance,
            saturation,
        } => (3, vec![*vibrance, *saturation]),
        Adjustment::Invert => (4, Vec::new()),
        Adjustment::Desaturate => (5, Vec::new()),
        Adjustment::BlackWhite { r, g, b } => (6, vec![*r, *g, *b]),
        Adjustment::BlackWhiteFull {
            bands,
            tint,
            tint_hue,
            tint_saturation,
        } => {
            let mut params = vec![1.0, 0.0, 0.0];
            params.extend_from_slice(bands);
            params.extend_from_slice(&[
                f32::from(*tint),
                *tint_hue,
                *tint_saturation,
            ]);
            (6, params)
        }
        Adjustment::Posterize { levels } => (7, vec![*levels]),
        Adjustment::Threshold { level } => (8, vec![*level]),
        Adjustment::Exposure {
            exposure,
            offset,
            gamma,
        } => (9, vec![*exposure, *offset, *gamma]),
        Adjustment::ColorBalance {
            shadows,
            midtones,
            highlights,
        } => (
            10,
            vec![
                shadows[0],
                shadows[1],
                shadows[2],
                midtones[0],
                midtones[1],
                midtones[2],
                highlights[0],
                highlights[1],
                highlights[2],
            ],
        ),
        Adjustment::PhotoFilter { color, density } => {
            (11, vec![color.r, color.g, color.b, *density])
        }
        Adjustment::Curves { lut } => (12, lut.clone()),
        Adjustment::GradientMap { lut } => (13, lut.clone()),
    }
}

fn bf(b: monet_format::import::BlendMode) -> f32 {
    b.to_index() as f32
}
fn col(c: &Color3) -> [f32; 3] {
    [c.r, c.g, c.b]
}

/// Translate IR effects into the engine's `(effect_id, params)` form. Each
/// param vector starts with the enabled flag (1.0); see `engine/src/effects.rs`.
fn map_effects(effects: &[Effect]) -> Vec<(u8, Vec<f32>)> {
    effects
        .iter()
        .map(|e| match e {
            Effect::DropShadow {
                blend,
                opacity,
                color,
                angle,
                distance,
                spread,
                size,
            } => {
                let c = col(color);
                (
                    0,
                    vec![
                        1.0,
                        bf(*blend),
                        *opacity,
                        c[0],
                        c[1],
                        c[2],
                        *angle,
                        *distance,
                        *spread,
                        *size,
                    ],
                )
            }
            Effect::InnerShadow {
                blend,
                opacity,
                color,
                angle,
                distance,
                choke,
                size,
            } => {
                let c = col(color);
                (
                    1,
                    vec![
                        1.0,
                        bf(*blend),
                        *opacity,
                        c[0],
                        c[1],
                        c[2],
                        *angle,
                        *distance,
                        *choke,
                        *size,
                    ],
                )
            }
            Effect::OuterGlow {
                blend,
                opacity,
                color,
                spread,
                size,
            } => {
                let c = col(color);
                (
                    2,
                    vec![1.0, bf(*blend), *opacity, c[0], c[1], c[2], *spread, *size],
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
                let c = col(color);
                (
                    3,
                    vec![
                        1.0,
                        bf(*blend),
                        *opacity,
                        c[0],
                        c[1],
                        c[2],
                        *choke,
                        *size,
                        if *center { 1.0 } else { 0.0 },
                    ],
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
                let h = col(hl_color);
                let s = col(sh_color);
                (
                    4,
                    vec![
                        1.0,
                        bf(*hl_blend),
                        *hl_opacity,
                        h[0],
                        h[1],
                        h[2],
                        bf(*sh_blend),
                        *sh_opacity,
                        s[0],
                        s[1],
                        s[2],
                        *angle,
                        *altitude,
                        *depth,
                        *size,
                        *soften,
                        *style as f32,
                    ],
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
                let c = col(color);
                (
                    5,
                    vec![
                        1.0,
                        bf(*blend),
                        *opacity,
                        c[0],
                        c[1],
                        c[2],
                        *angle,
                        *distance,
                        *size,
                        if *invert { 1.0 } else { 0.0 },
                    ],
                )
            }
            Effect::ColorOverlay {
                blend,
                opacity,
                color,
            } => {
                let c = col(color);
                (6, vec![1.0, bf(*blend), *opacity, c[0], c[1], c[2]])
            }
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
                let s = col(start);
                let en = col(end);
                (
                    7,
                    vec![
                        1.0,
                        bf(*blend),
                        *opacity,
                        *angle,
                        *scale,
                        if *radial { 1.0 } else { 0.0 },
                        if *reverse { 1.0 } else { 0.0 },
                        s[0],
                        s[1],
                        s[2],
                        en[0],
                        en[1],
                        en[2],
                    ],
                )
            }
            Effect::PatternOverlay {
                blend,
                opacity,
                scale,
                kind,
            } => (8, vec![1.0, bf(*blend), *opacity, *scale, *kind as f32]),
            Effect::Stroke {
                blend,
                opacity,
                color,
                size,
                position,
            } => {
                let c = col(color);
                (
                    9,
                    vec![
                        1.0,
                        bf(*blend),
                        *opacity,
                        c[0],
                        c[1],
                        c[2],
                        *size,
                        *position as f32,
                    ],
                )
            }
            Effect::Disabled(inner) => {
                let (id, mut params) = map_effects(std::slice::from_ref(inner.as_ref()))
                    .into_iter()
                    .next()
                    .expect("one effect maps to one entry");
                if let Some(enabled) = params.first_mut() {
                    *enabled = 0.0;
                }
                (id, params)
            }
        })
        .collect()
}

const WARP_NAMES: [&str; 16] = [
    "none",
    "arc",
    "arcLower",
    "arcUpper",
    "arch",
    "bulge",
    "shellLower",
    "shellUpper",
    "flag",
    "wave",
    "fish",
    "rise",
    "fisheye",
    "inflate",
    "squeeze",
    "twist",
];
const ANTIALIAS_NAMES: [&str; 5] = ["none", "sharp", "crisp", "strong", "smooth"];

/// Populate the engine's legacy text fields + a re-editable `text_spec` JSON
/// (matching `src/text/spec.ts`) from the IR text.
fn apply_text(layer: &mut Layer, t: &Text) {
    layer.text = t.string.clone();
    layer.text_size = if t.size > 0.0 { t.size } else { 48.0 };
    layer.text_color = t.color;
    layer.text_x = t.origin.0;
    layer.text_y = t.origin.1;
    layer.text_spec = build_text_spec(t);
}

fn build_text_spec(t: &Text) -> String {
    let warp = WARP_NAMES
        .get(t.warp_style as usize)
        .copied()
        .unwrap_or("none");
    let aa = ANTIALIAS_NAMES
        .get(t.antialias as usize)
        .copied()
        .unwrap_or("sharp");
    let align = match t.align {
        1 => "right",
        2 => "center",
        3 => "justify",
        4 => "justifyAll",
        _ => "left",
    };
    let font = t.font.clone().unwrap_or_else(|| "sans-serif".to_string());
    let size = if t.size > 0.0 { t.size } else { 48.0 };
    let [r, g, b, a] = t.color;
    let (bw, bh) = t.box_size.unwrap_or((0.0, 0.0));
    let kind = if t.point { "point" } else { "paragraph" };
    let orient = if t.vertical { "v" } else { "h" };
    let runs = text_runs_json(t);

    format!(
        concat!(
            "{{\"v\":1,\"kind\":\"{kind}\",\"vertical\":{vertical},\"ax\":{ax},\"ay\":{ay},",
            "\"runs\":{runs},",
            "\"font\":{font},\"size\":{size},\"color\":[{r},{g},{b},{a}],",
            "\"bold\":false,\"italic\":false,\"tracking\":{tracking},\"leading\":{leading},",
            "\"hScale\":1,\"vScale\":1,\"align\":\"{align}\",\"boxW\":{bw},\"boxH\":{bh},",
            "\"firstIndent\":0,\"leftIndent\":0,\"rightIndent\":0,\"spaceBefore\":0,\"spaceAfter\":0,",
            "\"antialias\":\"{aa}\",\"stroke\":null,\"shadow\":null,",
            "\"warp\":{{\"style\":\"{warp}\",\"bend\":{bend},\"h\":{wh},\"v\":{wv},\"orient\":\"{orient}\"}}}}"
        ),
        kind = kind,
        vertical = t.vertical,
        ax = t.origin.0,
        ay = t.origin.1,
        runs = runs,
        font = json_string(&font),
        size = fnum(size),
        r = r,
        g = g,
        b = b,
        a = a,
        tracking = fnum(t.tracking),
        leading = fnum(t.leading),
        align = align,
        bw = fnum(bw),
        bh = fnum(bh),
        aa = aa,
        warp = warp,
        bend = fnum(t.warp_bend),
        wh = fnum(t.warp_h),
        wv = fnum(t.warp_v),
        orient = orient,
    )
}

fn text_runs_json(t: &Text) -> String {
    if t.runs.is_empty() {
        return format!("[{{\"text\":{}}}]", json_string(&t.string));
    }
    let runs: Vec<Value> = t
        .runs
        .iter()
        .map(|run| {
            let mut value = serde_json::Map::new();
            value.insert("text".into(), Value::from(run.text.clone()));
            if let Some(font) = &run.font {
                value.insert("font".into(), Value::from(font.clone()));
            }
            if let Some(size) = run.size {
                value.insert("size".into(), finite_json_number(size));
            }
            if let Some(color) = run.color {
                value.insert(
                    "color".into(),
                    Value::Array(color.into_iter().map(Value::from).collect()),
                );
            }
            for (key, enabled) in [
                ("bold", run.bold),
                ("italic", run.italic),
                ("fauxBold", run.faux_bold),
                ("fauxItalic", run.faux_italic),
                ("underline", run.underline),
                ("strike", run.strike),
            ] {
                if enabled {
                    value.insert(key.into(), Value::Bool(true));
                }
            }
            for (key, number) in [
                ("tracking", run.tracking),
                ("hScale", run.h_scale),
                ("vScale", run.v_scale),
                ("baseline", run.baseline),
            ] {
                if let Some(number) = number {
                    value.insert(key.into(), finite_json_number(number));
                }
            }
            if let Some(caps) = run.caps {
                value.insert(
                    "caps".into(),
                    Value::from(match caps {
                        1 => "small",
                        2 => "all",
                        0 => "none",
                        _ => "unsupported",
                    }),
                );
            }
            Value::Object(value)
        })
        .collect();
    serde_json::to_string(&runs).unwrap_or_else(|_| "[]".to_string())
}

fn finite_json_number(value: f32) -> Value {
    if value.is_finite() {
        Value::from(value)
    } else {
        Value::from("non-finite")
    }
}

/// Finite float as JSON (no NaN/Inf, no scientific drift for our ranges).
fn fnum(v: f32) -> String {
    if v.is_finite() {
        let r = (v * 1000.0).round() / 1000.0;
        format!("{r}")
    } else {
        "0".to_string()
    }
}

/// Minimal JSON string escaping.
fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

// ─────────────────────────────────────────────────────────────
// Unified graphics document (monet_format::graphics::GfxDocument) ⇄ Engine.
// `from_gfx` reuses the import mapping above and adds the Vector kind; engine-
// native encodings (adjustment params, text spec, effects) round-trip losslessly
// through each GfxLayer's `extra` bag so the engine's own save→load is exact
// (design doc §8.7). See docs/merged-engine-and-format.md §8.
// ─────────────────────────────────────────────────────────────
use monet_format::graphics::{
    base64_decode, base64_encode, deflate_f32_le, deflate_u16_le, f32_plane_to_le_bytes,
    inflate_f32_le, inflate_u16_le, u16_plane_to_le_bytes, ChannelPixelRef, GfxDocument,
    GfxDocumentChannel, GfxLayer, GfxLayerKind, PixelRef, PSD_LINKED_BLOCKS_EXTRA,
    PSD_SMART_BLOCKS_EXTRA,
};
use serde_json::Value;

/// 16→8 bit with rounding — the exact inverse of `color::u8_to_16`'s ×257.
fn down16(v: u16) -> u8 {
    ((v as u32 * 255 + 32767) / 65535) as u8
}

/// Map an engine blend byte to the on-disk `import::BlendMode` + a PassThrough
/// flag (the engine's index 25 has no `import` variant — it is a group-only mode).
fn engine_blend_to_import(b: u8) -> (monet_format::import::BlendMode, bool) {
    if b == 25 {
        (monet_format::import::BlendMode::Normal, true)
    } else {
        (monet_format::import::BlendMode::from_index(b), false)
    }
}

/// Strict semantic projection used by the layered Photoshop writer.
///
/// Pixel planes remain owned by the writer. This adapter only reconstructs the
/// neutral layer semantics consumed by `reconcile_psd_layer_blocks`; anything
/// the neutral IR cannot express is rejected instead of being silently dropped.
#[cfg(test)]
pub(super) fn to_import_layer_for_photoshop(
    layer: &Layer,
    document_width: u32,
    document_height: u32,
    depth: u8,
) -> Result<monet_format::import::Layer, String> {
    to_import_layer_for_photoshop_with_id_status(
        layer,
        document_width,
        document_height,
        depth,
        true,
    )
}

pub(super) fn to_import_layer_for_photoshop_with_id_status(
    layer: &Layer,
    document_width: u32,
    document_height: u32,
    depth: u8,
    proxy_id_is_unique: bool,
) -> Result<monet_format::import::Layer, String> {
    let bounds = super::checked_translate_bounds(layer.pixel_bounds, layer.ox, layer.oy)
        .ok_or_else(|| semantic_layer_error(layer, "pixel bounds overflow after layer offset"))?;
    let (kind, adjustment, text) = match layer.kind {
        0 => (LayerKind::Raster, None, None),
        1 => {
            // Channel Mixer / Selective Color / Color Lookup have no neutral
            // adjustment variant, so they degrade to the writer-owned rendered
            // plane instead of failing the whole document (#510).
            if matches!(layer.adj_kind, 14 | 15 | 16) {
                (LayerKind::Raster, None, None)
            } else {
                (
                    LayerKind::Adjustment,
                    Some(unmap_adjustment(layer)?),
                    None,
                )
            }
        }
        2 => (
            LayerKind::Text,
            None,
            Some(unmap_text(layer)?),
        ),
        // Vector and fill layers have no corresponding neutral semantic kind.
        // Their rendered plane remains writer-owned while their bounded opaque
        // Adobe blocks survive on a raster semantic shell.
        3 | 4 => (LayerKind::Raster, None, None),
        6 => (LayerKind::Group, None, None),
        // A Smart Object only stays one on the Photoshop side when it still
        // carries the Adobe descriptor that names its source. Nothing Vision
        // converts or places locally has one, and neither does an imported one
        // whose blocks a transform dropped — so refusing here failed the WHOLE
        // export over a single layer. Fall back to the writer-owned rendered
        // plane instead, exactly as vector and fill layers already do: the
        // artwork survives, only the re-editable link is absent.
        7 => {
            if layer
                .psd_smart_blocks
                .iter()
                .any(|block| matches!(&block.key, b"SoLd" | b"SoLE" | b"PlLd"))
            {
                (LayerKind::SmartObject, None, None)
            } else {
                (LayerKind::Raster, None, None)
            }
        }
        other => {
            return Err(semantic_layer_error(
                layer,
                &format!("unsupported engine layer kind {other}"),
            ))
        }
    };

    validate_opaque_blocks(layer)?;
    let (blend, pass_through) = engine_blend_to_import(layer.blend.to_u8());
    if pass_through && kind != LayerKind::Group {
        return Err(semantic_layer_error(
            layer,
            "Pass Through blend mode belongs only to group layers",
        ));
    }
    let blend_if = match layer.blend_if.len() {
        0 => None,
        32 => {
            let mut values = [0.0; 32];
            values.copy_from_slice(&layer.blend_if);
            Some(values)
        }
        length => {
            return Err(semantic_layer_error(
                layer,
                &format!("blend-if payload has {length} values; expected 0 or 32"),
            ))
        }
    };
    let mask = checked_semantic_mask(layer, document_width, document_height)?;

    let mut output = monet_format::import::Layer::new(layer.id, &layer.name, kind, bounds);
    output.parent = (layer.group != 0).then_some(layer.group);
    output.opacity = layer.opacity;
    output.blend = blend;
    output.visible = layer.visible;
    output.clipping = layer.clipping;
    output.locked = layer.locked;
    output.lock_transparent = layer.lock_transparent;
    output.lock_image = layer.lock_image;
    output.lock_position = layer.lock_position;
    output.blend_channels = layer.blend_channels;
    output.transparency_shapes = layer.transparency_shapes;
    output.blend_interior_group = layer.blend_interior_group;
    output.blend_clipped_group = layer.blend_clipped_group;
    output.fill_opacity = layer.fill_opacity;
    output.knockout = layer.knockout;
    output.blend_if = blend_if;
    output.mask = mask.into();
    output.adjustment = adjustment;
    output.text = text;
    output.effects = unmap_effects(layer)?;
    output.pass_through = pass_through;
    output.psd_smart_blocks = photoshop_blocks_for_export(
        layer,
        document_width,
        document_height,
        depth,
        proxy_id_is_unique,
    )?;
    Ok(output)
}

fn semantic_layer_error(layer: &Layer, detail: &str) -> String {
    format!(
        "Photoshop semantic export cannot represent layer {} (\"{}\"): {detail}",
        layer.id, layer.name
    )
}

fn validate_opaque_blocks(layer: &Layer) -> Result<(), String> {
    if layer.psd_smart_blocks.len() > MAX_PSD_PRESERVED_BLOCKS {
        return Err(semantic_layer_error(
            layer,
            "preserved Photoshop block count exceeds the safety limit",
        ));
    }
    let mut bytes = 0usize;
    for block in &layer.psd_smart_blocks {
        if !PSD_PRESERVED_LAYER_KEYS.contains(&block.key) {
            return Err(semantic_layer_error(
                layer,
                &format!(
                    "preserved Photoshop block {:?} is outside the bounded allow-list",
                    String::from_utf8_lossy(&block.key)
                ),
            ));
        }
        bytes = bytes.checked_add(block.data.len()).ok_or_else(|| {
            semantic_layer_error(layer, "preserved Photoshop block size overflow")
        })?;
        if bytes > MAX_PSD_PRESERVED_BYTES {
            return Err(semantic_layer_error(
                layer,
                "preserved Photoshop block bytes exceed the safety limit",
            ));
        }
    }
    Ok(())
}

fn checked_semantic_mask(
    layer: &Layer,
    document_width: u32,
    document_height: u32,
) -> Result<Option<Mask>, String> {
    if layer.mask.is_empty() {
        return Ok(None);
    }
    let canvas_samples = (document_width as usize)
        .checked_mul(document_height as usize)
        .ok_or_else(|| semantic_layer_error(layer, "document mask dimensions overflow"))?;
    if layer.mask.len() != canvas_samples {
        return Err(semantic_layer_error(
            layer,
            &format!(
                "expanded mask has {} samples; expected {canvas_samples}",
                layer.mask.len()
            ),
        ));
    }
    let mask = layer
        .mask_for_export(document_width, document_height)
        .ok_or_else(|| semantic_layer_error(layer, "mask authority unexpectedly disappeared"))?;
    validate_semantic_mask(layer, &mask, "user")?;
    Ok(Some(mask))
}

fn validate_semantic_mask(layer: &Layer, mask: &Mask, label: &str) -> Result<(), String> {
    let samples = (mask.w as usize)
        .checked_mul(mask.h as usize)
        .ok_or_else(|| semantic_layer_error(layer, &format!("{label} mask dimensions overflow")))?;
    if mask.data.len() != samples {
        return Err(semantic_layer_error(
            layer,
            &format!(
                "{label} mask preview has {} samples; expected {samples}",
                mask.data.len()
            ),
        ));
    }
    if !mask.data16.is_empty() && mask.data16.len() != samples {
        return Err(semantic_layer_error(
            layer,
            &format!(
                "{label} 16-bit mask has {} samples; expected {samples}",
                mask.data16.len()
            ),
        ));
    }
    if !mask.data32.is_empty() && mask.data32.len() != samples {
        return Err(semantic_layer_error(
            layer,
            &format!(
                "{label} 32-bit mask has {} samples; expected {samples}",
                mask.data32.len()
            ),
        ));
    }
    if let Some(real) = mask.real.as_deref() {
        validate_semantic_mask(layer, real, "real user")?;
    }
    Ok(())
}

/// Accept a payload at least `expected` values long. Vision appends its own
/// trailing slots (contour, noise, technique, gradient stops, …) that the
/// neutral IR does not carry; callers read the leading `expected` values and
/// the tail is deliberately dropped rather than failing the whole export.
fn at_least_params<'a>(
    layer: &Layer,
    label: &str,
    params: &'a [f32],
    expected: usize,
) -> Result<&'a [f32], String> {
    if params.len() < expected {
        return Err(semantic_layer_error(
            layer,
            &format!(
                "{label} payload has {} values; expected {expected}",
                params.len()
            ),
        ));
    }
    Ok(params)
}

fn params_close(left: f32, right: f32) -> bool {
    (left - right).abs() <= 1e-5 * (1.0 + left.abs().max(right.abs()))
}

fn unmap_black_white_full(layer: &Layer, p: &[f32]) -> Result<Adjustment, String> {
    if p.iter().any(|value| !value.is_finite()) {
        return Err(semantic_layer_error(
            layer,
            "Black & White payload contains a non-finite value",
        ));
    }
    if p[1] != 0.0 || p[2] != 0.0 {
        return Err(semantic_layer_error(
            layer,
            "Black & White reserved values cannot be represented in PSD",
        ));
    }
    let tint = match p[9] {
        0.0 => false,
        1.0 => true,
        _ => {
            return Err(semantic_layer_error(
                layer,
                "Black & White tint flag must be 0 or 1 for PSD export",
            ));
        }
    };

    if p[0] == 1.0 {
        if !(0.0..=360.0).contains(&p[10]) || !(0.0..=1.0).contains(&p[11]) {
            return Err(semantic_layer_error(
                layer,
                "Black & White tint hue/saturation exceed the PSD range",
            ));
        }
        return Ok(Adjustment::BlackWhiteFull {
            bands: [p[3], p[4], p[5], p[6], p[7], p[8]],
            tint,
            tint_hue: p[10],
            tint_saturation: p[11],
        });
    }

    let legacy_derived = !tint
        && p[0].abs() <= 1.0 + 1e-5
        && params_close(p[4], p[3] + p[5])
        && params_close(p[6], p[5] + p[7])
        && params_close(p[8], p[7] + p[3])
        && params_close(p[0], p[3] + p[5] + p[7]);
    if legacy_derived {
        let scale = if params_close(p[0].abs(), 1.0) {
            1.0
        } else {
            1e-4
        };
        return Ok(Adjustment::BlackWhite {
            r: p[3] * scale,
            g: p[5] * scale,
            b: p[7] * scale,
        });
    }

    Err(semantic_layer_error(
        layer,
        "Black & White neutral multiplier cannot be represented in PSD",
    ))
}

fn unmap_adjustment(layer: &Layer) -> Result<Adjustment, String> {
    let p = layer.adj_params.as_slice();
    let adjustment = match layer.adj_kind {
        0 => {
            let p = at_least_params(layer, "Brightness/Contrast", p, 2)?;
            Adjustment::BrightnessContrast {
                brightness: p[0],
                contrast: p[1],
            }
        }
        1 => {
            let p = at_least_params(layer, "Levels", p, 5)?;
            Adjustment::Levels {
                in_black: p[0],
                in_white: p[1],
                gamma: p[2],
                out_black: p[3],
                out_white: p[4],
            }
        }
        2 => {
            if p.len() >= 22 {
                Adjustment::HueSaturationFull {
                    hue: p[0],
                    saturation: p[1],
                    lightness: p[2],
                    colorize: match p[3] {
                        0.0 => false,
                        1.0 => true,
                        _ => {
                            return Err(semantic_layer_error(
                                layer,
                                "Hue/Saturation colorize flag must be 0 or 1 for PSD export",
                            ));
                        }
                    },
                    ranges: std::array::from_fn(|range| {
                        let offset = 4 + range * 3;
                        [p[offset], p[offset + 1], p[offset + 2]]
                    }),
                }
            } else if p.len() >= 3 {
                Adjustment::HueSaturation {
                    hue: p[0],
                    saturation: p[1],
                    lightness: p[2],
                }
            } else {
                return Err(semantic_layer_error(
                    layer,
                    &format!(
                        "Hue/Saturation payload has {} values; expected 3 or 22",
                        p.len()
                    ),
                ));
            }
        }
        3 => {
            let p = at_least_params(layer, "Vibrance", p, 2)?;
            Adjustment::Vibrance {
                vibrance: p[0],
                saturation: p[1],
            }
        }
        4 => {
            at_least_params(layer, "Invert", p, 0)?;
            Adjustment::Invert
        }
        5 => {
            at_least_params(layer, "Desaturate", p, 0)?;
            Adjustment::Desaturate
        }
        6 => {
            if p.len() >= 12 {
                unmap_black_white_full(layer, p)?
            } else if p.len() >= 3 {
                Adjustment::BlackWhite {
                    r: p[0],
                    g: p[1],
                    b: p[2],
                }
            } else {
                return Err(semantic_layer_error(
                    layer,
                    &format!(
                        "Black & White payload has {} values; expected 3 or 12",
                        p.len()
                    ),
                ));
            }
        }
        7 => {
            let p = at_least_params(layer, "Posterize", p, 1)?;
            Adjustment::Posterize { levels: p[0] }
        }
        8 => {
            let p = at_least_params(layer, "Threshold", p, 1)?;
            Adjustment::Threshold { level: p[0] }
        }
        9 => {
            let p = at_least_params(layer, "Exposure", p, 3)?;
            Adjustment::Exposure {
                exposure: p[0],
                offset: p[1],
                gamma: p[2],
            }
        }
        10 => {
            let p = at_least_params(layer, "Color Balance", p, 9)?;
            Adjustment::ColorBalance {
                shadows: [p[0], p[1], p[2]],
                midtones: [p[3], p[4], p[5]],
                highlights: [p[6], p[7], p[8]],
            }
        }
        11 => {
            let p = at_least_params(layer, "Photo Filter", p, 4)?;
            Adjustment::PhotoFilter {
                color: Color3::new(p[0], p[1], p[2]),
                density: p[3],
            }
        }
        12 => {
            at_least_params(layer, "Curves", p, 256)?;
            Adjustment::Curves {
                lut: p[..256].to_vec(),
            }
        }
        13 => {
            at_least_params(layer, "Gradient Map", p, 256 * 3)?;
            Adjustment::GradientMap {
                lut: p[..256 * 3].to_vec(),
            }
        }
        other => {
            return Err(semantic_layer_error(
                layer,
                &format!("unsupported adjustment kind {other}"),
            ))
        }
    };
    Ok(adjustment)
}

fn effect_blend(layer: &Layer, label: &str, value: f32) -> Result<monet_format::import::BlendMode, String> {
    if !value.is_finite() || value.fract() != 0.0 || !(0.0..=u8::MAX as f32).contains(&value) {
        return Err(semantic_layer_error(
            layer,
            &format!("{label} blend index {value} is not an exact byte"),
        ));
    }
    let index = value as u8;
    if index == 25 || index > 27 {
        return Err(semantic_layer_error(
            layer,
            &format!("{label} blend index {index} has no neutral effect representation"),
        ));
    }
    Ok(monet_format::import::BlendMode::from_index(index))
}

fn effect_bool(layer: &Layer, label: &str, value: f32) -> Result<bool, String> {
    match value {
        0.0 => Ok(false),
        1.0 => Ok(true),
        _ => Err(semantic_layer_error(
            layer,
            &format!("{label} flag {value} is not exactly 0 or 1"),
        )),
    }
}

fn effect_byte(layer: &Layer, label: &str, value: f32) -> Result<u8, String> {
    if !value.is_finite() || value.fract() != 0.0 || !(0.0..=u8::MAX as f32).contains(&value) {
        return Err(semantic_layer_error(
            layer,
            &format!("{label} value {value} is not an exact byte"),
        ));
    }
    Ok(value as u8)
}

fn effect_color(p: &[f32], start: usize) -> Color3 {
    Color3::new(p[start], p[start + 1], p[start + 2])
}

fn unmap_effects(layer: &Layer) -> Result<Vec<Effect>, String> {
    let mut output = Vec::with_capacity(layer.effects.len());
    for (effect_id, params) in &layer.effects {
        let label = match *effect_id {
            0 => "Drop Shadow",
            1 => "Inner Shadow",
            2 => "Outer Glow",
            3 => "Inner Glow",
            4 => "Bevel",
            5 => "Satin",
            6 => "Color Overlay",
            7 => "Gradient Overlay",
            8 => "Pattern Overlay",
            9 => "Stroke",
            other => {
                return Err(semantic_layer_error(
                    layer,
                    &format!("unsupported layer effect id {other}"),
                ))
            }
        };
        let expected = match *effect_id {
            0 | 1 | 5 => 10,
            2 | 9 => 8,
            3 => 9,
            4 => 17,
            6 => 6,
            7 => 13,
            8 => 5,
            _ => unreachable!(),
        };
        let p = at_least_params(layer, label, params, expected)?;
        let enabled = effect_bool(layer, &format!("{label} enabled"), p[0])?;
        let effect = match *effect_id {
            0 => Effect::DropShadow {
                blend: effect_blend(layer, label, p[1])?,
                opacity: p[2],
                color: effect_color(p, 3),
                angle: p[6],
                distance: p[7],
                spread: p[8],
                size: p[9],
            },
            1 => Effect::InnerShadow {
                blend: effect_blend(layer, label, p[1])?,
                opacity: p[2],
                color: effect_color(p, 3),
                angle: p[6],
                distance: p[7],
                choke: p[8],
                size: p[9],
            },
            2 => Effect::OuterGlow {
                blend: effect_blend(layer, label, p[1])?,
                opacity: p[2],
                color: effect_color(p, 3),
                spread: p[6],
                size: p[7],
            },
            3 => Effect::InnerGlow {
                blend: effect_blend(layer, label, p[1])?,
                opacity: p[2],
                color: effect_color(p, 3),
                choke: p[6],
                size: p[7],
                center: effect_bool(layer, "Inner Glow source", p[8])?,
            },
            4 => Effect::Bevel {
                hl_blend: effect_blend(layer, "Bevel highlight", p[1])?,
                hl_opacity: p[2],
                hl_color: effect_color(p, 3),
                sh_blend: effect_blend(layer, "Bevel shadow", p[6])?,
                sh_opacity: p[7],
                sh_color: effect_color(p, 8),
                angle: p[11],
                altitude: p[12],
                depth: p[13],
                size: p[14],
                soften: p[15],
                style: effect_byte(layer, "Bevel style", p[16])?,
            },
            5 => Effect::Satin {
                blend: effect_blend(layer, label, p[1])?,
                opacity: p[2],
                color: effect_color(p, 3),
                angle: p[6],
                distance: p[7],
                size: p[8],
                invert: effect_bool(layer, "Satin invert", p[9])?,
            },
            6 => Effect::ColorOverlay {
                blend: effect_blend(layer, label, p[1])?,
                opacity: p[2],
                color: effect_color(p, 3),
            },
            7 => Effect::GradientOverlay {
                blend: effect_blend(layer, label, p[1])?,
                opacity: p[2],
                angle: p[3],
                scale: p[4],
                radial: effect_bool(layer, "Gradient Overlay radial", p[5])?,
                reverse: effect_bool(layer, "Gradient Overlay reverse", p[6])?,
                start: effect_color(p, 7),
                end: effect_color(p, 10),
            },
            8 => Effect::PatternOverlay {
                blend: effect_blend(layer, label, p[1])?,
                opacity: p[2],
                scale: p[3],
                kind: effect_byte(layer, "Pattern Overlay kind", p[4])?,
            },
            9 => Effect::Stroke {
                blend: effect_blend(layer, label, p[1])?,
                opacity: p[2],
                color: effect_color(p, 3),
                size: p[6],
                position: effect_byte(layer, "Stroke position", p[7])?,
            },
            _ => unreachable!(),
        };
        output.push(if enabled {
            effect
        } else {
            Effect::Disabled(Box::new(effect))
        });
    }
    Ok(output)
}

fn unmap_text(layer: &Layer) -> Result<Text, String> {
    if layer.text_spec.is_empty() {
        return Ok(Text {
            string: layer.text.clone(),
            point: true,
            size: layer.text_size,
            color: layer.text_color,
            origin: (layer.text_x, layer.text_y),
            antialias: 1,
            ..Default::default()
        });
    }

    let value: Value = serde_json::from_str(&layer.text_spec).map_err(|error| {
        semantic_layer_error(layer, &format!("editable text spec is invalid JSON: {error}"))
    })?;
    let object = value.as_object().ok_or_else(|| {
        semantic_layer_error(layer, "editable text spec root is not an object")
    })?;
    const ROOT_KEYS: [&str; 39] = [
        "v",
        "kind",
        "vertical",
        "ax",
        "ay",
        "runs",
        "font",
        "size",
        "color",
        "bold",
        "italic",
        "tracking",
        "kerning",
        "leading",
        "hScale",
        "vScale",
        "align",
        "direction",
        "composer",
        "boxW",
        "boxH",
        "firstIndent",
        "leftIndent",
        "rightIndent",
        "spaceBefore",
        "spaceAfter",
        "antialias",
        "digits",
        "kashida",
        "diacriticX",
        "diacriticY",
        "path",
        "liga",
        "dlig",
        "frac",
        "ordn",
        "features",
        "stroke",
        "shadow",
        // `warp` is checked separately below rather than included here.
    ];
    for key in object.keys() {
        if key != "warp" && !ROOT_KEYS.contains(&key.as_str()) {
            return Err(semantic_layer_error(
                layer,
                &format!("editable text field {key:?} has no neutral IR representation"),
            ));
        }
    }
    if text_u64(layer, object, "v")? != 1 {
        return Err(semantic_layer_error(
            layer,
            "editable text spec version is not 1",
        ));
    }

    let point = match text_str(layer, object, "kind")? {
        "point" => true,
        "paragraph" => false,
        other => {
            return Err(semantic_layer_error(
                layer,
                &format!("editable text kind {other:?} is unsupported"),
            ))
        }
    };
    let vertical = text_bool(layer, object, "vertical")?;
    let origin = (
        text_i32(layer, object, "ax")?,
        text_i32(layer, object, "ay")?,
    );
    let font = text_str(layer, object, "font")?.to_string();
    let size = text_f32(layer, object, "size")?;
    let color = text_color(layer, text_field(layer, object, "color")?, "color")?;
    let root_bold = text_bool(layer, object, "bold")?;
    let root_italic = text_bool(layer, object, "italic")?;
    let tracking = text_f32(layer, object, "tracking")?;
    let leading = text_f32(layer, object, "leading")?;
    let root_h_scale = text_f32(layer, object, "hScale")?;
    let root_v_scale = text_f32(layer, object, "vScale")?;
    let align = match text_str(layer, object, "align")? {
        "left" => 0,
        "right" => 1,
        "center" => 2,
        "justify" => 3,
        "justifyAll" => 4,
        other => {
            return Err(semantic_layer_error(
                layer,
                &format!("editable text alignment {other:?} is unsupported"),
            ))
        }
    };
    let antialias = match text_str(layer, object, "antialias")? {
        "none" => 0,
        "sharp" => 1,
        "crisp" => 2,
        "strong" => 3,
        "smooth" => 4,
        other => {
            return Err(semantic_layer_error(
                layer,
                &format!("editable text antialias mode {other:?} has no neutral representation"),
            ))
        }
    };

    text_default_string(layer, object, "kerning", "metrics")?;
    text_default_string(layer, object, "direction", "ltr")?;
    text_default_string(layer, object, "composer", "latin")?;
    text_default_string(layer, object, "digits", "latin")?;
    text_default_string(layer, object, "kashida", "none")?;
    for key in [
        "firstIndent",
        "leftIndent",
        "rightIndent",
        "spaceBefore",
        "spaceAfter",
        "diacriticX",
        "diacriticY",
    ] {
        text_default_zero(layer, object, key)?;
    }
    for key in ["liga", "dlig", "frac", "ordn"] {
        text_default_false(layer, object, key)?;
    }
    text_empty_object(layer, object, "features")?;
    text_empty_array(layer, object, "path")?;
    text_null(layer, object, "stroke")?;
    text_null(layer, object, "shadow")?;

    let box_w = text_f32(layer, object, "boxW")?;
    let box_h = text_f32(layer, object, "boxH")?;
    let box_size = (!point).then_some((box_w, box_h));
    let warp = text_field(layer, object, "warp")?
        .as_object()
        .ok_or_else(|| semantic_layer_error(layer, "editable text warp is not an object"))?;
    const WARP_KEYS: [&str; 5] = ["style", "bend", "h", "v", "orient"];
    for key in warp.keys() {
        if !WARP_KEYS.contains(&key.as_str()) {
            return Err(semantic_layer_error(
                layer,
                &format!("editable text warp field {key:?} is unsupported"),
            ));
        }
    }
    let warp_style_name = text_str(layer, warp, "style")?;
    let warp_style = WARP_NAMES
        .iter()
        .position(|name| *name == warp_style_name)
        .ok_or_else(|| semantic_layer_error(layer, "editable text warp style is unsupported"))?
        as u8;
    let expected_orientation = if vertical { "v" } else { "h" };
    if text_str(layer, warp, "orient")? != expected_orientation {
        return Err(semantic_layer_error(
            layer,
            "editable text warp orientation is independent of text orientation and cannot be represented",
        ));
    }
    let warp_bend = text_f32(layer, warp, "bend")?;
    let warp_h = text_f32(layer, warp, "h")?;
    let warp_v = text_f32(layer, warp, "v")?;

    let run_values = text_field(layer, object, "runs")?
        .as_array()
        .ok_or_else(|| semantic_layer_error(layer, "editable text runs is not an array"))?;
    let mut string = String::new();
    let mut runs = Vec::with_capacity(run_values.len());
    let mut rich = root_bold || root_italic || root_h_scale != 1.0 || root_v_scale != 1.0;
    for (index, run_value) in run_values.iter().enumerate() {
        let run = run_value.as_object().ok_or_else(|| {
            semantic_layer_error(layer, &format!("editable text run {index} is not an object"))
        })?;
        const RUN_KEYS: [&str; 18] = [
            "text",
            "font",
            "size",
            "color",
            "bold",
            "italic",
            "fauxBold",
            "fauxItalic",
            "underline",
            "strike",
            "kerning",
            "tracking",
            "hScale",
            "vScale",
            "baseline",
            "caps",
            "script",
            "features",
        ];
        for key in run.keys() {
            if !RUN_KEYS.contains(&key.as_str()) {
                return Err(semantic_layer_error(
                    layer,
                    &format!("editable text run {index} field {key:?} is unsupported"),
                ));
            }
        }
        text_default_string(layer, run, "kerning", "metrics")?;
        text_default_string(layer, run, "script", "none")?;
        text_empty_object(layer, run, "features")?;

        let run_text = text_str(layer, run, "text")?.to_string();
        string.push_str(&run_text);
        let style_keys = [
            "font",
            "size",
            "color",
            "bold",
            "italic",
            "fauxBold",
            "fauxItalic",
            "underline",
            "strike",
            "tracking",
            "hScale",
            "vScale",
            "baseline",
            "caps",
        ];
        rich |= style_keys.iter().any(|key| run.contains_key(*key));

        let run_h_scale = text_optional_f32(layer, run, "hScale")?
            .or_else(|| (root_h_scale != 1.0).then_some(root_h_scale));
        let run_v_scale = text_optional_f32(layer, run, "vScale")?
            .or_else(|| (root_v_scale != 1.0).then_some(root_v_scale));
        runs.push(TextRun {
            text: run_text,
            font: text_optional_string(layer, run, "font")?,
            size: text_optional_f32(layer, run, "size")?,
            color: text_optional_color(layer, run, "color")?,
            bold: text_optional_bool(layer, run, "bold")?.unwrap_or(root_bold),
            italic: text_optional_bool(layer, run, "italic")?.unwrap_or(root_italic),
            faux_bold: text_optional_bool(layer, run, "fauxBold")?.unwrap_or(false),
            faux_italic: text_optional_bool(layer, run, "fauxItalic")?.unwrap_or(false),
            underline: text_optional_bool(layer, run, "underline")?.unwrap_or(false),
            strike: text_optional_bool(layer, run, "strike")?.unwrap_or(false),
            tracking: text_optional_f32(layer, run, "tracking")?,
            h_scale: run_h_scale,
            v_scale: run_v_scale,
            baseline: text_optional_f32(layer, run, "baseline")?,
            caps: text_optional_caps(layer, run, "caps")?,
        });
    }
    if !rich {
        runs.clear();
    }

    Ok(Text {
        string,
        runs,
        point,
        vertical,
        size,
        color,
        font: Some(font),
        align,
        leading,
        tracking,
        origin,
        box_size,
        warp_style,
        warp_bend,
        warp_h,
        warp_v,
        antialias,
    })
}

fn text_field<'a>(
    layer: &Layer,
    object: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Result<&'a Value, String> {
    object.get(key).ok_or_else(|| {
        semantic_layer_error(layer, &format!("editable text field {key:?} is missing"))
    })
}

fn text_str<'a>(
    layer: &Layer,
    object: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Result<&'a str, String> {
    text_field(layer, object, key)?.as_str().ok_or_else(|| {
        semantic_layer_error(layer, &format!("editable text field {key:?} is not a string"))
    })
}

fn text_bool(
    layer: &Layer,
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<bool, String> {
    text_field(layer, object, key)?.as_bool().ok_or_else(|| {
        semantic_layer_error(layer, &format!("editable text field {key:?} is not a boolean"))
    })
}

fn text_u64(
    layer: &Layer,
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<u64, String> {
    text_field(layer, object, key)?.as_u64().ok_or_else(|| {
        semantic_layer_error(layer, &format!("editable text field {key:?} is not an unsigned integer"))
    })
}

fn text_i32(
    layer: &Layer,
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<i32, String> {
    let value = text_field(layer, object, key)?.as_i64().ok_or_else(|| {
        semantic_layer_error(layer, &format!("editable text field {key:?} is not an integer"))
    })?;
    i32::try_from(value).map_err(|_| {
        semantic_layer_error(layer, &format!("editable text field {key:?} exceeds i32"))
    })
}

fn text_f32(
    layer: &Layer,
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<f32, String> {
    let value = text_field(layer, object, key)?.as_f64().ok_or_else(|| {
        semantic_layer_error(layer, &format!("editable text field {key:?} is not numeric"))
    })?;
    let value = value as f32;
    if !value.is_finite() {
        return Err(semantic_layer_error(
            layer,
            &format!("editable text field {key:?} is not a finite f32"),
        ));
    }
    Ok(value)
}

fn text_color(layer: &Layer, value: &Value, label: &str) -> Result<[u8; 4], String> {
    let values = value.as_array().ok_or_else(|| {
        semantic_layer_error(layer, &format!("editable text {label} is not an RGBA array"))
    })?;
    if values.len() != 4 {
        return Err(semantic_layer_error(
            layer,
            &format!("editable text {label} has {} channels; expected 4", values.len()),
        ));
    }
    let mut color = [0; 4];
    for (index, value) in values.iter().enumerate() {
        let channel = value.as_u64().filter(|channel| *channel <= 255).ok_or_else(|| {
            semantic_layer_error(
                layer,
                &format!("editable text {label} channel {index} is not an exact byte"),
            )
        })?;
        color[index] = channel as u8;
    }
    Ok(color)
}

fn text_optional_string(
    layer: &Layer,
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<Option<String>, String> {
    object
        .get(key)
        .map(|value| {
            value.as_str().map(str::to_string).ok_or_else(|| {
                semantic_layer_error(layer, &format!("editable text field {key:?} is not a string"))
            })
        })
        .transpose()
}

fn text_optional_bool(
    layer: &Layer,
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<Option<bool>, String> {
    object
        .get(key)
        .map(|value| {
            value.as_bool().ok_or_else(|| {
                semantic_layer_error(layer, &format!("editable text field {key:?} is not a boolean"))
            })
        })
        .transpose()
}

fn text_optional_f32(
    layer: &Layer,
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<Option<f32>, String> {
    object
        .get(key)
        .map(|_| text_f32(layer, object, key))
        .transpose()
}

fn text_optional_color(
    layer: &Layer,
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<Option<[u8; 4]>, String> {
    object
        .get(key)
        .map(|value| text_color(layer, value, key))
        .transpose()
}

fn text_optional_caps(
    layer: &Layer,
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<Option<u8>, String> {
    object
        .get(key)
        .map(|value| match value.as_str() {
            Some("none") => Ok(0),
            Some("small") => Ok(1),
            Some("all") => Ok(2),
            _ => Err(semantic_layer_error(
                layer,
                "editable text run caps mode is unsupported",
            )),
        })
        .transpose()
}

fn text_default_string(
    layer: &Layer,
    object: &serde_json::Map<String, Value>,
    key: &str,
    expected: &str,
) -> Result<(), String> {
    if let Some(value) = object.get(key) {
        if value.as_str() != Some(expected) {
            return Err(semantic_layer_error(
                layer,
                &format!("editable text field {key:?}={value} has no neutral IR representation"),
            ));
        }
    }
    Ok(())
}

fn text_default_zero(
    layer: &Layer,
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<(), String> {
    if object.contains_key(key) && text_f32(layer, object, key)? != 0.0 {
        return Err(semantic_layer_error(
            layer,
            &format!("editable text field {key:?} is non-zero and has no neutral IR representation"),
        ));
    }
    Ok(())
}

fn text_default_false(
    layer: &Layer,
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<(), String> {
    if object.contains_key(key) && text_bool(layer, object, key)? {
        return Err(semantic_layer_error(
            layer,
            &format!("editable text field {key:?}=true has no neutral IR representation"),
        ));
    }
    Ok(())
}

fn text_empty_object(
    layer: &Layer,
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<(), String> {
    if let Some(value) = object.get(key) {
        if !value.as_object().is_some_and(serde_json::Map::is_empty) {
            return Err(semantic_layer_error(
                layer,
                &format!("editable text field {key:?} has unsupported entries"),
            ));
        }
    }
    Ok(())
}

fn text_empty_array(
    layer: &Layer,
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<(), String> {
    if let Some(value) = object.get(key) {
        if !value.as_array().is_some_and(Vec::is_empty) {
            return Err(semantic_layer_error(
                layer,
                &format!("editable text field {key:?} has unsupported entries"),
            ));
        }
    }
    Ok(())
}

fn text_null(
    layer: &Layer,
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<(), String> {
    if object.get(key).is_some_and(|value| !value.is_null()) {
        return Err(semantic_layer_error(
            layer,
            &format!("editable text field {key:?} is not null and has no neutral IR representation"),
        ));
    }
    Ok(())
}

fn apply_engine_extra(layer: &mut Layer, extra: &serde_json::Map<String, Value>) {
    if extra.get("engineKind").and_then(Value::as_u64) == Some(4) {
        layer.kind = 4;
    }
    if let Some(v) = extra.get("engineAdjKind").and_then(Value::as_u64) {
        layer.adj_kind = v as u8;
    }
    if let Some(v) = extra.get("engineAdjParams") {
        if let Ok(p) = serde_json::from_value::<Vec<f32>>(v.clone()) {
            layer.adj_params = p;
        }
    }
    if layer.kind == 4 && layer.adj_kind == 2 {
        if let Some(data) = extra.get("engineFillSource").and_then(Value::as_str) {
            let pw = layer
                .adj_params
                .first()
                .copied()
                .unwrap_or(0.0)
                .round()
                .max(0.0) as usize;
            let ph = layer
                .adj_params
                .get(1)
                .copied()
                .unwrap_or(0.0)
                .round()
                .max(0.0) as usize;
            if let Some(raw) = base64_decode(data) {
                if let Some(source) = inflate_u16_le(&raw, pw.saturating_mul(ph).saturating_mul(4))
                {
                    layer.set_smart_src(source);
                }
            }
        }
    }
    if let Some(v) = extra.get("engineTextSpec").and_then(Value::as_str) {
        layer.text_spec = v.to_string();
    }
    if let Some(v) = extra.get("engineEffects") {
        if let Ok(fx) = serde_json::from_value::<Vec<(u8, Vec<f32>)>>(v.clone()) {
            layer.effects = fx;
        }
    }
    if let Some(data) = extra.get("engineSmartSourceF32").and_then(Value::as_str) {
        if let Some(raw) = base64_decode(data) {
            if let Some(source) = inflate_f32_le(&raw, layer.smart_src.len()) {
                layer.smart_src_f32 = source.into();
            }
        }
    }
}

fn decode_psd_blocks(
    extra: &serde_json::Map<String, Value>,
    field: &str,
    allowed: &[[u8; 4]],
    total_bytes: &mut usize,
    total_blocks: &mut usize,
) -> Vec<PsdTaggedBlock> {
    let Some(items) = extra.get(field).and_then(Value::as_array) else {
        return Vec::new();
    };
    if items.len() > MAX_PSD_PRESERVED_BLOCKS.saturating_sub(*total_blocks) {
        return Vec::new();
    }

    let mut blocks = Vec::with_capacity(items.len());
    let mut added_bytes = 0usize;
    for item in items {
        let Some(key) = item.get("key").and_then(Value::as_str) else {
            return Vec::new();
        };
        let Ok(key) = <[u8; 4]>::try_from(key.as_bytes()) else {
            return Vec::new();
        };
        if !allowed.contains(&key) {
            return Vec::new();
        }
        let Some(data) = item.get("data").and_then(Value::as_str) else {
            return Vec::new();
        };
        let remaining = MAX_PSD_PRESERVED_BYTES
            .saturating_sub(*total_bytes)
            .saturating_sub(added_bytes);
        let max_encoded = remaining.saturating_add(2) / 3 * 4;
        if data.len() > max_encoded {
            return Vec::new();
        }
        let Some(data) = base64_decode(data) else {
            return Vec::new();
        };
        added_bytes = match added_bytes.checked_add(data.len()) {
            Some(n) if n <= MAX_PSD_PRESERVED_BYTES.saturating_sub(*total_bytes) => n,
            _ => return Vec::new(),
        };
        blocks.push(PsdTaggedBlock { key, data });
    }
    *total_bytes += added_bytes;
    *total_blocks += blocks.len();
    blocks
}

fn psd_blocks_json(blocks: &[PsdTaggedBlock]) -> Value {
    Value::Array(
        blocks
            .iter()
            .map(|block| {
                serde_json::json!({
                    "key": String::from_utf8_lossy(&block.key),
                    "data": base64_encode(&block.data),
                })
            })
            .collect(),
    )
}

fn decode_psd_raster_proxy_baseline(
    extra: &serde_json::Map<String, Value>,
) -> Option<[u8; 32]> {
    let encoded = extra
        .get(PSD_RASTER_PROXY_BASELINE_EXTRA)
        .and_then(Value::as_str)?;
    // Standard padded base64 for 32 bytes is exactly 44 ASCII bytes. Bound the
    // input before decoding so a hostile GFX field cannot force a large alloc.
    if encoded.len() != 44 {
        return None;
    }
    let decoded = base64_decode(encoded)?;
    if base64_encode(&decoded) != encoded {
        return None;
    }
    decoded.try_into().ok()
}

enum DecodedPixels {
    Rgba8(Vec<u8>),
    Rgba16(Vec<u16>),
    Rgba32(Vec<f32>),
}

fn payload_bounds(declared: Bounds, w: u32, h: u32) -> Option<Bounds> {
    if w == 0 || h == 0 {
        return None;
    }
    let bounds = if declared.w == 0 && declared.h == 0 {
        // v1 GFX omitted bounds and treated inline/pixel-ref data as a canvas
        // plane. Preserve that read compatibility while making the inferred
        // dimensions explicit in the engine and on the next write.
        Bounds { w, h, ..declared }
    } else if declared.w == w && declared.h == h {
        declared
    } else {
        return None;
    };
    super::checked_plane_len(bounds, 4)?;
    Some(bounds)
}

fn decode_base64_pixels(data: &str, bounds: Bounds, bits: u8) -> Option<DecodedPixels> {
    let sample_len = super::checked_plane_len(bounds, 4)?;
    let raw = base64_decode(data)?;
    match bits {
        8 if raw.len() == sample_len => Some(DecodedPixels::Rgba8(raw)),
        16 => inflate_u16_le(&raw, sample_len).map(DecodedPixels::Rgba16),
        32 => inflate_f32_le(&raw, sample_len).map(DecodedPixels::Rgba32),
        _ => None,
    }
}

fn install_decoded_pixels(
    layer: &mut Layer,
    decoded: DecodedPixels,
    bounds: Bounds,
    local: bool,
    cw: u32,
    ch: u32,
) {
    if local {
        layer.pixel_bounds = bounds;
        match decoded {
            DecodedPixels::Rgba8(values) => {
                layer.pixels = widen_rgba8(&values).into();
                layer.pixels_f32 = Arc::from(Vec::<f32>::new());
            }
            DecodedPixels::Rgba16(values) => {
                layer.pixels = values.into();
                layer.pixels_f32 = Arc::from(Vec::<f32>::new());
            }
            DecodedPixels::Rgba32(values) => {
                layer.pixels = float_preview(&values).into();
                layer.pixels_f32 = values.into();
            }
        }
        return;
    }

    match decoded {
        DecodedPixels::Rgba8(values) => place_pixels(
            Arc::make_mut(&mut layer.pixels),
            &values,
            bounds.x,
            bounds.y,
            bounds.w,
            bounds.h,
            cw,
            ch,
        ),
        DecodedPixels::Rgba16(values) => place_pixels_u16(
            Arc::make_mut(&mut layer.pixels),
            &values,
            bounds.x,
            bounds.y,
            bounds.w,
            bounds.h,
            cw,
            ch,
        ),
        DecodedPixels::Rgba32(values) => {
            layer.pixels_f32 = vec![0.0; layer.pixels.len()].into();
            place_pixels_f32(
                Arc::make_mut(&mut layer.pixels),
                Arc::make_mut(&mut layer.pixels_f32),
                &values,
                bounds.x,
                bounds.y,
                bounds.w,
                bounds.h,
                cw,
                ch,
            );
        }
    }
}

fn gfx_channel_depth(depth: u8) -> u8 {
    match depth {
        16 => 16,
        32 => 32,
        _ => 8,
    }
}

pub(crate) fn gfx_document_channel_path(index: usize, bits: u8) -> String {
    format!("channels/{index}.raw{bits}")
}

pub(crate) fn validate_gfx_document_channels(engine: &Engine) -> Result<(), String> {
    if engine.document_channels.len() > super::MAX_MVSN_DOCUMENT_CHANNELS {
        return Err("graphics document channel count exceeds the supported maximum".into());
    }
    if engine.document_channels.is_empty() {
        return Ok(());
    }
    if engine.w == 0 || engine.h == 0 {
        return Err("graphics document channels require a non-empty canvas".into());
    }
    let bounds = Bounds {
        x: 0,
        y: 0,
        w: engine.w,
        h: engine.h,
    };
    let samples = super::checked_plane_len(bounds, 1)
        .ok_or("graphics document channel dimensions exceed engine limits")?;
    let depth = gfx_channel_depth(engine.depth);
    let mut total = 0usize;
    for (index, channel) in engine.document_channels.iter().enumerate() {
        if channel.data.len() != samples {
            return Err(format!(
                "graphics document channel {} preview length does not match the canvas",
                index + 1
            ));
        }
        if !channel.data16.is_empty() && !channel.data32.is_empty() {
            return Err(format!(
                "graphics document channel {} has multiple native planes",
                index + 1
            ));
        }
        let sample_bytes = match depth {
            16 => {
                if !channel.data32.is_empty() {
                    return Err(format!(
                        "graphics document channel {} has 32-bit authority in a 16-bit document",
                        index + 1
                    ));
                }
                if channel.data16.is_empty() {
                    1
                } else if channel.data16.len() == samples {
                    2
                } else {
                    return Err(format!(
                        "graphics document channel {} 16-bit length does not match the canvas",
                        index + 1
                    ));
                }
            }
            32 => {
                if !channel.data16.is_empty() {
                    return Err(format!(
                        "graphics document channel {} has 16-bit authority in a 32-bit document",
                        index + 1
                    ));
                }
                if channel.data32.is_empty() {
                    1
                } else if channel.data32.len() != samples {
                    return Err(format!(
                        "graphics document channel {} 32-bit length does not match the canvas",
                        index + 1
                    ));
                } else if channel.data32.iter().any(|value| !value.is_finite()) {
                    return Err(format!(
                        "graphics document channel {} contains non-finite 32-bit samples",
                        index + 1
                    ));
                } else {
                    4
                }
            }
            _ => {
                if !channel.data16.is_empty() || !channel.data32.is_empty() {
                    return Err(format!(
                        "graphics document channel {} has native authority in an 8-bit document",
                        index + 1
                    ));
                }
                1
            }
        };
        let bytes = samples
            .checked_mul(sample_bytes)
            .ok_or("graphics document channel payload length overflows")?;
        total = total
            .checked_add(bytes)
            .ok_or("graphics document channel payload length overflows")?;
        if total > super::MAX_MVSN_V19_PAYLOAD_BYTES {
            return Err("graphics document channel payload exceeds the supported maximum".into());
        }
    }
    Ok(())
}

pub(crate) fn gfx_document_channel_payload(channel: &DocumentChannel, depth: u8) -> (u8, Vec<u8>) {
    if gfx_channel_depth(depth) == 32 && !channel.data32.is_empty() {
        (32, f32_plane_to_le_bytes(&channel.data32))
    } else if gfx_channel_depth(depth) == 16 && !channel.data16.is_empty() {
        (16, u16_plane_to_le_bytes(&channel.data16))
    } else {
        (8, channel.data.clone())
    }
}

fn channel_bits_valid_for_depth(bits: u8, depth: u8) -> bool {
    bits == 8 || (bits == 16 && gfx_channel_depth(depth) == 16)
        || (bits == 32 && gfx_channel_depth(depth) == 32)
}

fn decode_gfx_document_channels<'a>(
    gfx: &GfxDocument,
    mut find: impl FnMut(&str) -> Result<&'a [u8], String>,
) -> Result<Vec<DocumentChannel>, String> {
    if gfx.channels.len() > super::MAX_MVSN_DOCUMENT_CHANNELS {
        return Err("graphics document channel count exceeds the supported maximum".into());
    }
    if gfx.channels.is_empty() {
        return Ok(Vec::new());
    }
    if gfx.width == 0 || gfx.height == 0 {
        return Err("graphics document channels require a non-empty canvas".into());
    }
    let samples = super::checked_plane_len(
        Bounds {
            x: 0,
            y: 0,
            w: gfx.width,
            h: gfx.height,
        },
        1,
    )
    .ok_or("graphics document channel dimensions exceed engine limits")?;
    let mut total = 0usize;
    let mut decoded = Vec::with_capacity(gfx.channels.len());
    for (index, channel) in gfx.channels.iter().enumerate() {
        let resolved = if let Some(pixels) = channel.pixels.as_ref() {
            if !channel.data.is_empty() || !channel.data16.is_empty() || !channel.data32.is_empty() {
                return Err(format!(
                    "graphics document channel {} duplicates ref and legacy planes",
                    index + 1
                ));
            }
            let (bits, w, h, payload): (u8, u32, u32, Cow<'a, [u8]>) = match pixels {
                ChannelPixelRef::Base64 { data, w, h, bits } => {
                    if !channel_bits_valid_for_depth(*bits, gfx.depth) {
                        return Err(format!(
                            "graphics document channel {} has invalid bits for document depth",
                            index + 1
                        ));
                    }
                    let sample_bytes = usize::from(*bits / 8);
                    let expected = samples
                        .checked_mul(sample_bytes)
                        .ok_or("graphics document channel payload length overflows")?;
                    let encoded_len = expected
                        .checked_add(2)
                        .and_then(|value| value.checked_div(3))
                        .and_then(|value| value.checked_mul(4))
                        .ok_or("graphics document channel base64 length overflows")?;
                    if data.len() != encoded_len {
                        return Err(format!(
                            "graphics document channel {} base64 length does not match the canvas",
                            index + 1
                        ));
                    }
                    let raw = base64_decode(data).ok_or_else(|| {
                        format!("graphics document channel {} has invalid base64", index + 1)
                    })?;
                    if base64_encode(&raw) != data.as_str() {
                        return Err(format!(
                            "graphics document channel {} base64 is not canonical",
                            index + 1
                        ));
                    }
                    (*bits, *w, *h, Cow::Owned(raw))
                }
                ChannelPixelRef::Raw8 { path, w, h } => {
                    let expected = gfx_document_channel_path(index, 8);
                    if path != &expected {
                        return Err(format!(
                            "graphics document channel {} has invalid raw8 path",
                            index + 1
                        ));
                    }
                    (8, *w, *h, Cow::Borrowed(find(path)?))
                }
                ChannelPixelRef::Raw16 { path, w, h } => {
                    if !channel_bits_valid_for_depth(16, gfx.depth) {
                        return Err(format!(
                            "graphics document channel {} has invalid bits for document depth",
                            index + 1
                        ));
                    }
                    let expected = gfx_document_channel_path(index, 16);
                    if path != &expected {
                        return Err(format!(
                            "graphics document channel {} has invalid raw16 path",
                            index + 1
                        ));
                    }
                    (16, *w, *h, Cow::Borrowed(find(path)?))
                }
                ChannelPixelRef::Raw32 { path, w, h } => {
                    if !channel_bits_valid_for_depth(32, gfx.depth) {
                        return Err(format!(
                            "graphics document channel {} has invalid bits for document depth",
                            index + 1
                        ));
                    }
                    let expected = gfx_document_channel_path(index, 32);
                    if path != &expected {
                        return Err(format!(
                            "graphics document channel {} has invalid raw32 path",
                            index + 1
                        ));
                    }
                    (32, *w, *h, Cow::Borrowed(find(path)?))
                }
            };
            if (w, h) != (gfx.width, gfx.height) {
                return Err(format!(
                    "graphics document channel {} dimensions do not match the canvas",
                    index + 1
                ));
            }
            let sample_bytes = usize::from(bits / 8);
            let expected = samples
                .checked_mul(sample_bytes)
                .ok_or("graphics document channel payload length overflows")?;
            if payload.len() != expected {
                return Err(format!(
                    "graphics document channel {} payload length does not match the canvas",
                    index + 1
                ));
            }
            total = total
                .checked_add(expected)
                .ok_or("graphics document channel payload length overflows")?;
            if total > super::MAX_MVSN_V19_PAYLOAD_BYTES {
                return Err("graphics document channel payload exceeds the supported maximum".into());
            }
            let (data, data16, data32) = match bits {
                8 => (payload.into_owned(), Vec::new(), Vec::new()),
                16 => {
                    let values: Vec<u16> = payload
                        .chunks_exact(2)
                        .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
                        .collect();
                    let preview = values.iter().map(|value| (value >> 8) as u8).collect();
                    (preview, values, Vec::new())
                }
                32 => {
                    let values: Vec<f32> = payload
                        .chunks_exact(4)
                        .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
                        .collect();
                    if values.iter().any(|value| !value.is_finite()) {
                        return Err(format!(
                            "graphics document channel {} contains non-finite 32-bit samples",
                            index + 1
                        ));
                    }
                    let preview = values
                        .iter()
                        .map(|value| (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8)
                        .collect();
                    (preview, Vec::new(), values)
                }
                _ => unreachable!(),
            };
            DocumentChannel {
                name: channel.name.clone(),
                identifier: channel.identifier,
                display: channel.display,
                data,
                data16,
                data32,
            }
        } else {
            if channel.data.len() != samples {
                return Err(format!(
                    "graphics document channel {} legacy preview length does not match the canvas",
                    index + 1
                ));
            }
            if !channel.data16.is_empty() && !channel.data32.is_empty() {
                return Err(format!(
                    "graphics document channel {} has multiple legacy native planes",
                    index + 1
                ));
            }
            let depth = gfx_channel_depth(gfx.depth);
            if (!channel.data16.is_empty() && depth != 16)
                || (!channel.data32.is_empty() && depth != 32)
            {
                return Err(format!(
                    "graphics document channel {} legacy authority does not match document depth",
                    index + 1
                ));
            }
            if !channel.data16.is_empty() && channel.data16.len() != samples {
                return Err(format!(
                    "graphics document channel {} legacy 16-bit length does not match the canvas",
                    index + 1
                ));
            }
            if !channel.data32.is_empty() && channel.data32.len() != samples {
                return Err(format!(
                    "graphics document channel {} legacy 32-bit length does not match the canvas",
                    index + 1
                ));
            }
            if channel.data32.iter().any(|value| !value.is_finite()) {
                return Err(format!(
                    "graphics document channel {} contains non-finite legacy 32-bit samples",
                    index + 1
                ));
            }
            let bytes = channel
                .data
                .len()
                .checked_add(channel.data16.len().checked_mul(2).ok_or(
                    "graphics document channel payload length overflows",
                )?)
                .and_then(|value| {
                    channel
                        .data32
                        .len()
                        .checked_mul(4)
                        .and_then(|native| value.checked_add(native))
                })
                .ok_or("graphics document channel payload length overflows")?;
            total = total
                .checked_add(bytes)
                .ok_or("graphics document channel payload length overflows")?;
            if total > super::MAX_MVSN_V19_PAYLOAD_BYTES {
                return Err("graphics document channel payload exceeds the supported maximum".into());
            }
            DocumentChannel {
                name: channel.name.clone(),
                identifier: channel.identifier,
                display: channel.display,
                data: channel.data.clone(),
                data16: channel.data16.clone(),
                data32: channel.data32.clone(),
            }
        };
        decoded.push(resolved);
    }
    Ok(decoded)
}

/// Document-envelope state the raster engine carries but does not own: the
/// document identity/provenance, other apps' `data` namespaces, unknown
/// top-level fields, and the embedded ICC profile. Every Monet app is a
/// lossless COURIER for the namespaces it does not own (design §8.7), so these
/// ride a load→save round trip verbatim instead of being dropped on the floor.
#[derive(Default, Clone, Debug, PartialEq)]
pub(crate) struct GfxEnvelope {
    pub id: String,
    pub name: String,
    pub source: Option<monet_format::import::SourceFormat>,
    pub data: Option<Value>,
    pub extra: serde_json::Map<String, Value>,
    /// Base64 of the embedded ICC profile, kept exactly as it arrived — a
    /// profile this engine cannot interpret must still re-emit byte-identically
    /// — plus its display name.
    pub icc_profile: Option<String>,
    pub icc_profile_name: Option<String>,
}

impl GfxEnvelope {
    fn capture(gfx: &GfxDocument) -> GfxEnvelope {
        let mut extra = gfx.extra.clone();
        // The engine decodes this key into `psd_linked_blocks` and re-emits it
        // from there on save; a retained copy would be a stale second writer.
        extra.remove(PSD_LINKED_BLOCKS_EXTRA);
        GfxEnvelope {
            id: gfx.id.clone(),
            name: gfx.name.clone(),
            source: gfx.source,
            data: gfx.data.clone(),
            extra,
            icc_profile: gfx.icc_profile.clone(),
            icc_profile_name: gfx.icc_profile_name.clone(),
        }
    }
}

pub(crate) fn from_gfx_with_channel_entries<'a>(
    gfx: GfxDocument,
    find: impl FnMut(&str) -> Result<&'a [u8], String>,
) -> Result<Engine, String> {
    // (#89) The manifest's canvas size is untrusted: from_gfx_resolved feeds it
    // straight to Layer::transparent, which panics (an unrecoverable wasm trap)
    // once the plane exceeds the engine limits. Reject up front, mirroring the
    // dims_ok gate from_format already applies to layered imports.
    if !super::dims_ok(gfx.width, gfx.height) {
        return Err("graphics document dimensions exceed engine limits".into());
    }
    let channels = decode_gfx_document_channels(&gfx, find)?;
    Ok(from_gfx_resolved(gfx, channels))
}

/// Build a fresh Engine from a unified graphics document.
pub(crate) fn from_gfx(gfx: GfxDocument) -> Result<Engine, String> {
    from_gfx_with_channel_entries(gfx, |path| -> Result<&'static [u8], String> {
        Err(format!("graphics document channel ref requires container entry {path}"))
    })
}

fn from_gfx_resolved(gfx: GfxDocument, channels: Vec<DocumentChannel>) -> Engine {
    let cw = gfx.width.max(1);
    let ch = gfx.height.max(1);
    let mut e = Engine::new(cw, ch);
    e.layers.clear();
    e.document_channels = channels;
    let mut psd_bytes = 0usize;
    let mut psd_blocks = 0usize;
    e.psd_linked_blocks = decode_psd_blocks(
        &gfx.extra,
        PSD_LINKED_BLOCKS_EXTRA,
        &PSD_DOCUMENT_BLOCK_KEYS,
        &mut psd_bytes,
        &mut psd_blocks,
    );
    e.gfx_envelope = GfxEnvelope::capture(&gfx);

    let mut max_id = 0u32;
    for l in &gfx.layers {
        max_id = max_id.max(l.id);
        let mut layer = Layer::transparent(l.id, &l.name, cw, ch);

        let declared_bounds = l.raster.bounds;
        let local = l.kind == GfxLayerKind::Raster
            && l.extra.get("engineKind").and_then(Value::as_u64) != Some(4);
        if local {
            layer.pixel_bounds = declared_bounds;
            layer.pixels = Arc::from(Vec::<u16>::new());
            layer.pixels_f32 = Arc::from(Vec::<f32>::new());
        }
        if let Some(px) = l.raster.pixels.as_ref() {
            match px {
                PixelRef::Base64 { data, w, h, bits } => {
                    if let Some(bounds) = payload_bounds(declared_bounds, *w, *h) {
                        if local {
                            layer.pixel_bounds = bounds;
                        }
                        if let Some(decoded) = decode_base64_pixels(data, bounds, *bits) {
                            install_decoded_pixels(&mut layer, decoded, bounds, local, cw, ch);
                        }
                    }
                }
                // Png/Raw16 point at zip entries; the container reader resolves
                // them to Base64 before calling from_gfx. Still validate and
                // retain their declared local geometry for direct JSON readers.
                PixelRef::Png { w, h, .. }
                | PixelRef::Raw16 { w, h, .. }
                | PixelRef::Raw32 { w, h, .. } => {
                    if local {
                        if let Some(bounds) = payload_bounds(declared_bounds, *w, *h) {
                            layer.pixel_bounds = bounds;
                        }
                    }
                }
            }
        } else if let Some(rgba) = l.raster.rgba.as_ref() {
            // v1 inline RGBA (legacy read path).
            let (w, h) = if declared_bounds.w == 0 && declared_bounds.h == 0 {
                (cw, ch)
            } else {
                (declared_bounds.w, declared_bounds.h)
            };
            if let Some(bounds) = payload_bounds(declared_bounds, w, h) {
                if local {
                    layer.pixel_bounds = bounds;
                }
                if super::checked_plane_len(bounds, 4) == Some(rgba.len()) {
                    install_decoded_pixels(
                        &mut layer,
                        DecodedPixels::Rgba8(rgba.clone()),
                        bounds,
                        local,
                        cw,
                        ch,
                    );
                }
            }
        }

        layer.visible = l.visible;
        layer.opacity = l.opacity.clamp(0.0, 1.0);
        layer.blend = BlendMode::from_u8(l.blend.to_index());
        if l.pass_through {
            layer.blend = BlendMode::PassThrough;
        }
        layer.locked = l.locked;
        layer.clipping = l.clipping;
        layer.group = l.parent.unwrap_or(0);
        layer.fill_opacity = l.fill_opacity.clamp(0.0, 1.0);
        layer.knockout = l.knockout;
        if let Some(bi) = l.blend_if {
            layer.blend_if = bi.to_vec();
        }
        if let Some(m) = &l.mask {
            layer.mask = place_mask(m, cw, ch).into();
            layer.mask_enabled = !m.disabled;
            layer.mask_linked = m.relative;
            layer.psd_mask = Some(m.clone());
        }
        layer.effects = map_effects(&l.raster.effects);

        match l.kind {
            GfxLayerKind::Group => layer.kind = 6,
            GfxLayerKind::Adjustment => {
                layer.kind = 1;
                let (k, p) = l
                    .raster
                    .adjustment
                    .as_ref()
                    .map(map_adjustment)
                    .unwrap_or((0, Vec::new()));
                layer.adj_kind = k;
                layer.adj_params = p;
            }
            GfxLayerKind::Text => {
                layer.kind = 2;
                if let Some(t) = &l.raster.text {
                    apply_text(&mut layer, t);
                }
            }
            GfxLayerKind::Raster => layer.kind = 0,
            GfxLayerKind::SmartObject => {
                layer.kind = 7;
                layer.set_smart_src(layer.pixels.clone());
                layer.smart_src_f32 = layer.pixels_f32.clone().into();
            }
            GfxLayerKind::Vector => {
                layer.kind = 3;
                if let Some(vp) = &l.vector {
                    if let Ok(scene) =
                        serde_json::from_value::<crate::vector::model::Document>(vp.scene.clone())
                    {
                        layer.vector_scene = Some(Box::new(scene));
                    }
                }
            }
        }

        apply_engine_extra(&mut layer, &l.extra);
        layer.psd_smart_blocks = decode_psd_blocks(
            &l.extra,
            PSD_SMART_BLOCKS_EXTRA,
            &PSD_PRESERVED_LAYER_KEYS,
            &mut psd_bytes,
            &mut psd_blocks,
        );
        layer.psd_raster_proxy_baseline = decode_psd_raster_proxy_baseline(&l.extra)
            .filter(|_| layer.kind == 0 && has_psd_raster_proxy_blocks(&layer));
        e.layers.push(layer);
    }

    clear_duplicate_psd_raster_proxy_baselines(&mut e.layers);

    if e.layers.is_empty() {
        e.layers.push(Layer::transparent(1, "Background", cw, ch));
        max_id = 1;
    }
    e.next_id = max_id + 1;
    e.active = e.layers.len() - 1;
    e.depth = match gfx.depth {
        16 => 16,
        32 => 32,
        _ => 8,
    };
    e.mode = match gfx.color_mode {
        monet_format::import::ColorMode::Grayscale => 1,
        monet_format::import::ColorMode::Cmyk => 2,
        monet_format::import::ColorMode::Lab => 3,
        monet_format::import::ColorMode::Multichannel => 4,
        _ => 0,
    };
    e.composite(); // also rasterizes vector layers via the ensure_vector sweep
    e
}

/// Export the Engine's current layer stack to a unified graphics document.
pub(crate) fn to_gfx(e: &Engine) -> GfxDocument {
    let mut gfx = to_gfx_without_document_channels(e);
    gfx.channels = e
        .document_channels
        .iter()
        .map(|channel| GfxDocumentChannel::inline(channel, e.w, e.h, e.depth))
        .collect();
    gfx
}

pub(crate) fn to_gfx_without_document_channels(e: &Engine) -> GfxDocument {
    let (cw, ch) = (e.w, e.h);
    let depth = e.depth;
    let layers = e
        .layers
        .iter()
        .map(|layer| {
            let kind = match layer.kind {
                1 => GfxLayerKind::Adjustment,
                2 => GfxLayerKind::Text,
                3 => GfxLayerKind::Vector,
                6 => GfxLayerKind::Group,
                7 => GfxLayerKind::SmartObject,
                _ => GfxLayerKind::Raster,
            };
            let (blend, pass_through) = engine_blend_to_import(layer.blend.to_u8());

            let mut raster = monet_format::graphics::RasterPayload::default();
            if matches!(layer.kind, 0 | 2 | 4 | 7) {
                // Raster offsets are not a separate GFX field, so fold them
                // into the emitted local rectangle without mutating the layer.
                // A checked failure or malformed plane emits no pixel payload
                // instead of relabelling bytes with unsafe dimensions.
                if let Some(bounds) =
                    super::checked_translate_bounds(layer.pixel_bounds, layer.ox, layer.oy)
                {
                    raster.bounds = bounds;
                    let sample_len = super::checked_plane_len(layer.pixel_bounds, 4);
                    if bounds.w > 0 && bounds.h > 0 && sample_len == Some(layer.pixels.len()) {
                        if depth == 32 {
                            if layer.pixels_f32.len() == layer.pixels.len() {
                                // Native float authority is encoded directly.
                                // The u16 layer buffer is only a display proxy.
                                let data = base64_encode(
                                    &deflate_f32_le(&layer.pixels_f32).unwrap_or_default(),
                                );
                                raster.pixels = Some(PixelRef::Base64 {
                                    data,
                                    w: bounds.w,
                                    h: bounds.h,
                                    bits: 32,
                                });
                            }
                        } else if depth > 8 {
                            let data = base64_encode(&deflate_u16_le(&layer.pixels));
                            raster.pixels = Some(PixelRef::Base64 {
                                data,
                                w: bounds.w,
                                h: bounds.h,
                                bits: 16,
                            });
                        } else {
                            let rgba: Vec<u8> = layer.pixels.iter().copied().map(down16).collect();
                            raster.pixels = Some(PixelRef::Base64 {
                                data: base64_encode(&rgba),
                                w: bounds.w,
                                h: bounds.h,
                                bits: 8,
                            });
                        }
                    }
                }
            }

            let vector = if layer.kind == 3 {
                layer
                    .vector_scene
                    .as_deref()
                    .map(|s| monet_format::graphics::VectorPayload {
                        scene: serde_json::to_value(s).unwrap_or(Value::Null),
                        text_as_outline: true,
                    })
            } else {
                None
            };

            let mut extra = serde_json::Map::new();
            if layer.kind == 1 || layer.kind == 4 || layer.kind == 6 {
                extra.insert("engineAdjKind".into(), Value::from(layer.adj_kind));
                extra.insert(
                    "engineAdjParams".into(),
                    serde_json::to_value(&layer.adj_params).unwrap_or(Value::Null),
                );
            }
            if layer.kind == 4 {
                extra.insert("engineKind".into(), Value::from(4));
                if layer.adj_kind == 2 && !layer.smart_src.is_empty() {
                    extra.insert(
                        "engineFillSource".into(),
                        Value::from(base64_encode(&deflate_u16_le(&layer.smart_src))),
                    );
                }
            }
            if layer.kind == 7 && !layer.smart_src_f32.is_empty() {
                extra.insert(
                    "engineSmartSourceF32".into(),
                    Value::from(base64_encode(
                        &deflate_f32_le(&layer.smart_src_f32).unwrap_or_default(),
                    )),
                );
            }
            if layer.kind == 2 && !layer.text_spec.is_empty() {
                extra.insert(
                    "engineTextSpec".into(),
                    Value::from(layer.text_spec.clone()),
                );
            }
            if !layer.effects.is_empty() {
                extra.insert(
                    "engineEffects".into(),
                    serde_json::to_value(&layer.effects).unwrap_or(Value::Null),
                );
            }
            if !layer.psd_smart_blocks.is_empty() {
                extra.insert(
                    PSD_SMART_BLOCKS_EXTRA.into(),
                    psd_blocks_json(&layer.psd_smart_blocks),
                );
            }
            if has_psd_raster_proxy_blocks(layer) {
                if let Some(baseline) = layer.psd_raster_proxy_baseline {
                    extra.insert(
                        PSD_RASTER_PROXY_BASELINE_EXTRA.into(),
                        Value::from(base64_encode(&baseline)),
                    );
                }
            }

            let mask = layer.mask_for_export(cw, ch);

            let blend_if = if layer.blend_if.len() == 32 {
                let mut a = [0.0f32; 32];
                a.copy_from_slice(&layer.blend_if);
                Some(a)
            } else {
                None
            };

            GfxLayer {
                id: layer.id,
                parent: if layer.group == 0 {
                    None
                } else {
                    Some(layer.group)
                },
                name: layer.name.clone(),
                kind,
                opacity: layer.opacity,
                fill_opacity: layer.fill_opacity,
                blend,
                visible: layer.visible,
                clipping: layer.clipping,
                locked: layer.locked,
                knockout: layer.knockout,
                blend_if,
                pass_through,
                mask,
                transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                raster,
                vector,
                extra,
            }
        })
        .collect();

    // Start from the carried envelope so foreign top-level fields survive; the
    // engine-owned PSD key is written last and always wins.
    let mut extra = e.gfx_envelope.extra.clone();
    if !e.psd_linked_blocks.is_empty() {
        extra.insert(
            PSD_LINKED_BLOCKS_EXTRA.into(),
            psd_blocks_json(&e.psd_linked_blocks),
        );
    }
    GfxDocument {
        id: e.gfx_envelope.id.clone(),
        name: e.gfx_envelope.name.clone(),
        width: cw,
        height: ch,
        depth: e.depth,
        color_mode: match e.mode {
            1 => monet_format::import::ColorMode::Grayscale,
            2 => monet_format::import::ColorMode::Cmyk,
            3 => monet_format::import::ColorMode::Lab,
            4 => monet_format::import::ColorMode::Multichannel,
            _ => monet_format::import::ColorMode::Rgb,
        },
        layers,
        channels: Vec::new(),
        source: e.gfx_envelope.source,
        icc_profile: e.gfx_envelope.icc_profile.clone(),
        icc_profile_name: e.gfx_envelope.icc_profile_name.clone(),
        data: e.gfx_envelope.data.clone(),
        extra,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use monet_format::graphics::{
        base64_encode, deflate_u16_le, GfxLayer, RasterPayload, VectorPayload,
    };
    use monet_format::import::{
        Adjustment, BlendMode as ImportBlend, Bounds, Color3, ColorMode,
        Document as ImportDocument, Effect, Layer as ImportLayer, LayerKind, SourceFormat,
    };

    fn rgba8(r: u8, g: u8, b: u8, a: u8) -> Vec<u8> {
        vec![r, g, b, a]
    }

    fn proxy_layer(id: u32) -> Layer {
        let mut layer = Layer::transparent(id, "Proxy", 2, 1);
        layer.pixel_bounds = Bounds {
            x: -2,
            y: 3,
            w: 2,
            h: 1,
        };
        layer.pixels = vec![
            257, 514, 771, 65_535, 1028, 1285, 1542, 32_896,
        ].into();
        layer.psd_smart_blocks = vec![
            PsdTaggedBlock {
                key: *b"vmsk",
                data: vec![1, 2, 3],
            },
            PsdTaggedBlock {
                key: *b"SoCo",
                data: vec![4, 5, 6, 7],
            },
        ];
        layer
    }

    #[test]
    fn raster_proxy_fingerprint_binds_authority_content_identity_and_effective_geometry() {
        let layer = proxy_layer(91);
        let baseline = psd_raster_proxy_fingerprint(&layer, 8, 6, 8).unwrap();

        let mut unrelated = layer.clone();
        unrelated.name = "Renamed".into();
        unrelated.opacity = 0.25;
        unrelated.mask = vec![17; 8 * 6].into();
        assert_eq!(
            psd_raster_proxy_fingerprint(&unrelated, 8, 6, 8),
            Some(baseline),
            "outer layer semantics do not belong to the opaque proxy authority"
        );

        let mut offset = layer.clone();
        offset.ox = 5;
        offset.oy = -4;
        let mut baked = layer.clone();
        baked.pixel_bounds.x += 5;
        baked.pixel_bounds.y -= 4;
        assert_eq!(
            psd_raster_proxy_fingerprint(&offset, 8, 6, 8),
            psd_raster_proxy_fingerprint(&baked, 8, 6, 8),
            "live and baked placement have one canonical fingerprint"
        );
        assert_ne!(
            psd_raster_proxy_fingerprint(&offset, 8, 6, 8),
            Some(baseline)
        );

        let mut pixel_edit = layer.clone();
        Arc::make_mut(&mut pixel_edit.pixels)[0] ^= 1;
        assert_ne!(
            psd_raster_proxy_fingerprint(&pixel_edit, 8, 6, 8),
            Some(baseline)
        );
        let mut descriptor_edit = layer.clone();
        descriptor_edit.psd_smart_blocks[0].data[0] ^= 1;
        assert_ne!(
            psd_raster_proxy_fingerprint(&descriptor_edit, 8, 6, 8),
            Some(baseline)
        );
        let mut duplicate = layer.clone();
        duplicate.id += 1;
        assert_ne!(
            psd_raster_proxy_fingerprint(&duplicate, 8, 6, 8),
            Some(baseline)
        );
        assert_ne!(
            psd_raster_proxy_fingerprint(&layer, 9, 6, 8),
            Some(baseline)
        );
        assert_ne!(
            psd_raster_proxy_fingerprint(&layer, 8, 6, 16),
            Some(baseline)
        );

        let mut float = layer.clone();
        float.pixels_f32 = float
            .pixels
            .iter()
            .map(|sample| *sample as f32 / 65_535.0)
            .collect();
        let float_baseline = psd_raster_proxy_fingerprint(&float, 8, 6, 32).unwrap();
        Arc::make_mut(&mut float.pixels_f32)[0] = f32::from_bits(float.pixels_f32[0].to_bits() + 1);
        assert_ne!(
            psd_raster_proxy_fingerprint(&float, 8, 6, 32),
            Some(float_baseline)
        );

        let mut vector_mask = layer.clone();
        vector_mask
            .psd_smart_blocks
            .retain(|block| matches!(&block.key, b"vmsk" | b"vsms"));
        let vector_mask_baseline =
            psd_raster_proxy_fingerprint(&vector_mask, 8, 6, 8).unwrap();
        Arc::make_mut(&mut vector_mask.pixels)[0] ^= 257;
        assert_eq!(
            psd_raster_proxy_fingerprint(&vector_mask, 8, 6, 8),
            Some(vector_mask_baseline),
            "an independent vector mask does not own raster sample content"
        );
        assert_eq!(
            psd_raster_proxy_fingerprint(&vector_mask, 8, 6, 32),
            Some(vector_mask_baseline),
            "an independent vector mask does not own document sample depth"
        );
        vector_mask.ox += 1;
        assert_ne!(
            psd_raster_proxy_fingerprint(&vector_mask, 8, 6, 8),
            Some(vector_mask_baseline),
            "vector-mask authority remains geometry-bound"
        );
    }

    fn gfx_raster_layer(id: u32, bounds: Bounds, pixels: PixelRef) -> GfxLayer {
        GfxLayer {
            id,
            parent: None,
            name: format!("Raster {id}"),
            kind: GfxLayerKind::Raster,
            opacity: 1.0,
            fill_opacity: 1.0,
            blend: ImportBlend::Normal,
            visible: true,
            clipping: false,
            locked: false,
            knockout: 0,
            blend_if: None,
            pass_through: false,
            mask: None,
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            raster: RasterPayload {
                bounds,
                pixels: Some(pixels),
                ..Default::default()
            },
            vector: None,
            extra: serde_json::Map::new(),
        }
    }

    fn gfx_document(depth: u8, layers: Vec<GfxLayer>) -> GfxDocument {
        GfxDocument {
            id: "off-canvas".into(),
            name: "Off-canvas".into(),
            width: 3,
            height: 2,
            depth,
            color_mode: ColorMode::Rgb,
            layers,
            channels: Vec::new(),
            source: None,
            icc_profile: None,
            icc_profile_name: None,
            data: None,
            extra: serde_json::Map::new(),
        }
    }

    fn assert_local_payload(
        layer: &Layer,
        bounds: Bounds,
        expected_u16: &[u16],
        expected_f32: &[f32],
    ) {
        assert_eq!(layer.pixel_bounds, bounds);
        assert_eq!(layer.pixels.to_vec(), expected_u16);
        assert_eq!(
            layer
                .pixels_f32
                .iter()
                .map(|value| value.to_bits())
                .collect::<Vec<_>>(),
            expected_f32
                .iter()
                .map(|value| value.to_bits())
                .collect::<Vec<_>>()
        );
    }

    fn source_pixels(depth: u8, seed: &[u8]) -> (PixelRef, Vec<u16>, Vec<f32>) {
        match depth {
            32 => {
                let values: Vec<f32> = seed
                    .chunks_exact(4)
                    .flat_map(|pixel| {
                        [
                            pixel[0] as f32 / 16.0 - 0.5,
                            pixel[1] as f32 / 16.0,
                            pixel[2] as f32 / 8.0,
                            pixel[3] as f32 / 255.0,
                        ]
                    })
                    .collect();
                (
                    PixelRef::Base64 {
                        data: base64_encode(&deflate_f32_le(&values).unwrap()),
                        w: 2,
                        h: 2,
                        bits: 32,
                    },
                    float_preview(&values),
                    values,
                )
            }
            16 => {
                let values: Vec<u16> = seed
                    .iter()
                    .enumerate()
                    .map(|(index, value)| u16::from(*value) * 251 + index as u16)
                    .collect();
                (
                    PixelRef::Base64 {
                        data: base64_encode(&deflate_u16_le(&values)),
                        w: 2,
                        h: 2,
                        bits: 16,
                    },
                    values,
                    Vec::new(),
                )
            }
            _ => (
                PixelRef::Base64 {
                    data: base64_encode(seed),
                    w: 2,
                    h: 2,
                    bits: 8,
                },
                widen_rgba8(seed),
                Vec::new(),
            ),
        }
    }

    #[test]
    fn layered_fixtures_import_composite_and_query_layers() {
        let fixtures: [(&str, &[u8], usize); 3] = [
            (
                "sample.psd",
                include_bytes!("../../../monet-ui/crates/monet-format/test-assets/fixtures/sample.psd"),
                8,
            ),
            (
                "sample.psb",
                include_bytes!("../../../monet-ui/crates/monet-format/test-assets/fixtures/sample.psb"),
                8,
            ),
            (
                "sample.xcf",
                include_bytes!("../../../monet-ui/crates/monet-format/test-assets/fixtures/sample.xcf"),
                4,
            ),
        ];

        for (name, bytes, expected_layers) in fixtures {
            let mut engine = Engine::from_format(bytes)
                .unwrap_or_else(|_| panic!("{name} should import through Engine::from_format"));
            engine.composite();
            assert_eq!((engine.width(), engine.height()), (16, 16), "{name}");
            assert_eq!(engine.layer_count(), expected_layers, "{name}");
            assert_eq!(engine.output.len(), 16 * 16 * 4, "{name}");
            for index in 0..engine.layer_count() {
                let id = engine.layer_id_at(index);
                assert_ne!(id, 0, "{name} layer {index}");
                assert!(!engine.layer_name(id).is_empty(), "{name} layer {index}");
                let _ = engine.layer_kind(id);
                let _ = engine.layer_text_spec(id);
                assert_eq!(engine.layer_thumb(id, 44, 44).len(), 44 * 44 * 4);
            }
        }
    }

    #[test]
    fn negative_bounds_ir_round_trip_preserves_local_8_16_32_payloads() {
        let bounds = Bounds {
            x: -1,
            y: -1,
            w: 2,
            h: 2,
        };
        let seed = [
            1, 2, 3, 255, 17, 18, 19, 128, 33, 34, 35, 64, 49, 50, 51, 255,
        ];

        for depth in [8, 16, 32] {
            let (_, expected_u16, expected_f32) = source_pixels(depth, &seed);
            let mut doc = ImportDocument::new(3, 2, SourceFormat::Psd);
            doc.depth = depth;
            let mut source = ImportLayer::new(1, "Local", LayerKind::Raster, bounds);
            match depth {
                32 => source.rgba32 = expected_f32.clone(),
                16 => source.rgba16 = expected_u16.clone(),
                _ => source.rgba = seed.to_vec(),
            }
            doc.layers.push(source);

            let engine = from_doc(doc);
            assert_local_payload(&engine.layers[0], bounds, &expected_u16, &expected_f32);
            assert_eq!(
                &engine.output[..4],
                &expected_u16[12..16]
                    .iter()
                    .copied()
                    .map(down16)
                    .collect::<Vec<_>>(),
                "canvas (0,0) samples local (1,1) for depth {depth}"
            );

            let gfx = to_gfx(&engine);
            assert_eq!(gfx.layers[0].raster.bounds, bounds);
            match gfx.layers[0].raster.pixels.as_ref().unwrap() {
                PixelRef::Base64 { data, w, h, bits } => {
                    assert_eq!((*w, *h, *bits), (2, 2, depth));
                    let raw = base64_decode(data).unwrap();
                    match depth {
                        32 => assert_eq!(
                            inflate_f32_le(&raw, expected_f32.len())
                                .unwrap()
                                .iter()
                                .map(|value| value.to_bits())
                                .collect::<Vec<_>>(),
                            expected_f32
                                .iter()
                                .map(|value| value.to_bits())
                                .collect::<Vec<_>>()
                        ),
                        16 => assert_eq!(
                            inflate_u16_le(&raw, expected_u16.len()).unwrap(),
                            expected_u16
                        ),
                        _ => assert_eq!(raw, seed),
                    }
                }
                other => panic!("expected inline precision payload, got {other:?}"),
            }

            let reopened = from_gfx(gfx).unwrap();
            assert_local_payload(&reopened.layers[0], bounds, &expected_u16, &expected_f32);
        }
    }

    #[test]
    fn negative_bounds_gfx_round_trip_preserves_local_8_16_32_payloads() {
        let bounds = Bounds {
            x: -2,
            y: -1,
            w: 2,
            h: 2,
        };
        let seed = [
            3, 5, 7, 255, 11, 13, 17, 192, 19, 23, 29, 96, 31, 37, 41, 255,
        ];

        for depth in [8, 16, 32] {
            let (pixels, expected_u16, expected_f32) = source_pixels(depth, &seed);
            let engine = from_gfx(gfx_document(
                depth,
                vec![gfx_raster_layer(1, bounds, pixels)],
            ))
            .unwrap();
            assert_local_payload(&engine.layers[0], bounds, &expected_u16, &expected_f32);
            assert!(
                engine.output.iter().all(|channel| *channel == 0),
                "an entirely off-canvas local plane stays transparent at depth {depth}"
            );

            let round_trip = to_gfx(&engine);
            assert_eq!(round_trip.layers[0].raster.bounds, bounds);
            assert!(matches!(
                round_trip.layers[0].raster.pixels.as_ref(),
                Some(PixelRef::Base64 {
                    w: 2,
                    h: 2,
                    bits,
                    ..
                }) if *bits == depth
            ));
            let reopened = from_gfx(round_trip).unwrap();
            assert_local_payload(&reopened.layers[0], bounds, &expected_u16, &expected_f32);
        }
    }

    #[test]
    fn gfx_pixel_refs_require_matching_checked_dimensions_and_exact_lengths() {
        let bounds = Bounds {
            x: -1,
            y: 0,
            w: 2,
            h: 2,
        };
        let exact = vec![7u8; 2 * 2 * 4];
        let layers = vec![
            gfx_raster_layer(
                1,
                bounds,
                PixelRef::Base64 {
                    data: base64_encode(&exact),
                    w: 1,
                    h: 4,
                    bits: 8,
                },
            ),
            gfx_raster_layer(
                2,
                bounds,
                PixelRef::Base64 {
                    data: base64_encode(&exact[..exact.len() - 1]),
                    w: 2,
                    h: 2,
                    bits: 8,
                },
            ),
            gfx_raster_layer(
                3,
                bounds,
                PixelRef::Base64 {
                    data: base64_encode(&exact),
                    w: 2,
                    h: 2,
                    bits: 12,
                },
            ),
            gfx_raster_layer(
                4,
                Bounds::default(),
                PixelRef::Base64 {
                    data: String::new(),
                    w: u32::MAX,
                    h: 2,
                    bits: 8,
                },
            ),
            gfx_raster_layer(
                5,
                Bounds::default(),
                PixelRef::Base64 {
                    data: base64_encode(&exact),
                    w: 2,
                    h: 2,
                    bits: 8,
                },
            ),
        ];

        let engine = from_gfx(gfx_document(8, layers)).unwrap();
        for index in 0..3 {
            assert_eq!(engine.layers[index].pixel_bounds, bounds);
            assert!(engine.layers[index].pixels.is_empty());
        }
        assert_eq!(engine.layers[3].pixel_bounds, Bounds::default());
        assert!(engine.layers[3].pixels.is_empty());
        assert_eq!(
            engine.layers[4].pixel_bounds,
            Bounds {
                x: 0,
                y: 0,
                w: 2,
                h: 2
            },
            "legacy zero bounds infer the validated PixelRef dimensions"
        );
        assert_eq!(engine.layers[4].pixels.to_vec(), widen_rgba8(&exact));
    }

    #[test]
    fn oversized_graphics_document_dimensions_are_rejected_instead_of_panicking() {
        // (#89) The manifest size is untrusted; before the dims_ok gate these
        // reached Layer::transparent and panicked (an unrecoverable wasm trap).
        let layer = || {
            vec![gfx_raster_layer(
                1,
                Bounds::default(),
                PixelRef::Base64 {
                    data: String::new(),
                    w: 0,
                    h: 0,
                    bits: 8,
                },
            )]
        };

        let mut over_dim = gfx_document(8, layer());
        over_dim.width = 40_000;
        assert!(from_gfx(over_dim)
            .err()
            .expect("oversized width rejected")
            .contains("dimensions exceed engine limits"));

        // Within MAX_DIM per side but over the total pixel budget.
        let mut over_pixels = gfx_document(8, layer());
        over_pixels.width = 10_000;
        over_pixels.height = 10_000;
        assert!(from_gfx(over_pixels)
            .err()
            .expect("oversized pixel count rejected")
            .contains("dimensions exceed engine limits"));

        // A sane document still loads.
        assert!(from_gfx(gfx_document(8, layer())).is_ok());
    }

    #[test]
    fn to_gfx_folds_offsets_into_local_bounds_without_relabelling_dimensions() {
        let mut engine = Engine::new(4, 3);
        engine.depth = 8;
        engine.layers[0].pixel_bounds = Bounds {
            x: -2,
            y: -1,
            w: 2,
            h: 1,
        };
        engine.layers[0].pixels = widen_rgba8(&[1, 2, 3, 255, 4, 5, 6, 255]).into();
        engine.layers[0].ox = 3;
        engine.layers[0].oy = -2;

        let gfx = to_gfx(&engine);
        assert_eq!(
            gfx.layers[0].raster.bounds,
            Bounds {
                x: 1,
                y: -3,
                w: 2,
                h: 1
            }
        );
        assert!(matches!(
            gfx.layers[0].raster.pixels.as_ref(),
            Some(PixelRef::Base64 {
                w: 2,
                h: 1,
                bits: 8,
                ..
            })
        ));

        engine.layers[0].pixel_bounds.x = 1;
        engine.layers[0].ox = i32::MAX;
        let overflow = to_gfx(&engine);
        assert_eq!(overflow.layers[0].raster.bounds, Bounds::default());
        assert!(overflow.layers[0].raster.pixels.is_none());
    }

    fn all_effects() -> Vec<Effect> {
        vec![
            Effect::DropShadow {
                blend: ImportBlend::Multiply,
                opacity: 0.7,
                color: Color3::new(0.0, 0.0, 0.0),
                angle: 135.0,
                distance: 2.0,
                spread: 0.2,
                size: 1.0,
            },
            Effect::InnerShadow {
                blend: ImportBlend::Multiply,
                opacity: 0.5,
                color: Color3::new(0.1, 0.1, 0.1),
                angle: 45.0,
                distance: 1.0,
                choke: 0.2,
                size: 1.0,
            },
            Effect::OuterGlow {
                blend: ImportBlend::Screen,
                opacity: 0.6,
                color: Color3::new(1.0, 0.8, 0.1),
                spread: 0.1,
                size: 2.0,
            },
            Effect::InnerGlow {
                blend: ImportBlend::Screen,
                opacity: 0.4,
                color: Color3::new(0.2, 0.6, 1.0),
                choke: 0.1,
                size: 2.0,
                center: true,
            },
            Effect::Bevel {
                hl_blend: ImportBlend::Screen,
                hl_opacity: 0.8,
                hl_color: Color3::new(1.0, 1.0, 1.0),
                sh_blend: ImportBlend::Multiply,
                sh_opacity: 0.7,
                sh_color: Color3::new(0.0, 0.0, 0.0),
                angle: 135.0,
                altitude: 45.0,
                depth: 1.0,
                size: 2.0,
                soften: 1.0,
                style: 2,
            },
            Effect::Satin {
                blend: ImportBlend::Multiply,
                opacity: 0.3,
                color: Color3::new(0.4, 0.2, 0.7),
                angle: 45.0,
                distance: 2.0,
                size: 1.0,
                invert: true,
            },
            Effect::ColorOverlay {
                blend: ImportBlend::Normal,
                opacity: 0.5,
                color: Color3::new(1.0, 0.0, 0.0),
            },
            Effect::GradientOverlay {
                blend: ImportBlend::Normal,
                opacity: 0.5,
                angle: 0.0,
                scale: 1.0,
                radial: true,
                reverse: true,
                start: Color3::new(0.0, 0.0, 0.0),
                end: Color3::new(1.0, 1.0, 1.0),
            },
            Effect::PatternOverlay {
                blend: ImportBlend::Overlay,
                opacity: 0.5,
                scale: 3.0,
                kind: 2,
            },
            Effect::Stroke {
                blend: ImportBlend::Normal,
                opacity: 1.0,
                color: Color3::new(0.0, 0.0, 0.0),
                size: 2.0,
                position: 1,
            },
        ]
    }

    fn all_adjustments() -> Vec<Adjustment> {
        vec![
            Adjustment::BrightnessContrast {
                brightness: 0.25,
                contrast: -0.5,
            },
            Adjustment::Levels {
                in_black: 0.1,
                in_white: 0.9,
                gamma: 1.25,
                out_black: 0.05,
                out_white: 0.95,
            },
            Adjustment::HueSaturation {
                hue: 45.0,
                saturation: 0.2,
                lightness: -0.1,
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
                vibrance: 0.4,
                saturation: -0.2,
            },
            Adjustment::Invert,
            Adjustment::Desaturate,
            Adjustment::BlackWhite {
                r: 0.3,
                g: 0.59,
                b: 0.11,
            },
            Adjustment::BlackWhiteFull {
                bands: [0.4, 0.6, 0.35, 0.8, 0.2, -0.15],
                tint: true,
                tint_hue: 40.0,
                tint_saturation: 0.4,
            },
            Adjustment::Posterize { levels: 7.0 },
            Adjustment::Threshold { level: 0.5 },
            Adjustment::Exposure {
                exposure: 1.5,
                offset: -0.05,
                gamma: 0.9,
            },
            Adjustment::ColorBalance {
                shadows: [-0.1, 0.2, -0.3],
                midtones: [0.4, -0.5, 0.6],
                highlights: [-0.7, 0.8, -0.9],
            },
            Adjustment::PhotoFilter {
                color: Color3::new(1.0, 0.5, 0.25),
                density: 0.65,
            },
            Adjustment::Curves {
                lut: (0..256).map(|value| value as f32 / 255.0).collect(),
            },
            Adjustment::GradientMap {
                lut: (0..256 * 3)
                    .map(|value| value as f32 / (256.0 * 3.0 - 1.0))
                    .collect(),
            },
        ]
    }

    #[test]
    fn photoshop_semantic_adapter_round_trips_every_adjustment_and_effect() {
        for expected in all_adjustments() {
            let mut layer = Layer::transparent(41, "Adjustment", 4, 3);
            layer.kind = 1;
            (layer.adj_kind, layer.adj_params) = map_adjustment(&expected);

            let semantic = to_import_layer_for_photoshop(&layer, 4, 3, 8)
                .expect("mapped adjustment has an exact semantic inverse");
            assert_eq!(semantic.kind, LayerKind::Adjustment);
            assert_eq!(semantic.adjustment, Some(expected));
        }

        let expected = all_effects();
        let mut layer = Layer::transparent(42, "Effects", 4, 3);
        layer.effects = map_effects(&expected);
        let semantic = to_import_layer_for_photoshop(&layer, 4, 3, 8)
            .expect("mapped effects have exact semantic inverses");
        assert_eq!(semantic.effects, expected);

        let error = monet_format::import::reconcile_psd_layer_blocks(&semantic, &[])
            .expect_err("Pattern Overlay stays represented for the semantic reconciler");
        assert!(error.to_string().contains("pattern"));
    }

    #[test]
    fn black_white_widened_payloads_are_full_legacy_or_rejected_without_loss() {
        let mut layer = Layer::transparent(51, "Black & White", 2, 2);
        layer.kind = 1;
        layer.adj_kind = 6;

        layer.adj_params = vec![
            1.0, 0.0, 0.0, 0.4, 0.6, 0.35, 0.8, 0.2, -0.15, 1.0, 40.0, 0.4,
        ];
        assert_eq!(
            unmap_adjustment(&layer).unwrap(),
            Adjustment::BlackWhiteFull {
                bands: [0.4, 0.6, 0.35, 0.8, 0.2, -0.15],
                tint: true,
                tint_hue: 40.0,
                tint_saturation: 0.4,
            },
        );

        layer.adj_params = vec![
            -1.0, 0.0, 0.0, -0.2, -0.5, -0.3, -0.8, -0.5, -0.7, 0.0, 40.0, 0.2,
        ];
        assert_eq!(
            unmap_adjustment(&layer).unwrap(),
            Adjustment::BlackWhite {
                r: -0.2,
                g: -0.3,
                b: -0.5,
            },
            "signed migrated weights retain their normalized pixel coefficients",
        );

        layer.adj_params = vec![
            0.5, 0.0, 0.0, 0.6, 0.4, -0.2, -0.1, 0.1, 0.7, 0.0, 40.0, 0.2,
        ];
        let Adjustment::BlackWhite { r, g, b } = unmap_adjustment(&layer).unwrap() else {
            panic!("denominator-floor migration must use the legacy semantic variant");
        };
        assert!((r - 0.00006).abs() < 1e-8, "red {r}");
        assert!((g + 0.00002).abs() < 1e-8, "green {g}");
        assert!((b - 0.00001).abs() < 1e-8, "blue {b}");

        layer.adj_params = vec![
            0.5, 0.0, 0.0, 0.4, 0.6, 0.35, 0.8, 0.2, -0.15, 0.0, 40.0, 0.2,
        ];
        let error = unmap_adjustment(&layer).unwrap_err();
        assert!(error.contains("neutral multiplier"), "{error}");

        layer.adj_params = vec![
            1.0, 0.1, 0.0, 0.4, 0.6, 0.35, 0.8, 0.2, -0.15, 0.0, 40.0, 0.2,
        ];
        let error = unmap_adjustment(&layer).unwrap_err();
        assert!(error.contains("reserved values"), "{error}");
    }

    #[test]
    fn psd_and_psb_export_reimport_widened_hue_and_black_white_layers() {
        let hue = [
            210.0, 0.6, -0.1, 1.0, 10.0, 0.2, -0.1, -20.0, -0.3, 0.4, 30.0, 0.0,
            0.0, 0.0, 0.1, -0.2, -15.0, 0.5, 0.25, 45.0, -0.4, -0.5,
        ];
        let black_white = [
            1.0, 0.0, 0.0, 0.4, 0.6, 0.35, 0.8, 0.2, -0.15, 1.0, 40.0, 0.4,
        ];

        for force_psb in [false, true] {
            let mut engine = Engine::new(2, 2);
            engine.add_adjustment_layer(2, &hue, "Full Hue");
            engine.add_adjustment_layer(6, &black_white, "Full Black & White");
            let bytes = engine
                .try_export_photoshop_with_profile_tag_and_icc(
                    force_psb, false, false, None,
                )
                .unwrap_or_else(|error| panic!("PSB={force_psb} export failed: {error}"));
            let parsed = monet_format::import::parse(&bytes)
                .unwrap_or_else(|error| panic!("PSB={force_psb} re-import failed: {error}"));
            assert_eq!(parsed.source, if force_psb { SourceFormat::Psb } else { SourceFormat::Psd });
            let mut reopened = from_doc(parsed);

            for (name, expected) in [
                ("Full Hue", hue.as_slice()),
                ("Full Black & White", black_white.as_slice()),
            ] {
                let actual = &reopened
                    .layers
                    .iter()
                    .find(|layer| layer.name == name)
                    .unwrap_or_else(|| panic!("PSB={force_psb} missing {name}"))
                    .adj_params;
                assert_eq!(actual.len(), expected.len(), "PSB={force_psb} {name}");
                for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
                    assert!(
                        (actual - expected).abs() < 1e-3,
                        "PSB={force_psb} {name} param {index}: {actual} vs {expected}",
                    );
                }
            }
            reopened
                .try_export_photoshop_with_profile_tag_and_icc(
                    force_psb, false, false, None,
                )
                .unwrap_or_else(|error| {
                    panic!("PSB={force_psb} untouched re-export failed: {error}")
                });
        }
    }

    #[test]
    fn photoshop_semantic_adapter_encodes_previously_unsupported_adjustments() {
        for (expected, key) in [
            (Adjustment::Desaturate, *b"hue2"),
            (
                Adjustment::PhotoFilter {
                    color: Color3::new(0.1, 0.2, 0.3),
                    density: 0.4,
                },
                *b"phfl",
            ),
            (
                Adjustment::Curves {
                    lut: vec![0.5; 256],
                },
                *b"curv",
            ),
            (
                Adjustment::GradientMap {
                    lut: vec![0.25; 256 * 3],
                },
                *b"grdm",
            ),
        ] {
            let mut layer = Layer::transparent(43, "Adjustment", 2, 2);
            layer.kind = 1;
            (layer.adj_kind, layer.adj_params) = map_adjustment(&expected);
            let semantic = to_import_layer_for_photoshop(&layer, 2, 2, 8)
                .expect("neutral IR represents the adjustment");
            assert_eq!(semantic.adjustment, Some(expected));
            let blocks = monet_format::import::reconcile_psd_layer_blocks(&semantic, &[])
                .expect("the adjustment now has a PSD encoder");
            assert!(
                blocks.iter().any(|block| block.key == key),
                "missing {:?} block",
                String::from_utf8_lossy(&key)
            );
        }
    }

    #[test]
    fn vision_default_layer_styles_export_as_photoshop() {
        let defaults: &[(u8, &[f32])] = &[
            (0, &[1.0, 3.0, 0.75, 0.0, 0.0, 0.0, 120.0, 10.0, 0.0, 10.0, 0.0, 1.0, 0.0]),
            (1, &[1.0, 3.0, 0.75, 0.0, 0.0, 0.0, 120.0, 8.0, 0.0, 8.0, 0.0, 0.0]),
            (2, &[1.0, 7.0, 0.75, 1.0, 1.0, 0.6, 0.0, 14.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.4, 0.0]),
            (3, &[1.0, 7.0, 0.75, 1.0, 1.0, 0.6, 0.0, 12.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.4, 0.0]),
            (4, &[1.0, 7.0, 0.75, 1.0, 1.0, 1.0, 3.0, 0.75, 0.0, 0.0, 0.0, 120.0, 30.0, 1.0, 8.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 16.0, 1.0, 0.0]),
            (5, &[1.0, 3.0, 0.5, 0.4, 0.2, 0.5, 19.0, 11.0, 14.0, 1.0, 0.0]),
            (6, &[1.0, 0.0, 1.0, 1.0, 0.0, 0.0]),
            (7, &[1.0, 0.0, 1.0, 90.0, 1.0, 0.0, 0.0, 0.1, 0.2, 0.6, 0.9, 0.4, 0.1, 0.0, 1.0, 0.0, 0.0, 0.0]),
            (9, &[1.0, 0.0, 1.0, 1.0, 0.1, 0.1, 3.0, 1.0, 0.0, 90.0, 1.0, 0.85, 0.1, 0.0, 16.0]),
        ];
        for (id, params) in defaults {
            let mut engine = Engine::new(4, 4);
            let layer = engine.add_layer("Styled");
            engine.set_layer_effect(layer, *id, params);
            engine
                .try_export_photoshop_with_profile_tag_and_icc(false, false, false, None)
                .unwrap_or_else(|error| {
                    panic!("Vision default effect {id} failed to export: {error}")
                });
        }
    }

    #[test]
    fn vision_default_adjustment_layers_export_as_photoshop() {
        let defaults: &[(u8, Vec<f32>)] = &[
            (0, vec![0.0, 0.0]),
            (1, vec![0.0, 1.0, 1.0, 0.0, 1.0]),
            (2, vec![0.0; 22]),
            (3, vec![0.0, 0.0]),
            (4, Vec::new()),
            (5, Vec::new()),
            (6, vec![1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
            (7, vec![6.0]),
            (8, vec![0.5]),
            (9, vec![0.0, 0.0, 1.0]),
            (10, vec![0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]),
            (11, vec![0.93, 0.54, 0.0, 0.25, 1.0]),
            (12, vec![0.0; 256]),
            (13, vec![0.0; 768]),
        ];
        for (kind, params) in defaults {
            let mut engine = Engine::new(4, 4);
            engine.add_adjustment_layer(*kind, params, "Adjustment");
            engine
                .try_export_photoshop_with_profile_tag_and_icc(false, false, false, None)
                .unwrap_or_else(|error| {
                    panic!("Vision default adjustment {kind} failed to export: {error}")
                });
        }
    }

    #[test]
    fn adjustments_without_a_neutral_ir_degrade_instead_of_failing_the_document() {
        for (kind, params) in [
            (14u8, vec![0.0; 12]),
            (15u8, vec![0.0; 37]),
            (16u8, vec![1.0]),
        ] {
            let mut engine = Engine::new(4, 4);
            engine.add_adjustment_layer(kind, &params, "Degraded");
            engine
                .try_export_photoshop_with_profile_tag_and_icc(false, false, false, None)
                .unwrap_or_else(|error| {
                    panic!("adjustment {kind} failed to export: {error}")
                });
        }
    }

    #[test]
    fn disabled_layer_styles_export_with_enab_false() {
        let mut engine = Engine::new(4, 4);
        let layer = engine.add_layer("Disabled");
        engine.set_layer_effect(layer, 6, &[0.0, 0.0, 1.0, 1.0, 0.0, 0.0]);
        let bytes = engine
            .try_export_photoshop_with_profile_tag_and_icc(false, false, false, None)
            .expect("a disabled effect exports");
        assert!(
            bytes.windows(9).any(|window| window == b"enabbool\x00"),
            "a disabled effect must write enab=false"
        );
    }

    #[test]
    fn stacked_layer_styles_export_as_multi_lists() {
        let mut engine = Engine::new(4, 4);
        let layer = engine.add_layer("Stacked");
        engine.set_layer_effect_at(layer, 9, 0, &[1.0, 0.0, 1.0, 1.0, 0.0, 0.0, 4.0, 0.0]);
        engine.set_layer_effect_at(layer, 9, 1, &[1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 2.0, 0.0]);
        let bytes = engine
            .try_export_photoshop_with_profile_tag_and_icc(false, false, false, None)
            .expect("stacked effects export");
        assert!(
            bytes.windows(9).any(|window| window == b"FrFXMulti"),
            "stacked strokes must write a FrFXMulti list"
        );
    }

    fn complete_text_spec(kind: &str, runs: Value) -> String {
        let mut value: Value = serde_json::from_str(
            r#"{
                "v":1,"kind":"point","vertical":false,"ax":7,"ay":-3,"runs":[],
                "font":"Inter","size":24.0,"color":[10,20,30,240],
                "bold":false,"italic":false,"tracking":0.0,"kerning":"metrics",
                "leading":0.0,"hScale":1.0,"vScale":1.0,"align":"left",
                "direction":"ltr","composer":"latin","boxW":180.0,"boxH":72.0,
                "firstIndent":0.0,"leftIndent":0.0,"rightIndent":0.0,
                "spaceBefore":0.0,"spaceAfter":0.0,"antialias":"smooth",
                "digits":"latin","kashida":"none","diacriticX":0.0,"diacriticY":0.0,
                "path":[],"liga":false,"dlig":false,"frac":false,"ordn":false,
                "features":{},"stroke":null,"shadow":null,
                "warp":{"style":"arc","bend":0.2,"h":-0.1,"v":0.3,"orient":"h"}
            }"#,
        )
        .unwrap();
        value["kind"] = Value::from(kind);
        value["align"] = Value::from(if kind == "paragraph" { "justify" } else { "left" });
        value["runs"] = runs;
        value.to_string()
    }

    #[test]
    fn photoshop_semantic_adapter_maps_plain_rich_and_paragraph_text_without_downgrade() {
        let mut plain = Layer::transparent(51, "Plain", 8, 6);
        plain.kind = 2;
        plain.text = "Plain text".into();
        plain.text_size = 18.0;
        plain.text_color = [1, 2, 3, 255];
        plain.text_x = 4;
        plain.text_y = 5;
        let plain_semantic = to_import_layer_for_photoshop(&plain, 8, 6, 8).unwrap();
        let plain_text = plain_semantic.text.as_ref().unwrap();
        assert_eq!(plain_text.string, "Plain text");
        assert!(plain_text.runs.is_empty());
        assert!(plain_text.point);
        monet_format::import::reconcile_psd_layer_blocks(&plain_semantic, &[])
            .expect("legacy plain text is Photoshop-encodable");

        let mut rich = Layer::transparent(52, "Rich", 8, 6);
        rich.kind = 2;
        rich.text_spec = complete_text_spec(
            "point",
            serde_json::json!([
                {
                    "text": "Rich",
                    "font": "Serif",
                    "size": 30.0,
                    "color": [200, 100, 50, 255],
                    "fauxBold": true,
                    "fauxItalic": true,
                    "underline": true,
                    "tracking": 1.5,
                    "hScale": 1.2,
                    "vScale": 0.9,
                    "baseline": 2.0,
                    "caps": "small"
                },
                { "text": " text", "fauxItalic": true, "strike": true }
            ]),
        );
        let rich_semantic = to_import_layer_for_photoshop(&rich, 8, 6, 8).unwrap();
        let rich_text = rich_semantic.text.as_ref().unwrap();
        assert_eq!(rich_text.string, "Rich text");
        assert_eq!(rich_text.runs.len(), 2);
        assert_eq!(rich_text.runs[0].font.as_deref(), Some("Serif"));
        assert!(rich_text.runs[0].faux_bold);
        assert!(rich_text.runs[0].faux_italic);
        assert!(rich_text.runs[0].underline);
        assert_eq!(rich_text.runs[0].caps, Some(1));
        assert!(rich_text.runs[1].faux_italic);
        assert!(rich_text.runs[1].strike);
        let rich_blocks = monet_format::import::reconcile_psd_layer_blocks(&rich_semantic, &[])
            .expect("supported rich runs produce Photoshop EngineData");
        assert_eq!(
            rich_blocks
                .iter()
                .filter(|block| block.key == *b"TySh")
                .count(),
            1
        );

        let mut paragraph = Layer::transparent(53, "Paragraph", 8, 6);
        paragraph.kind = 2;
        paragraph.text_spec = complete_text_spec(
            "paragraph",
            serde_json::json!([{ "text": "Paragraph text" }]),
        );
        let paragraph_semantic = to_import_layer_for_photoshop(&paragraph, 8, 6, 8).unwrap();
        let paragraph_text = paragraph_semantic.text.as_ref().unwrap();
        assert!(!paragraph_text.point);
        assert_eq!(paragraph_text.box_size, Some((180.0, 72.0)));
        assert_eq!(paragraph_text.align, 3);
        assert!(paragraph_text.runs.is_empty());
        let paragraph_blocks =
            monet_format::import::reconcile_psd_layer_blocks(&paragraph_semantic, &[])
                .expect("paragraph geometry produces Photoshop EngineData");
        assert_eq!(
            paragraph_blocks
                .iter()
                .filter(|block| block.key == *b"TySh")
                .count(),
            1
        );
    }

    #[test]
    fn photoshop_semantic_adapter_round_trips_representable_rich_text() {
        let expected = Text {
            string: "Styled text".into(),
            runs: vec![
                TextRun {
                    text: "Styled".into(),
                    font: Some("Serif".into()),
                    size: Some(30.0),
                    color: Some([120, 30, 220, 255]),
                    bold: true,
                    italic: false,
                    faux_bold: true,
                    faux_italic: false,
                    underline: true,
                    strike: false,
                    tracking: Some(1.5),
                    h_scale: Some(1.25),
                    v_scale: Some(0.75),
                    baseline: Some(2.0),
                    caps: Some(2),
                },
                TextRun {
                    text: " text".into(),
                    italic: true,
                    strike: true,
                    ..Default::default()
                },
            ],
            point: true,
            vertical: false,
            size: 24.0,
            color: [10, 20, 30, 240],
            font: Some("Inter".into()),
            align: 0,
            leading: 0.0,
            tracking: 0.0,
            origin: (7, -3),
            box_size: None,
            warp_style: 1,
            warp_bend: 0.25,
            warp_h: -0.125,
            warp_v: 0.5,
            antialias: 4,
        };
        let mut source = ImportDocument::new(8, 6, SourceFormat::Psd);
        let mut text_layer = ImportLayer::new(
            54,
            "Round-trip rich text",
            LayerKind::Text,
            Bounds {
                x: 1,
                y: 2,
                w: 5,
                h: 3,
            },
        );
        text_layer.text = Some(expected.clone());
        source.layers.push(text_layer);

        let engine = from_doc(source);
        let semantic = to_import_layer_for_photoshop(&engine.layers[0], 8, 6, 8).unwrap();
        assert_eq!(semantic.text, Some(expected));
    }

    #[test]
    fn photoshop_semantic_adapter_distinguishes_vector_masks_from_rendered_proxies() {
        let authority = Mask {
            x: -1,
            y: 0,
            w: 2,
            h: 1,
            data: vec![20, 220],
            data16: vec![1_000, 60_000],
            data32: Vec::new(),
            default: 17,
            disabled: true,
            relative: false,
            invert: true,
            density: Some(200),
            feather: Some(1.25),
            vector_density: Some(180),
            vector_feather: Some(2.5),
            real: None,
        };
        let mut vector = Layer::transparent(61, "Imported vector proxy", 2, 1);
        vector.pixel_bounds = Bounds {
            x: -2,
            y: 4,
            w: 2,
            h: 1,
        };
        vector.ox = 7;
        vector.oy = -3;
        vector.group = 9;
        vector.mask = super::super::expand_import_mask(&authority, 2, 1).unwrap().into();
        vector.mask_enabled = false;
        vector.mask_linked = false;
        vector.psd_mask = Some(authority.clone());
        vector.psd_smart_blocks = vec![PsdTaggedBlock {
            key: *b"vmsk",
            data: vec![1, 2, 3, 4],
        }];
        vector.psd_raster_proxy_baseline =
            psd_raster_proxy_fingerprint(&vector, 2, 1, 8);

        let semantic = to_import_layer_for_photoshop(&vector, 2, 1, 8).unwrap();
        assert_eq!(semantic.kind, LayerKind::Raster);
        assert_eq!(semantic.parent, Some(9));
        assert_eq!(
            semantic.bounds,
            Bounds {
                x: 5,
                y: 1,
                w: 2,
                h: 1
            }
        );
        assert!(semantic.rgba.is_empty());
        assert_eq!(semantic.mask, Some(authority));
        assert_eq!(semantic.psd_smart_blocks, vector.psd_smart_blocks);

        Arc::make_mut(&mut vector.pixels)[0] = 17;
        let edited = to_import_layer_for_photoshop(&vector, 2, 1, 8).unwrap();
        assert_eq!(edited.psd_smart_blocks, vector.psd_smart_blocks);

        vector.ox += 1;
        assert!(to_import_layer_for_photoshop(&vector, 2, 1, 8)
            .unwrap_err()
            .contains("vector-mask-only"));
        vector.ox -= 1;
        vector.psd_raster_proxy_baseline = None;
        assert!(to_import_layer_for_photoshop(&vector, 2, 1, 8)
            .unwrap_err()
            .contains("missing or stale geometry provenance"));

        let mut fill = Layer::transparent(62, "Imported fill proxy", 2, 1);
        fill.psd_smart_blocks = vec![PsdTaggedBlock {
            key: *b"GdFl",
            data: vec![9, 8, 7],
        }];
        fill.psd_raster_proxy_baseline = psd_raster_proxy_fingerprint(&fill, 2, 1, 8);
        let fill_semantic = to_import_layer_for_photoshop(&fill, 2, 1, 8).unwrap();
        assert_eq!(fill_semantic.kind, LayerKind::Raster);
        assert_eq!(fill_semantic.adjustment, None);
        assert_eq!(fill_semantic.psd_smart_blocks, fill.psd_smart_blocks);

        fill.psd_raster_proxy_baseline = None;
        let unproven = to_import_layer_for_photoshop(&fill, 2, 1, 8).unwrap();
        assert!(unproven.psd_smart_blocks.is_empty());

        let mut smart = Layer::transparent(63, "Imported Smart Object", 2, 1);
        smart.kind = 7;
        smart.psd_smart_blocks = vec![PsdTaggedBlock {
            key: *b"SoLd",
            data: vec![5, 4, 3, 2, 1],
        }];
        let smart_semantic = to_import_layer_for_photoshop(&smart, 2, 1, 8).unwrap();
        assert_eq!(smart_semantic.kind, LayerKind::SmartObject);
        assert_eq!(smart_semantic.psd_smart_blocks, smart.psd_smart_blocks);
    }

    #[test]
    fn photoshop_semantic_adapter_rejects_incomplete_or_unrepresentable_engine_state() {
        let mut unknown = Layer::transparent(71, "Unknown", 1, 1);
        unknown.kind = 5;
        assert!(to_import_layer_for_photoshop(&unknown, 1, 1, 8)
            .unwrap_err()
            .contains("unsupported engine layer kind"));

        let mut overflow = Layer::transparent(72, "Overflow", 1, 1);
        overflow.pixel_bounds.x = 1;
        overflow.ox = i32::MAX;
        assert!(to_import_layer_for_photoshop(&overflow, 1, 1, 8)
            .unwrap_err()
            .contains("bounds overflow"));

        let mut adjustment = Layer::transparent(73, "Broken adjustment", 1, 1);
        adjustment.kind = 1;
        adjustment.adj_kind = 0;
        adjustment.adj_params = vec![0.5];
        assert!(to_import_layer_for_photoshop(&adjustment, 1, 1, 8)
            .unwrap_err()
            .contains("expected 2"));
        adjustment.adj_kind = 99;
        adjustment.adj_params.clear();
        assert!(to_import_layer_for_photoshop(&adjustment, 1, 1, 8)
            .unwrap_err()
            .contains("unsupported adjustment kind"));

        let mut effect = Layer::transparent(74, "Disabled effect", 1, 1);
        effect.effects = vec![(6, vec![0.0, 0.0, 1.0, 1.0, 0.0, 0.0])];
        let semantic = to_import_layer_for_photoshop(&effect, 1, 1, 8)
            .expect("a disabled effect exports with enab=false");
        assert!(matches!(semantic.effects.as_slice(), [Effect::Disabled(_)]));
        effect.effects = vec![(99, Vec::new())];
        assert!(to_import_layer_for_photoshop(&effect, 1, 1, 8)
            .unwrap_err()
            .contains("unsupported layer effect"));

        let mut text = Layer::transparent(75, "Broken text", 1, 1);
        text.kind = 2;
        text.text_spec = "{\"v\":1}".into();
        assert!(to_import_layer_for_photoshop(&text, 1, 1, 8)
            .unwrap_err()
            .contains("field \"kind\" is missing"));

        // A natively authored Smart Object carries no Adobe descriptor and never
        // will, so refusing here failed the whole export over one layer. It maps
        // to its writer-owned rendered plane instead; only a layer that still
        // has the descriptor stays a Smart Object on the Photoshop side.
        let mut smart = Layer::transparent(76, "Native Smart Object", 1, 1);
        smart.kind = 7;
        assert_eq!(
            to_import_layer_for_photoshop(&smart, 1, 1, 8)
                .expect("a descriptor-less Smart Object exports on its rendered plane")
                .kind,
            LayerKind::Raster
        );
        smart.psd_smart_blocks = vec![PsdTaggedBlock {
            key: *b"SoLd",
            data: Vec::new(),
        }];
        assert_eq!(
            to_import_layer_for_photoshop(&smart, 1, 1, 8)
                .expect("a descriptor-carrying Smart Object still exports")
                .kind,
            LayerKind::SmartObject
        );

        let mut blend_if = Layer::transparent(77, "Broken blend-if", 1, 1);
        blend_if.blend_if = vec![0.5; 31];
        assert!(to_import_layer_for_photoshop(&blend_if, 1, 1, 8)
            .unwrap_err()
            .contains("expected 0 or 32"));

        // Advanced Blending flags now travel on the neutral IR (#509) instead
        // of refusing the whole export.
        let mut advanced = Layer::transparent(78, "Advanced blending", 1, 1);
        advanced.transparency_shapes = false;
        advanced.blend_interior_group = true;
        advanced.blend_clipped_group = true;
        let semantic = to_import_layer_for_photoshop(&advanced, 1, 1, 8)
            .expect("advanced blending flags export on the neutral IR");
        assert!(!semantic.transparency_shapes);
        assert!(semantic.blend_interior_group);
        assert!(semantic.blend_clipped_group);
    }

    #[test]
    fn from_doc_maps_pixels_masks_layer_fields_effects_and_text() {
        let mut doc = ImportDocument::new(4, 3, SourceFormat::Psd);
        doc.depth = 16;
        doc.color_mode = ColorMode::Cmyk;

        let mut raster = ImportLayer::new(
            10,
            "Raster",
            LayerKind::Raster,
            Bounds {
                x: -1,
                y: 1,
                w: 3,
                h: 2,
            },
        );
        raster.rgba = [
            rgba8(1, 2, 3, 255),
            rgba8(10, 20, 30, 255),
            rgba8(40, 50, 60, 128),
            rgba8(70, 80, 90, 255),
            rgba8(100, 110, 120, 255),
            rgba8(130, 140, 150, 255),
        ]
        .concat();
        raster.opacity = 1.4;
        raster.blend = ImportBlend::LighterColor;
        raster.locked = true;
        raster.clipping = true;
        raster.fill_opacity = -1.0;
        raster.knockout = 2;
        raster.blend_if = Some([0.25; 32]);
        raster.effects = all_effects();
        raster.mask = Some(monet_format::import::Mask {
            x: 1,
            y: -1,
            w: 2,
            h: 3,
            data: vec![1, 2, 3, 4, 5, 6],
            data16: Vec::new(),
            data32: Vec::new(),
            default: 9,
            disabled: false,
            relative: true,
            invert: false,
            density: None,
            feather: None,
            vector_density: None,
            vector_feather: None,
            real: None,
        });

        let mut group = ImportLayer::new(11, "Group", LayerKind::Group, Bounds::default());
        group.pass_through = true;
        group.visible = false;

        let mut adjustment =
            ImportLayer::new(12, "Adjust", LayerKind::Adjustment, Bounds::default());
        adjustment.adjustment = Some(Adjustment::ColorBalance {
            shadows: [0.1, 0.2, 0.3],
            midtones: [0.4, 0.5, 0.6],
            highlights: [0.7, 0.8, 0.9],
        });

        let mut text = ImportLayer::new(13, "Text", LayerKind::Text, Bounds::default());
        text.text = Some(monet_format::import::Text {
            string: "Hello \"WASM\"\n".into(),
            point: false,
            vertical: true,
            size: 0.0,
            color: [1, 2, 3, 4],
            font: None,
            align: 4,
            leading: 12.3456,
            tracking: 20.0,
            origin: (7, 8),
            box_size: Some((30.1234, 40.9876)),
            warp_style: 99,
            warp_bend: 0.25,
            warp_h: f32::INFINITY,
            warp_v: -0.5,
            antialias: 99,
            ..Default::default()
        });

        let mut smart = ImportLayer::new(
            14,
            "Smart",
            LayerKind::SmartObject,
            Bounds {
                x: 0,
                y: 0,
                w: 1,
                h: 1,
            },
        );
        smart.rgba = rgba8(200, 150, 100, 255);

        doc.layers = vec![raster, group, adjustment, text, smart];
        let e = from_doc(doc);

        assert_eq!((e.w, e.h, e.depth, e.mode), (4, 3, 16, 2));
        assert_eq!(e.next_id, 15);
        assert_eq!(e.active, 4);
        let raster = &e.layers[0];
        assert_eq!(raster.opacity, 1.0);
        assert_eq!(raster.blend.to_u8(), 27);
        assert!(raster.locked && raster.clipping);
        assert_eq!(raster.fill_opacity, 0.0);
        assert_eq!(raster.knockout, 2);
        assert_eq!(raster.blend_if, vec![0.25; 32]);
        assert_eq!(raster.effects.len(), 10);
        assert_eq!(raster.mask[0], 9);
        assert_eq!(raster.mask[1], 3);
        assert_eq!(
            raster.pixel_bounds,
            Bounds {
                x: -1,
                y: 1,
                w: 3,
                h: 2
            }
        );
        assert_eq!(raster.pixels.len(), 3 * 2 * 4);
        assert_eq!(raster.pixels[0], color::u8_to_16(1));
        assert_eq!(raster.pixels[2 * 4 + 2], color::u8_to_16(60));

        assert_eq!(e.layers[1].kind, 6);
        assert_eq!(e.layers[1].blend, BlendMode::PassThrough);
        assert!(!e.layers[1].visible);
        assert_eq!(e.layers[2].kind, 1);
        assert_eq!(e.layers[2].adj_kind, 10);
        assert_eq!(e.layers[2].adj_params.len(), 9);
        assert_eq!(e.layers[3].kind, 2);
        assert_eq!(e.layers[3].text_size, 48.0);
        assert!(e.layers[3].text_spec.contains("\\\"WASM\\\""));
        assert!(e.layers[3].text_spec.contains("\"align\":\"justifyAll\""));
        assert!(e.layers[3]
            .text_spec
            .contains("\"warp\":{\"style\":\"none\""));
        assert_eq!(e.layers[4].kind, 7);
        assert_eq!(e.layers[4].smart_src, e.layers[4].pixels);
    }

    #[test]
    fn from_doc_keeps_smart_object_proxy_document_sized_until_source_bounds_exist() {
        let mut doc = ImportDocument::new(8, 6, SourceFormat::Psd);
        let mut smart = ImportLayer::new(
            7,
            "Imported Smart Object",
            LayerKind::SmartObject,
            Bounds {
                x: 2,
                y: 2,
                w: 4,
                h: 2,
            },
        );
        smart.rgba = vec![rgba8(220, 30, 40, 255); 8].concat();
        doc.layers.push(smart);

        let mut e = from_doc(doc);
        let source = e.layers[0].pixels.clone();
        assert_eq!(e.layer_kind(7), 7);
        assert_eq!(
            e.layers[0].pixel_bounds,
            Bounds {
                x: 0,
                y: 0,
                w: 8,
                h: 6
            },
            "Smart Object filters still require a document-sized proxy/source"
        );
        assert_eq!(source.len(), 8 * 6 * 4);
        assert_eq!(e.layers[0].smart_src, source);

        e.smart_add_filter(7, 0, &[1.0]);
        assert_eq!(e.smart_filter_count(7), 1);
        assert_eq!(
            e.layers[0].smart_src, source,
            "filter keeps the proxy source"
        );
        assert_ne!(e.layers[0].pixels, source, "filter rerenders the proxy");

        let mut reopened =
            Engine::load_project(&e.save_project()).expect("reopen imported smart object");
        assert_eq!(reopened.layer_kind(7), 7);
        assert_eq!(reopened.smart_filter_count(7), 1);
        assert_eq!(reopened.layers[0].smart_src, source);
        let rendered = reopened.layers[0].pixels.clone();
        reopened.rasterize_smart_object(7);
        assert_eq!(reopened.layer_kind(7), 0);
        assert!(reopened.layers[0].smart_src.is_empty());
        assert_eq!(reopened.layers[0].pixels, rendered);
    }

    #[test]
    fn from_doc_maps_all_adjustment_variants_and_degenerate_documents() {
        let variants = vec![
            Adjustment::BrightnessContrast {
                brightness: 0.1,
                contrast: 0.2,
            },
            Adjustment::Levels {
                in_black: 0.1,
                in_white: 0.9,
                gamma: 1.2,
                out_black: 0.0,
                out_white: 1.0,
            },
            Adjustment::HueSaturation {
                hue: 30.0,
                saturation: 0.4,
                lightness: -0.2,
            },
            Adjustment::Vibrance {
                vibrance: 0.5,
                saturation: 0.1,
            },
            Adjustment::Invert,
            Adjustment::Desaturate,
            Adjustment::BlackWhite {
                r: 0.3,
                g: 0.6,
                b: 0.1,
            },
            Adjustment::Posterize { levels: 5.0 },
            Adjustment::Threshold { level: 0.45 },
            Adjustment::Exposure {
                exposure: 0.3,
                offset: 0.1,
                gamma: 0.9,
            },
            Adjustment::ColorBalance {
                shadows: [0.1; 3],
                midtones: [0.2; 3],
                highlights: [0.3; 3],
            },
            Adjustment::PhotoFilter {
                color: Color3::new(1.0, 0.5, 0.25),
                density: 0.6,
            },
            Adjustment::Curves {
                lut: vec![0.25; 256],
            },
            Adjustment::GradientMap {
                lut: vec![0.5; 256 * 3],
            },
        ];
        let mut doc = ImportDocument::new(1, 1, SourceFormat::Xcf);
        for (i, adj) in variants.into_iter().enumerate() {
            let mut layer = ImportLayer::new(
                (i + 1) as u32,
                format!("Adj {i}"),
                LayerKind::Adjustment,
                Bounds::default(),
            );
            layer.adjustment = Some(adj);
            doc.layers.push(layer);
        }
        let e = from_doc(doc);
        let kinds: Vec<u8> = e.layers.iter().map(|l| l.adj_kind).collect();
        assert_eq!(kinds, (0u8..=13).collect::<Vec<_>>());
        assert_eq!(e.layers[13].adj_params.len(), 256 * 3);

        let empty = from_doc(ImportDocument::new(0, 0, SourceFormat::Psb));
        assert_eq!((empty.w, empty.h), (1, 1));
        assert_eq!(empty.layers.len(), 1);
        assert_eq!(empty.layers[0].name, "Background");
        assert_eq!(empty.next_id, 2);
    }

    #[test]
    fn from_gfx_reads_pixel_refs_vector_payload_masks_and_engine_extra() {
        let raw16 = vec![100u16, 200, 300, 65535];
        let data16 = base64_encode(&deflate_u16_le(&raw16));
        let data8 = base64_encode(&rgba8(7, 8, 9, 255));
        let scene = serde_json::json!({
            "artboards": [],
            "layers": [{"visible": true, "items": [{"type": "rect", "id": "r", "width": 2, "height": 3}]}]
        });

        let mut extra = serde_json::Map::new();
        extra.insert("engineAdjKind".into(), serde_json::json!(9));
        extra.insert("engineAdjParams".into(), serde_json::json!([0.1, 0.2, 0.3]));
        extra.insert("engineTextSpec".into(), serde_json::json!("{\"v\":1}"));
        extra.insert(
            "engineEffects".into(),
            serde_json::json!([[6, [1.0, 0.0, 0.5, 1.0, 0.0, 0.0]]]),
        );

        let layers = vec![
            GfxLayer {
                id: 1,
                parent: None,
                name: "u16".into(),
                kind: GfxLayerKind::Raster,
                opacity: 1.0,
                fill_opacity: 1.0,
                blend: ImportBlend::Normal,
                visible: true,
                clipping: false,
                locked: false,
                knockout: 0,
                blend_if: None,
                pass_through: false,
                mask: None,
                transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                raster: RasterPayload {
                    bounds: Bounds {
                        x: 0,
                        y: 0,
                        w: 1,
                        h: 1,
                    },
                    pixels: Some(PixelRef::Base64 {
                        data: data16,
                        w: 1,
                        h: 1,
                        bits: 16,
                    }),
                    ..Default::default()
                },
                vector: None,
                extra: serde_json::Map::new(),
            },
            GfxLayer {
                id: 2,
                parent: None,
                name: "u8".into(),
                kind: GfxLayerKind::Raster,
                opacity: 1.0,
                fill_opacity: 1.0,
                blend: ImportBlend::Normal,
                visible: true,
                clipping: false,
                locked: false,
                knockout: 0,
                blend_if: Some([0.1; 32]),
                pass_through: false,
                mask: Some(monet_format::import::Mask {
                    x: 0,
                    y: 0,
                    w: 1,
                    h: 1,
                    data: vec![222],
                    data16: Vec::new(),
                    data32: Vec::new(),
                    default: 0,
                    disabled: false,
                    relative: true,
                    invert: false,
                    density: None,
                    feather: None,
                    vector_density: None,
                    vector_feather: None,
                    real: None,
                }),
                transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                raster: RasterPayload {
                    bounds: Bounds {
                        x: 1,
                        y: 0,
                        w: 1,
                        h: 1,
                    },
                    pixels: Some(PixelRef::Base64 {
                        data: data8,
                        w: 1,
                        h: 1,
                        bits: 8,
                    }),
                    ..Default::default()
                },
                vector: None,
                extra: serde_json::Map::new(),
            },
            GfxLayer {
                id: 3,
                parent: None,
                name: "fallback".into(),
                kind: GfxLayerKind::SmartObject,
                opacity: 1.0,
                fill_opacity: 1.0,
                blend: ImportBlend::Normal,
                visible: true,
                clipping: false,
                locked: false,
                knockout: 0,
                blend_if: None,
                pass_through: false,
                mask: Some(monet_format::import::Mask {
                    x: 0,
                    y: 0,
                    w: 1,
                    h: 1,
                    data: vec![1],
                    data16: Vec::new(),
                    data32: Vec::new(),
                    default: 0,
                    disabled: true,
                    relative: true,
                    invert: false,
                    density: None,
                    feather: None,
                    vector_density: None,
                    vector_feather: None,
                    real: None,
                }),
                transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                raster: RasterPayload {
                    rgba: Some(rgba8(9, 10, 11, 255)),
                    ..Default::default()
                },
                vector: None,
                extra,
            },
            GfxLayer {
                id: 4,
                parent: None,
                name: "png-ref".into(),
                kind: GfxLayerKind::Raster,
                opacity: 1.0,
                fill_opacity: 1.0,
                blend: ImportBlend::Normal,
                visible: true,
                clipping: false,
                locked: false,
                knockout: 0,
                blend_if: None,
                pass_through: false,
                mask: None,
                transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                raster: RasterPayload {
                    bounds: Bounds {
                        x: 0,
                        y: 0,
                        w: 1,
                        h: 1,
                    },
                    pixels: Some(PixelRef::Png {
                        path: "layers/4.png".into(),
                        w: 1,
                        h: 1,
                    }),
                    ..Default::default()
                },
                vector: None,
                extra: serde_json::Map::new(),
            },
            GfxLayer {
                id: 5,
                parent: None,
                name: "vector".into(),
                kind: GfxLayerKind::Vector,
                opacity: 0.8,
                fill_opacity: 1.0,
                blend: ImportBlend::Normal,
                visible: true,
                clipping: false,
                locked: false,
                knockout: 0,
                blend_if: None,
                pass_through: false,
                mask: None,
                transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                raster: RasterPayload::default(),
                vector: Some(VectorPayload {
                    scene,
                    text_as_outline: true,
                }),
                extra: serde_json::Map::new(),
            },
            GfxLayer {
                id: 6,
                parent: None,
                name: "group".into(),
                kind: GfxLayerKind::Group,
                opacity: 1.0,
                fill_opacity: 1.0,
                blend: ImportBlend::Normal,
                visible: true,
                clipping: false,
                locked: false,
                knockout: 0,
                blend_if: None,
                pass_through: true,
                mask: None,
                transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                raster: RasterPayload::default(),
                vector: None,
                extra: serde_json::Map::new(),
            },
        ];
        let e = from_gfx(GfxDocument {
            id: "gfx".into(),
            name: "Graphics".into(),
            width: 2,
            height: 1,
            depth: 16,
            color_mode: ColorMode::Lab,
            layers,
            channels: Vec::new(),
            source: None,
            icc_profile: None,
            icc_profile_name: None,
            data: None,
            extra: serde_json::Map::new(),
        })
        .unwrap();

        assert_eq!((e.w, e.h, e.depth, e.mode), (2, 1, 16, 3));
        assert_eq!(e.layers[0].pixels[0], 100);
        assert_eq!(
            e.layers[0].pixel_bounds,
            Bounds {
                x: 0,
                y: 0,
                w: 1,
                h: 1
            }
        );
        assert_eq!(e.layers[0].pixels.len(), 4);
        assert!(e.layers[1].pixels.iter().any(|&v| v == color::u8_to_16(7)));
        assert_eq!(
            e.layers[1].pixel_bounds,
            Bounds {
                x: 1,
                y: 0,
                w: 1,
                h: 1
            }
        );
        assert_eq!(e.layers[1].pixels.len(), 4);
        assert_eq!(e.layers[1].mask.to_vec(), vec![222, 0]);
        assert_eq!(e.layers[2].mask.to_vec(), vec![1, 0]);
        assert!(!e.layers[2].mask_enabled);
        assert_eq!(
            e.layers[2].psd_mask.as_ref().map(|mask| mask.disabled),
            Some(true)
        );
        assert_eq!(e.layers[2].kind, 7);
        assert_eq!(e.layers[2].smart_src, e.layers[2].pixels);
        assert_eq!(e.layers[2].adj_kind, 9);
        assert_eq!(e.layers[2].adj_params, vec![0.1, 0.2, 0.3]);
        assert_eq!(e.layers[2].text_spec, "{\"v\":1}");
        assert_eq!(e.layers[2].effects.len(), 1);
        assert_eq!(e.layers[4].kind, 3);
        assert!(e.layers[4].vector_scene.is_some());
        assert_eq!(e.layers[5].blend, BlendMode::PassThrough);
    }

    #[test]
    fn to_gfx_writes_precision_pixels_vectors_masks_blend_if_and_engine_extra() {
        let mut e = Engine::new(1, 1);
        e.depth = 16;
        e.mode = 4;
        e.layers.clear();

        let mut raster = Layer::transparent(10, "Raster", 1, 1);
        raster.pixels = vec![123, 456, 789, 65535].into();
        raster.blend = BlendMode::PassThrough;
        raster.mask = vec![111].into();
        raster.blend_if = vec![0.5; 32];
        raster.effects = vec![(6, vec![1.0, 0.0, 0.5, 1.0, 0.0, 0.0])];
        e.layers.push(raster);

        let mut text = Layer::transparent(11, "Text", 1, 1);
        text.kind = 2;
        text.text_spec = "{\"v\":1}".into();
        e.layers.push(text);

        let mut adjustment = Layer::transparent(12, "Adjust", 1, 1);
        adjustment.kind = 1;
        adjustment.adj_kind = 12;
        adjustment.adj_params = vec![0.2, 0.3];
        e.layers.push(adjustment);

        let mut group = Layer::transparent(13, "Group", 1, 1);
        group.kind = 6;
        group.adj_kind = 1;
        group.adj_params = vec![1.0, 2.0, 3.0, 4.0];
        e.layers.push(group);

        let mut vector = Layer::transparent(14, "Vector", 1, 1);
        vector.kind = 3;
        vector.vector_scene = Some(Box::new(crate::vector::model::Document::parse(
            r#"{"artboards":[],"layers":[{"visible":true,"items":[{"type":"rect","id":"r","width":1,"height":1}]}]}"#,
        ).unwrap()));
        e.layers.push(vector);

        let gfx = to_gfx(&e);
        assert_eq!(gfx.color_mode, ColorMode::Multichannel);
        assert_eq!(gfx.layers.len(), 5);
        assert!(gfx.layers[0].pass_through);
        assert_eq!(gfx.layers[0].blend, ImportBlend::Normal);
        assert_eq!(gfx.layers[0].blend_if, Some([0.5; 32]));
        assert!(matches!(
            gfx.layers[0].raster.pixels,
            Some(PixelRef::Base64 { bits: 16, .. })
        ));
        assert!(gfx.layers[0].extra.contains_key("engineEffects"));
        assert_eq!(
            gfx.layers[1]
                .extra
                .get("engineTextSpec")
                .and_then(serde_json::Value::as_str),
            Some("{\"v\":1}")
        );
        assert_eq!(
            gfx.layers[2]
                .extra
                .get("engineAdjKind")
                .and_then(serde_json::Value::as_u64),
            Some(12)
        );
        assert!(gfx.layers[4].vector.is_some());

        e.depth = 8;
        let gfx8 = to_gfx(&e);
        assert!(matches!(
            gfx8.layers[0].raster.pixels,
            Some(PixelRef::Base64 { bits: 8, .. })
        ));
    }

    #[test]
    fn gfx_round_trip_keeps_native_mask_authority_and_opaque_vector_blocks() {
        let mut source = Engine::new(2, 1);
        source.depth = 32;
        let authority = monet_format::import::Mask {
            x: -1,
            y: 0,
            w: 2,
            h: 1,
            data: vec![0, 255],
            data16: Vec::new(),
            data32: vec![-0.25, 1.25],
            default: 17,
            disabled: false,
            relative: false,
            invert: false,
            density: Some(211),
            feather: Some(1.5),
            vector_density: Some(173),
            vector_feather: Some(2.25),
            real: None,
        };
        source.layers[0].mask = super::super::expand_import_mask(&authority, 2, 1).unwrap().into();
        source.layers[0].psd_mask = Some(authority);
        source.layers[0].psd_smart_blocks = vec![PsdTaggedBlock {
            key: *b"vmsk",
            data: vec![1, 2, 3, 4, 5],
        }];

        let loaded = from_gfx(to_gfx(&source)).unwrap();
        let mask = loaded.layers[0]
            .psd_mask
            .as_ref()
            .expect("native mask source");
        assert_eq!(
            mask.data32
                .iter()
                .map(|value| value.to_bits())
                .collect::<Vec<_>>(),
            [-0.25f32, 1.25]
                .into_iter()
                .map(f32::to_bits)
                .collect::<Vec<_>>()
        );
        assert_eq!(mask.vector_density, Some(173));
        assert_eq!(mask.vector_feather, Some(2.25));
        assert_eq!(
            loaded.layers[0].psd_smart_blocks,
            source.layers[0].psd_smart_blocks
        );
    }

    #[test]
    fn gfx_load_save_couriers_foreign_namespaces_and_icc_profile() {
        // GV-04 + COLOR-07. A .monetgfx written by another Monet app carries an
        // identity, per-app `data` namespaces, unknown top-level fields and an
        // embedded ICC profile — none of which the raster engine owns. One
        // load→save hop must re-emit every one of them verbatim.
        let json = r#"{
          "format": "monet-graphics",
          "schemaVersion": 4,
          "document": {
            "id": "doc-1", "name": "Shared", "width": 2, "height": 1,
            "iccProfile": "YWJjZA==",
            "iccProfileName": "Adobe RGB (1998)",
            "data": {"artisan": {"guides": [4]}, "galerie": {"rating": 5}},
            "futureTopLevelThing": {"x": 1},
            "layers": []
          }
        }"#;
        let source = GfxDocument::parse(json).expect("parse foreign document");
        let engine = from_gfx(source.clone()).expect("load foreign document");

        let saved = GfxDocument::parse(&to_gfx(&engine).to_json()).expect("reparse save");
        assert_eq!(saved.id, "doc-1");
        assert_eq!(saved.name, "Shared");
        assert_eq!(saved.data, source.data, "foreign app namespaces survive");
        assert_eq!(saved.icc_profile.as_deref(), Some("YWJjZA=="));
        assert_eq!(saved.icc_profile_name.as_deref(), Some("Adobe RGB (1998)"));
        assert_eq!(
            saved.extra.get("futureTopLevelThing"),
            source.extra.get("futureTopLevelThing"),
            "unknown top-level fields survive",
        );

        // The host can assign a profile to a document that arrived without one,
        // and clearing it leaves no empty-string residue on the wire.
        let mut fresh = Engine::new(2, 1);
        assert!(fresh.document_icc().is_empty());
        fresh.set_document_icc(&[0x00, 0x01, b'I', b'C'], "Display P3");
        assert_eq!(fresh.document_icc(), vec![0x00, 0x01, b'I', b'C']);
        assert_eq!(fresh.document_icc_name(), "Display P3");
        let assigned = to_gfx(&fresh).to_json();
        assert!(assigned.contains("Display P3"));
        fresh.set_document_icc(&[], "");
        assert!(!to_gfx(&fresh).to_json().contains("iccProfile"));
    }

    #[test]
    fn gfx_round_trip_preserves_exact_proxy_provenance_and_all_semantic_blocks() {
        let mut source = Engine::new(8, 6);
        source.layers[0] = proxy_layer(91);
        source.layers[0].psd_smart_blocks = PSD_PRESERVED_LAYER_KEYS
            .iter()
            .enumerate()
            .map(|(index, key)| PsdTaggedBlock {
                key: *key,
                data: vec![index as u8, 0xA5],
            })
            .collect();
        source.layers[0].psd_raster_proxy_baseline =
            psd_raster_proxy_fingerprint(&source.layers[0], 8, 6, 8);
        let expected_baseline = source.layers[0].psd_raster_proxy_baseline.unwrap();

        let gfx = to_gfx(&source);
        let encoded = gfx.layers[0]
            .extra
            .get(PSD_RASTER_PROXY_BASELINE_EXTRA)
            .and_then(Value::as_str)
            .expect("proxy provenance extra");
        assert_eq!(base64_decode(encoded).as_deref(), Some(expected_baseline.as_slice()));

        let loaded = from_gfx(gfx.clone()).unwrap();
        assert_eq!(
            loaded.layers[0].psd_raster_proxy_baseline,
            Some(expected_baseline)
        );
        assert_eq!(loaded.layers[0].psd_smart_blocks, source.layers[0].psd_smart_blocks);
        assert_eq!(
            to_import_layer_for_photoshop(&loaded.layers[0], 8, 6, 8)
                .unwrap()
                .psd_smart_blocks,
            source.layers[0].psd_smart_blocks
        );

        let mut edited = source;
        Arc::make_mut(&mut edited.layers[0].pixels)[0] ^= 257;
        let edited = from_gfx(to_gfx(&edited)).unwrap();
        assert_eq!(
            edited.layers[0].psd_raster_proxy_baseline,
            Some(expected_baseline)
        );
        assert_eq!(edited.layers[0].psd_smart_blocks.len(), PSD_PRESERVED_LAYER_KEYS.len());
        let exported = to_import_layer_for_photoshop(&edited.layers[0], 8, 6, 8)
            .unwrap()
            .psd_smart_blocks;
        assert!(exported
            .iter()
            .all(|block| !PSD_RASTER_PROXY_KEYS.contains(&block.key)));
        assert_eq!(
            exported.len(),
            PSD_PRESERVED_LAYER_KEYS.len() - PSD_RASTER_PROXY_KEYS.len()
        );

        for malformed in [
            None,
            Some(Value::String("not-base64".into())),
            Some(Value::String("A".repeat(4096))),
            Some(Value::String(base64_encode(&[0u8; 31]))),
            Some(Value::String(format!(" {}", &encoded[..43]))),
        ] {
            let mut malformed_gfx = gfx.clone();
            if let Some(value) = malformed {
                malformed_gfx.layers[0]
                    .extra
                    .insert(PSD_RASTER_PROXY_BASELINE_EXTRA.into(), value);
            } else {
                malformed_gfx.layers[0]
                    .extra
                    .remove(PSD_RASTER_PROXY_BASELINE_EXTRA);
            }
            let malformed = from_gfx(malformed_gfx).unwrap();
            assert_eq!(malformed.layers[0].psd_raster_proxy_baseline, None);
            let exported = to_import_layer_for_photoshop(&malformed.layers[0], 8, 6, 8)
                .unwrap()
                .psd_smart_blocks;
            assert!(exported
                .iter()
                .all(|block| !PSD_RASTER_PROXY_KEYS.contains(&block.key)));
        }
    }

    // ── Vision-authored shape/fill layers → editable Photoshop vectors ──────

    fn synthesized_block(layer: &ImportLayer, key: &[u8; 4]) -> Option<Vec<u8>> {
        layer
            .psd_smart_blocks
            .iter()
            .find(|block| &block.key == key)
            .map(|block| block.data.clone())
    }

    /// Anchor points of every knot record in a `vmsk` payload, back in document
    /// pixel space (signed 8.24 fixed, vertical before horizontal).
    fn vmsk_anchors(data: &[u8], width: f32, height: f32) -> Vec<(f32, f32)> {
        let fixed = |at: usize| {
            i32::from_be_bytes(data[at..at + 4].try_into().unwrap()) as f32 / 16_777_216.0
        };
        assert_eq!(&data[0..4], &3u32.to_be_bytes(), "vector mask version");
        let mut anchors = Vec::new();
        let mut at = 8;
        while at + 26 <= data.len() {
            if matches!(
                u16::from_be_bytes(data[at..at + 2].try_into().unwrap()),
                1 | 2 | 4 | 5
            ) {
                anchors.push((fixed(at + 14) * width, fixed(at + 10) * height));
            }
            at += 26;
        }
        anchors
    }

    /// Assert a `SoCo` solid-fill descriptor states the expected 0..255 channel
    /// doubles. The half-unit slack is the f32 colour store's rounding, not
    /// tolerance for a wrong colour.
    fn assert_soco_rgb(data: &[u8], expected: [f64; 3]) {
        assert_eq!(&data[0..4], &16u32.to_be_bytes(), "descriptor version");
        assert_eq!(&data[24..28], b"Clr ");
        assert_eq!(&data[40..44], b"RGBC");
        let at = |offset: usize| f64::from_be_bytes(data[offset..offset + 8].try_into().unwrap());
        for (encoded, expected) in [at(60), at(80), at(100)].into_iter().zip(expected) {
            assert!(
                (encoded - expected).abs() < 0.5,
                "channel {encoded} should state {expected}"
            );
        }
    }

    fn exported_shape_layer(engine: &mut Engine) -> ImportLayer {
        let document =
            monet_format::import::parse(&engine.export_psd().expect("PSD exports")).expect("exported PSD parses");
        document.layers.last().expect("exported layer").clone()
    }

    #[test]
    fn vision_authored_shape_layer_exports_editable_vector_authority() {
        let scene = r#"{"layers":[{"items":[{"type":"rect","id":"shape","transform":{"a":1,"b":0,"c":0,"d":1,"e":2,"f":1},"width":4,"height":2,"fill":{"type":"solid","color":{"r":220,"g":40,"b":30,"a":1}}}]}]}"#;
        let mut engine = Engine::new(8, 4);
        engine.add_vector_layer(scene, "Shape");
        let shape = exported_shape_layer(&mut engine);

        let vmsk = synthesized_block(&shape, b"vmsk").expect("shape layer carries a vector mask");
        assert_eq!(
            vmsk_anchors(&vmsk, 8.0, 4.0),
            vec![(2.0, 1.0), (6.0, 1.0), (6.0, 3.0), (2.0, 3.0)],
            "the outline lands where the rendered plane does"
        );
        let soco = synthesized_block(&shape, b"SoCo").expect("shape layer carries its fill");
        assert_soco_rgb(&soco, [220.0, 40.0, 30.0]);
    }

    #[test]
    fn vision_authored_solid_fill_layer_exports_its_fill_descriptor() {
        let mut engine = Engine::new(4, 4);
        engine.add_solid_fill_layer(80, 140, 210);
        let fill = exported_shape_layer(&mut engine);
        let soco = synthesized_block(&fill, b"SoCo").expect("fill layer carries its fill");
        assert_soco_rgb(&soco, [80.0, 140.0, 210.0]);
        assert_eq!(
            synthesized_block(&fill, b"vmsk"),
            None,
            "a canvas fill needs no outline"
        );
    }

    #[test]
    fn scenes_the_vector_pair_cannot_state_keep_their_rendered_plane() {
        let two_colors = r#"{"layers":[{"items":[{"type":"rect","width":4,"height":2,"fill":{"type":"solid","color":{"r":220,"g":40,"b":30,"a":1}}},{"type":"rect","transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":0},"width":4,"height":2,"fill":{"type":"solid","color":{"r":20,"g":80,"b":230,"a":1}}}]}]}"#;
        let stroked = r#"{"layers":[{"items":[{"type":"rect","width":4,"height":2,"fill":{"type":"solid","color":{"r":220,"g":40,"b":30,"a":1}},"stroke":{"paint":{"type":"solid","color":{"r":0,"g":0,"b":0,"a":1}},"width":2}}]}]}"#;
        let gradient = r#"{"layers":[{"items":[{"type":"rect","width":4,"height":2,"fill":{"type":"gradient","gradient":{"type":"linear","stops":[{"offset":0,"color":{"r":220,"g":40,"b":30,"a":1}},{"offset":1,"color":{"r":20,"g":80,"b":230,"a":1}}]}}}]}]}"#;
        for scene in [two_colors, stroked, gradient] {
            let mut engine = Engine::new(8, 4);
            engine.add_vector_layer(scene, "Shape");
            let shape = exported_shape_layer(&mut engine);
            assert_eq!(synthesized_block(&shape, b"vmsk"), None);
            assert_eq!(synthesized_block(&shape, b"SoCo"), None);
        }
    }

    // ── Photoshop shape layers → editable vector layers ──────────────────
    // Coordinates are eighths of the 100x80 document, which 8.24 fixed point
    // states exactly.

    const RED_SHAPE_FILL: &str = r#""fill":{"type":"solid","color":{"r":220,"g":40,"b":30,"a":1}}"#;

    fn red_triangle_scene() -> String {
        format!(
            r#"{{"layers":[{{"items":[{{"type":"path","id":"tri","geometry":{{"closed":true,"anchors":[{{"point":{{"x":25,"y":20}}}},{{"point":{{"x":75,"y":20}}}},{{"point":{{"x":50,"y":60}}}}]}},{RED_SHAPE_FILL}}}]}}]}}"#
        )
    }

    fn photoshop_shape_file(scene: &str, depth: u8, style: bool) -> Vec<u8> {
        let mut source = Engine::new(100, 80);
        source.set_depth(depth);
        let id = source.add_vector_layer(scene, "Shape 1");
        if style {
            source.set_layer_effect(id, 6, &[1.0, 0.0, 1.0, 1.0, 0.0, 0.0]); // Color Overlay
        }
        source.export_psd().expect("PSD exports")
    }

    fn imported_shape_with(edit: impl FnOnce(&mut Vec<PsdTaggedBlock>)) -> Engine {
        let mut document = monet_format::import::parse(&photoshop_shape_file(&red_triangle_scene(), 8, false))
            .expect("shape PSD parses");
        edit(&mut document.layers.last_mut().expect("shape layer").psd_smart_blocks);
        from_doc(document)
    }

    fn anchor_hit(engine: &Engine, id: u32, x: f32, y: f32) -> Option<(String, usize)> {
        let hit = engine.vector_nearest_anchor(id, x, y, 0.5);
        (!hit.is_empty()).then(|| {
            let hit: Value = serde_json::from_str(&hit).expect("anchor hit is JSON");
            (hit["item"].as_str().unwrap().to_string(), hit["index"].as_u64().unwrap() as usize)
        })
    }

    #[test]
    fn imported_solid_shape_layer_becomes_an_editable_vector_layer() {
        let scene = format!(
            r#"{{"layers":[{{"items":[{{"type":"rect","id":"box","transform":{{"a":1,"b":0,"c":0,"d":1,"e":12.5,"f":10}},"width":25,"height":20,{RED_SHAPE_FILL}}},{{"type":"path","id":"tri","geometry":{{"closed":true,"anchors":[{{"point":{{"x":62.5,"y":10}}}},{{"point":{{"x":87.5,"y":10}}}},{{"point":{{"x":75,"y":40}}}}]}},{RED_SHAPE_FILL}}}]}}]}}"#
        );
        for depth in [8, 32] {
            let mut engine = Engine::from_format(&photoshop_shape_file(&scene, depth, false))
                .expect("shape PSD imports");
            let at = engine.layers.len() - 1;
            let id = engine.layers[at].id;
            assert_eq!(engine.layers[at].kind, 3, "{depth}-bit shape opens as a vector layer");
            assert!(engine.last_edit_error.is_empty(), "{}", engine.last_edit_error);
            assert!(engine.layers[at]
                .psd_smart_blocks
                .iter()
                .all(|block| !PSD_RASTER_PROXY_KEYS.contains(&block.key)));
            assert!(anchor_hit(&engine, id, 12.5, 10.0).is_some(), "the box corner is grabbable");
            assert!(anchor_hit(&engine, id, 75.0, 40.0).is_some(), "so is the second subpath's tip");
            assert_eq!(
                engine.vector_nearest_handle(id, 12.5, 10.0, 4.0),
                "",
                "a corner knot has no handles to steal the grab"
            );
            assert_eq!(engine.pick_color(20, 20) >> 8, 0xDC281E, "{depth}-bit fill renders");

            let mut reloaded = Engine::load_project(&engine.save_project()).expect("project reloads");
            assert_eq!(reloaded.layers[at].kind, 3);
            assert!(anchor_hit(&reloaded, id, 87.5, 10.0).is_some());
            assert!(synthesized_block(&exported_shape_layer(&mut reloaded), b"vmsk").is_some());
        }
    }

    #[test]
    fn edited_imported_shape_reexports_its_moved_outline() {
        let mut engine = Engine::from_format(&photoshop_shape_file(&red_triangle_scene(), 8, true))
            .expect("styled shape PSD imports");
        let at = engine.layers.len() - 1;
        let id = engine.layers[at].id;
        assert_eq!(engine.layers[at].kind, 3);
        assert!(
            engine.layers[at].psd_smart_blocks.iter().any(|block| &block.key == b"lfx2"),
            "the imported layer style is still retained"
        );

        let (item, index) = anchor_hit(&engine, id, 75.0, 20.0).expect("the corner is grabbable");
        engine.vector_begin_edit(id);
        assert!(engine.vector_move_anchor(id, &item, index, 87.5, 30.0));
        let shape = exported_shape_layer(&mut engine);
        let vmsk = synthesized_block(&shape, b"vmsk").expect("the edited shape keeps its outline");
        assert_eq!(
            vmsk_anchors(&vmsk, 100.0, 80.0),
            vec![(25.0, 20.0), (87.5, 30.0), (50.0, 60.0)]
        );
        assert_eq!(&vmsk[34..36], &0u16.to_be_bytes(), "closed subpath length record");
        assert_eq!(&vmsk[38..40], &1u16.to_be_bytes(), "the subpath combines");
        assert_eq!(&vmsk[40..42], &2u16.to_be_bytes(), "non-zero winding, as Vision fills");
        assert_eq!(vmsk.len() % 4, 0, "five records are padded inside the block length");
        assert_soco_rgb(&synthesized_block(&shape, b"SoCo").expect("and its fill"), [220.0, 40.0, 30.0]);
        assert!(synthesized_block(&shape, b"lfx2").is_some());

        engine.undo();
        assert!(anchor_hit(&engine, id, 75.0, 20.0).is_some(), "undo puts the corner back");
        let shape = exported_shape_layer(&mut engine);
        assert_eq!(
            vmsk_anchors(&synthesized_block(&shape, b"vmsk").unwrap(), 100.0, 80.0),
            vec![(25.0, 20.0), (75.0, 20.0), (50.0, 60.0)]
        );
    }

    #[test]
    fn reopened_styled_shape_reexports_padded_blocks_in_order() {
        let direct = photoshop_shape_file(&red_triangle_scene(), 8, true);
        let mut engine = Engine::from_format(&direct).expect("styled shape PSD imports");
        let file = engine.export_psd().expect("PSD re-exports");
        // The retained lfx2 is 205 bytes. Without its padding in the length,
        // psd-tools misses the vmsk after it and reads a pixel layer.
        assert_layer_blocks_padded(&file, [b"luni", b"lfx2"]);
        assert_layer_blocks_padded(&file, [b"vmsk", b"SoCo"]);
        let at = |key: &[u8; 4]| file.windows(8).position(|tag| tag[..4] == *b"8BIM" && tag[4..] == *key);
        assert!(at(b"vmsk") < at(b"SoCo") && at(b"SoCo") < at(b"lfx2"), "the direct export's order");

        let lfx2 = |engine: &Engine| {
            let layer = engine.layers.last().expect("shape layer");
            layer.psd_smart_blocks.iter().find(|block| &block.key == b"lfx2").expect("lfx2").data.clone()
        };
        let reopened = Engine::from_format(&file).expect("re-exported PSD imports");
        assert_eq!(reopened.layers.last().unwrap().kind, 3, "the layer reopens as a vector shape");
        assert!(reopened.last_edit_error.is_empty(), "{}", reopened.last_edit_error);
        let (before, after) = (lfx2(&engine), lfx2(&reopened));
        assert!(after.starts_with(&before) && after[before.len()..].iter().all(|&b| b == 0));
    }

    #[test]
    fn malformed_shape_blocks_keep_the_raster_proxy_and_report() {
        let mut corrupted = Vec::new();
        let mut engine = imported_shape_with(|blocks| {
            let vmsk = blocks.iter_mut().find(|block| &block.key == b"vmsk").unwrap();
            vmsk.data[34..36].copy_from_slice(&9u16.to_be_bytes()); // first length record
            corrupted = blocks.clone();
        });
        let at = engine.layers.len() - 1;
        assert_eq!(engine.layers[at].kind, 0);
        assert!(
            engine.last_edit_error.contains("\"Shape 1\"")
                && engine.last_edit_error.contains("could not be read"),
            "{}",
            engine.last_edit_error
        );
        assert_eq!(engine.pick_color(50, 30) >> 8, 0xDC281E, "the proxy pixels stay");
        let shape = exported_shape_layer(&mut engine);
        for block in corrupted.iter().filter(|block| PSD_RASTER_PROXY_KEYS.contains(&block.key)) {
            assert_eq!(synthesized_block(&shape, &block.key).as_ref(), Some(&block.data));
        }
    }

    #[test]
    fn stroked_or_gradient_shapes_stay_raster_proxies_silently() {
        // A `vstk` descriptor holding only strokeEnabled = true.
        let mut stroke = 16u32.to_be_bytes().to_vec();
        stroke.extend(0u32.to_be_bytes()); // empty name
        stroke.extend(0u32.to_be_bytes());
        stroke.extend(b"null");
        stroke.extend(1u32.to_be_bytes());
        stroke.extend(13u32.to_be_bytes());
        stroke.extend(b"strokeEnabledbool\x01");
        for extra in [
            PsdTaggedBlock { key: *b"vstk", data: stroke },
            PsdTaggedBlock { key: *b"GdFl", data: vec![0xC3, 0, 0x3C] },
        ] {
            let key = String::from_utf8_lossy(&extra.key).into_owned();
            let engine = imported_shape_with(|blocks| blocks.push(extra));
            let layer = engine.layers.last().unwrap();
            assert_eq!(layer.kind, 0, "{key}");
            assert!(engine.last_edit_error.is_empty(), "{key}: {}", engine.last_edit_error);
        }
    }

    const PATTERN_KEYS: [&[u8; 4]; 3] = [b"Patt", b"Pat2", b"Pat3"];

    /// Photoshop counts a layer block's padding in its length (every layer block
    /// in the real 8/16/32-bit fixtures is 4-aligned), so a reader that trusts
    /// the length, as psd-tools does, finds the next block right after it.
    fn assert_layer_blocks_padded(file: &[u8], keys: [&[u8; 4]; 2]) {
        for key in keys {
            let blocks = tagged_blocks(file, key);
            let key = String::from_utf8_lossy(key);
            assert!(!blocks.is_empty(), "{key} is written");
            for payload in blocks {
                assert_eq!(payload.len() % 4, 0, "{key} length counts its padding");
            }
        }
    }

    /// Payloads of every `8BIM<key>` block in an exported file, as long as each
    /// length field says.
    fn tagged_blocks(file: &[u8], key: &[u8; 4]) -> Vec<Vec<u8>> {
        let mut tag = b"8BIM".to_vec();
        tag.extend_from_slice(key);
        file.windows(8)
            .enumerate()
            .filter(|(_, window)| *window == tag.as_slice())
            .map(|(at, _)| {
                let len = u32::from_be_bytes(file[at + 8..at + 12].try_into().unwrap()) as usize;
                file[at + 12..at + 12 + len].to_vec()
            })
            .collect()
    }

    /// A decoded pattern record: its id, rectangle, and each of the 26 VMAL
    /// slots as `(sample depth, raw big-endian samples)` when written.
    struct PatternRecord {
        id: String,
        rect: [u32; 4],
        slots: Vec<Option<(u32, Vec<u8>)>>,
    }

    fn pattern_records(block: &[u8]) -> Vec<PatternRecord> {
        let u32_at = |at: usize| u32::from_be_bytes(block[at..at + 4].try_into().unwrap());
        let mut records = Vec::new();
        let mut at = 0;
        while at < block.len() {
            let end = at + 4 + u32_at(at) as usize;
            assert_eq!(u32_at(at + 4), 1, "pattern version");
            assert_eq!(u32_at(at + 8), 3, "RGB pattern");
            let mut p = at + 16 + 4 + u32_at(at + 16) as usize * 2; // past x, y, name
            let id = String::from_utf8(block[p + 1..p + 1 + block[p] as usize].to_vec()).unwrap();
            p += 1 + block[p] as usize;
            assert_eq!(u32_at(p), 3, "VMAL version");
            assert_eq!(p + 8 + u32_at(p + 4) as usize, end, "VMAL fills the record");
            let rect = [u32_at(p + 8), u32_at(p + 12), u32_at(p + 16), u32_at(p + 20)];
            assert_eq!(u32_at(p + 24), 24, "colour slot count");
            p += 28;
            let mut slots = Vec::new();
            for _ in 0..26 {
                if u32_at(p) == 0 {
                    slots.push(None);
                    p += 4;
                    continue;
                }
                let channel_end = p + 8 + u32_at(p + 4) as usize;
                let depth = u32_at(p + 8);
                assert_eq!(
                    [u32_at(p + 12), u32_at(p + 16), u32_at(p + 20), u32_at(p + 24)],
                    rect
                );
                assert_eq!(u32::from(u16::from_be_bytes([block[p + 28], block[p + 29]])), depth);
                assert_eq!(block[p + 30], 0, "raw samples");
                slots.push(Some((depth, block[p + 31..channel_end].to_vec())));
                p = channel_end;
            }
            assert_eq!(p, end);
            records.push(PatternRecord { id, rect, slots });
            at = (end + 3) & !3;
        }
        records
    }

    #[test]
    fn vision_authored_gradient_fill_layer_exports_its_gradient_descriptor() {
        let stops = [
            0.0, 1.0, 0.0, 0.0, 1.0, //
            0.5, 0.2, 0.4, 0.6, 0.5, //
            1.0, 0.0, 0.0, 1.0, 1.0,
        ];
        let expected: Vec<[f32; 5]> =
            stops.chunks_exact(5).map(|stop| stop.try_into().unwrap()).collect();
        for depth in [8, 16, 32] {
            let mut engine = Engine::new(4, 4);
            engine.set_depth(depth);
            engine.add_gradient_fill_layer(&stops);
            let file = engine.export_psd().expect("PSD exports");
            // The default "Gradient Fill" name and the descriptor are odd-sized.
            assert_layer_blocks_padded(&file, [b"luni", b"GdFl"]);
            let fill = monet_format::import::parse(&file)
                .expect("exported PSD parses")
                .layers
                .pop()
                .expect("exported layer");
            assert_eq!(
                synthesized_block(&fill, b"GdFl"),
                Some(monet_format::import::encode_gradient_fill(&expected, -90.0).unwrap()),
                "{depth}-bit gradient fill carries its stops"
            );
            assert_eq!(synthesized_block(&fill, b"SoCo"), None);
            assert_eq!(synthesized_block(&fill, b"vmsk"), None);
        }
    }

    #[test]
    fn vision_authored_pattern_fill_layer_exports_its_pattern_and_tile() {
        // Red, blue and a half-transparent green: the tile's alpha has to travel.
        let tile: [[u8; 4]; 3] = [[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 128]];
        for (depth, psb) in [(8, false), (16, false), (32, false), (8, true)] {
            let mut engine = Engine::new(3, 1);
            let base = engine.active;
            engine.layers[base].pixels = tile.iter().flatten().map(|&v| color::u8_to_16(v)).collect::<Vec<_>>().into();
            engine.define_pattern();
            engine.set_depth(depth);
            engine.add_pattern_fill_layer();
            let scaled = engine.add_pattern_fill_layer();
            engine.set_fill_params(scaled, &[3.0, 1.0, 250.0]);
            engine.end_prop_edit();
            let file = if psb {
                engine.export_psb().expect("PSB exports")
            } else {
                engine.export_psd().expect("PSD exports")
            };
            let label = format!("{depth}-bit psb={psb}");
            assert_layer_blocks_padded(&file, [b"luni", b"PtFl"]);

            let key = PATTERN_KEYS[match depth {
                8 => 0,
                16 => 1,
                _ => 2,
            }];
            for other in PATTERN_KEYS {
                let expected_blocks = usize::from(other == key);
                assert_eq!(tagged_blocks(&file, other).len(), expected_blocks, "{label}");
            }
            let records = pattern_records(&tagged_blocks(&file, key)[0]);
            assert_eq!(records.len(), 1, "both fills share one record ({label})");
            let record = &records[0];
            let groups: Vec<usize> = record.id.split('-').map(str::len).collect();
            assert_eq!(groups, [8, 4, 4, 4, 12], "{label}: {}", record.id);
            assert!(record.id.bytes().all(|b| b == b'-' || b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
            assert_eq!(record.rect, [0, 0, 1, 3], "{label}");
            let sample_depth = if depth == 8 { 8 } else { 16 };
            for (slot, written) in record.slots.iter().enumerate() {
                let channel = match slot {
                    0..=2 => Some(slot),
                    25 => Some(3),
                    _ => None,
                };
                let expected = channel.map(|channel| {
                    let samples: Vec<u8> = tile
                        .iter()
                        .flat_map(|px| {
                            if depth == 8 {
                                vec![px[channel]]
                            } else {
                                color::u8_to_16(px[channel]).to_be_bytes().to_vec()
                            }
                        })
                        .collect();
                    (sample_depth, samples)
                });
                assert_eq!(written, &expected, "{label} slot {slot}");
            }

            let document = monet_format::import::parse(&file).expect("exported file parses");
            assert_eq!(document.layers.len(), 3, "{label}");
            for (layer, scale) in document.layers[1..].iter().zip([100.0, 250.0]) {
                assert_eq!(
                    synthesized_block(layer, b"PtFl"),
                    Some(
                        monet_format::import::encode_pattern_fill(
                            PHOTOSHOP_PATTERN_NAME,
                            &record.id,
                            scale
                        )
                        .unwrap()
                    ),
                    "{label} scale {scale}"
                );
            }
        }
    }

    /// #463: Vision reopens its exported pattern fill as a raster layer that
    /// keeps the `PtFl`, as it keeps a Photoshop file's own fills and overlays.
    /// The record that `PtFl` names has to go out with it on the next save, or
    /// Photoshop shows a missing pattern: once, beside a new Vision fill on the
    /// same tile, and not at all once nothing names it.
    #[test]
    fn reopened_pattern_fill_reexports_the_pattern_record_it_names() {
        let tile: [[u8; 4]; 3] = [[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 128]];
        for depth in [8, 16, 32] {
            let mut engine = Engine::new(3, 1);
            let base = engine.active;
            engine.layers[base].pixels = tile.iter().flatten().map(|&v| color::u8_to_16(v)).collect::<Vec<_>>().into();
            engine.define_pattern();
            engine.set_depth(depth);
            engine.add_pattern_fill_layer();
            let first = engine.export_psd().expect("PSD exports");
            let key = PATTERN_KEYS[match depth {
                8 => 0,
                16 => 1,
                _ => 2,
            }];
            let original = pattern_records(&tagged_blocks(&first, key)[0]);

            let mut reopened = Engine::from_format(&first).expect("exported PSD imports");
            let label = format!("{depth}-bit");
            // A project or graphics save keeps the record for a later export.
            assert!(!reopened.psd_linked_blocks.is_empty(), "{label}");
            let native = Engine::load_project(&reopened.save_project()).expect("project reopens");
            assert_eq!(native.psd_linked_blocks, reopened.psd_linked_blocks, "{label}");
            let mut graphics = Engine::new(1, 1);
            graphics.load_graphics(&native.save_graphics()).expect("graphics reopen");
            assert_eq!(graphics.psd_linked_blocks, reopened.psd_linked_blocks, "{label}");
            assert_eq!(reopened.layers[1].kind, 0, "{label}: reopens as a raster layer");
            assert!(reopened.layers[1].psd_smart_blocks.iter().any(|block| &block.key == b"PtFl"));
            let named = monet_format::import::encode_pattern_fill(PHOTOSHOP_PATTERN_NAME, &original[0].id, 100.0);
            for fills in [1, 2] {
                if fills == 2 {
                    // The reopened document's own tile, so the same record.
                    reopened.active = 0;
                    reopened.define_pattern();
                    reopened.add_pattern_fill_layer();
                }
                let again = reopened.export_psd().expect("PSD re-exports");
                let blocks = tagged_blocks(&again, key);
                assert_eq!(blocks.len(), 1, "{label}, {fills} fills: one pattern block");
                let records = pattern_records(&blocks[0]);
                assert_eq!(records.len(), 1, "{label}, {fills} fills share one record");
                assert_eq!(records[0].id, original[0].id, "{label}");
                assert_eq!(records[0].rect, original[0].rect, "{label}");
                assert_eq!(records[0].slots, original[0].slots, "{label}: the same samples");
                let layers = monet_format::import::parse(&again).expect("re-export parses").layers;
                assert_eq!(layers.len(), 1 + fills);
                for layer in &layers[1..] {
                    assert_eq!(synthesized_block(layer, b"PtFl"), Some(named.clone().unwrap()), "{label}");
                }
            }

            for fill in [reopened.layers[2].id, reopened.layers[1].id] {
                reopened.delete_layer(fill);
            }
            let unnamed = reopened.export_psd().expect("PSD exports without fills");
            assert!(tagged_blocks(&unnamed, key).is_empty(), "{label}: a record nothing names stays out");
        }
    }

    /// Pattern records past the preservation budget are left out of an open
    /// rather than refusing the file (monet-format), and the open says so.
    #[test]
    fn patterns_left_out_of_an_open_are_reported() {
        let mut engine = Engine::new(2, 2);
        engine.add_layer("Top");
        let mut doc = monet_format::import::parse(&engine.export_psd().expect("PSD exports")).unwrap();
        assert!(from_doc(doc.clone()).last_edit_error.is_empty());
        doc.skipped_patterns = true;
        let opened = from_doc(doc);
        assert_eq!(opened.layers.len(), 2);
        assert!(opened.last_edit_error.contains("pattern records"), "{}", opened.last_edit_error);
    }

    #[test]
    fn fills_photoshop_cannot_state_keep_their_rendered_plane() {
        let ramp = [0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
        let falling = [0.6, 0.0, 0.0, 0.0, 1.0, 0.4, 1.0, 1.0, 1.0, 1.0];
        let not_finite = [0.0, 0.0, 0.0, 0.0, 1.0, 1.0, f32::NAN, 1.0, 1.0, 1.0];
        for case in ["falling stop", "non-finite stop", "stale tile"] {
            let mut engine = Engine::new(3, 1);
            let base = engine.active;
            engine.layers[base].pixels = vec![65_535; 12].into();
            if case == "stale tile" {
                engine.define_pattern();
                let id = engine.add_pattern_fill_layer();
                engine.set_fill_params(id, &[4.0, 1.0, 100.0]);
            } else {
                let id = engine.add_gradient_fill_layer(&ramp);
                engine.set_fill_params(id, if case == "falling stop" { &falling } else { &not_finite });
            }
            engine.end_prop_edit();
            let file = engine.export_psd().expect("PSD exports");
            for key in PATTERN_KEYS {
                assert!(tagged_blocks(&file, key).is_empty(), "{case}");
            }
            let document = monet_format::import::parse(&file).expect("exported PSD parses");
            assert_eq!(document.layers.len(), 2, "{case}: the fill layer still exports");
            let fill = &document.layers[1];
            assert_eq!(synthesized_block(fill, b"GdFl"), None, "{case}");
            assert_eq!(synthesized_block(fill, b"PtFl"), None, "{case}");
            if case != "stale tile" {
                assert!(!fill.rgba.is_empty(), "{case}: the rendered gradient stays");
            }
        }
    }
}
