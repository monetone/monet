import { inflateZlib } from "./inflate";

export const COLOR_MODES = [
  { id: 0, label: "RGB Color" },
  { id: 1, label: "Grayscale" },
  { id: 2, label: "CMYK Color" },
  { id: 3, label: "Lab Color" },
  { id: 4, label: "Multichannel" },
] as const;

export const RGB_PROFILES = [
  { id: 0, label: "sRGB IEC61966-2.1" },
  { id: 1, label: "Display P3" },
  { id: 2, label: "Adobe RGB (1998)" },
  { id: 3, label: "Rec.2020" },
] as const;

// Working spaces for the non-RGB colour models (Color Settings ▸ Working
// Spaces). The CMYK entries carry the two press numbers every separation in the
// app needs — midtone dot gain (in the normalized `ink + g·ink·(1−ink)` form the
// soft proof uses, so SWOP reproduces today's hardcoded 0.12) and the total ink
// limit — so proofing and the CMYK writer separate against the *chosen* space
// instead of each hardcoding one press.
export const CMYK_PROFILES = [
  { id: 0, label: "U.S. Web Coated (SWOP) v2", dotGain: 0.12, totalInkLimit: 3.0 },
  { id: 1, label: "U.S. Sheetfed Coated v2", dotGain: 0.1, totalInkLimit: 3.5 },
  { id: 2, label: "Coated FOGRA39 (ISO 12647-2:2004)", dotGain: 0.13, totalInkLimit: 3.3 },
  { id: 3, label: "Japan Color 2001 Coated", dotGain: 0.13, totalInkLimit: 3.5 },
  { id: 4, label: "U.S. Web Uncoated v2", dotGain: 0.22, totalInkLimit: 2.6 },
  { id: 5, label: "Uncoated FOGRA29 (ISO 12647-2:2004)", dotGain: 0.2, totalInkLimit: 3.0 },
] as const;

export const GRAY_PROFILES = [
  { id: 0, label: "Dot Gain 20%" },
  { id: 1, label: "Dot Gain 15%" },
  { id: 2, label: "Gray Gamma 2.2" },
  { id: 3, label: "Gray Gamma 1.8" },
] as const;

export const SPOT_PROFILES = [
  { id: 0, label: "Dot Gain 20%" },
  { id: 1, label: "Dot Gain 15%" },
  { id: 2, label: "Dot Gain 25%" },
  { id: 3, label: "Dot Gain 30%" },
] as const;

export const RENDERING_INTENTS = [
  { id: 0, label: "Perceptual" },
  { id: 1, label: "Relative Colorimetric" },
  { id: 2, label: "Saturation" },
  { id: 3, label: "Absolute Colorimetric" },
] as const;

/** Conversion engines (Photoshop's Engine popup). Only CMMs that actually
 *  exist are listed: every ICC conversion runs through moxcms in the engine. */
export const COLOR_ENGINES = [
  { id: "moxcms", label: "Monet (moxcms)" },
] as const;

export const OCIO_PROOF_CONFIGS = [
  { id: "acescg", label: "OCIO ACEScg" },
  { id: "aces2065", label: "OCIO ACES2065-1" },
] as const;

export const HDR_PROOF_CONFIGS = [
  { id: "hdr-pq", label: "HDR Display (Rec.2100 PQ)" },
  { id: "hdr-hlg", label: "HDR Display (Rec.2100 HLG)" },
] as const;

export const EMBEDDED_PROFILE_POLICIES = [
  { id: "ask", label: "Ask When Opening" },
  { id: "preserve", label: "Preserve Embedded Profiles" },
  { id: "convert", label: "Convert to Working RGB" },
  { id: "discard", label: "Discard Embedded Profiles" },
] as const;

export const MISSING_PROFILE_POLICIES = [
  { id: "ask", label: "Ask When Opening" },
  { id: "leave-untagged", label: "Leave Untagged" },
  { id: "assign-working", label: "Assign Working RGB" },
  { id: "assign-srgb", label: "Assign sRGB" },
] as const;

export const PASTE_PROFILE_POLICIES = [
  { id: "ask", label: "Ask When Pasting" },
  { id: "convert", label: "Convert to Document RGB" },
  { id: "preserve-numbers", label: "Preserve RGB Numbers" },
] as const;

export type ColorModeId = (typeof COLOR_MODES)[number]["id"];
export type RgbProfileId = (typeof RGB_PROFILES)[number]["id"];
export type CmykProfileId = (typeof CMYK_PROFILES)[number]["id"];
export type CmykWorkingSpace = (typeof CMYK_PROFILES)[number];
export type GrayProfileId = (typeof GRAY_PROFILES)[number]["id"];
export type SpotProfileId = (typeof SPOT_PROFILES)[number]["id"];
export type RenderingIntentId = (typeof RENDERING_INTENTS)[number]["id"];
export type ColorEngineId = (typeof COLOR_ENGINES)[number]["id"];
export type ProfilePolicyAction = "working" | "assign" | "convert";
export type EmbeddedProfileSource = "png-cicp" | "png-iccp" | "png-srgb" | "jpeg-icc" | "psd-icc" | "tiff-icc" | "webp-icc" | "heif-icc";
export type EmbeddedProfilePolicy = (typeof EMBEDDED_PROFILE_POLICIES)[number]["id"];
export type EmbeddedProfileDecision = "ask" | "preserve" | "convert" | "discard";
export type MissingProfilePolicy = (typeof MISSING_PROFILE_POLICIES)[number]["id"];
export type MissingProfileDecision = "ask" | "leave-untagged" | "assign-working" | "assign-srgb";
export type PasteProfilePolicy = (typeof PASTE_PROFILE_POLICIES)[number]["id"];
export type PasteProfileDecision = "ask" | "convert" | "preserve-numbers";

export interface PasteProfileInfo {
  profile: number;
  assigned?: boolean;
  customName?: string | null;
  customProfile?: boolean;
  customKey?: string | null;
}

