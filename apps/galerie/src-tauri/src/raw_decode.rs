//! Native camera-RAW decode adapter.
//!
//! Core Image owns camera decoding. This module renders directly into an owned
//! checked `DevelopFrame`; bounded webview interchange is a versioned header,
//! JSON provenance, and packed little-endian RGBA16 samples.

use std::fs::File;
use std::io::Read;

use monet_photo_core::{DevelopFrame, MAX_PIXELS};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

pub const PROXY_MAX_EDGE: u32 = 4096;
/// Grid/filmstrip-class proxies (≤ this edge) decode with Core Image's draft
/// mode — a fast reduced demosaic that is visually identical at thumbnail
/// sizes. Preview quality (2560) and above always renders full quality.
/// ponytail: a fixed edge gate; plumb an explicit quality flag through the
/// request if a caller ever needs a full-quality small decode.
pub const DRAFT_MAX_EDGE: u32 = 512;
const PROTOCOL_VERSION: u16 = 3;
const FIXED_HEADER_LEN: u16 = 40;
const MAGIC: &[u8; 4] = b"MGRW";
pub const BACKEND: &str = "macos-core-image";
pub const BACKEND_REVISION: &str = "2";
pub const WORKING_PROFILE: &str = "extended-linear-srgb";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawDecodeIntent {
    pub mode: String,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub derivation_digest: Option<String>,
}

impl RawDecodeIntent {
    pub(crate) fn validate(&self) -> Result<(), String> {
        match self.mode.as_str() {
            "asShot"
                if self.x.is_none() && self.y.is_none() && self.derivation_digest.is_none() =>
            {
                Ok(())
            }
            "neutralChromaticity"
                if self.x.is_some_and(|x| x.is_finite() && x > 0.0 && x < 1.0)
                    && self.y.is_some_and(|y| y.is_finite() && y > 0.0 && y < 1.0)
                    && self.derivation_digest.as_deref().is_some_and(is_sha256) =>
            {
                Ok(())
            }
            _ => Err("invalid canonical RAW decode intent".into()),
        }
    }

    pub(crate) fn digest(&self) -> Result<String, String> {
        self.validate()?;
        let value = serde_json::to_value(self).map_err(|error| error.to_string())?;
        Ok(monet_photo_core::raw_decode_intent_digest(&value)
            .map_err(|error| error.to_string())?
            .0
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect())
    }
}

#[derive(Debug, PartialEq)]
struct DecodeRequest {
    path: String,
    max_edge: u32,
    intent: RawDecodeIntent,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawFrameMetadata {
    pub native_width: u32,
    pub native_height: u32,
    pub source_orientation: u8,
    pub output_width: u32,
    pub output_height: u32,
    pub active_area: [u32; 4],
    pub output_orientation: u8,
    pub orientation_applied: bool,
    pub decoder_backend: String,
    pub backend_revision: String,
    pub decoder_version: String,
    pub os_build: String,
    pub color_space: String,
    pub sample_format: String,
    pub channel_order: String,
    pub color_model: String,
    pub transfer: String,
    pub range: String,
    pub alpha: String,
    pub base_rendering: String,
    pub white_balance_mode: String,
    pub neutral_temperature: f32,
    pub neutral_tint: f32,
    pub scale_numerator: u32,
    pub scale_denominator: u32,
    pub provenance_digest: String,
    pub source_digest: String,
    pub working_profile_digest: String,
    pub decode_intent_digest: String,
}

#[derive(Debug)]
pub struct DecodedRaw {
    pub frame: DevelopFrame,
    pub metadata: RawFrameMetadata,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RawDecoderCapabilities {
    available: bool,
    backend: &'static str,
    backend_revision: &'static str,
    os_build: String,
    output_color_space: &'static str,
    output_bit_depth: u8,
    proxy_max_edge: u32,
    supported_camera_models: Vec<String>,
    note: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawProbe {
    pub decoder_backend: &'static str,
    pub backend_revision: &'static str,
    pub decoder_version: String,
    pub os_build: String,
    pub native_width: u32,
    pub native_height: u32,
    pub active_area: [u32; 4],
    pub source_orientation: u8,
    pub output_orientation: u8,
    pub orientation_applied: bool,
    pub working_profile_digest: String,
    pub output_width: u32,
    pub output_height: u32,
    pub scale_numerator: u32,
    pub scale_denominator: u32,
}

pub(crate) fn draft_mode_for(max_edge: u32) -> bool {
    max_edge <= DRAFT_MAX_EDGE
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn hex_digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn raw_metadata_provenance_digest(metadata: &RawFrameMetadata) -> Result<String, String> {
    let mut value = serde_json::to_value(metadata).map_err(|error| error.to_string())?;
    value
        .as_object_mut()
        .ok_or("RAW metadata must be an object")?
        .remove("provenanceDigest");
    Ok(hex_digest(
        &serde_json::to_vec(&value).map_err(|error| error.to_string())?,
    ))
}

pub fn validate_raw_metadata_provenance(metadata: &RawFrameMetadata) -> Result<(), String> {
    if raw_metadata_provenance_digest(metadata)? == metadata.provenance_digest {
        Ok(())
    } else {
        Err("RAW metadata provenance digest mismatch".into())
    }
}

fn source_digest(path: &str) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| format!("open RAW source: {error}"))?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("read RAW source: {error}"))?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn gcd(mut a: u32, mut b: u32) -> u32 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

pub fn reduced_scale(
    output_width: u32,
    output_height: u32,
    native_width: u32,
    native_height: u32,
) -> (u32, u32) {
    let numerator = output_width.max(output_height);
    let denominator = native_width.max(native_height);
    let divisor = gcd(numerator, denominator);
    (numerator / divisor, denominator / divisor)
}

pub fn validate_native_pixel_count(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("RAW native dimensions must be positive".into());
    }
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or("RAW native dimensions overflow")?;
    if pixels > MAX_PIXELS {
        Err(format!(
            "RAW native dimensions exceed the {MAX_PIXELS}-pixel policy"
        ))
    } else {
        Ok(())
    }
}

fn parse_request(body: &[u8]) -> Result<DecodeRequest, String> {
    if body.len() < 9 {
        return Err("RAW decode request is missing max-edge/intent/path data".into());
    }
    let max_edge = u32::from_le_bytes(body[..4].try_into().expect("four-byte prefix"));
    if max_edge == 0 || max_edge > PROXY_MAX_EDGE {
        return Err(format!(
            "interactive RAW proxy edge must be between 1 and {PROXY_MAX_EDGE}"
        ));
    }
    let intent_len =
        u32::from_le_bytes(body[4..8].try_into().expect("four-byte intent length")) as usize;
    let intent_end = 8_usize
        .checked_add(intent_len)
        .ok_or("RAW decode intent length overflow")?;
    if intent_end >= body.len() {
        return Err("RAW decode request has an invalid intent length".into());
    }
    let intent: RawDecodeIntent = serde_json::from_slice(&body[8..intent_end])
        .map_err(|error| format!("invalid RAW decode intent: {error}"))?;
    intent.validate()?;
    let path = std::str::from_utf8(&body[intent_end..])
        .map_err(|_| "RAW source path is not valid UTF-8")?
        .trim_end_matches('\0');
    if path.is_empty() {
        return Err("RAW source path is empty".into());
    }
    Ok(DecodeRequest {
        path: path.to_owned(),
        max_edge,
        intent,
    })
}

pub fn pack_frame(decoded: &DecodedRaw) -> Result<Vec<u8>, String> {
    validate_raw_metadata_provenance(&decoded.metadata)?;
    let metadata = serde_json::to_vec(&decoded.metadata).map_err(|error| error.to_string())?;
    let metadata_len = u32::try_from(metadata.len()).map_err(|_| "RAW metadata is too large")?;
    let sample_count =
        u64::try_from(decoded.frame.pixels.len()).map_err(|_| "RAW sample count overflow")?;
    let sample_bytes = sample_count
        .checked_mul(2)
        .ok_or("RAW payload byte length overflow")?;
    let capacity = usize::from(FIXED_HEADER_LEN)
        .checked_add(metadata.len())
        .and_then(|n| n.checked_add(usize::try_from(sample_bytes).ok()?))
        .ok_or("RAW response length overflow")?;

    let mut out = Vec::with_capacity(capacity);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&PROTOCOL_VERSION.to_le_bytes());
    out.extend_from_slice(&FIXED_HEADER_LEN.to_le_bytes());
    out.extend_from_slice(&decoded.frame.width.to_le_bytes());
    out.extend_from_slice(&decoded.frame.height.to_le_bytes());
    out.extend_from_slice(&decoded.metadata.native_width.to_le_bytes());
    out.extend_from_slice(&decoded.metadata.native_height.to_le_bytes());
    out.push(decoded.frame.orientation.source_exif);
    out.push(16);
    // bit 0 = scene-linear, bit 1 = orientation applied, bit 2 = little-endian samples.
    let flags = 1_u16
        | if decoded.metadata.orientation_applied {
            2
        } else {
            0
        }
        | 4;
    out.extend_from_slice(&flags.to_le_bytes());
    out.extend_from_slice(&metadata_len.to_le_bytes());
    out.extend_from_slice(&sample_count.to_le_bytes());
    debug_assert_eq!(out.len(), usize::from(FIXED_HEADER_LEN));
    out.extend_from_slice(&metadata);
    for sample in &decoded.frame.pixels {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    Ok(out)
}

/// Source-file metadata extracted natively at import time. `available` is true
/// when the platform EXIF reader ran (macOS ImageIO); `mtime` is filled on
/// every platform. Absent fields are normal (files without EXIF import fine).
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadataProbe {
    pub available: bool,
    /// Source file mtime, unix seconds.
    pub mtime: Option<i64>,
    /// Capture time, unix seconds. EXIF wall time carries no zone; it is
    /// interpreted as UTC so the stored instant is deterministic.
    pub capture_time: Option<i64>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<i64>,
    pub f_number: Option<f64>,
    pub focal_length: Option<f64>,
    /// Shutter speed in seconds.
    pub exposure_time: Option<f64>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    /// IPTC descriptive fields. ImageIO bridges both embedded IPTC IRBs and an
    /// embedded XMP packet (dc:*, photoshop:*, xmp:Rating) into the same
    /// `{IPTC}` dictionary, so a Lightroom-tagged JPEG/TIFF surfaces here.
    pub title: Option<String>,
    pub caption: Option<String>,
    pub creator: Option<String>,
    pub copyright: Option<String>,
    pub city: Option<String>,
    pub state_province: Option<String>,
    pub country: Option<String>,
    pub job_title: Option<String>,
    pub credit: Option<String>,
    pub source: Option<String>,
    /// Embedded keywords (IPTC Keywords / XMP dc:subject).
    pub keywords: Vec<String>,
    /// 1..=5 star rating (XMP xmp:Rating, bridged to IPTC StarRating); None
    /// when unrated. Color labels have no `{IPTC}` bridge, so an embedded
    /// xmp:Label is not probed — sidecar reads carry labels instead.
    pub rating: Option<i64>,
}

/// Parse an EXIF "YYYY:MM:DD HH:MM:SS" wall time into unix seconds (UTC).
/// Unset placeholders ("0000:00:00 …") and malformed strings return None.
fn parse_exif_datetime(value: &str) -> Option<i64> {
    let (date, time) = value.trim().split_once(' ')?;
    let mut date_parts = date.split(':').map(|p| p.parse::<i64>().ok());
    let (year, month, day) = (date_parts.next()??, date_parts.next()??, date_parts.next()??);
    if date_parts.next().is_some() {
        return None;
    }
    let mut time_parts = time.split(':').map(|p| p.parse::<i64>().ok());
    let (hour, minute, second) = (time_parts.next()??, time_parts.next()??, time_parts.next()??);
    if time_parts.next().is_some() {
        return None;
    }
    if !(1..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || !(0..24).contains(&hour)
        || !(0..60).contains(&minute)
        || !(0..61).contains(&second)
    {
        return None;
    }
    // Howard Hinnant's days-from-civil: proleptic Gregorian date → epoch days.
    let cycle_year = if month <= 2 { year - 1 } else { year };
    let era = if cycle_year >= 0 { cycle_year } else { cycle_year - 399 } / 400;
    let year_of_era = cycle_year - era * 400;
    let month_prime = (month + 9) % 12;
    let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let epoch_days = era * 146_097 + day_of_era - 719_468;
    Some(epoch_days * 86_400 + hour * 3_600 + minute * 60 + second)
}

/// Apply an EXIF GPS hemisphere ref ("S"/"W" negate) to a magnitude.
fn gps_signed(magnitude: f64, reference: Option<&str>) -> Option<f64> {
    if !magnitude.is_finite() {
        return None;
    }
    match reference.map(str::trim) {
        Some("S") | Some("W") => Some(-magnitude),
        _ => Some(magnitude),
    }
}

#[tauri::command]
fn probe_image_metadata(path: String) -> Result<ImageMetadataProbe, String> {
    let mut probe = ImageMetadataProbe::default();
    let stat = std::fs::metadata(&path).map_err(|e| format!("stat image source: {e}"))?;
    probe.mtime = stat
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|d| i64::try_from(d.as_secs()).ok());
    platform::fill_image_exif(&path, &mut probe);
    Ok(probe)
}

#[tauri::command]
fn decode_raw_rgba16(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let body = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes,
        _ => return Err("expected a raw RAW-decode request body".into()),
    };
    let request = parse_request(body)?;
    let decoded = decode_to_frame(&request.path, request.max_edge, &request.intent)?;
    Ok(tauri::ipc::Response::new(pack_frame(&decoded)?))
}

