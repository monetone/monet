// Camera Raw ▸ Profile: DNG camera profiles (#446). A .dcp is a TIFF-structured
// file whose magic is 0x4352 ("IIRC" / "MMCR") in place of 42; a DNG carries the
// same profile tags in IFD0 as its embedded profile. This module reads them,
// fingerprints them, keeps the ones the host registered (the flat develop
// params only name a profile by digest — its tables are far too big for them),
// and renders one the way the DNG specification describes: camera → XYZ D50 by
// the ForwardMatrix (or the ColorMatrix inverse), both interpolated by the
// white balance's colour temperature between the two calibration illuminants,
// then the HueSatMap, the exposure offset and the LookTable in HSV, then the
// ProfileToneCurve, all in linear ProPhoto RGB.
use super::*;
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::cell::RefCell;
use std::rc::Rc;

const TAG_DNG_VERSION: u16 = 50706;
const TAG_UNIQUE_CAMERA_MODEL: u16 = 50708;
const TAG_COLOR_MATRIX: [u16; 2] = [50721, 50722];
const TAG_CALIBRATION_ILLUMINANT: [u16; 2] = [50778, 50779];
const TAG_PROFILE_NAME: u16 = 50936;
const TAG_HUE_SAT_DIMS: u16 = 50937;
const TAG_HUE_SAT_DATA: [u16; 2] = [50938, 50939];
const TAG_TONE_CURVE: u16 = 50940;
const TAG_FORWARD_MATRIX: [u16; 2] = [50964, 50965];
const TAG_LOOK_DIMS: u16 = 50981;
const TAG_LOOK_DATA: u16 = 50982;
const TAG_HUE_SAT_ENCODING: u16 = 51107;
const TAG_LOOK_ENCODING: u16 = 51108;
const TAG_BASELINE_EXPOSURE_OFFSET: u16 = 51109;
const TAG_DEFAULT_BLACK_RENDER: u16 = 51110;

/// Table caps: Adobe's own profiles stay far below them (90 × 30 × 1 hue/sat
/// maps, 36 × 8 × 16 looks); anything larger is refused as hostile.
const MAX_TABLE_HUES: u32 = 360;
const MAX_TABLE_SATS: u32 = 256;
const MAX_TABLE_VALS: u32 = 256;
const MAX_TABLE_CELLS: usize = 1 << 20;
/// Real curves run to 8192 points (dcamprof); 64 K points is 512 KB parsed.
const MAX_TONE_POINTS: usize = 65536;
const MAX_IFD_ENTRIES: usize = 4096;
/// The most values any profile tag legitimately holds (a full table). A tag's
/// count comes from the file and `from_raw` parses every opened raw, so it is
/// refused here, before it sizes an allocation of 8 bytes a value.
const MAX_TAG_VALUES: usize = MAX_TABLE_CELLS * 3;
/// The bytes of a text tag that are read at all: 256 kept characters of at
/// most four bytes. A lossy decode of the whole value costs three bytes per
/// invalid input byte, and that count is the file's as well.
const MAX_TEXT_BYTES: usize = 1024;
/// Parsed profiles kept for renders; past this the least recently registered
/// is dropped, and a develop that names it again gets its bytes back from the
/// host (`develop_profile`), so eviction costs a re-parse, never a render.
const MAX_REGISTERED_PROFILES: usize = 16;
const TONE_LUT_SIZE: usize = 4096;

/// A HueSatMap or LookTable: `hue × sat × val` cells of (hue shift in degrees,
/// saturation scale, value scale), stored value-major, then hue, then
/// saturation, as the DNG specification lays them out.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct HueSatTable {
    hues: usize,
    sats: usize,
    vals: usize,
    cells: Vec<[f32; 3]>,
    /// ProfileHueSatMapEncoding / ProfileLookTableEncoding 1: the value axis is
    /// indexed (and scaled) in sRGB-encoded value rather than linear.
    srgb_value: bool,
}

#[derive(Debug)]
pub(crate) struct DcpProfile {
    pub(crate) name: String,
    pub(crate) model: String,
    /// Read from a DNG's IFD0 (its embedded profile) rather than a .dcp.
    pub(crate) embedded: bool,
    illuminants: [u16; 2],
    color_matrix: [Option<[f64; 9]>; 2],
    forward_matrix: [Option<[f64; 9]>; 2],
    hue_sat: [Option<HueSatTable>; 2],
    look: Option<HueSatTable>,
    tone_curve: Vec<(f32, f32)>,
    baseline_exposure_offset: f32,
    default_black_render: u32,
    /// 128-bit fingerprint of the profile's name, camera and everything above
    /// that changes a render, as 32 uppercase hex digits (the shape of ACR's
    /// CameraProfileDigest).
    pub(crate) digest: String,
}

#[derive(Clone, Copy)]
pub(super) struct TiffEntry {
    pub(super) tag: u16,
    pub(super) kind: u16,
    pub(super) count: usize,
    pub(super) at: usize,
}

pub(super) struct Tiff<'a> {
    pub(super) bytes: &'a [u8],
    pub(super) little: bool,
}

impl<'a> Tiff<'a> {
    pub(super) fn u16_at(&self, at: usize) -> Option<u16> {
        let b: [u8; 2] = self.bytes.get(at..at.checked_add(2)?)?.try_into().ok()?;
        Some(if self.little {
            u16::from_le_bytes(b)
        } else {
            u16::from_be_bytes(b)
        })
    }

    pub(super) fn u32_at(&self, at: usize) -> Option<u32> {
        let b: [u8; 4] = self.bytes.get(at..at.checked_add(4)?)?.try_into().ok()?;
        Some(if self.little {
            u32::from_le_bytes(b)
        } else {
            u32::from_be_bytes(b)
        })
    }

    fn u64_at(&self, at: usize) -> Option<u64> {
        let b: [u8; 8] = self.bytes.get(at..at.checked_add(8)?)?.try_into().ok()?;
        Some(if self.little {
            u64::from_le_bytes(b)
        } else {
            u64::from_be_bytes(b)
        })
    }

    /// The entries of the IFD at `offset`, each resolved to where its value
    /// bytes live (inline or at the offset it names), bounds-checked.
    pub(super) fn ifd(&self, offset: usize) -> Option<Vec<TiffEntry>> {
        let count = self.u16_at(offset)? as usize;
        if count > MAX_IFD_ENTRIES {
            return None;
        }
        let mut entries = Vec::with_capacity(count);
        for index in 0..count {
            let base = offset + 2 + index * 12;
            let tag = self.u16_at(base)?;
            let kind = self.u16_at(base + 2)?;
            let count = self.u32_at(base + 4)? as usize;
            let size = match kind {
                1 | 2 | 6 | 7 => 1,
                3 | 8 => 2,
                4 | 9 | 11 | 13 => 4,
                5 | 10 | 12 => 8,
                _ => continue, // unknown types are skipped, as TIFF readers do
            };
            let len = count.checked_mul(size)?;
            let at = if len <= 4 {
                base + 8
            } else {
                self.u32_at(base + 8)? as usize
            };
            if at.checked_add(len)? > self.bytes.len() {
                return None;
            }
            entries.push(TiffEntry {
                tag,
                kind,
                count,
                at,
            });
        }
        Some(entries)
    }

    pub(super) fn numbers(&self, entry: TiffEntry) -> Option<Vec<f64>> {
        if entry.count > MAX_TAG_VALUES {
            return None;
        }
        let mut out = Vec::with_capacity(entry.count);
        for index in 0..entry.count {
            let value = match entry.kind {
                1 | 7 => self.bytes[entry.at + index] as f64,
                6 => self.bytes[entry.at + index] as i8 as f64,
                3 => self.u16_at(entry.at + index * 2)? as f64,
                8 => self.u16_at(entry.at + index * 2)? as i16 as f64,
                4 | 13 => self.u32_at(entry.at + index * 4)? as f64,
                9 => self.u32_at(entry.at + index * 4)? as i32 as f64,
                11 => f32::from_bits(self.u32_at(entry.at + index * 4)?) as f64,
                12 => f64::from_bits(self.u64_at(entry.at + index * 8)?),
                5 | 10 => {
                    let (n, d) = (
                        self.u32_at(entry.at + index * 8)?,
                        self.u32_at(entry.at + index * 8 + 4)?,
                    );
                    let (n, d) = if entry.kind == 5 {
                        (n as f64, d as f64)
                    } else {
                        (n as i32 as f64, d as i32 as f64)
                    };
                    if d == 0.0 {
                        return None;
                    }
                    n / d
                }
                _ => return None,
            };
            if !value.is_finite() {
                return None;
            }
            out.push(value);
        }
        Some(out)
    }