export interface ColorPolicyPrefs {
  embeddedProfilePolicy: EmbeddedProfilePolicy;
  missingProfilePolicy: MissingProfilePolicy;
  pasteProfilePolicy: PasteProfilePolicy;
  /** Default rendering intent for profile conversions (Color Settings ▸ Intent). */
  intent: RenderingIntentId;
  /** Conversion Options ▸ Use Black Point Compensation: the default every
   *  profile conversion starts from (Convert to Profile pre-fills it). */
  blackPointCompensation: boolean;
  /** Working Spaces. RGB stays on the document (`assignProfile`); these three
   *  are app-level because no document mode carries them yet. */
  workingCmyk: CmykProfileId;
  workingGray: GrayProfileId;
  workingSpot: SpotProfileId;
  /** Advanced ▸ Desaturate Monitor Colors By (display-only saturation pullback
   *  used to visualize out-of-gamut relationships). */
  desaturateMonitorColors: boolean;
  /** Percent, 0..100. */
  desaturateMonitorAmount: number;
  /** Advanced ▸ Blend RGB Colors Using Gamma. */
  blendRgbColorsUsingGamma: boolean;
  blendRgbGamma: number;
  /** Advanced ▸ Blend Text Colors Using Gamma: type layers composite in
   *  this gamma. Photoshop ships it on at 1.45; off here, so documents keep
   *  compositing as before until it is asked for. */
  blendTextColorsUsingGamma: boolean;
  blendTextGamma: number;
}

export interface EmbeddedRgbProfile {
  profile: RgbProfileId;
  name: string;
  source: EmbeddedProfileSource;
  iccProfileBytes?: Uint8Array;
}

export const DEFAULT_COLOR_POLICY_PREFS: ColorPolicyPrefs = {
  embeddedProfilePolicy: "ask",
  missingProfilePolicy: "assign-working",
  pasteProfilePolicy: "ask",
  intent: 1, // Relative Colorimetric — Photoshop's default
  blackPointCompensation: true, // Photoshop's default
  workingCmyk: 0, // U.S. Web Coated (SWOP) v2
  workingGray: 0, // Dot Gain 20%
  workingSpot: 0, // Dot Gain 20%
  desaturateMonitorColors: false,
  desaturateMonitorAmount: 20,
  blendRgbColorsUsingGamma: false,
  blendRgbGamma: 1,
  blendTextColorsUsingGamma: false,
  blendTextGamma: 1.45,
};

export const BLEND_GAMMA_MIN = 1;
export const BLEND_GAMMA_MAX = 3;

/** The press numbers behind the chosen Working CMYK. Callers that separate
 *  (soft proof, CMYK writer) should read dot gain / ink limit from here rather
 *  than each carrying a private press constant. */
export function cmykWorkingSpace(id: number): CmykWorkingSpace {
  return CMYK_PROFILES.find((p) => p.id === id) ?? CMYK_PROFILES[0];
}

export function colorModeName(id: number): string {
  return COLOR_MODES.find((m) => m.id === id)?.label ?? COLOR_MODES[0].label;
}

export function profileName(id: number): string {
  return RGB_PROFILES.find((p) => p.id === id)?.label ?? RGB_PROFILES[0].label;
}

export function normalizeCustomProfileName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const cleaned = name.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

/** `modeProfileName` names the CMYK / Gray / Lab profile a non-RGB document
 *  was converted into (Edit ▸ Convert to Profile). */
export function documentProfileName(id: number, assigned = true, customName?: string | null, colorMode = 0, modeProfileName?: string | null): string {
  if (colorMode !== 0) return normalizeCustomProfileName(modeProfileName) ?? "No mode-specific profile";
  return assigned ? (normalizeCustomProfileName(customName) ?? profileName(id)) : "Untagged RGB";
}

export function pasteProfileName(info: PasteProfileInfo): string {
  return documentProfileName(info.profile, info.assigned ?? true, info.customName);
}

export function clampProfile(id: number): RgbProfileId {
  return (RGB_PROFILES.some((p) => p.id === id) ? id : 0) as RgbProfileId;
}

export function normalizeColorPolicyPrefs(input: unknown, base: ColorPolicyPrefs = DEFAULT_COLOR_POLICY_PREFS): ColorPolicyPrefs {
  const raw = typeof input === "object" && input ? input as Partial<ColorPolicyPrefs> : {};
  const embeddedProfilePolicy = EMBEDDED_PROFILE_POLICIES.some((p) => p.id === raw.embeddedProfilePolicy)
    ? raw.embeddedProfilePolicy as EmbeddedProfilePolicy
    : base.embeddedProfilePolicy;
  const missingProfilePolicy = MISSING_PROFILE_POLICIES.some((p) => p.id === raw.missingProfilePolicy)
    ? raw.missingProfilePolicy as MissingProfilePolicy
    : base.missingProfilePolicy;
  const pasteProfilePolicy = PASTE_PROFILE_POLICIES.some((p) => p.id === raw.pasteProfilePolicy)
    ? raw.pasteProfilePolicy as PasteProfilePolicy
    : base.pasteProfilePolicy;
  const intent = RENDERING_INTENTS.some((i) => i.id === raw.intent)
    ? raw.intent as RenderingIntentId
    : base.intent;
  return {
    embeddedProfilePolicy,
    missingProfilePolicy,
    pasteProfilePolicy,
    intent,
    blackPointCompensation: pickBool(raw.blackPointCompensation, base.blackPointCompensation),
    workingCmyk: pickId(CMYK_PROFILES, raw.workingCmyk, base.workingCmyk),
    workingGray: pickId(GRAY_PROFILES, raw.workingGray, base.workingGray),
    workingSpot: pickId(SPOT_PROFILES, raw.workingSpot, base.workingSpot),
    desaturateMonitorColors: pickBool(raw.desaturateMonitorColors, base.desaturateMonitorColors),
    desaturateMonitorAmount: pickNumber(raw.desaturateMonitorAmount, 0, 100, base.desaturateMonitorAmount),
    blendRgbColorsUsingGamma: pickBool(raw.blendRgbColorsUsingGamma, base.blendRgbColorsUsingGamma),
    blendRgbGamma: pickNumber(raw.blendRgbGamma, BLEND_GAMMA_MIN, BLEND_GAMMA_MAX, base.blendRgbGamma),
    blendTextColorsUsingGamma: pickBool(raw.blendTextColorsUsingGamma, base.blendTextColorsUsingGamma),
    blendTextGamma: pickNumber(raw.blendTextGamma, BLEND_GAMMA_MIN, BLEND_GAMMA_MAX, base.blendTextGamma),
  };
}

