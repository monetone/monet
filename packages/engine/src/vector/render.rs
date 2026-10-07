// ─────────────────────────────────────────────────────────────
// render — rasterize the document model with tiny-skia
// ─────────────────────────────────────────────────────────────
// Mirrors the TS renderer's geometry: live shapes (rect/ellipse/polygon/star/
// line) expand to the SAME path geometry as `model/shapes.ts`, anchors carry
// relative bezier handles, and the document is painted bottom-up (layers, then
// z-ordered items, groups recursed). Fills: solid + linear/radial gradient +
// user-space patterns.
// Strokes: width/cap/join/miter/dash/alignment. Blend modes map 1:1.
//
// Text uses runtime-provisioned font outlines plus rustybuzz shaping when a
// host has registered a matching font family, including registered CSS
// family-stack fallback for plain and rich point text. It falls back to
// deterministic built-in bitmap-glyph paths when the registered stack cannot
// cover the text. Opt-in World-Ready text uses unicode-bidi for visual line
// ordering, and area text greedily wraps words to an explicit boxWidth before
// per-line shaping. Arbitrary font catalog activation, script-specific fallback,
// and full paragraph spacing/height/composer behavior remain separate slices.

use tiny_skia as sk;
use unicode_bidi::{BidiInfo, Level};

use crate::vector::model::*;
use crate::vector::{geom, shapes::local_paths};

pub fn matrix_to_transform(m: Matrix) -> sk::Transform {
    sk::Transform::from_row(m.a, m.b, m.c, m.d, m.e, m.f)
}

/// Paint the whole document into `pixmap` under the screen `view` transform.
pub fn render_document(pixmap: &mut sk::Pixmap, doc: &Document, view: sk::Transform) {
    // Artboard backgrounds (the editor shows artboards as white pages).
    for ab in &doc.artboards {
        if ab.width <= 0.0 || ab.height <= 0.0 {
            continue;
        }
        if let Some(rect) = sk::Rect::from_xywh(ab.x, ab.y, ab.width, ab.height) {
            let path = sk::PathBuilder::from_rect(rect);
            let mut paint = sk::Paint::default();
            paint.set_color(sk::Color::WHITE);
            paint.anti_alias = true;
            pixmap.fill_path(&path, &paint, sk::FillRule::Winding, view, None);
        }
    }

    render_layers(pixmap, doc, view);
}

/// Render only the layer content — NO artboard backgrounds. The merged engine
/// rasterizes a vector layer into a *transparent* Vision layer (design doc §5.4);
/// painting the white artboard pages here would destroy that transparency. The
/// golden-image oracle in the migration plan compares against this entry, not
/// the background-painting `render_document`.
pub fn render_layers(pixmap: &mut sk::Pixmap, doc: &Document, view: sk::Transform) {
    for layer in &doc.layers {
        if !layer.visible || layer.template {
            continue;
        }
        render_items(pixmap, &layer.items, view, layer.opacity, None);
    }
}

fn render_items(
    pixmap: &mut sk::Pixmap,
    items: &[Item],
    transform: sk::Transform,
    alpha: f32,
    mask: Option<&sk::Mask>,
) {
    for item in items {
        if !item.visible {
            continue;
        }
        render_item(pixmap, item, transform, alpha, mask);
    }
}

fn render_item(
    pixmap: &mut sk::Pixmap,
    item: &Item,
    parent: sk::Transform,
    parent_alpha: f32,
    mask: Option<&sk::Mask>,
) {
    let t = parent.pre_concat(matrix_to_transform(item.transform));
    let a = parent_alpha * item.opacity.clamp(0.0, 1.0);
    if a <= 0.0 {
        return;
    }

    let item_mask = build_opacity_mask(item, t, pixmap.width(), pixmap.height());
    let combined_item_mask = match (mask, item_mask.as_ref()) {
        (Some(parent_mask), Some(item_mask)) => {
            Some(intersect_masks(item_mask.clone(), parent_mask))
        }
        _ => None,
    };
    let effective_mask = combined_item_mask.as_ref().or(item_mask.as_ref()).or(mask);

    if item.kind == "group" {
        let Some(children) = &item.children else {
            return;
        };

        if item.effects.is_empty() {
            render_group_children(pixmap, children, item.clip, t, a, effective_mask);
        } else {
            render_group_with_effects(
                pixmap,
                item,
                children,
                t,
                a,
                blend_mode(&item.blend_mode),
                effective_mask,
            );
        }
        return;
    }

    if item.kind == "text" {
        render_text(pixmap, item, t, a, effective_mask);
        return;
    }
    if item.kind == "image" {
        render_image(pixmap, item, t, a, blend_mode(&item.blend_mode), effective_mask);
        return;
    }

    let geos = local_paths(item);
    if geos.is_empty() {
        return;
    }
    let Some(path) = build_path(&geos) else {
        return;
    };
    let bounds = path.bounds();
    let blend = blend_mode(&item.blend_mode);
    let fill_rule = if item.even_odd {
        sk::FillRule::EvenOdd
    } else {
        sk::FillRule::Winding
    };

    render_effects_behind(
        pixmap,
        item,
        &path,
        bounds,
        fill_rule,
        &geos,
        t,
        a,
        blend,
        effective_mask,
    );

    if !render_source_replacing_effects(
        pixmap,
        item,
        &path,
        bounds,
        fill_rule,
        &geos,
        t,
        a,
        blend,
        effective_mask,
    ) {
        render_shape_base(
            pixmap,
            &path,
            item,
            bounds,
            fill_rule,
            &geos,
            t,
            a,
            blend,
            effective_mask,
        );
    }

    render_inner_glows(
        pixmap,
        item,
        &path,
        bounds,
        fill_rule,
        &geos,
        t,
        a,
        blend,
        effective_mask,
    );
}

fn render_group_children(
    pixmap: &mut sk::Pixmap,
    children: &[Item],
    clip: bool,
    transform: sk::Transform,
    alpha: f32,
    mask: Option<&sk::Mask>,
) {
    if clip {
        // Clip group: first child is the clip shape — coverage only, never
        // painted. (#128) With no content left it used to fall through and paint
        // the clip shape as artwork, and a clip shape the mask builder can't
        // handle (group/text/image source) used to render the content with NO
        // clip at all — showing exactly what the mask was hiding. Both cases now
        // render nothing, which is what zero coverage means.
        let content = &children[1.min(children.len())..];
        if content.is_empty() {
            return;
        }
        // Nested clip groups intersect their coverage with the parent mask.
        let Some(clip_mask) = build_clip_mask(
            children[0].clone(),
            transform,
            pixmap.width(),
            pixmap.height(),
        ) else {
            return;
        };
        let combined;
        let next_mask = if let Some(parent_mask) = mask {
            combined = intersect_masks(clip_mask, parent_mask);
            &combined
        } else {
            &clip_mask
        };
        render_items(pixmap, content, transform, alpha, Some(next_mask));
    } else {
        render_items(pixmap, children, transform, alpha, mask);
    }
}

fn render_group_with_effects(
    pixmap: &mut sk::Pixmap,
    item: &Item,
    children: &[Item],
    transform: sk::Transform,
    alpha: f32,
    blend: sk::BlendMode,
    mask: Option<&sk::Mask>,
) {
    let Some(mut source) = group_source_pixmap(pixmap, children, item.clip, transform) else {
        return;
    };
    let source_alpha = alpha_plane_from_pixmap(&source);
    if !source_alpha.iter().any(|v| *v > 0.0) {
        return;
    }

    for effect in &item.effects {
        match effect {
            Effect::DropShadow {
                dx,
                dy,
                blur,
                color,
            } => draw_colored_alpha_plane(
                pixmap,
                &source_alpha,
                *blur,
                *dx,
                *dy,
                color,
                alpha,
                blend,
                mask,
            ),
            Effect::Glow { blur, color } => draw_colored_alpha_plane(
                pixmap,
                &source_alpha,
                *blur,
                0.0,
                0.0,
                color,
                alpha,
                blend,
                mask,
            ),
            Effect::Blur { .. }
            | Effect::Feather { .. }
            | Effect::InnerGlow { .. }
            | Effect::Unsupported(_) => {}
        }
    }

    for effect in &item.effects {
        match effect {
            Effect::Blur { radius } => blur_pixmap_in_place(&mut source, *radius),
            Effect::Feather { radius } => {
                let mask_plane = blur_alpha_plane(
                    &source_alpha,
                    source.width() as usize,
                    source.height() as usize,
                    *radius,
                );
                apply_alpha_plane_to_pixmap(&mut source, &mask_plane);
            }
            Effect::DropShadow { .. }
            | Effect::Glow { .. }
            | Effect::InnerGlow { .. }
            | Effect::Unsupported(_) => {}
        }
    }

    let paint = sk::PixmapPaint {
        opacity: alpha.clamp(0.0, 1.0),
        blend_mode: blend,
        ..Default::default()
    };
    pixmap.draw_pixmap(
        0,
        0,
        source.as_ref(),
        &paint,
        sk::Transform::identity(),
        mask,
    );

    render_group_inner_glows(pixmap, item, &source_alpha, alpha, blend, mask);
}

fn group_source_pixmap(
    pixmap: &sk::Pixmap,
    children: &[Item],
    clip: bool,
    transform: sk::Transform,
) -> Option<sk::Pixmap> {
    let mut source = sk::Pixmap::new(pixmap.width(), pixmap.height())?;
    render_group_children(&mut source, children, clip, transform, 1.0, None);
    Some(source)
}

