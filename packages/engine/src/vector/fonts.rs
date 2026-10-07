// Runtime-provisioned vector text fonts.
// The WebAssembly engine cannot discover system fonts itself. Hosts can push
// font bytes into this registry; vector rendering then uses matching families
// for real glyph outlines and falls back to deterministic bitmap glyphs when a
// font is absent or unsuitable.

use std::cell::RefCell;

#[derive(serde::Serialize)]
pub struct FontFaceInfo {
    pub family: String,
    pub subfamily: Option<String>,
    #[serde(rename = "fullName")]
    pub full_name: Option<String>,
    #[serde(rename = "postscriptName")]
    pub postscript_name: Option<String>,
    #[serde(rename = "faceIndex")]
    pub face_index: u32,
    pub weight: f32,
    pub italic: bool,
}

#[derive(Clone)]
struct RegisteredFont {
    family_key: String,
    face_keys: Vec<String>,
    bytes: Vec<u8>,
    face_index: u32,
    weight: f32,
    italic: bool,
}

pub struct RegisteredFontFace<'a> {
    pub face: ttf_parser::Face<'a>,
    pub bytes: &'a [u8],
    pub face_index: u32,
    pub weight: f32,
    pub italic: bool,
}

// Thread-local: in the browser/WASM host all Engine instances run on the main
// thread and share this registry (what refresh/clear assume). A native
// multi-threaded host would get one registry per thread and must register fonts
// on each thread that renders vector text.
thread_local! {
    static VECTOR_FONTS: RefCell<Vec<RegisteredFont>> = const { RefCell::new(Vec::new()) };
}

pub fn register_font(family: &str, bytes: &[u8], face_index: u32) -> Result<(), String> {
    register_font_face(family, bytes, face_index, 400.0, false)
}

pub fn register_font_face(
    family: &str,
    bytes: &[u8],
    face_index: u32,
    weight: f32,
    italic: bool,
) -> Result<(), String> {
    let key = family_key(family).ok_or_else(|| "font family is empty".to_string())?;
    let face = ttf_parser::Face::parse(bytes, face_index).map_err(|e| format!("font parse failed: {e:?}"))?;
    let face_keys: Vec<_> = [face_name(&face, &[6]), face_name(&face, &[4])]
        .into_iter().flatten()
        .flat_map(|name| [format!("Monet face:{name}"), name])
        .filter_map(|name| family_key(&name)).collect();
    let weight = normalize_weight(weight);

    VECTOR_FONTS.with(|fonts| {
        let mut fonts = fonts.borrow_mut();
        if let Some(existing) = fonts.iter_mut().find(|font| {
            font.family_key == key
                && font.face_keys == face_keys
                && font.face_index == face_index
                && (font.weight - weight).abs() < f32::EPSILON
                && font.italic == italic
        }) {
            existing.bytes.clear();
            existing.bytes.extend_from_slice(bytes);
        } else {
            fonts.push(RegisteredFont {
                family_key: key,
                face_keys,
                bytes: bytes.to_vec(),
                face_index,
                weight,
                italic,
            });
        }
    });
    Ok(())
}

pub fn clear_fonts() {
    VECTOR_FONTS.with(|fonts| fonts.borrow_mut().clear());
}

pub fn inspect_font_faces(bytes: &[u8]) -> Result<Vec<FontFaceInfo>, String> {
    let count = ttf_parser::fonts_in_collection(bytes).unwrap_or(1);
    if count == 0 {
        return Err("font collection has no faces".to_string());
    }

    let mut faces = Vec::new();
    for face_index in 0..count.min(256) {
        let Ok(face) = ttf_parser::Face::parse(bytes, face_index) else {
            continue;
        };
        let family = face_name(&face, &[16, 1, 4])
            .unwrap_or_else(|| format!("Untitled Font {}", face_index + 1));
        faces.push(FontFaceInfo {
            family,
            subfamily: face_name(&face, &[17, 2]),
            full_name: face_name(&face, &[4]),
            postscript_name: face_name(&face, &[6]),
            face_index,
            weight: face.weight().to_number() as f32,
            italic: face.is_italic(),
        });
    }

    if faces.is_empty() {
        Err("font parse failed: no readable faces".to_string())
    } else {
        Ok(faces)
    }
}