function pickId<T extends number>(list: readonly { id: number }[], value: unknown, fallback: T): T {
  return list.some((e) => e.id === value) ? value as T : fallback;
}

function pickBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pickNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** A named Color Settings preset (Photoshop's Settings popup). Working RGB is
 *  part of the preset even though it lives on the document, so applying one
 *  reproduces the whole configuration. */
export interface ColorSettingsPreset {
  id: string;
  label: string;
  workingRgb: RgbProfileId;
  prefs: ColorPolicyPrefs;
}

function preset(id: string, label: string, workingRgb: RgbProfileId, over: Partial<ColorPolicyPrefs>): ColorSettingsPreset {
  return { id, label, workingRgb, prefs: { ...DEFAULT_COLOR_POLICY_PREFS, ...over } };
}

export const COLOR_SETTINGS_PRESETS: readonly ColorSettingsPreset[] = [
  preset("na-general", "North America General Purpose 2", 0, {
    embeddedProfilePolicy: "preserve", missingProfilePolicy: "leave-untagged", pasteProfilePolicy: "convert",
  }),
  preset("na-prepress", "North America Prepress 2", 2, {
    embeddedProfilePolicy: "ask", missingProfilePolicy: "ask", pasteProfilePolicy: "ask",
  }),
  preset("na-web", "North America Web/Internet", 0, {
    embeddedProfilePolicy: "convert", missingProfilePolicy: "assign-working", pasteProfilePolicy: "convert",
    workingGray: 2, // Gray Gamma 2.2 — the web transfer curve
  }),
  preset("europe-prepress", "Europe Prepress 3", 2, {
    embeddedProfilePolicy: "ask", missingProfilePolicy: "ask", pasteProfilePolicy: "ask",
    workingCmyk: 2, workingGray: 1, workingSpot: 1, // Coated FOGRA39 + Dot Gain 15%
  }),
  preset("japan-prepress", "Japan Prepress 2", 2, {
    embeddedProfilePolicy: "ask", missingProfilePolicy: "ask", pasteProfilePolicy: "ask",
    workingCmyk: 3, workingGray: 1, workingSpot: 1, // Japan Color 2001 Coated + Dot Gain 15%
  }),
  preset("monitor-color", "Monitor Color", 0, {
    embeddedProfilePolicy: "discard", missingProfilePolicy: "leave-untagged", pasteProfilePolicy: "preserve-numbers",
    workingGray: 2,
  }),
];

export function colorSettingsPreset(id: string): ColorSettingsPreset | null {
  return COLOR_SETTINGS_PRESETS.find((p) => p.id === id) ?? null;
}

/** Preset whose configuration the current values reproduce exactly, else null
 *  ("Custom" in the UI) — every field is a primitive, so a key-wise compare is
 *  the whole story. */
export function matchColorSettingsPreset(workingRgb: number, prefs: ColorPolicyPrefs): ColorSettingsPreset | null {
  const keys = Object.keys(DEFAULT_COLOR_POLICY_PREFS) as (keyof ColorPolicyPrefs)[];
  return COLOR_SETTINGS_PRESETS.find(
    (p) => p.workingRgb === clampProfile(workingRgb) && keys.every((k) => p.prefs[k] === prefs[k]),
  ) ?? null;
}

/** Convert to Profile ▸ Conversion Options — what the dialog remembers
 *  between uses. Intent and BPC start from Color Settings; Use Dither is off
 *  by default (Photoshop's default). */
export interface ConvertProfileOptions {
  engine: ColorEngineId;
  intent: RenderingIntentId;
  blackPointCompensation: boolean;
  dither: boolean;
}

export function normalizeConvertProfileOptions(
  input: unknown,
  intent: RenderingIntentId = DEFAULT_COLOR_POLICY_PREFS.intent,
  blackPointCompensation = DEFAULT_COLOR_POLICY_PREFS.blackPointCompensation,
): ConvertProfileOptions {
  const raw = typeof input === "object" && input ? input as Partial<ConvertProfileOptions> : {};
  return {
    engine: COLOR_ENGINES.some((e) => e.id === raw.engine) ? raw.engine as ColorEngineId : COLOR_ENGINES[0].id,
    intent: pickId(RENDERING_INTENTS, raw.intent, intent),
    blackPointCompensation: pickBool(raw.blackPointCompensation, blackPointCompensation),
    dither: pickBool(raw.dither, false),
  };
}

/** Saved Color Settings (Save…/Load… in the dialog).
 *  ponytail: uses the .csf extension but NOT Adobe's binary .csf layout — only
 *  Vision reads these; a real .csf parser is the upgrade path if interop with
 *  Photoshop is ever asked for. Mirrors the .psf proof-setup file. */
export interface ColorSettingsFile {
  workingRgb: RgbProfileId;
  prefs: ColorPolicyPrefs;
}

export function serializeColorSettings(file: ColorSettingsFile): string {
  return JSON.stringify({ monetColorSettings: 1, workingRgb: file.workingRgb, prefs: file.prefs }, null, 2);
}

/** Parses a saved settings file. Returns null for anything that isn't ours —
 *  a stray .csf must not silently reset the user's colour configuration. */
export function parseColorSettings(text: string, base: ColorPolicyPrefs = DEFAULT_COLOR_POLICY_PREFS): ColorSettingsFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || !raw) return null;
  const doc = raw as { monetColorSettings?: unknown; workingRgb?: unknown; prefs?: unknown };
  if (doc.monetColorSettings !== 1) return null;
  return {
    workingRgb: clampProfile(typeof doc.workingRgb === "number" ? doc.workingRgb : 0),
    prefs: normalizeColorPolicyPrefs(doc.prefs, base),
  };
}

/** `targetName`/`currentName` carry an imported ICC profile's own name, so the
 *  warning names the real destination instead of the built-in it clamps to (two
 *  custom profiles both fall back to id 0). Compared by name: with no custom
 *  profiles that is exactly the old `from === to` check. */
