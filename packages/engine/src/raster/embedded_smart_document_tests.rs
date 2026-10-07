// Smart Objects whose source is a Photoshop document (#460): Place Embedded
// of a PSB keeps its layers, an imported one decodes its embedded PSB on Edit
// Contents, a committed edit re-places the new composite through each
// instance's corners and its smart filters, and PSD export writes the edited
// document back under the same file record.

use super::*;

const W: u32 = 100;
const H: u32 = 80;
const RED: [u8; 4] = [220, 30, 30, 255];
const BLUE: [u8; 4] = [30, 60, 220, 255];
/// Where `logo_psb` lands in a `W`×`H` canvas: 40×20, centred, unscaled.
const PLACED: [f64; 8] = [30.0, 30.0, 70.0, 30.0, 70.0, 50.0, 30.0, 50.0];

/// Type `text` into layer `id` at (5, 5) as a `w`×6 block of `color`, the
/// way the host does: its rendered glyphs, then its editable spec.
fn set_type(e: &mut Engine, id: u32, text: &str, w: u32, color: [u8; 4]) {
    let glyphs = color.repeat(w as usize * 6);
    let [r, g, b, a] = color;
    e.set_text_layer(id, 5, 5, w, 6, &glyphs, text, 16.0, r, g, b, a);
    let spec = format!(
        concat!(
            r#"{{"v":1,"kind":"point","vertical":false,"ax":5,"ay":5,"#,
            r#""runs":[{{"text":"{text}","font":"Inter","size":16.0,"color":[{r},{g},{b},{a}]}}],"#,
            r#""font":"Inter","size":16.0,"color":[{r},{g},{b},{a}],"#,
            r#""bold":false,"italic":false,"tracking":0.0,"kerning":"metrics","#,
            r#""leading":0.0,"hScale":1.0,"vScale":1.0,"align":"left","#,
            r#""direction":"ltr","composer":"latin","boxW":0.0,"boxH":0.0,"#,
            r#""firstIndent":0.0,"leftIndent":0.0,"rightIndent":0.0,"#,
            r#""spaceBefore":0.0,"spaceAfter":0.0,"antialias":"sharp","#,
            r#""digits":"latin","kashida":"none","diacriticX":0.0,"diacriticY":0.0,"#,
            r#""path":[],"liga":false,"dlig":false,"frac":false,"ordn":false,"#,
            r#""features":{{}},"stroke":null,"shadow":null,"#,
            r#""warp":{{"style":"none","bend":0.0,"h":0.0,"v":0.0,"orient":"h"}}}}"#,
        ),
        text = text,
        r = r,
        g = g,
        b = b,
        a = a,
    );
    e.set_text_layer_spec(id, 5, 5, w, 6, &glyphs, &spec);
}

/// A 40×20 document: a white background under the red type layer "Logo" at
/// (5, 5), 10×6.
fn logo_psb() -> Vec<u8> {
    let mut nested = Engine::new(40, 20);
    let text = nested.add_layer("Logo");
    set_type(&mut nested, text, "Logo", 10, RED);
    nested
        .try_export_photoshop_with_profile_tag_and_icc(true, false, true, None)
        .expect("the nested document exports as PSB")
}

/// A document holding one placed `logo_psb`.
fn placed_parent() -> Engine {
    let mut parent = Engine::new(W, H);
    parent.place_smart_object(&logo_psb(), "Logo").expect("a PSB places");
    parent
}

fn smart_layer(e: &Engine) -> u32 {
    e.layers.iter().find(|layer| layer.kind == 7).expect("a Smart Object").id
}

fn rgb(e: &Engine, x: i32, y: i32) -> [u8; 3] {
    let c = e.pick_color(x, y);
    [(c >> 24) as u8, (c >> 16) as u8, (c >> 8) as u8]
}

fn nested_document(e: &mut Engine, id: u32) -> Engine {
    let bytes = e.smart_object_document(id);
    assert!(!bytes.is_empty(), "Edit Contents opens a layered document: {}", e.last_edit_error);
    Engine::load_project(&bytes).expect("the nested document loads")
}

fn type_layer(e: &Engine) -> u32 {
    e.layers.iter().find(|layer| layer.kind == 2).expect("a type layer").id
}