    /// ASCII (or BYTE-typed UTF-8, as ProfileName may be) up to its NUL.
    pub(super) fn text(&self, entry: TiffEntry) -> Option<String> {
        if !matches!(entry.kind, 1 | 2 | 7) {
            return None;
        }
        let raw = &self.bytes[entry.at..entry.at + entry.count.min(MAX_TEXT_BYTES)];
        let end = raw.iter().position(|&b| b == 0).unwrap_or(raw.len());
        let text: String = String::from_utf8_lossy(&raw[..end])
            .chars()
            .filter(|c| !c.is_control())
            .take(256)
            .collect();
        Some(text.trim().to_string())
    }
}

fn table(
    tiff: &Tiff,
    dims: Option<TiffEntry>,
    data: Option<TiffEntry>,
    encoding: Option<TiffEntry>,
    label: &str,
) -> Result<Option<HueSatTable>, String> {
    let (Some(dims), Some(data)) = (dims, data) else {
        return Ok(None);
    };
    let bad = || format!("the profile's {label} is malformed");
    let d = tiff.numbers(dims).ok_or_else(bad)?;
    let [hues, sats, vals] = d[..] else {
        return Err(bad());
    };
    let (hues, sats, vals) = (hues as u32, sats as u32, vals as u32);
    if !(1..=MAX_TABLE_HUES).contains(&hues)
        || !(2..=MAX_TABLE_SATS).contains(&sats)
        || !(1..=MAX_TABLE_VALS).contains(&vals)
    {
        return Err(bad());
    }
    let cells = (hues * sats * vals) as usize;
    if cells > MAX_TABLE_CELLS || data.count != cells * 3 {
        return Err(bad());
    }
    let values = tiff.numbers(data).ok_or_else(bad)?;
    let cells: Vec<[f32; 3]> = values
        .chunks_exact(3)
        .map(|c| [c[0] as f32, c[1] as f32, c[2] as f32])
        .collect();
    if cells
        .iter()
        .any(|c| c.iter().any(|v| !v.is_finite()) || c[1] < 0.0 || c[2] < 0.0)
    {
        return Err(bad());
    }
    let srgb_value = match encoding {
        Some(entry) => tiff.numbers(entry).and_then(|v| v.first().copied()) == Some(1.0),
        None => false,
    };
    Ok(Some(HueSatTable {
        hues: hues as usize,
        sats: sats as usize,
        vals: vals as usize,
        cells,
        srgb_value,
    }))
}

/// Parse a .dcp, or the embedded profile of a DNG (its IFD0 profile tags).
pub(crate) fn parse_profile(bytes: &[u8]) -> Result<DcpProfile, String> {
    let little = match bytes.get(..2) {
        Some(b"II") => true,
        Some(b"MM") => false,
        _ => return Err("not a DNG camera profile (.dcp) or DNG file".to_string()),
    };
    let tiff = Tiff { bytes, little };
    let magic = tiff.u16_at(2).unwrap_or(0);
    if magic != 0x4352 && magic != 42 {
        return Err("not a DNG camera profile (.dcp) or DNG file".to_string());
    }
    let entries = tiff
        .u32_at(4)
        .and_then(|offset| tiff.ifd(offset as usize))
        .ok_or_else(|| "the camera profile is truncated or malformed".to_string())?;
    let find = |tag: u16| entries.iter().copied().find(|e| e.tag == tag);
    let embedded = magic == 42;
    if embedded && find(TAG_DNG_VERSION).is_none() {
        return Err("a TIFF that is not a DNG carries no camera profile".to_string());
    }
    let matrix = |tag: u16| -> Result<Option<[f64; 9]>, String> {
        let Some(entry) = find(tag) else {
            return Ok(None);
        };
        match tiff.numbers(entry) {
            Some(v) if v.len() == 9 => Ok(Some(v.try_into().expect("nine values"))),
            _ => Err("only three-colour camera profiles are supported".to_string()),
        }
    };
    let color_matrix = [matrix(TAG_COLOR_MATRIX[0])?, matrix(TAG_COLOR_MATRIX[1])?];
    if color_matrix[0].is_none() {
        return Err("the camera profile has no ColorMatrix1".to_string());
    }
    let forward_matrix = [
        matrix(TAG_FORWARD_MATRIX[0])?,
        matrix(TAG_FORWARD_MATRIX[1])?,
    ];
    let illuminant = |tag: u16| {
        find(tag)
            .and_then(|e| tiff.numbers(e))
            .and_then(|v| v.first().copied())
            .map_or(0, |v| v as u16)
    };
    let illuminants = [
        illuminant(TAG_CALIBRATION_ILLUMINANT[0]),
        illuminant(TAG_CALIBRATION_ILLUMINANT[1]),
    ];
    let dims = find(TAG_HUE_SAT_DIMS);
    let encoding = find(TAG_HUE_SAT_ENCODING);
    let first = table(
        &tiff,
        dims,
        find(TAG_HUE_SAT_DATA[0]),
        encoding,
        "HueSatMap",
    )?;
    let second = table(
        &tiff,
        dims,
        find(TAG_HUE_SAT_DATA[1]),
        encoding,
        "HueSatMap",
    )?;
    let look = table(
        &tiff,
        find(TAG_LOOK_DIMS),
        find(TAG_LOOK_DATA),
        find(TAG_LOOK_ENCODING),
        "LookTable",
    )?;
    let tone_curve = match find(TAG_TONE_CURVE) {
        None => Vec::new(),
        Some(entry) => {
            let values = tiff.numbers(entry).unwrap_or_default();
            let points: Vec<(f32, f32)> = values
                .chunks_exact(2)
                .map(|p| (p[0] as f32, p[1] as f32))
                .collect();
            let ordered = points.windows(2).all(|w| w[0].0 < w[1].0);
            if !values.len().is_multiple_of(2)
                || !(2..=MAX_TONE_POINTS).contains(&points.len())
                || !ordered
                || points
                    .iter()
                    .any(|&(x, y)| !(0.0..=1.0).contains(&x) || !(0.0..=1.0).contains(&y))
            {
                return Err("the profile's ToneCurve is malformed".to_string());
            }
            points
        }
    };
    let scalar = |tag: u16| {
        find(tag)
            .and_then(|e| tiff.numbers(e))
            .and_then(|v| v.first().copied())
    };
    let text = |tag: u16| find(tag).and_then(|e| tiff.text(e)).unwrap_or_default();
    let mut profile = DcpProfile {
        name: text(TAG_PROFILE_NAME),
        model: text(TAG_UNIQUE_CAMERA_MODEL),
        embedded,
        illuminants,
        color_matrix,
        forward_matrix,
        // A second HueSatMap only means something against a second matrix.
        hue_sat: [first, second.filter(|_| color_matrix[1].is_some())],
        look,
        tone_curve,
        baseline_exposure_offset: scalar(TAG_BASELINE_EXPOSURE_OFFSET)
            .unwrap_or(0.0)
            .clamp(-10.0, 10.0) as f32,
        default_black_render: scalar(TAG_DEFAULT_BLACK_RENDER).unwrap_or(0.0) as u32,
        digest: String::new(),
    };
    profile.digest = profile.fingerprint();
    Ok(profile)
}

impl DcpProfile {
    fn fingerprint(&self) -> String {
        let mut hash = Sha256::new();
        hash.update(b"monet-dcp-1");
        // Who the profile is, then what it renders: two profiles differing
        // only in name or camera stay two library entries.
        for text in [&self.name, &self.model] {
            hash.update((text.len() as u32).to_le_bytes());
            hash.update(text.as_bytes());
        }
        for illuminant in self.illuminants {
            hash.update(illuminant.to_le_bytes());
        }
        for matrix in self.color_matrix.iter().chain(&self.forward_matrix) {
            match matrix {
                None => hash.update([0u8]),
                Some(m) => {
                    hash.update([1u8]);
                    for v in m {
                        hash.update(v.to_le_bytes());
                    }
                }
            }
        }
        for table in self.hue_sat.iter().chain(std::iter::once(&self.look)) {
            match table {
                None => hash.update([0u8]),
                Some(t) => {
                    hash.update([1u8, t.srgb_value as u8]);
                    for n in [t.hues, t.sats, t.vals] {
                        hash.update((n as u32).to_le_bytes());
                    }
                    for cell in &t.cells {
                        for v in cell {
                            hash.update(v.to_le_bytes());
                        }
                    }
                }
            }
        }
        hash.update((self.tone_curve.len() as u32).to_le_bytes());
        for (x, y) in &self.tone_curve {
            hash.update(x.to_le_bytes());
            hash.update(y.to_le_bytes());
        }
        hash.update(self.baseline_exposure_offset.to_le_bytes());
        hash.update(self.default_black_render.to_le_bytes());
        hash.finalize()[..16]
            .iter()
            .map(|b| format!("{b:02X}"))
            .collect()
    }