export function profilePolicyWarning(
  current: number,
  target: number,
  action: ProfilePolicyAction,
  targetName?: string | null,
  currentName?: string | null,
): string | null {
  const from = clampProfile(current);
  const to = clampProfile(target);
  const fromName = normalizeCustomProfileName(currentName) ?? profileName(from);
  const toName = normalizeCustomProfileName(targetName) ?? profileName(to);
  if (fromName === toName) return null;
  if (action === "convert") {
    return `Profile mismatch: converting ${fromName} to ${toName} will change layer RGB values to preserve appearance in the destination profile.`;
  }
  if (action === "working") {
    return `Working RGB mismatch: choosing ${toName} assigns this document from ${fromName} without converting pixels. Use Convert to Profile when appearance should be preserved.`;
  }
  return `Profile mismatch: assigning ${toName} reinterprets existing ${fromName} RGB numbers without changing pixel values, so appearance may shift.`;
}

export function profileFromEmbeddedName(name: string): RgbProfileId | null {
  const normalized = name.toLowerCase().replace(/[\0_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.includes("rec.2020") || normalized.includes("rec 2020") || normalized.includes("bt.2020") || normalized.includes("bt 2020")) return 3;
  if (normalized.includes("adobe rgb")) return 2;
  if (normalized.includes("display p3") || normalized.includes("p3 d65")) return 1;
  if (normalized.includes("srgb") || normalized.includes("iec61966")) return 0;
  return null;
}

/** An embedded profile's own name when it is custom (matches no built-in).
 *  A custom profile clamps to sRGB by id, so it is never the working built-in:
 *  the mismatch is real even under an sRGB working space (Photoshop asks about
 *  a ProPhoto file opened into sRGB) and the prompt names the real profile. */
function customEmbeddedName(name?: string | null): string | null {
  const custom = normalizeCustomProfileName(name);
  return custom != null && profileFromEmbeddedName(custom) == null ? custom : null;
}

export function embeddedProfileOpenWarning(current: number, embedded: number, name: string, embeddedName?: string | null): string | null {
  const working = clampProfile(current);
  const source = clampProfile(embedded);
  const custom = customEmbeddedName(embeddedName);
  if (working === source && !custom) return null;
  return `Embedded profile mismatch: “${name}” contains ${custom ?? profileName(source)}, while the current working RGB is ${profileName(working)}.`;
}

export function embeddedProfilePolicyDecision(current: number, embedded: number, policy: EmbeddedProfilePolicy, embeddedName?: string | null): EmbeddedProfileDecision {
  const working = clampProfile(current);
  const source = clampProfile(embedded);
  if (working === source && !customEmbeddedName(embeddedName)) return "preserve";
  return policy === "ask" ? "ask" : policy;
}

export function missingProfileOpenWarning(current: number, name: string): string | null {
  const working = clampProfile(current);
  if (working === 0) return null;
  return `Missing profile: “${name}” has no recognized embedded RGB profile. Assign the current working RGB (${profileName(working)}), treat the file as ${profileName(0)}, or leave it untagged.`;
}

export function missingProfilePolicyDecision(current: number, policy: MissingProfilePolicy): MissingProfileDecision {
  const working = clampProfile(current);
  if (working === 0 && policy !== "leave-untagged") return "assign-working";
  return policy === "ask" ? "ask" : policy;
}

export function pasteProfileWarning(target: number, source: number): string | null {
  const dst = clampProfile(target);
  const src = clampProfile(source);
  if (dst === src) return null;
  return `Pasted profile mismatch: clipboard pixels were copied from ${profileName(src)}, while this document is ${profileName(dst)}.`;
}

export function pasteProfilePolicyDecision(target: number, source: number, policy: PasteProfilePolicy): PasteProfileDecision {
  const dst = clampProfile(target);
  const src = clampProfile(source);
  if (dst === src) return "preserve-numbers";
  return policy === "ask" ? "ask" : policy;
}

export function pasteProfileInfoMatches(target: PasteProfileInfo, source: PasteProfileInfo): boolean {
  const dst = clampProfile(target.profile);
  const src = clampProfile(source.profile);
  if ((target.assigned ?? true) !== (source.assigned ?? true)) return false;
  if (target.customProfile || source.customProfile) {
    const targetKey = target.customKey ?? null;
    const sourceKey = source.customKey ?? null;
    return !!target.customProfile
      && !!source.customProfile
      && dst === src
      && normalizeCustomProfileName(target.customName) === normalizeCustomProfileName(source.customName)
      && ((!targetKey && !sourceKey) || targetKey === sourceKey);
  }
  return dst === src;
}

export function canConvertPasteProfile(target: PasteProfileInfo, source: PasteProfileInfo): boolean {
  return (target.assigned ?? true)
    && (source.assigned ?? true);
}

export function pasteProfilePolicyDecisionForInfo(target: PasteProfileInfo, source: PasteProfileInfo, policy: PasteProfilePolicy): PasteProfileDecision {
  if (pasteProfileInfoMatches(target, source)) return "preserve-numbers";
  if (!canConvertPasteProfile(target, source)) return policy === "ask" ? "ask" : "preserve-numbers";
  return policy === "ask" ? "ask" : policy;
}

export function pasteProfileWarningForInfo(target: PasteProfileInfo, source: PasteProfileInfo): string | null {
  if (pasteProfileInfoMatches(target, source)) return null;
  const base = `Pasted profile mismatch: clipboard pixels were copied from ${pasteProfileName(source)}, while this document is ${pasteProfileName(target)}.`;
  return canConvertPasteProfile(target, source)
    ? base
    : `${base} Both source and destination need assigned profiles for conversion, so pasted RGB numbers will be preserved.`;
}

/** A user-supplied ICC profile that passed validation: its bytes trimmed to the
 *  declared size, its `desc`/`mluc` display name, its header device colour space
 *  (raw 4-char tag) and the nearest built-in id so untagged call sites still get
 *  a sane RGB fallback. */
export interface IccProfileInfo {
  bytes: Uint8Array;
  name: string;
  /** Raw header data colour space tag — "RGB ", "CMYK", "GRAY", "Lab ". */
  colorSpace: string;
  profile: RgbProfileId;
}

export const ICC_MIN_BYTES = 132;
/** Mirrors the engine's MAX_ICC_PROFILE_BYTES trust-boundary cap. */
export const ICC_MAX_BYTES = 10 * 1024 * 1024;

/** The device data Convert to Profile can separate into, as raw header tags. */
export const CONVERT_ICC_SPACES = ["RGB ", "CMYK", "GRAY", "Lab "] as const;

const ICC_SPACE_NAMES: Record<string, string> = { "RGB ": "RGB", CMYK: "CMYK", GRAY: "Gray", "Lab ": "Lab" };
const ICC_SPACE_MODES: Record<string, ColorModeId> = { "RGB ": 0, GRAY: 1, CMYK: 2, "Lab ": 3 };
// Header classes with no device side to convert into. Anything else — the four
// device/colour-space classes, or a class this reader does not know — is left
// for the engine to judge, so an unknown class never blocks an embedded tag.
const ICC_UNUSABLE_CLASSES: Record<string, string> = { link: "device link", abst: "abstract", nmcl: "named colour" };

/** The document mode a profile's device data converts into: RGB 0, Gray 1,
 *  CMYK 2, Lab 3 — null for anything Vision has no mode for. */
export function iccColorMode(colorSpace: string): ColorModeId | null {
  return ICC_SPACE_MODES[colorSpace] ?? null;
}

/**
 * Validate an untrusted ICC profile and read its header. Same trust-boundary
 * checks as the engine's `profile()` (raster/icc.rs), so a bad file is refused
 * here with a readable message instead of escaping as a wasm throw.
 * `allowed` is the set of device colour spaces the caller can actually use:
 * assign is RGB-only, soft proof also takes CMYK, and Convert to Profile takes
 * every space it can change the document mode to (`CONVERT_ICC_SPACES`).
 * Throws with a reportable message; never returns a half-checked profile.
 */
export function parseIccProfile(
  bytes: Uint8Array,
  label: string,
  allowed: readonly string[] = ["RGB "],
): IccProfileInfo {
  if (bytes.length < ICC_MIN_BYTES || bytes.length >= ICC_MAX_BYTES) {
    throw new Error(`“${label}” is not a usable ICC profile (must be between 132 bytes and 10 MB).`);
  }
  if (ascii(bytes, 36, 40) !== "acsp") {
    throw new Error(`“${label}” is not an ICC profile (bad header signature).`);
  }
  const declared = readU32(bytes, 0);
  if (declared < ICC_MIN_BYTES || declared > bytes.length) {
    throw new Error(`“${label}” declares a profile size that does not match the file.`);
  }
  const colorSpace = ascii(bytes, 16, 20);
  if (!allowed.includes(colorSpace)) {
    const names = allowed.map((s) => ICC_SPACE_NAMES[s] ?? s.trim());
    const wanted = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0];
    throw new Error(`“${label}” is a ${ICC_SPACE_NAMES[colorSpace] ?? (colorSpace.trim() || "unknown")} profile; an ${wanted} device profile is required.`);
  }
  // An abstract profile is how a Lab destination is usually written (an
  // identity Lab space); over anything else it, like a link, has no device side.
  const deviceClass = ascii(bytes, 12, 16);
  const unusable = ICC_UNUSABLE_CLASSES[deviceClass];
  if (unusable && !(deviceClass === "abst" && colorSpace === "Lab ")) {
    throw new Error(`“${label}” is a ${unusable} profile; choose an input, display, output or color space profile instead.`);
  }
  // A Lab destination is CIE Lab: Generic Lab and lcms' Lab profiles carry
  // identity tables. Tone and lightness effects (Sepia Tone, Lightness
  // Increase…) are Lab profiles too, but they change colours.
  if (colorSpace === "Lab " && labTablesAreIdentity(bytes, declared) === false) {
    throw new Error(`“${label}” is a Lab effect profile: its tables change colours instead of describing a colour space. Choose a plain Lab, CMYK, Gray or RGB profile.`);
  }
  const name = normalizeCustomProfileName(iccDescriptionFromPayload(bytes, 0, declared))
    ?? normalizeCustomProfileName(label)
    ?? "Custom ICC Profile";
  return { bytes: bytes.slice(0, declared), name, colorSpace, profile: profileFromEmbeddedName(name) ?? 0 };
}

