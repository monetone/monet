// A minimal, dev-only GIMP XCF writer used to generate test fixtures (GIMP is
// not available in this environment). It emits a valid pointer-graph XCF at a
// configurable version (→ 32- or 64-bit pointers) and tile compression (0 none,
// 1 GIMP per-plane RLE), with RGBA layers, group nesting (PROP_ITEM_PATH), and
// layer masks — exactly the surface the reader must handle. Shared by
// `tests/xcf.rs` (generate-in-memory + parse) and `examples/gen_xcf.rs`
// (write the committed fixture) via `#[path]`.
#![allow(dead_code)]

const PROP_END: u32 = 0;
const PROP_OPACITY: u32 = 6;
const PROP_MODE: u32 = 7;
const PROP_VISIBLE: u32 = 8;
const PROP_OFFSETS: u32 = 15;
const PROP_COMPRESSION: u32 = 17;
const PROP_GROUP_ITEM: u32 = 29;
const PROP_ITEM_PATH: u32 = 30;
const PROP_FLOAT_OPACITY: u32 = 33;

pub struct WLayer {
    pub name: String,
    pub w: u32,
    pub h: u32,
    pub x: i32,
    pub y: i32,
    pub opacity: f32,
    pub visible: bool,
    pub mode: u32,
    pub is_group: bool,
    pub item_path: Vec<u32>,
    /// w*h*4 RGBA (ignored for groups).
    pub rgba: Vec<u8>,
    /// w*h coverage, if the layer has a mask.
    pub mask: Option<Vec<u8>>,
}

struct W {
    buf: Vec<u8>,
    wide: bool,
}

impl W {
    fn u8(&mut self, v: u8) {
        self.buf.push(v);
    }
    fn u32(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_be_bytes());
    }
    fn i32(&mut self, v: i32) {
        self.buf.extend_from_slice(&v.to_be_bytes());
    }
    fn f32(&mut self, v: f32) {
        self.buf.extend_from_slice(&v.to_bits().to_be_bytes());
    }
    fn string(&mut self, s: &str) {
        if s.is_empty() {
            self.u32(0);
        } else {
            self.u32(s.len() as u32 + 1);
            self.buf.extend_from_slice(s.as_bytes());
            self.buf.push(0);
        }
    }
    fn here(&self) -> usize {
        self.buf.len()
    }
    fn ptr_slot(&mut self) -> usize {
        let pos = self.buf.len();
        let n = if self.wide { 8 } else { 4 };
        self.buf.extend(std::iter::repeat(0u8).take(n));
        pos
    }
    fn write_ptr(&mut self, v: u64) {
        if self.wide {
            self.buf.extend_from_slice(&v.to_be_bytes());
        } else {
            self.buf.extend_from_slice(&(v as u32).to_be_bytes());
        }
    }
    fn patch_ptr(&mut self, pos: usize, target: u64) {
        if self.wide {
            self.buf[pos..pos + 8].copy_from_slice(&target.to_be_bytes());
        } else {
            self.buf[pos..pos + 4].copy_from_slice(&(target as u32).to_be_bytes());
        }
    }
    fn prop_u32(&mut self, prop: u32, v: u32) {
        self.u32(prop);
        self.u32(4);
        self.u32(v);
    }
    fn prop_f32(&mut self, prop: u32, v: f32) {
        self.u32(prop);
        self.u32(4);
        self.f32(v);
    }
}

pub fn write_xcf(version: u32, compression: u8, w: u32, h: u32, layers: &[WLayer]) -> Vec<u8> {
    let wide = version >= 11;
    let mut wr = W { buf: Vec::new(), wide };

    wr.buf.extend_from_slice(b"gimp xcf ");
    if version == 0 {
        wr.buf.extend_from_slice(b"file");
    } else {
        wr.buf.extend_from_slice(format!("v{:03}", version).as_bytes());
    }
    wr.u8(0);
    wr.u32(w);
    wr.u32(h);
    wr.u32(0); // base type RGB
    if version >= 4 {
        wr.u32(150); // precision: 8-bit gamma integer
    }

    // Image property list.
    wr.u32(PROP_COMPRESSION);
    wr.u32(1);
    wr.u8(compression);
    wr.u32(PROP_END);
    wr.u32(0);

    // Layer pointer list (placeholders) + terminator.
    let mut layer_slots = Vec::with_capacity(layers.len());
    for _ in layers {
        layer_slots.push(wr.ptr_slot());
    }
    wr.write_ptr(0);
    // Channel pointer list (none).
    wr.write_ptr(0);

    for (i, l) in layers.iter().enumerate() {
        let off = wr.here() as u64;
        wr.patch_ptr(layer_slots[i], off);
        write_layer(&mut wr, compression, l);
    }
    wr.buf
}

