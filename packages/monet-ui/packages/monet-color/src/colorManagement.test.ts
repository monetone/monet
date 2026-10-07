import { describe, expect, it } from "vitest";
import {
  canConvertPasteProfile,
  clampProfile,
  CONVERT_ICC_SPACES,
  colorModeName,
  detectEmbeddedRgbProfile,
  documentProfileName,
  embeddedProfileOpenWarning,
  embeddedProfilePolicyDecision,
  iccColorMode,
  missingProfileOpenWarning,
  missingProfilePolicyDecision,
  normalizeColorPolicyPrefs,
  normalizeConvertProfileOptions,
  parseIccProfile,
  pasteProfileInfoMatches,
  pasteProfileName,
  pasteProfilePolicyDecision,
  pasteProfilePolicyDecisionForInfo,
  pasteProfileWarning,
  pasteProfileWarningForInfo,
  profileFromEmbeddedName,
  profileName,
  profilePolicyWarning,
} from "./colorManagement";

describe("color management labels", () => {
  it("labels Photoshop color modes beyond CMYK", () => {
    expect(colorModeName(3)).toBe("Lab Color");
    expect(colorModeName(4)).toBe("Multichannel");
    expect(colorModeName(99)).toBe("RGB Color");
  });

  it("labels and clamps built-in RGB profiles", () => {
    expect(profileName(2)).toBe("Adobe RGB (1998)");
    expect(documentProfileName(2, true)).toBe("Adobe RGB (1998)");
    expect(documentProfileName(0, true, " Acme   Wide Gamut RGB ")).toBe("Acme Wide Gamut RGB");
    expect(documentProfileName(2, false)).toBe("Untagged RGB");
    expect(documentProfileName(2, true, undefined, 2)).toBe("No mode-specific profile");
    // A document Convert to Profile separated through a CMYK/Gray/Lab profile
    // names that profile instead.
    expect(documentProfileName(2, true, undefined, 2, " ISO Coated v2 ")).toBe("ISO Coated v2");
    expect(documentProfileName(2, true, "Acme RGB", 0, "ISO Coated v2")).toBe("Acme RGB");
    expect(clampProfile(3)).toBe(3);
    expect(clampProfile(99)).toBe(0);
  });

  it("lets Convert to Profile load CMYK, Gray and Lab profiles and still refuses junk", () => {
    const profile = (space: string, deviceClass = "prtr") => {
      const bytes = new Uint8Array(132);
      writeU32(bytes, 0, 132);
      bytes.set(asciiBytes(deviceClass), 12);
      bytes.set(asciiBytes(space), 16);
      bytes.set(asciiBytes("acsp"), 36);
      return bytes;
    };
    for (const [space, mode] of [["RGB ", 0], ["GRAY", 1], ["CMYK", 2], ["Lab ", 3]] as const) {
      expect(parseIccProfile(profile(space), "p", CONVERT_ICC_SPACES).colorSpace).toBe(space);
      expect(iccColorMode(space)).toBe(mode);
    }
    expect(iccColorMode("XYZ ")).toBeNull();
    // Assign stays RGB-only, and the message names what would work.
    expect(() => parseIccProfile(profile("CMYK"), "swop")).toThrow("“swop” is a CMYK profile; an RGB device profile is required.");
    expect(() => parseIccProfile(profile("XYZ "), "xyz", CONVERT_ICC_SPACES))
      .toThrow("“xyz” is a XYZ profile; an RGB, CMYK, Gray or Lab device profile is required.");
    // A link has no device side to convert into; nor does an abstract profile,
    // except the Lab identity a Lab destination is usually written as.
    expect(() => parseIccProfile(profile("CMYK", "link"), "link", CONVERT_ICC_SPACES)).toThrow(/device link profile; choose an input/);
    expect(() => parseIccProfile(profile("RGB ", "abst"), "abst", CONVERT_ICC_SPACES)).toThrow(/abstract profile/);
    expect(parseIccProfile(profile("Lab ", "abst"), "Lab", CONVERT_ICC_SPACES).colorSpace).toBe("Lab ");
    const junk = profile("CMYK");
    junk[36] = 0;
    expect(() => parseIccProfile(junk, "junk", CONVERT_ICC_SPACES)).toThrow(/header signature/);
  });

  it("takes a Lab colour space but refuses a Lab effect with a reason", () => {
    // Hand-built v2 Lab profiles with 8/16-bit tables (grid 2, identity CLUT),
    // the shape of macOS's Generic Lab Profile and its ColorSync Lab effects.
    const lab = (deviceClass: string, lCurve: (v: number) => number, wide = false) => {
      const n = 256, size = wide ? 2 : 1, max = wide ? 65535 : 255;
      const put = (t: number[], v: number) => { if (wide) t.push(v >> 8 & 255, v & 255); else t.push(v); };
      const table = [...asciiBytes(wide ? "mft2" : "mft1"), 0, 0, 0, 0, 3, 3, 2, 0];
      for (const m of [1, 0, 0, 0, 1, 0, 0, 0, 1]) table.push(0, m, 0, 0);
      if (wide) table.push(1, 0, 1, 0); // 256 input / output entries
      for (let ch = 0; ch < 3; ch++) for (let i = 0; i < n; i++) put(table, Math.round((ch === 0 ? lCurve(i / 255) : i / 255) * max));
      for (let node = 0; node < 8; node++) for (const bit of [node >> 2 & 1, node >> 1 & 1, node & 1]) put(table, bit * max);
      for (let ch = 0; ch < 3; ch++) for (let i = 0; i < n; i++) put(table, Math.round(i / 255 * max));
      expect(table.length).toBe((wide ? 52 : 48) + (3 * n * 2 + 24) * size);
      const bytes = new Uint8Array(144 + table.length);
      writeU32(bytes, 0, bytes.length);
      bytes.set(asciiBytes(deviceClass), 12);
      bytes.set(asciiBytes("Lab "), 16);
      bytes.set(asciiBytes("Lab "), 20);
      bytes.set(asciiBytes("acsp"), 36);
      writeU32(bytes, 128, 1);
      bytes.set(asciiBytes("A2B0"), 132);
      writeU32(bytes, 136, 144);
      writeU32(bytes, 140, table.length);
      bytes.set(table, 144);
      return bytes;
    };
    for (const wide of [false, true]) {
      expect(parseIccProfile(lab("spac", (v) => v, wide), "Generic Lab", CONVERT_ICC_SPACES).colorSpace).toBe("Lab ");
      expect(parseIccProfile(lab("abst", (v) => v, wide), "lcms Lab", CONVERT_ICC_SPACES).colorSpace).toBe("Lab ");
      expect(() => parseIccProfile(lab("abst", Math.sqrt, wide), "Lightness Increase", CONVERT_ICC_SPACES))
        .toThrow("“Lightness Increase” is a Lab effect profile: its tables change colours instead of describing a colour space. Choose a plain Lab, CMYK, Gray or RGB profile.");
    }
  });

  it("remembers Convert to Profile's options with Photoshop's defaults", () => {
    expect(normalizeConvertProfileOptions(null)).toEqual({ engine: "moxcms", intent: 1, blackPointCompensation: true, dither: false });
    expect(normalizeConvertProfileOptions(undefined, 0).intent).toBe(0);
    // First use pre-fills Color Settings' BPC default; a remembered choice wins.
    expect(normalizeConvertProfileOptions(null, 1, false).blackPointCompensation).toBe(false);
    expect(normalizeConvertProfileOptions({ blackPointCompensation: true }, 1, false).blackPointCompensation).toBe(true);
    expect(normalizeConvertProfileOptions({ engine: "moxcms", intent: 3, blackPointCompensation: false, dither: true }))
      .toEqual({ engine: "moxcms", intent: 3, blackPointCompensation: false, dither: true });
    // Only real engines: an unknown CMM falls back to the one that exists.
    expect(normalizeConvertProfileOptions({ engine: "Apple CMM", intent: 9, dither: "yes" }))
      .toEqual({ engine: "moxcms", intent: 1, blackPointCompensation: true, dither: false });
  });

  it("describes profile mismatch policy for assign, convert and working changes", () => {
    expect(profilePolicyWarning(0, 0, "assign")).toBeNull();
    expect(profilePolicyWarning(0, 1, "assign")).toContain("without changing pixel values");
    expect(profilePolicyWarning(0, 1, "convert")).toContain("change layer RGB values");
    expect(profilePolicyWarning(0, 2, "working")).toContain("without converting pixels");
  });

  it("maps common embedded ICC profile names to built-in RGB profiles", () => {
    expect(profileFromEmbeddedName("sRGB IEC61966-2.1")).toBe(0);
    expect(profileFromEmbeddedName("Display P3")).toBe(1);
    expect(profileFromEmbeddedName("Adobe RGB (1998)")).toBe(2);
    expect(profileFromEmbeddedName("Rec.2020 RGB")).toBe(3);
    expect(profileFromEmbeddedName("Some printer CMYK")).toBeNull();
  });

  it("detects PNG cICP and iCCP embedded RGB profile metadata", () => {
    expect(detectEmbeddedRgbProfile(pngWithChunk("cICP", [12, 13, 0, 1]))).toMatchObject({
      profile: 1,
      source: "png-cicp",
    });
    expect(detectEmbeddedRgbProfile(pngWithChunk("iCCP", [...asciiBytes("Adobe RGB (1998)"), 0, 0, 0x78, 0x9c, 3, 0, 0, 0, 0, 1]))).toMatchObject({
      profile: 2,
      source: "png-iccp",
    });
  });

  it("detects JPEG ICC profile metadata names", () => {
    const payload = asciiBytes("ICC_PROFILE\0\x01\x01desc Display P3");
    const length = payload.length + 2;
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe2, (length >>> 8) & 255, length & 255,
      ...payload,
      0xff, 0xd9,
    ]);
    expect(detectEmbeddedRgbProfile(jpeg)).toMatchObject({ profile: 1, source: "jpeg-icc" });
  });

  it("detects PSD ICC image resource metadata names", () => {
    const payload = iccPayloadWithMlucDescription("Adobe RGB (1998)");
    const embedded = detectEmbeddedRgbProfile(psdWithIccResource(payload));
    expect(embedded).toMatchObject({
      profile: 2,
      source: "psd-icc",
    });
    expect(embedded?.iccProfileBytes).toEqual(payload);
  });

  it("preserves unknown PSD ICC image resource payloads", () => {
    const payload = iccPayloadWithMlucDescription("Acme Wide Gamut RGB");
    const embedded = detectEmbeddedRgbProfile(psdWithIccResource(payload));

    expect(embedded).toMatchObject({
      profile: 0,
      name: "Acme Wide Gamut RGB",
      source: "psd-icc",
    });
    expect(embedded?.iccProfileBytes).toEqual(payload);
  });

  it("describes open-file embedded profile mismatch policy", () => {
    expect(embeddedProfileOpenWarning(0, 0, "same.png")).toBeNull();
    expect(embeddedProfileOpenWarning(0, 1, "p3.png")).toContain("contains Display P3");
    expect(embeddedProfileOpenWarning(0, 1, "p3.png")).toContain("current working RGB is sRGB");
    // A custom profile clamps to sRGB by id but is never the working built-in (#439).
    expect(embeddedProfileOpenWarning(0, 0, "acme.png", "Acme Wide Gamut RGB")).toContain("contains Acme Wide Gamut RGB");
    expect(embeddedProfileOpenWarning(2, 2, "adobe.psd", "Adobe RGB (1998)")).toBeNull();
    expect(embeddedProfilePolicyDecision(0, 0, "ask", "Acme Wide Gamut RGB")).toBe("ask");
    expect(embeddedProfilePolicyDecision(0, 0, "convert", "Acme Wide Gamut RGB")).toBe("convert");
    expect(embeddedProfilePolicyDecision(2, 2, "ask", "Adobe RGB (1998)")).toBe("preserve");
  });

  it("inflates a PNG iCCP chunk and keeps a custom profile's bytes and desc name (#439)", async () => {
    const payload = iccPayloadWithMlucDescription("Acme Wide Gamut RGB");
    const chunk = [...asciiBytes("Acme"), 0, 0, ...(await zlibBytes(payload))];
    expect(detectEmbeddedRgbProfile(pngWithChunk("iCCP", chunk))).toEqual({
      profile: 0, name: "Acme Wide Gamut RGB", source: "png-iccp", iccProfileBytes: payload,
    });
    // A built-in keeps the id-only contract: no bytes, so paste matching stays by id.
    const p3 = [...asciiBytes("P3"), 0, 0, ...(await zlibBytes(iccPayloadWithMlucDescription("Display P3")))];
    expect(detectEmbeddedRgbProfile(pngWithChunk("iCCP", p3))).toEqual({ profile: 1, name: "Display P3", source: "png-iccp" });
  });

  it("reassembles a multi-segment JPEG APP2 profile by segment index (#439)", () => {
    const payload = iccPayloadWithMlucDescription("Acme Wide Gamut RGB");
    const cut = Math.ceil(payload.length / 3);
    const first = payload.subarray(0, cut);
    const second = payload.subarray(cut, 2 * cut);
    const third = payload.subarray(2 * cut);
    // Written out of order: the segment index, not file position, orders the bytes.
    expect(detectEmbeddedRgbProfile(jpegWithApp2([[2, 3, second], [3, 3, third], [1, 3, first]]))).toEqual({
      profile: 0, name: "Acme Wide Gamut RGB", source: "jpeg-icc", iccProfileBytes: payload,
    });
    // A missing segment is no profile at all, never a truncated one.
    expect(detectEmbeddedRgbProfile(jpegWithApp2([[1, 3, first], [3, 3, third]]))).toBeNull();
  });

  it("reads a TIFF InterColorProfile tag in either byte order (#439)", () => {
    const payload = iccPayloadWithMlucDescription("Acme Wide Gamut RGB");
    for (const le of [true, false]) {
      expect(detectEmbeddedRgbProfile(tiffWithIcc(payload, le))).toEqual({
        profile: 0, name: "Acme Wide Gamut RGB", source: "tiff-icc", iccProfileBytes: payload,
      });
    }
    // The engine's trust boundary: a CMYK profile cannot tag an RGB document.
    expect(detectEmbeddedRgbProfile(tiffWithIcc(iccPayloadWithMlucDescription("Acme Press CMYK", "CMYK"), true))).toBeNull();
  });

  it("reads a WebP ICCP chunk regardless of chunk order (#464)", () => {
    const payload = iccPayloadWithMlucDescription("Acme Wide Gamut RGB");
    expect(detectEmbeddedRgbProfile(webpWithIcc(payload))).toEqual({
      profile: 0, name: "Acme Wide Gamut RGB", source: "webp-icc", iccProfileBytes: payload,
    });
    expect(detectEmbeddedRgbProfile(webpWithIcc(iccPayloadWithMlucDescription("Display P3"))))
      .toEqual({ profile: 1, name: "Display P3", source: "webp-icc" });
    // A WebP with no ICCP chunk (a plain lossy file) is untagged.
    expect(detectEmbeddedRgbProfile(webpWithIcc(null))).toBeNull();
  });

  it("ignores WebP ICC bytes outside the declared RIFF container", () => {
    const payload = iccPayloadWithMlucDescription("Acme Wide Gamut RGB");
    const valid = webpWithIcc(payload);
    const trailing = valid.slice();
    writeU32le(trailing, 4, webpWithIcc(null).length - 8);
    expect(detectEmbeddedRgbProfile(trailing)).toBeNull();

    const clipped = valid.slice();
    writeU32le(clipped, 4, clipped.length - 9); // last ICC byte is outside RIFF
    expect(detectEmbeddedRgbProfile(clipped)).toBeNull();

    const truncated = valid.slice();
    writeU32le(truncated, 4, truncated.length - 7); // declared RIFF overruns file
    expect(detectEmbeddedRgbProfile(truncated)).toBeNull();
  });

  it("reads the colr/prof property of an AVIF and a HEIC (#464)", () => {
    const payload = iccPayloadWithMlucDescription("Acme Wide Gamut RGB");
    for (const brand of ["avif", "heic"]) {
      expect(detectEmbeddedRgbProfile(heifWithIcc(brand, payload))).toEqual({
        profile: 0, name: "Acme Wide Gamut RGB", source: "heif-icc", iccProfileBytes: payload,
      });
    }
    expect(detectEmbeddedRgbProfile(heifWithIcc("heic", iccPayloadWithMlucDescription("Display P3"))))
      .toEqual({ profile: 1, name: "Display P3", source: "heif-icc" });
    // nclx-only colour (no ICC payload) is untagged, and so is a file whose
    // colr box overruns its parent — never a half-read profile.
    expect(detectEmbeddedRgbProfile(heifWithIcc("avif", null))).toBeNull();
    expect(detectEmbeddedRgbProfile(heifWithIcc("avif", payload).subarray(0, -1))).toBeNull();
  });

  it("normalizes and applies embedded profile open policies", () => {
    expect(normalizeColorPolicyPrefs({ embeddedProfilePolicy: "convert" })).toMatchObject({ embeddedProfilePolicy: "convert" });
    expect(normalizeColorPolicyPrefs({ embeddedProfilePolicy: "bogus" })).toMatchObject({ embeddedProfilePolicy: "ask" });
    expect(embeddedProfilePolicyDecision(0, 1, "ask")).toBe("ask");
    expect(embeddedProfilePolicyDecision(0, 1, "preserve")).toBe("preserve");
    expect(embeddedProfilePolicyDecision(0, 1, "convert")).toBe("convert");
    expect(embeddedProfilePolicyDecision(0, 1, "discard")).toBe("discard");
    expect(embeddedProfilePolicyDecision(1, 1, "ask")).toBe("preserve");
  });

  it("normalizes and applies missing profile open policies", () => {
    expect(normalizeColorPolicyPrefs({ missingProfilePolicy: "assign-srgb" })).toMatchObject({ missingProfilePolicy: "assign-srgb" });
    expect(normalizeColorPolicyPrefs({ missingProfilePolicy: "leave-untagged" })).toMatchObject({ missingProfilePolicy: "leave-untagged" });
    expect(normalizeColorPolicyPrefs({ missingProfilePolicy: "bogus" })).toMatchObject({ missingProfilePolicy: "assign-working" });
    expect(missingProfileOpenWarning(0, "plain.png")).toBeNull();
    expect(missingProfileOpenWarning(2, "plain.png")).toContain("has no recognized embedded RGB profile");
    expect(missingProfileOpenWarning(2, "plain.png")).toContain("leave it untagged");
    expect(missingProfilePolicyDecision(2, "ask")).toBe("ask");
    expect(missingProfilePolicyDecision(2, "leave-untagged")).toBe("leave-untagged");
    expect(missingProfilePolicyDecision(2, "assign-working")).toBe("assign-working");
    expect(missingProfilePolicyDecision(2, "assign-srgb")).toBe("assign-srgb");
    expect(missingProfilePolicyDecision(0, "ask")).toBe("assign-working");
    expect(missingProfilePolicyDecision(0, "leave-untagged")).toBe("leave-untagged");
  });

  it("normalizes the default rendering intent (Color Settings ▸ Intent)", () => {
    // Absent (legacy persisted prefs) and bogus values fall back to Relative Colorimetric.
    expect(normalizeColorPolicyPrefs({})).toMatchObject({ intent: 1 });
    expect(normalizeColorPolicyPrefs({ intent: "bogus" })).toMatchObject({ intent: 1 });
    expect(normalizeColorPolicyPrefs({ intent: 7 })).toMatchObject({ intent: 1 });
    // Every RENDERING_INTENTS id round-trips.
    for (const id of [0, 1, 2, 3]) expect(normalizeColorPolicyPrefs({ intent: id })).toMatchObject({ intent: id });
    // A stored intent survives alongside the policy fields it used to be dropped next to.
    expect(normalizeColorPolicyPrefs({ intent: 3, pasteProfilePolicy: "convert" }))
      .toMatchObject({ intent: 3, pasteProfilePolicy: "convert" });
  });

  it("normalizes and applies paste profile policies", () => {
    expect(normalizeColorPolicyPrefs({ pasteProfilePolicy: "convert" })).toMatchObject({ pasteProfilePolicy: "convert" });
    expect(normalizeColorPolicyPrefs({ pasteProfilePolicy: "bogus" })).toMatchObject({ pasteProfilePolicy: "ask" });
    expect(pasteProfileWarning(1, 1)).toBeNull();
    expect(pasteProfileWarning(1, 0)).toContain("clipboard pixels were copied from sRGB");
    expect(pasteProfilePolicyDecision(1, 0, "ask")).toBe("ask");
    expect(pasteProfilePolicyDecision(1, 0, "convert")).toBe("convert");
    expect(pasteProfilePolicyDecision(1, 0, "preserve-numbers")).toBe("preserve-numbers");
    expect(pasteProfilePolicyDecision(1, 1, "ask")).toBe("preserve-numbers");
  });

  it("allows assigned custom ICC clipboard profiles to use the exact transform path", () => {
    const custom = { profile: 0, assigned: true, customName: "Acme Wide Gamut RGB", customProfile: true };
    const p3 = { profile: 1, assigned: true };
    expect(pasteProfileName(custom)).toBe("Acme Wide Gamut RGB");
    expect(pasteProfileInfoMatches({ ...custom, customKey: "4:aaaa" }, { ...custom, customKey: "4:aaaa" })).toBe(true);
    expect(pasteProfileInfoMatches({ ...custom, customKey: "4:aaaa" }, { ...custom, customKey: "4:bbbb" })).toBe(false);
    expect(pasteProfileInfoMatches(custom, p3)).toBe(false);
    expect(pasteProfilePolicyDecisionForInfo(p3, custom, "convert")).toBe("convert");
    expect(pasteProfilePolicyDecisionForInfo(p3, custom, "ask")).toBe("ask");
    expect(pasteProfileWarningForInfo(p3, custom)).toContain("Acme Wide Gamut RGB");
    expect(pasteProfileWarningForInfo(p3, custom)).not.toContain("cannot convert");
    expect(canConvertPasteProfile(custom, p3)).toBe(true);
    expect(canConvertPasteProfile({ ...custom, assigned: false }, p3)).toBe(false);
  });
});