#[tauri::command]
fn raw_decoder_capabilities() -> Result<RawDecoderCapabilities, String> {
    platform::capabilities()
}

/// The camera's own embedded JPEG preview (Lightroom's Embedded/Minimal
/// tiers), packed as `[width u32 le, height u32 le]` + tight sRGB RGBA8.
/// Fails when the file carries no embedded preview — never a demosaic fallback.
fn embedded_preview_payload(path: &str, max_edge: u32) -> Result<Vec<u8>, String> {
    if max_edge == 0 || max_edge > PROXY_MAX_EDGE {
        return Err(format!(
            "embedded preview edge must be between 1 and {PROXY_MAX_EDGE}"
        ));
    }
    let (width, height, rgba) = platform::embedded_preview(path, max_edge)?;
    let mut out = Vec::with_capacity(8 + rgba.len());
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    out.extend_from_slice(&rgba);
    Ok(out)
}

#[tauri::command]
fn extract_embedded_preview(
    path: String,
    max_edge: u32,
) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(embedded_preview_payload(
        &path, max_edge,
    )?))
}

#[tauri::command]
fn probe_raw(path: String, max_edge: u32, intent: RawDecodeIntent) -> Result<RawProbe, String> {
    if max_edge == 0 || max_edge > PROXY_MAX_EDGE {
        return Err(format!(
            "bounded RAW probe edge must be between 1 and {PROXY_MAX_EDGE}"
        ));
    }
    intent.validate()?;
    platform::probe(&path, max_edge, &intent)
}

pub fn probe_for_preview(
    path: &str,
    max_edge: u32,
    intent: &RawDecodeIntent,
) -> Result<RawProbe, String> {
    if max_edge == 0 || max_edge > PROXY_MAX_EDGE {
        return Err(format!(
            "bounded RAW probe edge must be between 1 and {PROXY_MAX_EDGE}"
        ));
    }
    intent.validate()?;
    platform::probe(path, max_edge, intent)
}

pub fn decode_to_frame(
    path: &str,
    max_edge: u32,
    intent: &RawDecodeIntent,
) -> Result<DecodedRaw, String> {
    if max_edge == 0 || max_edge > PROXY_MAX_EDGE {
        return Err(format!(
            "bounded RAW decode edge must be between 1 and {PROXY_MAX_EDGE}"
        ));
    }
    intent.validate()?;
    platform::decode(path, max_edge, intent)
}

pub fn decode_full_resolution(path: &str, intent: &RawDecodeIntent) -> Result<DecodedRaw, String> {
    intent.validate()?;
    platform::decode(path, u32::MAX, intent)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("raw-decode")
        .invoke_handler(tauri::generate_handler![
            decode_raw_rgba16,
            probe_raw,
            raw_decoder_capabilities,
            probe_image_metadata,
            extract_embedded_preview
        ])
        .build()
}

#[cfg(target_os = "macos")]
mod platform {
    use std::ptr::NonNull;
    use std::sync::{Mutex, OnceLock};