    /// The host-facing summary: what to list and how to name it.
    pub(crate) fn info_json(&self) -> String {
        serde_json::json!({
            "name": self.name,
            "model": self.model,
            "digest": self.digest,
            "embedded": self.embedded,
            "dualIlluminant": self.color_matrix[1].is_some(),
            "forwardMatrix": self.forward_matrix.iter().any(Option::is_some),
            "hueSatMap": self.hue_sat[0].is_some(),
            "lookTable": self.look.is_some(),
            "toneCurve": !self.tone_curve.is_empty(),
            "baselineExposureOffset": self.baseline_exposure_offset,
            "defaultBlackRender": self.default_black_render,
        })
        .to_string()
    }

    /// Weight of the first calibration illuminant's data at a white of
    /// `kelvin`, interpolated in inverse temperature between the two
    /// illuminants and clamped at their ends (dng_color_spec's rule).
    fn illuminant_weight(&self, kelvin: f64) -> f64 {
        let (t1, t2) = (
            illuminant_kelvin(self.illuminants[0]),
            illuminant_kelvin(self.illuminants[1]),
        );
        if self.color_matrix[1].is_none() || t1 <= 0.0 || t2 <= 0.0 || t1 == t2 {
            return 1.0;
        }
        let (lo, hi) = if t1 < t2 { (t1, t2) } else { (t2, t1) };
        let w_lo = if kelvin <= lo {
            1.0
        } else if kelvin >= hi {
            0.0
        } else {
            (1.0 / kelvin - 1.0 / hi) / (1.0 / lo - 1.0 / hi)
        };
        if t1 == lo {
            w_lo
        } else {
            1.0 - w_lo
        }
    }

    /// Everything a render at a white of `kelvin` needs, or None when the
    /// matrices are degenerate (the stage then passes pixels through).
    pub(crate) fn render_setup(&self, kelvin: f32, source: Option<&DcpSource>) -> Option<DcpRender<'_>> {
        let w = self.illuminant_weight(kelvin as f64);
        let pick = |pair: &[Option<[f64; 9]>; 2]| -> Option<[f64; 9]> {
            match (pair[0], pair[1]) {
                (Some(a), Some(b)) => Some(std::array::from_fn(|i| a[i] * w + b[i] * (1.0 - w))),
                (a, b) => a.or(b),
            }
        };
        let color_matrix = pick(&self.color_matrix)?;
        // Our develop input is already white-balanced so a neutral is D65
        // white: its camera values are the profile's camera neutral.
        let camera_white = m3_vec(color_matrix, D65_WHITE);
        if camera_white.iter().any(|v| !v.is_finite() || *v <= 1e-9) {
            return None;
        }
        // DNG SDK normalizes each calibration endpoint before interpolation.
        let normalized_forward = self.forward_matrix.map(|matrix| matrix.and_then(|matrix| {
            let white = m3_vec(matrix, [1.0; 3]);
            if white.iter().any(|v| !v.is_finite() || *v <= 1e-9) { return None; }
            Some(std::array::from_fn(|i| matrix[i] * D50_WHITE[i / 3] / white[i / 3]))
        }));
        let xyz65_to_pcs = match (pick(&normalized_forward), source) {
            (forward, Some(source)) => {
                // Import already multiplied white-balanced camera samples by
                // the decoder's normalized camera→XYZ matrix. Undo THAT matrix,
                // never the newly selected profile's matrix.
                let xyz_to_balanced_camera = m3_inv(source.camera_to_xyz)?;
                if let Some(forward) = forward {
                    m3_mul(forward, xyz_to_balanced_camera)
                } else {
                    // DNG's no-ForwardMatrix path: native camera→XYZ, then
                    // adapt the as-shot neutral to the D50 connection white.
                    let camera_to_xyz = m3_inv(color_matrix)?;
                    let neutral = source.white_balance.map(|gain| 1.0 / gain);
                    let white = m3_vec(camera_to_xyz, neutral);
                    if white.iter().any(|v| !v.is_finite() || *v <= 1e-9) { return None; }
                    let adaptation = bradford(white.map(|v| v / white[1]), D50_WHITE);
                    let unbalance = std::array::from_fn(|i| if i % 4 == 0 { neutral[i / 3] } else { 0.0 });
                    let transform = m3_mul(adaptation, m3_mul(camera_to_xyz, m3_mul(unbalance, xyz_to_balanced_camera)));
                    transform.map(|v| v / white[1])
                }
            }
            (Some(forward), None) => {
                let unbalance: [f64; 9] = std::array::from_fn(|i| {
                    if i % 4 == 0 {
                        1.0 / camera_white[i / 3]
                    } else {
                        0.0
                    }
                });
                m3_mul(forward, m3_mul(unbalance, color_matrix))
            }
            // No ForwardMatrix: the ColorMatrix inverse undoes the ColorMatrix
            // the pixels were put into camera space with — only the adaptation
            // to the D50 connection space remains.
            (None, None) => bradford(D65_WHITE, D50_WHITE),
        };
        let pcs_to_prophoto = m3_inv(PROPHOTO_TO_XYZ)?;
        let m_in = m3_mul(pcs_to_prophoto, m3_mul(xyz65_to_pcs, SRGB_TO_XYZ));
        let m_out = m3_mul(
            m3_inv(SRGB_TO_XYZ)?,
            m3_mul(bradford(D50_WHITE, D65_WHITE), PROPHOTO_TO_XYZ),
        );
        let f32m = |m: [f64; 9]| -> [[f32; 3]; 3] {
            std::array::from_fn(|r| std::array::from_fn(|c| m[r * 3 + c] as f32))
        };
        if m_in.iter().chain(&m_out).any(|v| !v.is_finite()) {
            return None;
        }
        let hue_sat = match (&self.hue_sat[0], &self.hue_sat[1]) {
            (Some(a), Some(b)) if a.cells.len() == b.cells.len() && w < 1.0 => {
                let wf = w as f32;
                Some(Cow::Owned(HueSatTable {
                    cells: a
                        .cells
                        .iter()
                        .zip(&b.cells)
                        .map(|(x, y)| std::array::from_fn(|k| x[k] * wf + y[k] * (1.0 - wf)))
                        .collect(),
                    hues: a.hues,
                    sats: a.sats,
                    vals: a.vals,
                    srgb_value: a.srgb_value,
                }))
            }
            (a, _) => a.as_ref().map(Cow::Borrowed),
        };
        let tone = (!self.tone_curve.is_empty()).then(|| tone_lut(&self.tone_curve));
        Some(DcpRender {
            m_in: f32m(m_in),
            m_out: f32m(m_out),
            hue_sat,
            exposure: 2f32.powf(self.baseline_exposure_offset),
            look: self.look.as_ref(),
            tone,
        })
    }
}

/// The camera basis the RAW decoder actually used, carried in V7 develop
/// params so proxy renders and saved Smart Objects use the same correction.
#[derive(Clone, Copy, Debug)]
pub(crate) struct DcpSource {
    pub camera_to_xyz: [f64; 9],
    pub white_balance: [f64; 3],
}

impl DcpSource {
    #[cfg(test)]
    pub(crate) fn from_raw(matrix: [[f32; 4]; 3], wb: [f32; 4]) -> Option<Self> {
        if matrix.iter().any(|row| row[3] != 0.0) { return None; }
        let mut words: Vec<f32> = matrix.iter().flat_map(|row| row[..3].iter().copied()).collect();
        words.extend_from_slice(&wb[..3]);
        Self::from_words(&words)
    }

    pub(crate) fn words(&self) -> Vec<f32> {
        self.camera_to_xyz.iter().chain(&self.white_balance).map(|v| *v as f32).collect()
    }

    pub(crate) fn from_words(words: &[f32]) -> Option<Self> {
        if words.len() != 12 || !words.iter().all(|v| v.is_finite())
            || words[..9].iter().any(|v| v.abs() > 1000.0)
            || words[9..].iter().any(|v| *v <= 0.0 || *v > 1_000_000.0) { return None; }
        let source = Self {
            camera_to_xyz: std::array::from_fn(|i| words[i] as f64),
            white_balance: std::array::from_fn(|i| words[i + 9] as f64),
        };
        m3_inv(source.camera_to_xyz)?;
        Some(source)
    }
}

pub(crate) struct DcpRender<'a> {
    m_in: [[f32; 3]; 3],
    m_out: [[f32; 3]; 3],
    hue_sat: Option<Cow<'a, HueSatTable>>,
    exposure: f32,
    look: Option<&'a HueSatTable>,
    tone: Option<Vec<f32>>,
}