fn nested_text(e: &mut Engine, id: u32) -> String {
    let nested = nested_document(e, id);
    nested.layer_text(type_layer(&nested))
}

/// Retype the nested "Logo" as the wider blue "Logo v2" and commit it back.
fn retype(parent: &mut Engine, id: u32) {
    let mut nested = nested_document(parent, id);
    let text = type_layer(&nested);
    set_type(&mut nested, text, "Logo v2", 20, BLUE);
    assert!(parent.replace_smart_object_document(id, &nested.save_project()));
}

#[test]
fn placing_a_psb_keeps_its_layers() {
    let mut parent = placed_parent();
    let so = smart_layer(&parent);
    let i = parent.layer_index(so).unwrap();
    let link = parent.layers[i].smart_link.clone().expect("placed document is linked");
    assert_eq!((link.size, link.corners), ([40, 20], PLACED));
    assert_eq!(rgb(&parent, 37, 37), [220, 30, 30]);
    assert_eq!(rgb(&parent, 50, 37), [255, 255, 255]);
    assert_eq!(rgb(&parent, 10, 10), [255, 255, 255]);

    let nested = nested_document(&mut parent, so);
    assert_eq!((nested.w, nested.h, nested.layer_count()), (40, 20, 2));
    assert_eq!(nested.layer_text(type_layer(&nested)), "Logo");

    retype(&mut parent, so);
    assert_eq!(rgb(&parent, 50, 37), [30, 60, 220]);
    parent.undo();
    assert_eq!(rgb(&parent, 50, 37), [255, 255, 255]);
}

#[test]
fn imported_smart_object_edits_its_embedded_psb_and_exports_it_fresh() {
    let psd = placed_parent().export_psd().expect("the placed document exports as a Smart Object");
    let mut imported = Engine::from_format(&psd).expect("the PSD imports");
    let so = smart_layer(&imported);
    let i = imported.layer_index(so).unwrap();
    let link = imported.layers[i].smart_link.clone().expect("the embedded PSB is linked");
    assert_eq!((link.size, link.corners), ([40, 20], PLACED));
    assert_eq!(link.id.len(), 36, "a UUID-shaped file record ID");
    assert!(imported.layers[i].smart_doc.is_empty(), "decoded on Edit Contents, not at import");
    let descriptor = imported.layers[i].psd_smart_blocks.clone();
    let linked = imported.psd_linked_blocks.clone();

    // An untouched Smart Object goes back out byte for byte.
    let untouched = Engine::from_format(&imported.export_psd().unwrap()).unwrap();
    assert_eq!(untouched.layers[i].psd_smart_blocks, descriptor);
    assert_eq!(untouched.psd_linked_blocks, linked);

    let nested = nested_document(&mut imported, so);
    assert_eq!((nested.w, nested.h, nested.layer_count()), (40, 20, 2));
    assert_eq!(nested.layer_text(type_layer(&nested)), "Logo");

    retype(&mut imported, so);
    assert_eq!(rgb(&imported, 37, 37), [30, 60, 220]);
    assert_eq!(rgb(&imported, 50, 37), [30, 60, 220]);
    assert_eq!(rgb(&imported, 60, 37), [255, 255, 255]);

    let exported = imported.export_psd().expect("the edited Smart Object exports");
    // Exporting borrowed nothing it kept.
    assert_eq!(imported.layers[i].psd_smart_blocks, descriptor);
    assert_eq!(imported.psd_linked_blocks, linked);

    let mut reopened = Engine::from_format(&exported).expect("the re-export imports");
    let so = smart_layer(&reopened);
    let j = reopened.layer_index(so).unwrap();
    assert_eq!(reopened.layers[j].smart_link, Some(link));
    assert_eq!(reopened.layers[j].psd_smart_blocks, descriptor, "same placement, same descriptor");
    assert_ne!(reopened.psd_linked_blocks, linked, "the record holds the edited document");
    assert_eq!(rgb(&reopened, 50, 37), [30, 60, 220]);
    assert_eq!(nested_text(&mut reopened, so), "Logo v2");
}

