// VIS-LS-07 — a Layer Style on a group header renders around the group's
// composited result (one shadow/stroke/overlay for the whole assembly), not
// around the pixel-less header and not across the whole canvas.

use super::*;

// Two adjacent 4×4 black squares inside one group, on an opaque white
// backdrop. Their union spans x 4..12, y 4..8.
fn two_member_group(blend: u8) -> (Engine, u32, u32) {
    let mut e = Engine::new(24, 24);
    e.select_rect(0, 0, 24, 24, 0);
    e.fill_selection(255, 255, 255, 255);
    e.select_none();

    let a = e.add_layer("a");
    e.select_rect(4, 4, 4, 4, 0);
    e.fill_selection(0, 0, 0, 255);
    e.select_none();

    let b = e.add_layer("b");
    e.select_rect(8, 4, 4, 4, 0);
    e.fill_selection(0, 0, 0, 255);
    e.select_none();

    let g = e.group_layers(&[a, b], "G");
    e.set_layer_blend(g, blend);
    (e, g, b)
}

fn is_red(e: &Engine, x: usize, y: usize) -> bool {
    let o = (y * 24 + x) * 4;
    e.output[o] > 200 && e.output[o + 1] < 60 && e.output[o + 2] < 60 && e.output[o + 3] > 200
}

fn is_white(e: &Engine, x: usize, y: usize) -> bool {
    let o = (y * 24 + x) * 4;
    e.output[o] > 245 && e.output[o + 1] > 245 && e.output[o + 2] > 245
}

// Pass Through group (the default blend): a Color Overlay on the header paints
// the members' union, and nothing outside it — the old kind-6 coverage was the
// whole canvas (and never reached the compositor at all).
#[test]
fn group_color_overlay_covers_the_members_and_only_the_members() {
    let (mut e, g, _) = two_member_group(25); // 25 = Pass Through
    // Color Overlay (fx 6): [enabled, blend, opacity, r, g, b] = red.
    e.set_layer_effect(g, 6, &[1.0, 0.0, 1.0, 1.0, 0.0, 0.0]);
    e.composite();

    assert!(
        is_red(&e, 5, 5),
        "the group's overlay paints over the first member"
    );
    assert!(
        is_red(&e, 10, 5),
        "…and over the second member: one style for the whole assembly"
    );
    assert!(
        is_white(&e, 0, 0),
        "the overlay is bounded by the members, not the canvas"
    );
    assert!(
        is_white(&e, 5, 12),
        "below the members the backdrop is untouched"
    );
}

// Isolated group (Normal blend): an outside Stroke hugs the union's outline —
// on both sides, so the shape really is the composited group, not one member.
#[test]
fn group_stroke_hugs_the_composited_union_on_an_isolated_group() {
    let (mut e, g, b) = two_member_group(0); // 0 = Normal → isolated group
    // Stroke (fx 9): [enabled, blend, opacity, r, g, b, size, position(0=outside)].
    e.set_layer_effect(g, 9, &[1.0, 0.0, 1.0, 1.0, 0.0, 0.0, 2.0, 0.0]);
    e.composite();

    assert!(
        is_red(&e, 3, 5),
        "the stroke reaches outside the first member's left edge"
    );
    assert!(
        is_red(&e, 12, 5),
        "…and outside the second member's right edge — one outline, not two"
    );
    assert!(
        !is_red(&e, 8, 5),
        "no stroke along the seam: the members composite as a single shape"
    );
    assert!(
        is_white(&e, 0, 5),
        "a 2px stroke stops well short of the canvas edge"
    );

    // Hiding a member reshapes the style: the right half of the outline goes.
    e.set_layer_visible(b, false);
    e.composite();
    assert!(
        !is_red(&e, 12, 5),
        "the style follows the group's live composited coverage"
    );
    assert!(
        is_red(&e, 3, 5),
        "the surviving member keeps its side of the outline"
    );
}

/// Group styles render now, so baking one into the pixel-less header would
/// silently lose it (bake_layer_style isolates the layer, hiding the very
/// members the style is drawn around). It must refuse loudly instead.
#[test]
fn rasterizing_a_group_style_refuses_instead_of_dropping_it() {
    let (mut e, g, _) = two_member_group(0);
    e.set_layer_effect(g, 1, &[1.0, 0.0, 0.0, 255.0, 3.0, 0.0, 0.0, 255.0]);
    e.composite();
    let before = e.output.clone();

    e.rasterize_layer_style(g);

    assert!(
        !e.last_edit_error.is_empty(),
        "rasterizing a group style must report why it refused"
    );
    e.composite();
    assert_eq!(
        e.output, before,
        "a refused rasterize must leave the document untouched"
    );
    assert!(
        !e.layers[e.layer_index(g).unwrap()].effects.is_empty(),
        "the group must keep its style after a refusal"
    );
}

#[test]
fn issue_369_rasterizing_member_style_preserves_grouped_appearance() {
    let mut e = Engine::new(8, 8);
    let member = e.add_layer("member");
    e.fill_selection(255, 0, 0, 255);
    let group = e.create_group("G");
    e.set_layer_opacity(group, 0.5);
    // Opaque green Color Overlay on the member.
    e.set_layer_effect(member, 6, &[1.0, 0.0, 1.0, 0.0, 1.0, 0.0]);
    e.composite();
    let before = e.output.clone();

    e.rasterize_layer_style(member);

    assert!(!e.layer_has_effects(member));
    assert_eq!(e.layer_group(member), group);
    assert_eq!(e.output, before, "only the member's own style was baked");
}

#[test]
fn issue_370_flatten_all_keeps_group_styles_and_reports_refusal() {
    let (mut e, group, _) = two_member_group(0);
    e.set_layer_effect(group, 6, &[1.0, 0.0, 1.0, 1.0, 0.0, 0.0]);
    e.composite();
    let before = e.output.clone();
    let undo_depth = e.undo_depth();

    e.flatten_all_layer_effects();

    assert_eq!(e.last_edit_error, GROUP_STYLE_RASTERIZE_UNSUPPORTED);
    assert!(e.layer_has_effects(group));
    assert_eq!(e.output, before);
    assert_eq!(
        e.undo_depth(),
        undo_depth,
        "a group-only refusal adds no history"
    );
}
