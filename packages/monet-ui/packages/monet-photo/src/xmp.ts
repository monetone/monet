// xmp — THE Camera Raw XMP dialect for the Monet photo apps.
//
// `<stem>.xmp` used to mean two mutually-unreadable things: Vision wrote a
// single base64 `mvcr:Payload` (lossless: source identity + full recipe +
// snapshots, unreadable by anything else), Galerie wrote an Adobe `crs:` +
// IPTC document (interoperable with Lightroom/ACR, but lossy and blind to
// Vision's payload). Same filename, same folder — last writer wiped the other.
//
// This module is the superset: ONE document that carries BOTH blocks, and one
// parser that reads either dialect or the union. The blocks are additive and
// independent, so an existing Vision reader and an existing Lightroom/Galerie
// reader each still find exactly what they look for in a file we write.
//
// COURIER RULE: the `mvcr:Payload` belongs to Vision. This module never
// validates or reshapes its contents — it decodes it for the owner (`monet`)
// and keeps the encoded text verbatim (`monetRaw`) so a non-owner can re-emit
// it byte-for-byte after a load+save round trip.
//
// No DOMParser: this package is framework-free and its vitest runs in node.
// Hand-rolled scanning also keeps the XML entity surface (XXE, billion laughs)
// out of reach — DOCTYPE/ENTITY are rejected outright.

import { cropIsActive } from "./developParams";
import {
  MAX_GRAPH_MASKS,
  MAX_HEAL_SPOTS,
  MAX_MASK_COMPONENTS,
  MAX_MASK_DABS,
  PROFILE_DIGEST_RE,
  createDefaultRecipe,
  normalizeRecipe,
  type CurvePoint,
  type DevelopRecipeV2,
  type HealSpot,
  type WhiteBalanceMode,
} from "./developRecipe";
import {
  createLocalAdjustments,
  type BrushDab,
  type CombineMode,
  type LocalAdjustments,
  type Mask,
  type MaskComponent,
} from "./maskGraph";

/** Monet's private XMP namespace, carrying Vision's lossless payload. */
export const MONET_CAMERA_RAW_NS = "https://monet.vision/ns/camera-raw/1.0/";

export const MAX_CAMERA_RAW_XMP_BYTES = 16 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 12 * 1024 * 1024;
const MAX_PAYLOAD_CHARS = Math.ceil(MAX_PAYLOAD_BYTES / 3) * 4;
const STRICT_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** IPTC/core descriptive fields carried alongside the develop block. */
export interface XmpPhotoMetadata {
  /** 0..5 stars; 0/absent = unrated. */
  rating?: number | null;
  /** Colour label name (e.g. "Red"). */
  label?: string | null;
  title?: string | null;
  caption?: string | null;
  creator?: string | null;
  copyright?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  country?: string | null;
  jobTitle?: string | null;
  credit?: string | null;
  source?: string | null;
  /** Flat keyword names → dc:subject. */
  keywords?: string[];
  /** Hierarchical keyword paths ("Parent|Child") → lr:hierarchicalSubject. */
  hierarchical?: string[];
}

/** A named develop snapshot travelling with the photo (LR's `crs:Snapshots`).
 *  `recipe` is the same ABI-backed patch shape as the document's own. */
export interface XmpSnapshot {
  name: string;
  recipe: Partial<DevelopRecipeV2> | null;
}

/** Everything a Monet Camera Raw XMP document can carry. */
export interface CameraRawXmpDocument {
  /** Preset/settings name (crs:Name / crs:PresetName), or null. */
  name: string | null;
  /** Develop patch recovered from the `crs:` block — only ABI-backed fields
   *  (see RULES); null when the document has no develop settings. */
  recipe: Partial<DevelopRecipeV2> | null;
  metadata: XmpPhotoMetadata;
  /** Named snapshots recovered from `crs:Snapshots`, in document order. */
  snapshots: XmpSnapshot[];
  /** Vision's payload, decoded. Opaque here — Vision owns its shape. */
  monet: unknown | null;
  /** The payload's base64 text exactly as it appeared, for courier re-emission. */
  monetRaw: string | null;
  /** `crs:` properties mapped into `recipe`. */
  mapped: string[];
  /** `crs:` properties deliberately not mapped, each with a reason. */
  skipped: string[];
}