impl DcpRender<'_> {
    /// Render one sRGB-encoded pixel (0..1) through the profile.
    pub(crate) fn apply(&self, rgb: [f32; 3]) -> [f32; 3] {
        let linear = rgb.map(|v| decode_profile(PROFILE_SRGB, v));
        let mut p = mat_vec(self.m_in, linear).map(|v| v.clamp(0.0, 1.0));
        if let Some(table) = &self.hue_sat {
            p = table.apply(p);
        }
        if self.exposure != 1.0 {
            p = p.map(|v| (v * self.exposure).clamp(0.0, 1.0));
        }
        if let Some(table) = self.look {
            p = table.apply(p);
        }
        if let Some(tone) = &self.tone {
            p = rgb_tone(p, tone);
        }
        mat_vec(self.m_out, p).map(|v| encode_profile(PROFILE_SRGB, v))
    }
}

impl HueSatTable {
    /// dng_reference's RefBaselineHueSatMap on one linear ProPhoto pixel.
    pub(crate) fn apply(&self, rgb: [f32; 3]) -> [f32; 3] {
        let (h, s, v) = dng_rgb_to_hsv(rgb);
        let v_encoded = if self.srgb_value {
            encode_profile(PROFILE_SRGB, v.min(1.0))
        } else {
            v
        };
        let h_scaled = if self.hues >= 2 {
            h * self.hues as f32 / 6.0
        } else {
            0.0
        };
        let s_scaled = s * (self.sats - 1) as f32;
        let mut h0 = h_scaled as usize;
        let mut h1 = h0 + 1;
        if h0 >= self.hues - 1 {
            h0 = self.hues - 1;
            h1 = 0;
        }
        let h_fract = h_scaled - h0 as f32;
        let s0 = (s_scaled as usize).min(self.sats - 2);
        let s_fract = s_scaled - s0 as f32;
        let at = |v: usize, h: usize, s: usize| {
            self.cells[v * self.hues * self.sats + h * self.sats + s]
        };
        let plane = |v: usize| -> [f32; 3] {
            let lerp = |a: [f32; 3], b: [f32; 3], t: f32| -> [f32; 3] {
                std::array::from_fn(|k| a[k] + (b[k] - a[k]) * t)
            };
            let low = lerp(at(v, h0, s0), at(v, h1, s0), h_fract);
            let high = lerp(at(v, h0, s0 + 1), at(v, h1, s0 + 1), h_fract);
            lerp(low, high, s_fract)
        };
        let [hue_shift, sat_scale, val_scale] = if self.vals < 2 {
            plane(0)
        } else {
            let v_scaled = v_encoded.clamp(0.0, 1.0) * (self.vals - 1) as f32;
            let v0 = (v_scaled as usize).min(self.vals - 2);
            let v_fract = v_scaled - v0 as f32;
            let (a, b) = (plane(v0), plane(v0 + 1));
            std::array::from_fn(|k| a[k] + (b[k] - a[k]) * v_fract)
        };
        let h = h + hue_shift * (6.0 / 360.0);
        let s = (s * sat_scale).min(1.0);
        let v_encoded = (v_encoded * val_scale).clamp(0.0, 1.0);
        let v = if self.srgb_value {
            decode_profile(PROFILE_SRGB, v_encoded)
        } else {
            v_encoded
        };
        dng_hsv_to_rgb(h, s, v)
    }
}

/// DNG_RGBtoHSV: hue in 0..6, saturation and value 0..1.
fn dng_rgb_to_hsv([r, g, b]: [f32; 3]) -> (f32, f32, f32) {
    let v = r.max(g).max(b);
    let gap = v - r.min(g).min(b);
    if gap <= 0.0 {
        return (0.0, 0.0, v);
    }
    let h = if r == v {
        let h = (g - b) / gap;
        if h < 0.0 {
            h + 6.0
        } else {
            h
        }
    } else if g == v {
        2.0 + (b - r) / gap
    } else {
        4.0 + (r - g) / gap
    };
    (h, gap / v, v)
}

fn dng_hsv_to_rgb(h: f32, s: f32, v: f32) -> [f32; 3] {
    if s <= 0.0 {
        return [v; 3];
    }
    let h = h.rem_euclid(6.0);
    let i = (h as usize).min(5);
    let f = h - i as f32;
    let (p, q, t) = (v * (1.0 - s), v * (1.0 - s * f), v * (1.0 - s * (1.0 - f)));
    match i {
        0 => [v, t, p],
        1 => [q, v, p],
        2 => [p, v, t],
        3 => [p, q, v],
        4 => [t, p, v],
        _ => [v, p, q],
    }
}

/// The ProfileToneCurve sampled at TONE_LUT_SIZE + 1 points through
/// dng_spline_solver: the C2-continuous cubic through every point, with zero
/// second derivative at both ends; flat beyond the first and last points.
fn tone_lut(curve: &[(f32, f32)]) -> Vec<f32> {
    let (x, y): (Vec<f64>, Vec<f64>) = curve.iter().map(|&(x, y)| (x as f64, y as f64)).unzip();
    let slopes = spline_slopes(&x, &y);
    let n = x.len();
    let mut j = 1;
    (0..=TONE_LUT_SIZE)
        .map(|i| {
            let at = i as f64 / TONE_LUT_SIZE as f64;
            if at <= x[0] {
                return y[0] as f32;
            }
            if at >= x[n - 1] {
                return y[n - 1] as f32;
            }
            while x[j] < at {
                j += 1;
            }
            let (x0, x1) = (x[j - 1], x[j]);
            let (a, b, c) = (x1 - x0, (at - x0) / (x1 - x0), (x1 - at) / (x1 - x0));
            (((y[j - 1] * (2.0 - c + b) + slopes[j - 1] * a * b) * c * c)
                + ((y[j] * (2.0 - b + c) - slopes[j] * a * c) * b * b)) as f32
        })
        .collect()
}

/// dng_spline_solver::Solve: each point's slope for the cubic spline that is
/// C0/C1/C2 continuous with a zero second derivative at the end points.
fn spline_slopes(x: &[f64], y: &[f64]) -> Vec<f64> {
    let n = x.len();
    let mut s = vec![0.0; n];
    let mut a = x[1] - x[0];
    let mut b = (y[1] - y[0]) / a;
    s[0] = b;
    for j in 2..n {
        let c = x[j] - x[j - 1];
        let d = (y[j] - y[j - 1]) / c;
        s[j - 1] = (b * c + d * a) / (a + c);
        a = c;
        b = d;
    }
    s[n - 1] = 2.0 * b - s[n - 2];
    s[0] = 2.0 * s[0] - s[1];
    if n > 2 {
        let (mut e, mut f, mut g) = (vec![0.0; n], vec![0.0; n], vec![0.0; n]);
        f[0] = 0.5;
        e[n - 1] = 0.5;
        g[0] = 0.75 * (s[0] + s[1]);
        g[n - 1] = 0.75 * (s[n - 2] + s[n - 1]);
        for j in 1..n - 1 {
            let a = (x[j + 1] - x[j - 1]) * 2.0;
            e[j] = (x[j + 1] - x[j]) / a;
            f[j] = (x[j] - x[j - 1]) / a;
            g[j] = 1.5 * s[j];
        }
        for j in 1..n {
            let a = 1.0 - f[j - 1] * e[j];
            if j != n - 1 {
                f[j] /= a;
            }
            g[j] = (g[j] - g[j - 1] * e[j]) / a;
        }
        for j in (0..n - 1).rev() {
            g[j] -= f[j] * g[j + 1];
        }
        s = g;
    }
    s
}

/// dng_reference's RefBaselineRGBTone: the curve on the largest and smallest
/// channels, the middle one kept at its relative position between them, so
/// the tone curve changes contrast without shifting hue.
fn rgb_tone(rgb: [f32; 3], lut: &[f32]) -> [f32; 3] {
    let curve = |x: f32| {
        let at = x.clamp(0.0, 1.0) * TONE_LUT_SIZE as f32;
        let i = (at as usize).min(TONE_LUT_SIZE - 1);
        lut[i] + (lut[i + 1] - lut[i]) * (at - i as f32)
    };
    let mut order = [0usize, 1, 2];
    order.sort_by(|&a, &b| rgb[b].total_cmp(&rgb[a]));
    let [large, medium, small] = order;
    let mut out = [0.0f32; 3];
    out[large] = curve(rgb[large]);
    out[small] = curve(rgb[small]);
    out[medium] = if rgb[large] > rgb[small] {
        out[small]
            + (out[large] - out[small]) * (rgb[medium] - rgb[small]) / (rgb[large] - rgb[small])
    } else {
        out[large]
    };
    out
}

