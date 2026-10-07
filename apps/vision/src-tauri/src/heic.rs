//! File ▸ Open ▸ HEIC/HEIF (the iPhone camera default). HEVC decode is
//! patent-encumbered, so — like Chrome and jSquash — Vision ships no wasm HEIC
//! decoder. Instead it decodes through the macOS **OS codec** (ImageIO): zero
//! patent surface, zero bundled decoder bytes. EXIF orientation is honored so
//! the RGBA that reaches the engine is already upright.
//!
//! Exposed as a Tauri plugin ("heic"), mirroring the `c2pa` plugin: a pure,
//! cargo-testable `decode_heic_to_rgba` + a thin `plugin:heic|decode_heic`
//! wrapper (raw bytes in → packed `[w:u32 le][h:u32 le][rgba]` out — never
//! JSON-array a multi-MB image). Gated `#[cfg(target_os = "macos")]`; on other
//! targets the command returns a clean "unsupported" error so the build stays
//! cross-platform-clean and the browser dev build degrades gracefully.
use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("heic")
        .invoke_handler(tauri::generate_handler![decode_heic, encode_heic])
        .build()
}

// ── macOS: real decode via ImageIO ──────────────────────────────────────────
#[cfg(target_os = "macos")]
mod imageio {
    use std::ffi::c_void;
    use std::os::raw::c_long;

    /// Decoded RGBA8 image, upright (EXIF orientation applied), straight alpha.
    pub struct DecodedImage {
        pub rgba: Vec<u8>,
        pub width: u32,
        pub height: u32,
    }

    // A HEIC claiming absurd dimensions must not allocate gigabytes before we
    // even touch its pixels. iPhone captures top out around 48 MP.
    // ponytail: hard 100 MP ceiling (~400 MB RGBA); raise if a real file trips it.
    const MAX_PIXELS: u64 = 100_000_000;

    type CFTypeRef = *const c_void;
    type CFDataRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type CFStringRef = *const c_void;
    type CFNumberRef = *const c_void;
    type CFAllocatorRef = *const c_void;
    type CGImageSourceRef = *const c_void;
    type CGImageRef = *const c_void;
    type CGColorSpaceRef = *const c_void;
    type CGContextRef = *const c_void;
    type CFIndex = c_long;

    const KCF_NUMBER_SINT32_TYPE: CFIndex = 3;
    const KCF_NUMBER_FLOAT64_TYPE: CFIndex = 6;
    const KCF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    // RGBA8, premultiplied alpha last (CGImageAlphaInfo.premultipliedLast).
    const KCG_IMAGE_ALPHA_PREMULTIPLIED_LAST: u32 = 1;
    // RGBA8, straight (non-premultiplied) alpha last — how the engine stores it,
    // so encoding needs no premultiply round-trip.
    const KCG_IMAGE_ALPHA_LAST: u32 = 3;