export interface CameraRawXmpInput {
  name?: string | null;
  /** Any stored recipe shape; run through `normalizeRecipe` (v1/visionV2/v2). */
  recipe?: unknown;
  metadata?: XmpPhotoMetadata;
  /** Named snapshots to write. Each `recipe` takes any stored shape, same as
   *  the document's own. */
  snapshots?: { name: string; recipe?: unknown }[];
  /** Vision's payload to encode. Ignored when `monetRaw` is given. */
  monet?: unknown;
  /** A payload's base64 text from a previous parse, re-emitted verbatim. */
  monetRaw?: string | null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const unesc = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // last, so a literal "&amp;lt;" doesn't double-decode

/** Trim float noise (e.g. 33.00000000000001 → 33) without forcing decimals. */
const num = (n: number): string => String(Math.round(n * 1e6) / 1e6);

const reEsc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** wbMode ↔ the `crs:WhiteBalance` name ACR writes. This is a LABEL, not a
 *  develop parameter: the Temp/Tint a preset implies still ride the ABI-backed
 *  Incremental{Temperature,Tint} attributes, so the "no dead sliders" rule holds
 *  — nothing here claims a setting the engine wouldn't reproduce. Monet's
 *  offsets are measured from a 5500K reference (developRecipe WB_REFERENCE), so
 *  an ACR reader that also honours the name lands a little warm/cool of Monet's
 *  render; the deltas are the truth, the name is what the menu shows. */
const WB_XMP_NAME: Record<WhiteBalanceMode, string> = {
  asShot: "As Shot",
  auto: "Auto",
  custom: "Custom",
  daylight: "Daylight",
  cloudy: "Cloudy",
  shade: "Shade",
  tungsten: "Tungsten",
  fluorescent: "Fluorescent",
  flash: "Flash",
};
const WB_XMP_MODE = new Map<string, WhiteBalanceMode>(
  Object.entries(WB_XMP_NAME).map(([mode, name]) => [name.toLowerCase(), mode as WhiteBalanceMode]),
);

/** profile.id ↔ the `crs:CameraProfile` name ACR writes. Only ids with an
 *  engine profile code (developParams PROFILE_CODES) appear — the same "no dead
 *  sliders" contract as the numeric table. "camera-default" is the neutral
 *  default an absent attribute already means, so it's never written. */
const PROFILE_XMP_NAME: Record<string, string> = {
  "adobe-color": "Adobe Color",
  "camera-neutral": "Camera Neutral",
  monochrome: "Adobe Monochrome",
};
/** ProfilePanel.name shown by the apps (Galerie's PROFILE list) per mapped id. */
const PROFILE_UI_NAME: Record<string, string> = {
  "camera-default": "Camera Default",
  "adobe-color": "Adobe Color",
  "camera-neutral": "Camera Neutral",
  monochrome: "Monochrome",
};
const PROFILE_XMP_ID = new Map<string, string>([
  ...Object.entries(PROFILE_XMP_NAME).map(([id, name]) => [name.toLowerCase(), id] as const),
  // Aliases a foreign document may carry for the same engine codes.
  ["monochrome", "monochrome"],
  ["camera default", "camera-default"],
]);

/** A local (masked) adjustment ↔ Lightroom's `crs:Local*` attribute. LR stores
 *  the LOCAL sliders normalized (-1..1, i.e. UI/100) while the global ones are
 *  ±100, and LocalExposure2012 is in stops like the global Exposure2012 — which
 *  is exactly the Basic-panel domain LocalAdjustments already uses (see
 *  maskRender.foldLocalAdjustments), so this mapping needs no scaling. */
const LOCAL_ADJ: ReadonlyArray<readonly [keyof LocalAdjustments, string]> = [
  ["exposure", "LocalExposure2012"],
  ["contrast", "LocalContrast2012"],
  ["highlights", "LocalHighlights2012"],
  ["shadows", "LocalShadows2012"],
  ["whites", "LocalWhites2012"],
  ["blacks", "LocalBlacks2012"],
  ["texture", "LocalTexture"],
  ["clarity", "LocalClarity2012"],
  ["dehaze", "LocalDehaze"],
  ["saturation", "LocalSaturation"],
  ["temp", "LocalTemperature"],
  ["tint", "LocalTint"],
  ["sharpness", "LocalSharpness"],
  ["noise", "LocalLuminanceNoise"],
  ["moire", "LocalMoire"],
  ["defringe", "LocalDefringe"],
];

/** CombineMode ↔ `crs:MaskBlendMode` (LR: 0 add, 1 subtract, 2 intersect). */
const MASK_BLEND: Record<CombineMode, string> = { add: "0", subtract: "1", intersect: "2" };
const BLEND_COMBINE: Record<string, CombineMode> = { "0": "add", "1": "subtract", "2": "intersect" };

// Bounds for imported masks — the SAME caps `sanitizeRecipe` applies to a graph
// arriving as JSON (#114), imported from developRecipe so the two trust
// boundaries can't drift apart.
const MAX_XMP_MASKS = MAX_GRAPH_MASKS;
/** Same trust boundary for the snapshot bag: a foreign sidecar doesn't get to
 *  hand us an unbounded list of recipes to parse. */
const MAX_XMP_SNAPSHOTS = 64;
/** Gradient handles legitimately sit off-frame, so geometry isn't clamped to
 *  0..1 — this bound only keeps NaN/absurd coordinates out of the renderer. */
const MASK_COORD_LIMIT = 4;

const HSL_BANDS = ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"] as const;
const HSL_CHANNELS = [["Hue", "hue"], ["Saturation", "saturation"], ["Luminance", "luminance"]] as const;
const GRADE_ZONES = [["Shadow", "shadows"], ["Midtone", "midtones"], ["Highlight", "highlights"]] as const;

// ─── base64 (bounded, strict — this is a file-format trust boundary) ────────

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Decode strict, canonically-padded base64, or null. Rejects whitespace-free
 *  garbage, oversized payloads and non-canonical padding (which would let two
 *  different texts decode to the same bytes). */
function strictBase64ToBytes(encoded: string): Uint8Array | null {
  if (!encoded.length || encoded.length > MAX_PAYLOAD_CHARS || encoded.length % 4 !== 0) return null;
  if (!STRICT_BASE64.test(encoded)) return null;
  try {
    const binary = atob(encoded);
    if (!binary.length || binary.length > MAX_PAYLOAD_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// ─── serialize ─────────────────────────────────────────────────────────────

/** `crs:` develop attributes — the exact inverse of the RULES parse table
 *  (matching each field's scale), so a written document reads straight back.
 *  Only ABI-backed params are written: no dead sliders, nothing claiming a
 *  setting the engine wouldn't reproduce. */
function crsAttrs(r: DevelopRecipeV2): string[] {
  const out: string[] = [];
  // Only non-zero params are written — 0 is the default the parser already
  // assumes, and for Incremental{Temperature,Tint} a written 0 would needlessly
  // flip wbMode to "custom" on read-back.
  // A non-finite value would stringify to "NaN", which is not a legal XMP number
  // — ACR/Bridge choke on it and our own parser drops the property (#221).
  // `def` is that assumed default IN XMP SCALE: a field whose recipe default is
  // NOT 0 must gate on its own default, or a legal 0 is dropped and read back as
  // the default — a render-visible change across a round trip (#118).
  const add = (prop: string, val: number, def = 0): void => {
    if (val !== def && Number.isFinite(val)) out.push(`   crs:${prop}="${num(val)}"`);
  };
  const b = r.basic;
  add("Exposure2012", b.exposure); // exposure is unscaled (stops)
  add("Contrast2012", b.contrast * 100);
  add("Highlights2012", b.highlights * 100);
  add("Shadows2012", b.shadows * 100);
  add("Whites2012", b.whites * 100);
  add("Blacks2012", b.blacks * 100);
  add("Clarity2012", b.clarity * 100);
  add("Texture", b.texture * 100);
  add("Dehaze", b.dehaze * 100);
  add("Vibrance", b.vibrance * 100);
  add("Saturation", b.saturation * 100);
  add("IncrementalTemperature", b.temp * 100);
  // Negated: the recipe stores tint on the INTERNAL axis (positive = green, what
  // the Rust-authoritative canonical fixture pins), while crs:IncrementalTint is
  // Adobe's axis (negative = green, positive = magenta). Writing it unnegated made
  // every sidecar Lightroom or ACR read back apply the opposite correction. (#108)
  add("IncrementalTint", -b.tint * 100);
  // The WB menu selection. "As Shot" is the default the parser already assumes,
  // and "Custom" is what the Incremental* rules re-derive on read-back — writing
  // either would only give an ACR reader a name to second-guess the deltas with.
  if (b.wbMode !== "asShot" && b.wbMode !== "custom") {
    out.push(`   crs:WhiteBalance="${esc(WB_XMP_NAME[b.wbMode])}"`);
  }

  const d = r.detail;
  add("Sharpness", d.sharpenAmount * 100);
  add("SharpenRadius", d.sharpenRadius); // unscaled (0.5..3.0)
  add("LuminanceSmoothing", d.nrLuminance * 100);
  add("LuminanceNoiseReductionDetail", d.nrLuminanceDetail * 100);
  add("ColorNoiseReduction", d.nrColor * 100);
  // The sub-sliders are stored in ACR's own 0..100 units.
  add("SharpenDetail", d.sharpenDetail, XMP_DEFAULTS.detail.sharpenDetail);
  add("SharpenEdgeMasking", d.sharpenMasking);
  add("LuminanceNoiseReductionContrast", d.nrLuminanceContrast);
  add("ColorNoiseReductionDetail", d.nrColorDetail, XMP_DEFAULTS.detail.nrColorDetail);
  add("ColorNoiseReductionSmoothness", d.nrColorSmoothness, XMP_DEFAULTS.detail.nrColorSmoothness);

  const e = r.effects;
  add("PostCropVignetteAmount", e.vignetteAmount * 100);
  add("PostCropVignetteMidpoint", e.vignetteMidpoint * 100, 50); // recipe default 0.5
  add("GrainAmount", e.grainAmount * 100);
  add("GrainSize", e.grainSize * 100);
  add("GrainFrequency", e.grainRoughness * 100); // ACR stores Roughness as GrainFrequency

  const cm = r.colorMixer;
  for (let i = 0; i < HSL_BANDS.length; i++) {
    add(`HueAdjustment${HSL_BANDS[i]}`, cm.hue[i] * 100);
    add(`SaturationAdjustment${HSL_BANDS[i]}`, cm.saturation[i] * 100);
    add(`LuminanceAdjustment${HSL_BANDS[i]}`, cm.luminance[i] * 100);
  }

  const cg = r.colorGrading;
  add("ColorGradeShadowHue", cg.shadows.hue); // hue is 0..360 (unscaled)
  add("ColorGradeShadowSat", cg.shadows.sat * 100);
  add("ColorGradeMidtoneHue", cg.midtones.hue);
  add("ColorGradeMidtoneSat", cg.midtones.sat * 100);
  add("ColorGradeHighlightHue", cg.highlights.hue);
  add("ColorGradeHighlightSat", cg.highlights.sat * 100);

  // Tone Curve parametric regions (stored ±100 like ACR; masterToneLut composes
  // them into the shipped master LUT, so they're ABI-backed).
  const pm = r.toneCurve.parametric;
  add("ParametricShadows", pm.shadows);
  add("ParametricDarks", pm.darks);
  add("ParametricLights", pm.lights);
  add("ParametricHighlights", pm.highlights);
  // ponytail: splits are recipe-persisted authoring state for the regions above —
  // the render composes fixed centres today (teach toneCurve.parametricCurvePoints
  // splits to lift that ceiling), but an LR preset's split points must survive a
  // Galerie round trip rather than silently reverting to 25/50/75.
  const [shadowSplit, midSplit, highSplit] = r.toneCurve.parametricSplits;
  if (shadowSplit !== 0.25) out.push(`   crs:ParametricShadowSplit="${num(shadowSplit * 100)}"`);
  if (midSplit !== 0.5) out.push(`   crs:ParametricMidtoneSplit="${num(midSplit * 100)}"`);
  if (highSplit !== 0.75) out.push(`   crs:ParametricHighlightSplit="${num(highSplit * 100)}"`);

  const o = r.optics;
  if (o.enableProfileCorrections || o.profileName || o.profileId) out.push(`   crs:LensProfileEnable="${o.enableProfileCorrections ? 1 : 0}"`);
  if (o.profileName) out.push(`   crs:LensProfileName="${esc(o.profileName)}"`);
  if (o.profileId) out.push(`   crs:LensProfileDigest="${esc(o.profileId)}"`);
  if (o.enableProfileCorrections || o.profileName || o.profileId) out.push(`   crs:LensProfileSetup="${o.profileName || o.profileId ? "Custom" : "Auto"}"`);
  if (o.profileDistortionAmount !== undefined) add("LensProfileDistortionScale", o.profileDistortionAmount * 100, 100);
  if (o.profileVignettingAmount !== undefined) add("LensProfileVignettingScale", o.profileVignettingAmount * 100, 100);
  add("LensManualDistortionAmount", o.distortionAmount * 100);
  // Continuous 0..1 CA (engine p[1051]); ACR's on/off toggle reads non-zero as on.
  // Legacy recipes carry only the boolean (normalizeOptics keeps it verbatim for
  // digest stability), so mirror developParams' fallback rather than write the
  // absent field out as "NaN" (#221).
  add("AutoLateralCA", o.aberration ?? ((o as { removeChromaticAberration?: boolean }).removeChromaticAberration ? 1 : 0));
  add("DefringePurpleAmount", o.defringePurpleAmount * 20); // ACR domain 0..20
  const defaultOptics = XMP_DEFAULTS.optics;
  add("DefringePurpleHueLo", o.defringePurpleHue[0], defaultOptics.defringePurpleHue[0]);
  add("DefringePurpleHueHi", o.defringePurpleHue[1], defaultOptics.defringePurpleHue[1]);
  add("DefringeGreenAmount", o.defringeGreenAmount * 20); // ACR domain 0..20
  add("DefringeGreenHueLo", o.defringeGreenHue[0], defaultOptics.defringeGreenHue[0]);
  add("DefringeGreenHueHi", o.defringeGreenHue[1], defaultOptics.defringeGreenHue[1]);
  add("VignetteAmount", o.vignettingAmount * 100);

  const t = r.transform;
  add("PerspectiveVertical", t.vertical * 100);
  add("PerspectiveHorizontal", t.horizontal * 100);
  add("PerspectiveRotate", t.rotate * 15); // stored unit = 15° (see Upright solver)
  add("PerspectiveAspect", t.aspect * 100);
  add("PerspectiveX", t.xOffset * 100);
  add("PerspectiveY", t.yOffset * 100);
  if (t.scale !== 1) out.push(`   crs:PerspectiveScale="${num(t.scale * 100)}"`); // 1 = ACR's default 100
  if (t.constrainCrop === true) out.push('   crs:CropConstrainToWarp="1"');

  const cal = r.calibration;
  add("ShadowTint", cal.shadowTint * 100);
  add("RedHue", cal.redHue * 100);
  add("RedSaturation", cal.redSat * 100);
  add("GreenHue", cal.greenHue * 100);
  add("GreenSaturation", cal.greenSat * 100);
  add("BlueHue", cal.blueHue * 100);
  add("BlueSaturation", cal.blueSat * 100);

  const profileName = PROFILE_XMP_NAME[r.profile.id];
  if (profileName) out.push(`   crs:CameraProfile="${esc(profileName)}"`);
  // A DNG camera profile, ACR-style: a DNG's own profile is "Embedded", a
  // loaded .dcp goes by its name, and the digest pins which one.
  const dcpName = r.profile.id === "embedded" ? "Embedded" : r.profile.id === "custom" ? r.profile.name : "";
  if (dcpName) {
    out.push(`   crs:CameraProfile="${esc(dcpName)}"`);
    if (r.profile.digest) out.push(`   crs:CameraProfileDigest="${esc(r.profile.digest)}"`);
  }

  const cr = r.crop;
  if (cropIsActive(cr)) {
    // All four edges are written explicitly (like ACR) — 1.0 defaults would
    // otherwise be indistinguishable from "no crop" on a partial document.
    out.push('   crs:HasCrop="True"');
    out.push(`   crs:CropTop="${num(cr.rect.top)}"`);
    out.push(`   crs:CropLeft="${num(cr.rect.left)}"`);
    out.push(`   crs:CropBottom="${num(cr.rect.bottom)}"`);
    out.push(`   crs:CropRight="${num(cr.rect.right)}"`);
    add("CropAngle", cr.angle);
  }
  return out;
}

/** A `crs:` tone-curve rdf:Seq ("x, y" pairs in 0..255), or "" for the identity
 *  diagonal (nothing to record). */
function curveSeq(prop: string, pts: CurvePoint[]): string {
  const identity = pts.length === 2 && pts[0].x === 0 && pts[0].y === 0 && pts[1].x === 1 && pts[1].y === 1;
  if (identity) return "";
  const lis = pts
    .map((p) => `      <rdf:li>${Math.round(p.x * 255)}, ${Math.round(p.y * 255)}</rdf:li>`)
    .join("\n");
  return `   <crs:${prop}>\n    <rdf:Seq>\n${lis}\n    </rdf:Seq>\n   </crs:${prop}>`;
}

/** The heal panel as a classic ACR spot-removal Seq (`crs:RetouchInfo`) — the
 *  "key = value" grammar Lightroom still reads and writes for click spots, and
 *  a 1:1 fit for our disc-shaped HealSpot. Feather/opacity have no slot in this
 *  legacy grammar, so they drop on export (LR applies its own defaults).
 *  ponytail: radius rides verbatim; ACR's normalization basis (long vs short
 *  side) is undocumented while ours is min(w,h), so spots can scale slightly on
 *  non-square frames — remap through image dims at import if it ever shows. */
function retouchSeq(spots: HealSpot[]): string {
  if (!spots.length) return "";
  const lis = spots
    .map(
      (s) =>
        `      <rdf:li>centerX = ${num(s.x)}, centerY = ${num(s.y)}, radius = ${num(s.radius)}, sourceState = sourceSetExplicitly, sourceX = ${num(s.sourceX)}, sourceY = ${num(s.sourceY)}, spotType = ${s.mode}</rdf:li>`,
    )
    .join("\n");
  return `   <crs:RetouchInfo>\n    <rdf:Seq>\n${lis}\n    </rdf:Seq>\n   </crs:RetouchInfo>`;
}

/** One mask component as a `crs:CorrectionMasks` entry, or null when Lightroom
 *  has no lossless slot for it. The range (`rangeColor`/`rangeLuminance`/
 *  `rangeDepth`) and AI kinds select from PIXELS, and LR stores that as either
 *  an undocumented sample packing or a segmentation blob living outside the
 *  sidecar — so they're dropped rather than guessed, same skip-over-guess rule
 *  as PointColors. They still round-trip losslessly through `mvcr:Payload`.
 *  ponytail: a wrong shape here would corrupt what Lightroom reads back; the
 *  upgrade path is a documented `crs:CorrectionRangeMask` mapping, not a guess. */
function maskComponentLi(c: MaskComponent, groupInvert: boolean): string | null {
  const attrs: string[] = [];
  let children = "";
  switch (c.kind) {
    case "linearGradient":
      attrs.push(
        'crs:What="Mask/Gradient"',
        `crs:ZeroX="${num(c.x1)}"`, `crs:ZeroY="${num(c.y1)}"`,
        `crs:FullX="${num(c.x2)}"`, `crs:FullY="${num(c.y2)}"`,
      );
      break;
    case "radialGradient":
      // ponytail: Midpoint/Roundness are written at LR's neutral values — the
      // renderer's ellipse has no equivalent knob; teach componentCoverage a
      // superellipse exponent to lift that.
      attrs.push(
        'crs:What="Mask/CircularGradient"',
        `crs:Top="${num(c.cy - c.ry)}"`, `crs:Left="${num(c.cx - c.rx)}"`,
        `crs:Bottom="${num(c.cy + c.ry)}"`, `crs:Right="${num(c.cx + c.rx)}"`,
        `crs:Angle="${num((c.angle * 180) / Math.PI)}"`,
        'crs:Midpoint="50"', 'crs:Roundness="0"',
        `crs:Feather="${num(clamp(c.feather, 0, 1) * 100)}"`,
      );
      break;
    case "brush": {
      // LR carries ONE radius/flow per paint mask (per-dab variation is a
      // Monet extension), so the dabs' means stand in, and eraser dabs have no
      // slot at all. ponytail: an erased stroke exports as un-erased coverage —
      // upgrade path is splitting erase runs into a subtract-blended sibling.
      const paint = c.dabs.filter((d) => !d.erase);
      if (!paint.length) return null;
      const mean = (f: (d: BrushDab) => number): number => paint.reduce((s, d) => s + f(d), 0) / paint.length;
      attrs.push(
        'crs:What="Mask/Paint"',
        `crs:Radius="${num(mean((d) => d.radius))}"`,
        `crs:Flow="${num(mean((d) => d.flow))}"`,
        'crs:CenterWeight="0"',
      );
      const dabs = paint.map((d) => `             <rdf:li>d ${num(d.x)} ${num(d.y)}</rdf:li>`).join("\n");
      children = `\n           <crs:MaskDabs>\n            <rdf:Seq>\n${dabs}\n            </rdf:Seq>\n           </crs:MaskDabs>`;
      break;
    }
    default:
      return null;
  }
  attrs.push(
    'crs:MaskActive="true"',
    `crs:MaskBlendMode="${MASK_BLEND[c.combine] ?? "0"}"`,
    `crs:MaskInverted="${c.invert !== groupInvert}"`, // XOR: group inversion folds in here
    'crs:MaskValue="1"',
  );
  const head = `         <rdf:li>\n          <rdf:Description\n${attrs.map((a) => `           ${a}`).join("\n")}`;
  return children
    ? `${head}>${children}\n          </rdf:Description>\n         </rdf:li>`
    : `${head}/>\n         </rdf:li>`;
}

/** The mask graph as Lightroom's `crs:MaskGroupBasedCorrections` — the block LR
 *  11+/ACR write for every local correction, so masks survive a trip through
 *  Lightroom, ACR or Bridge instead of reading as globally-adjusted-only.
 *  A mask with no expressible component is omitted entirely (an empty
 *  correction would be a mask LR can't render, not an approximation). */
function maskGroupElement(masks: Mask[]): string {
  const items: string[] = [];
  for (const m of masks) {
    // ponytail: LR has no per-correction invert, only per-component
    // crs:MaskInverted — exact to fold in for a single component, and a
    // multi-component group inversion (¬(A∪B) etc.) has no faithful blend-mode
    // rewrite, so it exports uninverted. Upgrade path: bake the inversion into
    // the geometry when the tools can.
    const groupInvert = m.inverted && m.components.length === 1;
    const comps = m.components
      .map((c) => maskComponentLi(c, groupInvert))
      .filter((li): li is string => li !== null);
    if (!comps.length) continue;

    const attrs = [
      'crs:What="Correction"',
      `crs:CorrectionAmount="${num(clamp(m.opacity, 0, 1))}"`,
      `crs:CorrectionActive="${m.enabled}"`,
      `crs:CorrectionName="${esc(m.name)}"`,
    ];
    for (const [field, prop] of LOCAL_ADJ) {
      const v = m.adjustments[field];
      if (v) attrs.push(`crs:${prop}="${num(v)}"`);
    }
    items.push(
      `     <rdf:li>\n      <rdf:Description\n${attrs.map((a) => `       ${a}`).join("\n")}>\n`
      + `       <crs:CorrectionMasks>\n        <rdf:Seq>\n${comps.join("\n")}\n        </rdf:Seq>\n       </crs:CorrectionMasks>\n`
      + "      </rdf:Description>\n     </rdf:li>",
    );
  }
  if (!items.length) return "";
  return `   <crs:MaskGroupBasedCorrections>\n    <rdf:Seq>\n${items.join("\n")}\n    </rdf:Seq>\n   </crs:MaskGroupBasedCorrections>`;
}

/** An rdf:Bag of `<rdf:li>` items (dc:subject / lr:hierarchicalSubject), or "". */
function bag(tag: string, items: string[]): string {
  if (!items.length) return "";
  const lis = items.map((k) => `     <rdf:li>${esc(k)}</rdf:li>`).join("\n");
  return `   <${tag}>\n    <rdf:Bag>\n${lis}\n    </rdf:Bag>\n   </${tag}>`;
}

/** The `crs:` attributes + nested elements of ONE recipe — shared by the
 *  document's own develop block and every `crs:Snapshots` entry, so a snapshot
 *  is written in exactly the dialect the parser already reads. */
function recipeBlock(recipe: DevelopRecipeV2): { attrs: string[]; elems: string[] } {
  const attrs = crsAttrs(recipe);
  const elems: string[] = [];
  for (const [prop, pts] of [
    ["ToneCurvePV2012", recipe.toneCurve.point],
    ["ToneCurvePV2012Red", recipe.toneCurve.red],
    ["ToneCurvePV2012Green", recipe.toneCurve.green],
    ["ToneCurvePV2012Blue", recipe.toneCurve.blue],
  ] as const) {
    const seq = curveSeq(prop, pts);
    if (seq) elems.push(seq);
  }
  const retouch = retouchSeq(recipe.heal.spots);
  if (retouch) elems.push(retouch);
  const maskGroup = maskGroupElement(recipe.masks?.masks ?? []);
  if (maskGroup) elems.push(maskGroup);
  return { attrs, elems };
}

/** Push every line deeper by `pad`, keeping the block's own relative indent. */
const indentBlock = (s: string, pad: string): string =>
  s.split("\n").map((l) => pad + l).join("\n");

/** LR's `crs:Snapshots`: an rdf:Bag of named recipes, each an rdf:Description
 *  carrying the same crs: grammar as the top-level block. LR itself stores the
 *  settings as an escaped XML string in `crs:Parameters`; plain nested RDF says
 *  the same thing to any RDF reader and costs no second escaping layer.
 *  ponytail: LR-written snapshots therefore read back as name-only here —
 *  unescape crs:Parameters if importing foreign snapshots ever matters. */
function snapshotBag(snaps: NonNullable<CameraRawXmpInput["snapshots"]>): string {
  if (!snaps.length) return "";
  const items = snaps.slice(0, MAX_XMP_SNAPSHOTS).map((s) => {
    const { attrs, elems } = recipeBlock(normalizeRecipe(s.recipe));
    const head = [`      <rdf:Description crs:Name="${esc(s.name)}"`, ...attrs.map((a) => `    ${a}`)].join("\n");
    const body = elems.length ? `\n${indentBlock(elems.join("\n"), "    ")}\n      ` : "";
    return `     <rdf:li>\n${head}>${body}</rdf:Description>\n     </rdf:li>`;
  });
  return `   <crs:Snapshots>\n    <rdf:Bag>\n${items.join("\n")}\n    </rdf:Bag>\n   </crs:Snapshots>`;
}

/** An rdf:Alt language alternative (dc:title / dc:description / dc:rights). */
function alt(tag: string, value: string): string {
  return `   <${tag}>\n    <rdf:Alt>\n     <rdf:li xml:lang="x-default">${esc(value)}</rdf:li>\n    </rdf:Alt>\n   </${tag}>`;
}

/** Encode Vision's payload once, or pass through an already-encoded one.
 *  Validation is not optional here: an unchecked `monetRaw` could carry a
 *  `</mvcr:Payload>` and tear the document open. */
function encodePayload(input: CameraRawXmpInput): string | null {
  if (input.monetRaw != null) {
    const raw = input.monetRaw.replace(/[ \t\r\n]/g, "");
    if (!raw) return null;
    if (!strictBase64ToBytes(raw)) throw new Error("monet-photo/xmp: monetRaw is not a valid Monet payload");
    return raw;
  }
  if (input.monet === undefined || input.monet === null) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(input.monet));
  if (bytes.length > MAX_PAYLOAD_BYTES) throw new Error("monet-photo/xmp: Monet payload is too large");
  return bytesToBase64(bytes);
}

/**
 * Serialize a develop recipe + IPTC metadata + Vision's lossless payload as a
 * single Camera Raw XMP document. Every block is optional; the result is valid
 * (and readable by Lightroom/ACR) with any subset present.
 */
export function serializeCameraRawXmp(input: CameraRawXmpInput = {}): string {
  const meta = input.metadata ?? {};
  const attrs: string[] = ['   crs:HasSettings="True"'];
  const elems: string[] = [];

  if (input.name) attrs.push(`   crs:Name="${esc(input.name)}"`);

  if (input.recipe != null) {
    const block = recipeBlock(normalizeRecipe(input.recipe));
    attrs.push(...block.attrs);
    elems.push(...block.elems);
  }

  if (meta.rating != null && meta.rating > 0) attrs.push(`   xmp:Rating="${Math.round(meta.rating)}"`);
  if (meta.label) attrs.push(`   xmp:Label="${esc(meta.label)}"`);

  if (meta.city) elems.push(`   <photoshop:City>${esc(meta.city)}</photoshop:City>`);
  if (meta.stateProvince) elems.push(`   <photoshop:State>${esc(meta.stateProvince)}</photoshop:State>`);
  if (meta.country) elems.push(`   <photoshop:Country>${esc(meta.country)}</photoshop:Country>`);
  if (meta.jobTitle) elems.push(`   <photoshop:AuthorsPosition>${esc(meta.jobTitle)}</photoshop:AuthorsPosition>`);
  if (meta.credit) elems.push(`   <photoshop:Credit>${esc(meta.credit)}</photoshop:Credit>`);
  if (meta.source) elems.push(`   <photoshop:Source>${esc(meta.source)}</photoshop:Source>`);
  if (meta.title) elems.push(alt("dc:title", meta.title));
  if (meta.caption) elems.push(alt("dc:description", meta.caption));
  if (meta.creator) {
    elems.push(`   <dc:creator>\n    <rdf:Seq>\n     <rdf:li>${esc(meta.creator)}</rdf:li>\n    </rdf:Seq>\n   </dc:creator>`);
  }
  if (meta.copyright) elems.push(alt("dc:rights", meta.copyright));
  const subj = bag("dc:subject", meta.keywords ?? []);
  if (subj) elems.push(subj);
  const hier = bag("lr:hierarchicalSubject", meta.hierarchical ?? []);
  if (hier) elems.push(hier);
  const snaps = snapshotBag(input.snapshots ?? []);
  if (snaps) elems.push(snaps);

  const payload = encodePayload(input);
  if (payload) elems.push(`   <mvcr:Payload encoding="base64">${payload}</mvcr:Payload>`);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:mvcr="${MONET_CAMERA_RAW_NS}"
${attrs.join("\n")}>
${elems.join("\n")}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`;
  if (new TextEncoder().encode(xml).length > MAX_CAMERA_RAW_XMP_BYTES) {
    throw new Error("monet-photo/xmp: document is too large");
  }
  return xml;
}

/** The sidecar path for a source: `<source-without-extension>.xmp` beside it. */
export function xmpSidecarPath(sourcePath: string): string {
  const slash = Math.max(sourcePath.lastIndexOf("/"), sourcePath.lastIndexOf("\\"));
  const dot = sourcePath.lastIndexOf(".");
  const stem = dot > slash ? sourcePath.slice(0, dot) : sourcePath;
  return `${stem}.xmp`;
}

// ─── parse: the crs: rule table ─────────────────────────────────────────────

/** Working draft of only the panels this parser ever touches, each a partial
 *  patch (mirrors how developRecipe's `mergePanel` consumes a partial panel). */
interface Draft {
  basic: Partial<DevelopRecipeV2["basic"]>;
  detail: Partial<DevelopRecipeV2["detail"]>;
  colorMixer: Partial<Pick<DevelopRecipeV2["colorMixer"], "hue" | "saturation" | "luminance">>;
  colorGrading: {
    shadows?: Partial<DevelopRecipeV2["colorGrading"]["shadows"]>;
    midtones?: Partial<DevelopRecipeV2["colorGrading"]["midtones"]>;
    highlights?: Partial<DevelopRecipeV2["colorGrading"]["highlights"]>;
  };
  effects: Partial<DevelopRecipeV2["effects"]>;
  toneCurve: Partial<Pick<DevelopRecipeV2["toneCurve"], "point" | "red" | "green" | "blue" | "parametricSplits">> & {
    parametric?: Partial<DevelopRecipeV2["toneCurve"]["parametric"]>;
  };
  optics: Partial<DevelopRecipeV2["optics"]>;
  transform: Partial<DevelopRecipeV2["transform"]>;
  calibration: Partial<DevelopRecipeV2["calibration"]>;
  profile: Partial<DevelopRecipeV2["profile"]>;
  crop: Partial<Omit<DevelopRecipeV2["crop"], "rect">> & { rect?: Partial<DevelopRecipeV2["crop"]["rect"]> };
  heal: Partial<DevelopRecipeV2["heal"]>;
  /** Local corrections; absent (not empty) when the document carries none, so a
   *  crs:-only preset never wipes the photo's existing masks. */
  masks?: Mask[];
}

type Rule = ((v: number, d: Draft) => void) | { skip: string };

function setGrade(d: Draft, zone: "shadows" | "midtones" | "highlights", field: "hue" | "sat", v: number): void {
  d.colorGrading[zone] = { ...d.colorGrading[zone], [field]: v };
}

function setParametric(d: Draft, region: "highlights" | "lights" | "darks" | "shadows", v: number): void {
  d.toneCurve.parametric = { ...d.toneCurve.parametric, [region]: v };
}

/** The splits tuple under construction, seeded with the ACR defaults so a
 *  document carrying only one split still yields a complete [s, m, h]. */
function splitsOf(d: Draft): [number, number, number] {
  return d.toneCurve.parametricSplits ?? (d.toneCurve.parametricSplits = [0.25, 0.5, 0.75]);
}

/** Recipe defaults for the non-zero fields the Detail/Optics rules gate on. */
const XMP_DEFAULTS = createDefaultRecipe();

function hueWindowOf(d: Draft, key: "defringePurpleHue" | "defringeGreenHue"): [number, number] {
  const [lo, hi] = XMP_DEFAULTS.optics[key];
  return d.optics[key] ?? (d.optics[key] = [lo, hi]);
}

function cropRectOf(d: Draft): Partial<DevelopRecipeV2["crop"]["rect"]> {
  return d.crop.rect ?? (d.crop.rect = {});
}

// Hard rule ("no dead sliders"): a crs:* property is only mapped to a recipe
// field when developParams.ts (recipeToParams) actually serializes that field to
// the engine ABI. Anything else — even a real ACR property — lands in `skipped`
// with a reason instead of writing a field the engine never reads.
const RULES: Record<string, Rule> = {
  // Basic (developParams p[2..14] — every Basic field is ABI-backed).
  Exposure2012: (v, d) => (d.basic.exposure = clamp(v, -4, 4)),
  Contrast2012: (v, d) => (d.basic.contrast = clamp(v / 100, -1, 1)),
  Highlights2012: (v, d) => (d.basic.highlights = clamp(v / 100, -1, 1)),
  Shadows2012: (v, d) => (d.basic.shadows = clamp(v / 100, -1, 1)),
  Whites2012: (v, d) => (d.basic.whites = clamp(v / 100, -1, 1)),
  Blacks2012: (v, d) => (d.basic.blacks = clamp(v / 100, -1, 1)),
  Clarity2012: (v, d) => (d.basic.clarity = clamp(v / 100, -1, 1)),
  Texture: (v, d) => (d.basic.texture = clamp(v / 100, -1, 1)),
  Dehaze: (v, d) => (d.basic.dehaze = clamp(v / 100, -1, 1)),
  Vibrance: (v, d) => (d.basic.vibrance = clamp(v / 100, -1, 1)),
  Saturation: (v, d) => (d.basic.saturation = clamp(v / 100, -1, 1)),
  // ACR ships relative Incremental* deltas because a preset doesn't know the
  // as-shot Kelvin base of the photo it lands on.
  IncrementalTemperature: (v, d) => {
    d.basic.temp = clamp(v / 100, -1, 1);
    d.basic.wbMode = "custom";
  },
  IncrementalTint: (v, d) => {
    // Adobe axis -> internal axis; see the negation in crsAttrs. (#108)
    d.basic.tint = clamp(-v / 100, -1, 1);
    d.basic.wbMode = "custom";
  },
  Temperature: { skip: "absolute Kelvin temperature" },
  Tint: { skip: "paired with absolute Temperature (non-incremental, ambiguous domain)" },
  // WhiteBalance is a NAME, not a number, so it can't ride this numeric table —
  // `readWhiteBalance` handles it after the loop (see `consumed`).
  ProcessVersion: { skip: "Adobe's process-version numbering is unrelated to Monet's engine processVersion" },
  ConvertToGrayscale: { skip: "colorMixer.mode not ABI-backed (recipeToParams only writes HSL bands)" },
  HasSettings: { skip: "presence marker, not a develop parameter" },

  // Detail (developParams p[15..19]; the sub-sliders ride the v5 extras block in
  // ACR's own 0..100 units).
  Sharpness: (v, d) => (d.detail.sharpenAmount = clamp(v / 100, 0, 1)),
  SharpenRadius: (v, d) => (d.detail.sharpenRadius = clamp(v, 0.5, 3.0)),
  SharpenDetail: (v, d) => (d.detail.sharpenDetail = clamp(v, 0, 100)),
  SharpenEdgeMasking: (v, d) => (d.detail.sharpenMasking = clamp(v, 0, 100)),
  LuminanceSmoothing: (v, d) => (d.detail.nrLuminance = clamp(v / 100, 0, 1)),
  LuminanceNoiseReductionDetail: (v, d) => (d.detail.nrLuminanceDetail = clamp(v / 100, 0, 1)),
  LuminanceNoiseReductionContrast: (v, d) => (d.detail.nrLuminanceContrast = clamp(v, 0, 100)),
  ColorNoiseReduction: (v, d) => (d.detail.nrColor = clamp(v / 100, 0, 1)),
  ColorNoiseReductionDetail: (v, d) => (d.detail.nrColorDetail = clamp(v, 0, 100)),
  ColorNoiseReductionSmoothness: (v, d) => (d.detail.nrColorSmoothness = clamp(v, 0, 100)),

  // Effects (developParams p[20..24]).
  PostCropVignetteAmount: (v, d) => (d.effects.vignetteAmount = clamp(v / 100, -1, 1)),
  PostCropVignetteMidpoint: (v, d) => (d.effects.vignetteMidpoint = clamp(v / 100, 0, 1)),
  PostCropVignetteRoundness: { skip: "not ABI-backed (recipeToParams doesn't serialize vignetteRoundness)" },
  PostCropVignetteFeather: { skip: "not ABI-backed (recipeToParams doesn't serialize vignetteFeather)" },
  PostCropVignetteHighlights: { skip: "not ABI-backed (recipeToParams doesn't serialize vignetteHighlights)" },
  PostCropVignetteStyle: { skip: "not ABI-backed (no vignette style field in the recipe)" },
  GrainAmount: (v, d) => (d.effects.grainAmount = clamp(v / 100, 0, 1)),
  GrainSize: (v, d) => (d.effects.grainSize = clamp(v / 100, 0, 1)),
  // ACR's "Roughness" UI label is still stored under the legacy GrainFrequency name.
  GrainFrequency: (v, d) => (d.effects.grainRoughness = clamp(v / 100, 0, 1)),

  // Color Grading (developParams p[1077..1082]: shadow/midtone/highlight hue+sat).
  ColorGradeGlobalHue: { skip: "global wheel not ABI-backed" },
  ColorGradeGlobalSat: { skip: "global wheel not ABI-backed" },
  ColorGradeGlobalLum: { skip: "global wheel not ABI-backed" },
  ColorGradeBlending: { skip: "not ABI-backed" },
  ColorGradeBalance: { skip: "not ABI-backed" },
  // Legacy 2-way Split Toning (pre Color Grading) reuses the same shadow/
  // highlight hue+sat fields; there is no midtone slot.
  SplitToningShadowHue: (v, d) => setGrade(d, "shadows", "hue", clamp(v, 0, 360)),
  SplitToningShadowSaturation: (v, d) => setGrade(d, "shadows", "sat", clamp(v / 100, 0, 1)),
  SplitToningHighlightHue: (v, d) => setGrade(d, "highlights", "hue", clamp(v, 0, 360)),
  SplitToningHighlightSaturation: (v, d) => setGrade(d, "highlights", "sat", clamp(v / 100, 0, 1)),
  SplitToningBalance: { skip: "colorGrading.balance not ABI-backed" },

  // Tone Curve parametric regions (±100, stored verbatim — masterToneLut composes
  // them into the master LUT recipeToParams ships). Splits ride the recipe as
  // authoring state for those regions (see the serializer's ponytail note).
  ParametricShadows: (v, d) => setParametric(d, "shadows", clamp(v, -100, 100)),
  ParametricDarks: (v, d) => setParametric(d, "darks", clamp(v, -100, 100)),
  ParametricLights: (v, d) => setParametric(d, "lights", clamp(v, -100, 100)),
  ParametricHighlights: (v, d) => setParametric(d, "highlights", clamp(v, -100, 100)),
  ParametricShadowSplit: (v, d) => (splitsOf(d)[0] = clamp(v / 100, 0, 1)),
  ParametricMidtoneSplit: (v, d) => (splitsOf(d)[1] = clamp(v / 100, 0, 1)),
  ParametricHighlightSplit: (v, d) => (splitsOf(d)[2] = clamp(v / 100, 0, 1)),

  // Optics (developParams p[1050..1052]; lens Vignetting, the hue windows and
  // green Defringe ride the v5 extras block).
  LensManualDistortionAmount: (v, d) => (d.optics.distortionAmount = clamp(v / 100, -1, 1)),
  // Engine CA is continuous 0..1; ACR's toggle writes 0/1, which maps verbatim.
  AutoLateralCA: (v, d) => (d.optics.aberration = clamp(v, 0, 1)),
  DefringePurpleAmount: (v, d) => (d.optics.defringePurpleAmount = clamp(v / 20, 0, 1)), // ACR 0..20
  DefringePurpleHueLo: (v, d) => (hueWindowOf(d, "defringePurpleHue")[0] = clamp(v, 0, 100)),
  DefringePurpleHueHi: (v, d) => (hueWindowOf(d, "defringePurpleHue")[1] = clamp(v, 0, 100)),
  DefringeGreenAmount: (v, d) => (d.optics.defringeGreenAmount = clamp(v / 20, 0, 1)), // ACR 0..20
  DefringeGreenHueLo: (v, d) => (hueWindowOf(d, "defringeGreenHue")[0] = clamp(v, 0, 100)),
  DefringeGreenHueHi: (v, d) => (hueWindowOf(d, "defringeGreenHue")[1] = clamp(v, 0, 100)),
  LensProfileEnable: (v, d) => (d.optics.enableProfileCorrections = v !== 0),
  LensProfileDistortionScale: (v, d) => (d.optics.profileDistortionAmount = clamp(v / 100, 0, 2)),
  LensProfileVignettingScale: (v, d) => (d.optics.profileVignettingAmount = clamp(v / 100, 0, 2)),
  LensProfileChromaticAberrationScale: { skip: "lateral CA uses the selected calibration at its native amount" },
  LensProfileFilename: { skip: "external Adobe lens files are not loaded; profile name/digest is retained" },
  VignetteAmount: (v, d) => (d.optics.vignettingAmount = clamp(v / 100, -1, 1)),
  VignetteMidpoint: { skip: "lens vignetting midpoint not ABI-backed (the engine's lens vignette has a fixed falloff)" },

  // Transform (developParams p[1083..1085] keystone + the v4 advanced tail).
  PerspectiveVertical: (v, d) => (d.transform.vertical = clamp(v / 100, -1, 1)),
  PerspectiveHorizontal: (v, d) => (d.transform.horizontal = clamp(v / 100, -1, 1)),
  // ACR stores degrees; the stored unit is 15° (see Galerie's Upright solver).
  PerspectiveRotate: (v, d) => (d.transform.rotate = clamp(v / 15, -1, 1)),
  PerspectiveAspect: (v, d) => (d.transform.aspect = clamp(v / 100, -1, 1)),
  PerspectiveScale: (v, d) => (d.transform.scale = clamp(v / 100, 0.5, 1.5)),
  PerspectiveX: (v, d) => (d.transform.xOffset = clamp(v / 100, -1, 1)),
  PerspectiveY: (v, d) => (d.transform.yOffset = clamp(v / 100, -1, 1)),
  CropConstrainToWarp: (v, d) => (d.transform.constrainCrop = v !== 0),
  PerspectiveUpright: {
    skip: "Upright is re-solved per photo; its keystone result rides Perspective{Vertical,Horizontal,Rotate}",
  },

  // Camera Calibration (advanced tail p[1090..1096]).
  ShadowTint: (v, d) => (d.calibration.shadowTint = clamp(v / 100, -1, 1)),
  RedHue: (v, d) => (d.calibration.redHue = clamp(v / 100, -1, 1)),
  RedSaturation: (v, d) => (d.calibration.redSat = clamp(v / 100, -1, 1)),
  GreenHue: (v, d) => (d.calibration.greenHue = clamp(v / 100, -1, 1)),
  GreenSaturation: (v, d) => (d.calibration.greenSat = clamp(v / 100, -1, 1)),
  BlueHue: (v, d) => (d.calibration.blueHue = clamp(v / 100, -1, 1)),
  BlueSaturation: (v, d) => (d.calibration.blueSat = clamp(v / 100, -1, 1)),

  // Crop (applied TS-side from crop.rect/angle; visionV2 tail [1097..1106]).
  CropTop: (v, d) => (cropRectOf(d).top = clamp(v, 0, 1)),
  CropLeft: (v, d) => (cropRectOf(d).left = clamp(v, 0, 1)),
  CropBottom: (v, d) => (cropRectOf(d).bottom = clamp(v, 0, 1)),
  CropRight: (v, d) => (cropRectOf(d).right = clamp(v, 0, 1)),
  CropAngle: (v, d) => (d.crop.angle = clamp(v, -360, 360)),
  HasCrop: { skip: "presence marker, not a develop parameter" },

  // Heal / Point Color (advanced tail: heals 8 floats each, samples 7 each).
  // Classic click spots ride crs:RetouchInfo both ways — extractRetouch /
  // retouchSeq. The structured/packed grammars below are skipped, never
  // guessed: a wrong shape would corrupt what Lightroom reads back.
  RetouchAreas: { skip: "LR's structured retouch mask grammar not mapped (classic spots ride RetouchInfo)" },
  PointColors: { skip: "LR's packed Point Color list layout is undocumented (Monet point color rides mvcr:Payload)" },
  // The local-correction blocks (MaskGroupBasedCorrections and the pre-LR11
  // per-tool ones) are consumed by extractMasks before this table runs.
};

for (const [crsChannel, recipeChannel] of HSL_CHANNELS) {
  for (let i = 0; i < HSL_BANDS.length; i++) {
    RULES[`${crsChannel}Adjustment${HSL_BANDS[i]}`] = (v, d) => {
      const arr = d.colorMixer[recipeChannel] ?? (d.colorMixer[recipeChannel] = [0, 0, 0, 0, 0, 0, 0, 0]);
      arr[i] = clamp(v / 100, -1, 1);
    };
  }
}
for (const [crsZone, recipeZone] of GRADE_ZONES) {
  RULES[`ColorGrade${crsZone}Hue`] = (v, d) => setGrade(d, recipeZone, "hue", clamp(v, 0, 360));
  RULES[`ColorGrade${crsZone}Sat`] = (v, d) => setGrade(d, recipeZone, "sat", clamp(v / 100, 0, 1));
  RULES[`ColorGrade${crsZone}Lum`] = { skip: "lum not ABI-backed for Color Grading (recipeToParams only writes hue+sat)" };
}

/** Preset bookkeeping: real ACR fields, but not develop parameters at all, so
 *  they're silently ignored rather than cluttering `skipped`. */
const IGNORED = new Set([
  "Name", "PresetName", "Group", "UUID", "SupportsAmount2", "PresetType", "Cluster", "Version", "AlreadyApplied",
  "CameraProfileDigest", // bookkeeping for the CameraProfile we do map
]);

const CURVE_FIELD: Record<string, "point" | "red" | "green" | "blue"> = {
  ToneCurvePV2012: "point",
  ToneCurvePV2012Red: "red",
  ToneCurvePV2012Green: "green",
  ToneCurvePV2012Blue: "blue",
  ToneCurve: "point",
  ToneCurveRed: "red",
  ToneCurveGreen: "green",
  ToneCurveBlue: "blue",
};

/** "x, y" (0..255) rdf:li pairs → normalized, strictly-increasing-x points, or
 *  null if the shape doesn't align cleanly (skip-over-guess per the curve). */
function parseCurvePoints(body: string): CurvePoint[] | null {
  const entries = [...body.matchAll(/<rdf:li>([^<]*)<\/rdf:li>/g)].map((m) => m[1].trim());
  if (entries.length < 2) return null;
  const points: CurvePoint[] = [];
  for (const entry of entries) {
    const parts = entry.split(",").map((s) => Number(s.trim()));
    if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
    const p = { x: clamp(parts[0] / 255, 0, 1), y: clamp(parts[1] / 255, 0, 1) };
    // The curve must stay single-valued. x is stored quantized to 0..255, so two
    // authored points closer than 1/255 collapse onto the same integer — drop the
    // duplicate rather than the whole channel (#224).
    if (points.length && p.x <= points[points.length - 1].x) continue;
    points.push(p);
  }
  return points.length >= 2 ? points : null;
}

function extractCurves(xml: string, draft: Draft, mapped: string[], skipped: string[]): void {
  const re = /<crs:(ToneCurve(?:PV2012)?(?:Red|Green|Blue)?)>\s*<rdf:Seq>([\s\S]*?)<\/rdf:Seq>\s*<\/crs:\1>/g;
  for (const m of xml.matchAll(re)) {
    const [, name, body] = m;
    const field = CURVE_FIELD[name];
    const points = parseCurvePoints(body);
    if (field && points) {
      draft.toneCurve[field] = points;
      mapped.push(`crs:${name}`);
    } else {
      skipped.push(`crs:${name} (unparseable point list)`);
    }
  }
}

/** `crs:RetouchInfo` "key = value" spot list → the heal panel. Skip-over-guess
 *  per spot: an entry missing coords or naming a spotType the engine doesn't
 *  render is reported in `skipped`, not invented. Feather/opacity have no slot
 *  in this grammar, so imported spots take the recipe defaults (HEAL_SPEC). */
function extractRetouch(xml: string, d: Draft, mapped: string[], skipped: string[]): void {
  const block = xml.match(/<crs:RetouchInfo>\s*<rdf:Seq>([\s\S]*?)<\/rdf:Seq>\s*<\/crs:RetouchInfo>/);
  if (!block) return;
  const spots: HealSpot[] = [];
  let bad = 0;
  for (const li of block[1].matchAll(/<rdf:li>([^<]*)<\/rdf:li>/g)) {
    const kv = new Map<string, string>();
    for (const pair of li[1].split(",")) {
      const eq = pair.indexOf("=");
      if (eq > 0) kv.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const mode = kv.get("spotType");
    const nums = ["centerX", "centerY", "radius", "sourceX", "sourceY"].map((k) => Number(kv.get(k)));
    if ((mode !== "heal" && mode !== "clone") || nums.some((n) => !Number.isFinite(n))) {
      bad++;
      continue;
    }
    const [x, y, radius, sourceX, sourceY] = nums;
    spots.push({
      mode,
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
      sourceX: clamp(sourceX, 0, 1),
      sourceY: clamp(sourceY, 0, 1),
      radius: clamp(radius, 0, 1),
      feather: 0.5, // HEAL_SPEC defaults — no slot in the legacy grammar
      opacity: 1,
    });
  }
  if (spots.length) {
    d.heal.spots = spots.slice(0, MAX_HEAL_SPOTS);
    mapped.push("crs:RetouchInfo");
  }
  if (bad) skipped.push(`crs:RetouchInfo (${bad} unparseable spot(s))`);
}

// ─── parse: local corrections (masks) ──────────────────────────────────────

/** The inner text (plus outer bounds) of the first `<tag …>…</tag>` at or after
 *  `from`, matched by DEPTH so a nested same-name element — rdf:Seq inside
 *  rdf:Seq, rdf:li inside rdf:li — doesn't cut it short. Self-closing tags carry
 *  no inner text and are stepped over. Null when absent or unclosed. */
function innerOf(xml: string, tag: string, from = 0): { inner: string; start: number; end: number } | null {
  const re = new RegExp(`<(/?)${reEsc(tag)}(?:\\s[^>]*?)?(/?)>`, "g");
  re.lastIndex = from;
  let depth = 0;
  let open = -1;
  let start = -1;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[1] === "/") {
      if (depth > 0 && --depth === 0) return { inner: xml.slice(start, m.index), start: open, end: re.lastIndex };
    } else if (m[2] !== "/") {
      if (depth++ === 0) {
        open = m.index;
        start = re.lastIndex;
      }
    }
  }
  return null;
}

/** Top-level `<rdf:li>` bodies of an rdf:Seq/Bag body, bounded by `limit`. */
function liItems(body: string, limit: number): string[] {
  const out: string[] = [];
  let pos = 0;
  while (out.length < limit) {
    const li = innerOf(body, "rdf:li", pos);
    if (!li) break;
    out.push(li.inner);
    pos = li.end;
  }
  return out;
}

/** A finite `crs:<name>` scalar (attribute or leaf element), or null. */
function numAttr(xml: string, name: string): number | null {
  const raw = scalar(xml, `crs:${name}`);
  if (raw == null || raw.trim() === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

const coord = (v: number): number => clamp(v, -MASK_COORD_LIMIT, MASK_COORD_LIMIT);

/** `crs:MaskDabs` — LR's "d <x> <y>" stamp list. Radius/flow live on the mask,
 *  not the dab, so every imported dab shares them. */
function parseDabs(li: string, radius: number, flow: number): BrushDab[] {
  const el = innerOf(li, "crs:MaskDabs");
  if (!el) return [];
  const out: BrushDab[] = [];
  for (const m of el.inner.matchAll(/<rdf:li[^>]*>([^<]*)<\/rdf:li>/g)) {
    if (out.length >= MAX_MASK_DABS) break;
    const parts = m[1].trim().split(/\s+/);
    // Anything but a plain dab (LR also writes "m"/"s" stroke forms) is dropped
    // rather than guessed at — a mis-read stamp paints in the wrong place.
    if (parts.length !== 3 || parts[0] !== "d") continue;
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ x: clamp(x, 0, 1), y: clamp(y, 0, 1), radius, flow, density: 1, erase: false });
  }
  return out;
}

/** One `crs:CorrectionMasks` entry → a mask component, or null when it selects
 *  from pixels we can't reconstruct from a sidecar (Mask/Image = an AI
 *  segmentation blob, Mask/RangeMask = an undocumented sample packing). */
function parseMaskComponent(li: string, id: string, block: string, skipped: string[]): MaskComponent | null {
  if (scalar(li, "crs:MaskActive") === "false") return null; // contributes nothing to coverage
  const base = {
    id,
    combine: BLEND_COMBINE[scalar(li, "crs:MaskBlendMode") ?? "0"] ?? "add",
    // crs:Flipped is the pre-LR11 circular-gradient invert flag; XOR so a legacy
    // and a modern sidecar land on the same coverage.
    invert: (scalar(li, "crs:MaskInverted") === "true") !== (scalar(li, "crs:Flipped") === "true"),
  };
  const n = (name: string, fallback: number): number => numAttr(li, name) ?? fallback;
  const what = scalar(li, "crs:What") ?? "";
  switch (what) {
    case "Mask/Gradient":
      return {
        ...base,
        kind: "linearGradient",
        x1: coord(n("ZeroX", 0)), y1: coord(n("ZeroY", 0)),
        x2: coord(n("FullX", 1)), y2: coord(n("FullY", 1)),
      };
    case "Mask/CircularGradient": {
      const top = coord(n("Top", 0));
      const left = coord(n("Left", 0));
      const bottom = coord(n("Bottom", 1));
      const right = coord(n("Right", 1));
      return {
        ...base,
        kind: "radialGradient",
        cx: (left + right) / 2,
        cy: (top + bottom) / 2,
        rx: Math.abs(right - left) / 2,
        ry: Math.abs(bottom - top) / 2,
        angle: (n("Angle", 0) * Math.PI) / 180,
        // ponytail: LR's Midpoint/Roundness have no slot in the renderer's
        // ellipse and are ignored, so a rounded LR radial imports slightly soft.
        feather: clamp(n("Feather", 50) / 100, 0, 1),
      };
    }
    case "Mask/Paint": {
      const dabs = parseDabs(li, clamp(n("Radius", 0.05), 0, 1), clamp(n("Flow", 1), 0, 1));
      if (!dabs.length) {
        skipped.push(`crs:${block} (Mask/Paint with no readable dabs)`);
        return null;
      }
      // crs:AutoMask isn't part of this grammar — imported strokes paint plainly.
      return { ...base, kind: "brush", dabs, autoMask: false };
    }
    default:
      skipped.push(`crs:${block} (mask kind "${what}" needs pixel data a sidecar can't carry)`);
      return null;
  }
}

/** One correction `<rdf:li>` → a Mask, or null when nothing in it is renderable. */
function parseCorrection(li: string, index: number, block: string, skipped: string[]): Mask | null {
  const cm = innerOf(li, "crs:CorrectionMasks");
  // Read the correction's own scalars from the body WITHOUT its nested masks, so
  // a component's crs:* attribute can never be mistaken for the correction's.
  const header = cm ? li.slice(0, cm.start) + li.slice(cm.end) : li;
  const components: MaskComponent[] = [];
  const seq = cm ? innerOf(cm.inner, "rdf:Seq") : null;
  if (seq) {
    for (const item of liItems(seq.inner, MAX_MASK_COMPONENTS)) {
      const c = parseMaskComponent(item, `xmp-m${index}-c${components.length}`, block, skipped);
      if (c) components.push(c);
    }
  }
  if (!components.length) return null;

  const adjustments = createLocalAdjustments();
  for (const [field, prop] of LOCAL_ADJ) {
    const v = numAttr(header, prop);
    // Exposure is in stops like the global Exposure2012; every other local
    // slider is LR's normalized -1..1.
    if (v != null) adjustments[field] = field === "exposure" ? clamp(v, -4, 4) : clamp(v, -1, 1);
  }
  return {
    id: `xmp-m${index}`,
    name: scalar(header, "crs:CorrectionName") || `Mask ${index + 1}`,
    enabled: scalar(header, "crs:CorrectionActive") !== "false",
    inverted: false, // inversion rides each component's crs:MaskInverted
    opacity: clamp(numAttr(header, "CorrectionAmount") ?? 1, 0, 1),
    components,
    adjustments,
  };
}

/** Every LR local-correction block name. They all carry the SAME correction
 *  grammar — pre-LR11 split corrections by authoring tool, LR 11+/ACR write
 *  everything as MaskGroupBasedCorrections — so one parser reads them all. */
const MASK_BLOCKS = [
  "MaskGroupBasedCorrections",
  "GradientBasedCorrections",
  "CircularGradientBasedCorrections",
  "PaintBasedCorrections",
] as const;

/** Lightroom's local corrections → the mask graph. Returns `xml` with the
 *  blocks CUT OUT, so the generic crs: scan that follows doesn't report every
 *  nested `crs:Local…`/`crs:Mask…` attribute as an unrecognized property. */
function extractMasks(xml: string, d: Draft, mapped: string[], skipped: string[]): string {
  let rest = xml;
  const masks: Mask[] = [];
  for (const block of MASK_BLOCKS) {
    const el = innerOf(rest, `crs:${block}`);
    if (!el) continue;
    rest = rest.slice(0, el.start) + rest.slice(el.end);
    const seq = innerOf(el.inner, "rdf:Seq");
    if (!seq) {
      skipped.push(`crs:${block} (no rdf:Seq of corrections)`);
      continue;
    }
    let found = 0;
    for (const li of liItems(seq.inner, MAX_XMP_MASKS)) {
      if (masks.length >= MAX_XMP_MASKS) break;
      const mask = parseCorrection(li, masks.length, block, skipped);
      if (mask) {
        masks.push(mask);
        found++;
      }
    }
    if (found) mapped.push(`crs:${block}`);
  }
  if (masks.length) d.masks = masks;
  return rest;
}

function extractName(xml: string): string | null {
  const attr = xml.match(/crs:(?:Name|PresetName)="([^"]*)"/) ?? xml.match(/crs:(?:Name|PresetName)='([^']*)'/);
  if (attr) return unesc(attr[1]);
  const nested = xml.match(
    /<crs:(?:Name|PresetName)>[\s\S]*?<rdf:li[^>]*>([^<]*)<\/rdf:li>[\s\S]*?<\/crs:(?:Name|PresetName)>/,
  );
  return nested ? unesc(nested[1].trim()) : null;
}

function findAttr(xml: string, name: string): string | null {
  return xml.match(new RegExp(`crs:${name}="([^"]*)"`))?.[1]
    ?? xml.match(new RegExp(`crs:${name}='([^']*)'`))?.[1]
    ?? null;
}
function findScalarElement(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<crs:${name}>([^<]*)<\\/crs:${name}>`));
  return m ? m[1].trim() : null;
}

/** `crs:WhiteBalance` → `basic.wbMode`. Runs AFTER the RULES loop: the
 *  Incremental{Temperature,Tint} rules imply "custom", but an explicit preset
 *  name is the stronger statement about what the user picked. */
function readWhiteBalance(xml: string, d: Draft, mapped: string[], skipped: string[]): void {
  const raw = scalar(xml, "crs:WhiteBalance");
  if (raw == null) return;
  const mode = WB_XMP_MODE.get(raw.trim().toLowerCase());
  if (mode) {
    d.basic.wbMode = mode;
    mapped.push("crs:WhiteBalance");
  } else {
    skipped.push(`crs:WhiteBalance (unknown value "${raw}")`);
  }
}

/** `crs:CameraProfile` → `profile.{id,name}` (engine code via PROFILE_CODES).
 *  Runs AFTER the RULES loop like WhiteBalance: it's a name, not a number.
 *  "Embedded" is the image's own DNG profile, and any other name that comes
 *  with a `crs:CameraProfileDigest` is a DNG camera profile (.dcp) — kept by
 *  name + digest for the app to find again. A name with neither is skipped,
 *  never guessed. */
function readCameraProfile(xml: string, d: Draft, mapped: string[], skipped: string[]): void {
  const raw = scalar(xml, "crs:CameraProfile");
  if (raw == null) return;
  const name = raw.trim();
  const id = PROFILE_XMP_ID.get(name.toLowerCase());
  const digest = scalar(xml, "crs:CameraProfileDigest")?.trim().toUpperCase() ?? "";
  const pinned = PROFILE_DIGEST_RE.test(digest);
  if (id) {
    d.profile.id = id;
    d.profile.name = PROFILE_UI_NAME[id];
    mapped.push("crs:CameraProfile");
  } else if (name.toLowerCase() === "embedded" || (name && pinned)) {
    d.profile.id = name.toLowerCase() === "embedded" ? "embedded" : "custom";
    d.profile.name = name;
    if (pinned) d.profile.digest = digest;
    mapped.push("crs:CameraProfile");
  } else {
    skipped.push(`crs:CameraProfile (no engine profile for "${raw}")`);
  }
}

function readLensProfile(xml: string, d: Draft, mapped: string[], skipped: string[]): void {
  const name = scalar(xml, "crs:LensProfileName");
  if (name !== null) { d.optics.profileName = name.trim().slice(0, 512) || null; mapped.push("crs:LensProfileName"); }
  const digest = scalar(xml, "crs:LensProfileDigest");
  if (digest !== null) {
    if (/^[0-9a-f]{32}$/i.test(digest.trim())) { d.optics.profileId = digest.trim().toLowerCase(); mapped.push("crs:LensProfileDigest"); }
    else skipped.push("crs:LensProfileDigest (invalid profile identity)");
  }
  const setup = scalar(xml, "crs:LensProfileSetup");
  if (setup !== null) {
    const mode = setup.trim().toLowerCase();
    if (["auto", "custom", "lensdefaults"].includes(mode)) {
      // Adobe sidecars may cache the profile last found automatically. That
      // cached identity must not turn Automatic into a manual selection on
      // another photo. Explicit undefined also clears an existing target id
      // when callers merge this patch over their current optics settings.
      if (mode !== "custom") { d.optics.profileName = null; d.optics.profileId = undefined; }
      mapped.push("crs:LensProfileSetup");
    }
    else skipped.push(`crs:LensProfileSetup (unknown value "${setup}")`);
  }
}

function buildPatch(d: Draft): Partial<DevelopRecipeV2> {
  const patch: Partial<DevelopRecipeV2> = {};
  if (Object.keys(d.basic).length) patch.basic = d.basic as DevelopRecipeV2["basic"];
  if (Object.keys(d.detail).length) patch.detail = d.detail as DevelopRecipeV2["detail"];
  if (Object.keys(d.colorMixer).length) patch.colorMixer = d.colorMixer as DevelopRecipeV2["colorMixer"];
  if (Object.keys(d.colorGrading).length) patch.colorGrading = d.colorGrading as DevelopRecipeV2["colorGrading"];
  if (Object.keys(d.effects).length) patch.effects = d.effects as DevelopRecipeV2["effects"];
  if (Object.keys(d.toneCurve).length) patch.toneCurve = d.toneCurve as DevelopRecipeV2["toneCurve"];
  if (Object.keys(d.optics).length) patch.optics = d.optics as DevelopRecipeV2["optics"];
  if (Object.keys(d.transform).length) patch.transform = d.transform as DevelopRecipeV2["transform"];
  if (Object.keys(d.calibration).length) patch.calibration = d.calibration as DevelopRecipeV2["calibration"];
  if (Object.keys(d.profile).length) patch.profile = d.profile as DevelopRecipeV2["profile"];
  if (Object.keys(d.crop).length) patch.crop = d.crop as DevelopRecipeV2["crop"];
  if (Object.keys(d.heal).length) patch.heal = d.heal as DevelopRecipeV2["heal"];
  if (d.masks) patch.masks = { masks: d.masks };
  return patch;
}

// ─── parse: metadata ───────────────────────────────────────────────────────

/** A namespaced scalar as either an attribute (`ns:Name="v"`) or a leaf element
 *  (`<ns:Name>v</ns:Name>`). */
function scalar(xml: string, name: string): string | null {
  const n = reEsc(name);
  const attr = xml.match(new RegExp(`${n}="([^"]*)"`)) ?? xml.match(new RegExp(`${n}='([^']*)'`));
  if (attr) return unesc(attr[1]);
  const el = xml.match(new RegExp(`<${n}>([^<]*)</${n}>`));
  return el ? unesc(el[1].trim()) : null;
}

