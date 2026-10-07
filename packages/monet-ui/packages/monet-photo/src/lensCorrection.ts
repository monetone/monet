// Resolved lens calibration wire format. The catalog resolves sensor/focal/
// aperture coordinates once; the engine consumes half-diagonal coefficients.
import type { OpticsPanel } from "./developRecipe";
import { normalizeLensCalibration, type LensCalibration, type LensCorrectionSettings } from "./lensProfiles";

const id = (v: unknown) => typeof v === "string" && /^[0-9a-f]{32}$/i.test(v) ? v.toLowerCase() : undefined;
const amount = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : 1;
const positive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1_000_000 ? v : undefined;
export function normalizeLensSettings(value: unknown): LensCorrectionSettings {
  const v = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const profileId = id(v.profileId), profileCalibration = normalizeLensCalibration(v.profileCalibration);
  const optional: Partial<LensCorrectionSettings> = {};
  for (const key of ["profileDistortionAmount", "profileVignettingAmount"] as const) if (v[key] !== undefined) optional[key] = amount(v[key]);
  for (const key of ["profileFocalLengthMm", "profileAperture", "profileCropFactor"] as const) {
    const n = positive(v[key]); if (n !== undefined) optional[key] = n;
  }
  return { enableProfileCorrections: v.enableProfileCorrections === true,
    profileName: typeof v.profileName === "string" ? v.profileName.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 512).trim() || null : null,
    ...optional, ...(profileId ? { profileId } : {}), ...(profileCalibration ? { profileCalibration } : {}) };
}

/** fid118/destructive Lens Correction: six unchanged manual controls followed
 * by two profile amounts and thirteen resolved polynomial coefficients. */
export function lensFilterParams(calibration: LensCalibration, distortionAmount = 1, vignettingAmount = 1, manual: readonly number[] = [0, 0, 0, 0, 1, 0]): number[] {
  const c = normalizeLensCalibration(calibration);
  if (!c || manual.length !== 6 || !manual.every(Number.isFinite)) throw new Error("Invalid lens correction calibration or manual controls.");
  return [...manual, amount(distortionAmount), amount(vignettingAmount), ...c.distortion, ...c.red, ...c.blue, ...c.vignette];
}

/** V8's lens settings. Disabled selections still travel through history. */
export function lensProfileWords(optics: OpticsPanel): number[] | null {
  const o = normalizeLensSettings(optics);
  if (!o.enableProfileCorrections && !o.profileName && Object.keys(o).length === 2) return null;
  const text = (s: string) => [s.length, ...Array.from({ length: s.length }, (_, i) => s.charCodeAt(i))];
  const c = o.profileCalibration;
  return [o.enableProfileCorrections ? 1 : 0, amount(o.profileDistortionAmount), amount(o.profileVignettingAmount),
    o.profileFocalLengthMm ?? 0, o.profileAperture ?? 0, o.profileCropFactor ?? 0,
    ...text(o.profileId ?? ""), ...text(o.profileName ?? ""), c ? 1 : 0,
    ...(c ? [...text(c.profileId), ...c.distortion, ...c.red, ...c.blue, ...c.vignette] : [])];
}

export function readLensProfileWords(p: ArrayLike<number>, offset: number): { optics: LensCorrectionSettings; end: number } | null {
  let cursor = offset;
  const take = () => { const n = p[cursor++]; return typeof n === "number" && Number.isFinite(n) ? n : NaN; };
  const text = (max: number) => {
    const n = take(); if (!Number.isInteger(n) || n < 0 || n > max || cursor + n > p.length) return null;
    const chars = Array.from({ length: n }, take);
    return chars.every((c) => Number.isInteger(c) && c >= 0 && c <= 65535) ? String.fromCharCode(...chars) : null;
  };
  const enabled = take(), distortion = take(), vignette = take(), focal = take(), aperture = take(), crop = take();
  if (![0, 1].includes(enabled) || [distortion, vignette].some((v) => !(v >= 0 && v <= 2))
    || [focal, aperture, crop].some((v) => !(v >= 0 && v <= 1_000_000))) return null;
  const profileId = text(32), profileName = text(512), present = take();
  if (profileId === null || (profileId && !id(profileId)) || profileName === null || ![0, 1].includes(present)) return null;
  let profileCalibration: LensCalibration | undefined;
  if (present) {
    const resolvedId = text(32);
    profileCalibration = normalizeLensCalibration({ profileId: resolvedId, distortion: Array.from({ length: 4 }, take), red: Array.from({ length: 3 }, take), blue: Array.from({ length: 3 }, take), vignette: Array.from({ length: 3 }, take) });
    if (!profileCalibration) return null;
  }
  return { optics: { enableProfileCorrections: enabled === 1, profileName: profileName || null,
    ...(profileId ? { profileId } : {}), profileDistortionAmount: distortion, profileVignettingAmount: vignette,
    ...(focal ? { profileFocalLengthMm: focal } : {}), ...(aperture ? { profileAperture: aperture } : {}), ...(crop ? { profileCropFactor: crop } : {}),
    ...(profileCalibration ? { profileCalibration } : {}) }, end: cursor };
}