/// EXIF LightSource → correlated colour temperature (dng_camera_profile's
/// IlluminantToTemperature); 0 = unknown.
fn illuminant_kelvin(code: u16) -> f64 {
    match code {
        17 | 3 => 2850.0,
        24 => 3200.0,
        23 => 5000.0,
        20 | 1 | 9 | 4 | 18 => 5500.0,
        21 | 19 | 10 => 6500.0,
        22 | 11 => 7500.0,
        12 => (5700.0 + 7100.0) * 0.5,
        13 => (4600.0 + 5500.0) * 0.5,
        14 | 2 => (3800.0 + 4500.0) * 0.5,
        15 => (3250.0 + 3800.0) * 0.5,
        16 => (2600.0 + 3250.0) * 0.5,
        _ => 0.0,
    }
}

/// Robertson's isotemperature lines (mired, u, v, slope), as dng_temperature
/// uses them.
const ROBERTSON: [[f64; 4]; 31] = [
    [0.0, 0.18006, 0.26352, -0.24341],
    [10.0, 0.18066, 0.26589, -0.25479],
    [20.0, 0.18133, 0.26846, -0.26876],
    [30.0, 0.18208, 0.27119, -0.28539],
    [40.0, 0.18293, 0.27407, -0.30470],
    [50.0, 0.18388, 0.27709, -0.32675],
    [60.0, 0.18494, 0.28021, -0.35156],
    [70.0, 0.18611, 0.28342, -0.37915],
    [80.0, 0.18740, 0.28668, -0.40955],
    [90.0, 0.18880, 0.28997, -0.44278],
    [100.0, 0.19032, 0.29326, -0.47888],
    [125.0, 0.19462, 0.30141, -0.58204],
    [150.0, 0.19962, 0.30921, -0.70471],
    [175.0, 0.20525, 0.31647, -0.84901],
    [200.0, 0.21142, 0.32312, -1.0182],
    [225.0, 0.21807, 0.32909, -1.2168],
    [250.0, 0.22511, 0.33439, -1.4512],
    [275.0, 0.23247, 0.33904, -1.7298],
    [300.0, 0.24010, 0.34308, -2.0637],
    [325.0, 0.24792, 0.34655, -2.4681],
    [350.0, 0.25591, 0.34951, -2.9641],
    [375.0, 0.26400, 0.35200, -3.5814],
    [400.0, 0.27218, 0.35407, -4.3633],
    [425.0, 0.28039, 0.35577, -5.3762],
    [450.0, 0.28863, 0.35714, -6.7262],
    [475.0, 0.29685, 0.35823, -8.5955],
    [500.0, 0.30505, 0.35907, -11.324],
    [525.0, 0.31320, 0.35968, -15.628],
    [550.0, 0.32129, 0.36011, -23.325],
    [575.0, 0.32931, 0.36038, -40.770],
    [600.0, 0.33724, 0.36051, -116.45],
];

/// Correlated colour temperature of chromaticity (x, y): dng_temperature's
/// Set_xy_coord (Robertson's method).
pub(crate) fn xy_to_kelvin(x: f64, y: f64) -> f64 {
    let denominator = 1.5 - x + 6.0 * y;
    let (u, v) = (2.0 * x / denominator, 3.0 * y / denominator);
    let mut last_dt = 0.0;
    for index in 1..ROBERTSON.len() {
        let [mired, lu, lv, slope] = ROBERTSON[index];
        let len = (1.0 + slope * slope).sqrt();
        let (du, dv) = (1.0 / len, slope / len);
        let dt = -(u - lu) * dv + (v - lv) * du;
        if dt <= 0.0 || index == ROBERTSON.len() - 1 {
            let dt = -dt.min(0.0);
            let f = if index == 1 { 0.0 } else { dt / (last_dt + dt) };
            return 1.0e6 / (ROBERTSON[index - 1][0] * f + mired * (1.0 - f));
        }
        last_dt = dt;
    }
    unreachable!("the last isotherm always answers")
}

/// The colour temperature of a raw's as-shot white: its camera neutral (the
/// reciprocal of the white-balance multipliers) taken to XYZ through the
/// camera's XYZ → camera matrix, then to CCT — dng_color_spec's NeutralToXY
/// with the decoder's single matrix. None when it is degenerate.
pub(crate) fn as_shot_kelvin(white_balance: [f32; 3], xyz_to_camera: [f64; 9]) -> Option<f64> {
    if white_balance.iter().any(|w| !w.is_finite() || *w <= 0.0) {
        return None;
    }
    let neutral = white_balance.map(|w| 1.0 / w as f64);
    let xyz = m3_vec(m3_inv(xyz_to_camera)?, neutral);
    let sum = xyz[0] + xyz[1] + xyz[2];
    if !sum.is_finite() || sum <= 0.0 || xyz.iter().any(|v| *v < 0.0) {
        return None;
    }
    let kelvin = xy_to_kelvin(xyz[0] / sum, xyz[1] / sum);
    (kelvin.is_finite() && (1000.0..=100_000.0).contains(&kelvin)).then_some(kelvin)
}

const D65_WHITE: [f64; 3] = [0.95047, 1.0, 1.08883];
const D50_WHITE: [f64; 3] = [0.3457 / 0.3585, 1.0, (1.0 - 0.3457 - 0.3585) / 0.3585];
const SRGB_TO_XYZ: [f64; 9] = [
    0.4124564, 0.3575761, 0.1804375, //
    0.2126729, 0.7151522, 0.0721750, //
    0.0193339, 0.1191920, 0.9503041,
];
const PROPHOTO_TO_XYZ: [f64; 9] = [
    0.7976749, 0.1351917, 0.0313534, //
    0.2880402, 0.7118741, 0.0000857, //
    0.0, 0.0, 0.8252100,
];

fn m3_mul(a: [f64; 9], b: [f64; 9]) -> [f64; 9] {
    std::array::from_fn(|i| (0..3).map(|k| a[(i / 3) * 3 + k] * b[k * 3 + i % 3]).sum())
}

fn m3_vec(m: [f64; 9], v: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|r| m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2])
}

fn m3_inv(m: [f64; 9]) -> Option<[f64; 9]> {
    let det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6])
        + m[2] * (m[3] * m[7] - m[4] * m[6]);
    if det.abs() < 1e-12 {
        return None;
    }
    let c = [
        m[4] * m[8] - m[5] * m[7],
        m[2] * m[7] - m[1] * m[8],
        m[1] * m[5] - m[2] * m[4],
        m[5] * m[6] - m[3] * m[8],
        m[0] * m[8] - m[2] * m[6],
        m[2] * m[3] - m[0] * m[5],
        m[3] * m[7] - m[4] * m[6],
        m[1] * m[6] - m[0] * m[7],
        m[0] * m[4] - m[1] * m[3],
    ];
    Some(c.map(|v| v / det))
}

/// Bradford chromatic adaptation from one white to another.
fn bradford(from: [f64; 3], to: [f64; 3]) -> [f64; 9] {
    const CONE: [f64; 9] = [
        0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296,
    ];
    let (a, b) = (m3_vec(CONE, from), m3_vec(CONE, to));
    let scale: [f64; 9] =
        std::array::from_fn(|i| if i % 4 == 0 { b[i / 3] / a[i / 3] } else { 0.0 });
    m3_mul(
        m3_inv(CONE).expect("Bradford cone matrix is invertible"),
        m3_mul(scale, CONE),
    )
}

thread_local! {
    static REGISTERED: RefCell<Vec<Rc<DcpProfile>>> = const { RefCell::new(Vec::new()) };
    /// Digests a develop named that neither the registry nor the host had.
    static MISSING: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// Keep `profile` for renders that name its digest (most recent last).
pub(crate) fn register_profile(profile: DcpProfile) -> Rc<DcpProfile> {
    let profile = Rc::new(profile);
    REGISTERED.with(|cell| {
        let mut list = cell.borrow_mut();
        list.retain(|p| p.digest != profile.digest);
        list.push(profile.clone());
        let excess = list.len().saturating_sub(MAX_REGISTERED_PROFILES);
        list.drain(..excess);
    });
    profile
}

pub(crate) fn registered_profile(digest: &str) -> Option<Rc<DcpProfile>> {
    REGISTERED.with(|cell| cell.borrow().iter().find(|p| p.digest == digest).cloned())
}

/// The profile a develop names by digest. One the registry does not hold
/// (evicted, or never registered in this session) is asked of the host,
/// which keeps every profile's bytes; one the host cannot give either is
/// remembered for `develop_profile_take_missing`, and the develop renders
/// Camera Default for it.
pub(crate) fn develop_profile(digest: &str) -> Option<Rc<DcpProfile>> {
    if let Some(profile) = registered_profile(digest) {
        return Some(profile);
    }
    let found = host_profile_bytes(digest)
        .and_then(|bytes| parse_profile(&bytes).ok())
        .filter(|profile| profile.digest == digest)
        .map(register_profile);
    if found.is_none() {
        MISSING.with(|cell| {
            let mut missing = cell.borrow_mut();
            if !missing.iter().any(|d| d == digest) {
                missing.push(digest.to_string());
            }
        });
    }
    found
}

/// The host's bytes for a profile digest: `globalThis.__monetDevelopProfileBytes`,
/// a synchronous `(digest) => Uint8Array | undefined` (Vision's Store). A
/// missing or throwing hook is no profile.
#[cfg(target_arch = "wasm32")]
fn host_profile_bytes(digest: &str) -> Option<Vec<u8>> {
    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(catch, js_name = __monetDevelopProfileBytes)]
        fn monet_develop_profile_bytes(digest: &str) -> Result<Option<Vec<u8>>, JsValue>;
    }
    monet_develop_profile_bytes(digest).ok().flatten()
}