    type CFMutableDataRef = *const c_void;
    type CGDataProviderRef = *const c_void;
    type CGImageDestinationRef = *const c_void;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGAffineTransform {
        a: f64,
        b: f64,
        c: f64,
        d: f64,
        tx: f64,
        ty: f64,
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFDataCreate(allocator: CFAllocatorRef, bytes: *const u8, length: CFIndex) -> CFDataRef;
        fn CFRelease(cf: CFTypeRef);
        fn CFDictionaryGetValue(dict: CFDictionaryRef, key: *const c_void) -> *const c_void;
        fn CFNumberGetValue(number: CFNumberRef, the_type: CFIndex, value: *mut c_void) -> bool;
        fn CFDataCreateMutable(allocator: CFAllocatorRef, capacity: CFIndex) -> CFMutableDataRef;
        fn CFDataGetLength(data: CFDataRef) -> CFIndex;
        fn CFDataGetBytePtr(data: CFDataRef) -> *const u8;
        fn CFNumberCreate(
            allocator: CFAllocatorRef,
            the_type: CFIndex,
            value: *const c_void,
        ) -> CFNumberRef;
        fn CFDictionaryCreate(
            allocator: CFAllocatorRef,
            keys: *const *const c_void,
            values: *const *const c_void,
            num_values: CFIndex,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> CFDictionaryRef;
        fn CFStringCreateWithCString(
            allocator: CFAllocatorRef,
            c_str: *const std::os::raw::c_char,
            encoding: u32,
        ) -> CFStringRef;
    }

    #[link(name = "ImageIO", kind = "framework")]
    extern "C" {
        static kCGImagePropertyOrientation: CFStringRef;
        static kCGImageDestinationLossyCompressionQuality: CFStringRef;
        fn CGImageSourceCreateWithData(data: CFDataRef, options: CFDictionaryRef) -> CGImageSourceRef;
        fn CGImageSourceCreateImageAtIndex(
            isrc: CGImageSourceRef,
            index: usize,
            options: CFDictionaryRef,
        ) -> CGImageRef;
        fn CGImageSourceCopyPropertiesAtIndex(
            isrc: CGImageSourceRef,
            index: usize,
            options: CFDictionaryRef,
        ) -> CFDictionaryRef;
        fn CGImageDestinationCreateWithData(
            data: CFMutableDataRef,
            type_: CFStringRef,
            count: usize,
            options: CFDictionaryRef,
        ) -> CGImageDestinationRef;
        fn CGImageDestinationAddImage(
            dest: CGImageDestinationRef,
            image: CGImageRef,
            properties: CFDictionaryRef,
        );
        fn CGImageDestinationFinalize(dest: CGImageDestinationRef) -> bool;
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGImageGetWidth(image: CGImageRef) -> usize;
        fn CGImageGetHeight(image: CGImageRef) -> usize;
        fn CGImageGetColorSpace(image: CGImageRef) -> CGColorSpaceRef;
        fn CGColorSpaceGetModel(space: CGColorSpaceRef) -> i32;
        fn CGColorSpaceCreateDeviceRGB() -> CGColorSpaceRef;
        fn CGColorSpaceRelease(space: CGColorSpaceRef);
        fn CGBitmapContextCreate(
            data: *mut c_void,
            width: usize,
            height: usize,
            bits_per_component: usize,
            bytes_per_row: usize,
            space: CGColorSpaceRef,
            bitmap_info: u32,
        ) -> CGContextRef;
        fn CGContextRelease(ctx: CGContextRef);
        fn CGContextConcatCTM(ctx: CGContextRef, transform: CGAffineTransform);
        fn CGContextDrawImage(ctx: CGContextRef, rect: CGRect, image: CGImageRef);
        fn CGDataProviderCreateWithCFData(data: CFDataRef) -> CGDataProviderRef;
        fn CGDataProviderRelease(provider: CGDataProviderRef);
        #[allow(clippy::too_many_arguments)]
        fn CGImageCreate(
            width: usize,
            height: usize,
            bits_per_component: usize,
            bits_per_pixel: usize,
            bytes_per_row: usize,
            space: CGColorSpaceRef,
            bitmap_info: u32,
            provider: CGDataProviderRef,
            decode: *const f64,
            should_interpolate: bool,
            intent: i32,
        ) -> CGImageRef;
    }

    /// Small RAII guard so every early-return path releases its CF/CG object.
    struct Owned(CFTypeRef);
    impl Drop for Owned {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) }
            }
        }
    }

    /// EXIF orientation → the CTM that maps stored pixels into an upright
    /// `uw × uh` context (drawing the image in its own `sw × sh` rect). The full
    /// 1–8 table was brute-forced against ground-truth fixtures (all 8 match).
    fn orientation_transform(o: i32, uw: f64, uh: f64) -> CGAffineTransform {
        let t = |a, b, c, d, tx, ty| CGAffineTransform { a, b, c, d, tx, ty };
        match o {
            2 => t(-1.0, 0.0, 0.0, 1.0, uw, 0.0),
            3 => t(-1.0, 0.0, 0.0, -1.0, uw, uh),
            4 => t(1.0, 0.0, 0.0, -1.0, 0.0, uh),
            5 => t(0.0, -1.0, -1.0, 0.0, uw, uh),
            6 => t(0.0, -1.0, 1.0, 0.0, 0.0, uh),
            7 => t(0.0, 1.0, 1.0, 0.0, 0.0, 0.0),
            8 => t(0.0, 1.0, -1.0, 0.0, uw, 0.0),
            _ => t(1.0, 0.0, 0.0, 1.0, 0.0, 0.0), // 1 (and unknown): identity
        }
    }

    /// Decode HEIC/HEIF (in fact any ImageIO-supported container — the source
    /// sniffs the format) to upright RGBA8. Pure + testable; the Tauri command
    /// is a thin wrapper. Returns a clean `Err` on unreadable/undecodable input.
    pub fn decode_heic_to_rgba(bytes: &[u8]) -> Result<DecodedImage, String> {
        if bytes.is_empty() {
            return Err("empty HEIC data".into());
        }
        unsafe {
            let data = CFDataCreate(std::ptr::null(), bytes.as_ptr(), bytes.len() as CFIndex);
            if data.is_null() {
                return Err("CFDataCreate failed".into());
            }
            let _data = Owned(data);

            let src = CGImageSourceCreateWithData(data, std::ptr::null());
            if src.is_null() {
                return Err("not a decodable image (CGImageSource)".into());
            }
            let _src = Owned(src);

            // EXIF orientation (default 1 when absent/unreadable).
            let mut orientation: i32 = 1;
            let props = CGImageSourceCopyPropertiesAtIndex(src, 0, std::ptr::null());
            if !props.is_null() {
                let _props = Owned(props);
                let val = CFDictionaryGetValue(props, kCGImagePropertyOrientation);
                if !val.is_null() {
                    let mut n: i32 = 0;
                    if CFNumberGetValue(
                        val as CFNumberRef,
                        KCF_NUMBER_SINT32_TYPE,
                        &mut n as *mut i32 as *mut c_void,
                    ) && (1..=8).contains(&n)
                    {
                        orientation = n;
                    }
                }
            }

            let img = CGImageSourceCreateImageAtIndex(src, 0, std::ptr::null());
            if img.is_null() {
                return Err("image decode failed".into());
            }
            let _img = Owned(img);

            let sw = CGImageGetWidth(img);
            let sh = CGImageGetHeight(img);
            if sw == 0 || sh == 0 {
                return Err("decoded image has zero dimensions".into());
            }
            if (sw as u64) * (sh as u64) > MAX_PIXELS {
                return Err(format!("image too large: {sw}×{sh}"));
            }
            // Orientations 5–8 transpose the axes → upright dims swap.
            let (uw, uh) = if orientation >= 5 { (sh, sw) } else { (sw, sh) };

            let mut buf = vec![0u8; uw * uh * 4];
            // Keep RGB samples in the image's own profile: the frontend applies
            // the embedded-profile policy after decode. Drawing to DeviceRGB
            // first would convert them and then incorrectly assign the old ICC.
            let source_cs = CGImageGetColorSpace(img);
            let source_rgb = !source_cs.is_null() && CGColorSpaceGetModel(source_cs) == 1;
            let cs = if source_rgb { source_cs } else { CGColorSpaceCreateDeviceRGB() };
            if cs.is_null() {
                return Err("CGColorSpaceCreateDeviceRGB failed".into());
            }
            let ctx = CGBitmapContextCreate(
                buf.as_mut_ptr() as *mut c_void,
                uw,
                uh,
                8,
                uw * 4,
                cs,
                KCG_IMAGE_ALPHA_PREMULTIPLIED_LAST,
            );
            if !source_rgb {
                CGColorSpaceRelease(cs);
            } // source_cs is borrowed from img, which stays alive through drawing
            if ctx.is_null() {
                return Err("CGBitmapContextCreate failed".into());
            }

            CGContextConcatCTM(ctx, orientation_transform(orientation, uw as f64, uh as f64));
            CGContextDrawImage(
                ctx,
                CGRect {
                    origin: CGPoint { x: 0.0, y: 0.0 },
                    size: CGSize {
                        width: sw as f64,
                        height: sh as f64,
                    },
                },
                img,
            );
            CGContextRelease(ctx);

            unpremultiply(&mut buf);
            Ok(DecodedImage {
                rgba: buf,
                width: uw as u32,
                height: uh as u32,
            })
        }
    }

    // ImageIO gives premultiplied-alpha RGBA; the engine's image-open path (canvas
    // putImageData) expects straight alpha. Photos are opaque (no-op), but a HEIC
    // *with* alpha would darken otherwise. ponytail: exact integer un-premultiply.
    fn unpremultiply(buf: &mut [u8]) {
        for px in buf.chunks_exact_mut(4) {
            let a = px[3] as u32;
            if a == 0 || a == 255 {
                continue;
            }
            for c in &mut px[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }

    /// Encode straight-alpha RGBA8 to an ImageIO container identified by `uti`
    /// (e.g. `public.heic`), at lossy `quality` 0..1. Pure + testable; the Tauri
    /// command is a thin wrapper. The CGImageDestination path is format-agnostic —
    /// the same FFI encodes every UTI — so the codec-less build VM validates it via
    /// `public.png` (no HEVC) exactly as the decode test validates via a JPEG.
    /// Returns a clean `Err` (never a panic) on bad input or an unsupported UTI.
    pub fn encode_rgba(
        rgba: &[u8],
        width: u32,
        height: u32,
        uti: &str,
        quality: f32,
    ) -> Result<Vec<u8>, String> {
        let (w, h) = (width as usize, height as usize);
        if w == 0 || h == 0 {
            return Err("zero dimensions".into());
        }
        if rgba.len() != w * h * 4 {
            return Err(format!("rgba length {} != {}", rgba.len(), w * h * 4));
        }
        if (w as u64) * (h as u64) > MAX_PIXELS {
            return Err(format!("image too large: {w}×{h}"));
        }
        unsafe {
            // Wrap the straight-alpha RGBA in a CGImage (alpha last, non-premultiplied).
            let data = CFDataCreate(std::ptr::null(), rgba.as_ptr(), rgba.len() as CFIndex);
            if data.is_null() {
                return Err("CFDataCreate failed".into());
            }
            let _data = Owned(data);
            let provider = CGDataProviderCreateWithCFData(data);
            if provider.is_null() {
                return Err("CGDataProviderCreateWithCFData failed".into());
            }
            let cs = CGColorSpaceCreateDeviceRGB();
            if cs.is_null() {
                CGDataProviderRelease(provider);
                return Err("CGColorSpaceCreateDeviceRGB failed".into());
            }
            let img = CGImageCreate(
                w,
                h,
                8,
                32,
                w * 4,
                cs,
                KCG_IMAGE_ALPHA_LAST,
                provider,
                std::ptr::null(),
                false,
                0,
            );
            CGColorSpaceRelease(cs);
            CGDataProviderRelease(provider); // CGImage retains it
            if img.is_null() {
                return Err("CGImageCreate failed".into());
            }
            let _img = Owned(img);

            // Destination backed by a growable CFData, typed by the requested UTI.
            let out = CFDataCreateMutable(std::ptr::null(), 0);
            if out.is_null() {
                return Err("CFDataCreateMutable failed".into());
            }
            let _out = Owned(out);
            let uti_c = std::ffi::CString::new(uti).map_err(|_| "invalid UTI".to_string())?;
            let uti_str =
                CFStringCreateWithCString(std::ptr::null(), uti_c.as_ptr(), KCF_STRING_ENCODING_UTF8);
            if uti_str.is_null() {
                return Err("CFStringCreateWithCString failed".into());
            }
            let _uti = Owned(uti_str);
            let dest = CGImageDestinationCreateWithData(out, uti_str, 1, std::ptr::null());
            if dest.is_null() {
                return Err(format!("format '{uti}' is not encodable on this system"));
            }
            let _dest = Owned(dest);

            // Properties: { kCGImageDestinationLossyCompressionQuality: quality }.
            let q = quality.clamp(0.0, 1.0) as f64;
            let qnum = CFNumberCreate(
                std::ptr::null(),
                KCF_NUMBER_FLOAT64_TYPE,
                &q as *const f64 as *const c_void,
            );
            let _qnum = Owned(qnum);
            let keys = [kCGImageDestinationLossyCompressionQuality];
            let values = [qnum as *const c_void];
            let props = CFDictionaryCreate(
                std::ptr::null(),
                keys.as_ptr() as *const *const c_void,
                values.as_ptr(),
                1,
                std::ptr::null(),
                std::ptr::null(),
            );
            let _props = if props.is_null() { None } else { Some(Owned(props)) };

            CGImageDestinationAddImage(dest, img, props);
            if !CGImageDestinationFinalize(dest) {
                return Err("image encode failed (finalize)".into());
            }

            let len = CFDataGetLength(out) as usize;
            let ptr = CFDataGetBytePtr(out);
            if ptr.is_null() || len == 0 {
                return Err("encoder produced no data".into());
            }
            Ok(std::slice::from_raw_parts(ptr, len).to_vec())
        }
    }
}

// `(async)` — NOT decoration: a plain `fn` command runs inline in the ipc://
// protocol handler on the macOS main thread, so an ImageIO HEVC decode of a
// 48 MP photo (~0.5–2 s) froze the native event loop and every other IPC call
// (saves, autosave, plugin-fs) for its whole duration. With `(async)` the
// wrapper hands the body to tauri's async runtime threadpool instead. ImageIO
// is thread-safe, so nothing here needs the main thread. (#7)
#[cfg(target_os = "macos")]
#[tauri::command(async)]
fn decode_heic(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("expected raw HEIC body".into()),
    };
    let img = imageio::decode_heic_to_rgba(&bytes)?;
    // Pack dims ahead of the pixels: [w u32 le][h u32 le][rgba]. Raw body out —
    // never JSON-array a multi-MB image.
    let mut out = Vec::with_capacity(8 + img.rgba.len());
    out.extend_from_slice(&img.width.to_le_bytes());
    out.extend_from_slice(&img.height.to_le_bytes());
    out.extend_from_slice(&img.rgba);
    Ok(tauri::ipc::Response::new(out))
}