fn write_layer(wr: &mut W, compression: u8, l: &WLayer) {
    wr.u32(l.w);
    wr.u32(l.h);
    wr.u32(1); // RGBA
    wr.string(&l.name);

    wr.prop_u32(PROP_OPACITY, (l.opacity * 255.0).round() as u32);
    wr.prop_f32(PROP_FLOAT_OPACITY, l.opacity);
    wr.prop_u32(PROP_VISIBLE, if l.visible { 1 } else { 0 });
    wr.prop_u32(PROP_MODE, l.mode);
    wr.u32(PROP_OFFSETS);
    wr.u32(8);
    wr.i32(l.x);
    wr.i32(l.y);
    if l.is_group {
        wr.u32(PROP_GROUP_ITEM);
        wr.u32(0);
    }
    if !l.item_path.is_empty() {
        wr.u32(PROP_ITEM_PATH);
        wr.u32((l.item_path.len() * 4) as u32);
        for &p in &l.item_path {
            wr.u32(p);
        }
    }
    wr.u32(PROP_END);
    wr.u32(0);

    let hslot = wr.ptr_slot();
    let mslot = wr.ptr_slot();

    // Hierarchy (groups get a degenerate 1×1).
    let (hw, hh, data) = if l.is_group {
        (1u32, 1u32, vec![0u8; 4])
    } else {
        (l.w, l.h, l.rgba.clone())
    };
    let hoff = wr.here() as u64;
    wr.patch_ptr(hslot, hoff);
    write_hierarchy(wr, compression, hw, hh, 4, &data);

    if let Some(mask) = &l.mask {
        let moff = wr.here() as u64;
        wr.patch_ptr(mslot, moff);
        write_channel(wr, compression, l.w, l.h, "mask", mask);
    } else {
        wr.patch_ptr(mslot, 0);
    }
}

fn write_channel(wr: &mut W, compression: u8, w: u32, h: u32, name: &str, coverage: &[u8]) {
    wr.u32(w);
    wr.u32(h);
    wr.string(name);
    wr.u32(PROP_END);
    wr.u32(0);
    let hslot = wr.ptr_slot();
    let hoff = wr.here() as u64;
    wr.patch_ptr(hslot, hoff);
    write_hierarchy(wr, compression, w, h, 1, coverage);
}

fn write_hierarchy(wr: &mut W, compression: u8, w: u32, h: u32, bpp: usize, interleaved: &[u8]) {
    wr.u32(w);
    wr.u32(h);
    wr.u32(bpp as u32);
    let lslot = wr.ptr_slot();
    wr.write_ptr(0); // level-pointer-list terminator (reader reads only level 0)
    let loff = wr.here() as u64;
    wr.patch_ptr(lslot, loff);
    write_level(wr, compression, w, h, bpp, interleaved);
}

fn write_level(wr: &mut W, compression: u8, w: u32, h: u32, bpp: usize, interleaved: &[u8]) {
    wr.u32(w);
    wr.u32(h);
    let wu = w as usize;
    let hu = h as usize;
    let tiles_x = wu.div_ceil(64);
    let tiles_y = hu.div_ceil(64);
    let mut tile_slots = Vec::with_capacity(tiles_x * tiles_y);
    for _ in 0..tiles_x * tiles_y {
        tile_slots.push(wr.ptr_slot());
    }
    wr.write_ptr(0); // tile-list terminator

    for ti in 0..tiles_x * tiles_y {
        let col = ti % tiles_x;
        let row = ti / tiles_x;
        let x0 = col * 64;
        let y0 = row * 64;
        let tw = 64.min(wu - x0);
        let th = 64.min(hu - y0);
        let toff = wr.here() as u64;
        wr.patch_ptr(tile_slots[ti], toff);

        // Gather the interleaved tile bytes.
        let mut tile = Vec::with_capacity(tw * th * bpp);
        for ty in 0..th {
            let src = ((y0 + ty) * wu + x0) * bpp;
            tile.extend_from_slice(&interleaved[src..src + tw * bpp]);
        }
        match compression {
            0 => wr.buf.extend_from_slice(&tile),
            1 => {
                for p in 0..bpp {
                    let plane: Vec<u8> = (0..tw * th).map(|px| tile[px * bpp + p]).collect();
                    wr.buf.extend_from_slice(&monet_format::import::gimp_rle_encode_plane(&plane));
                }
            }
            _ => wr.buf.extend_from_slice(&tile),
        }
    }
}

// ── Fixture content shared by the test and the committed-file generator ──

fn solid(w: u32, h: u32, c: [u8; 4]) -> Vec<u8> {
    let mut v = vec![0u8; (w * h * 4) as usize];
    for i in 0..(w * h) as usize {
        v[i * 4..i * 4 + 4].copy_from_slice(&c);
    }
    v
}

/// The standard fixture document: a background, a half-opacity multiply layer
/// with a gradient mask, and a group containing an offset green child.
pub fn sample_layers() -> Vec<WLayer> {
    // Gradient mask: coverage = x*16.
    let mut mask = vec![0u8; 16 * 16];
    for y in 0..16 {
        for x in 0..16 {
            mask[y * 16 + x] = (x * 16) as u8;
        }
    }
    vec![
        WLayer { name: "Group".into(), w: 8, h: 8, x: 4, y: 4, opacity: 1.0, visible: true, mode: 28, is_group: true, item_path: vec![0], rgba: vec![], mask: None },
        WLayer { name: "Child".into(), w: 8, h: 8, x: 4, y: 4, opacity: 1.0, visible: true, mode: 28, is_group: false, item_path: vec![0, 0], rgba: solid(8, 8, [0, 200, 0, 255]), mask: None },
        WLayer { name: "Red".into(), w: 16, h: 16, x: 0, y: 0, opacity: 0.5, visible: true, mode: 32 /* multiply (new enum) */, is_group: false, item_path: vec![1], rgba: solid(16, 16, [220, 20, 20, 255]), mask: Some(mask) },
        WLayer { name: "Background".into(), w: 16, h: 16, x: 0, y: 0, opacity: 1.0, visible: true, mode: 28, is_group: false, item_path: vec![2], rgba: solid(16, 16, [30, 30, 30, 255]), mask: None },
    ]
}