#[test]
fn edited_contents_re_render_through_smart_filters_after_the_descriptor_is_gone() {
    let psd = placed_parent().export_psd().unwrap();
    let mut imported = Engine::from_format(&psd).unwrap();
    let so = smart_layer(&imported);
    let i = imported.layer_index(so).unwrap();
    imported.smart_add_filter(so, 1, &[3.0]); // box blur
    assert!(imported.layers[i].psd_smart_blocks.is_empty(), "a Vision filter drops the descriptor");

    retype(&mut imported, so);
    let layer = &imported.layers[i];
    let mut expected = layer.smart_src.clone();
    apply_smart_filter(Arc::make_mut(&mut expected), W, H, 1, &[3.0], None, PROFILE_SRGB);
    assert_eq!(layer.pixels, expected, "the new contents render through the filter");
    assert_eq!(imported.smart_filter_count(so), 1);
    let [r, _, b] = rgb(&imported, 56, 37);
    assert!(r < 255 && b > r, "blurred blue spills past the new text edge: {r} {b}");

    // A project save keeps the link the descriptor no longer holds.
    let mut reloaded = Engine::load_project(&imported.save_project()).unwrap();
    assert_eq!(reloaded.layers[i].smart_link, imported.layers[i].smart_link);
    assert_eq!(nested_text(&mut reloaded, so), "Logo v2");
    let legacy = Engine::load_project(&mvsn_v35_bytes(imported.save_project())).unwrap();
    assert_eq!(legacy.layers[i].smart_link, None, "a v35 project has no placement");

    // Export does not refuse it; the filtered layer leaves as its pixels.
    let exported = imported.export_psd().expect("a filtered Smart Object still exports");
    let reopened = Engine::from_format(&exported).unwrap();
    assert_eq!(reopened.layers[i].kind, 0);
    assert_eq!(rgb(&reopened, 56, 37), rgb(&imported, 56, 37));
}

#[test]
fn instances_update_where_each_sits_and_a_resized_document_keeps_its_placement() {
    let mut parent = placed_parent();
    let so = smart_layer(&parent);
    let copy = parent.duplicate_layer(so);
    let c = parent.layer_index(copy).unwrap();
    let lowered: [f64; 8] = std::array::from_fn(|k| PLACED[k] + if k % 2 == 1 { 25.0 } else { 0.0 });
    let composite = Engine::load_project(&parent.layers[c].smart_doc).unwrap().export_composite_rgba16();
    let source = placed_smart_source(&composite, [40, 20], lowered, W, H).unwrap();
    parent.layers[c].smart_link.as_mut().unwrap().corners = lowered;
    parent.layers[c].set_smart_src(source);
    parent.render_smart(c);
    parent.composite();
    assert_eq!(rgb(&parent, 37, 62), [220, 30, 30]);

    let mut imported = Engine::from_format(&parent.export_psd().unwrap()).unwrap();
    let smart: Vec<usize> = (0..imported.layers.len()).filter(|&k| imported.layers[k].kind == 7).collect();
    assert_eq!(smart.len(), 2);
    let (a, b) = (&imported.layers[smart[0]], &imported.layers[smart[1]]);
    assert_eq!(a.smart_link.as_ref().unwrap().id, b.smart_link.as_ref().unwrap().id, "one record");
    assert_ne!(a.smart_source_id, 0);
    assert_eq!(a.smart_source_id, b.smart_source_id, "instances of one source");
    assert_eq!(imported.psd_linked_blocks.len(), 1);

    // Grow the nested canvas to the right and paint into the new area.
    let so = imported.layers[smart[0]].id;
    let mut nested = nested_document(&mut imported, so);
    nested.resize_canvas(80, 20, 0, 0);
    nested.add_layer("Paint");
    nested.select_rect(50, 5, 10, 6, 0);
    nested.fill_selection(30, 60, 220, 255);
    nested.select_none();
    assert!(imported.replace_smart_object_document(so, &nested.save_project()));
    for (k, dy) in [(smart[0], 0.0), (smart[1], 25.0)] {
        let link = imported.layers[k].smart_link.as_ref().unwrap();
        assert_eq!(link.size, [80, 20]);
        assert_eq!(link.corners, [30.0, 30.0 + dy, 110.0, 30.0 + dy, 110.0, 50.0 + dy, 30.0, 50.0 + dy]);
    }
    assert_eq!(rgb(&imported, 37, 37), [220, 30, 30]);
    assert_eq!(rgb(&imported, 85, 37), [30, 60, 220]);
    assert_eq!(rgb(&imported, 85, 62), [30, 60, 220]);

    // Each descriptor now states the new size; both still name the one record.
    let mut reopened = Engine::from_format(&imported.export_psd().unwrap()).unwrap();
    let links: Vec<SmartLink> = reopened.layers.iter().filter_map(|layer| layer.smart_link.clone()).collect();
    assert_eq!(links.len(), 2);
    assert_eq!(links[0].id, links[1].id);
    assert_eq!(links[0].corners, [30.0, 30.0, 110.0, 30.0, 110.0, 50.0, 30.0, 50.0]);
    assert_eq!(links[1].size, [80, 20]);
    let so = smart_layer(&reopened);
    let nested = nested_document(&mut reopened, so);
    assert_eq!((nested.w, nested.h), (80, 20));
    assert_eq!(rgb(&nested, 55, 7), [30, 60, 220]);
    assert_eq!(rgb(&reopened, 85, 62), [30, 60, 220]);
}