/** Whether a Lab profile's A2B0 maps Lab onto itself (within 1%, which 8-bit
 *  and v2-encoded identity tables stay inside). Evaluates the 8/16-bit
 *  `mft1`/`mft2` tables every system Lab profile uses; null for any other
 *  table type, which the engine then judges. No A2B0 is nothing to apply. */
function labTablesAreIdentity(bytes: Uint8Array, end: number): boolean | null {
  const tag = findIccTag(bytes, end, "A2B0");
  if (!tag) return true;
  const type = ascii(bytes, tag.start, tag.start + 4);
  const wide = type === "mft2";
  if (!wide && type !== "mft1") return null;
  const grid = bytes[tag.start + 10] ?? 0;
  if (bytes[tag.start + 8] !== 3 || bytes[tag.start + 9] !== 3 || grid < 2) return false;
  const size = wide ? 2 : 1;
  const inN = wide ? readU16(bytes, tag.start + 48) : 256;
  const outN = wide ? readU16(bytes, tag.start + 50) : 256;
  const inAt = tag.start + (wide ? 52 : 48);
  const clutAt = inAt + 3 * inN * size;
  const outAt = clutAt + grid ** 3 * 3 * size;
  if (inN < 2 || outN < 2 || outAt + 3 * outN * size > tag.end) return false;
  const at = (p: number) => (wide ? readU16(bytes, p) / 65535 : bytes[p] / 255);
  const curve = (base: number, n: number, ch: number, x: number) => {
    const f = x * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    const p = base + (ch * n + i) * size;
    return at(p) + (at(p + size) - at(p)) * (f - i);
  };
  const g = grid - 1;
  const clut = (u: number[], ch: number) => {
    const i = u.map((v) => Math.min(g - 1, Math.floor(v * g)));
    const t = u.map((v, k) => v * g - i[k]);
    let sum = 0;
    for (let corner = 0; corner < 8; corner++) {
      const b = [corner >> 2 & 1, corner >> 1 & 1, corner & 1];
      const w = b.reduce((acc, bit, k) => acc * (bit ? t[k] : 1 - t[k]), 1);
      const node = ((i[0] + b[0]) * grid + i[1] + b[1]) * grid + i[2] + b[2];
      sum += w * at(clutAt + (node * 3 + ch) * size);
    }
    return sum;
  };
  const steps = [0, 0.25, 0.502, 0.75, 1];
  for (const l of steps) for (const a of steps) for (const b of [0, 0.502, 1]) {
    const x = [l, a, b];
    const u = x.map((v, ch) => curve(inAt, inN, ch, v));
    for (let ch = 0; ch < 3; ch++) {
      if (Math.abs(curve(outAt, outN, ch, clut(u, ch)) - x[ch]) > 0.01) return false;
    }
  }
  return true;
}