pub fn with_face<R>(
    family_list: &str,
    mut f: impl FnMut(&ttf_parser::Face<'_>) -> Option<R>,
) -> Option<R> {
    with_font(family_list, |font| f(&font.face))
}

pub fn with_font<R>(
    family_list: &str,
    mut f: impl FnMut(RegisteredFontFace<'_>) -> Option<R>,
) -> Option<R> {
    with_font_for_style(family_list, 400.0, false, |font| f(font))
}

pub fn with_font_for_style<R>(
    family_list: &str,
    weight: f32,
    italic: bool,
    mut f: impl FnMut(RegisteredFontFace<'_>) -> Option<R>,
) -> Option<R> {
    let keys = family_keys(family_list);
    if keys.is_empty() {
        return None;
    }
    let weight = normalize_weight(weight);

    VECTOR_FONTS.with(|fonts| {
        let fonts = fonts.borrow();
        for key in &keys {
            let mut candidates = fonts
                .iter()
                .enumerate()
                .filter(|(_, font)| &font.family_key == key || font.face_keys.contains(key))
                .collect::<Vec<_>>();
            candidates.sort_by(|(a_index, a), (b_index, b)| {
                style_score(a, weight, italic)
                    .partial_cmp(&style_score(b, weight, italic))
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| b_index.cmp(a_index))
            });

            for (_, font) in candidates {
                if let Ok(face) = ttf_parser::Face::parse(&font.bytes, font.face_index) {
                    if let Some(out) = f(RegisteredFontFace {
                        face,
                        bytes: &font.bytes,
                        face_index: font.face_index,
                        weight: font.weight,
                        italic: font.italic,
                    }) {
                        return Some(out);
                    }
                }
            }
        }
        None
    })
}

fn normalize_weight(weight: f32) -> f32 {
    if weight.is_finite() {
        weight.clamp(1.0, 1000.0)
    } else {
        400.0
    }
}

fn style_score(font: &RegisteredFont, weight: f32, italic: bool) -> f32 {
    let italic_penalty = if font.italic == italic { 0.0 } else { 1000.0 };
    italic_penalty + (font.weight - weight).abs()
}

fn face_name(face: &ttf_parser::Face<'_>, name_ids: &[u16]) -> Option<String> {
    let mut fallback = None;
    for name_id in name_ids {
        for name in face.names() {
            if name.name_id != *name_id {
                continue;
            }
            // One name table mixes encodings, and Apple's fonts lead with
            // Macintosh records. A record we cannot read is skipped, never a
            // reason to abandon the name we already have — giving up here
            // reported "Untitled Font N" for most of a macOS font set.
            let Some(value) = name_text(&name).and_then(clean_font_name) else {
                continue;
            };
            if name.language_id == 0x0409 {
                return Some(value);
            }
            fallback.get_or_insert(value);
        }
        if fallback.is_some() {
            break;
        }
    }
    fallback
}

/// Mac Roman's upper half (0x80-0xFF), in order; 0xF0 is Apple's logo (U+F8FF).
/// Keep this identical to MAC_ROMAN in vector/testdata/gen_fonts.mjs.
const MAC_ROMAN_HIGH: &str = "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\u{a0}ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\u{f8ff}ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";

/// A name record's text. ttf-parser decodes the Unicode encodings and returns
/// `None` for everything else; Macintosh Roman (platform 1, encoding 0) is the
/// one that matters in practice, since Apple's system fonts store — and some
/// store *only* — their family names there.
fn name_text(name: &ttf_parser::name::Name<'_>) -> Option<String> {
    if let Some(text) = name.to_string() {
        return Some(text);
    }
    if name.platform_id != ttf_parser::PlatformId::Macintosh || name.encoding_id != 0 {
        return None;
    }
    name.name
        .iter()
        .map(|&byte| match byte {
            0..=0x7f => Some(byte as char),
            _ => MAC_ROMAN_HIGH.chars().nth((byte - 0x80) as usize),
        })
        .collect()
}

fn clean_font_name(value: String) -> Option<String> {
    let value = value.trim().replace('\0', "");
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn family_keys(family_list: &str) -> Vec<String> {
    family_list.split(',').filter_map(family_key).collect()
}

fn family_key(family: &str) -> Option<String> {
    let family = family
        .trim()
        .trim_matches(|ch| ch == '"' || ch == '\'')
        .trim();
    if family.is_empty() {
        None
    } else {
        Some(family.to_lowercase())
    }
}

#[cfg(test)]
mod named_face_tests {
    use super::*;

    #[test]
    fn same_family_weight_and_index_keep_distinct_named_faces() {
        let regular = include_bytes!("testdata/named_font.ttf");
        let mut alternate = regular.to_vec();
        let name = alternate.windows(9).position(|bytes| bytes == b"MacOnlyPS").unwrap();
        alternate[name..name + 9].copy_from_slice(b"OtherFace");
        // Give the second face a measurably different advance, without changing
        // its family, declared weight or collection index.
        let tables = u16::from_be_bytes(alternate[4..6].try_into().unwrap()) as usize;
        let record = (0..tables).map(|i| 12 + i * 16)
            .find(|&i| &alternate[i..i + 4] == b"hmtx").unwrap();
        let table = u32::from_be_bytes(alternate[record + 8..record + 12].try_into().unwrap()) as usize;
        alternate[table + 4..table + 6].copy_from_slice(&900u16.to_be_bytes());
        clear_fonts();
        register_font_face("Mac Family", regular, 0, 700.0, false).unwrap();
        register_font_face("Mac Family", &alternate, 0, 700.0, false).unwrap();
        let advance = |name| with_font_for_style(name, 700.0, false, |font| {
            font.face.glyph_hor_advance(font.face.glyph_index('A')?)
        });
        assert_eq!(advance("\"Monet face:MacOnlyPS\", \"Mac Family\""), Some(600));
        assert_eq!(advance("\"Monet face:OtherFace\", \"Mac Family\""), Some(900));
        // Registering again refreshes that face, while preserving its sibling.
        register_font_face("Mac Family", &alternate, 0, 700.0, false).unwrap();
        assert_eq!(advance("MacOnlyPS"), Some(600));
        assert_eq!(advance("OtherFace"), Some(900));
        clear_fonts();
    }
}

#[cfg(test)]
pub(crate) fn demo_font_bytes() -> &'static [u8] {
    // Tiny demo TrueType fixture from ttf-parser's own test corpus (MIT/Apache-2.0).
    &[
        0, 1, 0, 0, 0, 7, 0, 64, 0, 2, 0, 48, 99, 109, 97, 112, 0, 9, 0, 118, 0, 0, 1, 0, 0, 0, 0,
        44, 103, 108, 121, 102, 241, 203, 102, 152, 0, 0, 1, 52, 0, 0, 0, 92, 104, 101, 97, 100,
        242, 53, 221, 248, 0, 0, 0, 124, 0, 0, 0, 54, 104, 104, 101, 97, 6, 97, 0, 202, 0, 0, 0,
        180, 0, 0, 0, 36, 104, 109, 116, 120, 4, 116, 0, 106, 0, 0, 0, 248, 0, 0, 0, 8, 108, 111,
        99, 97, 0, 46, 0, 20, 0, 0, 1, 44, 0, 0, 0, 6, 109, 97, 120, 112, 0, 5, 0, 11, 0, 0, 0,
        216, 0, 0, 0, 32, 0, 1, 0, 0, 0, 1, 0, 0, 245, 156, 41, 68, 95, 15, 60, 245, 0, 2, 3, 232,
        0, 0, 0, 0, 180, 146, 244, 0, 0, 0, 0, 0, 220, 47, 166, 92, 0, 6, 0, 0, 2, 88, 2, 188, 0,
        0, 0, 3, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 4, 0, 254, 112, 0, 0, 2, 88, 0, 6, 255, 255,
        2, 88, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 0, 0, 0, 2, 0, 11, 0, 2,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 88, 0, 100, 2, 28, 0,
        6, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 0, 12, 0, 4, 0, 32, 0, 0, 0, 4, 0, 4, 0, 1, 0, 0, 0, 65,
        255, 255, 0, 0, 0, 65, 255, 255, 255, 192, 0, 1, 0, 0, 0, 0, 0, 0, 0, 20, 0, 46, 0, 0, 0,
        2, 0, 100, 0, 0, 2, 88, 2, 188, 0, 3, 0, 7, 0, 0, 51, 17, 33, 17, 37, 33, 17, 33, 100, 1,
        244, 254, 52, 1, 164, 254, 92, 2, 188, 253, 68, 40, 2, 108, 0, 2, 0, 6, 0, 0, 2, 29, 2,
        144, 0, 2, 0, 10, 0, 0, 19, 51, 3, 1, 19, 51, 19, 35, 39, 35, 7, 173, 196, 99, 254, 248,
        218, 96, 221, 89, 62, 239, 66, 1, 11, 1, 64, 253, 181, 2, 144, 253, 112, 200, 200, 0,
    ]
}