/** First rdf:li text inside a wrapper (dc:title/description/rights/creator). */
function firstLi(xml: string, tag: string): string | null {
  const n = reEsc(tag);
  const m = xml.match(new RegExp(`<${n}>[\\s\\S]*?<rdf:li[^>]*>([^<]*)</rdf:li>`));
  return m ? unesc(m[1].trim()) : null;
}

/** All rdf:li texts inside an rdf:Bag wrapper (dc:subject / lr:hierarchicalSubject). */
function bagItems(xml: string, tag: string): string[] {
  const n = reEsc(tag);
  const block = xml.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`));
  if (!block) return [];
  return [...block[1].matchAll(/<rdf:li[^>]*>([^<]*)<\/rdf:li>/g)]
    .map((m) => unesc(m[1].trim()))
    .filter(Boolean);
}

function readMetadata(xml: string): XmpPhotoMetadata {
  const ratingRaw = scalar(xml, "xmp:Rating");
  const rating = ratingRaw != null && ratingRaw !== "" && !Number.isNaN(Number(ratingRaw)) ? Number(ratingRaw) : null;
  return {
    rating,
    label: scalar(xml, "xmp:Label"),
    title: firstLi(xml, "dc:title"),
    caption: firstLi(xml, "dc:description"),
    creator: firstLi(xml, "dc:creator"),
    copyright: firstLi(xml, "dc:rights"),
    city: scalar(xml, "photoshop:City"),
    stateProvince: scalar(xml, "photoshop:State"),
    country: scalar(xml, "photoshop:Country"),
    jobTitle: scalar(xml, "photoshop:AuthorsPosition"),
    credit: scalar(xml, "photoshop:Credit"),
    source: scalar(xml, "photoshop:Source"),
    keywords: bagItems(xml, "dc:subject"),
    hierarchical: bagItems(xml, "lr:hierarchicalSubject"),
  };
}

// ─── parse ─────────────────────────────────────────────────────────────────

/** Throws for input that isn't a well-formed XMP document: not XML at all, or
 *  unbalanced tags. */
function assertWellFormed(xml: string): void {
  if (!xml.includes("<") || !xml.includes(">")) throw new Error("monet-photo/xmp: not a valid XML document");
  const stack: string[] = [];
  for (const m of xml.matchAll(/<([^>]+)>/g)) {
    const content = m[1].trim();
    if (content.startsWith("?") || content.startsWith("!")) continue; // decl / comment
    if (content.startsWith("/")) {
      const tag = content.slice(1).trim().split(/\s/)[0];
      if (stack.pop() !== tag) throw new Error(`monet-photo/xmp: malformed XML, mismatched closing tag </${tag}>`);
      continue;
    }
    if (!content.endsWith("/")) stack.push(content.replace(/\/$/, "").trim().split(/\s/)[0]);
  }
  if (stack.length > 0) throw new Error("monet-photo/xmp: malformed XML, unclosed tag(s)");
}

const PAYLOAD_RE = /<mvcr:Payload\b[^>]*>([\s\S]*?)<\/mvcr:Payload\s*>/i;

/**
 * Parse a Camera Raw XMP document in any Monet dialect: the Adobe `crs:` form
 * (Lightroom/ACR presets and Galerie sidecars), Vision's `mvcr:Payload` form,
 * or a unified document carrying both.
 *
 * Throws when the input isn't a usable document — a corrupt payload or a
 * truncated file must surface, not silently degrade to an empty edit.
 */
export function parseCameraRawXmp(input: string | Uint8Array): CameraRawXmpDocument {
  let xml: string;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > MAX_CAMERA_RAW_XMP_BYTES) {
      throw new Error("monet-photo/xmp: document is too large");
    }
    xml = input;
  } else {
    if (!input.length || input.length > MAX_CAMERA_RAW_XMP_BYTES) {
      throw new Error("monet-photo/xmp: document is empty or too large");
    }
    try {
      xml = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      throw new Error("monet-photo/xmp: document is not valid UTF-8");
    }
  }
  // No entity/DTD surface is ever needed by this dialect, so refuse it outright
  // rather than hand an expansion bomb to whatever reads the file next.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("monet-photo/xmp: DOCTYPE/ENTITY is not allowed");
  assertWellFormed(xml);

  // A bare `xmlns:crs="…"` declaration counts: a document that declares the
  // namespace but sets no property is a valid Camera Raw XMP carrying an EMPTY
  // preset, and both photo apps have always read it that way. Note the plain
  // `crs:` test does not match `xmlns:crs=` — the colon lands in the wrong place.
  const hasCrs = /crs:|xmlns:crs\s*=/.test(xml);
  const payloadMatch = PAYLOAD_RE.exec(xml);
  if (!hasCrs && !payloadMatch) {
    throw new Error("monet-photo/xmp: not a Camera Raw XMP (no crs: or mvcr:Payload found)");
  }

  let monet: unknown = null;
  let monetRaw: string | null = null;
  if (payloadMatch) {
    const rest = xml.slice(payloadMatch.index + payloadMatch[0].length);
    if (PAYLOAD_RE.test(rest)) throw new Error("monet-photo/xmp: more than one mvcr:Payload");
    monetRaw = payloadMatch[1].replace(/[ \t\r\n]/g, "");
    const bytes = strictBase64ToBytes(monetRaw);
    if (!bytes) throw new Error("monet-photo/xmp: mvcr:Payload is not valid base64");
    try {
      monet = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new Error("monet-photo/xmp: mvcr:Payload is not valid JSON");
    }
  }

  // Snapshots come out of the document FIRST: their crs: attributes are a
  // snapshot's settings, not the photo's, and every scan below would otherwise
  // read them as top-level develop properties (same reason masks are cut out).
  const { rest, snapshots } = extractSnapshots(xml);

  const mapped: string[] = [];
  const skipped: string[] = [];
  const patch = hasCrs ? extractRecipe(rest, mapped, skipped) : {};
  return {
    name: extractName(rest),
    recipe: Object.keys(patch).length ? patch : null,
    metadata: readMetadata(rest),
    snapshots,
    monet,
    monetRaw,
    mapped,
    skipped,
  };
}

/** The develop patch carried by ONE crs: block — the whole document, or a
 *  single `crs:Snapshots` entry. Appends what it mapped/skipped to the caller's
 *  lists. */
function extractRecipe(xml: string, mapped: string[], skipped: string[]): Partial<DevelopRecipeV2> {
  const draft: Draft = {
    basic: {}, detail: {}, colorMixer: {}, colorGrading: {}, effects: {}, toneCurve: {},
    optics: {}, transform: {}, calibration: {}, profile: {}, crop: {}, heal: {},
  };
  // The local-correction blocks come out of the document first: they're the
  // only nested crs: grammar with crs: attributes of their own, and the flat
  // scan below would otherwise read every Local*/Mask* attribute as a
  // top-level property.
  const flat = extractMasks(xml, draft, mapped, skipped);
  extractCurves(flat, draft, mapped, skipped);
  extractRetouch(flat, draft, mapped, skipped);
  const consumed = new Set<string>([...IGNORED, ...Object.keys(CURVE_FIELD), "WhiteBalance", "CameraProfile", "LensProfileName", "LensProfileDigest", "LensProfileSetup", "RetouchInfo"]);
  const names = new Set<string>();
  for (const m of flat.matchAll(/crs:([A-Za-z0-9]+)=/g)) names.add(m[1]);
  for (const m of flat.matchAll(/<crs:([A-Za-z0-9]+)[\s>]/g)) names.add(m[1]);

  for (const name of names) {
    if (consumed.has(name)) continue;
    const raw = findAttr(flat, name) ?? findScalarElement(flat, name);
    const rule = RULES[name];
    if (rule && typeof rule !== "function") {
      // A deliberate skip carries its reason even when the property is a
      // nested element (RetouchAreas, PointColors) rather than a scalar.
      skipped.push(`crs:${name} (${rule.skip})`);
    } else if (raw == null) {
      skipped.push(`crs:${name} (nested/complex structure not parsed)`);
    } else if (!rule) {
      skipped.push(`crs:${name} (unrecognized property)`);
    } else if (Number.isNaN(Number(raw))) {
      skipped.push(`crs:${name} (non-numeric value "${raw}")`);
    } else {
      rule(Number(raw), draft);
      mapped.push(`crs:${name}`);
    }
  }
  readWhiteBalance(flat, draft, mapped, skipped);
  readCameraProfile(flat, draft, mapped, skipped);
  readLensProfile(flat, draft, mapped, skipped);
  return buildPatch(draft);
}

/** `crs:Snapshots` → named recipes, plus `xml` with the block CUT OUT. A
 *  snapshot with no name has no handle in any UI, so it is dropped; its own
 *  mapped/skipped notes are local to it and don't join the document's. */
function extractSnapshots(xml: string): { rest: string; snapshots: XmpSnapshot[] } {
  const el = innerOf(xml, "crs:Snapshots");
  if (!el) return { rest: xml, snapshots: [] };
  const rest = xml.slice(0, el.start) + xml.slice(el.end);
  const items = innerOf(el.inner, "rdf:Bag");
  const snapshots: XmpSnapshot[] = [];
  for (const li of liItems(items?.inner ?? "", MAX_XMP_SNAPSHOTS)) {
    const name = extractName(li);
    if (!name) continue;
    const patch = extractRecipe(li, [], []);
    snapshots.push({ name, recipe: Object.keys(patch).length ? patch : null });
  }
  return { rest, snapshots };
}

/** Tolerant form: null instead of a throw, for "is there a usable sidecar
 *  beside this file?" probes where absence is normal. */
export function tryParseCameraRawXmp(input: string | Uint8Array): CameraRawXmpDocument | null {
  try {
    return parseCameraRawXmp(input);
  } catch {
    return null;
  }
}

// ponytail: apps still own their own xmp readers/writers (vision's
// state/cameraRawSidecar.ts, galerie's lib/xmpSidecar.ts + lib/xmpPreset.ts).
// This module is the superset they should both delegate to — re-pointing them
// is GV-03/ASSET-08/FMT-06, not this change. Until then the tables here and
// there must stay in sync; the round-trip test below pins this side.