function findIccTag(bytes: Uint8Array, end: number, signature: string): { start: number; end: number } | null {
  const count = readU32(bytes, 128);
  for (let i = 0, pos = 132; i < count && pos + 12 <= end; i++, pos += 12) {
    if (ascii(bytes, pos, pos + 4) !== signature) continue;
    const start = readU32(bytes, pos + 4);
    const tagEnd = start + readU32(bytes, pos + 8);
    return start >= 128 && tagEnd <= end ? { start, end: tagEnd } : null;
  }
  return null;
}

export function detectEmbeddedRgbProfile(bytes: Uint8Array): EmbeddedRgbProfile | null {
  return detectPngProfile(bytes) ?? detectJpegProfile(bytes) ?? detectPsdProfile(bytes) ?? detectTiffProfile(bytes)
    ?? detectWebpProfile(bytes) ?? detectHeifProfile(bytes);
}

/** An ICC payload lifted out of a container. A built-in match keeps the id-only
 *  contract (the engine tags its own copy on export, and paste matching stays
 *  by id); anything else carries the file's exact bytes and its own `desc`
 *  name, so the document is tagged with what the file had. Rejects what the
 *  engine would reject (parseIccProfile's trust boundary: header, size, RGB
 *  device class), so a CMYK or truncated profile reads as untagged. */
function embeddedFromIccBytes(payload: Uint8Array, source: EmbeddedProfileSource): EmbeddedRgbProfile | null {
  let info: IccProfileInfo;
  try {
    info = parseIccProfile(payload, "Embedded ICC Profile");
  } catch {
    return null;
  }
  const builtIn = profileFromEmbeddedName(info.name);
  return builtIn != null
    ? { profile: builtIn, name: profileName(builtIn), source }
    : { profile: 0, name: info.name, source, iccProfileBytes: info.bytes };
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function detectPngProfile(bytes: Uint8Array): EmbeddedRgbProfile | null {
  if (bytes.length < 12 || !PNG_SIG.every((b, i) => bytes[i] === b)) return null;
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const length = readU32(bytes, pos);
    const type = ascii(bytes, pos + 4, pos + 8);
    const dataStart = pos + 8;
    const dataEnd = dataStart + length;
    if (length < 0 || dataEnd + 4 > bytes.length) return null;
    if (type === "cICP" && length >= 4) {
      const profile = profileFromCicp(bytes[dataStart], bytes[dataStart + 1]);
      if (profile != null) return { profile, name: profileName(profile), source: "png-cicp" };
    } else if (type === "iCCP") {
      const zero = findByte(bytes, 0, dataStart, dataEnd);
      if (zero > dataStart) {
        // name\0, compression method (0 = zlib), then the deflated profile.
        const inflated = bytes[zero + 1] === 0 ? inflateZlib(bytes.subarray(zero + 2, dataEnd)) : null;
        const embedded = inflated && embeddedFromIccBytes(inflated, "png-iccp");
        if (embedded) return embedded;
        const rawName = ascii(bytes, dataStart, zero);
        const profile = profileFromEmbeddedName(rawName);
        if (profile != null) return { profile, name: rawName, source: "png-iccp" };
      }
    } else if (type === "sRGB") {
      return { profile: 0, name: profileName(0), source: "png-srgb" };
    }
    pos = dataEnd + 4;
  }
  return null;
}

function profileFromCicp(primaries: number, transfer: number): RgbProfileId | null {
  if (primaries === 9) return 3; // BT.2020 / Rec.2020
  if (primaries === 12) return 1; // Display P3
  if (primaries === 1 && (transfer === 13 || transfer === 1)) return 0; // sRGB/BT.709-family
  return null;
}

function detectJpegProfile(bytes: Uint8Array): EmbeddedRgbProfile | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  // APP2 "ICC_PROFILE\0" + 1-based segment index + segment count + data: a
  // profile over 64 KB spans several segments, reassembled by index (files
  // need not write them in order).
  const segments = new Map<number, Uint8Array>();
  let segmentCount = 0;
  let firstText: string | null = null;
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) break;
    while (bytes[pos] === 0xff) pos++;
    const marker = bytes[pos++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (pos + 2 > bytes.length) break;
    const length = readU16(bytes, pos);
    const dataStart = pos + 2;
    const dataEnd = pos + length;
    if (length < 2 || dataEnd > bytes.length) break;
    if (marker === 0xe2 && startsWithAscii(bytes, dataStart, dataEnd, "ICC_PROFILE\0") && dataStart + 14 <= dataEnd) {
      firstText ??= looseAscii(bytes, dataStart, dataEnd);
      segmentCount ||= bytes[dataStart + 13] ?? 0;
      segments.set(bytes[dataStart + 12] ?? 0, bytes.subarray(dataStart + 14, dataEnd));
    }
    pos = dataEnd;
  }
  if (segmentCount > 0 && segments.size === segmentCount) {
    const parts = Array.from({ length: segmentCount }, (_, i) => segments.get(i + 1));
    if (parts.every((p) => p)) {
      const payload = new Uint8Array(parts.reduce((n, p) => n + (p as Uint8Array).length, 0));
      let offset = 0;
      for (const part of parts as Uint8Array[]) { payload.set(part, offset); offset += part.length; }
      const embedded = embeddedFromIccBytes(payload, "jpeg-icc");
      if (embedded) return embedded;
    }
  }
  const profile = firstText ? profileFromEmbeddedName(firstText) : null;
  return profile != null ? { profile, name: profileName(profile), source: "jpeg-icc" } : null;
}