    use monet_photo_core::{
        AlphaMode, DecodeProvenance, DevelopFrame, OrientationState, PixelEncoding,
    };
    use objc2::rc::{autoreleasepool, Retained};
    use objc2_core_foundation::CGPoint;
    use objc2_core_graphics::{kCGColorSpaceExtendedLinearSRGB, CGColorSpace};
    use objc2_core_image::{kCIFormatRGBA16, CIContext, CIRAWFilter};
    use objc2_foundation::{NSProcessInfo, NSString, NSURL};
    use objc2_image_io::CGImagePropertyOrientation;

    use super::{
        hex_digest, reduced_scale, source_digest, validate_native_pixel_count, DecodedRaw,
        RawDecodeIntent, RawDecoderCapabilities, RawFrameMetadata, RawProbe, BACKEND,
        BACKEND_REVISION, PROXY_MAX_EDGE, WORKING_PROFILE,
    };

    static CONTEXT: OnceLock<Retained<CIContext>> = OnceLock::new();
    static DECODE_LOCK: Mutex<()> = Mutex::new(());

    fn context() -> &'static CIContext {
        CONTEXT.get_or_init(|| unsafe { CIContext::context() })
    }

    fn os_build() -> String {
        NSProcessInfo::processInfo()
            .operatingSystemVersionString()
            .to_string()
    }

    pub(super) fn checked_dim(value: f64, label: &str) -> Result<u32, String> {
        if !value.is_finite() || value <= 0.0 || value > u32::MAX as f64 {
            return Err(format!("RAW {label} is invalid: {value}"));
        }
        Ok(value.round() as u32)
    }

    fn configure(filter: &CIRAWFilter, scale: f32, draft: bool, intent: &RawDecodeIntent) {
        unsafe {
            filter.setDraftModeEnabled(draft);
            filter.setScaleFactor(scale);
            filter.setExposure(0.0);
            filter.setBaselineExposure(0.0);
            filter.setShadowBias(0.0);
            filter.setBoostAmount(0.0);
            filter.setBoostShadowAmount(0.0);
            filter.setGamutMappingEnabled(false);
            filter.setLensCorrectionEnabled(false);
            filter.setLuminanceNoiseReductionAmount(0.0);
            filter.setColorNoiseReductionAmount(0.0);
            filter.setSharpnessAmount(0.0);
            filter.setContrastAmount(0.0);
            filter.setDetailAmount(0.0);
            filter.setMoireReductionAmount(0.0);
            filter.setLocalToneMapAmount(0.0);
            filter.setExtendedDynamicRangeAmount(0.0);
            if intent.mode == "neutralChromaticity" {
                filter.setNeutralChromaticity(CGPoint::new(
                    intent.x.expect("validated x"),
                    intent.y.expect("validated y"),
                ));
            }
        }
    }

    /// Convert Core Image's un-oriented, scaled output extent back to its
    /// lower-left-origin native source coordinate system.
    pub(super) fn source_active_area(
        origin_x: f64,
        origin_y: f64,
        width: f64,
        height: f64,
        scale: f32,
        native_width: u32,
        native_height: u32,
    ) -> Result<[u32; 4], String> {
        let scale = f64::from(scale);
        if !scale.is_finite() || scale <= 0.0 {
            return Err("RAW source scale is invalid".into());
        }
        if native_width == 0
            || native_height == 0
            || ![origin_x, origin_y, width, height]
                .into_iter()
                .all(f64::is_finite)
            || width <= 0.0
            || height <= 0.0
        {
            return Err("RAW source extent is invalid".into());
        }
        let source = [
            origin_x / scale,
            origin_y / scale,
            (origin_x + width) / scale,
            (origin_y + height) / scale,
        ];
        if source
            .into_iter()
            .any(|value| !value.is_finite() || value.abs() > f64::from(u32::MAX))
        {
            return Err("RAW source extent is outside the supported coordinate range".into());
        }
        let x0 = source[0].floor().clamp(0.0, f64::from(native_width));
        let y0 = source[1].floor().clamp(0.0, f64::from(native_height));
        let x1 = source[2].ceil().clamp(0.0, f64::from(native_width));
        let y1 = source[3].ceil().clamp(0.0, f64::from(native_height));
        if x1 <= x0 || y1 <= y0 {
            return Err("RAW source active area is empty".into());
        }
        let area = [x0 as u32, y0 as u32, (x1 - x0) as u32, (y1 - y0) as u32];
        if area[2] == 0
            || area[3] == 0
            || area[0]
                .checked_add(area[2])
                .is_none_or(|end| end > native_width)
            || area[1]
                .checked_add(area[3])
                .is_none_or(|end| end > native_height)
        {
            return Err("RAW source active area is outside native bounds".into());
        }
        Ok(area)
    }

    pub fn decode(
        path: &str,
        max_edge: u32,
        intent: &RawDecodeIntent,
    ) -> Result<DecodedRaw, String> {
        let source_digest = source_digest(path)?;
        let decode_intent_digest = intent.digest()?;
        let _decode_guard = DECODE_LOCK
            .lock()
            .map_err(|_| "RAW decoder concurrency lock is poisoned".to_string())?;
        autoreleasepool(|_| {
            let path_string = NSString::from_str(path);
            let url = NSURL::fileURLWithPath(&path_string);
            let filter = unsafe { CIRAWFilter::filterWithImageURL(&url) }
                .ok_or_else(|| format!("Core Image does not support this RAW file: {path}"))?;

            let native = unsafe { filter.nativeSize() };
            let native_width = checked_dim(native.width, "native width")?;
            let native_height = checked_dim(native.height, "native height")?;
            validate_native_pixel_count(native_width, native_height)?;
            let scale = (max_edge as f64 / native_width.max(native_height) as f64).min(1.0) as f32;

            configure(&filter, scale, super::draft_mode_for(max_edge), intent);

            let source_orientation = unsafe { filter.orientation() };
            unsafe { filter.setOrientation(CGImagePropertyOrientation::Up) };
            let neutral_temperature = unsafe { filter.neutralTemperature() };
            let neutral_tint = unsafe { filter.neutralTint() };
            let decoder_version = unsafe { filter.decoderVersion() }.to_string();
            let unoriented = unsafe { filter.outputImage() }
                .ok_or_else(|| "Core Image RAW decoder produced no image".to_string())?;
            let source_extent = unsafe { unoriented.extent() };
            let active_area = source_active_area(
                source_extent.origin.x,
                source_extent.origin.y,
                source_extent.size.width,
                source_extent.size.height,
                scale,
                native_width,
                native_height,
            )?;
            let image = if source_orientation == CGImagePropertyOrientation::Up {
                unoriented
            } else {
                unsafe { unoriented.imageByApplyingOrientation(source_orientation as i32) }
            };
            let extent = unsafe { image.extent() };
            let width = checked_dim(extent.size.width, "output width")?;
            let height = checked_dim(extent.size.height, "output height")?;
            let samples = u64::from(width)
                .checked_mul(u64::from(height))
                .and_then(|n| n.checked_mul(4))
                .ok_or("RAW sample count overflow")?;
            let mut pixels = vec![
                0_u16;
                usize::try_from(samples)
                    .map_err(|_| "RAW sample count exceeds address space")?
            ];
            let color_space =
                CGColorSpace::with_name(Some(unsafe { kCGColorSpaceExtendedLinearSRGB }))
                    .ok_or_else(|| "extended-linear-sRGB color space is unavailable".to_string())?;
            let row_bytes = usize::try_from(width)
                .ok()
                .and_then(|n| n.checked_mul(8))
                .and_then(|n| isize::try_from(n).ok())
                .ok_or("RAW row byte count overflow")?;
            unsafe {
                context().render_toBitmap_rowBytes_bounds_format_colorSpace(
                    &image,
                    NonNull::new(pixels.as_mut_ptr().cast()).expect("non-empty frame"),
                    row_bytes,
                    extent,
                    kCIFormatRGBA16,
                    Some(&color_space),
                );
            }
            // RAW has no product alpha. Core Image may emit edge coverage after
            // orientation; normalize the contract before validation/interchange.
            for pixel in pixels.chunks_exact_mut(4) {
                pixel[3] = u16::MAX;
            }

            let os_build = os_build();
            let working_profile_digest = hex_digest(WORKING_PROFILE.as_bytes());
            let provenance = DecodeProvenance {
                source_digest,
                backend: BACKEND.into(),
                backend_revision: BACKEND_REVISION.into(),
                decoder_version: decoder_version.clone(),
                active_area,
                working_profile_digest,
                decode_intent_digest,
                alpha_mode: AlphaMode::Opaque,
            };
            let frame = DevelopFrame::new(
                width,
                height,
                pixels,
                PixelEncoding::LinearSrgbU16Full,
                OrientationState {
                    source_exif: source_orientation as u8,
                    output_exif: 1,
                },
                provenance,
            )
            .map_err(str::to_string)?;
            let (scale_numerator, scale_denominator) =
                reduced_scale(width, height, native_width, native_height);
            let mut metadata = RawFrameMetadata {
                native_width,
                native_height,
                source_orientation: frame.orientation.source_exif,
                output_width: frame.width,
                output_height: frame.height,
                active_area: frame.provenance.active_area,
                output_orientation: frame.orientation.output_exif,
                orientation_applied: source_orientation != CGImagePropertyOrientation::Up,
                decoder_backend: BACKEND.into(),
                backend_revision: BACKEND_REVISION.into(),
                decoder_version,
                os_build,
                color_space: WORKING_PROFILE.into(),
                sample_format: "uint16".into(),
                channel_order: "rgba".into(),
                color_model: "profiled-scene-linear-reference-rgb".into(),
                transfer: "linear".into(),
                range: "full".into(),
                alpha: "opaque".into(),
                base_rendering: "core-image-camera-profile".into(),
                white_balance_mode: intent.mode.clone(),
                neutral_temperature,
                neutral_tint,
                scale_numerator,
                scale_denominator,
                provenance_digest: String::new(),
                source_digest: frame.provenance.source_digest.clone(),
                working_profile_digest: frame.provenance.working_profile_digest.clone(),
                decode_intent_digest: frame.provenance.decode_intent_digest.clone(),
            };
            metadata.provenance_digest = super::raw_metadata_provenance_digest(&metadata)?;
            Ok(DecodedRaw { frame, metadata })
        })
    }

    pub fn capabilities() -> Result<RawDecoderCapabilities, String> {
        let supported_camera_models = autoreleasepool(|_| unsafe {
            CIRAWFilter::supportedCameraModels()
                .iter()
                .map(|model| model.to_string())
                .collect()
        });
        Ok(RawDecoderCapabilities {
            available: true,
            backend: BACKEND,
            backend_revision: BACKEND_REVISION,
            os_build: os_build(),
            output_color_space: WORKING_PROFILE,
            output_bit_depth: 16,
            proxy_max_edge: PROXY_MAX_EDGE,
            supported_camera_models,
            note: "Camera support follows the installed macOS RAW compatibility update; DNG support is generic and is not enumerated as a camera model.",
        })
    }

    pub fn probe(path: &str, max_edge: u32, intent: &RawDecodeIntent) -> Result<RawProbe, String> {
        autoreleasepool(|_| {
            let url = NSURL::fileURLWithPath(&NSString::from_str(path));
            let filter = unsafe { CIRAWFilter::filterWithImageURL(&url) }
                .ok_or_else(|| format!("Core Image does not support this RAW file: {path}"))?;
            let native = unsafe { filter.nativeSize() };
            let native_width = checked_dim(native.width, "native width")?;
            let native_height = checked_dim(native.height, "native height")?;
            validate_native_pixel_count(native_width, native_height)?;
            let scale = (max_edge as f64 / native_width.max(native_height) as f64).min(1.0) as f32;
            configure(&filter, scale, super::draft_mode_for(max_edge), intent);
            let source_orientation = unsafe { filter.orientation() };
            unsafe { filter.setOrientation(CGImagePropertyOrientation::Up) };
            let unoriented = unsafe { filter.outputImage() }
                .ok_or_else(|| "Core Image RAW decoder produced no probe image".to_string())?;
            let source_extent = unsafe { unoriented.extent() };
            let active_area = source_active_area(
                source_extent.origin.x,
                source_extent.origin.y,
                source_extent.size.width,
                source_extent.size.height,
                scale,
                native_width,
                native_height,
            )?;
            let image = if source_orientation == CGImagePropertyOrientation::Up {
                unoriented
            } else {
                unsafe { unoriented.imageByApplyingOrientation(source_orientation as i32) }
            };
            let extent = unsafe { image.extent() };
            let output_width = checked_dim(extent.size.width, "probe output width")?;
            let output_height = checked_dim(extent.size.height, "probe output height")?;
            let (scale_numerator, scale_denominator) =
                reduced_scale(output_width, output_height, native_width, native_height);
            Ok(RawProbe {
                decoder_backend: BACKEND,
                backend_revision: BACKEND_REVISION,
                decoder_version: unsafe { filter.decoderVersion() }.to_string(),
                os_build: os_build(),
                native_width,
                native_height,
                active_area,
                source_orientation: source_orientation as u8,
                output_orientation: 1,
                orientation_applied: source_orientation != CGImagePropertyOrientation::Up,
                working_profile_digest: hex_digest(WORKING_PROFILE.as_bytes()),
                output_width,
                output_height,
                scale_numerator,
                scale_denominator,
            })
        })
    }

    /// Decode ONLY the source's embedded preview/thumbnail via ImageIO — the
    /// camera's own JPEG, no CIRAWFilter demosaic. Oriented, long edge
    /// ≤ `max_edge`, returned as `(width, height, sRGB RGBA8)`. Errors when the
    /// file has no embedded preview so the caller falls back to a real decode.
    /// Deliberately does NOT take `DECODE_LOCK`: the point of the fast tier is
    /// to never queue behind demosaics, and CIContext rendering is thread-safe.
    pub fn embedded_preview(path: &str, max_edge: u32) -> Result<(u32, u32, Vec<u8>), String> {
        use objc2_core_foundation::{
            CFBoolean, CFDictionary, CFNumber, CFRetained, CFString, CFType, CFURL,
            CFURLPathStyle,
        };
        use objc2_core_graphics::{kCGColorSpaceSRGB, CGImage};
        use objc2_core_image::{kCIFormatRGBA8, CIImage};
        use objc2_image_io::{
            kCGImageSourceCreateThumbnailWithTransform, kCGImageSourceThumbnailMaxPixelSize,
            CGImageSource,
        };

        // objc2-image-io's own `thumbnail_at_index` binding is feature-gated
        // out of this build; ImageIO is already linked, so declare the one
        // symbol directly with the generics we actually pass.
        extern "C-unwind" {
            fn CGImageSourceCreateThumbnailAtIndex(
                isrc: &CGImageSource,
                index: usize,
                options: Option<&CFDictionary<CFString, CFType>>,
            ) -> Option<NonNull<CGImage>>;
        }

        autoreleasepool(|_| {
            let cf_path = CFString::from_str(path);
            let url = CFURL::with_file_system_path(
                None,
                Some(&cf_path),
                CFURLPathStyle::CFURLPOSIXPathStyle,
                false,
            )
            .ok_or("embedded preview source path is invalid")?;
            let source = unsafe { CGImageSource::with_url(&url, None) }
                .ok_or_else(|| format!("embedded preview source is unreadable: {path}"))?;
            // No CreateThumbnailFromImage* keys: ImageIO returns the embedded
            // preview or nothing — this path must never demosaic as a fallback.
            let max_pixel = CFNumber::new_i64(i64::from(max_edge));
            let max_pixel_value: &CFType = &max_pixel;
            let oriented: &CFType = CFBoolean::new(true);
            let options = CFDictionary::from_slices(
                &[
                    unsafe { kCGImageSourceThumbnailMaxPixelSize },
                    unsafe { kCGImageSourceCreateThumbnailWithTransform },
                ],
                &[max_pixel_value, oriented],
            );
            let image = unsafe { CGImageSourceCreateThumbnailAtIndex(&source, 0, Some(&options)) }
                .map(|ptr| unsafe { CFRetained::from_raw(ptr) })
                .ok_or_else(|| format!("no embedded preview in this source: {path}"))?;
            // ponytail: index 0 + MaxPixelSize serves the review/thumbnail
            // tier; enumerating every embedded image for the largest full-size
            // preview is the upgrade path if Embedded ever feeds the Loupe.
            let ci = unsafe { CIImage::imageWithCGImage(&image) };
            let extent = unsafe { ci.extent() };
            let width = checked_dim(extent.size.width, "embedded preview width")?;
            let height = checked_dim(extent.size.height, "embedded preview height")?;
            if width.max(height) > max_edge {
                return Err("embedded preview exceeds the requested edge".into());
            }
            let samples = usize::try_from(width)
                .ok()
                .and_then(|w| usize::try_from(height).ok().and_then(|h| w.checked_mul(h)))
                .and_then(|n| n.checked_mul(4))
                .ok_or("embedded preview sample count overflow")?;
            let mut rgba = vec![0_u8; samples];
            let color_space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))
                .ok_or("sRGB color space is unavailable")?;
            let row_bytes = isize::try_from(width)
                .ok()
                .and_then(|w| w.checked_mul(4))
                .ok_or("embedded preview row byte count overflow")?;
            unsafe {
                context().render_toBitmap_rowBytes_bounds_format_colorSpace(
                    &ci,
                    NonNull::new(rgba.as_mut_ptr().cast()).expect("non-empty preview"),
                    row_bytes,
                    extent,
                    kCIFormatRGBA8,
                    Some(&color_space),
                );
            }
            // Camera previews are opaque JPEGs; normalize alpha like decode().
            for pixel in rgba.chunks_exact_mut(4) {
                pixel[3] = u8::MAX;
            }
            Ok((width, height, rgba))
        })
    }

    /// Fill EXIF-derived fields from ImageIO's uniform property dictionaries
    /// (works for RAW and encoded formats alike). Absent or unreadable
    /// metadata is not an error: a file without EXIF imports normally, so
    /// every extraction below is best-effort and the probe simply reports
    /// which fields were present.
    pub fn fill_image_exif(path: &str, probe: &mut super::ImageMetadataProbe) {
        use std::ffi::c_void;

        use objc2_core_foundation::{
            CFArray, CFDictionary, CFNumber, CFNumberType, CFRetained, CFString, CFType, CFURL,
            CFURLPathStyle,
        };
        use objc2_image_io::{
            kCGImagePropertyExifDateTimeDigitized, kCGImagePropertyExifDateTimeOriginal,
            kCGImagePropertyExifDictionary, kCGImagePropertyExifExposureTime,
            kCGImagePropertyExifFNumber, kCGImagePropertyExifFocalLength,
            kCGImagePropertyExifISOSpeedRatings, kCGImagePropertyExifLensModel,
            kCGImagePropertyGPSDictionary, kCGImagePropertyGPSLatitude,
            kCGImagePropertyGPSLatitudeRef, kCGImagePropertyGPSLongitude,
            kCGImagePropertyGPSLongitudeRef, kCGImagePropertyIPTCByline,
            kCGImagePropertyIPTCBylineTitle, kCGImagePropertyIPTCCaptionAbstract,
            kCGImagePropertyIPTCCity, kCGImagePropertyIPTCCopyrightNotice,
            kCGImagePropertyIPTCCountryPrimaryLocationName, kCGImagePropertyIPTCCredit,
            kCGImagePropertyIPTCDictionary, kCGImagePropertyIPTCKeywords,
            kCGImagePropertyIPTCObjectName, kCGImagePropertyIPTCProvinceState,
            kCGImagePropertyIPTCSource, kCGImagePropertyIPTCStarRating,
            kCGImagePropertyTIFFDictionary, kCGImagePropertyTIFFMake, kCGImagePropertyTIFFModel,
            CGImageSource,
        };

        fn get<'a>(dict: &'a CFDictionary, key: &CFString) -> Option<&'a CFType> {
            let ptr = unsafe { dict.value(key as *const CFString as *const c_void) };
            (!ptr.is_null()).then(|| unsafe { &*(ptr as *const CFType) })
        }
        fn sub<'a>(dict: &'a CFDictionary, key: &CFString) -> Option<&'a CFDictionary> {
            get(dict, key)?.downcast_ref::<CFDictionary>()
        }
        fn string(dict: &CFDictionary, key: &CFString) -> Option<String> {
            get(dict, key)?.downcast_ref::<CFString>().map(|s| s.to_string())
        }
        fn number(value: &CFType) -> Option<f64> {
            let number = value.downcast_ref::<CFNumber>()?;
            let mut out = 0_f64;
            let read = unsafe {
                number.value(
                    CFNumberType::Float64Type,
                    &mut out as *mut f64 as *mut c_void,
                )
            };
            (read && out.is_finite()).then_some(out)
        }
        fn f64_of(dict: &CFDictionary, key: &CFString) -> Option<f64> {
            number(get(dict, key)?)
        }
        fn cf_string(value: &CFType) -> Option<String> {
            value.downcast_ref::<CFString>().map(|s| s.to_string())
        }
        fn array_strings(value: &CFType) -> Vec<String> {
            let Some(array) = value.downcast_ref::<CFArray>() else {
                return Vec::new();
            };
            (0..array.count())
                .filter_map(|i| {
                    let ptr = unsafe { array.value_at_index(i) };
                    (!ptr.is_null())
                        .then(|| unsafe { &*(ptr as *const CFType) })
                        .and_then(cf_string)
                })
                .collect()
        }
        /// Repeatable IPTC fields (Byline, BylineTitle) arrive as a CFArray
        /// from an XMP bridge but as a plain CFString from some IRB writers —
        /// accept both, first entry wins (matching Lightroom's single field).
        fn string_or_first(dict: &CFDictionary, key: &CFString) -> Option<String> {
            let value = get(dict, key)?;
            cf_string(value).or_else(|| array_strings(value).into_iter().next())
        }
        fn strings(dict: &CFDictionary, key: &CFString) -> Vec<String> {
            let Some(value) = get(dict, key) else {
                return Vec::new();
            };
            cf_string(value).map_or_else(|| array_strings(value), |s| vec![s])
        }

        probe.available = true;
        let cf_path = CFString::from_str(path);
        let Some(url) = CFURL::with_file_system_path(
            None,
            Some(&cf_path),
            CFURLPathStyle::CFURLPOSIXPathStyle,
            false,
        ) else {
            return;
        };
        let Some(source) = (unsafe { CGImageSource::with_url(&url, None) }) else {
            return;
        };
        let Some(properties): Option<CFRetained<CFDictionary>> =
            (unsafe { source.properties_at_index(0, None) })
        else {
            return;
        };

        if let Some(tiff) = sub(&properties, unsafe { kCGImagePropertyTIFFDictionary }) {
            probe.camera_make = string(tiff, unsafe { kCGImagePropertyTIFFMake });
            probe.camera_model = string(tiff, unsafe { kCGImagePropertyTIFFModel });
        }
        if let Some(exif) = sub(&properties, unsafe { kCGImagePropertyExifDictionary }) {
            probe.capture_time = string(exif, unsafe { kCGImagePropertyExifDateTimeOriginal })
                .or_else(|| string(exif, unsafe { kCGImagePropertyExifDateTimeDigitized }))
                .as_deref()
                .and_then(super::parse_exif_datetime);
            probe.lens = string(exif, unsafe { kCGImagePropertyExifLensModel });
            // Cameras write 0 for unknown aperture/focal/shutter (manual
            // lenses); zero is physically impossible, so treat it as absent.
            probe.f_number =
                f64_of(exif, unsafe { kCGImagePropertyExifFNumber }).filter(|v| *v > 0.0);
            probe.focal_length =
                f64_of(exif, unsafe { kCGImagePropertyExifFocalLength }).filter(|v| *v > 0.0);
            probe.exposure_time =
                f64_of(exif, unsafe { kCGImagePropertyExifExposureTime }).filter(|v| *v > 0.0);
            probe.iso = get(exif, unsafe { kCGImagePropertyExifISOSpeedRatings })
                .and_then(|value| value.downcast_ref::<CFArray>())
                .and_then(|ratings| {
                    (ratings.count() > 0)
                        .then(|| unsafe { ratings.value_at_index(0) })
                        .filter(|ptr| !ptr.is_null())
                        .and_then(|ptr| number(unsafe { &*(ptr as *const CFType) }))
                })
                .map(|iso| iso.round() as i64)
                .filter(|iso| *iso > 0);
        }
        if let Some(gps) = sub(&properties, unsafe { kCGImagePropertyGPSDictionary }) {
            probe.gps_lat = f64_of(gps, unsafe { kCGImagePropertyGPSLatitude }).and_then(|lat| {
                super::gps_signed(
                    lat,
                    string(gps, unsafe { kCGImagePropertyGPSLatitudeRef }).as_deref(),
                )
            });
            probe.gps_lon = f64_of(gps, unsafe { kCGImagePropertyGPSLongitude }).and_then(|lon| {
                super::gps_signed(
                    lon,
                    string(gps, unsafe { kCGImagePropertyGPSLongitudeRef }).as_deref(),
                )
            });
        }
        if let Some(iptc) = sub(&properties, unsafe { kCGImagePropertyIPTCDictionary }) {
            probe.title = string(iptc, unsafe { kCGImagePropertyIPTCObjectName });
            probe.caption = string(iptc, unsafe { kCGImagePropertyIPTCCaptionAbstract });
            probe.creator = string_or_first(iptc, unsafe { kCGImagePropertyIPTCByline });
            probe.copyright = string(iptc, unsafe { kCGImagePropertyIPTCCopyrightNotice });
            probe.city = string(iptc, unsafe { kCGImagePropertyIPTCCity });
            probe.state_province = string(iptc, unsafe { kCGImagePropertyIPTCProvinceState });
            probe.country = string(iptc, unsafe {
                kCGImagePropertyIPTCCountryPrimaryLocationName
            });
            probe.job_title = string_or_first(iptc, unsafe { kCGImagePropertyIPTCBylineTitle });
            probe.credit = string(iptc, unsafe { kCGImagePropertyIPTCCredit });
            probe.source = string(iptc, unsafe { kCGImagePropertyIPTCSource });
            probe.keywords = strings(iptc, unsafe { kCGImagePropertyIPTCKeywords });
            probe.rating = f64_of(iptc, unsafe { kCGImagePropertyIPTCStarRating })
                .map(|r| (r.round() as i64).clamp(0, 5))
                .filter(|r| *r > 0);
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{
        DecodedRaw, RawDecodeIntent, RawDecoderCapabilities, RawProbe, BACKEND_REVISION,
        PROXY_MAX_EDGE, WORKING_PROFILE,
    };

    pub fn decode(
        _path: &str,
        _max_edge: u32,
        _intent: &RawDecodeIntent,
    ) -> Result<DecodedRaw, String> {
        Err("native camera-RAW decode is currently available on macOS only".into())
    }

    pub fn capabilities() -> Result<RawDecoderCapabilities, String> {
        Ok(RawDecoderCapabilities {
            available: false,
            backend: "unsupported",
            backend_revision: BACKEND_REVISION,
            os_build: std::env::consts::OS.into(),
            output_color_space: WORKING_PROFILE,
            output_bit_depth: 16,
            proxy_max_edge: PROXY_MAX_EDGE,
            supported_camera_models: Vec::new(),
            note: "A Windows decoder adapter is not installed.",
        })
    }

    pub fn probe(
        _path: &str,
        _max_edge: u32,
        _intent: &RawDecodeIntent,
    ) -> Result<RawProbe, String> {
        Err("native camera-RAW decode is currently available on macOS only".into())
    }

    /// EXIF extraction has no non-macOS backend yet; `available` stays false
    /// and the import proceeds with the file-system fields only.
    pub fn fill_image_exif(_path: &str, _probe: &mut super::ImageMetadataProbe) {}

    pub fn embedded_preview(_path: &str, _max_edge: u32) -> Result<(u32, u32, Vec<u8>), String> {
        Err("embedded preview extraction is currently available on macOS only".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use monet_photo_core::{AlphaMode, DecodeProvenance, OrientationState, PixelEncoding};

    #[test]
    fn exif_datetime_parses_utc_and_rejects_placeholders() {
        assert_eq!(parse_exif_datetime("2014:06:22 15:19:04"), Some(1403450344));
        assert_eq!(parse_exif_datetime("2024:02:29 12:00:00"), Some(1709208000));
        assert_eq!(parse_exif_datetime("1970:01:01 00:00:00"), Some(0));
        assert_eq!(parse_exif_datetime("2026:07:17 23:59:59"), Some(1784332799));
        assert_eq!(parse_exif_datetime(" 2014:06:22 15:19:04 "), Some(1403450344));
        for rejected in [
            "0000:00:00 00:00:00",
            "2014:00:22 15:19:04",
            "2014:13:22 15:19:04",
            "2014:06:32 15:19:04",
            "2014:06:22 24:19:04",
            "2014:06:22 15:60:04",
            "2014:06:22",
            "2014:06:22 15:19",
            "2014:06:22 15:19:04:05",
            "2014:06:22:01 15:19:04",
            "not a date at all",
            "",
        ] {
            assert_eq!(parse_exif_datetime(rejected), None, "{rejected:?}");
        }
    }

    #[test]
    fn gps_reference_signs_are_applied() {
        assert_eq!(gps_signed(46.05, Some("N")), Some(46.05));
        assert_eq!(gps_signed(46.05, Some("S")), Some(-46.05));
        assert_eq!(gps_signed(14.51, Some("E")), Some(14.51));
        assert_eq!(gps_signed(14.51, Some("W")), Some(-14.51));
        assert_eq!(gps_signed(14.51, Some(" W ")), Some(-14.51));
        assert_eq!(gps_signed(14.51, None), Some(14.51));
        assert_eq!(gps_signed(f64::NAN, Some("N")), None);
        assert_eq!(gps_signed(f64::INFINITY, Some("S")), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn probe_image_metadata_reads_the_colorchecker_fixture_exif() {
        let path = "target/raw-fixtures/colorchecker-sony-ilce-7m2.arw";
        assert!(
            std::path::Path::new(path).exists(),
            "fixture 967 must be acquired before tests (pnpm proof:raw-acquire)"
        );
        let probe = probe_image_metadata(path.into()).unwrap();
        assert!(probe.available);
        assert!(probe.mtime.is_some());
        assert_eq!(probe.camera_make.as_deref(), Some("SONY"));
        assert_eq!(probe.camera_model.as_deref(), Some("ILCE-7M2"));
        // 2016:02:15 12:53:49 (DateTimeOriginal), interpreted as UTC.
        assert_eq!(probe.capture_time, Some(1455540829));
        assert_eq!(probe.iso, Some(100));
        assert_eq!(probe.exposure_time, Some(0.004));
        // The fixture was shot with a manual (non-electronic) lens: the file
        // writes FNumber 0 / FocalLength 0, which must read back as absent.
        assert_eq!(probe.f_number, None);
        assert_eq!(probe.focal_length, None);
        assert_eq!(probe.lens.as_deref(), Some("----"));
    }

    /// A plain 8x8 grey JPEG (sips output: JFIF + Exif + empty Photoshop APP13
    /// + scan data), hex-encoded so the test needs no on-disk fixture.
    #[cfg(target_os = "macos")]
    const PLAIN_JPEG_HEX: &str = concat!(
        "ffd8ffe000104a46494600010100004800480000ffe1004c4578696600004d4d002a00000008",
        "000187690004000000010000001a000000000003a00100030000000100010000a00200040000",
        "000100000008a0030004000000010000000800000000ffed003850686f746f73686f7020332e",
        "30003842494d04040000000000003842494d0425000000000010d41d8cd98f00b204e9800998",
        "ecf8427effc00011080008000803012200021101031101ffc4001f0000010501010101010100",
        "000000000000000102030405060708090a0bffc400b510000201030302040305050404000001",
        "7d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282",
        "090a161718191a25262728292a3435363738393a434445464748494a535455565758595a6364",
        "65666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8",
        "a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9",
        "eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405",
        "060708090a0bffc400b511000201020404030407050404000102770001020311040521310612",
        "41510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a2627",
        "28292a35363738393a434445464748494a535455565758595a636465666768696a7374757677",
        "78797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9",
        "bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faff",
        "db004300020202020202030202030503030305060505050506080606060606080a0808080808",
        "080a0a0a0a0a0a0a0a0c0c0c0c0c0c0e0e0e0e0e0f0f0f0f0f0f0f0f0f0fffdb004301020202",
        "04040407040407100b090b101010101010101010101010101010101010101010101010101010",
        "1010101010101010101010101010101010101010101010ffdd00040001ffda000c0301000211",
        "0311003f0028a28a00ffd9",
    );

    /// Splice a Lightroom-shaped XMP packet into the plain JPEG as an APP1
    /// segment right after SOI, and probe it: ImageIO must bridge dc:*,
    /// photoshop:* and xmp:Rating into the `{IPTC}` dictionary the probe reads
    /// — the exact path an LR-tagged library takes at import.
    #[cfg(target_os = "macos")]
    #[test]
    fn probe_image_metadata_reads_embedded_xmp_iptc() {
        let base: Vec<u8> = (0..PLAIN_JPEG_HEX.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&PLAIN_JPEG_HEX[i..i + 2], 16).unwrap())
            .collect();
        let xmp = concat!(
            r#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">"#,
            r#"<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/""#,
            r#" xmp:Rating="3" photoshop:City="Ljubljana" photoshop:State="SI" photoshop:Country="Slovenia" photoshop:Credit="Agency" photoshop:Source="Wire" photoshop:AuthorsPosition="Photographer">"#,
            r#"<dc:title><rdf:Alt><rdf:li xml:lang="x-default">A title</rdf:li></rdf:Alt></dc:title>"#,
            r#"<dc:description><rdf:Alt><rdf:li xml:lang="x-default">A caption</rdf:li></rdf:Alt></dc:description>"#,
            r#"<dc:creator><rdf:Seq><rdf:li>Jane Doe</rdf:li></rdf:Seq></dc:creator>"#,
            r#"<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">(c) Jane</rdf:li></rdf:Alt></dc:rights>"#,
            r#"<dc:subject><rdf:Bag><rdf:li>alpha</rdf:li><rdf:li>beta</rdf:li></rdf:Bag></dc:subject>"#,
            r#"</rdf:Description></rdf:RDF></x:xmpmeta>"#,
        );
        let mut payload = b"http://ns.adobe.com/xap/1.0/\0".to_vec();
        payload.extend_from_slice(xmp.as_bytes());
        let mut jpeg = base[..2].to_vec(); // SOI
        jpeg.extend_from_slice(&[0xff, 0xe1]); // APP1
        jpeg.extend_from_slice(&(u16::try_from(payload.len() + 2).unwrap()).to_be_bytes());
        jpeg.extend_from_slice(&payload);
        jpeg.extend_from_slice(&base[2..]);
        let path = std::env::temp_dir().join("monet-galerie-iptc-probe-test.jpg");
        std::fs::write(&path, &jpeg).unwrap();

        let probe = probe_image_metadata(path.to_string_lossy().into_owned()).unwrap();
        std::fs::remove_file(&path).ok();
        assert!(probe.available);
        assert_eq!(probe.title.as_deref(), Some("A title"));
        assert_eq!(probe.caption.as_deref(), Some("A caption"));
        assert_eq!(probe.creator.as_deref(), Some("Jane Doe"));
        assert_eq!(probe.copyright.as_deref(), Some("(c) Jane"));
        assert_eq!(probe.city.as_deref(), Some("Ljubljana"));
        assert_eq!(probe.state_province.as_deref(), Some("SI"));
        assert_eq!(probe.country.as_deref(), Some("Slovenia"));
        assert_eq!(probe.job_title.as_deref(), Some("Photographer"));
        assert_eq!(probe.credit.as_deref(), Some("Agency"));
        assert_eq!(probe.source.as_deref(), Some("Wire"));
        assert_eq!(
            probe.keywords,
            vec!["alpha".to_string(), "beta".to_string()]
        );
        assert_eq!(probe.rating, Some(3));
    }

    /// The untagged fixture must keep reporting the IPTC fields as absent —
    /// blank, not fabricated.
    #[cfg(target_os = "macos")]
    #[test]
    fn probe_image_metadata_reports_absent_iptc_as_none() {
        let path = "target/raw-fixtures/colorchecker-sony-ilce-7m2.arw";
        assert!(
            std::path::Path::new(path).exists(),
            "fixture 967 must be acquired before tests (pnpm proof:raw-acquire)"
        );
        let probe = probe_image_metadata(path.into()).unwrap();
        assert_eq!(probe.title, None);
        assert_eq!(probe.keywords, Vec::<String>::new());
        assert_eq!(probe.rating, None);
    }

    #[test]
    fn probe_image_metadata_missing_file_is_a_clean_error() {
        let error = probe_image_metadata("/definitely/not/a/real/file.arw".into()).unwrap_err();
        assert!(error.contains("stat image source"), "{error}");
    }

    #[test]
    fn draft_mode_gates_thumbnail_class_decodes_only() {
        assert!(draft_mode_for(1));
        assert!(draft_mode_for(128));
        assert!(draft_mode_for(256));
        assert!(draft_mode_for(DRAFT_MAX_EDGE));
        assert!(!draft_mode_for(DRAFT_MAX_EDGE + 1));
        assert!(!draft_mode_for(2560)); // standard previews stay full quality
        assert!(!draft_mode_for(PROXY_MAX_EDGE));
    }

    #[test]
    fn embedded_preview_payload_checks_the_proxy_cap() {
        assert!(embedded_preview_payload("/tmp/a.arw", 0).is_err());
        assert!(embedded_preview_payload("/tmp/a.arw", PROXY_MAX_EDGE + 1).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn embedded_preview_extracts_the_camera_jpeg_from_the_arw_fixture() {
        let path = "target/raw-fixtures/colorchecker-sony-ilce-7m2.arw";
        assert!(
            std::path::Path::new(path).exists(),
            "fixture 967 must be acquired before tests (pnpm proof:raw-acquire)"
        );
        let payload = embedded_preview_payload(path, 256).unwrap();
        let width = u32::from_le_bytes(payload[..4].try_into().unwrap());
        let height = u32::from_le_bytes(payload[4..8].try_into().unwrap());
        assert!(width > 0 && height > 0);
        assert!(width.max(height) <= 256, "{width}x{height}");
        assert_eq!(payload.len(), 8 + (width * height * 4) as usize);
        // Opaque, normalized alpha throughout.
        assert!(payload[8..].chunks_exact(4).all(|px| px[3] == u8::MAX));
    }

    /// Payload shape on an encoded source: `[w, h]` header, tight RGBA8,
    /// normalized opaque alpha. (For encoded formats ImageIO may serve the
    /// tiny primary image itself — that is as cheap as an embedded thumb; the
    /// no-demosaic guarantee matters for RAW, covered by the ARW test above.)
    #[cfg(target_os = "macos")]
    #[test]
    fn embedded_preview_payload_is_a_tight_opaque_rgba8_frame() {
        let jpeg: Vec<u8> = (0..PLAIN_JPEG_HEX.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&PLAIN_JPEG_HEX[i..i + 2], 16).unwrap())
            .collect();
        let path = std::env::temp_dir().join("monet-galerie-embedded-preview-test.jpg");
        std::fs::write(&path, &jpeg).unwrap();
        let payload = embedded_preview_payload(&path.to_string_lossy(), 256).unwrap();
        std::fs::remove_file(&path).ok();
        let width = u32::from_le_bytes(payload[..4].try_into().unwrap());
        let height = u32::from_le_bytes(payload[4..8].try_into().unwrap());
        assert_eq!((width, height), (8, 8));
        assert_eq!(payload.len(), 8 + 8 * 8 * 4);
        assert!(payload[8..].chunks_exact(4).all(|px| px[3] == u8::MAX));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn embedded_preview_missing_file_is_a_clean_error() {
        assert!(platform::embedded_preview("/definitely/not/a/file.arw", 256).is_err());
    }

    fn intent() -> RawDecodeIntent {
        RawDecodeIntent {
            mode: "asShot".into(),
            x: None,
            y: None,
            derivation_digest: None,
        }
    }

    fn request(max_edge: u32, intent: &RawDecodeIntent, path: &str) -> Vec<u8> {
        let intent = serde_json::to_vec(intent).unwrap();
        let mut body = max_edge.to_le_bytes().to_vec();
        body.extend_from_slice(&(intent.len() as u32).to_le_bytes());
        body.extend_from_slice(&intent);
        body.extend_from_slice(path.as_bytes());
        body
    }

    fn decoded() -> DecodedRaw {
        let provenance = DecodeProvenance {
            source_digest: "11".repeat(32),
            backend: BACKEND.into(),
            backend_revision: BACKEND_REVISION.into(),
            decoder_version: "decoder-9".into(),
            active_area: [0, 0, 4, 2],
            working_profile_digest: "22".repeat(32),
            decode_intent_digest: "33".repeat(32),
            alpha_mode: AlphaMode::Opaque,
        };
        let frame = DevelopFrame::new(
            2,
            1,
            vec![1, 2, 3, u16::MAX, 4, 5, 6, u16::MAX],
            PixelEncoding::LinearSrgbU16Full,
            OrientationState {
                source_exif: 6,
                output_exif: 1,
            },
            provenance,
        )
        .unwrap();
        let mut metadata = RawFrameMetadata {
            native_width: 4,
            native_height: 2,
            source_orientation: 6,
            output_width: 2,
            output_height: 1,
            active_area: [0, 0, 4, 2],
            output_orientation: 1,
            orientation_applied: true,
            decoder_backend: BACKEND.into(),
            backend_revision: BACKEND_REVISION.into(),
            decoder_version: "decoder-9".into(),
            os_build: "macOS fixture".into(),
            color_space: WORKING_PROFILE.into(),
            sample_format: "uint16".into(),
            channel_order: "rgba".into(),
            color_model: "profiled-scene-linear-reference-rgb".into(),
            transfer: "linear".into(),
            range: "full".into(),
            alpha: "opaque".into(),
            base_rendering: "core-image-camera-profile".into(),
            white_balance_mode: "asShot".into(),
            neutral_temperature: 5200.0,
            neutral_tint: 0.0,
            scale_numerator: 1,
            scale_denominator: 2,
            provenance_digest: String::new(),
            source_digest: "11".repeat(32),
            working_profile_digest: "22".repeat(32),
            decode_intent_digest: "33".repeat(32),
        };
        metadata.provenance_digest = raw_metadata_provenance_digest(&metadata).unwrap();
        DecodedRaw { frame, metadata }
    }

    #[test]
    fn request_checks_intent_and_proxy_cap() {
        let body = request(2560, &intent(), "/tmp/camera.CR3");
        assert_eq!(
            parse_request(&body).unwrap(),
            DecodeRequest {
                path: "/tmp/camera.CR3".into(),
                max_edge: 2560,
                intent: intent(),
            }
        );
        assert!(parse_request(&request(0, &intent(), "/tmp/a.raw")).is_err());
        assert!(parse_request(&request(PROXY_MAX_EDGE + 1, &intent(), "/tmp/a.raw")).is_err());
        assert!(parse_request(b"bad").is_err());
    }

    #[test]
    fn response_header_is_stable_and_samples_are_little_endian() {
        let packed = pack_frame(&decoded()).unwrap();
        assert_eq!(&packed[..4], MAGIC);
        assert_eq!(
            u16::from_le_bytes(packed[4..6].try_into().unwrap()),
            PROTOCOL_VERSION
        );
        assert_eq!(
            u16::from_le_bytes(packed[6..8].try_into().unwrap()),
            FIXED_HEADER_LEN
        );
        assert_eq!(u64::from_le_bytes(packed[32..40].try_into().unwrap()), 8);
        assert_eq!(&packed[packed.len() - 4..], &[6, 0, 255, 255]);
    }

    #[test]
    fn native_source_pixel_policy_is_checked_before_allocation() {
        assert!(validate_native_pixel_count(12_000, 10_000).is_ok());
        assert!(validate_native_pixel_count(12_001, 10_000).is_err());
        assert!(validate_native_pixel_count(u32::MAX, u32::MAX).is_err());
    }

    #[test]
    fn native_provenance_digest_recomputes_every_typed_field() {
        let valid = decoded().metadata;
        validate_raw_metadata_provenance(&valid).unwrap();
        let value = serde_json::to_value(&valid).unwrap();
        for field in value.as_object().unwrap().keys() {
            if field == "provenanceDigest" {
                continue;
            }
            let mut changed = value.clone();
            let part = &mut changed.as_object_mut().unwrap()[field];
            match part {
                serde_json::Value::Bool(value) => *value = !*value,
                serde_json::Value::Number(value) => {
                    *value = match value.as_u64() {
                        Some(value) => serde_json::Number::from(value + 1),
                        None => {
                            serde_json::Number::from_f64(value.as_f64().unwrap() + 1.0).unwrap()
                        }
                    }
                }
                serde_json::Value::String(value) => value.push('x'),
                serde_json::Value::Array(value) => {
                    value[0] = serde_json::Value::from(value[0].as_u64().unwrap() + 1)
                }
                _ => panic!("unsupported metadata field {field}"),
            }
            let changed: RawFrameMetadata = serde_json::from_value(changed).unwrap();
            assert!(
                validate_raw_metadata_provenance(&changed).is_err(),
                "{field}"
            );
        }
        let mut arbitrary = valid;
        arbitrary.provenance_digest = "44".repeat(32);
        assert!(validate_raw_metadata_provenance(&arbitrary).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn scaled_unoriented_extent_maps_to_native_source_active_area() {
        assert_eq!(
            platform::source_active_area(5.0, 10.0, 490.0, 380.0, 0.5, 1000, 800).unwrap(),
            [10, 20, 980, 760]
        );
        assert_eq!(
            platform::source_active_area(0.25, 0.75, 4.5, 3.5, 1.0, 10, 10).unwrap(),
            [0, 0, 5, 5]
        );
        assert_eq!(
            platform::source_active_area(-2.5, -1.5, 8.0, 7.0, 1.0, 10, 10).unwrap(),
            [0, 0, 6, 6]
        );
        assert_eq!(
            platform::source_active_area(8.5, 7.5, 8.0, 7.0, 1.0, 10, 10).unwrap(),
            [8, 7, 2, 3]
        );
        assert_eq!(
            platform::source_active_area(-2.0, -3.0, 15.0, 16.0, 1.0, 10, 10).unwrap(),
            [0, 0, 10, 10]
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn source_active_area_rejects_invalid_or_empty_geometry() {
        for args in [
            (0.0, 0.0, 1.0, 1.0, 0.0, 10, 10),
            (0.0, 0.0, 1.0, 1.0, -1.0, 10, 10),
            (0.0, 0.0, 1.0, 1.0, f32::NAN, 10, 10),
            (0.0, 0.0, 1.0, 1.0, f32::INFINITY, 10, 10),
            (f64::NAN, 0.0, 1.0, 1.0, 1.0, 10, 10),
            (0.0, f64::INFINITY, 1.0, 1.0, 1.0, 10, 10),
            (0.0, 0.0, f64::NAN, 1.0, 1.0, 10, 10),
            (0.0, 0.0, 1.0, f64::INFINITY, 1.0, 10, 10),
            (0.0, 0.0, 0.0, 1.0, 1.0, 10, 10),
            (0.0, 0.0, -1.0, 1.0, 1.0, 10, 10),
            (0.0, 0.0, 1.0, 0.0, 1.0, 10, 10),
            (0.0, 0.0, 1.0, -1.0, 1.0, 10, 10),
            (0.0, 0.0, 1.0, 1.0, 1.0, 0, 10),
            (0.0, 0.0, 1.0, 1.0, 1.0, 10, 0),
            (-20.0, 0.0, 5.0, 5.0, 1.0, 10, 10),
            (20.0, 0.0, 5.0, 5.0, 1.0, 10, 10),
            (0.0, -20.0, 5.0, 5.0, 1.0, 10, 10),
            (0.0, 20.0, 5.0, 5.0, 1.0, 10, 10),
            (f64::from(u32::MAX) + 1.0, 0.0, 1.0, 1.0, 1.0, 10, 10),
            (0.0, 0.0, f64::from(u32::MAX) + 1.0, 1.0, 1.0, 10, 10),
        ] {
            assert!(
                platform::source_active_area(
                    args.0, args.1, args.2, args.3, args.4, args.5, args.6
                )
                .is_err(),
                "{args:?}"
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn signed_core_image_dimensions_reach_validation() {
        assert!(platform::checked_dim(-1.0, "output width").is_err());
        assert!(platform::checked_dim(-1.0, "output height").is_err());
        assert!(platform::source_active_area(0.0, 0.0, -1.0, 1.0, 1.0, 10, 10).is_err());
        assert!(platform::source_active_area(0.0, 0.0, 1.0, -1.0, 1.0, 10, 10).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_decoder_reports_a_real_camera_matrix() {
        let capabilities = platform::capabilities().unwrap();
        assert!(capabilities.available);
        assert!(capabilities.supported_camera_models.len() > 100);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn unsupported_input_is_a_clean_error() {
        let err = platform::decode("/definitely/not/a/raw/file.CR3", 256, &intent()).unwrap_err();
        assert!(!err.is_empty());
    }
}
