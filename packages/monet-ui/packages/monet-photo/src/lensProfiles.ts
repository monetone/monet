// Published Lensfun data, independently evaluated using its documented models.
// The database is CC-BY-SA-3.0; see ../data/NOTICE-LENSFUN.md.
import catalog from "./lensProfiles.catalog.json";

export interface LensMetadata {
  make?: string; model?: string; lens?: string;
  focalLengthMm?: number; aperture?: number; focalLength35Mm?: number;
  cropFactor?: number; subjectDistanceM?: number;
}
export interface LensCalibration {
  profileId: string;
  distortion: [number, number, number, number];
  red: [number, number, number]; blue: [number, number, number];
  vignette: [number, number, number];
}
export interface LensCorrectionSettings {
  enableProfileCorrections?: boolean; profileName?: string | null; profileId?: string;
  profileDistortionAmount?: number; profileVignettingAmount?: number;
  profileFocalLengthMm?: number; profileAperture?: number; profileCropFactor?: number;
  profileCalibration?: LensCalibration;
}
interface Sample { model: string; focal: number; [key: string]: string | number }
export interface LensProfile {
  id: string; name: string; maker: string; model: string;
  cropFactor: number; aspectRatio: number; mounts: string[]; aliases: string[];
  distortion: Sample[]; tca: Sample[]; vignetting: Sample[]; sourceFiles: string[];
}
export const LENS_PROFILES: readonly LensProfile[] = catalog.profiles as LensProfile[];
const byId = new Map(LENS_PROFILES.map((p) => [p.id, p]));
export const lensProfileById = (id: string): LensProfile | undefined => byId.get(id.toLowerCase());
export const lensProfileName = (id: string): string | undefined => lensProfileById(id)?.name;
const positive = (n: unknown, max = 1_000_000): number | undefined => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= max ? n : undefined;
const clean = (s: unknown): string | undefined => typeof s === "string" ? s.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 512) || undefined : undefined;
export function normalizeLensMetadata(value: unknown): LensMetadata {
  const v = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result: LensMetadata = {};
  for (const k of ["make", "model", "lens"] as const) { const s = clean(v[k]); if (s) result[k] = s; }
  for (const k of ["focalLengthMm", "aperture", "focalLength35Mm", "cropFactor", "subjectDistanceM"] as const) {
    const n = positive(v[k]); if (n !== undefined) result[k] = n;
  }
  return result;
}
// Match the renderer's f32 wire values and test every extremum on radius² ∈ [0,1].
function validVignette(values: readonly number[]): boolean {
  const [a, b, c] = values.map(Math.fround), radii = [0, 1];
  if (Math.abs(c) > 1e-12) {
    const discriminant = 4 * b * b - 12 * c * a;
    if (discriminant >= 0) radii.push((-2 * b + Math.sqrt(discriminant)) / (6 * c), (-2 * b - Math.sqrt(discriminant)) / (6 * c));
  } else if (Math.abs(b) > 1e-12) radii.push(-a / (2 * b));
  return radii.filter((x) => x >= 0 && x <= 1).every((x) => 1 + x * (a + x * (b + x * c)) > 1e-6);
}
export function normalizeLensCalibration(value: unknown): LensCalibration | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.profileId !== "string" || !/^[a-f0-9]{32}$/i.test(v.profileId)) return undefined;
  const coefficients = (key: string, length: number) => Array.isArray(v[key]) && v[key].length === length
    && v[key].every((n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1000);
  if (!coefficients("distortion", 4) || !coefficients("red", 3) || !coefficients("blue", 3) || !coefficients("vignette", 3)) return undefined;
  if (!validVignette(v.vignette as number[])) return undefined;
  return { profileId: v.profileId.toLowerCase(), distortion: [...v.distortion as LensCalibration["distortion"]],
    red: [...v.red as LensCalibration["red"]], blue: [...v.blue as LensCalibration["blue"]], vignette: [...v.vignette as LensCalibration["vignette"]] };
}
const normalized = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const cameraMaker = (s: string) => {
  const key = normalized(s);
  if (["nikon", "nikoncorporation"].includes(key)) return "nikon";
  if (["olympus", "olympusimagingcorp", "olympuscorporation", "olympusopticalcoltd"].includes(key)) return "olympus";
  return key;
};
const identity = (s: string, maker: string) => normalized(s).replace(new RegExp(`^${normalized(maker)}`), "");
function compatibleMounts(mount: string): Set<string> {
  const result = new Set([mount]);
  for (const m of result) for (const next of (catalog.mounts as Record<string, string[]>)[m] ?? []) result.add(next);
  return result;
}
interface Point { x: number; values: number[] }
// Interpolate only between measured coordinates; never extrapolate coefficients.
function interpolate(points: Point[], x: number, label: string, warnings: Set<string>): number[] | undefined {
  points.sort((a, b) => a.x - b.x);
  if (!points.length) { warnings.add(`No ${label} calibration is available.`); return undefined; }
  const unique: Point[] = [];
  for (const p of points) {
    const last = unique[unique.length - 1];
    if (last?.x === p.x) {
      if (last.values.some((v, i) => v !== p.values[i])) {
        warnings.add(`Conflicting ${label} measurements; this correction is unavailable.`); return undefined;
      }
    } else unique.push(p);
  }
  if (x < unique[0].x || x > unique[unique.length - 1]!.x) warnings.add(`${label} is limited to the nearest measured setting.`);
  const upper = unique.findIndex((p) => p.x >= x);
  if (upper <= 0) return (upper === 0 ? unique[0] : unique[unique.length - 1]!).values;
  const a = unique[upper - 1], b = unique[upper], t = (x - a.x) / (b.x - a.x);
  return a.values.map((v, i) => v + t * (b.values[i] - v));
}
const n = (s: Sample, key: string, fallback = 0) => typeof s[key] === "number" ? s[key] as number : fallback;
function distortion(s: Sample): number[] {
  if (s.model === "poly3") return [1 - n(s, "k1"), 0, n(s, "k1"), 0, 0];
  if (s.model === "poly5") return [1, 0, n(s, "k1"), 0, n(s, "k2")];
  if (s.model === "ptlens") return [1 - n(s, "a") - n(s, "b") - n(s, "c"), n(s, "c"), n(s, "b"), n(s, "a"), 0];
  return [1, 0, 0, 0, 0];
}
function tca(s: Sample): number[] {
  return s.model === "poly3" ? [n(s, "vr", 1), n(s, "cr"), n(s, "br"), n(s, "vb", 1), n(s, "cb"), n(s, "bb")]
    : [n(s, "kr", 1), 0, 0, n(s, "kb", 1), 0, 0];
}
export type LensProfileResolution = { status: "missing"; message: string } | {
  status: "resolved"; profile: LensProfile; calibration: LensCalibration; warnings: string[];
  focalLengthMm: number; aperture?: number; cropFactor: number;
};
/** Resolves independently of the enable flag, so a disabled selection can still be inspected. */
export function resolveLensProfile(metadata: LensMetadata, settings: LensCorrectionSettings = {}): LensProfileResolution {
  const m = normalizeLensMetadata(metadata), warnings = new Set<string>();
  const missing = (message: string): LensProfileResolution => ({ status: "missing", message });
  for (const [key, label, max] of [
    ["profileFocalLengthMm", "Focal length (mm)", 100000], ["profileAperture", "Aperture (f-number)", 1024],
    ["profileCropFactor", "Sensor crop factor", 20],
  ] as const) {
    if (settings[key] !== undefined && positive(settings[key], max) === undefined) return missing(`${label} must be greater than zero and at most ${max}.`);
  }
  const cameras = m.model ? catalog.cameras.filter((c) => (!m.make || cameraMaker(c.maker) === cameraMaker(m.make))
    && c.models.some((model) => identity(model, c.maker) === identity(m.model!, c.maker))) : [];
  const camera = cameras.length && cameras.every((c) => c.mount === cameras[0].mount && c.cropFactor === cameras[0].cropFactor) ? cameras[0] : undefined;
  const explicit = Boolean(settings.profileId || settings.profileName);
  let crop = positive(settings.profileCropFactor, 20) ?? positive(m.cropFactor, 20) ?? camera?.cropFactor
    ?? (m.focalLength35Mm && m.focalLengthMm ? positive(m.focalLength35Mm / m.focalLengthMm, 20) : undefined);
  let candidates: readonly LensProfile[];
  if (explicit) {
    const profile = settings.profileId ? lensProfileById(settings.profileId) : LENS_PROFILES.find((p) => p.name === settings.profileName);
    if (!profile) return missing("The selected lens profile is unavailable. Choose a profile or Automatic.");
    candidates = [profile];
    if (!crop) { crop = profile.cropFactor; warnings.add("Camera sensor size is unknown; using the profile crop factor. Set Sensor crop factor if needed."); }
  } else {
    if (!m.lens) return missing("Lens metadata is missing. Choose a profile and enter the capture settings.");
    if (!crop) return missing("Camera sensor size is unknown. Enter Sensor crop factor or choose a profile.");
    const mounts = camera ? compatibleMounts(camera.mount) : undefined;
    candidates = LENS_PROFILES.filter((p) => p.aliases.some((alias) => identity(alias, p.maker) === identity(m.lens!, p.maker))
      && (!mounts || p.mounts.some((mount) => mounts.has(mount))) && p.cropFactor <= crop! * 1.05);
    // Multiple calibration sizes for the same named lens: use the closest covered sensor.
    if (candidates.length > 1 && candidates.every((p) => p.maker === candidates[0].maker && p.model === candidates[0].model
      && p.mounts.join() === candidates[0].mounts.join())) {
      const nearest = Math.max(...candidates.map((p) => p.cropFactor));
      candidates = candidates.filter((p) => p.cropFactor === nearest);
    }
    if (candidates.length !== 1) return missing(candidates.length ? "Lens metadata matches multiple profiles. Choose a profile." : "No compatible lens profile matches this camera and lens. Choose a profile.");
  }
  const profile = candidates[0];
  if (!crop || profile.cropFactor > crop * 1.05) return missing("This profile was measured on a smaller sensor. Choose a compatible profile or correct Sensor crop factor.");
  const focal = positive(settings.profileFocalLengthMm) ?? m.focalLengthMm;
  if (!focal) return missing("Focal length is missing. Enter Focal length (mm) to resolve this profile.");
  const aperture = positive(settings.profileAperture) ?? m.aperture;
  const u = profile.cropFactor / crop, s = u * Math.hypot(profile.aspectRatio, 1);
  const raw = interpolate(profile.distortion.map((row) => ({ x: row.focal, values: distortion(row) })), focal, "Distortion", warnings);
  const [d, c, b, a, k2] = raw ?? [1, 0, 0, 0, 0];
  if (!(d > 0)) return missing("The selected distortion calibration is invalid.");
  const rawChroma = interpolate(profile.tca.map((row) => ({ x: row.focal, values: tca(row) })), focal, "Lateral chromatic aberration", warnings);
  const chroma = rawChroma ?? [1, 0, 0, 1, 0, 0];
  let vignette = [0, 0, 0], vignetteAvailable = false;
  if (aperture && profile.vignetting.length) {
    const measuredFocals = [...new Set(profile.vignetting.map((row) => row.focal))].sort((a, b) => a - b);
    const lower = measuredFocals.filter((f) => f <= focal).pop() ?? measuredFocals[0];
    const upper = measuredFocals.find((f) => f >= focal) ?? measuredFocals[measuredFocals.length - 1];
    const focals = [...new Set([lower, upper])];
    const points: Point[] = [];
    let conflicting = false;
    for (const f of focals) {
      const rows = profile.vignetting.filter((row) => row.focal === f);
      const apertures = [...new Set(rows.map((row) => n(row, "aperture")))];
      const aperturePoints: Point[] = [];
      for (const ap of apertures) {
        const group = rows.filter((row) => n(row, "aperture") === ap);
        const distance = m.subjectDistanceM;
        const measured = distance ? Math.min(...group.map((row) => Math.abs(1 / n(row, "distance") - 1 / distance))) : 0;
        const farthest = Math.max(...group.map((row) => n(row, "distance")));
        const selected = group.filter((row) => distance ? Math.abs(1 / n(row, "distance") - 1 / distance) === measured : n(row, "distance") === farthest);
        const values = interpolate(selected.map((row) => ({ x: ap, values: [n(row, "k1"), n(row, "k2"), n(row, "k3")] })), ap, "Vignetting", warnings);
        if (values) aperturePoints.push({ x: ap, values });
        else conflicting = true;
      }
      const values = interpolate(aperturePoints, aperture, "Vignetting aperture", warnings);
      if (values) points.push({ x: f, values });
    }
    if (!conflicting) {
      const measured = interpolate(points, focal, "Vignetting focal length", warnings);
      if (measured) { vignette = measured; vignetteAvailable = true; }
    }
    if (!m.subjectDistanceM) warnings.add("Focus distance is unknown; using the farthest measured vignetting calibration.");
  } else warnings.add(aperture ? "No vignetting calibration is available." : "Aperture is missing; profile vignetting is unavailable.");
  const scaledVignette = vignette.map((v, i) => v * u ** (2 * (i + 1)));
  if (!validVignette(scaledVignette)) {
    scaledVignette.fill(0); vignetteAvailable = false;
    warnings.add("Vignetting calibration is invalid at this sensor size; profile vignetting is unavailable.");
  }
  if (!raw && !rawChroma && !vignetteAvailable) return missing(`No usable calibration at these capture settings. ${[...warnings].join(" ")}`);
  const calibration = normalizeLensCalibration({ profileId: profile.id,
    distortion: [c * s / d ** 2, b * s ** 2 / d ** 3, a * s ** 3 / d ** 4, k2 * s ** 4 / d ** 5],
    red: [chroma[0], chroma[1] * s, chroma[2] * s ** 2], blue: [chroma[3], chroma[4] * s, chroma[5] * s ** 2],
    vignette: scaledVignette });
  return calibration ? { status: "resolved", profile, calibration, warnings: [...warnings], focalLengthMm: focal, aperture, cropFactor: crop }
    : missing("The selected lens calibration is outside supported bounds.");
}