function detectPsdProfile(bytes: Uint8Array): EmbeddedRgbProfile | null {
  if (bytes.length < 34 || !startsWithAscii(bytes, 0, bytes.length, "8BPS")) return null;
  const version = readU16(bytes, 4);
  if (version !== 1 && version !== 2) return null;

  const colorModeLength = readU32(bytes, 26);
  const resourceLengthOffset = 30 + colorModeLength;
  if (resourceLengthOffset + 4 > bytes.length) return null;
  const resourceLength = readU32(bytes, resourceLengthOffset);
  let pos = resourceLengthOffset + 4;
  const resourceEnd = pos + resourceLength;
  if (resourceEnd > bytes.length) return null;

  while (pos + 12 <= resourceEnd) {
    const signature = ascii(bytes, pos, pos + 4);
    const resourceId = readU16(bytes, pos + 4);
    pos += 6;

    if (pos >= resourceEnd) return null;
    const nameLength = bytes[pos] ?? 0;
    pos += 1;
    const nameEnd = pos + nameLength;
    if (nameEnd > resourceEnd) return null;
    pos = nameEnd;
    if ((1 + nameLength) % 2 !== 0) pos += 1;

    if (pos + 4 > resourceEnd) return null;
    const dataLength = readU32(bytes, pos);
    const dataStart = pos + 4;
    const dataEnd = dataStart + dataLength;
    if (dataEnd > resourceEnd) return null;

    if ((signature === "8BIM" || signature === "8B64") && resourceId === 1039) {
      const profile = profileFromIccPayload(bytes, dataStart, dataEnd);
      return {
        profile: profile ?? 0,
        name: profile != null ? profileName(profile) : (iccDescriptionFromPayload(bytes, dataStart, dataEnd) ?? "Embedded ICC Profile"),
        source: "psd-icc",
        iccProfileBytes: bytes.slice(dataStart, dataEnd),
      };
    }
    pos = dataEnd + (dataLength % 2);
  }

  return null;
}

/** TIFF tag 34675 (InterColorProfile) in IFD0 — what Vision's own TIFF export
 *  writes. ponytail: classic TIFF only (magic 42); BigTIFF's 8-byte offsets
 *  need a second reader if a BigTIFF with a profile ever turns up. */
function detectTiffProfile(bytes: Uint8Array): EmbeddedRgbProfile | null {
  if (bytes.length < 8) return null;
  const le = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!le && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) return null;
  const u16 = (p: number) => (le ? (bytes[p] ?? 0) | ((bytes[p + 1] ?? 0) << 8) : readU16(bytes, p));
  const u32 = (p: number) => (le ? ((bytes[p] ?? 0) | ((bytes[p + 1] ?? 0) << 8) | ((bytes[p + 2] ?? 0) << 16)) + (bytes[p + 3] ?? 0) * 0x1000000 : readU32(bytes, p));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > bytes.length) return null;
  const entries = u16(ifd);
  for (let i = 0, pos = ifd + 2; i < entries && pos + 12 <= bytes.length; i++, pos += 12) {
    if (u16(pos) !== 34675) continue;
    const type = u16(pos + 2);
    const count = u32(pos + 4);
    const start = u32(pos + 8);
    if ((type !== 7 && type !== 1) || count <= 4 || start + count > bytes.length) return null;
    return embeddedFromIccBytes(bytes.subarray(start, start + count), "tiff-icc");
  }
  return null;
}

/** WebP `ICCP` chunk (RIFF/WEBP; the extended VP8X layout is the only one
 *  that can carry a profile). Chunks are scanned by fourcc rather than gated on
 *  the VP8X ICC flag, so a writer that set the chunk but not the flag still
 *  reads as tagged (#464). */
function detectWebpProfile(bytes: Uint8Array): EmbeddedRgbProfile | null {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WEBP") return null;
  const end = readU32le(bytes, 4) + 8;
  if (end < 12 || end > bytes.length) return null;
  for (let pos = 12; pos + 8 <= end;) {
    const size = readU32le(bytes, pos + 4);
    const dataStart = pos + 8;
    if (dataStart + size + (size & 1) > end) return null;
    if (ascii(bytes, pos, pos + 4) === "ICCP") return embeddedFromIccBytes(bytes.subarray(dataStart, dataStart + size), "webp-icc");
    pos = dataStart + size + (size & 1); // chunks are padded to even sizes
  }
  return null;
}

/** AVIF / HEIC (ISOBMFF): the `colr` property carrying an ICC payload
 *  (`prof` or `rICC`) under meta ▸ iprp ▸ ipco — the one shape both brands
 *  share. ponytail: the first ICC `colr` wins; `ipma` (which item each
 *  property belongs to) is not consulted, so a multi-item file whose primary
 *  item uses a LATER colr property needs ipma walked. */
function detectHeifProfile(bytes: Uint8Array): EmbeddedRgbProfile | null {
  if (bytes.length < 12 || ascii(bytes, 4, 8) !== "ftyp") return null;
  const meta = isoBox(bytes, 0, bytes.length, "meta");
  const iprp = meta && isoBox(bytes, meta.start + 4, meta.end, "iprp"); // meta is a FullBox: version + flags first
  const ipco = iprp && isoBox(bytes, iprp.start, iprp.end, "ipco");
  if (!ipco) return null;
  for (const box of isoBoxes(bytes, ipco.start, ipco.end)) {
    if (box.type !== "colr") continue;
    const kind = ascii(bytes, box.start, box.start + 4);
    if (kind === "prof" || kind === "rICC") return embeddedFromIccBytes(bytes.subarray(box.start + 4, box.end), "heif-icc");
  }
  return null;
}

interface IsoBox { type: string; start: number; end: number }

/** The boxes laid end to end in `[pos, end)`; `start` is each payload. A box
 *  that overruns its parent ends the walk (no half-read box is returned). */
function isoBoxes(bytes: Uint8Array, pos: number, end: number): IsoBox[] {
  const out: IsoBox[] = [];
  while (pos + 8 <= end) {
    let size = readU32(bytes, pos);
    let start = pos + 8;
    if (size === 1) { // 64-bit largesize; anything past 4 GB cannot be in memory anyway
      if (pos + 16 > end || readU32(bytes, pos + 8) !== 0) break;
      size = readU32(bytes, pos + 12);
      start = pos + 16;
    } else if (size === 0) size = end - pos; // "to end of file"
    if (size < start - pos || pos + size > end) break;
    out.push({ type: ascii(bytes, pos + 4, pos + 8), start, end: pos + size });
    pos += size;
  }
  return out;
}