#[cfg(all(not(target_arch = "wasm32"), not(test)))]
fn host_profile_bytes(_digest: &str) -> Option<Vec<u8>> {
    None
}

#[cfg(all(not(target_arch = "wasm32"), test))]
fn host_profile_bytes(digest: &str) -> Option<Vec<u8>> {
    tests::HOST.with(|host| host.borrow().as_ref().and_then(|provide| provide(digest)))
}

/// Develop params carry a profile's digest as eight 16-bit words (each exact
/// in an f32). None unless all eight are whole numbers in 0..=65535.
pub(crate) fn digest_from_words(words: &[f32]) -> Option<String> {
    if words.len() != 8
        || words
            .iter()
            .any(|w| !(0.0..=65535.0).contains(w) || w.fract() != 0.0)
    {
        return None;
    }
    Some(words.iter().map(|w| format!("{:04X}", *w as u16)).collect())
}

fn error_json(message: &str) -> String {
    serde_json::json!({ "error": message }).to_string()
}

/// Read a .dcp (or a DNG's embedded profile) without keeping it: the summary
/// JSON, or `{"error": …}` saying why it is unusable.
#[wasm_bindgen]
pub fn develop_profile_info(bytes: &[u8]) -> String {
    parse_profile(bytes).map_or_else(|e| error_json(&e), |p| p.info_json())
}

/// `develop_profile_info`, and keep the profile so develop params naming its
/// digest render through it.
#[wasm_bindgen]
pub fn develop_profile_register(bytes: &[u8]) -> String {
    parse_profile(bytes).map_or_else(|e| error_json(&e), |p| register_profile(p).info_json())
}

/// Whether a profile with this digest is registered, so the host can skip
/// uploading its bytes again.
#[wasm_bindgen]
pub fn develop_profile_registered(digest: &str) -> bool {
    registered_profile(digest).is_some()
}