#[test]
fn a_detached_copy_exports_its_own_document() {
    let psd = placed_parent().export_psd().unwrap();
    let mut imported = Engine::from_format(&psd).unwrap();
    let so = smart_layer(&imported);
    let copy = imported.duplicate_layer(so);
    assert!(imported.detach_smart_object(copy));
    let c = imported.layer_index(copy).unwrap();
    assert!(!imported.layers[c].smart_doc.is_empty(), "the shared document is decoded for the copy");
    retype(&mut imported, copy);
    let i = imported.layer_index(so).unwrap();
    assert_eq!(nested_text(&mut imported, so), "Logo");
    assert!(imported.layers[i].smart_doc.is_empty(), "the original is untouched");

    let mut reopened = Engine::from_format(&imported.export_psd().unwrap()).unwrap();
    let ids: Vec<u32> = reopened.layers.iter().filter(|layer| layer.kind == 7).map(|layer| layer.id).collect();
    assert_eq!(ids.len(), 2);
    let texts: Vec<String> = ids.iter().map(|&id| nested_text(&mut reopened, id)).collect();
    assert_eq!(texts, ["Logo", "Logo v2"]);
    let links: Vec<String> = reopened.layers.iter().filter_map(|layer| Some(layer.smart_link.as_ref()?.id.clone())).collect();
    assert_ne!(links[0], links[1]);
}

#[test]
fn canvas_resizes_carry_the_placement_and_other_sources_stay_flat() {
    let mut parent = placed_parent();
    let so = smart_layer(&parent);
    let i = parent.layer_index(so).unwrap();
    parent.resize_image(W * 2, H * 2);
    assert_eq!(parent.layers[i].smart_link.as_ref().unwrap().corners, PLACED.map(|v| v * 2.0));
    parent.resize_canvas(W * 2 + 10, H * 2, 10, 0);
    let moved: [f64; 8] = std::array::from_fn(|k| PLACED[k] * 2.0 + if k % 2 == 0 { 10.0 } else { 0.0 });
    assert_eq!(parent.layers[i].smart_link.as_ref().unwrap().corners, moved);
    retype(&mut parent, so);
    assert_eq!(rgb(&parent, 10 + 100, 74), [30, 60, 220]);
    parent.rotate_arbitrary(90.0);
    assert!(parent.layers[i].smart_link.is_none() && parent.layers[i].smart_doc.is_empty());
    assert!(parent.smart_object_document(so).is_empty(), "a rotated one edits as pixels");

    // An embedded PNG is not a document to open.
    let psd = placed_parent().export_psd().unwrap();
    let imported = Engine::from_format(&psd).unwrap();
    let link = imported.layers[imported.layer_index(smart_layer(&imported)).unwrap()]
        .smart_link
        .clone()
        .unwrap();
    let mut png = Vec::new();
    image::RgbaImage::new(40, 20)
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .unwrap();
    let mut flat = imported;
    flat.psd_linked_blocks = monet_format::import::psd_linked_blocks_with_file(
        &flat.psd_linked_blocks,
        &link.id,
        "",
        *b"png ",
        &png,
    );
    let mut reopened = Engine::from_format(&flat.export_psd().unwrap()).unwrap();
    let so = smart_layer(&reopened);
    assert_eq!(reopened.layers[reopened.layer_index(so).unwrap()].smart_link, None);
    assert!(reopened.smart_object_document(so).is_empty());
    assert!(!reopened.export_smart_object_png(so).unwrap().is_empty(), "it edits as its pixels");
}