function pngWithChunk(type: string, data: number[]): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    (data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255,
    ...asciiBytes(type),
    ...data,
    0, 0, 0, 0,
  ]);
}

function asciiBytes(text: string): number[] {
  return Array.from(text, (ch) => ch.charCodeAt(0));
}

/** zlib-wrap through the platform's own deflate (no node:zlib types needed). */
async function zlibBytes(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function utf16beBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[i * 2] = (code >>> 8) & 255;
    out[i * 2 + 1] = code & 255;
  }
  return out;
}

/** APP2 ICC segments as `[index (1-based), count, data]`, in the given order. */
function jpegWithApp2(segments: [number, number, Uint8Array][]): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  for (const [seq, count, data] of segments) {
    const payload = [...asciiBytes("ICC_PROFILE\0"), seq, count, ...data];
    const length = payload.length + 2;
    out.push(0xff, 0xe2, (length >>> 8) & 255, length & 255, ...payload);
  }
  out.push(0xff, 0xd9);
  return new Uint8Array(out);
}

/** Header + a one-entry IFD0 (tag 34675, UNDEFINED) + the profile at offset 26. */
function tiffWithIcc(icc: Uint8Array, le: boolean): Uint8Array {
  const out = new Uint8Array(26 + icc.length);
  const u16 = (p: number, v: number) => { if (le) { out[p] = v & 255; out[p + 1] = v >>> 8; } else writeU16(out, p, v); };
  const u32 = (p: number, v: number) => { if (le) { out[p] = v & 255; out[p + 1] = (v >>> 8) & 255; out[p + 2] = (v >>> 16) & 255; out[p + 3] = v >>> 24; } else writeU32(out, p, v); };
  out.set(asciiBytes(le ? "II" : "MM"), 0);
  u16(2, 42);
  u32(4, 8); // IFD0 offset
  u16(8, 1); // one entry
  u16(10, 34675); u16(12, 7); u32(14, icc.length); u32(18, 26);
  u32(22, 0); // no next IFD
  out.set(icc, 26);
  return out;
}