fn render_group_inner_glows(
    pixmap: &mut sk::Pixmap,
    item: &Item,
    source_alpha: &[f32],
    alpha: f32,
    blend: sk::BlendMode,
    mask: Option<&sk::Mask>,
) {
    if !item
        .effects
        .iter()
        .any(|e| matches!(e, Effect::InnerGlow { .. }))
    {
        return;
    }
    let w = pixmap.width() as usize;
    let h = pixmap.height() as usize;
    let outside_alpha: Vec<f32> = source_alpha
        .iter()
        .map(|a| (1.0 - *a).clamp(0.0, 1.0))
        .collect();
    for effect in &item.effects {
        if let Effect::InnerGlow { blur, color } = effect {
            let blurred_outside = blur_alpha_plane(&outside_alpha, w, h, *blur);
            let inner: Vec<f32> = blurred_outside
                .iter()
                .zip(source_alpha.iter())
                .map(|(outside, source)| outside * source)
                .collect();
            draw_colored_alpha_plane(pixmap, &inner, 0.0, 0.0, 0.0, color, alpha, blend, mask);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn render_shape_base(
    pixmap: &mut sk::Pixmap,
    path: &sk::Path,
    item: &Item,
    bounds: sk::Rect,
    fill_rule: sk::FillRule,
    geos: &[PathGeometry],
    t: sk::Transform,
    alpha: f32,
    blend: sk::BlendMode,
    mask: Option<&sk::Mask>,
) {
    fill_path_with_paint(
        pixmap, path, &item.fill, bounds, fill_rule, t, alpha, blend, mask,
    );

    if item.stroke.width > 0.0 {
        if (item.kind == "path" || item.kind == "compound")
            && stroke_has_variable_width(&item.stroke)
        {
            if let Some(ribbon_path) = build_path(&variable_width_ribbons(geos, &item.stroke)) {
                fill_path_with_paint(
                    pixmap,
                    &ribbon_path,
                    &item.stroke.paint,
                    ribbon_path.bounds(),
                    sk::FillRule::EvenOdd,
                    t,
                    alpha,
                    blend,
                    mask,
                );
            }
            return;
        }
        let mut stroke = build_stroke(&item.stroke);
        let mut stroke_mask: Option<sk::Mask> = None;
        if stroke_align_needs_mask(&item.stroke.align, geos) {
            stroke.width *= 2.0;
            if let Some(mut align_mask) =
                build_path_fill_mask(path, fill_rule, t, pixmap.width(), pixmap.height())
            {
                if item.stroke.align == "outside" {
                    invert_mask(&mut align_mask);
                }
                stroke_mask = Some(if let Some(parent_mask) = mask {
                    intersect_masks(align_mask, parent_mask)
                } else {
                    align_mask
                });
            }
        }
        stroke_path_with_paint(
            pixmap,
            path,
            &item.stroke.paint,
            bounds,
            &stroke,
            t,
            alpha,
            blend,
            stroke_mask.as_ref().or(mask),
        );
    }
}

fn stroke_has_variable_width(stroke: &Stroke) -> bool {
    !stroke.width_profile.is_empty()
        && stroke
            .width_profile
            .iter()
            .any(|w| (*w - 1.0).abs() > f32::EPSILON)
}

fn variable_width_ribbons(geos: &[PathGeometry], stroke: &Stroke) -> Vec<PathGeometry> {
    if let [geo] = geos {
        let profile = if stroke.width_profile.len() == geo.anchors.len() {
            stroke.width_profile.clone()
        } else if stroke.width_profile.is_empty() {
            vec![1.0; geo.anchors.len()]
        } else {
            resample_width_profile(&stroke.width_profile, geo.anchors.len())
        };
        return geom::width_outline(geo, &profile, stroke.width);
    }
    let mut out = Vec::new();
    let mut offset = 0;
    for geo in geos {
        let remaining = stroke.width_profile.get(offset..).unwrap_or_default();
        let profile = if remaining.len() >= geo.anchors.len() {
            remaining[..geo.anchors.len()].to_vec()
        } else if remaining.is_empty() {
            vec![1.0; geo.anchors.len()]
        } else {
            resample_width_profile(remaining, geo.anchors.len())
        };
        out.extend(geom::width_outline(geo, &profile, stroke.width));
        offset += geo.anchors.len();
    }
    out
}

fn resample_width_profile(profile: &[f32], n: usize) -> Vec<f32> {
    if n == 0 {
        return Vec::new();
    }
    if profile.is_empty() {
        return vec![1.0; n];
    }
    if profile.len() == 1 {
        return vec![profile[0].max(0.0); n];
    }
    if n == 1 {
        return vec![profile[0].max(0.0)];
    }
    (0..n)
        .map(|i| {
            let t = i as f32 * (profile.len() - 1) as f32 / (n - 1) as f32;
            let a = t.floor() as usize;
            let b = (a + 1).min(profile.len() - 1);
            let f = t - a as f32;
            (profile[a] + (profile[b] - profile[a]) * f).max(0.0)
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn render_effects_behind(
    pixmap: &mut sk::Pixmap,
    item: &Item,
    path: &sk::Path,
    bounds: sk::Rect,
    fill_rule: sk::FillRule,
    geos: &[PathGeometry],
    t: sk::Transform,
    alpha: f32,
    blend: sk::BlendMode,
    mask: Option<&sk::Mask>,
) {
    if item.effects.is_empty() {
        return;
    }
    let Some(source_alpha) =
        item_source_alpha_plane(pixmap, item, path, bounds, fill_rule, geos, t)
    else {
        return;
    };
    for effect in &item.effects {
        match effect {
            Effect::DropShadow {
                dx,
                dy,
                blur,
                color,
            } => draw_colored_alpha_plane(
                pixmap,
                &source_alpha,
                *blur,
                *dx,
                *dy,
                color,
                alpha,
                blend,
                mask,
            ),
            Effect::Glow { blur, color } => draw_colored_alpha_plane(
                pixmap,
                &source_alpha,
                *blur,
                0.0,
                0.0,
                color,
                alpha,
                blend,
                mask,
            ),
            Effect::Blur { .. }
            | Effect::Feather { .. }
            | Effect::InnerGlow { .. }
            | Effect::Unsupported(_) => {}
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn render_source_replacing_effects(
    pixmap: &mut sk::Pixmap,
    item: &Item,
    path: &sk::Path,
    bounds: sk::Rect,
    fill_rule: sk::FillRule,
    geos: &[PathGeometry],
    t: sk::Transform,
    alpha: f32,
    blend: sk::BlendMode,
    mask: Option<&sk::Mask>,
) -> bool {
    if !item
        .effects
        .iter()
        .any(|e| matches!(e, Effect::Blur { .. } | Effect::Feather { .. }))
    {
        return false;
    }
    let Some(mut source) =
        item_source_pixmap(pixmap, item, path, bounds, fill_rule, geos, t, alpha)
    else {
        return true;
    };
    let mut feather_alpha: Option<Vec<f32>> = None;
    for effect in &item.effects {
        match effect {
            Effect::Blur { radius } => blur_pixmap_in_place(&mut source, *radius),
            Effect::Feather { radius } => {
                if feather_alpha.is_none() {
                    feather_alpha =
                        item_source_alpha_plane(pixmap, item, path, bounds, fill_rule, geos, t);
                }
                if let Some(alpha_plane) = feather_alpha.as_ref() {
                    let mask_plane = blur_alpha_plane(
                        alpha_plane,
                        source.width() as usize,
                        source.height() as usize,
                        *radius,
                    );
                    apply_alpha_plane_to_pixmap(&mut source, &mask_plane);
                }
            }
            Effect::DropShadow { .. }
            | Effect::Glow { .. }
            | Effect::InnerGlow { .. }
            | Effect::Unsupported(_) => {}
        }
    }
    let paint = sk::PixmapPaint {
        blend_mode: blend,
        ..Default::default()
    };
    pixmap.draw_pixmap(
        0,
        0,
        source.as_ref(),
        &paint,
        sk::Transform::identity(),
        mask,
    );
    true
}

#[allow(clippy::too_many_arguments)]
fn render_inner_glows(
    pixmap: &mut sk::Pixmap,
    item: &Item,
    path: &sk::Path,
    bounds: sk::Rect,
    fill_rule: sk::FillRule,
    geos: &[PathGeometry],
    t: sk::Transform,
    alpha: f32,
    blend: sk::BlendMode,
    mask: Option<&sk::Mask>,
) {
    if !item
        .effects
        .iter()
        .any(|e| matches!(e, Effect::InnerGlow { .. }))
    {
        return;
    }
    let Some(source_alpha) =
        item_source_alpha_plane(pixmap, item, path, bounds, fill_rule, geos, t)
    else {
        return;
    };
    let w = pixmap.width() as usize;
    let h = pixmap.height() as usize;
    let outside_alpha: Vec<f32> = source_alpha
        .iter()
        .map(|a| (1.0 - *a).clamp(0.0, 1.0))
        .collect();
    for effect in &item.effects {
        if let Effect::InnerGlow { blur, color } = effect {
            let blurred_outside = blur_alpha_plane(&outside_alpha, w, h, *blur);
            let inner: Vec<f32> = blurred_outside
                .iter()
                .zip(source_alpha.iter())
                .map(|(outside, source)| outside * source)
                .collect();
            draw_colored_alpha_plane(pixmap, &inner, 0.0, 0.0, 0.0, color, alpha, blend, mask);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn item_source_alpha_plane(
    pixmap: &sk::Pixmap,
    item: &Item,
    path: &sk::Path,
    bounds: sk::Rect,
    fill_rule: sk::FillRule,
    geos: &[PathGeometry],
    t: sk::Transform,
) -> Option<Vec<f32>> {
    let source = item_source_pixmap(pixmap, item, path, bounds, fill_rule, geos, t, 1.0)?;
    let alpha = alpha_plane_from_pixmap(&source);
    alpha.iter().any(|v| *v > 0.0).then_some(alpha)
}

#[allow(clippy::too_many_arguments)]
fn item_source_pixmap(
    pixmap: &sk::Pixmap,
    item: &Item,
    path: &sk::Path,
    bounds: sk::Rect,
    fill_rule: sk::FillRule,
    geos: &[PathGeometry],
    t: sk::Transform,
    alpha: f32,
) -> Option<sk::Pixmap> {
    let mut source = sk::Pixmap::new(pixmap.width(), pixmap.height())?;
    render_shape_base(
        &mut source,
        path,
        item,
        bounds,
        fill_rule,
        geos,
        t,
        alpha,
        sk::BlendMode::SourceOver,
        None,
    );
    Some(source)
}

fn alpha_plane_from_pixmap(pixmap: &sk::Pixmap) -> Vec<f32> {
    pixmap
        .pixels()
        .iter()
        .map(|p| p.alpha() as f32 / 255.0)
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn draw_colored_alpha_plane(
    pixmap: &mut sk::Pixmap,
    source_alpha: &[f32],
    blur: f32,
    dx: f32,
    dy: f32,
    color: &Rgba,
    alpha: f32,
    blend: sk::BlendMode,
    mask: Option<&sk::Mask>,
) {
    let color_alpha = color.a.clamp(0.0, 1.0) * alpha.clamp(0.0, 1.0);
    if color_alpha <= 0.0 {
        return;
    }
    let w = pixmap.width() as usize;
    let h = pixmap.height() as usize;
    let blurred = blur_alpha_plane(source_alpha, w, h, blur);
    let ox = dx.round() as i32;
    let oy = dy.round() as i32;
    let (wi, hi) = (w as i32, h as i32);
    let mut layer = match sk::Pixmap::new(pixmap.width(), pixmap.height()) {
        Some(layer) => layer,
        None => return,
    };
    let r = color.r.clamp(0.0, 255.0).round() as u8;
    let g = color.g.clamp(0.0, 255.0).round() as u8;
    let b = color.b.clamp(0.0, 255.0).round() as u8;
    for y in 0..hi {
        for x in 0..wi {
            let sx = x - ox;
            let sy = y - oy;
            if sx < 0 || sy < 0 || sx >= wi || sy >= hi {
                continue;
            }
            let coverage = blurred[(sy as usize) * w + sx as usize];
            if coverage <= 0.0 {
                continue;
            }
            let a = (coverage * color_alpha * 255.0).round().clamp(0.0, 255.0) as u8;
            if a == 0 {
                continue;
            }
            layer.pixels_mut()[(y as usize) * w + x as usize] =
                sk::ColorU8::from_rgba(r, g, b, a).premultiply();
        }
    }
    let paint = sk::PixmapPaint {
        blend_mode: blend,
        ..Default::default()
    };
    pixmap.draw_pixmap(
        0,
        0,
        layer.as_ref(),
        &paint,
        sk::Transform::identity(),
        mask,
    );
}

fn blur_pixmap_in_place(pixmap: &mut sk::Pixmap, radius: f32) {
    if radius < 0.1 {
        return;
    }
    let w = pixmap.width() as usize;
    let h = pixmap.height() as usize;
    let mut red = Vec::with_capacity(w * h);
    let mut green = Vec::with_capacity(w * h);
    let mut blue = Vec::with_capacity(w * h);
    let mut alpha = Vec::with_capacity(w * h);
    for pixel in pixmap.pixels() {
        red.push(pixel.red() as f32 / 255.0);
        green.push(pixel.green() as f32 / 255.0);
        blue.push(pixel.blue() as f32 / 255.0);
        alpha.push(pixel.alpha() as f32 / 255.0);
    }

    let red = blur_alpha_plane(&red, w, h, radius);
    let green = blur_alpha_plane(&green, w, h, radius);
    let blue = blur_alpha_plane(&blue, w, h, radius);
    let alpha = blur_alpha_plane(&alpha, w, h, radius);
    for (i, pixel) in pixmap.pixels_mut().iter_mut().enumerate() {
        let a = (alpha[i] * 255.0).round().clamp(0.0, 255.0) as u8;
        let r = (red[i] * 255.0).round().clamp(0.0, a as f32) as u8;
        let g = (green[i] * 255.0).round().clamp(0.0, a as f32) as u8;
        let b = (blue[i] * 255.0).round().clamp(0.0, a as f32) as u8;
        *pixel = sk::PremultipliedColorU8::from_rgba(r, g, b, a)
            .unwrap_or(sk::PremultipliedColorU8::TRANSPARENT);
    }
}

fn render_text(
    pixmap: &mut sk::Pixmap,
    item: &Item,
    t: sk::Transform,
    alpha: f32,
    mask: Option<&sk::Mask>,
) {
    let run_paths = build_text_run_paths(item);
    let Some(path) = run_paths
        .as_deref()
        .and_then(combine_text_run_paths)
        .or_else(|| build_text_path(item))
    else {
        return;
    };
    let bounds = path.bounds();
    let blend = blend_mode(&item.blend_mode);
    let fill_rule = sk::FillRule::Winding;
    let geos: &[PathGeometry] = &[];

    render_effects_behind(
        pixmap, item, &path, bounds, fill_rule, geos, t, alpha, blend, mask,
    );

    if !render_source_replacing_effects(
        pixmap, item, &path, bounds, fill_rule, geos, t, alpha, blend, mask,
    ) {
        if let Some(run_paths) = &run_paths {
            for run_path in run_paths {
                let run_bounds = run_path.path.bounds();
                let fill = run_path.fill.as_ref().unwrap_or(&item.fill);
                fill_path_with_paint(
                    pixmap,
                    &run_path.path,
                    fill,
                    run_bounds,
                    fill_rule,
                    t,
                    alpha,
                    blend,
                    mask,
                );

                if item.stroke.width > 0.0 {
                    let stroke = build_stroke(&item.stroke);
                    stroke_path_with_paint(
                        pixmap,
                        &run_path.path,
                        &item.stroke.paint,
                        run_bounds,
                        &stroke,
                        t,
                        alpha,
                        blend,
                        mask,
                    );
                }
            }
        } else {
            fill_path_with_paint(
                pixmap, &path, &item.fill, bounds, fill_rule, t, alpha, blend, mask,
            );

            if item.stroke.width > 0.0 {
                let stroke = build_stroke(&item.stroke);
                stroke_path_with_paint(
                    pixmap,
                    &path,
                    &item.stroke.paint,
                    bounds,
                    &stroke,
                    t,
                    alpha,
                    blend,
                    mask,
                );
            }
        }
    }

    render_inner_glows(
        pixmap, item, &path, bounds, fill_rule, geos, t, alpha, blend, mask,
    );
}

fn build_text_path(item: &Item) -> Option<sk::Path> {
    if let Some(path) = build_registered_font_text_path(item) {
        return Some(path);
    }

    let text = text_content(item)?;
    if text.is_empty() {
        return None;
    }

    let font_size = extra_f32(item, "fontSize", 48.0).clamp(1.0, 4096.0);
    let horizontal_scale = (extra_f32(item, "horizontalScale", 100.0) / 100.0).clamp(0.01, 64.0);
    let vertical_scale = (extra_f32(item, "verticalScale", 100.0) / 100.0).clamp(0.01, 64.0);
    let cell_w = font_size / 7.0 * horizontal_scale;
    let cell_h = font_size / 7.0 * vertical_scale;
    let letter_spacing = extra_f32(item, "letterSpacing", 0.0);
    let line_height = extra_f32(item, "lineHeight", 1.2).clamp(0.1, 16.0);
    let baseline_shift = extra_f32(item, "baselineShift", 0.0);
    let font_weight = extra_f32(item, "fontWeight", 400.0);
    let bold_expand = if font_weight >= 650.0 {
        (cell_w * 0.18).min(cell_w * 0.5)
    } else {
        0.0
    };
    let italic = extra_str(item, "fontStyle").is_some_and(|v| v == "italic");
    let underline = extra_bool(item, "underline");
    let strikethrough = extra_bool(item, "strikethrough");
    let align = extra_str(item, "align").unwrap_or("left");
    let base_rtl = extra_str(item, "direction").is_some_and(|v| v == "rtl");
    let world_ready = extra_str(item, "composer").is_some_and(|v| v == "worldReady");
    let box_width = text_layout_width(item);
    let wrap_width = text_wrap_width(item);

    let text = if let Some(wrap_width) = wrap_width {
        let breaks = soft_wrap_offsets(&text, wrap_width, |range| {
            let line = &text[range];
            let chars = if world_ready {
                visual_bidi_chars(line, base_rtl)
            } else {
                line.chars().collect()
            };
            Some(measure_text_chars(&chars, cell_w, letter_spacing))
        })?;
        insert_soft_breaks(&text, &breaks)
    } else {
        text
    };

    let mut pb = sk::PathBuilder::new();
    let mut any = false;
    let line_advance = font_size * line_height * vertical_scale;

    for (line_index, line) in text.split('\n').enumerate() {
        let line = trim_trailing_text_space(line);
        let chars = if world_ready {
            visual_bidi_chars(line, base_rtl)
        } else {
            line.chars().collect()
        };
        let line_width = measure_text_chars(&chars, cell_w, letter_spacing);
        let layout_width = box_width.unwrap_or(line_width).max(line_width);
        let start_x = match align {
            "center" => (layout_width - line_width) * 0.5,
            "right" => layout_width - line_width,
            _ => 0.0,
        };
        let baseline_y = line_index as f32 * line_advance - baseline_shift;
        let top = baseline_y - 7.0 * cell_h;
        let mut x = start_x;
        for (idx, ch) in chars.iter().copied().enumerate() {
            if is_text_space(ch) {
                x += char_advance(ch, cell_w);
            } else {
                push_glyph_path(
                    &mut pb,
                    ch,
                    x,
                    top,
                    cell_w,
                    cell_h,
                    bold_expand,
                    italic,
                    &mut any,
                );
                x += char_advance(ch, cell_w);
            }
            if idx + 1 < chars.len() {
                x += letter_spacing;
            }
        }

        if line_width > 0.0 && underline {
            push_rect_path(
                &mut pb,
                start_x,
                baseline_y + cell_h * 0.45,
                line_width,
                cell_h * 0.35,
                &mut any,
            );
        }
        if line_width > 0.0 && strikethrough {
            push_rect_path(
                &mut pb,
                start_x,
                top + cell_h * 3.2,
                line_width,
                cell_h * 0.35,
                &mut any,
            );
        }
    }

    any.then(|| pb.finish()).flatten()
}

fn build_registered_font_text_path(item: &Item) -> Option<sk::Path> {
    if item
        .extra
        .get("runs")
        .and_then(|value| value.as_array())
        .is_some_and(|runs| !runs.is_empty())
    {
        let run_paths = build_registered_font_text_run_paths(item)?;
        return combine_text_run_paths(&run_paths);
    }
    let family = extra_str(item, "fontFamily")?;
    let text = text_content(item)?;
    if text.is_empty() {
        return None;
    }

    let weight = extra_f32(item, "fontWeight", 400.0);
    let italic = extra_str(item, "fontStyle").is_some_and(|v| v == "italic");
    let whole_line = crate::vector::fonts::with_font_for_style(family, weight, italic, |font| {
        build_font_text_path_for_face(item, &text, &font)
    });
    whole_line
        .or_else(|| build_fallback_font_text_path_for_family(item, &text, family, weight, italic))
}

/// Type ▸ Create Work Path / Convert to Shape: the glyph outlines a text item
/// renders with, as editable anchor geometry (real handles from the font, first
/// baseline at y = 0). `None` when no registered face covers the item's font
/// stack — the built-in fallback glyphs are bitmap cells, so the caller keeps
/// its pixel trace instead.
pub fn registered_text_outline(item: &Item) -> Option<Vec<PathGeometry>> {
    let path = build_registered_font_text_path(item)?;
    let mut subs = skia_path_to_geometry(&path);
    for g in &mut subs {
        // ttf-parser walks the final segment back to the start point before
        // `close`, so a closed contour lists its first anchor twice: fold the
        // duplicate's incoming handle into the first anchor and drop it.
        let Some((last, rest)) = g.anchors.split_last() else {
            continue;
        };
        let coincident = rest.first().is_some_and(|f| {
            (f.point.x - last.point.x).abs() < 1e-3 && (f.point.y - last.point.y).abs() < 1e-3
        });
        if g.closed && rest.len() >= 2 && coincident {
            let handle_in = last.handle_in;
            g.anchors.pop();
            g.anchors[0].handle_in = handle_in;
        }
    }
    Some(subs)
}

fn combine_text_run_paths(run_paths: &[TextRunPath]) -> Option<sk::Path> {
    if run_paths.is_empty() {
        return None;
    }
    let mut pb = sk::PathBuilder::new();
    for run_path in run_paths {
        pb.push_path(&run_path.path);
    }
    pb.finish()
}

fn build_font_text_path_for_face(
    item: &Item,
    text: &str,
    font: &crate::vector::fonts::RegisteredFontFace<'_>,
) -> Option<sk::Path> {
    let font_size = extra_f32(item, "fontSize", 48.0).clamp(1.0, 4096.0);
    let horizontal_scale = (extra_f32(item, "horizontalScale", 100.0) / 100.0).clamp(0.01, 64.0);
    let vertical_scale = (extra_f32(item, "verticalScale", 100.0) / 100.0).clamp(0.01, 64.0);
    let units_per_em = font.face.units_per_em() as f32;
    if units_per_em <= 0.0 {
        return None;
    }
    let sx = font_size / units_per_em * horizontal_scale;
    let sy = font_size / units_per_em * vertical_scale;
    let letter_spacing = extra_f32(item, "letterSpacing", 0.0);
    let line_height = extra_f32(item, "lineHeight", 1.2).clamp(0.1, 16.0);
    let baseline_shift = extra_f32(item, "baselineShift", 0.0);
    let underline = extra_bool(item, "underline");
    let strikethrough = extra_bool(item, "strikethrough");
    let align = extra_str(item, "align").unwrap_or("left");
    let direction = extra_str(item, "direction");
    let base_rtl = direction.is_some_and(|v| v == "rtl");
    let world_ready = extra_str(item, "composer").is_some_and(|v| v == "worldReady");
    let language = extra_str(item, "language");
    let open_type_features = rustybuzz_features(&open_type_feature_settings_from_item(item));
    let variation_settings = font_variation_settings_from_item(item);
    let font_variations = rustybuzz_variations(&variation_settings);
    let outline_face = font_face_with_variations(&font.face, &variation_settings);
    let requested_italic = extra_str(item, "fontStyle").is_some_and(|v| v == "italic");
    let italic = requested_italic && !font.italic;
    let box_width = text_layout_width(item);
    let line_advance = font_size * line_height * vertical_scale;

    let wrapped_text = if let Some(wrap_width) = text_wrap_width(item) {
        let breaks = soft_wrap_offsets(text, wrap_width, |range| {
            shape_font_line(
                font,
                &text[range],
                direction,
                language,
                base_rtl,
                world_ready,
                false,
                sx,
                sy,
                letter_spacing,
                &open_type_features,
                &font_variations,
            )
            .map(|line| line.width)
        })?;
        Some(insert_soft_breaks(text, &breaks))
    } else {
        None
    };
    let text = wrapped_text.as_deref().unwrap_or(text);

    let shaped_lines = text
        .split('\n')
        .map(|line| {
            let line = trim_trailing_text_space(line);
            let shaped = shape_font_line(
                font,
                line,
                direction,
                language,
                base_rtl,
                world_ready,
                false,
                sx,
                sy,
                letter_spacing,
                &open_type_features,
                &font_variations,
            )?;
            let visible_width = shaped.width;
            Some((shaped, visible_width))
        })
        .collect::<Option<Vec<_>>>()?;

    let mut line_starts = Vec::with_capacity(shaped_lines.len());
    for (_, line_width) in &shaped_lines {
        let line_width = *line_width;
        let layout_width = box_width.unwrap_or(line_width).max(line_width);
        line_starts.push(match align {
            "center" => (layout_width - line_width) * 0.5,
            "right" => layout_width - line_width,
            _ => 0.0,
        });
    }

    let mut pb = sk::PathBuilder::new();
    let mut any = false;

    for (line_index, (shaped, line_width)) in shaped_lines.iter().enumerate() {
        let line_width = *line_width;
        let line_baseline_y = line_index as f32 * line_advance - baseline_shift;
        push_shaped_font_line_path(
            &outline_face,
            &mut pb,
            shaped,
            line_starts.get(line_index).copied().unwrap_or(0.0),
            line_baseline_y,
            sx,
            sy,
            italic,
            letter_spacing,
            &mut any,
        );

        if line_width > 0.0 && underline {
            push_rect_path(
                &mut pb,
                line_starts.get(line_index).copied().unwrap_or(0.0),
                line_baseline_y + font_size * 0.08,
                line_width,
                font_size * 0.06,
                &mut any,
            );
        }
        if line_width > 0.0 && strikethrough {
            push_rect_path(
                &mut pb,
                line_starts.get(line_index).copied().unwrap_or(0.0),
                line_baseline_y - font_size * 0.32,
                line_width,
                font_size * 0.06,
                &mut any,
            );
        }
    }

    any.then(|| pb.finish()).flatten()
}

struct FallbackFontLinePath {
    path: Option<sk::Path>,
    width: f32,
}

struct RegisteredFontLinePath {
    path: Option<sk::Path>,
    width: f32,
    advance_x: f32,
}

fn build_fallback_font_text_path_for_family(
    item: &Item,
    text: &str,
    family: &str,
    weight: f32,
    italic: bool,
) -> Option<sk::Path> {
    let font_size = extra_f32(item, "fontSize", 48.0).clamp(1.0, 4096.0);
    let horizontal_scale = (extra_f32(item, "horizontalScale", 100.0) / 100.0).clamp(0.01, 64.0);
    let vertical_scale = (extra_f32(item, "verticalScale", 100.0) / 100.0).clamp(0.01, 64.0);
    let letter_spacing = extra_f32(item, "letterSpacing", 0.0);
    let line_height = extra_f32(item, "lineHeight", 1.2).clamp(0.1, 16.0);
    let baseline_shift = extra_f32(item, "baselineShift", 0.0);
    let underline = extra_bool(item, "underline");
    let strikethrough = extra_bool(item, "strikethrough");
    let align = extra_str(item, "align").unwrap_or("left");
    let direction = extra_str(item, "direction");
    let base_rtl = direction.is_some_and(|v| v == "rtl");
    let world_ready = extra_str(item, "composer").is_some_and(|v| v == "worldReady");
    let language = extra_str(item, "language");
    let open_type_features = rustybuzz_features(&open_type_feature_settings_from_item(item));
    let variation_settings = font_variation_settings_from_item(item);
    let font_variations = rustybuzz_variations(&variation_settings);
    let box_width = text_layout_width(item);
    let line_advance = font_size * line_height * vertical_scale;

    let wrapped_text = if let Some(wrap_width) = text_wrap_width(item) {
        let breaks = soft_wrap_offsets(text, wrap_width, |range| {
            build_fallback_font_line_path_for_family(
                family,
                weight,
                italic,
                &text[range],
                direction,
                language,
                base_rtl,
                world_ready,
                font_size,
                horizontal_scale,
                vertical_scale,
                letter_spacing,
                &open_type_features,
                &font_variations,
                &variation_settings,
            )
            .map(|line| line.width)
        })?;
        Some(insert_soft_breaks(text, &breaks))
    } else {
        None
    };
    let text = wrapped_text.as_deref().unwrap_or(text);

    let fallback_lines = text
        .split('\n')
        .map(|line| {
            let line = trim_trailing_text_space(line);
            let built = build_fallback_font_line_path_for_family(
                family,
                weight,
                italic,
                line,
                direction,
                language,
                base_rtl,
                world_ready,
                font_size,
                horizontal_scale,
                vertical_scale,
                letter_spacing,
                &open_type_features,
                &font_variations,
                &variation_settings,
            )?;
            let visible_width = built.width;
            Some((built, visible_width))
        })
        .collect::<Option<Vec<_>>>()?;

    let mut line_starts = Vec::with_capacity(fallback_lines.len());
    for (_, visible_width) in &fallback_lines {
        let layout_width = box_width.unwrap_or(*visible_width).max(*visible_width);
        line_starts.push(match align {
            "center" => (layout_width - visible_width) * 0.5,
            "right" => layout_width - visible_width,
            _ => 0.0,
        });
    }

    let mut pb = sk::PathBuilder::new();
    let mut any = false;
    for (line_index, (line, visible_width)) in fallback_lines.into_iter().enumerate() {
        let line_start = line_starts.get(line_index).copied().unwrap_or(0.0);
        let baseline_y = line_index as f32 * line_advance - baseline_shift;
        if let Some(path) = line
            .path
            .and_then(|path| path.transform(sk::Transform::from_translate(line_start, baseline_y)))
        {
            pb.push_path(&path);
            any = true;
        }
        if visible_width > 0.0 && underline {
            push_rect_path(
                &mut pb,
                line_start,
                baseline_y + font_size * 0.08,
                visible_width,
                font_size * 0.06,
                &mut any,
            );
        }
        if visible_width > 0.0 && strikethrough {
            push_rect_path(
                &mut pb,
                line_start,
                baseline_y - font_size * 0.32,
                visible_width,
                font_size * 0.06,
                &mut any,
            );
        }
    }

    any.then(|| pb.finish()).flatten()
}

#[allow(clippy::too_many_arguments)]
fn build_fallback_font_line_path_for_family(
    family: &str,
    weight: f32,
    italic: bool,
    line: &str,
    direction: Option<&str>,
    language: Option<&str>,
    base_rtl: bool,
    world_ready: bool,
    font_size: f32,
    horizontal_scale: f32,
    vertical_scale: f32,
    letter_spacing: f32,
    open_type_features: &[rustybuzz::Feature],
    font_variations: &[rustybuzz::Variation],
    variation_settings: &[FontVariationSetting],
) -> Option<FallbackFontLinePath> {
    let line = prepared_shape_line_text(line, base_rtl, world_ready);
    if line.is_empty() {
        return Some(FallbackFontLinePath {
            path: None,
            width: 0.0,
        });
    }

    let chars = line.chars().collect::<Vec<_>>();
    let mut x = 0.0;
    let mut width = 0.0;
    let mut pb = sk::PathBuilder::new();
    let mut any = false;

    // Walk the line, grouping the longest run of characters that a single face in
    // the stack can cover starting at each position, and shape each run as a unit
    // so its intra-run kerning/ligatures apply. This keeps covered runs shaped
    // together even when no single face covers the whole line, rather than shaping
    // every character in isolation. The line is already in visual order, so the
    // segment shaping passes `skip_reorder` to avoid re-running the bidi reorder.
    let mut pos = 0usize;
    while pos < chars.len() {
        let segment = crate::vector::fonts::with_font_for_style(family, weight, italic, |font| {
            let covered = covered_prefix_len(&font.face, &chars[pos..]);
            if covered == 0 {
                return None;
            }
            let units_per_em = font.face.units_per_em() as f32;
            if units_per_em <= 0.0 {
                return None;
            }
            let sx = font_size / units_per_em * horizontal_scale;
            let sy = font_size / units_per_em * vertical_scale;
            let run: String = chars[pos..pos + covered].iter().collect();
            let shaped = shape_font_line(
                &font,
                &run,
                direction,
                language,
                base_rtl,
                world_ready,
                true,
                sx,
                sy,
                letter_spacing,
                open_type_features,
                font_variations,
            )?;
            let faux_italic = italic && !font.italic;
            let outline_face = font_face_with_variations(&font.face, variation_settings);
            let mut segment_pb = sk::PathBuilder::new();
            let mut segment_any = false;
            let (next_x, _) = push_shaped_font_line_path(
                &outline_face,
                &mut segment_pb,
                &shaped,
                x,
                0.0,
                sx,
                sy,
                faux_italic,
                letter_spacing,
                &mut segment_any,
            );
            let path = segment_any.then(|| segment_pb.finish()).flatten();
            Some((path, next_x, shaped.width, covered))
        })?;

        let (path, next_x, advance, covered) = segment;
        if let Some(path) = path {
            pb.push_path(&path);
            any = true;
        }
        x = next_x;
        width += advance;
        pos += covered;
        if pos < chars.len() {
            x += letter_spacing;
            width += letter_spacing;
        }
    }

    Some(FallbackFontLinePath {
        path: any.then(|| pb.finish()).flatten(),
        width,
    })
}

// Count the leading characters of `chars` that `face` can render (spaces always
// count; a non-space needs a cmap glyph). Used to munch the longest run a single
// face covers during per-run coverage fallback.
fn covered_prefix_len(face: &ttf_parser::Face<'_>, chars: &[char]) -> usize {
    let mut n = 0;
    for &ch in chars {
        if is_text_space(ch) || face.glyph_index(ch).is_some() {
            n += 1;
        } else {
            break;
        }
    }
    n
}

fn build_registered_font_text_run_paths(item: &Item) -> Option<Vec<TextRunPath>> {
    let runs = text_runs(item)?;
    let family = extra_str(item, "fontFamily")?;
    build_font_text_run_paths_for_family(item, family, &runs)
}

fn build_font_text_run_paths_for_family(
    item: &Item,
    family: &str,
    runs: &[TextRunFallback],
) -> Option<Vec<TextRunPath>> {
    let font_size = extra_f32(item, "fontSize", 48.0).clamp(1.0, 4096.0);
    let horizontal_scale = (extra_f32(item, "horizontalScale", 100.0) / 100.0).clamp(0.01, 64.0);
    let vertical_scale = (extra_f32(item, "verticalScale", 100.0) / 100.0).clamp(0.01, 64.0);
    let letter_spacing = extra_f32(item, "letterSpacing", 0.0);
    let line_height = extra_f32(item, "lineHeight", 1.2).clamp(0.1, 16.0);
    let baseline_shift = extra_f32(item, "baselineShift", 0.0);
    let item_font_weight = extra_f32(item, "fontWeight", 400.0);
    let item_italic = extra_str(item, "fontStyle").is_some_and(|v| v == "italic");
    let underline = extra_bool(item, "underline");
    let strikethrough = extra_bool(item, "strikethrough");
    let align = extra_str(item, "align").unwrap_or("left");
    let direction = extra_str(item, "direction");
    let base_rtl = direction.is_some_and(|v| v == "rtl");
    let world_ready = extra_str(item, "composer").is_some_and(|v| v == "worldReady");
    let language = extra_str(item, "language");
    let item_open_type_features = open_type_feature_settings_from_item(item);
    let item_font_variations = font_variation_settings_from_item(item);
    let box_width = text_layout_width(item);
    let line_advance = font_size * line_height * vertical_scale;

    let wrapped_runs = if let Some(wrap_width) = text_wrap_width(item) {
        let full_text: String = runs.iter().map(|run| run.text.as_str()).collect();
        let breaks = soft_wrap_offsets(&full_text, wrap_width, |range| {
            measure_registered_text_run_range(
                family,
                runs,
                range,
                item_font_weight,
                item_italic,
                direction,
                language,
                base_rtl,
                world_ready,
                font_size,
                horizontal_scale,
                vertical_scale,
                letter_spacing,
                &item_open_type_features,
                &item_font_variations,
            )
        })?;
        Some(insert_soft_breaks_in_runs(runs, &breaks))
    } else {
        None
    };
    let runs = wrapped_runs.as_deref().unwrap_or(runs);
    let visible_runs = strip_line_end_text_space_in_runs(runs);
    let runs = visible_runs.as_slice();
    let full_text: String = runs.iter().map(|run| run.text.as_str()).collect();
    let line_widths = text_line_ranges(&full_text)
        .into_iter()
        .map(|range| {
            measure_registered_text_run_range(
                family,
                runs,
                trim_text_range_end(&full_text, range),
                item_font_weight,
                item_italic,
                direction,
                language,
                base_rtl,
                world_ready,
                font_size,
                horizontal_scale,
                vertical_scale,
                letter_spacing,
                &item_open_type_features,
                &item_font_variations,
            )
        })
        .collect::<Option<Vec<_>>>()?;

    // Pass 1: shape and build each run-line exactly once (at the origin) and
    // accumulate per-line widths. Pass 2 reuses these prebuilt paths, so
    // registered rich text is no longer shaped and drawn twice per render.
    struct BuiltRunLine {
        path: Option<sk::Path>,
        width: f32,
        visible_width: f32,
        advance_x: f32,
        ends_line: bool,
    }
    let mut built: Vec<Vec<BuiltRunLine>> = Vec::with_capacity(runs.len());
    for run in runs {
        let mut pieces = Vec::new();
        let mut parts = run.text.split('\n').peekable();
        while let Some(part) = parts.next() {
            let ends_line = parts.peek().is_some();
            if part.is_empty() {
                pieces.push(BuiltRunLine {
                    path: None,
                    width: 0.0,
                    visible_width: 0.0,
                    advance_x: 0.0,
                    ends_line,
                });
            } else {
                let line_path = build_registered_font_run_line_path_for_family(
                    family,
                    run,
                    item_font_weight,
                    item_italic,
                    part,
                    direction,
                    language,
                    base_rtl,
                    world_ready,
                    font_size,
                    horizontal_scale,
                    vertical_scale,
                    letter_spacing,
                    &item_open_type_features,
                    &item_font_variations,
                )?;
                let visible_part = trim_trailing_text_space(part);
                let visible_width = if visible_part.len() == part.len() {
                    line_path.width
                } else if visible_part.is_empty() {
                    0.0
                } else {
                    build_registered_font_run_line_path_for_family(
                        family,
                        run,
                        item_font_weight,
                        item_italic,
                        visible_part,
                        direction,
                        language,
                        base_rtl,
                        world_ready,
                        font_size,
                        horizontal_scale,
                        vertical_scale,
                        letter_spacing,
                        &item_open_type_features,
                        &item_font_variations,
                    )?
                    .width
                };
                pieces.push(BuiltRunLine {
                    path: line_path.path,
                    width: line_path.width,
                    visible_width,
                    advance_x: line_path.advance_x,
                    ends_line,
                });
            }
        }
        built.push(pieces);
    }

    let line_starts: Vec<f32> = line_widths
        .iter()
        .map(|&line_width| {
            let layout_width = box_width.unwrap_or(line_width).max(line_width);
            match align {
                "center" => (layout_width - line_width) * 0.5,
                "right" => layout_width - line_width,
                _ => 0.0,
            }
        })
        .collect();

    // Pass 2: place the prebuilt line paths using the computed line starts.
    let mut out = Vec::new();
    let mut line_index = 0usize;
    let mut x = line_starts.first().copied().unwrap_or(0.0);
    let mut y_shift = 0.0;

    for (run_index, (run, pieces)) in runs.iter().zip(&built).enumerate() {
        x += run.dx;
        y_shift += run.dy;

        let mut pb = sk::PathBuilder::new();
        let mut any = false;
        let mut segment_start_x = x;
        let mut segment_width = 0.0;

        for piece in pieces {
            let baseline_y = line_index as f32 * line_advance - baseline_shift + y_shift;
            if let Some(path) = piece.path.as_ref().and_then(|path| {
                path.clone()
                    .transform(sk::Transform::from_translate(x, baseline_y))
            }) {
                pb.push_path(&path);
                any = true;
            }
            x += piece.advance_x;
            segment_width += piece.width;

            if piece.ends_line {
                let visible_segment_width =
                    (segment_width - piece.width + piece.visible_width).max(0.0);
                push_registered_text_decoration_paths(
                    &mut pb,
                    segment_start_x,
                    visible_segment_width,
                    line_index,
                    line_advance,
                    baseline_shift,
                    y_shift,
                    font_size,
                    underline,
                    strikethrough,
                    &mut any,
                );
                line_index += 1;
                x = line_starts.get(line_index).copied().unwrap_or(0.0);
                segment_start_x = x;
                segment_width = 0.0;
            }
        }

        let final_segment_width = if run_index + 1 == runs.len() {
            pieces
                .last()
                .map(|piece| (segment_width - piece.width + piece.visible_width).max(0.0))
                .unwrap_or(segment_width)
        } else {
            segment_width
        };
        push_registered_text_decoration_paths(
            &mut pb,
            segment_start_x,
            final_segment_width,
            line_index,
            line_advance,
            baseline_shift,
            y_shift,
            font_size,
            underline,
            strikethrough,
            &mut any,
        );

        if let Some(path) = any.then(|| pb.finish()).flatten() {
            out.push(TextRunPath {
                path,
                fill: run.fill.clone(),
            });
        }
    }

    (!out.is_empty()).then_some(out)
}

#[allow(clippy::too_many_arguments)]
fn measure_registered_text_run_range(
    family: &str,
    runs: &[TextRunFallback],
    range: std::ops::Range<usize>,
    item_font_weight: f32,
    item_italic: bool,
    direction: Option<&str>,
    language: Option<&str>,
    base_rtl: bool,
    world_ready: bool,
    font_size: f32,
    horizontal_scale: f32,
    vertical_scale: f32,
    letter_spacing: f32,
    item_open_type_features: &[OpenTypeFeatureSetting],
    item_font_variations: &[FontVariationSetting],
) -> Option<f32> {
    let mut width = 0.0;
    let mut run_start = 0usize;
    for run in runs {
        let run_end = run_start + run.text.len();
        let overlap_start = range.start.max(run_start);
        let overlap_end = range.end.min(run_end);
        if overlap_start < overlap_end {
            if overlap_start == run_start {
                width += run.dx;
            }
            let line = &run.text[overlap_start - run_start..overlap_end - run_start];
            width += build_registered_font_run_line_path_for_family(
                family,
                run,
                item_font_weight,
                item_italic,
                line,
                direction,
                language,
                base_rtl,
                world_ready,
                font_size,
                horizontal_scale,
                vertical_scale,
                letter_spacing,
                item_open_type_features,
                item_font_variations,
            )?
            .width;
        }
        run_start = run_end;
        if run_start >= range.end {
            break;
        }
    }
    Some(width.max(0.0))
}

#[allow(clippy::too_many_arguments)]
fn build_registered_font_run_line_path_for_family(
    family: &str,
    run: &TextRunFallback,
    item_font_weight: f32,
    item_italic: bool,
    line: &str,
    direction: Option<&str>,
    language: Option<&str>,
    base_rtl: bool,
    world_ready: bool,
    font_size: f32,
    horizontal_scale: f32,
    vertical_scale: f32,
    letter_spacing: f32,
    item_open_type_features: &[OpenTypeFeatureSetting],
    item_font_variations: &[FontVariationSetting],
) -> Option<RegisteredFontLinePath> {
    let requested_weight = run.font_weight.unwrap_or(item_font_weight);
    let requested_italic = run.italic.unwrap_or(item_italic);
    let open_type_settings =
        merged_open_type_feature_settings(item_open_type_features, &run.open_type_features);
    let open_type_features = rustybuzz_features(&open_type_settings);
    let variation_settings =
        merged_font_variation_settings(item_font_variations, &run.font_variations);
    let font_variations = rustybuzz_variations(&variation_settings);
    let whole_line = crate::vector::fonts::with_font_for_style(
        family,
        requested_weight,
        requested_italic,
        |font| {
            let units_per_em = font.face.units_per_em() as f32;
            if units_per_em <= 0.0 {
                return None;
            }
            let sx = font_size / units_per_em * horizontal_scale;
            let sy = font_size / units_per_em * vertical_scale;
            let shaped = shape_font_line(
                &font,
                line,
                direction,
                language,
                base_rtl,
                world_ready,
                false,
                sx,
                sy,
                letter_spacing,
                &open_type_features,
                &font_variations,
            )?;
            let faux_italic = requested_italic && !font.italic;
            let outline_face = font_face_with_variations(&font.face, &variation_settings);
            let mut pb = sk::PathBuilder::new();
            let mut any = false;
            let (advance_x, _) = push_shaped_font_line_path(
                &outline_face,
                &mut pb,
                &shaped,
                0.0,
                0.0,
                sx,
                sy,
                faux_italic,
                letter_spacing,
                &mut any,
            );
            Some(RegisteredFontLinePath {
                path: any.then(|| pb.finish()).flatten(),
                width: shaped.width,
                advance_x,
            })
        },
    );

    whole_line.or_else(|| {
        build_fallback_font_line_path_for_family(
            family,
            requested_weight,
            requested_italic,
            line,
            direction,
            language,
            base_rtl,
            world_ready,
            font_size,
            horizontal_scale,
            vertical_scale,
            letter_spacing,
            &open_type_features,
            &font_variations,
            &variation_settings,
        )
        .map(|line| RegisteredFontLinePath {
            advance_x: line.width,
            width: line.width,
            path: line.path,
        })
    })
}

#[derive(Debug)]
struct ShapedFontLine {
    glyphs: Vec<ShapedFontGlyph>,
    width: f32,
}

#[derive(Debug)]
struct ShapedFontGlyph {
    glyph: ttf_parser::GlyphId,
    /// rustybuzz cluster id — glyphs sharing one are a single grapheme.
    cluster: u32,
    x_offset: f32,
    y_offset: f32,
    x_advance: f32,
    y_advance: f32,
}

/// (#18) Tracking goes BETWEEN clusters only. Nonspacing marks (Arabic harakat,
/// Hebrew niqqud, Indic matras) shape as extra zero-advance glyphs inside their
/// base glyph's cluster and are positioned by offset over it; inserting the gap
/// there detaches the mark from its base and inflates the measured line width.
fn letter_gap_after(glyphs: &[ShapedFontGlyph], idx: usize) -> bool {
    glyphs
        .get(idx + 1)
        .is_some_and(|next| next.cluster != glyphs[idx].cluster)
}

fn shaped_line_width(glyphs: &[ShapedFontGlyph], letter_spacing: f32) -> f32 {
    let mut width = 0.0;
    for (idx, glyph) in glyphs.iter().enumerate() {
        width += glyph.x_advance;
        if letter_gap_after(glyphs, idx) {
            width += letter_spacing;
        }
    }
    width
}

#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_arguments)]
fn shape_font_line(
    font: &crate::vector::fonts::RegisteredFontFace<'_>,
    line: &str,
    direction: Option<&str>,
    language: Option<&str>,
    base_rtl: bool,
    world_ready: bool,
    skip_reorder: bool,
    sx: f32,
    sy: f32,
    letter_spacing: f32,
    open_type_features: &[rustybuzz::Feature],
    font_variations: &[rustybuzz::Variation],
) -> Option<ShapedFontLine> {
    // `skip_reorder` is set when the caller already applied line-level bidi
    // reordering (per-run coverage segmentation shapes runs that are already in
    // visual order); re-running the reorder here would double it. `world_ready`
    // still drives the LTR/guess decision below.
    let line = if skip_reorder {
        if line.contains('\t') {
            line.replace('\t', "    ")
        } else {
            line.to_string()
        }
    } else {
        prepared_shape_line_text(line, base_rtl, world_ready)
    };

    let mut buffer = rustybuzz::UnicodeBuffer::new();
    buffer.push_str(&line);
    if !world_ready {
        // Guess script and base direction from the buffer's Unicode contents so
        // complex scripts (Arabic joining, Hebrew) shape with their contextual
        // forms and correct direction instead of defaulting to left-to-right with
        // no script. An explicit item direction still overrides the guess below.
        // World-Ready lines are already reordered to visual order, so they skip
        // this and stay left-to-right with no script.
        buffer.guess_segment_properties();
    }
    if let Some(dir) = shape_line_direction(world_ready, direction) {
        buffer.set_direction(dir);
    }
    if let Some(language) = language.and_then(|value| value.parse().ok()) {
        buffer.set_language(language);
    }

    let mut rb_face = rustybuzz::Face::from_slice(font.bytes, font.face_index)?;
    rb_face.set_variations(font_variations);
    let shaped = rustybuzz::shape(&rb_face, open_type_features, buffer);
    let infos = shaped.glyph_infos();
    let positions = shaped.glyph_positions();
    if infos.len() != positions.len() {
        return None;
    }

    let mut glyphs = Vec::with_capacity(infos.len());
    for (info, position) in infos.iter().zip(positions.iter()) {
        if info.glyph_id > u16::MAX as u32 {
            return None;
        }
        // A single uncovered glyph rejects the whole shaped line so the caller can
        // try the next family in the stack and ultimately the per-glyph fallback.
        // This is an intentional fidelity tradeoff: the covered portion loses
        // cross-glyph shaping (ligatures/kerning) when one glyph is missing. Proper
        // per-run coverage segmentation would avoid that fallback.
        if info.glyph_id == 0 && cluster_starts_non_space(&line, info.cluster) {
            return None;
        }
        glyphs.push(ShapedFontGlyph {
            glyph: ttf_parser::GlyphId(info.glyph_id as u16),
            cluster: info.cluster,
            x_offset: position.x_offset as f32 * sx,
            y_offset: position.y_offset as f32 * sy,
            x_advance: position.x_advance as f32 * sx,
            y_advance: position.y_advance as f32 * sy,
        });
    }

    let width = shaped_line_width(&glyphs, letter_spacing);
    Some(ShapedFontLine {
        glyphs,
        width: width.abs(),
    })
}

fn prepared_shape_line_text(line: &str, base_rtl: bool, world_ready: bool) -> String {
    let mut line = if world_ready {
        visual_bidi_chars(line, base_rtl).into_iter().collect()
    } else {
        line.to_string()
    };
    if line.contains('\t') {
        line = line.replace('\t', "    ");
    }
    line
}

fn cluster_starts_non_space(line: &str, cluster: u32) -> bool {
    line.get(cluster as usize..)
        .and_then(|rest| rest.chars().next())
        .is_some_and(|ch| !is_text_space(ch))
}

fn parse_text_direction(direction: &str) -> Option<rustybuzz::Direction> {
    match direction {
        "ltr" => Some(rustybuzz::Direction::LeftToRight),
        "rtl" => Some(rustybuzz::Direction::RightToLeft),
        _ => None,
    }
}

/// Resolve the rustybuzz buffer direction for a shaped line.
///
/// When the World-Ready composer is on, `prepared_shape_line_text` has already
/// reordered the line into visual order via the Unicode bidi algorithm, so the
/// buffer must shape left-to-right. Re-applying the item's `rtl` direction here
/// would reverse the already-visual run a second time. Without World-Ready the
/// explicit item direction is honored unchanged.
fn shape_line_direction(
    world_ready: bool,
    direction: Option<&str>,
) -> Option<rustybuzz::Direction> {
    if world_ready {
        Some(rustybuzz::Direction::LeftToRight)
    } else {
        direction.and_then(parse_text_direction)
    }
}

#[allow(clippy::too_many_arguments)]
fn push_shaped_font_line_path(
    face: &ttf_parser::Face<'_>,
    pb: &mut sk::PathBuilder,
    shaped: &ShapedFontLine,
    mut x: f32,
    mut baseline_y: f32,
    sx: f32,
    sy: f32,
    italic: bool,
    letter_spacing: f32,
    any: &mut bool,
) -> (f32, f32) {
    for (idx, glyph) in shaped.glyphs.iter().enumerate() {
        if glyph.glyph.0 != 0 {
            push_font_glyph_outline(
                face,
                pb,
                glyph.glyph,
                x + glyph.x_offset,
                baseline_y - glyph.y_offset,
                sx,
                sy,
                italic,
                any,
            );
        }
        x += glyph.x_advance;
        baseline_y -= glyph.y_advance;
        if letter_gap_after(&shaped.glyphs, idx) {
            x += letter_spacing;
        }
    }
    (x, baseline_y)
}

#[allow(clippy::too_many_arguments)]
fn push_font_glyph_outline(
    face: &ttf_parser::Face<'_>,
    pb: &mut sk::PathBuilder,
    glyph: ttf_parser::GlyphId,
    origin_x: f32,
    baseline_y: f32,
    sx: f32,
    sy: f32,
    italic: bool,
    any: &mut bool,
) {
    let mut builder = FontOutlineBuilder {
        pb,
        origin_x,
        baseline_y,
        sx,
        sy,
        italic,
        any,
    };
    face.outline_glyph(glyph, &mut builder);
}

struct FontOutlineBuilder<'a> {
    pb: &'a mut sk::PathBuilder,
    origin_x: f32,
    baseline_y: f32,
    sx: f32,
    sy: f32,
    italic: bool,
    any: &'a mut bool,
}

impl FontOutlineBuilder<'_> {
    fn map(&self, x: f32, y: f32) -> (f32, f32) {
        let y_screen = self.baseline_y - y * self.sy;
        let italic_shift = if self.italic { y * self.sy * 0.14 } else { 0.0 };
        (self.origin_x + x * self.sx + italic_shift, y_screen)
    }
}

impl ttf_parser::OutlineBuilder for FontOutlineBuilder<'_> {
    fn move_to(&mut self, x: f32, y: f32) {
        let (x, y) = self.map(x, y);
        self.pb.move_to(x, y);
        *self.any = true;
    }

    fn line_to(&mut self, x: f32, y: f32) {
        let (x, y) = self.map(x, y);
        self.pb.line_to(x, y);
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let (x1, y1) = self.map(x1, y1);
        let (x, y) = self.map(x, y);
        self.pb.quad_to(x1, y1, x, y);
    }

    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let (x1, y1) = self.map(x1, y1);
        let (x2, y2) = self.map(x2, y2);
        let (x, y) = self.map(x, y);
        self.pb.cubic_to(x1, y1, x2, y2, x, y);
    }

    fn close(&mut self) {
        self.pb.close();
    }
}

struct TextRunPath {
    path: sk::Path,
    fill: Option<Paint>,
}

#[derive(Clone)]
struct TextRunFallback {
    text: String,
    fill: Option<Paint>,
    dx: f32,
    dy: f32,
    font_weight: Option<f32>,
    italic: Option<bool>,
    open_type_features: Vec<OpenTypeFeatureSetting>,
    font_variations: Vec<FontVariationSetting>,
}

fn insert_soft_breaks_in_runs(runs: &[TextRunFallback], breaks: &[usize]) -> Vec<TextRunFallback> {
    let mut break_index = 0usize;
    let mut run_start = 0usize;
    runs.iter()
        .cloned()
        .map(|mut run| {
            let run_end = run_start + run.text.len();
            let first_break = break_index;
            while break_index < breaks.len() && breaks[break_index] <= run_end {
                break_index += 1;
            }
            if first_break < break_index {
                let local_breaks = breaks[first_break..break_index]
                    .iter()
                    .map(|offset| offset - run_start)
                    .collect::<Vec<_>>();
                run.text = insert_soft_breaks(&run.text, &local_breaks);
            }
            run_start = run_end;
            run
        })
        .collect()
}

fn strip_line_end_text_space_in_runs(runs: &[TextRunFallback]) -> Vec<TextRunFallback> {
    let mut visible_runs = runs.to_vec();
    for run in &mut visible_runs {
        run.text.clear();
    }

    let mut pending_space = Vec::<(usize, char)>::new();
    for (run_index, run) in runs.iter().enumerate() {
        for ch in run.text.chars() {
            if ch == '\n' {
                pending_space.clear();
                visible_runs[run_index].text.push(ch);
            } else if is_text_space(ch) {
                pending_space.push((run_index, ch));
            } else {
                for (space_run, space) in pending_space.drain(..) {
                    visible_runs[space_run].text.push(space);
                }
                visible_runs[run_index].text.push(ch);
            }
        }
    }
    visible_runs
}

fn measure_bitmap_text_run_range(
    runs: &[TextRunFallback],
    range: std::ops::Range<usize>,
    cell_w: f32,
    letter_spacing: f32,
) -> f32 {
    let mut width = 0.0;
    let mut run_start = 0usize;
    for run in runs {
        let run_end = run_start + run.text.len();
        let overlap_start = range.start.max(run_start);
        let overlap_end = range.end.min(run_end);
        if overlap_start < overlap_end {
            if overlap_start == run_start {
                width += run.dx;
            }
            let chars = run.text[overlap_start - run_start..overlap_end - run_start]
                .chars()
                .collect::<Vec<_>>();
            width += measure_text_chars(&chars, cell_w, letter_spacing);
        }
        run_start = run_end;
        if run_start >= range.end {
            break;
        }
    }
    width.max(0.0)
}

fn build_text_run_paths(item: &Item) -> Option<Vec<TextRunPath>> {
    if let Some(paths) = build_registered_font_text_run_paths(item) {
        return Some(paths);
    }

    let mut runs = text_runs(item)?;
    let font_size = extra_f32(item, "fontSize", 48.0).clamp(1.0, 4096.0);
    let horizontal_scale = (extra_f32(item, "horizontalScale", 100.0) / 100.0).clamp(0.01, 64.0);
    let vertical_scale = (extra_f32(item, "verticalScale", 100.0) / 100.0).clamp(0.01, 64.0);
    let cell_w = font_size / 7.0 * horizontal_scale;
    let cell_h = font_size / 7.0 * vertical_scale;
    let letter_spacing = extra_f32(item, "letterSpacing", 0.0);
    let line_height = extra_f32(item, "lineHeight", 1.2).clamp(0.1, 16.0);
    let baseline_shift = extra_f32(item, "baselineShift", 0.0);
    let item_font_weight = extra_f32(item, "fontWeight", 400.0);
    let item_italic = extra_str(item, "fontStyle").is_some_and(|v| v == "italic");
    let underline = extra_bool(item, "underline");
    let strikethrough = extra_bool(item, "strikethrough");
    let align = extra_str(item, "align").unwrap_or("left");
    let box_width = text_layout_width(item);
    let line_advance = font_size * line_height * vertical_scale;
    let full_text: String = runs.iter().map(|run| run.text.as_str()).collect();
    if let Some(wrap_width) = text_wrap_width(item) {
        let breaks = soft_wrap_offsets(&full_text, wrap_width, |range| {
            Some(measure_bitmap_text_run_range(
                &runs,
                range,
                cell_w,
                letter_spacing,
            ))
        })?;
        runs = insert_soft_breaks_in_runs(&runs, &breaks);
    }
    runs = strip_line_end_text_space_in_runs(&runs);
    let full_text: String = runs.iter().map(|run| run.text.as_str()).collect();
    let line_starts = text_line_ranges(&full_text)
        .into_iter()
        .map(|range| {
            let visible_range = trim_text_range_end(&full_text, range);
            let line_width =
                measure_bitmap_text_run_range(&runs, visible_range, cell_w, letter_spacing);
            let layout_width = box_width.unwrap_or(line_width).max(line_width);
            match align {
                "center" => (layout_width - line_width) * 0.5,
                "right" => layout_width - line_width,
                _ => 0.0,
            }
        })
        .collect::<Vec<_>>();

    let mut out = Vec::new();
    let mut line_index = 0usize;
    let mut x = line_starts.first().copied().unwrap_or(0.0);
    let mut y_shift = 0.0;

    let run_count = runs.len();
    for (run_index, run) in runs.into_iter().enumerate() {
        x += run.dx;
        y_shift += run.dy;

        let mut pb = sk::PathBuilder::new();
        let mut any = false;
        let mut segment_start_x = x;
        let mut segment_width = 0.0;
        let mut segment_visible_width = 0.0;
        let font_weight = run.font_weight.unwrap_or(item_font_weight);
        let bold_expand = if font_weight >= 650.0 {
            (cell_w * 0.18).min(cell_w * 0.5)
        } else {
            0.0
        };
        let italic = run.italic.unwrap_or(item_italic);
        let chars: Vec<char> = run.text.chars().collect();

        for (idx, ch) in chars.iter().copied().enumerate() {
            if ch == '\n' {
                push_text_decoration_paths(
                    &mut pb,
                    segment_start_x,
                    segment_visible_width,
                    line_index,
                    line_advance,
                    baseline_shift,
                    y_shift,
                    cell_h,
                    underline,
                    strikethrough,
                    &mut any,
                );
                line_index += 1;
                x = line_starts.get(line_index).copied().unwrap_or(0.0);
                segment_start_x = x;
                segment_width = 0.0;
                segment_visible_width = 0.0;
                continue;
            }

            let baseline_y = line_index as f32 * line_advance - baseline_shift + y_shift;
            let top = baseline_y - 7.0 * cell_h;
            let advance = char_advance(ch, cell_w);
            if !is_text_space(ch) {
                push_glyph_path(
                    &mut pb,
                    ch,
                    x,
                    top,
                    cell_w,
                    cell_h,
                    bold_expand,
                    italic,
                    &mut any,
                );
            }
            x += advance;
            segment_width += advance;
            if !is_text_space(ch) {
                segment_visible_width = segment_width;
            }

            if idx + 1 < chars.len() && chars[idx + 1] != '\n' {
                x += letter_spacing;
                segment_width += letter_spacing;
            }
        }

        push_text_decoration_paths(
            &mut pb,
            segment_start_x,
            if run_index + 1 == run_count {
                segment_visible_width
            } else {
                segment_width
            },
            line_index,
            line_advance,
            baseline_shift,
            y_shift,
            cell_h,
            underline,
            strikethrough,
            &mut any,
        );

        if let Some(path) = any.then(|| pb.finish()).flatten() {
            out.push(TextRunPath {
                path,
                fill: run.fill,
            });
        }
    }

    (!out.is_empty()).then_some(out)
}

#[allow(clippy::too_many_arguments)]
fn push_text_decoration_paths(
    pb: &mut sk::PathBuilder,
    start_x: f32,
    width: f32,
    line_index: usize,
    line_advance: f32,
    baseline_shift: f32,
    y_shift: f32,
    cell_h: f32,
    underline: bool,
    strikethrough: bool,
    any: &mut bool,
) {
    if width <= 0.0 {
        return;
    }
    let baseline_y = line_index as f32 * line_advance - baseline_shift + y_shift;
    let top = baseline_y - 7.0 * cell_h;
    if underline {
        push_rect_path(
            pb,
            start_x,
            baseline_y + cell_h * 0.45,
            width,
            cell_h * 0.35,
            any,
        );
    }
    if strikethrough {
        push_rect_path(pb, start_x, top + cell_h * 3.2, width, cell_h * 0.35, any);
    }
}

#[allow(clippy::too_many_arguments)]
fn push_registered_text_decoration_paths(
    pb: &mut sk::PathBuilder,
    start_x: f32,
    width: f32,
    line_index: usize,
    line_advance: f32,
    baseline_shift: f32,
    y_shift: f32,
    font_size: f32,
    underline: bool,
    strikethrough: bool,
    any: &mut bool,
) {
    if width <= 0.0 {
        return;
    }
    let baseline_y = line_index as f32 * line_advance - baseline_shift + y_shift;
    if underline {
        push_rect_path(
            pb,
            start_x,
            baseline_y + font_size * 0.08,
            width,
            font_size * 0.06,
            any,
        );
    }
    if strikethrough {
        push_rect_path(
            pb,
            start_x,
            baseline_y - font_size * 0.32,
            width,
            font_size * 0.06,
            any,
        );
    }
}

// ponytail: exact candidate-line measurement can be quadratic in word count;
// cache shaped prefixes if long area-text documents make this renderer hot.
// Temporary newlines are sufficient until paragraph spacing/first-line indent
// needs an explicit hard-vs-soft line representation.
fn soft_wrap_offsets(
    text: &str,
    box_width: f32,
    mut measure: impl FnMut(std::ops::Range<usize>) -> Option<f32>,
) -> Option<Vec<usize>> {
    let mut breaks = Vec::new();
    let mut paragraph_start = 0usize;

    loop {
        let paragraph_end = text[paragraph_start..]
            .find('\n')
            .map(|offset| paragraph_start + offset)
            .unwrap_or(text.len());
        let mut line_start = paragraph_start;
        let mut token_start = paragraph_start;

        while token_start < paragraph_end {
            let first = text[token_start..paragraph_end].chars().next()?;
            let is_space = is_text_space(first);
            let mut token_end = token_start + first.len_utf8();
            while token_end < paragraph_end {
                let ch = text[token_end..paragraph_end].chars().next()?;
                if is_text_space(ch) != is_space {
                    break;
                }
                token_end += ch.len_utf8();
            }

            if !is_space && token_start > line_start && measure(line_start..token_end)? > box_width
            {
                breaks.push(token_start);
                line_start = token_start;
            }
            token_start = token_end;
        }

        if paragraph_end == text.len() {
            break;
        }
        paragraph_start = paragraph_end + 1;
    }

    Some(breaks)
}

fn insert_soft_breaks(text: &str, breaks: &[usize]) -> String {
    if breaks.is_empty() {
        return text.to_owned();
    }

    let mut out = String::with_capacity(text.len() + breaks.len());
    let mut start = 0usize;
    for &offset in breaks {
        debug_assert!(offset >= start && text.is_char_boundary(offset));
        out.push_str(&text[start..offset]);
        out.push('\n');
        start = offset;
    }
    out.push_str(&text[start..]);
    out
}

fn trim_trailing_text_space(text: &str) -> &str {
    text.trim_end_matches(is_text_space)
}

fn text_line_ranges(text: &str) -> Vec<std::ops::Range<usize>> {
    let mut ranges = Vec::new();
    let mut line_start = 0usize;
    for (offset, ch) in text.char_indices() {
        if ch == '\n' {
            ranges.push(line_start..offset);
            line_start = offset + ch.len_utf8();
        }
    }
    ranges.push(line_start..text.len());
    ranges
}

fn trim_text_range_end(text: &str, mut range: std::ops::Range<usize>) -> std::ops::Range<usize> {
    while range.end > range.start {
        let Some(ch) = text[range.start..range.end].chars().next_back() else {
            break;
        };
        if !is_text_space(ch) {
            break;
        }
        range.end -= ch.len_utf8();
    }
    range
}

fn text_content(item: &Item) -> Option<String> {
    if let Some(text) = item.extra.get("text").and_then(|v| v.as_str()) {
        if !text.is_empty() {
            return Some(text.to_owned());
        }
    }

    let runs = item.extra.get("runs")?.as_array()?;
    let mut text = String::new();
    for run in runs {
        if let Some(part) = run.get("text").and_then(|v| v.as_str()) {
            text.push_str(part);
        }
    }
    (!text.is_empty()).then_some(text)
}

fn text_runs(item: &Item) -> Option<Vec<TextRunFallback>> {
    let runs = item.extra.get("runs")?.as_array()?;
    let mut out = Vec::new();
    for run in runs {
        let Some(text) = run.get("text").and_then(|v| v.as_str()) else {
            continue;
        };
        if text.is_empty() {
            continue;
        }
        out.push(TextRunFallback {
            text: text.to_owned(),
            fill: run.get("fill").and_then(parse_text_run_paint),
            dx: run.get("dx").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
            dy: run.get("dy").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
            font_weight: run
                .get("fontWeight")
                .and_then(|v| v.as_f64())
                .map(|v| v as f32),
            italic: run
                .get("fontStyle")
                .and_then(|v| v.as_str())
                .map(|v| v == "italic"),
            open_type_features: run
                .as_object()
                .map(open_type_feature_settings_from_map)
                .unwrap_or_default(),
            font_variations: run
                .as_object()
                .map(font_variation_settings_from_map)
                .unwrap_or_default(),
        });
    }
    (!out.is_empty()).then_some(out)
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct OpenTypeFeatureSetting {
    tag: String,
    value: u32,
}

impl OpenTypeFeatureSetting {
    fn new(tag: &str, value: u32) -> Option<Self> {
        let tag = normalize_open_type_tag(tag)?;
        Some(Self { tag, value })
    }
}

fn open_type_feature_settings_from_item(item: &Item) -> Vec<OpenTypeFeatureSetting> {
    open_type_feature_settings_from_map(&item.extra)
}

fn open_type_feature_settings_from_map(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Vec<OpenTypeFeatureSetting> {
    let mut out = Vec::new();
    for key in ["liga", "dlig", "frac", "ordn"] {
        if let Some(value) = map.get(key).and_then(open_type_feature_value) {
            push_open_type_setting(&mut out, key, value);
        }
    }
    for key in ["openType", "openTypeFeatures"] {
        if let Some(value) = map.get(key) {
            open_type_feature_settings_from_value(value, &mut out);
        }
    }
    out.truncate(32);
    out
}

fn open_type_feature_settings_from_value(
    value: &serde_json::Value,
    out: &mut Vec<OpenTypeFeatureSetting>,
) {
    match value {
        serde_json::Value::Object(map) => {
            for (tag, value) in map {
                if let Some(value) = open_type_feature_value(value) {
                    push_open_type_setting(out, tag, value);
                }
            }
        }
        serde_json::Value::Array(values) => {
            for value in values.iter().take(32) {
                if let Some(tag) = value.as_str() {
                    push_open_type_setting(out, tag, 1);
                }
            }
        }
        serde_json::Value::String(tag) => push_open_type_setting(out, tag, 1),
        _ => {}
    }
}

fn open_type_feature_value(value: &serde_json::Value) -> Option<u32> {
    if let Some(value) = value.as_bool() {
        return Some(u32::from(value));
    }
    if let Some(value) = value.as_u64() {
        return Some(value.min(u32::MAX as u64) as u32);
    }
    if let Some(value) = value.as_i64() {
        return Some(value.clamp(0, u32::MAX as i64) as u32);
    }
    let value = value.as_str()?.trim().to_ascii_lowercase();
    match value.as_str() {
        "on" | "true" | "yes" => Some(1),
        "off" | "false" | "no" => Some(0),
        _ => value.parse::<u32>().ok(),
    }
}

fn push_open_type_setting(out: &mut Vec<OpenTypeFeatureSetting>, tag: &str, value: u32) {
    let Some(setting) = OpenTypeFeatureSetting::new(tag, value) else {
        return;
    };
    if let Some(existing) = out.iter_mut().find(|existing| existing.tag == setting.tag) {
        *existing = setting;
    } else {
        out.push(setting);
    }
}

fn normalize_open_type_tag(tag: &str) -> Option<String> {
    let tag = match tag.trim() {
        "standardLigatures" => "liga",
        "discretionaryLigatures" => "dlig",
        "fractions" => "frac",
        "ordinals" => "ordn",
        other => other,
    }
    .trim()
    .trim_start_matches('+')
    .trim_matches(|ch| ch == '"' || ch == '\'')
    .trim();
    if tag.len() != 4 || !tag.bytes().all(|byte| byte.is_ascii_graphic()) {
        return None;
    }
    Some(tag.to_owned())
}

fn merged_open_type_feature_settings(
    item: &[OpenTypeFeatureSetting],
    run: &[OpenTypeFeatureSetting],
) -> Vec<OpenTypeFeatureSetting> {
    let mut out = item.to_vec();
    for setting in run {
        push_open_type_setting(&mut out, &setting.tag, setting.value);
    }
    out.truncate(32);
    out
}

fn rustybuzz_features(settings: &[OpenTypeFeatureSetting]) -> Vec<rustybuzz::Feature> {
    settings
        .iter()
        .filter_map(|setting| {
            format!("{}={}", setting.tag, setting.value)
                .parse::<rustybuzz::Feature>()
                .ok()
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq)]
struct FontVariationSetting {
    tag: String,
    value: f32,
}

impl FontVariationSetting {
    fn new(tag: &str, value: f32) -> Option<Self> {
        let tag = normalize_font_variation_tag(tag)?;
        value.is_finite().then_some(Self { tag, value })
    }
}

fn font_variation_settings_from_item(item: &Item) -> Vec<FontVariationSetting> {
    font_variation_settings_from_map(&item.extra)
}

fn font_variation_settings_from_map(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Vec<FontVariationSetting> {
    let mut out = Vec::new();
    for key in ["wght", "wdth", "opsz", "slnt", "ital", "GRAD"] {
        if let Some(value) = map.get(key).and_then(font_variation_value) {
            push_font_variation_setting(&mut out, key, value);
        }
    }
    for key in [
        "fontVariationSettings",
        "fontVariations",
        "variationSettings",
        "variations",
        "variationAxes",
    ] {
        if let Some(value) = map.get(key) {
            font_variation_settings_from_value(value, &mut out);
        }
    }
    out.truncate(32);
    out
}

fn font_variation_settings_from_value(
    value: &serde_json::Value,
    out: &mut Vec<FontVariationSetting>,
) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(tag) = map
                .get("axis")
                .or_else(|| map.get("tag"))
                .and_then(|value| value.as_str())
            {
                if let Some(value) = map.get("value").and_then(font_variation_value) {
                    push_font_variation_setting(out, tag, value);
                }
                return;
            }
            for (tag, value) in map {
                if let Some(value) = font_variation_value(value) {
                    push_font_variation_setting(out, tag, value);
                }
            }
        }
        serde_json::Value::Array(values) => {
            for value in values.iter().take(32) {
                font_variation_settings_from_value(value, out);
            }
        }
        serde_json::Value::String(value) => parse_font_variation_settings_string(value, out),
        _ => {}
    }
}

fn parse_font_variation_settings_string(value: &str, out: &mut Vec<FontVariationSetting>) {
    for part in value.split([',', ';']) {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((tag, value)) = part
            .split_once('=')
            .or_else(|| part.split_once(':'))
            .and_then(|(tag, value)| {
                value
                    .trim()
                    .parse::<f32>()
                    .ok()
                    .map(|value| (tag.trim(), value))
            })
        {
            push_font_variation_setting(out, tag, value);
            continue;
        }
        let mut pieces = part.split_whitespace();
        let Some(tag) = pieces.next() else {
            continue;
        };
        let Some(value) = pieces.next().and_then(|value| value.parse::<f32>().ok()) else {
            continue;
        };
        push_font_variation_setting(out, tag, value);
    }
}

fn font_variation_value(value: &serde_json::Value) -> Option<f32> {
    if let Some(value) = value.as_f64() {
        let value = value as f32;
        return value.is_finite().then_some(value);
    }
    let value = value.as_str()?.trim().parse::<f32>().ok()?;
    value.is_finite().then_some(value)
}

fn push_font_variation_setting(out: &mut Vec<FontVariationSetting>, tag: &str, value: f32) {
    let Some(setting) = FontVariationSetting::new(tag, value) else {
        return;
    };
    if let Some(existing) = out.iter_mut().find(|existing| existing.tag == setting.tag) {
        *existing = setting;
    } else {
        out.push(setting);
    }
}

fn normalize_font_variation_tag(tag: &str) -> Option<String> {
    let tag = tag
        .trim()
        .trim_start_matches('+')
        .trim_matches(|ch| ch == '"' || ch == '\'')
        .trim();
    if tag.len() != 4 || !tag.bytes().all(|byte| byte.is_ascii_graphic()) {
        return None;
    }
    Some(tag.to_owned())
}

fn merged_font_variation_settings(
    item: &[FontVariationSetting],
    run: &[FontVariationSetting],
) -> Vec<FontVariationSetting> {
    let mut out = item.to_vec();
    for setting in run {
        push_font_variation_setting(&mut out, &setting.tag, setting.value);
    }
    out.truncate(32);
    out
}

fn rustybuzz_variations(settings: &[FontVariationSetting]) -> Vec<rustybuzz::Variation> {
    settings
        .iter()
        .filter_map(|setting| {
            format!("{}={}", setting.tag, setting.value)
                .parse::<rustybuzz::Variation>()
                .ok()
        })
        .collect()
}

fn font_face_with_variations<'a>(
    face: &ttf_parser::Face<'a>,
    settings: &[FontVariationSetting],
) -> ttf_parser::Face<'a> {
    let mut face = face.clone();
    for setting in settings {
        if let Some(tag) = ttf_variation_tag(&setting.tag) {
            let _ = face.set_variation(tag, setting.value);
        }
    }
    face
}

fn ttf_variation_tag(tag: &str) -> Option<ttf_parser::Tag> {
    let bytes: [u8; 4] = tag.as_bytes().try_into().ok()?;
    Some(ttf_parser::Tag::from_bytes(&bytes))
}

fn parse_text_run_paint(value: &serde_json::Value) -> Option<Paint> {
    let paint = serde_json::from_value::<Paint>(value.clone()).ok()?;
    match paint {
        Paint::None | Paint::Solid { .. } => Some(paint),
        // Artisan's SVG renderer only emits per-run solid/none fills for point
        // text; gradient and pattern run fills fall back to the item paint.
        Paint::Gradient { .. } | Paint::Pattern { .. } => None,
    }
}

fn visual_bidi_chars(line: &str, base_rtl: bool) -> Vec<char> {
    let level = if base_rtl { Level::rtl() } else { Level::ltr() };
    let bidi = BidiInfo::new(line, Some(level));
    let Some(paragraph) = bidi.paragraphs.first() else {
        return line.chars().collect();
    };
    bidi.reorder_line(paragraph, paragraph.range.clone())
        .chars()
        .collect()
}

fn extra_f32(item: &Item, key: &str, default: f32) -> f32 {
    extra_f32_opt(item, key).unwrap_or(default)
}

fn extra_f32_opt(item: &Item, key: &str) -> Option<f32> {
    item.extra
        .get(key)
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
}

fn text_wrap_width(item: &Item) -> Option<f32> {
    extra_f32_opt(item, "boxWidth").filter(|width| *width > 0.0)
}

fn text_layout_width(item: &Item) -> Option<f32> {
    text_wrap_width(item).or_else(|| (item.width > 0.0).then_some(item.width))
}

fn extra_bool(item: &Item, key: &str) -> bool {
    item.extra
        .get(key)
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn extra_str<'a>(item: &'a Item, key: &str) -> Option<&'a str> {
    item.extra.get(key).and_then(|v| v.as_str())
}

fn measure_text_chars(chars: &[char], cell_w: f32, letter_spacing: f32) -> f32 {
    let mut width = 0.0;
    for (idx, ch) in chars.iter().copied().enumerate() {
        width += char_advance(ch, cell_w);
        if idx + 1 < chars.len() {
            width += letter_spacing;
        }
    }
    width.max(0.0)
}

fn char_advance(ch: char, cell_w: f32) -> f32 {
    match ch {
        '\t' => cell_w * 12.0,
        ch if is_text_space(ch) => cell_w * 3.0,
        _ => cell_w * 6.0,
    }
}

fn is_text_space(ch: char) -> bool {
    matches!(ch, ' ' | '\t' | '\r')
}

#[allow(clippy::too_many_arguments)]
fn push_glyph_path(
    pb: &mut sk::PathBuilder,
    ch: char,
    x: f32,
    y: f32,
    cell_w: f32,
    cell_h: f32,
    bold_expand: f32,
    italic: bool,
    any: &mut bool,
) {
    let rows = glyph_rows(ch);
    for (row, bits) in rows.iter().enumerate() {
        for col in 0..5 {
            if bits & (1 << (4 - col)) == 0 {
                continue;
            }
            let italic_shift = if italic {
                (6.0 - row as f32) * cell_w * 0.14
            } else {
                0.0
            };
            push_rect_path(
                pb,
                x + col as f32 * cell_w + italic_shift,
                y + row as f32 * cell_h,
                cell_w + bold_expand,
                cell_h,
                any,
            );
        }
    }
}

fn push_rect_path(pb: &mut sk::PathBuilder, x: f32, y: f32, w: f32, h: f32, any: &mut bool) {
    if w <= 0.0 || h <= 0.0 {
        return;
    }
    pb.move_to(x, y);
    pb.line_to(x + w, y);
    pb.line_to(x + w, y + h);
    pb.line_to(x, y + h);
    pb.close();
    *any = true;
}

fn glyph_rows(ch: char) -> [u8; 7] {
    match ch.to_ascii_uppercase() {
        'A' => [
            0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ],
        'א' => [
            0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001, 0b10001,
        ],
        'B' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110,
        ],
        'ב' => [
            0b11111, 0b00001, 0b00001, 0b11111, 0b10000, 0b10000, 0b11111,
        ],
        'C' => [
            0b01111, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b01111,
        ],
        'D' => [
            0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110,
        ],
        'E' => [
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111,
        ],
        'F' => [
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000,
        ],
        'G' => [
            0b01111, 0b10000, 0b10000, 0b10011, 0b10001, 0b10001, 0b01111,
        ],
        'H' => [
            0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ],
        'I' => [
            0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111,
        ],
        'J' => [
            0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100,
        ],
        'K' => [
            0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001,
        ],
        'L' => [
            0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111,
        ],
        'M' => [
            0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001,
        ],
        'N' => [
            0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001,
        ],
        'O' => [
            0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ],
        'P' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000,
        ],
        'Q' => [
            0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101,
        ],
        'R' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001,
        ],
        'S' => [
            0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110,
        ],
        'T' => [
            0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100,
        ],
        'U' => [
            0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ],
        'V' => [
            0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100,
        ],
        'W' => [
            0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010,
        ],
        'X' => [
            0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001,
        ],
        'Y' => [
            0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100,
        ],
        'Z' => [
            0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111,
        ],
        '0' => [
            0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110,
        ],
        '1' => [
            0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110,
        ],
        '2' => [
            0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111,
        ],
        '3' => [
            0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110,
        ],
        '4' => [
            0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010,
        ],
        '5' => [
            0b11111, 0b10000, 0b10000, 0b11110, 0b00001, 0b00001, 0b11110,
        ],
        '6' => [
            0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110,
        ],
        '7' => [
            0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000,
        ],
        '8' => [
            0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110,
        ],
        '9' => [
            0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b11100,
        ],
        '.' => [
            0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100,
        ],
        ',' => [
            0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100, 0b01000,
        ],
        ':' => [
            0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b00000,
        ],
        ';' => [
            0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b01000,
        ],
        '!' => [
            0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100,
        ],
        '?' => [
            0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b00000, 0b00100,
        ],
        '-' => [
            0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000,
        ],
        '_' => [
            0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b11111,
        ],
        '+' => [
            0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000,
        ],
        '/' => [
            0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000,
        ],
        '\\' => [
            0b10000, 0b01000, 0b01000, 0b00100, 0b00010, 0b00010, 0b00001,
        ],
        '(' => [
            0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010,
        ],
        ')' => [
            0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000,
        ],
        '[' => [
            0b01110, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b01110,
        ],
        ']' => [
            0b01110, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b01110,
        ],
        '"' => [
            0b01010, 0b01010, 0b01010, 0b00000, 0b00000, 0b00000, 0b00000,
        ],
        '\'' => [
            0b00100, 0b00100, 0b01000, 0b00000, 0b00000, 0b00000, 0b00000,
        ],
        '#' => [
            0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010,
        ],
        '%' => [
            0b11001, 0b11010, 0b00010, 0b00100, 0b01000, 0b01011, 0b10011,
        ],
        '&' => [
            0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101,
        ],
        '*' => [
            0b00000, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0b00000,
        ],
        '=' => [
            0b00000, 0b00000, 0b11111, 0b00000, 0b11111, 0b00000, 0b00000,
        ],
        '@' => [
            0b01110, 0b10001, 0b10111, 0b10101, 0b10111, 0b10000, 0b01110,
        ],
        _ => [
            0b11111, 0b10001, 0b00001, 0b00110, 0b00100, 0b00000, 0b00100,
        ],
    }
}

fn apply_alpha_plane_to_pixmap(pixmap: &mut sk::Pixmap, alpha_plane: &[f32]) {
    for (pixel, mask) in pixmap.pixels_mut().iter_mut().zip(alpha_plane.iter()) {
        let m = mask.clamp(0.0, 1.0);
        let a = (pixel.alpha() as f32 * m).round().clamp(0.0, 255.0) as u8;
        let r = (pixel.red() as f32 * m).round().clamp(0.0, a as f32) as u8;
        let g = (pixel.green() as f32 * m).round().clamp(0.0, a as f32) as u8;
        let b = (pixel.blue() as f32 * m).round().clamp(0.0, a as f32) as u8;
        *pixel = sk::PremultipliedColorU8::from_rgba(r, g, b, a)
            .unwrap_or(sk::PremultipliedColorU8::TRANSPARENT);
    }
}

fn blur_alpha_plane(src: &[f32], w: usize, h: usize, radius: f32) -> Vec<f32> {
    if radius < 0.1 || w == 0 || h == 0 {
        return src.to_vec();
    }
    let (kernel, r) = gaussian_kernel(radius);
    let (wi, hi) = (w as i32, h as i32);
    let mut tmp = vec![0.0; w * h];
    for y in 0..hi {
        for x in 0..wi {
            let mut acc = 0.0;
            for (ki, kv) in kernel.iter().enumerate() {
                let sx = x + ki as i32 - r;
                if sx >= 0 && sx < wi {
                    acc += src[(y as usize) * w + sx as usize] * kv;
                }
            }
            tmp[(y as usize) * w + x as usize] = acc;
        }
    }
    let mut out = vec![0.0; w * h];
    for y in 0..hi {
        for x in 0..wi {
            let mut acc = 0.0;
            for (ki, kv) in kernel.iter().enumerate() {
                let sy = y + ki as i32 - r;
                if sy >= 0 && sy < hi {
                    acc += tmp[(sy as usize) * w + x as usize] * kv;
                }
            }
            out[(y as usize) * w + x as usize] = acc;
        }
    }
    out
}

fn gaussian_kernel(radius: f32) -> (Vec<f32>, i32) {
    let sigma = radius.clamp(0.1, 64.0);
    let r = (sigma * 3.0).ceil() as i32;
    let mut k = Vec::with_capacity((2 * r + 1) as usize);
    let mut sum = 0.0;
    for i in -r..=r {
        let v = (-(i * i) as f32 / (2.0 * sigma * sigma)).exp();
        k.push(v);
        sum += v;
    }
    if sum > 0.0 {
        for v in &mut k {
            *v /= sum;
        }
    }
    (k, r)
}

/// Draw an `<image>` whose href is a base64 PNG data URL, scaled into its local
/// (0,0)→(width,height) box. Non-PNG / non-data-URL hrefs render as nothing (TODO).
fn render_image(
    pixmap: &mut sk::Pixmap,
    item: &Item,
    t: sk::Transform,
    alpha: f32,
    blend: sk::BlendMode,
    mask: Option<&sk::Mask>,
) {
    if item.width <= 0.0 || item.height <= 0.0 {
        return;
    }
    let Some(comma) = item.href.find(',') else {
        return;
    };
    if !item.href[..comma].contains("base64") {
        return;
    }
    let Some(bytes) = b64_decode(&item.href[comma + 1..]) else {
        return;
    };
    let Ok(src) = sk::Pixmap::decode_png(&bytes) else {
        return;
    };
    let dw = src.width() as f32;
    let dh = src.height() as f32;
    if dw <= 0.0 || dh <= 0.0 {
        return;
    }
    let xform = t.pre_concat(sk::Transform::from_scale(item.width / dw, item.height / dh));
    let paint = sk::PixmapPaint {
        opacity: alpha.clamp(0.0, 1.0),
        // An image is an object like any other: it composites with its own blend
        // mode. Leaving this at the default made every placed image Normal.
        blend_mode: blend,
        ..Default::default()
    };
    pixmap.draw_pixmap(0, 0, src.as_ref(), &paint, xform, mask);
}

/// Minimal standard-alphabet base64 decoder (no dependency).
fn b64_decode(s: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut acc = 0u32;
    let mut bits = 0u32;
    for c in s.bytes() {
        if c == b'=' || c.is_ascii_whitespace() {
            continue;
        }
        let v = val(c)?;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

fn build_clip_mask(clip: Item, t: sk::Transform, w: u32, h: u32) -> Option<sk::Mask> {
    let ct = t.pre_concat(matrix_to_transform(clip.transform));
    let geos = local_paths(&clip);
    let path = build_path(&geos)?;
    let mut mask = sk::Mask::new(w, h)?;
    let rule = if clip.even_odd {
        sk::FillRule::EvenOdd
    } else {
        sk::FillRule::Winding
    };
    mask.fill_path(&path, rule, true, ct);
    Some(mask)
}

fn build_opacity_mask(item: &Item, t: sk::Transform, w: u32, h: u32) -> Option<sk::Mask> {
    let content = item.mask.as_ref()?;
    if content.is_empty() {
        return None;
    }
    let mut pixmap = sk::Pixmap::new(w, h)?;
    render_items(&mut pixmap, content, t, 1.0, None);
    let mask_type = if item.mask_type.as_deref() == Some("alpha") {
        sk::MaskType::Alpha
    } else {
        sk::MaskType::Luminance
    };
    Some(sk::Mask::from_pixmap(pixmap.as_ref(), mask_type))
}

fn intersect_masks(mut child: sk::Mask, parent: &sk::Mask) -> sk::Mask {
    for (c, p) in child.data_mut().iter_mut().zip(parent.data()) {
        *c = ((*c as u16 * *p as u16 + 127) / 255) as u8;
    }
    child
}

fn build_path_fill_mask(
    path: &sk::Path,
    rule: sk::FillRule,
    t: sk::Transform,
    w: u32,
    h: u32,
) -> Option<sk::Mask> {
    let mut mask = sk::Mask::new(w, h)?;
    mask.fill_path(path, rule, true, t);
    Some(mask)
}

fn invert_mask(mask: &mut sk::Mask) {
    for px in mask.data_mut() {
        *px = 255 - *px;
    }
}

fn stroke_align_needs_mask(align: &str, geos: &[PathGeometry]) -> bool {
    (align == "inside" || align == "outside") && !geos.is_empty() && geos.iter().all(|g| g.closed)
}

#[allow(clippy::too_many_arguments)]
fn fill_path_with_paint(
    pixmap: &mut sk::Pixmap,
    path: &sk::Path,
    paint_def: &Paint,
    bounds: sk::Rect,
    fill_rule: sk::FillRule,
    t: sk::Transform,
    alpha: f32,
    blend: sk::BlendMode,
    mask: Option<&sk::Mask>,
) {
    let mut paint = sk::Paint::default();
    paint.anti_alias = true;
    paint.blend_mode = blend;
    match paint_def {
        Paint::Pattern { pattern } => {
            let Some(tile) = pattern_tile(pattern) else {
                return;
            };
            paint.shader = pattern_shader(tile.as_ref(), pattern, t, alpha);
            pixmap.fill_path(path, &paint, fill_rule, t, mask);
        }
        _ => {
            let Some(shader) = paint_shader(paint_def, bounds, t, alpha) else {
                return;
            };
            paint.shader = shader;
            pixmap.fill_path(path, &paint, fill_rule, t, mask);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn stroke_path_with_paint(
    pixmap: &mut sk::Pixmap,
    path: &sk::Path,
    paint_def: &Paint,
    bounds: sk::Rect,
    stroke: &sk::Stroke,
    t: sk::Transform,
    alpha: f32,
    blend: sk::BlendMode,
    mask: Option<&sk::Mask>,
) {
    let mut paint = sk::Paint::default();
    paint.anti_alias = true;
    paint.blend_mode = blend;
    match paint_def {
        Paint::Pattern { pattern } => {
            let Some(tile) = pattern_tile(pattern) else {
                return;
            };
            paint.shader = pattern_shader(tile.as_ref(), pattern, t, alpha);
            pixmap.stroke_path(path, &paint, stroke, t, mask);
        }
        _ => {
            let Some(shader) = paint_shader(paint_def, bounds, t, alpha) else {
                return;
            };
            paint.shader = shader;
            pixmap.stroke_path(path, &paint, stroke, t, mask);
        }
    }
}

fn build_stroke(s: &Stroke) -> sk::Stroke {
    let mut stroke = sk::Stroke {
        width: s.width,
        miter_limit: s.miter_limit,
        line_cap: match s.cap.as_str() {
            "round" => sk::LineCap::Round,
            "square" => sk::LineCap::Square,
            _ => sk::LineCap::Butt,
        },
        line_join: match s.join.as_str() {
            "round" => sk::LineJoin::Round,
            "bevel" => sk::LineJoin::Bevel,
            _ => sk::LineJoin::Miter,
        },
        ..Default::default()
    };
    // (#125) SVG/canvas dash semantics: a negative entry makes the whole list
    // invalid (solid stroke), and an odd-length list repeats itself to pair the
    // on/off runs — dropping single-value lists (`[5]`) or silently reshuffling
    // the pattern around a negative entry rendered solid where the source is dashed.
    if !s.dash.is_empty() && s.dash.iter().all(|v| *v >= 0.0) {
        let mut dashes = s.dash.clone();
        if dashes.len() % 2 == 1 {
            dashes.extend_from_within(..);
        }
        stroke.dash = sk::StrokeDash::new(dashes, s.dash_offset);
    }
    stroke
}

fn blend_mode(name: &str) -> sk::BlendMode {
    match name {
        "multiply" => sk::BlendMode::Multiply,
        "screen" => sk::BlendMode::Screen,
        "overlay" => sk::BlendMode::Overlay,
        "darken" => sk::BlendMode::Darken,
        "lighten" => sk::BlendMode::Lighten,
        "color-dodge" => sk::BlendMode::ColorDodge,
        "color-burn" => sk::BlendMode::ColorBurn,
        "hard-light" => sk::BlendMode::HardLight,
        "soft-light" => sk::BlendMode::SoftLight,
        "difference" => sk::BlendMode::Difference,
        "exclusion" => sk::BlendMode::Exclusion,
        "hue" => sk::BlendMode::Hue,
        "saturation" => sk::BlendMode::Saturation,
        "color" => sk::BlendMode::Color,
        "luminosity" => sk::BlendMode::Luminosity,
        _ => sk::BlendMode::SourceOver,
    }
}

fn color_u8(c: &Rgba, alpha: f32) -> sk::Color {
    sk::Color::from_rgba8(
        c.r.clamp(0.0, 255.0) as u8,
        c.g.clamp(0.0, 255.0) as u8,
        c.b.clamp(0.0, 255.0) as u8,
        (c.a.clamp(0.0, 1.0) * alpha.clamp(0.0, 1.0) * 255.0).round() as u8,
    )
}

fn pattern_tile(pattern: &PatternPaint) -> Option<sk::Pixmap> {
    if pattern.width <= 0.0 || pattern.height <= 0.0 || pattern.tile.is_empty() {
        return None;
    }
    let tw = pattern.width.ceil().clamp(1.0, 4096.0) as u32;
    let th = pattern.height.ceil().clamp(1.0, 4096.0) as u32;
    let mut tile = sk::Pixmap::new(tw, th)?;
    let scale = sk::Transform::from_scale(tw as f32 / pattern.width, th as f32 / pattern.height);
    render_items(&mut tile, &pattern.tile, scale, 1.0, None);
    Some(tile)
}

fn pattern_shader<'a>(
    tile: sk::PixmapRef<'a>,
    pattern: &PatternPaint,
    t: sk::Transform,
    alpha: f32,
) -> sk::Shader<'a> {
    let tw = tile.width() as f32;
    let th = tile.height() as f32;
    let tile_to_pattern =
        sk::Transform::from_scale(pattern.width.max(1e-3) / tw, pattern.height.max(1e-3) / th);
    let pattern_transform = pattern
        .transform
        .map(matrix_to_transform)
        .unwrap_or_else(sk::Transform::identity);
    let shader_transform = t.pre_concat(pattern_transform).pre_concat(tile_to_pattern);
    sk::Pattern::new(
        tile,
        sk::SpreadMode::Repeat,
        sk::FilterQuality::Nearest,
        alpha,
        shader_transform,
    )
}

/// Build a tiny-skia shader for a paint, with `alpha` folded into every color.
/// Gradient endpoints are mapped from objectBoundingBox (0..1) units to the
/// item's local bounds, and the shader rides the same `t` as the path.
fn paint_shader(
    paint: &Paint,
    bounds: sk::Rect,
    t: sk::Transform,
    alpha: f32,
) -> Option<sk::Shader<'static>> {
    match paint {
        Paint::None => None,
        Paint::Pattern { .. } => None,
        Paint::Solid { color } => {
            let c = color_u8(color, alpha);
            if c.alpha() <= 0.0 {
                return None;
            }
            Some(sk::Shader::SolidColor(c))
        }
        Paint::Gradient { gradient } => gradient_shader(gradient, bounds, t, alpha),
    }
}

fn gradient_shader(
    g: &Gradient,
    bounds: sk::Rect,
    t: sk::Transform,
    alpha: f32,
) -> Option<sk::Shader<'static>> {
    if g.stops.is_empty() {
        return None;
    }
    let bx = bounds.x();
    let by = bounds.y();
    let bw = bounds.width().max(1e-3);
    let bh = bounds.height().max(1e-3);
    let map = |ux: f32, uy: f32| sk::Point::from_xy(bx + ux * bw, by + uy * bh);

    let stops: Vec<sk::GradientStop> = expanded_gradient_stops(&g.stops)
        .into_iter()
        .map(|(offset, color)| sk::GradientStop::new(offset, color_u8(&color, alpha)))
        .collect();

    let mode = match g.spread.as_deref() {
        Some("reflect") => sk::SpreadMode::Reflect,
        Some("repeat") => sk::SpreadMode::Repeat,
        _ => sk::SpreadMode::Pad,
    };

    if g.kind == "radial" {
        let center = map(g.cx, g.cy);
        let focal = match (g.fx, g.fy) {
            (Some(fx), Some(fy)) => map(fx, fy),
            _ => center,
        };
        let radius = (g.r * (bw + bh) * 0.5).max(1e-3);
        sk::RadialGradient::new(focal, center, radius, stops, mode, t)
    } else {
        sk::LinearGradient::new(map(g.x1, g.y1), map(g.x2, g.y2), stops, mode, t)
    }
}

fn lerp_rgba(a: &Rgba, b: &Rgba, t: f32) -> Rgba {
    let t = t.clamp(0.0, 1.0);
    Rgba {
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t,
        a: a.a + (b.a - a.a) * t,
    }
}

/// Expand Illustrator/Artisan midpoint diamonds into explicit tiny-skia stops.
/// A stop midpoint biases the segment toward the next stop: at relative `m`, the
/// color blend is 50%. Inserting that half-color stop makes tiny-skia's linear
/// interpolation match the piecewise midpoint curve used by the TS editor.
fn expanded_gradient_stops(stops: &[GradientStop]) -> Vec<(f32, Rgba)> {
    let mut sorted = stops.to_vec();
    sorted.sort_by(|a, b| {
        a.offset
            .partial_cmp(&b.offset)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut out = Vec::with_capacity(sorted.len().saturating_mul(2).saturating_sub(1));
    for (i, stop) in sorted.iter().enumerate() {
        out.push((stop.offset.clamp(0.0, 1.0), stop.color));
        let Some(next) = sorted.get(i + 1) else {
            continue;
        };
        let Some(mid) = stop.midpoint else { continue };
        let mid = mid.clamp(0.0, 1.0);
        if !(mid > 0.0 && mid < 1.0) || (mid - 0.5).abs() <= f32::EPSILON {
            continue;
        }
        let span = next.offset - stop.offset;
        if span <= 0.0 {
            continue;
        }
        out.push((
            (stop.offset + span * mid).clamp(0.0, 1.0),
            lerp_rgba(&stop.color, &next.color, 0.5),
        ));
    }
    out
}

fn cubic_span(pb: &mut sk::PathBuilder, a: &Anchor, b: &Anchor) {
    pb.cubic_to(
        a.point.x + a.handle_out.x,
        a.point.y + a.handle_out.y,
        b.point.x + b.handle_in.x,
        b.point.y + b.handle_in.y,
        b.point.x,
        b.point.y,
    );
}

/// Stroke the given subpaths and return the stroke OUTLINE as fillable anchor
/// geometry (Object ▸ Path ▸ Outline Stroke). Uses tiny-skia's path stroker.
pub fn stroke_to_geometry(geos: &[PathGeometry], stroke: &Stroke) -> Vec<PathGeometry> {
    if stroke_has_variable_width(stroke) {
        return variable_width_ribbons(geos, stroke);
    }
    let Some(path) = build_path(geos) else {
        return Vec::new();
    };
    let sk_stroke = build_stroke(stroke);
    let Some(outline) = path.stroke(&sk_stroke, 1.0) else {
        return Vec::new();
    };
    skia_path_to_geometry(&outline)
}

fn skia_path_to_geometry(path: &sk::Path) -> Vec<PathGeometry> {
    let corner = |x: f32, y: f32| Anchor {
        point: Point { x, y },
        handle_in: Point::default(),
        handle_out: Point::default(),
    };
    let mut subs: Vec<PathGeometry> = Vec::new();
    let mut cur: Vec<Anchor> = Vec::new();
    let mut closed = false;
    let flush = |cur: &mut Vec<Anchor>, closed: &mut bool, subs: &mut Vec<PathGeometry>| {
        if cur.len() >= 2 {
            subs.push(PathGeometry {
                closed: *closed,
                anchors: std::mem::take(cur),
            });
        } else {
            cur.clear();
        }
        *closed = false;
    };
    let mut prev = Point::default();
    for seg in path.segments() {
        match seg {
            sk::PathSegment::MoveTo(p) => {
                flush(&mut cur, &mut closed, &mut subs);
                cur.push(corner(p.x, p.y));
                prev = Point { x: p.x, y: p.y };
            }
            sk::PathSegment::LineTo(p) => {
                cur.push(corner(p.x, p.y));
                prev = Point { x: p.x, y: p.y };
            }
            sk::PathSegment::QuadTo(c, p) => {
                let c1 = Point {
                    x: prev.x + 2.0 / 3.0 * (c.x - prev.x),
                    y: prev.y + 2.0 / 3.0 * (c.y - prev.y),
                };
                let c2 = Point {
                    x: p.x + 2.0 / 3.0 * (c.x - p.x),
                    y: p.y + 2.0 / 3.0 * (c.y - p.y),
                };
                if let Some(last) = cur.last_mut() {
                    last.handle_out = Point {
                        x: c1.x - last.point.x,
                        y: c1.y - last.point.y,
                    };
                }
                let mut a = corner(p.x, p.y);
                a.handle_in = Point {
                    x: c2.x - p.x,
                    y: c2.y - p.y,
                };
                cur.push(a);
                prev = Point { x: p.x, y: p.y };
            }
            sk::PathSegment::CubicTo(c1, c2, p) => {
                if let Some(last) = cur.last_mut() {
                    last.handle_out = Point {
                        x: c1.x - last.point.x,
                        y: c1.y - last.point.y,
                    };
                }
                let mut a = corner(p.x, p.y);
                a.handle_in = Point {
                    x: c2.x - p.x,
                    y: c2.y - p.y,
                };
                cur.push(a);
                prev = Point { x: p.x, y: p.y };
            }
            sk::PathSegment::Close => {
                closed = true;
            }
        }
    }
    flush(&mut cur, &mut closed, &mut subs);
    subs
}

fn build_path(geos: &[PathGeometry]) -> Option<sk::Path> {
    let mut pb = sk::PathBuilder::new();
    for g in geos {
        let n = g.anchors.len();
        if n < 2 {
            continue;
        }
        pb.move_to(g.anchors[0].point.x, g.anchors[0].point.y);
        for i in 0..n - 1 {
            cubic_span(&mut pb, &g.anchors[i], &g.anchors[i + 1]);
        }
        if g.closed {
            cubic_span(&mut pb, &g.anchors[n - 1], &g.anchors[0]);
            pb.close();
        }
    }
    pb.finish()
}

#[cfg(test)]
mod tests {
    use super::{
        b64_decode, build_registered_font_text_path, build_registered_font_text_run_paths,
        build_stroke, build_text_path, build_text_run_paths, combine_text_run_paths,
        expanded_gradient_stops, font_face_with_variations, font_variation_settings_from_item,
        insert_soft_breaks, insert_soft_breaks_in_runs, merged_font_variation_settings,
        merged_open_type_feature_settings, open_type_feature_settings_from_item,
        push_shaped_font_line_path, render_layers, resample_width_profile, rustybuzz_features,
        rustybuzz_variations, shape_font_line, shape_line_direction, shaped_line_width,
        soft_wrap_offsets, text_runs, visual_bidi_chars, FontVariationSetting,
        OpenTypeFeatureSetting, ShapedFontGlyph, ShapedFontLine,
    };
    use crate::vector::model::{Document, GradientStop, Rgba, Stroke};
    use tiny_skia as sk;

    #[test]
    fn base64_decodes_known_strings() {
        assert_eq!(b64_decode("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(b64_decode("TWFu").unwrap(), b"Man");
        assert_eq!(b64_decode("TWE=").unwrap(), b"Ma");
        assert!(b64_decode("bad!!").is_none()); // '!' is not a base64 char
    }

    #[test]
    fn gradient_stop_midpoint_expands_to_half_color_stop() {
        let stops = vec![
            GradientStop {
                offset: 0.0,
                midpoint: Some(0.25),
                color: Rgba {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 1.0,
                },
            },
            GradientStop {
                offset: 1.0,
                midpoint: None,
                color: Rgba {
                    r: 200.0,
                    g: 80.0,
                    b: 40.0,
                    a: 0.5,
                },
            },
        ];
        let out = expanded_gradient_stops(&stops);
        assert_eq!(out.len(), 3);
        assert!((out[1].0 - 0.25).abs() < 1e-6);
        assert!((out[1].1.r - 100.0).abs() < 1e-6);
        assert!((out[1].1.g - 40.0).abs() < 1e-6);
        assert!((out[1].1.b - 20.0).abs() < 1e-6);
        assert!((out[1].1.a - 0.75).abs() < 1e-6);
    }

    #[test]
    fn gradient_stop_midpoint_parses_from_document_json() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"rect","width":10,"height":10,
            "fill":{"type":"gradient","gradient":{"type":"linear","stops":[
              {"offset":0,"midpoint":0.3,"color":{"r":0,"g":0,"b":0,"a":1}},
              {"offset":1,"color":{"r":255,"g":255,"b":255,"a":1}}
            ]}}}]}]
        }"#,
        )
        .expect("document parses");
        let item = &doc.layers[0].items[0];
        let crate::vector::model::Paint::Gradient { gradient } = &item.fill else {
            panic!("gradient fill parsed");
        };
        assert_eq!(gradient.stops[0].midpoint, Some(0.3));
        assert_eq!(gradient.stops[1].midpoint, None);
    }

    #[test]
    fn text_item_renders_native_glyphs_with_fill_opacity_and_transform() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"Hi","fontSize":14,"opacity":0.5,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":8,"f":22},
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(48, 32).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        let glyph = pixmap.pixel(9, 10).unwrap();
        assert!(
            glyph.alpha() > 80 && glyph.alpha() < 180,
            "text item opacity is folded into native glyph alpha"
        );
        assert!(
            glyph.red() > glyph.green() && glyph.red() > glyph.blue(),
            "text glyph uses the item fill paint"
        );
        assert_eq!(
            pixmap.pixel(4, 10).unwrap().alpha(),
            0,
            "text transform offsets the glyph from the origin"
        );
    }

    #[test]
    fn text_item_aligns_against_area_width() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"I","fontSize":14,"align":"center","boxWidth":30,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":0,"f":20},
            "fill":{"type":"solid","color":{"r":0,"g":0,"b":255,"a":1}}
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(36, 24).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert_eq!(
            pixmap.pixel(2, 8).unwrap().alpha(),
            0,
            "center-aligned text leaves the left edge of the area empty"
        );
        assert!(
            pixmap.pixel(14, 9).unwrap().blue() > 200,
            "center-aligned glyph paints inside the area"
        );
    }

    #[test]
    fn area_text_wrap_offsets_preserve_hard_breaks_and_rich_runs() {
        let text = "AB AB\nAB AB";
        let breaks = soft_wrap_offsets(text, 4.0, |range| Some(text[range].chars().count() as f32))
            .expect("wrap offsets");
        assert_eq!(breaks, vec![3, 9]);
        assert_eq!(insert_soft_breaks(text, &breaks), "AB \nAB\nAB \nAB");

        let doc = Document::parse(
            r#"{"layers":[{"items":[{"type":"text","runs":[
              {"text":"AB ","dx":1},{"text":"AB\n","dx":2},
              {"text":"AB ","dx":3},{"text":"AB","dx":4}
            ]}]}]}"#,
        )
        .expect("document parses");
        let runs = text_runs(&doc.layers[0].items[0]).expect("rich runs");
        let wrapped = insert_soft_breaks_in_runs(&runs, &breaks);
        assert_eq!(
            wrapped
                .iter()
                .map(|run| run.text.as_str())
                .collect::<Vec<_>>(),
            vec!["AB \n", "AB\n", "AB \n", "AB"]
        );
        assert_eq!(
            wrapped.iter().map(|run| run.dx).collect::<Vec<_>>(),
            vec![1.0, 2.0, 3.0, 4.0],
            "soft breaks do not duplicate or discard run offsets"
        );
    }

    #[test]
    fn text_item_area_text_wraps_bitmap_fallback_and_keeps_hard_breaks() {
        let area = Document::parse(
            r#"{"layers":[{"items":[{"type":"text","text":"AA AA\nAA","fontSize":14,"boxWidth":31,
              "fill":{"type":"solid","color":{"r":0,"g":0,"b":0,"a":1}}}]}]}"#,
        )
        .expect("area document parses");
        let area_path = build_text_path(&area.layers[0].items[0]).expect("area text path");
        assert!(
            area_path.bounds().height() > 40.0,
            "one soft break plus one hard break occupy three baselines"
        );

        let point = Document::parse(
            r#"{"layers":[{"items":[{"type":"text","text":"AA AA","fontSize":14,"width":31,
              "fill":{"type":"solid","color":{"r":0,"g":0,"b":0,"a":1}}}]}]}"#,
        )
        .expect("point document parses");
        let point_path = build_text_path(&point.layers[0].items[0]).expect("point text path");
        assert!(
            point_path.bounds().height() < 20.0,
            "item.width remains an alignment hint and does not turn point text into area text"
        );
    }

    #[test]
    fn area_text_alignment_ignores_soft_wrap_separator_whitespace() {
        let bounds = |text: &str, align: &str, world_ready: bool| {
            let text = serde_json::to_string(text).expect("text encodes");
            let composer = world_ready
                .then_some(r#", "composer":"worldReady", "direction":"rtl""#)
                .unwrap_or("");
            let doc = Document::parse(&format!(
                r#"{{"layers":[{{"items":[{{"type":"text","text":{text},"fontSize":14,
                  "boxWidth":25,"align":"{align}"{composer}}}]}}]}}"#
            ))
            .expect("area-text document parses");
            build_text_path(&doc.layers[0].items[0])
                .expect("soft-wrap path")
                .bounds()
        };

        for align in ["center", "right"] {
            let hard_bounds = bounds("A\nB", align, false);
            for soft_text in ["A B", "A    B", "A\tB"] {
                assert_eq!(
                    bounds(soft_text, align, false),
                    hard_bounds,
                    "spaces and tabs left by a soft break do not shift aligned glyphs"
                );
            }
        }

        assert_eq!(
            bounds("A B", "right", true),
            bounds("A\nB", "right", true),
            "RTL bidi cannot move a logically trailing wrap-space into visible layout"
        );
    }

    #[test]
    fn rich_bitmap_area_text_wrap_metrics_match_run_tracking_and_dx() {
        let tracking = Document::parse(
            r#"{"layers":[{"items":[{"type":"text","fontSize":14,"letterSpacing":10,
              "boxWidth":45,"runs":[{"text":"A"},{"text":" B"}]}]}]}"#,
        )
        .expect("tracking document parses");
        let tracking_paths =
            build_text_run_paths(&tracking.layers[0].items[0]).expect("tracking run paths");
        let tracking_path = combine_text_run_paths(&tracking_paths).expect("tracking path");
        assert!(
            tracking_path.bounds().height() < 20.0,
            "tracking is not invented across a rich-run boundary"
        );

        let shifted = Document::parse(
            r#"{"layers":[{"items":[{"type":"text","fontSize":14,"boxWidth":35,
              "runs":[{"text":"A "},{"text":"B","dx":20}]}]}]}"#,
        )
        .expect("shifted document parses");
        let shifted_paths =
            build_text_run_paths(&shifted.layers[0].items[0]).expect("shifted run paths");
        let shifted_path = combine_text_run_paths(&shifted_paths).expect("shifted path");
        assert!(
            shifted_path.bounds().height() > 25.0,
            "a one-time run dx participates in wrapping before it can overflow the area"
        );

        let soft_decorated = Document::parse(
            r#"{"layers":[{"items":[{"type":"text","fontSize":14,"boxWidth":30,
              "underline":true,"strikethrough":true,
              "runs":[{"text":"A "},{"text":" B"}]}]}]}"#,
        )
        .expect("soft decorated document parses");
        let hard_decorated = Document::parse(
            r#"{"layers":[{"items":[{"type":"text","fontSize":14,"boxWidth":30,
              "underline":true,"strikethrough":true,
              "runs":[{"text":"A"},{"text":"\nB"}]}]}]}"#,
        )
        .expect("hard decorated document parses");
        let soft_path = combine_text_run_paths(
            &build_text_run_paths(&soft_decorated.layers[0].items[0])
                .expect("soft decorated paths"),
        )
        .expect("soft decorated path");
        let hard_path = combine_text_run_paths(
            &build_text_run_paths(&hard_decorated.layers[0].items[0])
                .expect("hard decorated paths"),
        )
        .expect("hard decorated path");
        assert_eq!(
            soft_path.bounds(),
            hard_path.bounds(),
            "line-ending whitespace spanning rich runs does not extend decorations"
        );
    }

    #[test]
    fn text_item_rich_runs_use_per_run_fill() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"AB","fontSize":14,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":20},
            "fill":{"type":"solid","color":{"r":0,"g":180,"b":0,"a":1}},
            "runs":[
              {"text":"A","fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}},
              {"text":"B","fill":{"type":"solid","color":{"r":0,"g":0,"b":255,"a":1}}}
            ]
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(36, 24).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());

        let first = pixmap.pixel(7, 7).unwrap();
        assert!(
            first.red() > 200 && first.green() < 40 && first.blue() < 40,
            "the first run uses its red fill instead of the item fill"
        );
        let second = pixmap.pixel(17, 7).unwrap();
        assert!(
            second.blue() > 200 && second.red() < 40 && second.green() < 40,
            "the second run uses its blue fill instead of the item fill"
        );
    }

    #[test]
    fn text_item_rich_runs_apply_dx_without_text_fallback() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","fontSize":14,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":20},
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},
            "runs":[
              {"text":"A"},
              {"text":"B","dx":8,"fill":{"type":"solid","color":{"r":0,"g":0,"b":255,"a":1}}}
            ]
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(44, 24).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());

        assert_eq!(
            pixmap.pixel(17, 7).unwrap().alpha(),
            0,
            "run dx leaves the unshifted second-glyph position empty"
        );
        let shifted = pixmap.pixel(25, 7).unwrap();
        assert!(
            shifted.blue() > 200 && shifted.red() < 40,
            "the second run paints at the dx-shifted position"
        );
    }

    #[test]
    fn text_item_rich_runs_apply_run_italic_style() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"AA","fontSize":28,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":34},
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},
            "runs":[
              {"text":"A"},
              {"text":"A","fontStyle":"italic","fill":{"type":"solid","color":{"r":0,"g":0,"b":255,"a":1}}}
            ]
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(60, 44).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());

        assert_eq!(
            pixmap.pixel(33, 7).unwrap().alpha(),
            0,
            "the italic run shifts the top row away from the non-italic cell position"
        );
        let shifted = pixmap.pixel(37, 7).unwrap();
        assert!(
            shifted.blue() > 200 && shifted.red() < 40,
            "the italic run paints in the shifted top-row position"
        );
    }

    #[test]
    fn text_item_registered_font_uses_true_type_outline_path() {
        crate::vector::fonts::clear_fonts();
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"A","fontFamily":"VisionDemoOutline","fontSize":28,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":34},
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}
          }]}]
        }"#,
        )
        .expect("document parses");

        let mut fallback = sk::Pixmap::new(56, 44).expect("pixmap");
        render_layers(&mut fallback, &doc, sk::Transform::identity());
        let fallback_alpha = alpha_pixel_count(&fallback);

        crate::vector::fonts::register_font(
            "VisionDemoOutline",
            crate::vector::fonts::demo_font_bytes(),
            0,
        )
        .expect("demo font registers");
        let mut outlined = sk::Pixmap::new(56, 44).expect("pixmap");
        render_layers(&mut outlined, &doc, sk::Transform::identity());
        crate::vector::fonts::clear_fonts();
        let outline_alpha = alpha_pixel_count(&outlined);

        assert!(outline_alpha > 0, "registered font paints glyph outlines");
        assert_ne!(
            outline_alpha, fallback_alpha,
            "registered font switches rendering away from the bitmap fallback"
        );
    }

    #[test]
    fn registered_font_area_text_wraps_using_shaped_width() {
        crate::vector::fonts::clear_fonts();
        crate::vector::fonts::register_font("MonetTwoGlyph", two_glyph_font_bytes(), 0)
            .expect("two-glyph font registers");
        let doc = Document::parse(
            r#"{"layers":[{"items":[{"type":"text","text":"AB AB","fontFamily":"MonetTwoGlyph",
              "fontSize":32,"boxWidth":60,
              "fill":{"type":"solid","color":{"r":0,"g":0,"b":0,"a":1}}}]}]}"#,
        )
        .expect("document parses");

        let path =
            build_registered_font_text_path(&doc.layers[0].items[0]).expect("registered path");
        crate::vector::fonts::clear_fonts();

        assert!(
            path.bounds().height() > 40.0,
            "the shaped second word moves to a second baseline inside the area"
        );
    }

    #[test]
    fn registered_font_area_text_alignment_ignores_wrap_space() {
        crate::vector::fonts::clear_fonts();
        crate::vector::fonts::register_font("MonetTwoGlyph", two_glyph_font_bytes(), 0)
            .expect("two-glyph font registers");
        let soft = Document::parse(
            r#"{"layers":[{"items":[{"type":"text","text":"A B","fontFamily":"MonetTwoGlyph",
              "fontSize":32,"boxWidth":40,"align":"right"}]}]}"#,
        )
        .expect("soft-wrap document parses");
        let hard = Document::parse(
            r#"{"layers":[{"items":[{"type":"text","text":"A\nB","fontFamily":"MonetTwoGlyph",
              "fontSize":32,"boxWidth":40,"align":"right"}]}]}"#,
        )
        .expect("hard-break document parses");

        let soft_bounds = build_registered_font_text_path(&soft.layers[0].items[0])
            .expect("soft-wrap path")
            .bounds();
        let hard_bounds = build_registered_font_text_path(&hard.layers[0].items[0])
            .expect("hard-break path")
            .bounds();
        crate::vector::fonts::clear_fonts();

        assert_eq!(
            soft_bounds, hard_bounds,
            "registered right alignment ignores the separator left by a soft break"
        );
    }

    #[test]
    fn registered_font_rich_area_text_wraps_across_runs_and_keeps_fill() {
        crate::vector::fonts::clear_fonts();
        crate::vector::fonts::register_font("MonetTwoGlyph", two_glyph_font_bytes(), 0)
            .expect("two-glyph font registers");
        let doc = Document::parse(
            r#"{"layers":[{"items":[{"type":"text","text":"AB AB","fontFamily":"MonetTwoGlyph",
              "fontSize":32,"boxWidth":60,
              "transform":{"a":1,"b":0,"c":0,"d":1,"e":8,"f":30},
              "fill":{"type":"solid","color":{"r":0,"g":0,"b":0,"a":1}},
              "runs":[
                {"text":"AB ","fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}},
                {"text":"AB","fill":{"type":"solid","color":{"r":0,"g":0,"b":255,"a":1}}}
              ]}]}]}"#,
        )
        .expect("document parses");

        let item = &doc.layers[0].items[0];
        let run_paths = build_registered_font_text_run_paths(item).expect("registered rich paths");
        let mut pixmap = sk::Pixmap::new(120, 100).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        crate::vector::fonts::clear_fonts();

        assert_eq!(run_paths.len(), 2);
        assert!(
            run_paths[1].path.bounds().top() - run_paths[0].path.bounds().top() > 30.0,
            "a soft break at the run boundary places the blue run on the next baseline"
        );
        assert!(dominant_red_pixel_count(&pixmap) > 0);
        assert!(dominant_blue_pixel_count(&pixmap) > 0);
    }

    #[test]
    fn registered_font_rich_area_text_wrap_metrics_include_run_dx() {
        crate::vector::fonts::clear_fonts();
        crate::vector::fonts::register_font("MonetTwoGlyph", two_glyph_font_bytes(), 0)
            .expect("two-glyph font registers");
        let unshifted = Document::parse(
            r#"{"layers":[{"items":[{"type":"text","fontFamily":"MonetTwoGlyph",
              "fontSize":32,"boxWidth":80,"runs":[{"text":"A "},{"text":"B"}]}]}]}"#,
        )
        .expect("unshifted document parses");
        let shifted = Document::parse(
            r#"{"layers":[{"items":[{"type":"text","fontFamily":"MonetTwoGlyph",
              "fontSize":32,"boxWidth":80,"runs":[{"text":"A "},{"text":"B","dx":60}]}]}]}"#,
        )
        .expect("shifted document parses");

        let unshifted_paths = build_registered_font_text_run_paths(&unshifted.layers[0].items[0])
            .expect("unshifted registered paths");
        let shifted_paths = build_registered_font_text_run_paths(&shifted.layers[0].items[0])
            .expect("shifted registered paths");
        let unshifted_path = combine_text_run_paths(&unshifted_paths).expect("unshifted path");
        let shifted_path = combine_text_run_paths(&shifted_paths).expect("shifted path");
        crate::vector::fonts::clear_fonts();

        assert!(
            unshifted_path.bounds().height() < 40.0,
            "the unshifted rich text fits on one registered-font line"
        );
        assert!(
            shifted_path.bounds().height() > 40.0,
            "registered rich-run dx participates in area-text wrapping"
        );
    }

    #[test]
    fn registered_font_missing_glyph_falls_back_to_bitmap_text() {
        crate::vector::fonts::clear_fonts();
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"B","fontFamily":"VisionDemoOutline","fontSize":28,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":34},
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}
          }]}]
        }"#,
        )
        .expect("document parses");

        let mut fallback = sk::Pixmap::new(56, 44).expect("pixmap");
        render_layers(&mut fallback, &doc, sk::Transform::identity());

        crate::vector::fonts::register_font(
            "VisionDemoOutline",
            crate::vector::fonts::demo_font_bytes(),
            0,
        )
        .expect("demo font registers");
        let mut registered = sk::Pixmap::new(56, 44).expect("pixmap");
        render_layers(&mut registered, &doc, sk::Transform::identity());
        crate::vector::fonts::clear_fonts();

        assert_eq!(
            registered.data(),
            fallback.data(),
            "missing registered glyphs fall back to deterministic bitmap text"
        );
    }

    #[test]
    fn registered_font_plain_text_falls_back_per_glyph_across_family_stack() {
        crate::vector::fonts::clear_fonts();
        let b_only = demo_font_with_single_cmap_char('B');
        let a_only = demo_font_with_single_cmap_char('A');
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"BA BA","fontFamily":"BOnly, AOnly","fontSize":28,"boxWidth":1,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":34},
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}
          }]}]
        }"#,
        )
        .expect("document parses");

        let mut fallback = sk::Pixmap::new(76, 80).expect("pixmap");
        render_layers(&mut fallback, &doc, sk::Transform::identity());
        let fallback_alpha = alpha_pixel_count(&fallback);

        crate::vector::fonts::register_font("BOnly", &b_only, 0)
            .expect("B-only demo font registers");
        crate::vector::fonts::register_font("AOnly", &a_only, 0)
            .expect("A-only demo font registers");
        let item = &doc.layers[0].items[0];
        let path = build_registered_font_text_path(item).expect("registered fallback path");
        let mut registered = sk::Pixmap::new(76, 80).expect("pixmap");
        render_layers(&mut registered, &doc, sk::Transform::identity());
        crate::vector::fonts::clear_fonts();

        assert!(
            path.bounds().width() > 25.0,
            "both fallback families contribute shaped advances"
        );
        assert!(
            path.bounds().height() > 30.0,
            "the family-stack metric path wraps the repeated word"
        );
        assert_ne!(
            alpha_pixel_count(&registered),
            fallback_alpha,
            "mixed registered families render outlines instead of bitmap fallback"
        );
    }

    #[test]
    fn registered_font_open_type_features_resolve_from_item_and_run_json() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"AA","fontFamily":"VisionDemoOutline","fontSize":28,
            "liga":false,
            "openType":{"dlig":true,"kern":0,"bad":true},
            "openTypeFeatures":{"frac":1},
            "runs":[{"text":"AA","liga":true,"ordn":"on"}]
          }]}]
        }"#,
        )
        .expect("document parses");
        let item = &doc.layers[0].items[0];
        let item_settings = open_type_feature_settings_from_item(item);
        let runs = text_runs(item).expect("text runs parse");
        let merged = merged_open_type_feature_settings(&item_settings, &runs[0].open_type_features);
        let feature_value = |tag: &str| {
            merged
                .iter()
                .find(|setting| setting.tag == tag)
                .map(|setting| setting.value)
        };

        assert_eq!(
            feature_value("liga"),
            Some(1),
            "run-local liga overrides item liga"
        );
        assert_eq!(feature_value("dlig"), Some(1));
        assert_eq!(feature_value("frac"), Some(1));
        assert_eq!(feature_value("ordn"), Some(1));
        assert_eq!(feature_value("kern"), Some(0));
        assert_eq!(
            feature_value("bad"),
            None,
            "invalid OpenType tags are ignored"
        );
        assert_eq!(rustybuzz_features(&merged).len(), 5);
    }

    #[test]
    fn registered_font_shaping_accepts_open_type_feature_slice() {
        crate::vector::fonts::clear_fonts();
        crate::vector::fonts::register_font(
            "VisionDemoOutline",
            crate::vector::fonts::demo_font_bytes(),
            0,
        )
        .expect("demo font registers");
        let features = rustybuzz_features(&[
            OpenTypeFeatureSetting::new("liga", 0).expect("liga feature"),
            OpenTypeFeatureSetting::new("kern", 0).expect("kern feature"),
        ]);

        let sx = 28.0 / 1000.0;
        let shaped = crate::vector::fonts::with_font("VisionDemoOutline", |font| {
            shape_font_line(
                &font,
                "AA",
                Some("ltr"),
                Some("en"),
                false,
                false,
                false,
                sx,
                sx,
                3.0,
                &features,
                &[],
            )
        })
        .expect("registered font shapes with features");
        crate::vector::fonts::clear_fonts();

        assert_eq!(features.len(), 2);
        assert_eq!(shaped.glyphs.len(), 2);
    }

    #[test]
    fn registered_font_variations_resolve_from_item_and_run_json() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"AA","fontFamily":"VisionDemoOutline","fontSize":28,
            "wght":400,
            "fontVariationSettings":{"wdth":80,"bad":false},
            "variationAxes":"'opsz' 14, slnt=-8",
            "runs":[{"text":"AA","fontVariationSettings":{"wght":700},"variations":[{"axis":"wdth","value":95},"GRAD=20"]}]
          }]}]
        }"#,
        )
        .expect("document parses");
        let item = &doc.layers[0].items[0];
        let item_settings = font_variation_settings_from_item(item);
        let runs = text_runs(item).expect("text runs parse");
        let merged = merged_font_variation_settings(&item_settings, &runs[0].font_variations);
        let axis_value = |tag: &str| {
            merged
                .iter()
                .find(|setting| setting.tag == tag)
                .map(|setting| setting.value)
        };

        assert_eq!(
            axis_value("wght"),
            Some(700.0),
            "run-local wght overrides item wght"
        );
        assert_eq!(axis_value("wdth"), Some(95.0));
        assert_eq!(axis_value("opsz"), Some(14.0));
        assert_eq!(axis_value("slnt"), Some(-8.0));
        assert_eq!(axis_value("GRAD"), Some(20.0));
        assert_eq!(axis_value("bad"), None, "invalid axis tags are ignored");
        assert_eq!(rustybuzz_variations(&merged).len(), 5);
    }

    #[test]
    fn registered_font_shaping_accepts_font_variation_slice() {
        crate::vector::fonts::clear_fonts();
        crate::vector::fonts::register_font(
            "VisionDemoOutline",
            crate::vector::fonts::demo_font_bytes(),
            0,
        )
        .expect("demo font registers");
        let variation_settings = [
            FontVariationSetting::new("wght", 700.0).expect("wght variation"),
            FontVariationSetting::new("wdth", 90.0).expect("wdth variation"),
        ];
        let variations = rustybuzz_variations(&variation_settings);

        let sx = 28.0 / 1000.0;
        let shaped = crate::vector::fonts::with_font("VisionDemoOutline", |font| {
            let _outline_face = font_face_with_variations(&font.face, &variation_settings);
            shape_font_line(
                &font,
                "AA",
                Some("ltr"),
                Some("en"),
                false,
                false,
                false,
                sx,
                sx,
                3.0,
                &[],
                &variations,
            )
        })
        .expect("registered font shapes with variations");
        crate::vector::fonts::clear_fonts();

        assert_eq!(variations.len(), 2);
        assert_eq!(shaped.glyphs.len(), 2);
    }

    #[test]
    fn registered_font_shaping_uses_glyph_advances_and_tracking() {
        crate::vector::fonts::clear_fonts();
        crate::vector::fonts::register_font(
            "VisionDemoOutline",
            crate::vector::fonts::demo_font_bytes(),
            0,
        )
        .expect("demo font registers");

        let sx = 28.0 / 1000.0;
        let shaped = crate::vector::fonts::with_font("VisionDemoOutline", |font| {
            shape_font_line(
                &font,
                "AA",
                Some("ltr"),
                Some("en"),
                false,
                false,
                false,
                sx,
                sx,
                3.0,
                &[],
                &[],
            )
        })
        .expect("registered font shapes");
        crate::vector::fonts::clear_fonts();

        let face =
            ttf_parser::Face::parse(crate::vector::fonts::demo_font_bytes(), 0).expect("font");
        let glyph = face.glyph_index('A').expect("A glyph");
        let advance = face.glyph_hor_advance(glyph).expect("A advance") as f32 * sx;

        assert_eq!(shaped.glyphs.len(), 2);
        assert_eq!(shaped.glyphs[0].glyph.0, glyph.0);
        assert_eq!(shaped.glyphs[1].glyph.0, glyph.0);
        assert!(
            (shaped.width - (advance * 2.0 + 3.0)).abs() < 0.001,
            "shaped width includes rustybuzz advances plus tracking"
        );
    }

    #[test]
    fn registered_font_alignment_uses_shaped_width() {
        crate::vector::fonts::clear_fonts();
        crate::vector::fonts::register_font(
            "VisionDemoOutline",
            crate::vector::fonts::demo_font_bytes(),
            0,
        )
        .expect("demo font registers");
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"A","fontFamily":"VisionDemoOutline",
            "fontSize":20,"align":"right","boxWidth":60,
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}
          }]}]
        }"#,
        )
        .expect("document parses");

        let path =
            build_registered_font_text_path(&doc.layers[0].items[0]).expect("registered path");
        crate::vector::fonts::clear_fonts();

        assert!(
            path.bounds().left() > 47.0,
            "right-aligned registered text starts from the shaped advance width"
        );
    }

    #[test]
    fn registered_font_item_weight_selects_variant_face_metrics() {
        crate::vector::fonts::clear_fonts();
        let regular = demo_font_with_hmtx_advance(500);
        let bold = demo_font_with_hmtx_advance(900);
        crate::vector::fonts::register_font_face("VisionDemoOutline", &regular, 0, 400.0, false)
            .expect("regular demo font registers");
        crate::vector::fonts::register_font_face("VisionDemoOutline", &bold, 0, 700.0, false)
            .expect("bold demo font registers");

        let regular_doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"AA","fontFamily":"VisionDemoOutline",
            "fontSize":20,"fontWeight":400,
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}
          }]}]
        }"#,
        )
        .expect("regular document parses");
        let bold_doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"AA","fontFamily":"VisionDemoOutline",
            "fontSize":20,"fontWeight":700,
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}
          }]}]
        }"#,
        )
        .expect("bold document parses");

        let regular_path =
            build_registered_font_text_path(&regular_doc.layers[0].items[0]).expect("regular path");
        let bold_path =
            build_registered_font_text_path(&bold_doc.layers[0].items[0]).expect("bold path");
        crate::vector::fonts::clear_fonts();

        assert!(
            bold_path.bounds().right() - regular_path.bounds().right() > 7.0,
            "fontWeight 700 selects the wider registered face metrics"
        );
    }

    #[test]
    fn registered_font_rich_run_weight_selects_variant_face_metrics() {
        crate::vector::fonts::clear_fonts();
        let regular = demo_font_with_hmtx_advance(500);
        let bold = demo_font_with_hmtx_advance(900);
        crate::vector::fonts::register_font_face("VisionDemoOutline", &regular, 0, 400.0, false)
            .expect("regular demo font registers");
        crate::vector::fonts::register_font_face("VisionDemoOutline", &bold, 0, 700.0, false)
            .expect("bold demo font registers");

        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"AAAA","fontFamily":"VisionDemoOutline","fontSize":20,
            "runs":[{"text":"AA","fontWeight":400},{"text":"AA","fontWeight":700}]
          }]}]
        }"#,
        )
        .expect("document parses");

        let paths =
            build_registered_font_text_run_paths(&doc.layers[0].items[0]).expect("run paths");
        crate::vector::fonts::clear_fonts();

        assert_eq!(paths.len(), 2);
        assert!(
            paths[1].path.bounds().width() - paths[0].path.bounds().width() > 7.0,
            "run-local fontWeight selects the wider registered face metrics"
        );
    }

    #[test]
    fn registered_font_style_selection_prefers_matching_italic_face() {
        crate::vector::fonts::clear_fonts();
        let regular = demo_font_with_hmtx_advance(500);
        let italic = demo_font_with_hmtx_advance(900);
        crate::vector::fonts::register_font_face("VisionDemoOutline", &regular, 0, 400.0, false)
            .expect("regular demo font registers");
        crate::vector::fonts::register_font_face("VisionDemoOutline", &italic, 0, 400.0, true)
            .expect("italic demo font registers");

        let selected =
            crate::vector::fonts::with_font_for_style("VisionDemoOutline", 400.0, true, |font| {
                Some((font.weight, font.italic))
            })
            .expect("italic face selected");
        crate::vector::fonts::clear_fonts();

        assert_eq!(selected, (400.0, true));
    }

    #[test]
    fn registered_font_rich_runs_shape_outlines_and_keep_per_run_fill() {
        crate::vector::fonts::clear_fonts();
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"AA","fontFamily":"VisionDemoOutline","fontSize":28,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":34},
            "fill":{"type":"solid","color":{"r":0,"g":180,"b":0,"a":1}},
            "runs":[
              {"text":"A","fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}},
              {"text":"A","fill":{"type":"solid","color":{"r":0,"g":0,"b":255,"a":1}}}
            ]
          }]}]
        }"#,
        )
        .expect("document parses");

        let mut fallback = sk::Pixmap::new(68, 44).expect("pixmap");
        render_layers(&mut fallback, &doc, sk::Transform::identity());
        let fallback_alpha = alpha_pixel_count(&fallback);

        crate::vector::fonts::register_font(
            "VisionDemoOutline",
            crate::vector::fonts::demo_font_bytes(),
            0,
        )
        .expect("demo font registers");
        let item = &doc.layers[0].items[0];
        let run_paths = build_registered_font_text_run_paths(item).expect("registered rich paths");
        let aggregate = build_registered_font_text_path(item).expect("aggregate rich path");
        assert_eq!(run_paths.len(), 2);
        assert!(
            run_paths[1].path.bounds().left() > run_paths[0].path.bounds().left(),
            "the second rich run is placed after the first shaped outline run"
        );
        assert!(
            aggregate.bounds().right() >= run_paths[1].path.bounds().right(),
            "the aggregate effect path covers the final rich run"
        );

        let mut outlined = sk::Pixmap::new(68, 44).expect("pixmap");
        render_layers(&mut outlined, &doc, sk::Transform::identity());
        crate::vector::fonts::clear_fonts();

        assert_ne!(
            alpha_pixel_count(&outlined),
            fallback_alpha,
            "registered rich runs switch away from the bitmap fallback"
        );
        assert!(
            dominant_red_pixel_count(&outlined) > 0,
            "the first registered rich run keeps its red fill"
        );
        assert!(
            dominant_blue_pixel_count(&outlined) > 0,
            "the second registered rich run keeps its blue fill"
        );
    }

    #[test]
    fn registered_font_rich_runs_apply_dx_to_shaped_outlines() {
        crate::vector::fonts::clear_fonts();
        crate::vector::fonts::register_font(
            "VisionDemoOutline",
            crate::vector::fonts::demo_font_bytes(),
            0,
        )
        .expect("demo font registers");
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"AA","fontFamily":"VisionDemoOutline","fontSize":28,
            "runs":[{"text":"A"},{"text":"A","dx":8}]
          }]}]
        }"#,
        )
        .expect("document parses");

        let run_paths =
            build_registered_font_text_run_paths(&doc.layers[0].items[0]).expect("run paths");
        crate::vector::fonts::clear_fonts();

        assert_eq!(run_paths.len(), 2);
        assert!(
            run_paths[1].path.bounds().left() - run_paths[0].path.bounds().left() > 22.0,
            "run dx is added after the first shaped advance"
        );
    }

    #[test]
    fn registered_font_rich_run_missing_glyph_falls_back_to_bitmap_text() {
        crate::vector::fonts::clear_fonts();
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"B","fontFamily":"VisionDemoOutline","fontSize":28,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":34},
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},
            "runs":[{"text":"B","fill":{"type":"solid","color":{"r":0,"g":0,"b":255,"a":1}}}]
          }]}]
        }"#,
        )
        .expect("document parses");

        let mut fallback = sk::Pixmap::new(56, 44).expect("pixmap");
        render_layers(&mut fallback, &doc, sk::Transform::identity());

        crate::vector::fonts::register_font(
            "VisionDemoOutline",
            crate::vector::fonts::demo_font_bytes(),
            0,
        )
        .expect("demo font registers");
        assert!(
            build_registered_font_text_run_paths(&doc.layers[0].items[0]).is_none(),
            "a missing rich-run glyph rejects the registered outline path"
        );
        let mut registered = sk::Pixmap::new(56, 44).expect("pixmap");
        render_layers(&mut registered, &doc, sk::Transform::identity());
        crate::vector::fonts::clear_fonts();

        assert_eq!(
            registered.data(),
            fallback.data(),
            "missing registered rich-run glyphs fall back to deterministic bitmap text"
        );
    }

    #[test]
    fn registered_font_rich_run_falls_back_per_glyph_across_family_stack() {
        crate::vector::fonts::clear_fonts();
        let b_only = demo_font_with_single_cmap_char('B');
        let a_only = demo_font_with_single_cmap_char('A');
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"BA","fontFamily":"BOnly, AOnly","fontSize":28,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":34},
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},
            "runs":[{"text":"BA","fill":{"type":"solid","color":{"r":0,"g":0,"b":255,"a":1}}}]
          }]}]
        }"#,
        )
        .expect("document parses");

        let mut fallback = sk::Pixmap::new(76, 44).expect("pixmap");
        render_layers(&mut fallback, &doc, sk::Transform::identity());
        let fallback_alpha = alpha_pixel_count(&fallback);

        crate::vector::fonts::register_font("BOnly", &b_only, 0)
            .expect("B-only demo font registers");
        crate::vector::fonts::register_font("AOnly", &a_only, 0)
            .expect("A-only demo font registers");
        let item = &doc.layers[0].items[0];
        let run_paths = build_registered_font_text_run_paths(item).expect("registered rich path");
        let aggregate = build_registered_font_text_path(item).expect("aggregate rich path");
        let mut registered = sk::Pixmap::new(76, 44).expect("pixmap");
        render_layers(&mut registered, &doc, sk::Transform::identity());
        crate::vector::fonts::clear_fonts();

        assert_eq!(run_paths.len(), 1);
        assert!(
            aggregate.bounds().width() > 25.0,
            "both fallback families contribute to the rich aggregate path"
        );
        assert_ne!(
            alpha_pixel_count(&registered),
            fallback_alpha,
            "mixed registered families keep rich text on the outline path"
        );
        assert!(
            dominant_blue_pixel_count(&registered) > 0,
            "the registered fallback rich run keeps its run-local fill"
        );
    }

    #[test]
    fn text_item_world_ready_reorders_mixed_direction_runs() {
        let ltr: String = visual_bidi_chars("AאבB", false).into_iter().collect();
        let rtl: String = visual_bidi_chars("AB אב CD", true).into_iter().collect();
        let rtl_neutrals: String = visual_bidi_chars("A (אב) B", true).into_iter().collect();
        let rtl_digits: String = visual_bidi_chars("A אב 123 B", true).into_iter().collect();
        assert_eq!(ltr, "AבאB");
        assert_eq!(rtl, "CD בא AB");
        assert_eq!(
            rtl_neutrals, "B )בא( A",
            "Unicode bidi reorders and mirrors paired neutral punctuation with the RTL run"
        );
        assert_eq!(
            rtl_digits, "B 123 בא A",
            "Unicode bidi preserves number order inside the RTL visual line"
        );
    }

    #[test]
    fn text_item_world_ready_changes_vector_glyph_order() {
        let logical = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"AאבB","fontSize":14,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":0,"f":20},
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}
          }]}]
        }"#,
        )
        .expect("logical document parses");
        let world_ready = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"AאבB","fontSize":14,"composer":"worldReady",
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":0,"f":20},
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}
          }]}]
        }"#,
        )
        .expect("world-ready document parses");

        let mut logical_px = sk::Pixmap::new(52, 24).expect("pixmap");
        let mut world_ready_px = sk::Pixmap::new(52, 24).expect("pixmap");
        render_layers(&mut logical_px, &logical, sk::Transform::identity());
        render_layers(&mut world_ready_px, &world_ready, sk::Transform::identity());

        assert_eq!(
            logical_px.pixel(15, 7).unwrap().alpha(),
            0,
            "the logical second glyph is Alef, whose top row has an empty centre"
        );
        assert!(
            world_ready_px.pixel(15, 7).unwrap().alpha() > 200,
            "the World-Ready second glyph is Bet after RTL-run reversal"
        );
    }

    #[test]
    fn world_ready_shaping_forces_ltr_after_bidi_reorder() {
        use rustybuzz::Direction;
        // World-Ready lines are pre-reordered into visual order by the Unicode bidi
        // algorithm, so they must shape left-to-right even when the item requests
        // rtl — otherwise rustybuzz reverses the already-visual run a second time.
        // This covers the decision directly; the end-to-end render is asserted by
        // `registered_font_world_ready_rtl_reorders_pure_latin`.
        assert_eq!(
            shape_line_direction(true, Some("rtl")),
            Some(Direction::LeftToRight),
            "World-Ready + rtl must not re-apply RTL after the bidi reorder"
        );
        assert_eq!(
            shape_line_direction(true, None),
            Some(Direction::LeftToRight)
        );
        assert_eq!(
            shape_line_direction(true, Some("ltr")),
            Some(Direction::LeftToRight)
        );
        // Without World-Ready the explicit item direction is honored unchanged.
        assert_eq!(
            shape_line_direction(false, Some("rtl")),
            Some(Direction::RightToLeft)
        );
        assert_eq!(
            shape_line_direction(false, Some("ltr")),
            Some(Direction::LeftToRight)
        );
        assert_eq!(shape_line_direction(false, None), None);
    }

    // A minimal 2-glyph TrueType fixture (glyphA = left box, glyphB = right
    // triangle) mapped to Latin A/B and Hebrew alef/bet, so glyph-order changes
    // from bidi/direction are observable in rendered pixels — unlike the tiny demo
    // font, which has only one usable outline glyph. Regenerate with
    // `node testdata/gen_fonts.mjs`.
    fn two_glyph_font_bytes() -> &'static [u8] {
        include_bytes!("testdata/two_glyph.ttf")
    }

    // A/B glyphs (advance 600) with a legacy `kern` pair pulling B 300 units closer
    // after A (only A->B, not B->A). Regenerate with `node testdata/gen_fonts.mjs`.
    fn kern_font_bytes() -> &'static [u8] {
        include_bytes!("testdata/kern_font.ttf")
    }

    fn render_family_text(text: &str, family: &str) -> sk::Pixmap {
        let doc = Document::parse(&format!(
            r#"{{"layers":[{{"items":[{{"type":"text","text":"{text}","fontFamily":"{family}","fontSize":32,
              "transform":{{"a":1,"b":0,"c":0,"d":1,"e":8,"f":40}},
              "fill":{{"type":"solid","color":{{"r":0,"g":0,"b":0,"a":1}}}}}}]}}]}}"#
        ))
        .expect("doc parses");
        let mut px = sk::Pixmap::new(120, 56).expect("pixmap");
        render_layers(&mut px, &doc, sk::Transform::identity());
        px
    }

    fn render_two_glyph_text(text: &str, world_ready: bool, direction: Option<&str>) -> Vec<u8> {
        crate::vector::fonts::clear_fonts();
        crate::vector::fonts::register_font("MonetTwoGlyph", two_glyph_font_bytes(), 0)
            .expect("two-glyph font registers");
        let composer = if world_ready {
            r#","composer":"worldReady""#
        } else {
            ""
        };
        let dir = match direction {
            Some(value) => format!(r#","direction":"{value}""#),
            None => String::new(),
        };
        let doc = Document::parse(&format!(
            r#"{{"layers":[{{"items":[{{"type":"text","text":"{text}","fontFamily":"MonetTwoGlyph","fontSize":32{composer}{dir},
              "transform":{{"a":1,"b":0,"c":0,"d":1,"e":8,"f":40}},
              "fill":{{"type":"solid","color":{{"r":0,"g":0,"b":0,"a":1}}}}}}]}}]}}"#
        ))
        .expect("doc parses");
        let mut px = sk::Pixmap::new(120, 56).expect("pixmap");
        render_layers(&mut px, &doc, sk::Transform::identity());
        crate::vector::fonts::clear_fonts();
        px.data().to_vec()
    }

    #[test]
    fn registered_font_area_wraps_logical_text_before_world_ready_reorder() {
        crate::vector::fonts::clear_fonts();
        crate::vector::fonts::register_font("MonetTwoGlyph", two_glyph_font_bytes(), 0)
            .expect("two-glyph font registers");
        let render = |text: &str| {
            let text = serde_json::to_string(text).expect("text encodes");
            let doc = Document::parse(&format!(
                r#"{{"layers":[{{"items":[{{"type":"text","text":{text},"fontFamily":"MonetTwoGlyph",
                  "fontSize":32,"boxWidth":75,"composer":"worldReady","direction":"rtl",
                  "transform":{{"a":1,"b":0,"c":0,"d":1,"e":8,"f":40}},
                  "fill":{{"type":"solid","color":{{"r":0,"g":0,"b":0,"a":1}}}}}}]}}]}}"#
            ))
            .expect("document parses");
            let mut pixmap = sk::Pixmap::new(140, 110).expect("pixmap");
            render_layers(&mut pixmap, &doc, sk::Transform::identity());
            pixmap.data().to_vec()
        };

        let wrapped = render("Aאב B");
        let explicit = render("Aאב\nB");
        crate::vector::fonts::clear_fonts();
        assert_eq!(
            wrapped, explicit,
            "soft wrapping uses logical word boundaries before each line is bidi-reordered"
        );
    }

    #[test]
    fn registered_font_world_ready_rtl_reorders_pure_latin() {
        // Pure-LTR "AB" stays visually "AB" even under an RTL base direction, so
        // World-Ready must render it identically to plain "AB" — the old code
        // reversed the already-visual run a second time into "BA".
        let plain_ab = render_two_glyph_text("AB", false, None);
        let plain_ba = render_two_glyph_text("BA", false, None);
        let world_ready_rtl_ab = render_two_glyph_text("AB", true, Some("rtl"));

        assert_ne!(plain_ab, plain_ba, "fixture must distinguish glyph order");
        assert_eq!(
            world_ready_rtl_ab, plain_ab,
            "World-Ready + rtl reorders pure-LTR \"AB\" once to visual \"AB\", not \"BA\""
        );
    }

    #[test]
    fn registered_font_guesses_rtl_direction_for_hebrew() {
        // Hebrew text with no explicit direction must resolve to RTL via
        // guess_segment_properties, so its glyph order matches an explicit rtl
        // request and differs from a forced ltr request. Before the fix it shaped
        // left-to-right (no script) and matched forced-ltr instead.
        let guessed = render_two_glyph_text("\u{05D0}\u{05D1}", false, None);
        let forced_ltr = render_two_glyph_text("\u{05D0}\u{05D1}", false, Some("ltr"));
        let forced_rtl = render_two_glyph_text("\u{05D0}\u{05D1}", false, Some("rtl"));

        assert_ne!(
            forced_ltr, forced_rtl,
            "fixture must distinguish glyph order"
        );
        assert_eq!(
            guessed, forced_rtl,
            "Hebrew auto-detects RTL through guessed segment properties"
        );
        assert_ne!(guessed, forced_ltr, "guessed RTL differs from forced LTR");
    }

    #[test]
    fn registered_font_fallback_segments_preserve_pair_kerning() {
        crate::vector::fonts::clear_fonts();
        crate::vector::fonts::register_font("KernFont", kern_font_bytes(), 0)
            .expect("kern font registers");
        crate::vector::fonts::register_font("COnly", &demo_font_with_single_cmap_char('c'), 0)
            .expect("c-only font registers");

        // Neither face covers the whole line, so "ABc"/"BAc" fall back: the
        // "AB"/"BA" run is shaped by KernFont, then "c" by COnly. KernFont kerns
        // A->B (-300) but not B->A, so shaping the covered run as a unit pulls the
        // trailing "c" left in "ABc" but not in "BAc". Per-glyph fallback would miss
        // the pair kern and leave both the same width.
        let ab = render_family_text("ABc", "KernFont, COnly");
        let ba = render_family_text("BAc", "KernFont, COnly");
        crate::vector::fonts::clear_fonts();

        let ab_right = rightmost_alpha_col(&ab).expect("ABc renders");
        let ba_right = rightmost_alpha_col(&ba).expect("BAc renders");
        assert!(
            ab_right < ba_right,
            "A->B pair kerning shapes the covered run as a unit and pulls the trailing glyph left ({ab_right} < {ba_right})"
        );
    }

    #[test]
    fn registered_font_rich_run_right_alignment_uses_measured_width() {
        crate::vector::fonts::clear_fonts();
        crate::vector::fonts::register_font(
            "DemoOutline",
            crate::vector::fonts::demo_font_bytes(),
            0,
        )
        .expect("demo font registers");
        // Pass 1 sums both run widths to compute the right-alignment offset; if
        // the prebuilt line widths were wrong, right alignment would not shift the
        // rich-run glyphs toward the right edge of the box.
        let left = leftmost_alpha_col(&render_demo_rich_align("left"));
        let right = leftmost_alpha_col(&render_demo_rich_align("right"));
        crate::vector::fonts::clear_fonts();

        assert!(
            matches!((left, right), (Some(l), Some(r)) if r > l),
            "right alignment shifts rich-run glyphs further right (left {left:?} -> right {right:?})"
        );
    }

    #[test]
    fn text_item_opacity_mask_clips_glyphs() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"text","text":"HH","fontSize":14,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":20},
            "fill":{"type":"solid","color":{"r":0,"g":180,"b":0,"a":1}},
            "mask":[{"type":"rect","width":8,"height":14,
              "transform":{"a":1,"b":0,"c":0,"d":1,"e":0,"f":-14},
              "fill":{"type":"solid","color":{"r":255,"g":255,"b":255,"a":1}}}]
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(36, 24).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert!(
            pixmap.pixel(5, 8).unwrap().green() > 120,
            "mask reveals the first glyph column"
        );
        assert_eq!(
            pixmap.pixel(17, 8).unwrap().alpha(),
            0,
            "mask clips text pixels outside its coverage"
        );
    }

    fn alpha_pixel_count(pixmap: &sk::Pixmap) -> usize {
        pixmap
            .pixels()
            .iter()
            .filter(|pixel| pixel.alpha() > 0)
            .count()
    }

    fn dominant_red_pixel_count(pixmap: &sk::Pixmap) -> usize {
        pixmap
            .pixels()
            .iter()
            .filter(|pixel| {
                pixel.alpha() > 0
                    && pixel.red() > pixel.green().saturating_add(40)
                    && pixel.red() > pixel.blue().saturating_add(40)
            })
            .count()
    }

    fn dominant_blue_pixel_count(pixmap: &sk::Pixmap) -> usize {
        pixmap
            .pixels()
            .iter()
            .filter(|pixel| {
                pixel.alpha() > 0
                    && pixel.blue() > pixel.red().saturating_add(40)
                    && pixel.blue() > pixel.green().saturating_add(40)
            })
            .count()
    }

    fn demo_font_with_hmtx_advance(advance: u16) -> Vec<u8> {
        let mut bytes = crate::vector::fonts::demo_font_bytes().to_vec();
        let num_tables = u16::from_be_bytes([bytes[4], bytes[5]]) as usize;
        for table_index in 0..num_tables {
            let record = 12 + table_index * 16;
            if &bytes[record..record + 4] != b"hmtx" {
                continue;
            }
            let offset = u32::from_be_bytes([
                bytes[record + 8],
                bytes[record + 9],
                bytes[record + 10],
                bytes[record + 11],
            ]) as usize;
            let len = u32::from_be_bytes([
                bytes[record + 12],
                bytes[record + 13],
                bytes[record + 14],
                bytes[record + 15],
            ]) as usize;
            let [hi, lo] = advance.to_be_bytes();
            for entry in (offset..offset + len).step_by(4) {
                bytes[entry] = hi;
                bytes[entry + 1] = lo;
            }
            let face = ttf_parser::Face::parse(&bytes, 0).expect("mutated demo font parses");
            let glyph = face.glyph_index('A').expect("A glyph");
            assert_eq!(
                face.glyph_hor_advance(glyph),
                Some(advance),
                "test fixture mutation changes hmtx advance"
            );
            return bytes;
        }
        panic!("demo font fixture contains hmtx table");
    }

    fn demo_font_with_single_cmap_char(ch: char) -> Vec<u8> {
        let mut bytes = crate::vector::fonts::demo_font_bytes().to_vec();
        let codepoint = ch as u32;
        assert!(
            codepoint <= u16::MAX as u32,
            "test helper only handles BMP chars"
        );
        let codepoint = codepoint as u16;
        let num_tables = u16::from_be_bytes([bytes[4], bytes[5]]) as usize;
        for table_index in 0..num_tables {
            let record = 12 + table_index * 16;
            if &bytes[record..record + 4] != b"cmap" {
                continue;
            }
            let offset = u32::from_be_bytes([
                bytes[record + 8],
                bytes[record + 9],
                bytes[record + 10],
                bytes[record + 11],
            ]) as usize;
            let subtable_offset = u32::from_be_bytes([
                bytes[offset + 8],
                bytes[offset + 9],
                bytes[offset + 10],
                bytes[offset + 11],
            ]) as usize;
            let subtable = offset + subtable_offset;
            assert_eq!(
                u16::from_be_bytes([bytes[subtable], bytes[subtable + 1]]),
                4,
                "demo font fixture uses a format 4 cmap"
            );
            let seg_count =
                u16::from_be_bytes([bytes[subtable + 6], bytes[subtable + 7]]) as usize / 2;
            assert!(
                seg_count >= 2,
                "demo font fixture has a mapped segment plus sentinel"
            );
            let end_codes = subtable + 14;
            let start_codes = end_codes + seg_count * 2 + 2;
            let id_deltas = start_codes + seg_count * 2;
            let [end_hi, end_lo] = codepoint.to_be_bytes();
            bytes[end_codes] = end_hi;
            bytes[end_codes + 1] = end_lo;
            bytes[start_codes] = end_hi;
            bytes[start_codes + 1] = end_lo;
            let delta = (1i32 - codepoint as i32) as i16 as u16;
            let [delta_hi, delta_lo] = delta.to_be_bytes();
            bytes[id_deltas] = delta_hi;
            bytes[id_deltas + 1] = delta_lo;

            let face = ttf_parser::Face::parse(&bytes, 0).expect("mutated demo font parses");
            assert!(
                face.glyph_index(ch).is_some(),
                "mutated fixture maps the requested glyph"
            );
            assert!(
                face.glyph_index(if ch == 'A' { 'B' } else { 'A' })
                    .is_none(),
                "mutated fixture no longer maps the other regression glyph"
            );
            return bytes;
        }
        panic!("demo font fixture contains cmap table");
    }

    // Two rich runs, each the single covered outline glyph 'A', inside a wide box.
    // Pass 1 must sum both run widths so right alignment shifts the glyphs toward
    // the right edge (guards the prebuilt line-width path).
    fn render_demo_rich_align(align: &str) -> sk::Pixmap {
        let doc = Document::parse(&format!(
            r#"{{"layers":[{{"items":[{{"type":"text","text":"AA","fontFamily":"DemoOutline","fontSize":24,
              "align":"{align}","boxWidth":120,"width":120,
              "transform":{{"a":1,"b":0,"c":0,"d":1,"e":2,"f":30}},
              "fill":{{"type":"solid","color":{{"r":0,"g":0,"b":0,"a":1}}}},
              "runs":[{{"text":"A"}},{{"text":"A"}}]}}]}}]}}"#
        ))
        .expect("doc parses");
        let mut px = sk::Pixmap::new(160, 44).expect("pixmap");
        render_layers(&mut px, &doc, sk::Transform::identity());
        px
    }

    fn rightmost_alpha_col(pixmap: &sk::Pixmap) -> Option<u32> {
        for x in (0..pixmap.width()).rev() {
            for y in 0..pixmap.height() {
                if pixmap.pixel(x, y).map(|p| p.alpha()).unwrap_or(0) > 0 {
                    return Some(x);
                }
            }
        }
        None
    }

    fn leftmost_alpha_col(pixmap: &sk::Pixmap) -> Option<u32> {
        for x in 0..pixmap.width() {
            for y in 0..pixmap.height() {
                if pixmap.pixel(x, y).map(|p| p.alpha()).unwrap_or(0) > 0 {
                    return Some(x);
                }
            }
        }
        None
    }

    #[test]
    fn nested_clip_groups_intersect_masks() {
        let doc = Document::parse(r#"{
          "layers":[{"items":[{"type":"group","clip":true,"children":[
            {"type":"rect","width":10,"height":10},
            {"type":"group","clip":true,"children":[
              {"type":"rect","width":10,"height":10,"transform":{"a":1,"b":0,"c":0,"d":1,"e":5,"f":0}},
              {"type":"rect","width":20,"height":20,
                "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}}
            ]}
          ]}]}]
        }"#).expect("document parses");
        let mut pixmap = sk::Pixmap::new(20, 20).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert_eq!(
            pixmap.pixel(2, 5).unwrap().alpha(),
            0,
            "inside parent only is clipped out"
        );
        assert!(
            pixmap.pixel(7, 5).unwrap().alpha() > 200,
            "inside both clips renders"
        );
        assert_eq!(
            pixmap.pixel(12, 5).unwrap().alpha(),
            0,
            "inside child only is clipped out"
        );
    }

    #[test]
    fn clip_group_without_content_paints_nothing() {
        // (#128) With 2+ children the clip shape is coverage only and never
        // painted; with the content child gone it used to fall through and paint
        // the mask shape as artwork.
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"group","clip":true,"children":[
            {"type":"rect","width":20,"height":20,
              "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}}
          ]}]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(20, 20).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert_eq!(
            pixmap.pixel(5, 5).unwrap().alpha(),
            0,
            "clip shape painted as artwork"
        );
    }

    #[test]
    fn unbuildable_clip_mask_hides_the_content_instead_of_revealing_it() {
        // (#128) A text/group/image clip source has no outline, so build_clip_mask
        // returns None — the content used to render with NO clip at all, showing
        // exactly what the mask was there to hide.
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"group","clip":true,"children":[
            {"type":"text","text":"mask","fontSize":12},
            {"type":"rect","width":20,"height":20,
              "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}}
          ]}]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(20, 20).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert_eq!(
            pixmap.pixel(5, 5).unwrap().alpha(),
            0,
            "content rendered unclipped"
        );
    }

    #[test]
    fn odd_and_negative_dash_arrays_follow_svg_semantics() {
        // (#125) `[5]` means 5-on/5-off everywhere else (SVG/canvas repeat odd
        // lists); the len()>=2 gate plus tiny-skia's odd-length rejection rendered
        // it as a solid stroke, and filtering out negatives silently reshuffled
        // the surviving entries into an unrelated pattern.
        let dashed = |dash: Vec<f32>| {
            build_stroke(&Stroke {
                dash,
                ..Stroke::default()
            })
            .dash
            .is_some()
        };
        assert!(dashed(vec![5.0]), "single-value dash lost");
        assert!(dashed(vec![6.0, 2.0, 1.0]), "odd-length dash lost");
        assert!(dashed(vec![6.0, 2.0]), "even dash still dashes");
        assert!(
            !dashed(vec![10.0, -5.0, 4.0, -2.0]),
            "a negative entry invalidates the whole list"
        );
        assert!(!dashed(Vec::new()), "no dash means solid");
    }

    #[test]
    fn letter_spacing_stays_out_of_combining_mark_clusters() {
        // (#18) Tracking was inserted between EVERY glyph pair, so a nonspacing
        // mark (zero advance, same cluster as its base) was pushed one
        // letter_spacing off its base and the line measured that much too wide.
        let glyph = |cluster: u32, x_advance: f32| ShapedFontGlyph {
            glyph: ttf_parser::GlyphId(0),
            cluster,
            x_offset: 0.0,
            y_offset: 0.0,
            x_advance,
            y_advance: 0.0,
        };
        // base(10) + mark(0) in cluster 0, then a second base in cluster 2:
        // ONE inter-cluster gap, not two.
        let glyphs = vec![glyph(0, 10.0), glyph(0, 0.0), glyph(2, 10.0)];
        assert!((shaped_line_width(&glyphs, 4.0) - 24.0).abs() < 1e-4);

        let face = ttf_parser::Face::parse(two_glyph_font_bytes(), 0).expect("face parses");
        let mut pb = sk::PathBuilder::new();
        let mut any = false;
        let line = ShapedFontLine {
            width: 24.0,
            glyphs,
        };
        let (x, _) = push_shaped_font_line_path(
            &face, &mut pb, &line, 0.0, 0.0, 1.0, 1.0, false, 4.0, &mut any,
        );
        assert!((x - 24.0).abs() < 1e-4, "pen advanced to {x}, expected 24");
    }

    #[test]
    fn stroke_alignment_clips_inside_and_outside() {
        fn render(align: &str) -> sk::Pixmap {
            let doc = Document::parse(&format!(
                r#"{{
              "layers":[{{"items":[{{"type":"rect","width":20,"height":20,
                "transform":{{"a":1,"b":0,"c":0,"d":1,"e":10,"f":10}},
                "fill":{{"type":"none"}},
                "stroke":{{"paint":{{"type":"solid","color":{{"r":255,"g":0,"b":0,"a":1}}}},
                  "width":4,"cap":"butt","join":"miter","miterLimit":4,"align":"{}"}}
              }}]}}]
            }}"#,
                align
            ))
            .expect("document parses");
            let mut pixmap = sk::Pixmap::new(40, 40).expect("pixmap");
            render_layers(&mut pixmap, &doc, sk::Transform::identity());
            pixmap
        }

        let inside = render("inside");
        assert_eq!(
            inside.pixel(7, 20).unwrap().alpha(),
            0,
            "inside stroke does not paint outside the rect"
        );
        assert!(
            inside.pixel(11, 20).unwrap().red() > 200,
            "inside stroke paints the inner edge band"
        );
        assert_eq!(
            inside.pixel(20, 20).unwrap().alpha(),
            0,
            "inside stroke leaves the center untouched when fill is none"
        );

        let outside = render("outside");
        assert!(
            outside.pixel(7, 20).unwrap().red() > 200,
            "outside stroke paints the outer edge band"
        );
        assert_eq!(
            outside.pixel(12, 20).unwrap().alpha(),
            0,
            "outside stroke does not paint inside the rect"
        );
    }

    #[test]
    fn pattern_fill_renders_repeating_tile_artwork() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"rect","width":16,"height":8,
            "fill":{"type":"pattern","pattern":{"width":8,"height":8,"tile":[
              {"type":"rect","width":4,"height":8,
                "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}}
            ]}}}]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(18, 10).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert!(
            pixmap.pixel(2, 4).unwrap().red() > 200,
            "first tile paints its red artwork"
        );
        assert_eq!(
            pixmap.pixel(6, 4).unwrap().alpha(),
            0,
            "transparent part of the tile stays transparent"
        );
        assert!(
            pixmap.pixel(10, 4).unwrap().red() > 200,
            "tile repeats across the filled shape"
        );
        assert_eq!(
            pixmap.pixel(14, 4).unwrap().alpha(),
            0,
            "second tile transparent part stays transparent"
        );
    }

    #[test]
    fn pattern_stroke_uses_repeating_tile_paint() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"rect","width":16,"height":16,
            "fill":{"type":"none"},
            "stroke":{"width":4,"paint":{"type":"pattern","pattern":{"width":8,"height":8,"tile":[
              {"type":"rect","width":4,"height":8,
                "fill":{"type":"solid","color":{"r":0,"g":0,"b":255,"a":1}}}
            ]}}}}]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(18, 18).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert!(
            pixmap.pixel(2, 1).unwrap().blue() > 200,
            "stroke samples the blue artwork in the first tile"
        );
        assert_eq!(
            pixmap.pixel(6, 1).unwrap().alpha(),
            0,
            "stroke keeps tile transparency"
        );
        assert!(
            pixmap.pixel(10, 1).unwrap().blue() > 200,
            "stroke pattern repeats"
        );
    }

    #[test]
    fn variable_width_profile_renders_a_tapered_stroke_ribbon() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"path",
            "geometry":{"closed":false,"anchors":[
              {"point":{"x":5,"y":20},"handleIn":{"x":0,"y":0},"handleOut":{"x":0,"y":0}},
              {"point":{"x":35,"y":20},"handleIn":{"x":0,"y":0},"handleOut":{"x":0,"y":0}}
            ]},
            "fill":{"type":"none"},
            "stroke":{"width":4,"widthProfile":[1,3],
              "paint":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}}
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(42, 42).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert!(
            pixmap.pixel(34, 25).unwrap().red() > 200,
            "wide end uses the larger profile multiplier"
        );
        assert_eq!(
            pixmap.pixel(6, 25).unwrap().alpha(),
            0,
            "narrow end does not fill the same far edge band"
        );
        assert!(
            pixmap.pixel(5, 21).unwrap().red() > 200,
            "narrow end still renders the base stroke band"
        );
    }

    #[test]
    fn compound_width_profile_uses_flat_subpath_anchor_order() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"compound","subpaths":[
            {"closed":false,"anchors":[
              {"point":{"x":5,"y":10}}, {"point":{"x":35,"y":10}}
            ]},
            {"closed":false,"anchors":[
              {"point":{"x":5,"y":30}}, {"point":{"x":35,"y":30}}
            ]}
          ],
          "fill":{"type":"none"},
          "stroke":{"width":4,"widthProfile":[1,1,1,3],
            "paint":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}}
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(42, 42).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert!(
            pixmap.pixel(34, 34).unwrap().red() > 200,
            "last flat anchor widens the second subpath"
        );
        assert_eq!(
            pixmap.pixel(6, 34).unwrap().alpha(),
            0,
            "the second subpath's first anchor stays narrow"
        );
        assert!(
            pixmap.pixel(34, 10).unwrap().red() > 200,
            "the first subpath keeps its own uniform profile"
        );
    }

    #[test]
    fn short_width_profile_is_resampled() {
        assert_eq!(resample_width_profile(&[1.0, 3.0], 3), vec![1.0, 2.0, 3.0]);
        assert_eq!(resample_width_profile(&[1.0, 2.0, 3.0], 2), vec![1.0, 3.0]);
    }

    #[test]
    fn drop_shadow_effect_renders_behind_source() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"rect","width":10,"height":10,
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},
            "effects":[{"type":"drop-shadow","dx":4,"dy":3,"blur":0,
              "color":{"r":0,"g":0,"b":0,"a":1}}]
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(20, 20).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert!(
            pixmap.pixel(2, 2).unwrap().red() > 200,
            "source artwork still renders over the effect"
        );
        let shadow = pixmap.pixel(12, 11).unwrap();
        assert!(
            shadow.alpha() > 200 && shadow.red() < 20 && shadow.green() < 20,
            "offset area contains the shadow"
        );
        assert_eq!(
            pixmap.pixel(15, 1).unwrap().alpha(),
            0,
            "shadow does not paint where the offset source alpha is absent"
        );
    }

    #[test]
    fn glow_effect_renders_outside_source_alpha() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"rect","width":10,"height":10,
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},
            "effects":[{"type":"glow","blur":2,
              "color":{"r":0,"g":0,"b":255,"a":1}}]
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(18, 18).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        let glow = pixmap.pixel(12, 5).unwrap();
        assert!(
            glow.alpha() > 0 && glow.blue() > glow.red(),
            "outer glow is visible outside the filled rect"
        );
        let source = pixmap.pixel(5, 5).unwrap();
        assert!(
            source.red() > 200 && source.blue() < 20,
            "opaque source still covers the glow under it"
        );
    }

    #[test]
    fn blur_effect_softens_source_edges() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"rect","width":10,"height":10,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":4},
            "fill":{"type":"solid","color":{"r":0,"g":200,"b":0,"a":1}},
            "effects":[{"type":"blur","radius":2}]
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(22, 22).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        let outside = pixmap.pixel(2, 9).unwrap();
        assert!(
            outside.alpha() > 0 && outside.green() > 0,
            "blur extends softened source pixels outside the original rect"
        );
        assert!(
            pixmap.pixel(9, 9).unwrap().green() > outside.green(),
            "interior remains stronger than the blurred fringe"
        );
    }

    #[test]
    fn feather_effect_fades_edges_without_extending_source() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"rect","width":10,"height":10,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":4},
            "fill":{"type":"solid","color":{"r":0,"g":200,"b":0,"a":1}},
            "effects":[{"type":"feather","radius":2}]
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(22, 22).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        let edge = pixmap.pixel(4, 9).unwrap();
        let center = pixmap.pixel(9, 9).unwrap();
        assert!(
            edge.alpha() < center.alpha(),
            "feather lowers source alpha near the edge"
        );
        assert_eq!(
            pixmap.pixel(2, 9).unwrap().alpha(),
            0,
            "feather does not blur color outside the original source"
        );
    }

    #[test]
    fn inner_glow_effect_paints_inside_edge() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"rect","width":14,"height":14,
            "transform":{"a":1,"b":0,"c":0,"d":1,"e":3,"f":3},
            "fill":{"type":"solid","color":{"r":220,"g":0,"b":0,"a":1}},
            "effects":[{"type":"inner-glow","blur":2,
              "color":{"r":0,"g":0,"b":255,"a":0.8}}]
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(24, 24).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        let edge = pixmap.pixel(4, 10).unwrap();
        let center = pixmap.pixel(10, 10).unwrap();
        assert!(
            edge.blue() > center.blue(),
            "inner glow is stronger near the inside edge than the center"
        );
        assert!(
            center.red() > 150,
            "inner glow keeps the source graphic visible"
        );
    }

    #[test]
    fn unknown_live_effect_keeps_base_artwork_visible() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"rect","width":10,"height":10,
            "fill":{"type":"solid","color":{"r":0,"g":200,"b":0,"a":1}},
            "effects":[{"type":"future-effect","amount":4}]
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(12, 12).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert!(
            pixmap.pixel(5, 5).unwrap().green() > 150,
            "unknown effects do not suppress the item entirely"
        );
    }

    #[test]
    fn group_drop_shadow_effect_uses_combined_child_alpha() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"group",
            "effects":[{"type":"drop-shadow","dx":0,"dy":6,"blur":0,
              "color":{"r":0,"g":0,"b":0,"a":1}}],
            "children":[
              {"type":"rect","width":4,"height":4,
                "transform":{"a":1,"b":0,"c":0,"d":1,"e":2,"f":2},
                "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}},
              {"type":"rect","width":4,"height":4,
                "transform":{"a":1,"b":0,"c":0,"d":1,"e":12,"f":2},
                "fill":{"type":"solid","color":{"r":0,"g":255,"b":0,"a":1}}}
            ]
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(22, 16).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert!(
            pixmap.pixel(3, 3).unwrap().red() > 200,
            "first child source remains visible"
        );
        assert!(
            pixmap.pixel(13, 3).unwrap().green() > 200,
            "second child source remains visible"
        );
        let first_shadow = pixmap.pixel(3, 9).unwrap();
        let second_shadow = pixmap.pixel(13, 9).unwrap();
        assert!(
            first_shadow.alpha() > 200 && first_shadow.red() < 20,
            "shadow is generated from the first child alpha"
        );
        assert!(
            second_shadow.alpha() > 200 && second_shadow.green() < 20,
            "shadow is generated from the second child alpha"
        );
        assert_eq!(
            pixmap.pixel(8, 9).unwrap().alpha(),
            0,
            "transparent gap between children does not create group-shadow fill"
        );
    }

    #[test]
    fn group_blur_effect_softens_the_offscreen_child_stack() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"group",
            "effects":[{"type":"blur","radius":2}],
            "children":[{"type":"rect","width":10,"height":10,
              "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":4},
              "fill":{"type":"solid","color":{"r":0,"g":200,"b":0,"a":1}}}]
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(22, 22).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        let outside = pixmap.pixel(2, 9).unwrap();
        assert!(
            outside.alpha() > 0 && outside.green() > 0,
            "group blur extends softened source pixels outside the child rect"
        );
        assert!(
            pixmap.pixel(9, 9).unwrap().green() > outside.green(),
            "group interior remains stronger than the blurred fringe"
        );
    }

    #[test]
    fn group_mask_clips_live_effect_output() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"group",
            "mask":[{"type":"rect","width":10,"height":10,
              "fill":{"type":"solid","color":{"r":255,"g":255,"b":255,"a":1}}}],
            "effects":[{"type":"drop-shadow","dx":12,"dy":0,"blur":0,
              "color":{"r":0,"g":0,"b":0,"a":1}}],
            "children":[{"type":"rect","width":10,"height":10,
              "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}}]
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(26, 12).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert!(
            pixmap.pixel(5, 5).unwrap().red() > 200,
            "group mask still reveals base child content"
        );
        assert_eq!(
            pixmap.pixel(17, 5).unwrap().alpha(),
            0,
            "group mask clips effect pixels outside the mask"
        );
    }

    #[test]
    fn opacity_mask_luminance_clips_item_content() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"rect","width":20,"height":10,
            "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},
            "mask":[{"type":"rect","width":10,"height":10,
              "fill":{"type":"solid","color":{"r":255,"g":255,"b":255,"a":1}}}]
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(22, 12).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert!(
            pixmap.pixel(5, 5).unwrap().red() > 200,
            "white mask reveals the target"
        );
        assert_eq!(
            pixmap.pixel(15, 5).unwrap().alpha(),
            0,
            "outside the mask content is hidden"
        );
    }

    #[test]
    fn opacity_mask_alpha_mode_uses_alpha_instead_of_luminance() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[
            {"type":"rect","width":10,"height":10,
              "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},
              "mask":[{"type":"rect","width":10,"height":10,
                "fill":{"type":"solid","color":{"r":0,"g":0,"b":0,"a":1}}}]},
            {"type":"rect","width":10,"height":10,"transform":{"a":1,"b":0,"c":0,"d":1,"e":12,"f":0},
              "fill":{"type":"solid","color":{"r":0,"g":0,"b":255,"a":1}},
              "maskType":"alpha",
              "mask":[{"type":"rect","width":10,"height":10,
                "fill":{"type":"solid","color":{"r":0,"g":0,"b":0,"a":1}}}]}
          ]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(24, 12).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert_eq!(
            pixmap.pixel(5, 5).unwrap().alpha(),
            0,
            "default luminance mode hides black mask artwork"
        );
        assert!(
            pixmap.pixel(17, 5).unwrap().blue() > 200,
            "alpha mode reveals opaque black mask artwork"
        );
    }

    #[test]
    fn opacity_mask_applies_to_groups() {
        let doc = Document::parse(
            r#"{
          "layers":[{"items":[{"type":"group",
            "mask":[{"type":"rect","width":10,"height":10,
              "fill":{"type":"solid","color":{"r":255,"g":255,"b":255,"a":1}}}],
            "children":[{"type":"rect","width":20,"height":10,
              "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}}]
          }]}]
        }"#,
        )
        .expect("document parses");
        let mut pixmap = sk::Pixmap::new(22, 12).expect("pixmap");
        render_layers(&mut pixmap, &doc, sk::Transform::identity());
        assert!(
            pixmap.pixel(5, 5).unwrap().red() > 200,
            "group mask reveals child content"
        );
        assert_eq!(
            pixmap.pixel(15, 5).unwrap().alpha(),
            0,
            "group mask hides child content outside the mask"
        );
    }
}