function isoBox(bytes: Uint8Array, pos: number, end: number, type: string): IsoBox | undefined {
  return isoBoxes(bytes, pos, end).find((b) => b.type === type);
}

function profileFromIccPayload(bytes: Uint8Array, start: number, end: number): RgbProfileId | null {
  return profileFromEmbeddedName(looseAscii(bytes, start, end))
    ?? profileFromEmbeddedName(looseUtf16be(bytes, start, end))
    ?? profileFromIccTagText(bytes, start, end);
}

function profileFromIccTagText(bytes: Uint8Array, start: number, end: number): RgbProfileId | null {
  if (end - start < 132 || !startsWithAscii(bytes, start + 36, end, "acsp")) return null;
  const tagCount = readU32(bytes, start + 128);
  let pos = start + 132;
  for (let i = 0; i < tagCount && pos + 12 <= end; i++, pos += 12) {
    const signature = ascii(bytes, pos, pos + 4);
    const offset = readU32(bytes, pos + 4);
    const length = readU32(bytes, pos + 8);
    const tagStart = start + offset;
    const tagEnd = tagStart + length;
    if (offset < 128 || length <= 0 || tagStart < start || tagEnd > end) continue;

    const profile = profileFromEmbeddedName(looseAscii(bytes, tagStart, tagEnd))
      ?? profileFromEmbeddedName(looseUtf16be(bytes, tagStart, tagEnd));
    if (profile != null) return profile;

    if (signature === "desc") {
      const descProfile = profileFromDescriptionTag(bytes, tagStart, tagEnd)
        ?? profileFromMlucTag(bytes, tagStart, tagEnd);
      if (descProfile != null) return descProfile;
    }
  }
  return null;
}

function profileFromDescriptionTag(bytes: Uint8Array, start: number, end: number): RgbProfileId | null {
  const text = descriptionTagText(bytes, start, end);
  return text ? profileFromEmbeddedName(text) : null;
}

function descriptionTagText(bytes: Uint8Array, start: number, end: number): string | null {
  if (end - start < 12 || ascii(bytes, start, start + 4) !== "desc") return null;
  const length = readU32(bytes, start + 8);
  if (length <= 1) return null;
  const textStart = start + 12;
  const textEnd = Math.min(end, textStart + length - 1);
  return ascii(bytes, textStart, textEnd).trim() || null;
}

function profileFromMlucTag(bytes: Uint8Array, start: number, end: number): RgbProfileId | null {
  const text = mlucTagText(bytes, start, end);
  return text ? profileFromEmbeddedName(text) : null;
}

function mlucTagText(bytes: Uint8Array, start: number, end: number): string | null {
  if (end - start < 16 || ascii(bytes, start, start + 4) !== "mluc") return null;
  const count = readU32(bytes, start + 8);
  const recordSize = readU32(bytes, start + 12);
  if (recordSize < 12) return null;
  let pos = start + 16;
  for (let i = 0; i < count && pos + recordSize <= end; i++, pos += recordSize) {
    const length = readU32(bytes, pos + 4);
    const offset = readU32(bytes, pos + 8);
    const textStart = start + offset;
    const textEnd = textStart + length;
    if (length <= 0 || textStart < start || textEnd > end) continue;
    const text = utf16be(bytes, textStart, textEnd).trim();
    if (text) return text;
  }
  return null;
}

function iccDescriptionFromPayload(bytes: Uint8Array, start: number, end: number): string | null {
  if (end - start < 132 || !startsWithAscii(bytes, start + 36, end, "acsp")) return null;
  const tagCount = readU32(bytes, start + 128);
  let pos = start + 132;
  for (let i = 0; i < tagCount && pos + 12 <= end; i++, pos += 12) {
    const offset = readU32(bytes, pos + 4);
    const length = readU32(bytes, pos + 8);
    const tagStart = start + offset;
    const tagEnd = tagStart + length;
    if (offset < 128 || length <= 0 || tagStart < start || tagEnd > end) continue;
    const text = descriptionTagText(bytes, tagStart, tagEnd) ?? mlucTagText(bytes, tagStart, tagEnd);
    if (text) return text;
  }
  return null;
}

function readU16(bytes: Uint8Array, pos: number): number {
  return ((bytes[pos] ?? 0) << 8) | (bytes[pos + 1] ?? 0);
}

function readU32(bytes: Uint8Array, pos: number): number {
  return ((bytes[pos] ?? 0) * 0x1000000) + (((bytes[pos + 1] ?? 0) << 16) | ((bytes[pos + 2] ?? 0) << 8) | (bytes[pos + 3] ?? 0));
}

function readU32le(bytes: Uint8Array, pos: number): number {
  return ((bytes[pos] ?? 0) | ((bytes[pos + 1] ?? 0) << 8) | ((bytes[pos + 2] ?? 0) << 16)) + (bytes[pos + 3] ?? 0) * 0x1000000;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

function looseAscii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i++) {
    const c = bytes[i] ?? 0;
    out += c >= 32 && c <= 126 ? String.fromCharCode(c) : " ";
  }
  return out;
}

function looseUtf16be(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i + 1 < end; i += 2) {
    const hi = bytes[i] ?? 0;
    const lo = bytes[i + 1] ?? 0;
    out += hi === 0 && lo >= 32 && lo <= 126 ? String.fromCharCode(lo) : " ";
  }
  return out;
}

function utf16be(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i + 1 < end; i += 2) {
    const code = ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
    out += code >= 32 ? String.fromCharCode(code) : " ";
  }
  return out;
}

function startsWithAscii(bytes: Uint8Array, start: number, end: number, value: string): boolean {
  if (start + value.length > end) return false;
  for (let i = 0; i < value.length; i++) if (bytes[start + i] !== value.charCodeAt(i)) return false;
  return true;
}

function findByte(bytes: Uint8Array, value: number, start: number, end: number): number {
  for (let i = start; i < end; i++) if (bytes[i] === value) return i;
  return -1;
}