/** RIFF/WEBP: VP8X, an odd-sized metadata chunk (so the even padding is
 *  exercised), then the ICCP chunk — or no ICCP at all for `null`. */
function webpWithIcc(icc: Uint8Array | null): Uint8Array {
  const chunk = (type: string, data: ArrayLike<number>) => {
    const out = new Uint8Array(8 + data.length + (data.length & 1));
    out.set(asciiBytes(type), 0);
    writeU32le(out, 4, data.length);
    out.set(data, 8);
    return out;
  };
  const chunks = [chunk("VP8X", [0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0]), chunk("XMP ", [1, 2, 3])];
  if (icc) chunks.push(chunk("ICCP", icc));
  const out = new Uint8Array(12 + chunks.reduce((n, c) => n + c.length, 0));
  out.set(asciiBytes("RIFF"), 0);
  writeU32le(out, 4, out.length - 8);
  out.set(asciiBytes("WEBP"), 8);
  let at = 12;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** ftyp(brand) + meta{ hdlr, iprp{ ipco{ ispe, colr } } } — the ISOBMFF shape
 *  AVIF and HEIC share. `null` writes an nclx colr instead of an ICC one. */
function heifWithIcc(brand: string, icc: Uint8Array | null): Uint8Array {
  const box = (type: string, ...parts: ArrayLike<number>[]) => {
    const out = new Uint8Array(8 + parts.reduce((n, p) => n + p.length, 0));
    writeU32(out, 0, out.length);
    out.set(asciiBytes(type), 4);
    let at = 8;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const colr = icc
    ? box("colr", asciiBytes("prof"), icc)
    : box("colr", asciiBytes("nclx"), [0, 1, 0, 13, 0, 1, 0x80]);
  const ftyp = box("ftyp", asciiBytes(brand), [0, 0, 0, 0], asciiBytes("mif1"));
  const meta = box("meta", [0, 0, 0, 0], // FullBox version + flags
    box("hdlr", [0, 0, 0, 0], [0, 0, 0, 0], asciiBytes("pict"), new Uint8Array(13)),
    box("iprp", box("ipco", box("ispe", [0, 0, 0, 0], [0, 0, 0, 1], [0, 0, 0, 1]), colr)));
  const out = new Uint8Array(ftyp.length + meta.length);
  out.set(ftyp, 0);
  out.set(meta, ftyp.length);
  return out;
}

function iccPayloadWithMlucDescription(name: string, colorSpace = "RGB "): Uint8Array {
  const text = utf16beBytes(name);
  const textOffset = 28;
  const tag = new Uint8Array(textOffset + text.length);
  tag.set(asciiBytes("mluc"), 0);
  writeU32(tag, 8, 1); // record count
  writeU32(tag, 12, 12); // record size
  tag.set(asciiBytes("enUS"), 16);
  writeU32(tag, 20, text.length);
  writeU32(tag, 24, textOffset);
  tag.set(text, textOffset);

  const tagOffset = 144;
  const payload = new Uint8Array(tagOffset + tag.length);
  writeU32(payload, 0, payload.length);
  payload.set(asciiBytes(colorSpace), 16);
  payload.set(asciiBytes("acsp"), 36);
  writeU32(payload, 128, 1); // tag count
  payload.set(asciiBytes("desc"), 132);
  writeU32(payload, 136, tagOffset);
  writeU32(payload, 140, tag.length);
  payload.set(tag, tagOffset);
  return payload;
}

function psdWithIccResource(payload: Uint8Array): Uint8Array {
  const resource = new Uint8Array(12 + payload.length + (payload.length % 2));
  resource.set(asciiBytes("8BIM"), 0);
  writeU16(resource, 4, 1039);
  resource[6] = 0; // empty Pascal resource name
  resource[7] = 0; // pad Pascal name to even length
  writeU32(resource, 8, payload.length);
  resource.set(payload, 12);

  const out = new Uint8Array(26 + 4 + 4 + resource.length + 4 + 2);
  out.set(asciiBytes("8BPS"), 0);
  writeU16(out, 4, 1); // PSD
  writeU16(out, 12, 3); // RGB channels
  writeU32(out, 14, 1); // height
  writeU32(out, 18, 1); // width
  writeU16(out, 22, 8); // depth
  writeU16(out, 24, 3); // RGB color mode
  writeU32(out, 26, 0); // color mode data length
  writeU32(out, 30, resource.length);
  out.set(resource, 34);
  writeU32(out, 34 + resource.length, 0); // layer/mask section length
  writeU16(out, 38 + resource.length, 0); // raw composite compression
  return out;
}

function writeU16(bytes: Uint8Array, pos: number, value: number) {
  bytes[pos] = (value >>> 8) & 255;
  bytes[pos + 1] = value & 255;
}

function writeU32(bytes: Uint8Array, pos: number, value: number) {
  bytes[pos] = (value >>> 24) & 255;
  bytes[pos + 1] = (value >>> 16) & 255;
  bytes[pos + 2] = (value >>> 8) & 255;
  bytes[pos + 3] = value & 255;
}

function writeU32le(bytes: Uint8Array, pos: number, value: number) {
  bytes[pos] = value & 255;
  bytes[pos + 1] = (value >>> 8) & 255;
  bytes[pos + 2] = (value >>> 16) & 255;
  bytes[pos + 3] = (value >>> 24) & 255;
}
