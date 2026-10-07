//! Bounded classic-TIFF DNG inspection for managed originals and derivatives.
//! Distribution notice: `apps/galerie/DNG-NOTICE.md`.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

pub const STREAM_BUFFER: usize = 1024 * 1024;
/// A semantic revision for the DNG classify/publish/write core, distinct
/// from `CARGO_PKG_VERSION` (which tracks the whole crate, including
/// unrelated code) and distinct from `raw_decode::BACKEND_REVISION` (which
/// tracks the RAW *decoder*, not the DNG container logic). Bump this when
/// classification, managed-transaction, or Linear DNG writer semantics
/// change in a way that could affect prior evidence/provenance.
pub const CORE_REVISION: &str = "monet-galerie-dng-core-1";
const MAX_IFDS: usize = 256;
const MAX_DEPTH: usize = 8;
const MAX_ENTRIES_PER_IFD: usize = 4096;
const MAX_TOTAL_ENTRIES: usize = 16_384;
const MAX_SUBIFDS: usize = 64;
const MAX_CHUNKS: usize = 131_072;
const MAX_CFA_CELLS: usize = 256;
const MAX_PRIVATE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ByteOrder {
    LittleEndian,
    BigEndian,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DngClass {
    Cfa,
    LinearRaw,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEvidence {
    pub kind: String,
    pub chunk_count: usize,
    pub total_bytes: u64,
    pub first_offset: u64,
    pub last_end: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateDataEvidence {
    pub ifd_path: String,
    pub field_type: u16,
    pub count: u32,
    pub value_bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DngEvidence {
    pub byte_order: ByteOrder,
    pub dng_version: Option<[u8; 4]>,
    pub backward_version: Option<[u8; 4]>,
    pub selected_ifd_path: String,
    pub selected_ifd_offset: u32,
    pub class: DngClass,
    pub width: u32,
    pub height: u32,
    pub bits_per_sample: Vec<u16>,
    pub samples_per_pixel: u16,
    pub sample_format: Vec<u16>,
    pub photometric: u16,
    pub new_subfile_type: u32,
    pub orientation: u16,
    pub cfa_dimensions: Option<[u16; 2]>,
    pub cfa_pattern: Option<Vec<u8>>,
    pub storage: StorageEvidence,
    pub private_data: Vec<PrivateDataEvidence>,
}

#[derive(Clone)]
struct Entry {
    typ: u16,
    count: u32,
    raw: [u8; 4],
    value_offset: u64,
    value_len: u64,
}

struct Parser<'a> {
    file: &'a mut File,
    len: u64,
    order: ByteOrder,
    seen: HashSet<u32>,
    ranges: Vec<(u64, u64)>,
    entries: usize,
    candidates: Vec<Candidate>,
    private: Vec<PrivateDataEvidence>,
    private_bytes: u64,
    dng_version: Option<[u8; 4]>,
    backward_version: Option<[u8; 4]>,
}

#[derive(Clone)]
struct Candidate {
    path: String,
    offset: u32,
    class: DngClass,
    width: u32,
    height: u32,
    bits: Vec<u16>,
    samples: u16,
    formats: Vec<u16>,
    photometric: u16,
    new_subfile: u32,
    orientation: u16,
    cfa_dims: Option<[u16; 2]>,
    cfa_pattern: Option<Vec<u8>>,
    storage: StorageEvidence,
}

fn type_size(typ: u16) -> Option<u64> {
    Some(match typ {
        1 | 2 | 6 | 7 => 1,
        3 | 8 => 2,
        4 | 9 | 11 | 13 => 4,
        5 | 10 | 12 => 8,
        _ => return None,
    })
}

impl Parser<'_> {
    fn u16(&self, b: &[u8]) -> u16 {
        match self.order {
            ByteOrder::LittleEndian => u16::from_le_bytes([b[0], b[1]]),
            ByteOrder::BigEndian => u16::from_be_bytes([b[0], b[1]]),
        }
    }
    fn u32(&self, b: &[u8]) -> u32 {
        match self.order {
            ByteOrder::LittleEndian => u32::from_le_bytes(b[..4].try_into().unwrap()),
            ByteOrder::BigEndian => u32::from_be_bytes(b[..4].try_into().unwrap()),
        }
    }
    fn read_at(&mut self, offset: u64, len: usize) -> Result<Vec<u8>, String> {
        let end = offset.checked_add(len as u64).ok_or("DNG range overflow")?;
        if end > self.len {
            return Err("DNG value is outside the file".into());
        }
        self.file
            .seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
        let mut out = vec![0; len];
        self.file.read_exact(&mut out).map_err(|e| e.to_string())?;
        Ok(out)
    }
    fn bytes(&mut self, e: &Entry) -> Result<Vec<u8>, String> {
        if e.value_len <= 4 {
            Ok(e.raw[..e.value_len as usize].to_vec())
        } else {
            self.read_at(
                e.value_offset,
                usize::try_from(e.value_len).map_err(|_| "DNG value too large")?,
            )
        }
    }
    fn uints(&mut self, e: &Entry) -> Result<Vec<u32>, String> {
        let b = self.bytes(e)?;
        let n = e.count as usize;
        let mut out = Vec::with_capacity(n);
        match e.typ {
            1 | 6 | 7 => out.extend(b.iter().take(n).map(|v| *v as u32)),
            3 | 8 => {
                for c in b.chunks_exact(2).take(n) {
                    out.push(self.u16(c) as u32)
                }
            }
            4 | 9 | 13 => {
                for c in b.chunks_exact(4).take(n) {
                    out.push(self.u32(c))
                }
            }
            _ => return Err("DNG tag requires an integer field type".into()),
        }
        Ok(out)
    }
    fn one(
        &mut self,
        tags: &HashMap<u16, Entry>,
        tag: u16,
        default: Option<u32>,
    ) -> Result<u32, String> {
        match tags.get(&tag) {
            Some(e) => {
                // Preflight arity before allocating: a scalar tag must
                // declare exactly one value. Checking `e.count` (free,
                // already-parsed directory metadata) before calling
                // `uints()` (which allocates `count` elements) stops a
                // hostile huge declared count from ever being materialized
                // for a tag whose only valid shape is a single value.
                if e.count != 1 {
                    return Err(format!("DNG tag {tag} must contain one value"));
                }
                Ok(self.uints(e)?[0])
            }
            None => default.ok_or_else(|| format!("DNG tag {tag} is required")),
        }
    }
    fn parse_ifd(
        &mut self,
        offset: u32,
        path: String,
        depth: usize,
        is_sub: bool,
        inherited_orientation: Option<u32>,
        capture_version: bool,
    ) -> Result<u32, String> {
        if depth > MAX_DEPTH {
            return Err("DNG SubIFD depth limit exceeded".into());
        }
        if self.seen.len() >= MAX_IFDS || !self.seen.insert(offset) {
            return Err("duplicate or cyclic DNG IFD offset".into());
        }
        let head = self.read_at(offset as u64, 2)?;
        let count = self.u16(&head) as usize;
        if count > MAX_ENTRIES_PER_IFD
            || self
                .entries
                .checked_add(count)
                .ok_or("DNG entry count overflow")?
                > MAX_TOTAL_ENTRIES
        {
            return Err("DNG IFD entry limit exceeded".into());
        }
        self.entries += count;
        let dir_len = 2u64
            .checked_add(
                (count as u64)
                    .checked_mul(12)
                    .ok_or("DNG directory overflow")?,
            )
            .and_then(|v| v.checked_add(4))
            .ok_or("DNG directory overflow")?;
        let end = (offset as u64)
            .checked_add(dir_len)
            .ok_or("DNG directory overflow")?;
        if end > self.len {
            return Err("DNG directory outside file".into());
        }
        if self
            .ranges
            .iter()
            .any(|(a, b)| (offset as u64) < *b && end > *a)
        {
            return Err("overlapping DNG directories".into());
        }
        self.ranges.push((offset as u64, end));
        let raw = self.read_at(offset as u64 + 2, count * 12 + 4)?;
        let mut tags = HashMap::new();
        for chunk in raw[..count * 12].chunks_exact(12) {
            let tag = self.u16(chunk);
            let typ = self.u16(&chunk[2..]);
            let n = self.u32(&chunk[4..]);
            let size = type_size(typ).ok_or_else(|| format!("unknown DNG field type {typ}"))?;
            let len = (n as u64)
                .checked_mul(size)
                .ok_or("DNG field length overflow")?;
            let mut repr = [0; 4];
            repr.copy_from_slice(&chunk[8..12]);
            let value_offset = if len <= 4 {
                offset as u64 + 2 + (tags.len() as u64) * 12 + 8
            } else {
                self.u32(&repr) as u64
            };
            if len > 4 && value_offset.checked_add(len).ok_or("DNG value overflow")? > self.len {
                return Err("DNG value outside file".into());
            }
            if tags
                .insert(
                    tag,
                    Entry {
                        typ,
                        count: n,
                        raw: repr,
                        value_offset,
                        value_len: len,
                    },
                )
                .is_some()
            {
                return Err(format!("duplicate DNG tag {tag}"));
            }
        }
        let next = self.u32(&raw[count * 12..]);
        if is_sub && next != 0 {
            return Err("SubIFD next chains are unsupported".into());
        }
        // Version evidence is tied deterministically to the root IFD[0]
        // alone (where Adobe's spec requires it to live), never to whatever
        // IFD traversal happens to visit last: SubIFDs and any later
        // root-chain entry never set it, so it cannot be silently
        // overwritten during depth-first traversal. `value_len` (free,
        // already-parsed) is checked before `bytes()` allocates.
        if capture_version {
            if let Some(e) = tags.get(&50706) {
                if e.value_len == 4 {
                    let b = self.bytes(e)?;
                    self.dng_version = Some(b.try_into().unwrap())
                }
            }
            if let Some(e) = tags.get(&50707) {
                if e.value_len == 4 {
                    let b = self.bytes(e)?;
                    self.backward_version = Some(b.try_into().unwrap())
                }
            }
        }
        if let Some(e) = tags.get(&50740) {
            self.private_bytes = self
                .private_bytes
                .checked_add(e.value_len)
                .ok_or("private-data length overflow")?;
            if self.private_bytes > MAX_PRIVATE_BYTES {
                return Err("DNG private-data digest limit exceeded".into());
            }
            let mut hash = Sha256::new();
            if e.value_len <= 4 {
                hash.update(&e.raw[..e.value_len as usize])
            } else {
                self.file
                    .seek(SeekFrom::Start(e.value_offset))
                    .map_err(|e| e.to_string())?;
                let mut left = e.value_len;
                let mut buf = vec![0; STREAM_BUFFER];
                while left > 0 {
                    let n = usize::try_from(left.min(STREAM_BUFFER as u64)).unwrap();
                    self.file
                        .read_exact(&mut buf[..n])
                        .map_err(|e| e.to_string())?;
                    hash.update(&buf[..n]);
                    left -= n as u64
                }
            }
            self.private.push(PrivateDataEvidence {
                ifd_path: path.clone(),
                field_type: e.typ,
                count: e.count,
                value_bytes: e.value_len,
                sha256: format!("{:x}", hash.finalize()),
            });
        }
        self.classify(&path, offset, &tags, inherited_orientation)?;
        let orientation = match tags.get(&274) {
            Some(entry) => {
                if entry.count != 1 {
                    return Err("invalid DNG orientation".into());
                }
                self.uints(entry)?.first().copied()
            }
            None => inherited_orientation,
        };
        if let Some(e) = tags.get(&330) {
            // Preflight the SubIFD count against the fixed limit before
            // `uints()` allocates a `count`-sized buffer.
            if e.count as usize > MAX_SUBIFDS {
                return Err("DNG SubIFD count limit exceeded".into());
            }
            let subs = self.uints(e)?;
            for (i, sub) in subs.into_iter().enumerate() {
                if sub == 0 {
                    return Err("zero DNG SubIFD offset".into());
                }
                self.parse_ifd(
                    sub,
                    format!("{path}/subifd[{i}]"),
                    depth + 1,
                    true,
                    orientation,
                    false,
                )?;
            }
        }
        Ok(next)
    }
    fn classify(
        &mut self,
        path: &str,
        offset: u32,
        t: &HashMap<u16, Entry>,
        inherited_orientation: Option<u32>,
    ) -> Result<(), String> {
        let Some(pe) = t.get(&262) else { return Ok(()) };
        // Preflight arity before allocating (see `one()`).
        if pe.count != 1 {
            return Err("invalid DNG photometric tag".into());
        }
        let photo = u16::try_from(self.uints(pe)?[0]).map_err(|_| "invalid DNG photometric tag")?;
        if photo != 32803 && photo != 34892 {
            // A raw-looking CFA tag paired with a non-raw photometric is a
            // contradiction, not something to silently ignore.
            if t.contains_key(&33421) || t.contains_key(&33422) {
                return Err("CFA tags present on non-raw DNG photometric".into());
            }
            return Ok(());
        }
        let width = self.one(t, 256, None)?;
        let height = self.one(t, 257, None)?;
        if width == 0 || height == 0 {
            return Err("zero DNG dimensions".into());
        }
        let raw_orientation = match t.get(&274) {
            Some(entry) => {
                if entry.count != 1 {
                    return Err("invalid DNG orientation".into());
                }
                self.uints(entry)?[0]
            }
            None => inherited_orientation.ok_or("DNG tag 274 is required")?,
        };
        // Range-check the widened value before narrowing, so an
        // out-of-range value can never wrap into an accepted byte.
        if !(1..=8).contains(&raw_orientation) {
            return Err("invalid DNG orientation".into());
        }
        let orientation = raw_orientation as u16;
        let samples =
            u16::try_from(self.one(t, 277, Some(1))?).map_err(|_| "invalid DNG SamplesPerPixel")?;
        if samples == 0 {
            return Err("zero DNG samples per pixel".into());
        }
        let bits_entry = t.get(&258).ok_or("DNG BitsPerSample is required")?;
        // Preflight arity (1 or exactly `samples`) before `uints()`
        // allocates a `count`-sized buffer.
        if bits_entry.count != 1 && bits_entry.count != samples as u32 {
            return Err("invalid DNG BitsPerSample".into());
        }
        let bits = self
            .uints(bits_entry)?
            .into_iter()
            .map(|v| u16::try_from(v).map_err(|_| "invalid DNG sample depth"))
            .collect::<Result<Vec<_>, _>>()?;
        if bits.is_empty() || bits.iter().any(|b| *b == 0 || *b > 64) {
            return Err("invalid DNG BitsPerSample".into());
        }
        let formats = match t.get(&339) {
            Some(e) => {
                if e.count != 1 && e.count != samples as u32 {
                    return Err("invalid DNG SampleFormat".into());
                }
                self.uints(e)?
                    .into_iter()
                    .map(|v| u16::try_from(v).map_err(|_| "invalid sample format"))
                    .collect::<Result<Vec<_>, _>>()?
            }
            None => vec![1],
        };
        if formats.is_empty() || formats.iter().any(|v| !matches!(v, 1..=3)) {
            return Err("invalid DNG SampleFormat".into());
        }
        let strip = t.get(&273).zip(t.get(&279));
        let tile = t.get(&324).zip(t.get(&325));
        if strip.is_some() == tile.is_some() {
            return Err("DNG requires exactly one strip or tile storage layout".into());
        }
        let (kind, oe, ce) = strip.map(|(a, b)| ("strip", a, b)).unwrap_or_else(|| {
            let (a, b) = tile.unwrap();
            ("tile", a, b)
        });
        // Preflight the declared chunk counts against the fixed limit, and
        // against each other, before `uints()` allocates two buffers.
        if oe.count == 0 || oe.count as usize > MAX_CHUNKS || oe.count != ce.count {
            return Err("invalid DNG image chunk arrays".into());
        }
        let offs = self.uints(oe)?;
        let counts = self.uints(ce)?;
        let mut total = 0u64;
        let mut ranges: Vec<(u64, u64)> = Vec::with_capacity(offs.len());
        for (&o, &n) in offs.iter().zip(&counts) {
            let end = (o as u64)
                .checked_add(n as u64)
                .ok_or("DNG image chunk overflow")?;
            if n == 0 || end > self.len {
                return Err("DNG image chunk outside file".into());
            }
            total = total
                .checked_add(n as u64)
                .ok_or("DNG image byte count overflow")?;
            ranges.push((o as u64, end));
        }
        ranges.sort_unstable();
        if ranges.windows(2).any(|w| w[1].0 < w[0].1) {
            return Err("overlapping DNG image chunks".into());
        }
        let first = ranges.first().map(|r| r.0).unwrap_or(u64::MAX);
        let last = ranges.iter().map(|r| r.1).max().unwrap_or(0);
        // Geometry contradiction: declared storage must be able to hold at
        // least one whole image at the declared width/height/samples/bits —
        // all in checked u64, so an attacker-chosen width/height pair near
        // u32::MAX cannot overflow this (or the later selection-scoring)
        // arithmetic instead of being rejected outright.
        let bits_min = *bits.iter().min().unwrap() as u64;
        let per_row_bits = (width as u64)
            .checked_mul(samples as u64)
            .and_then(|v| v.checked_mul(bits_min))
            .ok_or("DNG geometry overflow")?;
        let per_row_bytes = per_row_bits.checked_add(7).ok_or("DNG geometry overflow")? / 8;
        let min_total_bytes = per_row_bytes
            .checked_mul(height as u64)
            .ok_or("DNG geometry overflow")?;
        if total < min_total_bytes {
            return Err("DNG storage size contradicts declared geometry".into());
        }
        let cfa_dims = match t.get(&33421) {
            Some(e) => {
                if e.count != 2 {
                    return Err("invalid CFA dimensions".into());
                }
                let v = self.uints(e)?;
                Some([
                    u16::try_from(v[0]).map_err(|_| "invalid CFA dimensions")?,
                    u16::try_from(v[1]).map_err(|_| "invalid CFA dimensions")?,
                ])
            }
            None => None,
        };
        let cfa_pattern_entry = t.get(&33422);
        let (class, cfa_pattern) = if photo == 32803 {
            let d = cfa_dims.ok_or("CFA DNG lacks CFARepeatPatternDim")?;
            let cells = (d[0] as usize)
                .checked_mul(d[1] as usize)
                .ok_or("CFA dimensions overflow")?;
            if cells == 0 || cells > MAX_CFA_CELLS {
                return Err("CFA pattern contradicts dimensions".into());
            }
            let pattern_entry = cfa_pattern_entry.ok_or("CFA DNG lacks CFAPattern")?;
            // Preflight the pattern's declared byte length against the
            // exact expected cell count before `bytes()` allocates.
            if pattern_entry.value_len != cells as u64 {
                return Err("CFA pattern contradicts dimensions".into());
            }
            (DngClass::Cfa, Some(self.bytes(pattern_entry)?))
        } else {
            if cfa_dims.is_some() || cfa_pattern_entry.is_some() {
                return Err("LinearRaw DNG contains CFA tags".into());
            }
            (DngClass::LinearRaw, None)
        };
        let new_subfile = self.one(t, 254, Some(0))?;
        self.candidates.push(Candidate {
            path: path.into(),
            offset,
            class,
            width,
            height,
            bits,
            samples,
            formats,
            photometric: photo,
            new_subfile,
            orientation,
            cfa_dims,
            cfa_pattern,
            storage: StorageEvidence {
                kind: kind.into(),
                chunk_count: offs.len(),
                total_bytes: total,
                first_offset: first,
                last_end: last,
            },
        });
        Ok(())
    }
}

pub fn classify(file: &mut File) -> Result<DngEvidence, String> {
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    if len < 8 || len > u32::MAX as u64 {
        return Err("DNG must be bounded classic TIFF".into());
    }
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut h = [0; 8];
    file.read_exact(&mut h).map_err(|e| e.to_string())?;
    let order = match &h[..2] {
        b"II" => ByteOrder::LittleEndian,
        b"MM" => ByteOrder::BigEndian,
        _ => return Err("invalid TIFF byte order".into()),
    };
    let magic = match order {
        ByteOrder::LittleEndian => u16::from_le_bytes([h[2], h[3]]),
        ByteOrder::BigEndian => u16::from_be_bytes([h[2], h[3]]),
    };
    if magic == 43 {
        return Err("BigTIFF DNG is unsupported".into());
    }
    if magic != 42 {
        return Err("invalid classic TIFF magic".into());
    }
    let first = match order {
        ByteOrder::LittleEndian => u32::from_le_bytes(h[4..8].try_into().unwrap()),
        ByteOrder::BigEndian => u32::from_be_bytes(h[4..8].try_into().unwrap()),
    };
    if first == 0 {
        return Err("DNG has no IFD".into());
    }
    let mut p = Parser {
        file,
        len,
        order,
        seen: HashSet::new(),
        ranges: vec![],
        entries: 0,
        candidates: vec![],
        private: vec![],
        private_bytes: 0,
        dng_version: None,
        backward_version: None,
    };
    let mut root = first;
    let mut i = 0;
    while root != 0 {
        // Only IFD[0] — the true root — may set version evidence; later
        // root-chain entries and every SubIFD leave it untouched.
        root = p.parse_ifd(root, format!("ifd[{i}]"), 0, false, None, i == 0)?;
        i += 1
    }
    let mut paths = BTreeSet::new();
    if p.candidates.iter().any(|c| !paths.insert(c.path.clone())) {
        return Err("duplicate DNG traversal path".into());
    }
    let c = p
        .candidates
        .into_iter()
        .max_by(|a, b| {
            let sa = (
                a.new_subfile == 0,
                (a.width as u64).saturating_mul(a.height as u64),
                *a.bits.iter().min().unwrap(),
                a.samples,
            );
            let sb = (
                b.new_subfile == 0,
                (b.width as u64).saturating_mul(b.height as u64),
                *b.bits.iter().min().unwrap(),
                b.samples,
            );
            sa.cmp(&sb).then_with(|| b.path.cmp(&a.path))
        })
        .ok_or("DNG contains no valid raw IFD")?;
    Ok(DngEvidence {
        byte_order: order,
        dng_version: p.dng_version,
        backward_version: p.backward_version,
        selected_ifd_path: c.path,
        selected_ifd_offset: c.offset,
        class: c.class,
        width: c.width,
        height: c.height,
        bits_per_sample: c.bits,
        samples_per_pixel: c.samples,
        sample_format: c.formats,
        photometric: c.photometric,
        new_subfile_type: c.new_subfile,
        orientation: c.orientation,
        cfa_dimensions: c.cfa_dims,
        cfa_pattern: c.cfa_pattern,
        storage: c.storage,
        private_data: p.private,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixture_1022() {
        let path = "target/raw-fixtures/dng-mosaic-canon-5d3.DNG";
        // Exact full-file bytes and SHA-256 — not merely "a fixture exists."
        let mut file = File::open(path).expect("fixture 1022 must be acquired before tests");
        let mut hash = Sha256::new();
        let mut bytes = 0u64;
        let mut buf = vec![0u8; STREAM_BUFFER];
        loop {
            let n = file.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            bytes += n as u64;
            hash.update(&buf[..n]);
        }
        assert_eq!(bytes, 48_382_640);
        assert_eq!(
            format!("{:x}", hash.finalize()),
            "95dc76a2f255e623acaa5149b320389f7da7c995da890c3e0d511c0ff681b2e1"
        );

        let e = classify(&mut File::open(path).unwrap()).unwrap();
        assert_eq!(
            (e.width, e.height, e.photometric, e.samples_per_pixel),
            (5920, 3950, 32803, 1)
        );
        assert_eq!(e.bits_per_sample, vec![16]);
        assert_eq!(e.cfa_dimensions, Some([2, 2]));
        assert_eq!(e.cfa_pattern, Some(vec![0, 1, 1, 2]));
        // Exact source DNG/backward versions, selected path/offset.
        assert_eq!(e.dng_version, Some([1, 4, 0, 0]));
        assert_eq!(e.backward_version, Some([1, 1, 0, 0]));
        assert_eq!(e.selected_ifd_path, "ifd[0]/subifd[0]");
        assert_eq!(e.selected_ifd_offset, 196_558);
        // Exactly one tag-50740 record, with its exact path/type/count/
        // value-byte-length/hash — not merely "non-empty."
        assert_eq!(e.private_data.len(), 1);
        let p = &e.private_data[0];
        assert_eq!(p.ifd_path, "ifd[0]");
        assert_eq!(p.field_type, 1);
        assert_eq!(p.count, 68_560);
        assert_eq!(p.value_bytes, 68_560);
        assert_eq!(
            p.sha256,
            "8d5074476c6a3ff2148b6b6fb9372313a5066e032a7958e368fd75f2ed19fc62"
        );
    }

    // --- Synthetic classic-TIFF builder for parser hardening tests -------
    //
    // A minimal append-only builder: values <=4 bytes are written inline in
    // the 12-byte directory entry; larger values are appended to a value
    // pool that follows the `next` field. It has no relationship to the
    // crate's own Linear DNG writer — these tests exercise the parser
    // against independently constructed bytes, in both byte orders.

    struct Entry {
        tag: u16,
        typ: u16,
        count: u32,
        data: Vec<u8>,
    }

    fn enc16(le: bool, v: u16) -> Vec<u8> {
        if le {
            v.to_le_bytes().to_vec()
        } else {
            v.to_be_bytes().to_vec()
        }
    }
    fn enc32(le: bool, v: u32) -> Vec<u8> {
        if le {
            v.to_le_bytes().to_vec()
        } else {
            v.to_be_bytes().to_vec()
        }
    }
    fn short_entry(le: bool, tag: u16, v: &[u16]) -> Entry {
        Entry {
            tag,
            typ: 3,
            count: v.len() as u32,
            data: v.iter().flat_map(|x| enc16(le, *x)).collect(),
        }
    }
    fn long_entry(le: bool, tag: u16, v: &[u32]) -> Entry {
        Entry {
            tag,
            typ: 4,
            count: v.len() as u32,
            data: v.iter().flat_map(|x| enc32(le, *x)).collect(),
        }
    }
    fn byte_entry(tag: u16, v: &[u8]) -> Entry {
        Entry {
            tag,
            typ: 1,
            count: v.len() as u32,
            data: v.to_vec(),
        }
    }
    /// A directory entry with an explicit (possibly semantically bogus)
    /// declared type/count and raw bytes, for deliberately malformed cases.
    fn raw_entry(tag: u16, typ: u16, count: u32, data: Vec<u8>) -> Entry {
        Entry {
            tag,
            typ,
            count,
            data,
        }
    }

    struct Builder {
        le: bool,
        buf: Vec<u8>,
    }
    impl Builder {
        fn new(le: bool) -> Self {
            let mut buf = vec![0u8; 8];
            if le {
                buf[0] = b'I';
                buf[1] = b'I';
                buf[2..4].copy_from_slice(&42u16.to_le_bytes());
            } else {
                buf[0] = b'M';
                buf[1] = b'M';
                buf[2..4].copy_from_slice(&42u16.to_be_bytes());
            }
            Self { le, buf }
        }
        fn e16(&self, v: u16) -> Vec<u8> {
            enc16(self.le, v)
        }
        fn e32(&self, v: u32) -> Vec<u8> {
            enc32(self.le, v)
        }
        fn pos(&self) -> u32 {
            self.buf.len() as u32
        }
        fn set_first_ifd(&mut self, offset: u32) {
            let b = self.e32(offset);
            self.buf[4..8].copy_from_slice(&b);
        }
        fn magic(&mut self, v: u16) {
            let b = self.e16(v);
            self.buf[2..4].copy_from_slice(&b);
        }
        /// Append `n` zero bytes and return the offset they start at.
        fn pad_zeros(&mut self, n: usize) -> u32 {
            let offset = self.pos();
            self.buf.extend(std::iter::repeat(0u8).take(n));
            offset
        }
        /// Append an IFD at the current end of the buffer; returns its offset.
        fn ifd(&mut self, entries: &[Entry], next: u32) -> u32 {
            let offset = self.pos();
            let count_bytes = self.e16(entries.len() as u16);
            self.buf.extend_from_slice(&count_bytes);
            let dir_start = self.buf.len();
            self.buf.resize(dir_start + entries.len() * 12, 0);
            for (i, e) in entries.iter().enumerate() {
                let at = dir_start + i * 12;
                let tag_bytes = self.e16(e.tag);
                let typ_bytes = self.e16(e.typ);
                let count_bytes = self.e32(e.count);
                self.buf[at..at + 2].copy_from_slice(&tag_bytes);
                self.buf[at + 2..at + 4].copy_from_slice(&typ_bytes);
                self.buf[at + 4..at + 8].copy_from_slice(&count_bytes);
                if e.data.len() <= 4 {
                    let mut inline = [0u8; 4];
                    inline[..e.data.len()].copy_from_slice(&e.data);
                    self.buf[at + 8..at + 12].copy_from_slice(&inline);
                }
            }
            let next_bytes = self.e32(next);
            self.buf.extend_from_slice(&next_bytes);
            for (i, e) in entries.iter().enumerate() {
                if e.data.len() > 4 {
                    let value_offset = self.pos();
                    self.buf.extend_from_slice(&e.data);
                    let at = dir_start + i * 12 + 8;
                    let off_bytes = self.e32(value_offset);
                    self.buf[at..at + 4].copy_from_slice(&off_bytes);
                }
            }
            offset
        }
        fn finish(self) -> Vec<u8> {
            self.buf
        }
    }

    /// A minimal single-IFD CFA DNG (photometric 32803, 2x2 CFA pattern,
    /// 16-bit, one sample, one strip exactly matching the declared
    /// geometry). `overrides` replace base entries sharing the same tag
    /// (letting a test corrupt exactly one field) or add new ones.
    fn minimal_cfa_with(le: bool, width: u32, height: u32, overrides: &[Entry]) -> Vec<u8> {
        let mut b = Builder::new(le);
        let pixel_bytes = width as usize * height as usize * 2;
        let pixel_offset = b.pad_zeros(pixel_bytes);
        let mut entries: Vec<Entry> = vec![
            long_entry(le, 256, &[width]),
            long_entry(le, 257, &[height]),
            short_entry(le, 258, &[16]),
            short_entry(le, 262, &[32803]),
            long_entry(le, 273, &[pixel_offset]),
            short_entry(le, 274, &[1]),
            short_entry(le, 277, &[1]),
            long_entry(le, 279, &[pixel_bytes as u32]),
            short_entry(le, 33421, &[2, 2]),
            byte_entry(33422, &[0, 1, 1, 2]),
        ];
        for o in overrides {
            entries.retain(|e| e.tag != o.tag);
            entries.push(Entry {
                tag: o.tag,
                typ: o.typ,
                count: o.count,
                data: o.data.clone(),
            });
        }
        entries.sort_by_key(|e| e.tag);
        let ifd_offset = b.ifd(&entries, 0);
        b.set_first_ifd(ifd_offset);
        b.finish()
    }
    fn minimal_cfa(le: bool, width: u32, height: u32) -> Vec<u8> {
        minimal_cfa_with(le, width, height, &[])
    }

    static SYNTH_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    fn classify_bytes(bytes: Vec<u8>) -> Result<DngEvidence, String> {
        let path = std::env::temp_dir().join(format!(
            "galerie-dng-synth-{}-{}.dng",
            std::process::id(),
            SYNTH_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::write(&path, &bytes).unwrap();
        let result = classify(&mut File::open(&path).unwrap());
        std::fs::remove_file(&path).unwrap();
        result
    }

    #[test]
    fn classifies_minimal_cfa_both_byte_orders() {
        for le in [true, false] {
            let e = classify_bytes(minimal_cfa(le, 4, 4)).unwrap();
            assert_eq!(
                (e.width, e.height, e.photometric, e.samples_per_pixel),
                (4, 4, 32803, 1)
            );
            assert_eq!(e.class, DngClass::Cfa);
            assert_eq!(e.cfa_dimensions, Some([2, 2]));
            assert_eq!(e.cfa_pattern, Some(vec![0, 1, 1, 2]));
            assert_eq!(
                e.byte_order,
                if le {
                    ByteOrder::LittleEndian
                } else {
                    ByteOrder::BigEndian
                }
            );
        }
    }

    #[test]
    fn rejects_bigtiff_magic() {
        let mut b = Builder::new(true);
        b.magic(43);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("BigTIFF"), "{err}");
    }

    #[test]
    fn rejects_invalid_byte_order_marker() {
        let mut bytes = minimal_cfa(true, 4, 4);
        bytes[0] = b'X';
        let err = classify_bytes(bytes).unwrap_err();
        assert!(err.contains("byte order"), "{err}");
    }

    #[test]
    fn rejects_ifd_offset_outside_file() {
        let mut b = Builder::new(true);
        b.set_first_ifd(0xFFFF_FF00);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn rejects_duplicate_tag_within_ifd() {
        let le = true;
        let mut b = Builder::new(le);
        let entries = vec![long_entry(le, 256, &[4]), long_entry(le, 256, &[8])];
        let ifd_offset = b.ifd(&entries, 0);
        b.set_first_ifd(ifd_offset);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("duplicate DNG tag"), "{err}");
    }

    #[test]
    fn rejects_cyclic_subifd_offset() {
        let le = true;
        let mut b = Builder::new(le);
        let self_offset = b.pos();
        let entries = vec![long_entry(le, 330, &[self_offset])];
        let ifd_offset = b.ifd(&entries, 0);
        assert_eq!(ifd_offset, self_offset);
        b.set_first_ifd(ifd_offset);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("duplicate or cyclic"), "{err}");
    }

    #[test]
    fn rejects_duplicate_subifd_offset_across_siblings() {
        let le = true;
        let mut b = Builder::new(le);
        let shared_offset = b.pos();
        b.ifd(&[], 0);
        let entries = vec![long_entry(le, 330, &[shared_offset, shared_offset])];
        let ifd_offset = b.ifd(&entries, 0);
        b.set_first_ifd(ifd_offset);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("duplicate or cyclic"), "{err}");
    }

    #[test]
    fn rejects_ifd_count_over_cap_before_reading_final_ifd() {
        let mut b = Builder::new(true);
        // 256 real empty IFDs chained by `next`, then a dangling nonzero
        // `next` for a 257th that is never actually written — the cap trips
        // on offset bookkeeping alone, without reading IFD 257's bytes.
        let dangling = 0xFFFF_FFFEu32;
        let mut offsets = Vec::with_capacity(MAX_IFDS);
        let start = b.pos();
        for i in 0..MAX_IFDS {
            offsets.push(start + (i as u32) * 6);
        }
        for i in 0..MAX_IFDS {
            let next = if i + 1 < MAX_IFDS {
                offsets[i + 1]
            } else {
                dangling
            };
            let off = b.ifd(&[], next);
            assert_eq!(off, offsets[i]);
        }
        b.set_first_ifd(offsets[0]);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("duplicate or cyclic"), "{err}");
    }

    #[test]
    fn rejects_entries_per_ifd_over_cap_before_reading_entries() {
        let mut b = Builder::new(true);
        let ifd_offset = b.pos();
        // Only the 2-byte entry-count header exists; no directory bytes
        // back it, proving the cap is checked before any are read.
        let count_bytes = b.e16((MAX_ENTRIES_PER_IFD + 1) as u16);
        b.buf.extend_from_slice(&count_bytes);
        b.set_first_ifd(ifd_offset);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("entry limit"), "{err}");
    }

    #[test]
    fn rejects_total_entries_over_cap_before_reading_final_ifd() {
        let le = true;
        let mut b = Builder::new(le);
        // Four fully-valid, maximally-sized (4096 unique-tag, zero-length,
        // therefore fixed-size) filler IFDs chained by `next`; their sum
        // exactly reaches the 16,384 total-entries cap. A 5th IFD then only
        // needs its 2-byte count header (declaring 1 more entry) to exist —
        // the cap trips immediately after reading it, before any of its
        // directory bytes.
        let ifd_size: u32 = 2 + (MAX_ENTRIES_PER_IFD as u32) * 12 + 4;
        let start = b.pos();
        let offset_of = |i: u32| start + i * ifd_size;
        for i in 0..4u32 {
            let entries: Vec<Entry> = (0..MAX_ENTRIES_PER_IFD)
                .map(|j| raw_entry((1000 + j) as u16, 1, 0, vec![]))
                .collect();
            let next = if i + 1 < 4 {
                offset_of(i + 1)
            } else {
                offset_of(4)
            };
            let off = b.ifd(&entries, next);
            assert_eq!(off, offset_of(i));
        }
        assert_eq!(b.pos(), offset_of(4));
        let count_bytes = b.e16(1);
        b.buf.extend_from_slice(&count_bytes);
        b.set_first_ifd(start);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("entry limit"), "{err}");
    }

    #[test]
    fn rejects_subifd_depth_over_cap() {
        let le = true;
        let mut b = Builder::new(le);
        // MAX_DEPTH real nested SubIFD levels (the maximum allowed), the
        // last pointing to one more that never needs to exist as real bytes
        // — the depth check runs before any read.
        let dangling = 0xFFFF_FFFEu32;
        let level_size: u32 = 2 + 12 + 4;
        let start = b.pos();
        let offset_of = |i: u32| start + i * level_size;
        for i in 0..MAX_DEPTH as u32 {
            let next_level = if i + 1 < MAX_DEPTH as u32 {
                offset_of(i + 1)
            } else {
                dangling
            };
            let entries = vec![long_entry(le, 330, &[next_level])];
            let off = b.ifd(&entries, 0);
            assert_eq!(off, offset_of(i));
        }
        let root_entries = vec![long_entry(le, 330, &[offset_of(0)])];
        let root_offset = b.ifd(&root_entries, 0);
        b.set_first_ifd(root_offset);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("depth"), "{err}");
    }

    #[test]
    fn rejects_subifd_count_over_cap() {
        let mut b = Builder::new(true);
        let n = MAX_SUBIFDS + 1;
        let entries = vec![raw_entry(330, 4, n as u32, vec![0u8; n * 4])];
        let ifd_offset = b.ifd(&entries, 0);
        b.set_first_ifd(ifd_offset);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("SubIFD count limit"), "{err}");
    }

    #[test]
    fn rejects_image_chunk_count_over_cap() {
        let le = true;
        let mut b = Builder::new(le);
        let n = MAX_CHUNKS + 1;
        let entries_unsorted = vec![
            long_entry(le, 256, &[4]),
            long_entry(le, 257, &[4]),
            short_entry(le, 258, &[16]),
            short_entry(le, 262, &[32803]),
            raw_entry(273, 4, n as u32, vec![0u8; n * 4]),
            short_entry(le, 274, &[1]),
            short_entry(le, 277, &[1]),
            raw_entry(279, 4, n as u32, vec![0u8; n * 4]),
            short_entry(le, 33421, &[2, 2]),
            byte_entry(33422, &[0, 1, 1, 2]),
        ];
        let mut entries = entries_unsorted;
        entries.sort_by_key(|e| e.tag);
        let ifd_offset = b.ifd(&entries, 0);
        b.set_first_ifd(ifd_offset);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("image chunk arrays"), "{err}");
    }

    #[test]
    fn rejects_bits_per_sample_arity_mismatch() {
        let le = true;
        // 100,000 declared BitsPerSample values for a single-sample image —
        // rejected by arity before the array is materialized.
        let bogus = raw_entry(258, 3, 100_000, vec![0u8; 200_000]);
        let err = classify_bytes(minimal_cfa_with(le, 4, 4, &[bogus])).unwrap_err();
        assert!(err.contains("invalid DNG BitsPerSample"), "{err}");
    }

    #[test]
    fn rejects_cfa_cells_over_cap() {
        let le = true;
        let mut b = Builder::new(le);
        let pixel_offset = b.pad_zeros(32);
        let entries_unsorted = vec![
            long_entry(le, 256, &[4]),
            long_entry(le, 257, &[4]),
            short_entry(le, 258, &[16]),
            short_entry(le, 262, &[32803]),
            long_entry(le, 273, &[pixel_offset]),
            short_entry(le, 274, &[1]),
            short_entry(le, 277, &[1]),
            long_entry(le, 279, &[32]),
            short_entry(le, 33421, &[17, 17]), // 289 cells > MAX_CFA_CELLS
        ];
        let mut entries = entries_unsorted;
        entries.sort_by_key(|e| e.tag);
        let ifd_offset = b.ifd(&entries, 0);
        b.set_first_ifd(ifd_offset);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("CFA pattern contradicts dimensions"), "{err}");
    }

    #[test]
    fn rejects_overlapping_image_chunks() {
        let le = true;
        let mut b = Builder::new(le);
        let pixel_offset = b.pad_zeros(12);
        let entries_unsorted = vec![
            long_entry(le, 256, &[4]),
            long_entry(le, 257, &[2]),
            short_entry(le, 258, &[16]),
            short_entry(le, 262, &[32803]),
            long_entry(le, 273, &[pixel_offset, pixel_offset + 4]),
            short_entry(le, 274, &[1]),
            short_entry(le, 277, &[1]),
            long_entry(le, 279, &[8, 8]),
            short_entry(le, 33421, &[2, 2]),
            byte_entry(33422, &[0, 1, 1, 2]),
        ];
        let mut entries = entries_unsorted;
        entries.sort_by_key(|e| e.tag);
        let ifd_offset = b.ifd(&entries, 0);
        b.set_first_ifd(ifd_offset);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("overlapping DNG image chunks"), "{err}");
    }

    #[test]
    fn rejects_strip_and_tile_both_present() {
        let le = true;
        let mut b = Builder::new(le);
        let pixel_offset = b.pad_zeros(32);
        let entries_unsorted = vec![
            long_entry(le, 256, &[4]),
            long_entry(le, 257, &[4]),
            short_entry(le, 258, &[16]),
            short_entry(le, 262, &[32803]),
            long_entry(le, 273, &[pixel_offset]),
            long_entry(le, 279, &[32]),
            long_entry(le, 324, &[pixel_offset]),
            long_entry(le, 325, &[32]),
            short_entry(le, 274, &[1]),
            short_entry(le, 277, &[1]),
            short_entry(le, 33421, &[2, 2]),
            byte_entry(33422, &[0, 1, 1, 2]),
        ];
        let mut entries = entries_unsorted;
        entries.sort_by_key(|e| e.tag);
        let ifd_offset = b.ifd(&entries, 0);
        b.set_first_ifd(ifd_offset);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("exactly one strip or tile"), "{err}");
    }

    #[test]
    fn rejects_neither_strip_nor_tile_present() {
        let le = true;
        let mut b = Builder::new(le);
        let entries_unsorted = vec![
            long_entry(le, 256, &[4]),
            long_entry(le, 257, &[4]),
            short_entry(le, 258, &[16]),
            short_entry(le, 262, &[32803]),
            short_entry(le, 274, &[1]),
            short_entry(le, 277, &[1]),
            short_entry(le, 33421, &[2, 2]),
            byte_entry(33422, &[0, 1, 1, 2]),
        ];
        let mut entries = entries_unsorted;
        entries.sort_by_key(|e| e.tag);
        let ifd_offset = b.ifd(&entries, 0);
        b.set_first_ifd(ifd_offset);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("exactly one strip or tile"), "{err}");
    }

    #[test]
    fn rejects_cfa_missing_pattern_dim() {
        let le = true;
        let mut b = Builder::new(le);
        let pixel_offset = b.pad_zeros(32);
        let entries_unsorted = vec![
            long_entry(le, 256, &[4]),
            long_entry(le, 257, &[4]),
            short_entry(le, 258, &[16]),
            short_entry(le, 262, &[32803]),
            long_entry(le, 273, &[pixel_offset]),
            short_entry(le, 274, &[1]),
            short_entry(le, 277, &[1]),
            long_entry(le, 279, &[32]),
        ];
        let mut entries = entries_unsorted;
        entries.sort_by_key(|e| e.tag);
        let ifd_offset = b.ifd(&entries, 0);
        b.set_first_ifd(ifd_offset);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("CFARepeatPatternDim"), "{err}");
    }

    #[test]
    fn rejects_linear_raw_with_cfa_tags() {
        let le = true;
        let mut b = Builder::new(le);
        let pixel_offset = b.pad_zeros(32);
        let entries_unsorted = vec![
            long_entry(le, 256, &[4]),
            long_entry(le, 257, &[4]),
            short_entry(le, 258, &[16]),
            short_entry(le, 262, &[34892]),
            long_entry(le, 273, &[pixel_offset]),
            short_entry(le, 274, &[1]),
            short_entry(le, 277, &[1]),
            long_entry(le, 279, &[32]),
            short_entry(le, 33421, &[2, 2]),
            byte_entry(33422, &[0, 1, 1, 2]),
        ];
        let mut entries = entries_unsorted;
        entries.sort_by_key(|e| e.tag);
        let ifd_offset = b.ifd(&entries, 0);
        b.set_first_ifd(ifd_offset);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("LinearRaw DNG contains CFA tags"), "{err}");
    }

    #[test]
    fn rejects_cfa_tags_on_non_raw_photometric() {
        let le = true;
        let mut b = Builder::new(le);
        let pixel_offset = b.pad_zeros(32);
        let entries_unsorted = vec![
            long_entry(le, 256, &[4]),
            long_entry(le, 257, &[4]),
            short_entry(le, 258, &[16]),
            short_entry(le, 262, &[2]), // RGB — not a raw photometric
            long_entry(le, 273, &[pixel_offset]),
            short_entry(le, 274, &[1]),
            short_entry(le, 277, &[1]),
            long_entry(le, 279, &[32]),
            short_entry(le, 33421, &[2, 2]),
            byte_entry(33422, &[0, 1, 1, 2]),
        ];
        let mut entries = entries_unsorted;
        entries.sort_by_key(|e| e.tag);
        let ifd_offset = b.ifd(&entries, 0);
        b.set_first_ifd(ifd_offset);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("CFA tags present on non-raw"), "{err}");
    }

    #[test]
    fn rejects_orientation_value_that_would_wrap_into_range() {
        let le = true;
        // 65544 (0x10008) truncates to 8 (a valid orientation) if narrowed
        // before range-checking; it must be rejected as out of range.
        let bogus = raw_entry(274, 4, 1, enc32(le, 65544));
        let err = classify_bytes(minimal_cfa_with(le, 4, 4, &[bogus])).unwrap_err();
        assert!(err.contains("invalid DNG orientation"), "{err}");
    }

    #[test]
    fn rejects_photometric_value_out_of_u16_range() {
        let le = true;
        let bogus = raw_entry(262, 4, 1, enc32(le, 32803 + 65536));
        let err = classify_bytes(minimal_cfa_with(le, 4, 4, &[bogus])).unwrap_err();
        assert!(err.contains("invalid DNG photometric tag"), "{err}");
    }

    #[test]
    fn rejects_storage_smaller_than_declared_geometry() {
        let le = true;
        let mut b = Builder::new(le);
        // A declared 4x4 16-bit image needs 32 strip bytes; only 8 exist.
        let pixel_offset = b.pad_zeros(8);
        let entries_unsorted = vec![
            long_entry(le, 256, &[4]),
            long_entry(le, 257, &[4]),
            short_entry(le, 258, &[16]),
            short_entry(le, 262, &[32803]),
            long_entry(le, 273, &[pixel_offset]),
            short_entry(le, 274, &[1]),
            short_entry(le, 277, &[1]),
            long_entry(le, 279, &[8]),
            short_entry(le, 33421, &[2, 2]),
            byte_entry(33422, &[0, 1, 1, 2]),
        ];
        let mut entries = entries_unsorted;
        entries.sort_by_key(|e| e.tag);
        let ifd_offset = b.ifd(&entries, 0);
        b.set_first_ifd(ifd_offset);
        let err = classify_bytes(b.finish()).unwrap_err();
        assert!(err.contains("contradicts declared geometry"), "{err}");
    }

    #[test]
    fn selects_higher_resolution_candidate_by_descending_score() {
        let le = true;
        let mut b = Builder::new(le);
        let small_pixels = b.pad_zeros(2 * 2 * 2);
        let large_pixels = b.pad_zeros(4 * 4 * 2);
        let ifd_size: u32 = 2 + 10 * 12 + 4;
        let small_offset = b.pos();
        let large_offset = small_offset + ifd_size;
        let cfa_entries = |width: u32, height: u32, pixel_offset: u32, pixel_bytes: u32| {
            let mut e = vec![
                long_entry(le, 256, &[width]),
                long_entry(le, 257, &[height]),
                short_entry(le, 258, &[16]),
                short_entry(le, 262, &[32803]),
                long_entry(le, 273, &[pixel_offset]),
                short_entry(le, 274, &[1]),
                short_entry(le, 277, &[1]),
                long_entry(le, 279, &[pixel_bytes]),
                short_entry(le, 33421, &[2, 2]),
                byte_entry(33422, &[0, 1, 1, 2]),
            ];
            e.sort_by_key(|x| x.tag);
            e
        };
        let small = cfa_entries(2, 2, small_pixels, 8);
        let off1 = b.ifd(&small, large_offset);
        assert_eq!(off1, small_offset);
        let large = cfa_entries(4, 4, large_pixels, 32);
        let off2 = b.ifd(&large, 0);
        assert_eq!(off2, large_offset);
        b.set_first_ifd(small_offset);
        let e = classify_bytes(b.finish()).unwrap();
        assert_eq!((e.width, e.height), (4, 4));
        assert_eq!(e.selected_ifd_path, "ifd[1]");
    }

    #[test]
    fn selects_lexicographically_smaller_path_on_score_tie() {
        let le = true;
        let mut b = Builder::new(le);
        let pixels_a = b.pad_zeros(4 * 4 * 2);
        let pixels_b = b.pad_zeros(4 * 4 * 2);
        let ifd_size: u32 = 2 + 10 * 12 + 4;
        let offset_a = b.pos();
        let offset_b = offset_a + ifd_size;
        let cfa_entries = |pixel_offset: u32| {
            let mut e = vec![
                long_entry(le, 256, &[4]),
                long_entry(le, 257, &[4]),
                short_entry(le, 258, &[16]),
                short_entry(le, 262, &[32803]),
                long_entry(le, 273, &[pixel_offset]),
                short_entry(le, 274, &[1]),
                short_entry(le, 277, &[1]),
                long_entry(le, 279, &[32]),
                short_entry(le, 33421, &[2, 2]),
                byte_entry(33422, &[0, 1, 1, 2]),
            ];
            e.sort_by_key(|x| x.tag);
            e
        };
        let off1 = b.ifd(&cfa_entries(pixels_a), offset_b);
        assert_eq!(off1, offset_a);
        let off2 = b.ifd(&cfa_entries(pixels_b), 0);
        assert_eq!(off2, offset_b);
        b.set_first_ifd(offset_a);
        let e = classify_bytes(b.finish()).unwrap();
        assert_eq!(e.selected_ifd_path, "ifd[0]");
    }
}