/// The digests develops have named since the last call that neither the
/// registry nor the host could supply (they rendered as Camera Default), as a
/// JSON array; clears the list.
#[wasm_bindgen]
pub fn develop_profile_take_missing() -> String {
    MISSING.with(|cell| {
        serde_json::to_string(&std::mem::take(&mut *cell.borrow_mut())).unwrap_or_default()
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    type Provider = Box<dyn Fn(&str) -> Option<Vec<u8>>>;
    thread_local! {
        /// Stands in for the host's `__monetDevelopProfileBytes` hook.
        pub(crate) static HOST: RefCell<Option<Provider>> = const { RefCell::new(None) };
    }

    pub(crate) enum Val {
        Ascii(&'static str),
        Short(u16),
        Long(Vec<u32>),
        SRational(Vec<f64>),
        Float(Vec<f32>),
    }

    /// A one-IFD TIFF with `magic` (0x4352 for a .dcp, 42 for a DNG).
    pub(crate) fn tiff_bytes(magic: u16, little: bool, tags: &[(u16, Val)]) -> Vec<u8> {
        let u16b = |v: u16| {
            if little {
                v.to_le_bytes()
            } else {
                v.to_be_bytes()
            }
        };
        let u32b = |v: u32| {
            if little {
                v.to_le_bytes()
            } else {
                v.to_be_bytes()
            }
        };
        let ifd_len = 2 + tags.len() * 12 + 4;
        let mut head = Vec::new();
        let mut pool = Vec::new();
        head.extend_from_slice(if little { b"II" } else { b"MM" });
        head.extend_from_slice(&u16b(magic));
        head.extend_from_slice(&u32b(8));
        head.extend_from_slice(&u16b(tags.len() as u16));
        for (tag, value) in tags {
            let (kind, count, bytes): (u16, usize, Vec<u8>) = match value {
                Val::Ascii(s) => (2, s.len() + 1, s.bytes().chain([0]).collect()),
                Val::Short(v) => (3, 1, u16b(*v).to_vec()),
                Val::Long(v) => (4, v.len(), v.iter().flat_map(|x| u32b(*x)).collect()),
                Val::SRational(v) => (
                    10,
                    v.len(),
                    v.iter()
                        .flat_map(|x| {
                            let n = (x * 1_000_000.0).round() as i32 as u32;
                            u32b(n).into_iter().chain(u32b(1_000_000))
                        })
                        .collect(),
                ),
                Val::Float(v) => (
                    11,
                    v.len(),
                    v.iter().flat_map(|x| u32b(x.to_bits())).collect(),
                ),
            };
            head.extend_from_slice(&u16b(*tag));
            head.extend_from_slice(&u16b(kind));
            head.extend_from_slice(&u32b(count as u32));
            if bytes.len() <= 4 {
                let mut inline = bytes.clone();
                inline.resize(4, 0);
                head.extend_from_slice(&inline);
            } else {
                if pool.len() % 2 == 1 {
                    pool.push(0);
                }
                head.extend_from_slice(&u32b((8 + ifd_len + pool.len()) as u32));
                pool.extend_from_slice(&bytes);
            }
        }
        head.extend_from_slice(&u32b(0));
        head.extend(pool);
        head
    }

    /// XYZ → linear sRGB: the tiny e2e DNG's ColorMatrix, so camera = sRGB.
    pub(crate) const XYZ_TO_SRGB: [f64; 9] = [
        3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.204, 1.057,
    ];

    /// A single-illuminant .dcp; `hue_shift` Some(°) adds a 6 × 2 × 1
    /// HueSatMap turning every hue by that many degrees.
    pub(crate) fn dcp_bytes(name: &'static str, hue_shift: Option<f32>, little: bool) -> Vec<u8> {
        let mut tags = vec![
            (TAG_UNIQUE_CAMERA_MODEL, Val::Ascii("Vision E2E")),
            (TAG_COLOR_MATRIX[0], Val::SRational(XYZ_TO_SRGB.to_vec())),
            (TAG_CALIBRATION_ILLUMINANT[0], Val::Short(21)),
            (TAG_PROFILE_NAME, Val::Ascii(name)),
        ];
        if let Some(shift) = hue_shift {
            tags.push((TAG_HUE_SAT_DIMS, Val::Long(vec![6, 2, 1])));
            tags.push((
                TAG_HUE_SAT_DATA[0],
                Val::Float([shift, 1.0, 1.0].repeat(12)),
            ));
        }
        tiff_bytes(0x4352, little, &tags)
    }

    #[test]
    fn parses_a_dcp_and_fingerprints_it() {
        let identity = parse_profile(&dcp_bytes("Identity", None, true)).expect("identity .dcp");
        assert_eq!(
            (identity.name.as_str(), identity.model.as_str()),
            ("Identity", "Vision E2E")
        );
        assert!(!identity.embedded && identity.hue_sat[0].is_none());
        assert_eq!(identity.digest.len(), 32);
        assert!(identity
            .digest
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_lowercase()));
        let again = parse_profile(&dcp_bytes("Identity", None, true)).unwrap();
        assert_eq!(again.digest, identity.digest);
        let renamed = parse_profile(&dcp_bytes("Renamed", None, true)).unwrap();
        assert_ne!(
            renamed.digest, identity.digest,
            "another profile of the same look"
        );
        let shifted = parse_profile(&dcp_bytes("Shift", Some(60.0), true)).unwrap();
        assert_ne!(shifted.digest, identity.digest);
        let big_endian = parse_profile(&dcp_bytes("Shift", Some(60.0), false)).expect("MMCR .dcp");
        assert_eq!(big_endian.digest, shifted.digest);
        let info: serde_json::Value = serde_json::from_str(&shifted.info_json()).unwrap();
        assert_eq!(info["name"], "Shift");
        assert_eq!(info["model"], "Vision E2E");
        assert_eq!(info["hueSatMap"], true);
        assert_eq!(info["lookTable"], false);
    }

    #[test]
    fn identity_profile_leaves_pixels_and_a_hue_map_turns_hue() {
        let identity = parse_profile(&dcp_bytes("Identity", None, true)).unwrap();
        let render = identity.render_setup(5500.0, None).expect("identity render");
        for rgb in [
            [0.8, 0.2, 0.1],
            [0.1, 0.6, 0.9],
            [0.5, 0.5, 0.5],
            [0.02, 0.9, 0.3],
        ] {
            let out = render.apply(rgb);
            for c in 0..3 {
                assert!((out[c] - rgb[c]).abs() < 2e-3, "{rgb:?} → {out:?}");
            }
        }
        // In linear ProPhoto the map is exact: pure red turned 60° is yellow.
        let shifted = parse_profile(&dcp_bytes("Shift", Some(60.0), true)).unwrap();
        let table = shifted.hue_sat[0].as_ref().unwrap();
        let yellow = table.apply([1.0, 0.0, 0.0]);
        assert!(
            (yellow[0] - 1.0).abs() < 1e-5
                && (yellow[1] - 1.0).abs() < 1e-5
                && yellow[2].abs() < 1e-5
        );
        let pale = table.apply([1.0, 0.5, 0.5]);
        assert!(
            (pale[0] - 1.0).abs() < 1e-5
                && (pale[1] - 1.0).abs() < 1e-5
                && (pale[2] - 0.5).abs() < 1e-5
        );
        // Through the whole render, an sRGB red comes out much greener.
        let out = shifted.render_setup(5500.0, None).unwrap().apply([0.9, 0.1, 0.1]);
        assert!(out[1] > 0.4, "{out:?}");
    }

    #[test]
    fn matrix_only_profiles_use_the_original_camera_basis() {
        let baseline = parse_profile(&dcp_bytes("Base", None, true)).unwrap();
        let mut swapped = parse_profile(&dcp_bytes("Swap", None, true)).unwrap();
        // The camera in this fixture records linear sRGB. Swapping the R/B
        // rows of XYZ→camera therefore has the independent expected effect
        // of swapping red and blue samples, not leaving every pixel alone.
        let mut matrix = XYZ_TO_SRGB;
        for c in 0..3 { matrix.swap(c, 6 + c); }
        swapped.color_matrix[0] = Some(matrix);
        let source = DcpSource { camera_to_xyz: m3_inv(XYZ_TO_SRGB).unwrap(), white_balance: [1.0; 3] };
        let rgb = [0.75, 0.24, 0.16];
        for (profile, expected) in [(&baseline, rgb), (&swapped, [rgb[2], rgb[1], rgb[0]])] {
            let actual = profile.render_setup(6504.0, Some(&source)).unwrap().apply(rgb);
            for c in 0..3 { assert!((actual[c] - expected[c]).abs() < 0.002, "{actual:?} != {expected:?}"); }
        }
        // Undoing the decoder's actual WB gains must retain an as-shot grey.
        let source = DcpSource { white_balance: [2.0, 1.0, 1.5], ..source };
        let grey = swapped.render_setup(6504.0, Some(&source)).unwrap().apply([0.4; 3]);
        for c in grey { assert!((c - 0.4).abs() < 0.002, "{grey:?}"); }
    }

    #[test]
    fn forward_matrices_normalize_before_interpolation_and_allow_the_second_alone() {
        let mut profile = parse_profile(&dcp_bytes("Forward", None, true)).unwrap();
        let source = DcpSource { camera_to_xyz: SRGB_TO_XYZ, white_balance: [2.0, 1.0, 1.5] };
        let forward = m3_mul(bradford(D65_WHITE, D50_WHITE), SRGB_TO_XYZ);
        profile.forward_matrix = [Some(forward), None];
        let rgb = [0.65, 0.2, 0.1];
        let expected = profile.render_setup(4000.0, Some(&source)).unwrap().apply(rgb);
        for c in 0..3 { assert!((expected[c] - rgb[c]).abs() < 0.002); }
        let alternate = std::array::from_fn(|i| forward[(i / 3) * 3 + [1, 0, 2][i % 3]]);
        let weight = (1.0 / 4000.0 - 1.0 / 6500.0) / (1.0 / 2850.0 - 1.0 / 6500.0);
        let interpolated = std::array::from_fn(|i| forward[i] * weight + alternate[i] * (1.0 - weight));
        profile.forward_matrix = [Some(interpolated), None];
        let expected = profile.render_setup(4000.0, Some(&source)).unwrap().apply(rgb);
        profile.color_matrix[1] = profile.color_matrix[0];
        profile.illuminants = [17, 21];
        profile.forward_matrix = [
            Some(std::array::from_fn(|i| forward[i] * [2.0, 3.0, 4.0][i / 3])),
            Some(std::array::from_fn(|i| alternate[i] * [5.0, 7.0, 11.0][i / 3])),
        ];
        let actual = profile.render_setup(4000.0, Some(&source)).unwrap().apply(rgb);
        for c in 0..3 { assert!((actual[c] - expected[c]).abs() < 1e-5, "{actual:?} != {expected:?}"); }
        profile.forward_matrix = [None, Some(alternate)];
        let second_only = profile.render_setup(4000.0, Some(&source)).unwrap().apply(rgb);
        profile.forward_matrix = [Some(alternate), None];
        assert_eq!(second_only, profile.render_setup(4000.0, Some(&source)).unwrap().apply(rgb));
    }

    #[test]
    fn camera_source_rejects_singular_nonfinite_and_four_channel_bases() {
        let matrix = std::array::from_fn(|r| std::array::from_fn(|c| if c < 3 { SRGB_TO_XYZ[r * 3 + c] as f32 } else { 0.0 }));
        let source = DcpSource::from_raw(matrix, [1.0; 4]).unwrap();
        assert!(DcpSource::from_words(&source.words()).is_some());
        let mut fourth = matrix; fourth[0][3] = 0.1;
        assert!(DcpSource::from_raw(fourth, [1.0; 4]).is_none());
        assert!(DcpSource::from_raw([[0.0; 4]; 3], [1.0; 4]).is_none());
        assert!(DcpSource::from_raw(matrix, [1.0, 0.0, 1.0, 1.0]).is_none());
        let mut words = source.words(); words[0] = f32::NAN;
        assert!(DcpSource::from_words(&words).is_none());
    }

    #[test]
    fn a_dng_carries_its_profile_in_ifd0() {
        let dng = tiff_bytes(
            42,
            true,
            &[
                (TAG_DNG_VERSION, Val::Long(vec![0x0000_0401])),
                (TAG_UNIQUE_CAMERA_MODEL, Val::Ascii("Vision E2E")),
                (TAG_COLOR_MATRIX[0], Val::SRational(XYZ_TO_SRGB.to_vec())),
            ],
        );
        let embedded = parse_profile(&dng).expect("DNG embedded profile");
        assert!(embedded.embedded);
        assert_eq!(
            (embedded.name.as_str(), embedded.model.as_str()),
            ("", "Vision E2E")
        );
        let tiff = tiff_bytes(
            42,
            true,
            &[(TAG_COLOR_MATRIX[0], Val::SRational(XYZ_TO_SRGB.to_vec()))],
        );
        assert!(parse_profile(&tiff).is_err(), "a plain TIFF has no profile");
    }

    /// A hostile DNG: a BYTE-typed ColorMatrix1 counting most of a 256 MB file
    /// asked for 8 bytes a value before its `== 9` check ever ran — an
    /// allocation abort that takes the wasm engine and every open document.
    #[test]
    fn a_tag_count_is_refused_before_it_sizes_an_allocation() {
        let bytes = vec![0u8; MAX_TAG_VALUES + 1];
        let tiff = Tiff {
            bytes: &bytes,
            little: true,
        };
        let matrix = |count| TiffEntry {
            tag: TAG_COLOR_MATRIX[0],
            kind: 1,
            count,
            at: 0,
        };
        assert!(tiff.numbers(matrix(MAX_TAG_VALUES + 1)).is_none());
        assert_eq!(tiff.numbers(matrix(9)).map(|v| v.len()), Some(9));
    }

    /// The sibling sink: a BYTE ProfileName counting megabytes of invalid UTF-8
    /// with no NUL was decoded whole (three bytes out per byte in) before
    /// `take(256)` ran. Nothing past `MAX_TEXT_BYTES` is read, so a name that
    /// only starts there is not seen.
    #[test]
    fn a_text_tag_is_bounded_before_it_is_decoded() {
        let mut bytes = vec![0xFFu8; 4 << 20];
        let name = |count| TiffEntry {
            tag: TAG_PROFILE_NAME,
            kind: 1,
            count,
            at: 0,
        };
        let read = |bytes: &[u8]| {
            Tiff {
                bytes,
                little: true,
            }
            .text(name(bytes.len()))
        };
        assert_eq!(
            read(&bytes).map(|t| t.chars().count()),
            Some(256),
            "invalid UTF-8, no NUL"
        );
        bytes[..MAX_TEXT_BYTES].fill(1); // control bytes, dropped from the name
        bytes[MAX_TEXT_BYTES..MAX_TEXT_BYTES + 4].copy_from_slice(b"Late");
        assert_eq!(read(&bytes).as_deref(), Some(""), "read past the bound");
        bytes[MAX_TEXT_BYTES - 4..MAX_TEXT_BYTES].copy_from_slice(b"Kept");
        assert_eq!(read(&bytes).as_deref(), Some("Kept"));
    }

    #[test]
    fn rejects_what_it_cannot_render() {
        let good = dcp_bytes("Shift", Some(60.0), true);
        assert!(parse_profile(b"not a profile").is_err());
        assert!(
            parse_profile(&good[..good.len() - 20]).is_err(),
            "truncated table"
        );
        let with = |tags: &[(u16, Val)]| parse_profile(&tiff_bytes(0x4352, true, tags));
        let cm = || (TAG_COLOR_MATRIX[0], Val::SRational(XYZ_TO_SRGB.to_vec()));
        assert!(with(&[(TAG_PROFILE_NAME, Val::Ascii("No matrix"))]).is_err());
        assert!(
            with(&[(TAG_COLOR_MATRIX[0], Val::SRational(vec![1.0; 12]))]).is_err(),
            "four colours"
        );
        let dims = |d: Vec<u32>| (TAG_HUE_SAT_DIMS, Val::Long(d));
        let data = |n: usize, v: f32| (TAG_HUE_SAT_DATA[0], Val::Float(vec![v; n]));
        assert!(
            with(&[cm(), dims(vec![6, 2, 1]), data(35, 1.0)]).is_err(),
            "short table"
        );
        assert!(
            with(&[cm(), dims(vec![6, 1, 1]), data(18, 1.0)]).is_err(),
            "one saturation division"
        );
        assert!(
            with(&[cm(), dims(vec![361, 2, 1]), data(361 * 6, 1.0)]).is_err(),
            "too many hues"
        );
        assert!(
            with(&[cm(), dims(vec![6, 2, 1]), data(36, f32::NAN)]).is_err(),
            "NaN cell"
        );
        let curve = |v: Vec<f32>| (TAG_TONE_CURVE, Val::Float(v));
        assert!(
            with(&[cm(), curve(vec![0.0, 0.0, 0.5, 0.6, 0.4, 0.8])]).is_err(),
            "unordered curve"
        );
        assert!(
            with(&[cm(), curve(vec![0.0, 0.0, 1.0, 1.5])]).is_err(),
            "curve above 1"
        );
        assert!(with(&[cm(), curve(vec![0.0, 0.0, 1.0, 1.0])]).is_ok());
    }

    #[test]
    fn interpolates_by_white_temperature_between_the_illuminants() {
        let profile = parse_profile(&tiff_bytes(
            0x4352,
            true,
            &[
                (TAG_COLOR_MATRIX[0], Val::SRational(XYZ_TO_SRGB.to_vec())),
                (TAG_COLOR_MATRIX[1], Val::SRational(XYZ_TO_SRGB.to_vec())),
                (TAG_CALIBRATION_ILLUMINANT[0], Val::Short(17)), // Standard A, 2850 K
                (TAG_CALIBRATION_ILLUMINANT[1], Val::Short(21)), // D65, 6500 K
            ],
        ))
        .unwrap();
        assert_eq!(profile.illuminant_weight(2000.0), 1.0);
        assert_eq!(profile.illuminant_weight(2850.0), 1.0);
        assert_eq!(profile.illuminant_weight(6500.0), 0.0);
        assert_eq!(profile.illuminant_weight(9000.0), 0.0);
        let mid = profile.illuminant_weight(4000.0);
        let expected = (1.0 / 4000.0 - 1.0 / 6500.0) / (1.0 / 2850.0 - 1.0 / 6500.0);
        assert!((mid - expected).abs() < 1e-12, "{mid}");
    }

    #[test]
    fn tone_curve_is_dng_sdk_natural_spline_and_takes_long_curves() {
        // Natural cubic through sparse points (dng_spline_solver), not straight
        // segments: at 0.5 the 3-point lift is 0.678, linear would say 0.573.
        for (curve, expected) in [
            (
                vec![(0.0, 0.0), (0.18, 0.3), (1.0, 1.0)],
                [0.1081885, 0.4006172, 0.6778703, 0.8621728],
            ),
            (
                vec![
                    (0.0, 0.0),
                    (0.1, 0.05),
                    (0.3, 0.36),
                    (0.7, 0.85),
                    (1.0, 1.0),
                ],
                [0.0240021, 0.2706849, 0.6557477, 0.8838615],
            ),
        ] {
            let lut = tone_lut(&curve);
            for (x, want) in [0.0625, 0.25, 0.5, 0.75].into_iter().zip(expected) {
                let got = lut[(x * TONE_LUT_SIZE as f64) as usize];
                assert!(
                    (got as f64 - want).abs() < 1e-5,
                    "{curve:?} at {x}: {got} != {want}"
                );
            }
        }
        let two = tone_lut(&[(0.0, 0.1), (1.0, 0.9)]);
        assert!(
            (two[TONE_LUT_SIZE / 2] - 0.5).abs() < 1e-6,
            "two points stay a line"
        );
        // Real dcamprof curves carry 8192+ points; past 64 K is refused.
        let long = |n: usize| {
            let values: Vec<f32> = (0..n)
                .flat_map(|i| {
                    let x = i as f32 / (n - 1) as f32;
                    [x, x.sqrt()]
                })
                .collect();
            let cm = (TAG_COLOR_MATRIX[0], Val::SRational(XYZ_TO_SRGB.to_vec()));
            parse_profile(&tiff_bytes(
                0x4352,
                true,
                &[cm, (TAG_TONE_CURVE, Val::Float(values))],
            ))
        };
        assert_eq!(long(8193).expect("8193-point curve").tone_curve.len(), 8193);
        assert!(long(MAX_TONE_POINTS + 1).is_err());
    }

    #[test]
    fn as_shot_white_becomes_a_colour_temperature() {
        // Robertson's CCT of D65 and Standard Illuminant A.
        assert!((xy_to_kelvin(0.31271, 0.32902) - 6504.0).abs() < 15.0);
        assert!((xy_to_kelvin(0.44757, 0.40745) - 2856.0).abs() < 15.0);
        // A camera that is linear sRGB: neutral multipliers are D65, and a
        // tungsten-balanced neutral reads as tungsten.
        assert!((as_shot_kelvin([1.0, 1.0, 1.0], XYZ_TO_SRGB).unwrap() - 6504.0).abs() < 15.0);
        let tungsten_xyz = [0.44757 / 0.40745, 1.0, (1.0 - 0.44757 - 0.40745) / 0.40745];
        let neutral = m3_vec(XYZ_TO_SRGB, tungsten_xyz);
        let wb = neutral.map(|n| (neutral[1] / n) as f32);
        assert!((as_shot_kelvin(wb, XYZ_TO_SRGB).unwrap() - 2856.0).abs() < 20.0);
        assert!(as_shot_kelvin([0.0, 1.0, 1.0], XYZ_TO_SRGB).is_none());
        assert!(as_shot_kelvin([1.0; 3], [0.0; 9]).is_none());
    }

    #[test]
    fn tone_curve_keeps_hue() {
        let lut: Vec<f32> = (0..=TONE_LUT_SIZE)
            .map(|i| (i as f32 / TONE_LUT_SIZE as f32).sqrt())
            .collect();
        let out = rgb_tone([0.64, 0.36, 0.16], &lut);
        assert!(
            (out[0] - 0.8).abs() < 1e-3 && (out[2] - 0.4).abs() < 1e-3,
            "{out:?}"
        );
        // The middle channel keeps its place between the other two.
        assert!(
            (out[1] - (0.4 + 0.4 * (0.36 - 0.16) / (0.64 - 0.16))).abs() < 1e-3,
            "{out:?}"
        );
    }

    #[test]
    fn digests_travel_as_sixteen_bit_words_and_registration_is_bounded() {
        let profile = parse_profile(&dcp_bytes("Shift", Some(30.0), true)).unwrap();
        let digest = profile.digest.clone();
        let words: Vec<f32> = (0..8)
            .map(|i| u16::from_str_radix(&digest[i * 4..i * 4 + 4], 16).unwrap() as f32)
            .collect();
        assert_eq!(digest_from_words(&words).as_deref(), Some(digest.as_str()));
        assert!(digest_from_words(&words[..7]).is_none());
        assert!(digest_from_words(&[65536.0; 8]).is_none());
        assert!(digest_from_words(&[1.5; 8]).is_none());
        assert!(!develop_profile_registered(&digest));
        register_profile(profile);
        assert!(develop_profile_registered(&digest));
        for shift in 1..=MAX_REGISTERED_PROFILES {
            register_profile(parse_profile(&dcp_bytes("Other", Some(shift as f32), true)).unwrap());
        }
        assert!(
            !develop_profile_registered(&digest),
            "the oldest is dropped past the cap"
        );
    }
}