// File ▸ Export ▸ HEIC. Body: [w u32 le][h u32 le][quality u8 0..100][rgba…];
// returns the encoded HEIC bytes. Native (ImageIO/HEVC), desktop-macOS only.
#[cfg(target_os = "macos")]
#[tauri::command(async)] // off the event loop — see decode_heic (#7)
fn encode_heic(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let body = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("expected raw encode body".into()),
    };
    if body.len() < 9 {
        return Err("short encode header".into());
    }
    let w = u32::from_le_bytes(body[0..4].try_into().unwrap());
    let h = u32::from_le_bytes(body[4..8].try_into().unwrap());
    let quality = body[8] as f32 / 100.0;
    let bytes = imageio::encode_rgba(&body[9..], w, h, "public.heic", quality)?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ── Non-macOS: no OS codec, surface a clean unsupported error ────────────────
#[cfg(not(target_os = "macos"))]
#[tauri::command(async)]
fn decode_heic(_request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    Err("HEIC/HEIF open is only supported on macOS (decodes via the OS ImageIO codec).".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command(async)]
fn encode_heic(_request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    Err("HEIC/HEIF export is only supported on macOS (encodes via the OS ImageIO codec).".into())
}

// Dispatch guard, platform-independent: a plain `#[tauri::command]` is
// ExecutionContext::Blocking and runs inline in the ipc:// protocol handler on
// the macOS main thread, so an ImageIO decode/encode of a large photo freezes
// the native event loop and every other IPC call. Every command in this file
// must therefore carry `(async)`. (#7)
#[cfg(test)]
mod dispatch_tests {
    #[test]
    fn heic_commands_run_off_the_event_loop() {
        let src = include_str!("heic.rs");
        let attrs: Vec<&str> = src
            .lines()
            .map(str::trim_start)
            .filter(|l| l.starts_with("#[tauri::command"))
            .collect();
        assert_eq!(attrs.len(), 4, "expected decode/encode × macos/non-macos: {attrs:?}");
        for attr in attrs {
            assert!(
                attr.contains("(async)"),
                "blocking command attribute stalls the event loop: {attr}"
            );
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::imageio::decode_heic_to_rgba;

    #[test]
    fn decode_preserves_embedded_rgb_samples_before_profile_assignment() {
        // A lossless Display P3 PNG exercises the same ImageIO extraction as
        // HEIC without requiring the host's hardware HEVC decoder. DeviceRGB
        // changes this pixel to [194, 72, 52], which cannot be tagged P3 again.
        let img = decode_heic_to_rgba(include_bytes!("../fixtures/display-p3-pixel.png"))
            .expect("decode tagged RGB");
        assert_eq!((img.width, img.height), (1, 1));
        assert_eq!(img.rgba, [180, 80, 60, 255]);
    }

    // The decode is format-agnostic: `decode_heic_to_rgba` hands bytes to
    // ImageIO's CGImageSource, which sniffs the container — a HEIC and a JPEG run
    // the *identical* FFI + orientation + RGBA-extraction code. The fixture here
    // is a JPEG (stored 64×48) tagged EXIF orientation 6, so an orientation-
    // honoring decode must yield an upright 48×64 image: red band across the top,
    // green band down the left, dark elsewhere. This gates the whole pipeline +
    // the all-8-orientation table (brute-forced offline against ground truth).
    //
    // Why a JPEG and not a .heic: this repo's CI/build host is a paravirtualized
    // macOS VM whose Apple HEVC pixel decoder is absent — the decode blocks
    // indefinitely on a missing `AppleM2ScalerParavirtDriver` (verified: `sips`
    // and ImageIO both hang mid-decode). A worker-thread timeout can't rescue it
    // either: the hung thread sits in an uninterruptible kernel wait and wedges
    // process exit. So a real .heic pixel decode is unrunnable here; it is
    // exercised by the same code on real hardware and via manual `pnpm tauri dev`.
    // (The fixture is real-codec generated and committed, mirroring tiny.avif.)
    #[test]
    fn heic_decode_fixture_dimensions_and_orientation() {
        let bytes = include_bytes!("../fixtures/heic-orient6.jpg");
        let img = decode_heic_to_rgba(bytes).expect("decode oriented fixture");
        assert_eq!(
            (img.width, img.height),
            (48, 64),
            "EXIF orientation 6 must produce an upright 48×64 image"
        );
        assert_eq!(
            img.rgba.len(),
            (img.width * img.height * 4) as usize,
            "RGBA length must be w*h*4"
        );
        let px = |x: u32, y: u32| {
            let i = ((y * img.width + x) * 4) as usize;
            (img.rgba[i], img.rgba[i + 1], img.rgba[i + 2])
        };
        let (r, g, b) = px(24, 2);
        assert!(r > 180 && g < 90 && b < 90, "top band red (upright): {:?}", (r, g, b));
        let (r2, g2, _) = px(2, 40);
        assert!(g2 > 150 && r2 < 120, "left band green (upright): {:?}", (r2, g2));
        let (r3, g3, b3) = px(24, 40);
        assert!(r3 < 90 && g3 < 90 && b3 < 90, "interior dark (upright): {:?}", (r3, g3, b3));
    }

    // A malformed file must surface a clean Err (never panic, never hang) so a
    // bad open can't take the app down — mirrors the AVIF corrupt-bytes test.
    // Unrecognized bytes are rejected by CGImageSource without ever reaching the
    // HEVC decoder, so this is safe to run in the codec-less VM.
    #[test]
    fn heic_decode_rejects_garbage_bytes() {
        assert!(decode_heic_to_rgba(&[]).is_err(), "empty input is an error");
        assert!(
            decode_heic_to_rgba(&[0, 1, 2, 3, 4, 5, 6, 7]).is_err(),
            "non-image bytes are an error, not a panic"
        );
    }

    // Encoding to HEIC needs the HEVC *encoder*, absent on the paravirtualized
    // build VM (same reason the decode test can't use a real .heic). The ImageIO
    // encode path is format-agnostic — one CGImageDestination FFI for every UTI —
    // so we validate it end-to-end with `public.png` (no HEVC): encode RGBA →
    // decode the bytes back → the image survives. Real HEIC uses this same path +
    // the HEVC codec on device / via `pnpm tauri dev`.
    #[test]
    fn encode_round_trips_through_imageio() {
        use super::imageio::encode_rgba;
        let (w, h) = (4u32, 3u32);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        for px in rgba.chunks_exact_mut(4) {
            px.copy_from_slice(&[200, 40, 90, 255]); // solid magenta-ish, opaque
        }
        let png = encode_rgba(&rgba, w, h, "public.png", 1.0).expect("encode png");
        assert!(png.len() > 8 && &png[1..4] == b"PNG", "has a PNG signature");

        let back = decode_heic_to_rgba(&png).expect("decode the encoded bytes back");
        assert_eq!((back.width, back.height), (w, h), "dimensions round-trip");
        let (r, g, b) = (back.rgba[0], back.rgba[1], back.rgba[2]);
        assert!(
            r > 180 && g < 90 && b > 40 && b < 140,
            "colour round-trips: {:?}",
            (r, g, b)
        );

        // Unsupported UTI and bad input → clean Err, never a panic.
        assert!(encode_rgba(&rgba, w, h, "com.example.nope", 1.0).is_err());
        assert!(encode_rgba(&[], 0, 0, "public.png", 1.0).is_err());
        assert!(
            encode_rgba(&rgba, w, h + 1, "public.png", 1.0).is_err(),
            "mismatched length is an error"
        );
    }
}