#[test]
fn a_float_document_re_renders_its_float_authority() {
    let mut parent = Engine::new(W, H);
    parent.set_depth(32);
    parent.place_smart_object(&logo_psb(), "Logo").expect("a PSB places");
    let psd = parent.export_psd().expect("a 32-bit document exports");
    let mut imported = Engine::from_format(&psd).expect("the 32-bit PSD imports");
    assert_eq!(imported.depth, 32);
    let so = smart_layer(&imported);
    let i = imported.layer_index(so).unwrap();
    assert!(!imported.layers[i].pixels_f32.is_empty(), "the float plane is the authority");
    retype(&mut imported, so);
    assert_eq!(imported.layers[i].pixels_f32.len(), imported.layers[i].pixels.len());
    assert_eq!(rgb(&imported, 50, 37), [30, 60, 220]);
}

#[test]
fn a_placement_with_no_area_refuses_the_commit_and_says_why() {
    let mut parent = placed_parent();
    let so = smart_layer(&parent);
    let i = parent.layer_index(so).unwrap();
    parent.layers[i].smart_link.as_mut().unwrap().corners = [30.0, 30.0, 70.0, 30.0, 70.0, 30.0, 30.0, 30.0];
    let nested = nested_document(&mut parent, so);
    let before = parent.layers[i].smart_src.clone();
    let depth = parent.undo_depth();
    assert!(!parent.replace_smart_object_document(so, &nested.save_project()));
    assert!(parent.last_edit_error.contains("placement has no area"), "{}", parent.last_edit_error);
    assert_eq!(parent.layers[i].smart_src, before);
    assert_eq!(parent.undo_depth(), depth);
}

/// A chain of placed documents `depth` deep: each level's contents hold the
/// next level's document.
fn nested_chain(depth: usize) -> Engine {
    let mut tiny = Engine::new(4, 4);
    tiny.add_layer("x");
    let psb = tiny.try_export_photoshop_with_profile_tag_and_icc(true, false, true, None).unwrap();
    let mut child = Engine::new(4, 4);
    child.add_layer("bottom");
    for level in 0..depth {
        let mut e = Engine::new(4, 4);
        let so = e.place_smart_object(&psb, &format!("L{level}")).unwrap();
        assert!(e.replace_smart_object_document(so, &child.save_project()), "level {level}");
        child = e;
    }
    child
}

#[test]
fn contents_nested_past_the_limit_export_as_pixels_instead_of_recursing() {
    // Each level exports the next from inside its own export; a crafted file
    // nested hundreds deep overflowed the wasm stack and killed the module.
    let depth = MAX_NESTED_SMART_EXPORT_DEPTH as usize + 8;
    let mut top = Engine::load_project(&nested_chain(depth).save_project()).expect("the chain reloads");
    let psd = top.export_psd().expect("a deep chain still exports");
    let notice = top.photoshop_export_notice();
    assert!(notice.contains("more than 32 deep"), "{notice}");
    assert!(notice.contains(&format!("\"L{}\"", depth - 33)), "the level past the limit is named: {notice}");

    // The levels within the limit reopen as Smart Objects; the one past it is pixels.
    let mut level = Engine::from_format(&psd).unwrap();
    for _ in 0..MAX_NESTED_SMART_EXPORT_DEPTH {
        let so = smart_layer(&level);
        level = nested_document(&mut level, so);
    }
    assert!(level.layers.iter().all(|layer| layer.kind != 7), "past the limit the contents are pixels");

    // Edit Contents and its commit each touch one level, however deep the chain.
    let mut top = nested_chain(depth);
    let so = smart_layer(&top);
    let nested = nested_document(&mut top, so);
    assert!(top.replace_smart_object_document(so, &nested.save_project()));
    let mut shallow = nested_chain(3);
    assert!(shallow.export_psd().is_ok());
    assert!(shallow.photoshop_export_notice().is_empty(), "nothing to say within the limit");
}

#[test]
fn contents_that_cannot_be_written_refuse_the_export_as_the_top_level_does() {
    let mut parent = placed_parent();
    let so = smart_layer(&parent);
    let mut nested = nested_document(&mut parent, so);
    let text = type_layer(&nested);
    // A 31-value Blend If payload has no Photoshop representation, so the
    // contents cannot be written — the same refusal the top level gives.
    nested.set_layer_blend_if(text, &[0.5; 31]);
    let top_level = nested.export_psd().expect_err("the same layer refuses at the top level");
    assert!(parent.replace_smart_object_document(so, &nested.save_project()));
    let blocks = parent.layers[parent.layer_index(so).unwrap()].psd_smart_blocks.clone();

    let error = parent.export_psd().expect_err("a save never turns the Smart Object into pixels");
    assert!(error.contains("Smart Object \"Logo\""), "{error}");
    assert!(error.ends_with(&top_level), "the reason is the top-level one: {error}");
    assert_eq!(parent.last_edit_error, error);
    assert_eq!(parent.layers[parent.layer_index(so).unwrap()].psd_smart_blocks, blocks);
}

#[test]
fn cmyk_contents_edit_as_rgb_and_say_so() {
    let mut ink = Engine::new(40, 20);
    ink.add_layer("Ink");
    ink.select_rect(5, 5, 10, 6, 0);
    ink.fill_selection(220, 30, 30, 255);
    let cmyk = ink.export_psd_cmyk();
    assert_eq!(photoshop_header(&cmyk).unwrap().mode, 4);
    let mut parent = Engine::from_format(&placed_parent().export_psd().unwrap()).unwrap();
    let so = smart_layer(&parent);
    let id = parent.layers[parent.layer_index(so).unwrap()].smart_link.clone().unwrap().id;
    parent.psd_linked_blocks =
        monet_format::import::psd_linked_blocks_with_file(&parent.psd_linked_blocks, &id, "", *b"8BPS", &cmyk);

    let mut nested = nested_document(&mut parent, so);
    assert_eq!(nested.mode, 0, "edited as RGB, as a top-level CMYK open is");
    assert!(parent.last_edit_error.contains("a CMYK document"), "{}", parent.last_edit_error);
    parent.last_edit_error.clear();
    // Untouched, the CMYK record goes back out as it came.
    let untouched = Engine::from_format(&parent.export_psd().unwrap()).unwrap();
    assert_eq!(untouched.psd_linked_blocks, parent.psd_linked_blocks);
    assert!(parent.photoshop_export_notice().is_empty());

    nested.add_layer("Edit");
    nested.select_rect(20, 5, 10, 6, 0);
    nested.fill_selection(30, 60, 220, 255);
    assert!(parent.replace_smart_object_document(so, &nested.save_project()));
    let psd = parent.export_psd().unwrap();
    let notice = parent.photoshop_export_notice();
    assert!(notice.contains("were a CMYK document and are saved as RGB"), "{notice}");
    let reopened = Engine::from_format(&psd).unwrap();
    let file = monet_format::import::psd_embedded_file(&reopened.psd_linked_blocks, &id).unwrap();
    assert_eq!(photoshop_header(file).unwrap().mode, 3);
}

// #454 made opened files keep each layer block's padding, and the check that a
// retained type block may be regenerated then compared it against the unpadded
// encoding, so editing type in any reopened PSD refused the whole save.
#[test]
fn a_reopened_vision_type_layer_saves_after_its_text_changes() {
    let mut reopened = Engine::from_format(&logo_psb()).expect("a Vision PSB with type opens");
    let text = type_layer(&reopened);
    set_type(&mut reopened, text, "Logo v2", 20, BLUE);
    let saved = reopened.export_psd().expect("the edited type saves");
    let back = Engine::from_format(&saved).unwrap();
    assert_eq!(back.layer_text(type_layer(&back)), "Logo v2");
}
