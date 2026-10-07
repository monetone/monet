// Camera Raw ▸ Profile beyond the four built-in looks (#446): a DNG's own
// (embedded) profile and the DNG camera profiles (.dcp) the user loads — kept
// in a persisted library — or, on the desktop, finds in Adobe's CameraProfiles
// folders. The engine parses and renders them (packages/engine dcp.rs); this
// module is the pure bookkeeping around it: the library's storage, which
// profiles an image is offered (ACR matches UniqueCameraModel), and how a
// recipe's saved choice (name + digest) is found again on reopen.
import { PROFILE_DIGEST_RE, isAsShotKelvin, normalizeProfileSource, type ProfilePanel } from "@monet-ui/monet-photo";
import type { CameraRawSourceMetadata } from "./cameraRaw";

/** What the engine's develop_profile_info reports for a profile. */
export interface CameraRawProfileInfo {
  name: string;
  /** UniqueCameraModel: the camera the profile was made for. */
  model: string;
  digest: string;
  embedded: boolean;
  /** No creative tables: without a RAW basis this cannot change RGB pixels. */
  matrixOnly: boolean;
}

/** A library profile: loaded by the user (persisted) or found in Adobe's
 *  folders on the desktop (this launch only). */
export interface CameraRawProfileEntry {
  name: string;
  model: string;
  digest: string;
  origin: "user" | "adobe";
}

/** Where older builds kept the library (see parseCameraRawProfiles). */
export const CAMERA_RAW_PROFILES_KEY = "mv.cameraRawProfiles";
/** Adobe's largest shipped profiles are a few MB. */
export const MAX_CAMERA_PROFILE_BYTES = 8 * 1024 * 1024;
export const MAX_CAMERA_PROFILES = 64;
/** Where ACR looks for camera profiles on macOS, user folder first. */
export const ADOBE_CAMERA_PROFILE_DIRS = [
  "Library/Application Support/Adobe/CameraRaw/CameraProfiles",
  "/Library/Application Support/Adobe/CameraRaw/CameraProfiles",
];

export const isDcpProfileId = (id: string) => id === "embedded" || id === "custom";

/** Flat develop params name a DNG profile by code and digest only; keep the
 *  name a previous recipe gave the same profile. */
export function keepProfileName(next: ProfilePanel, previous: ProfilePanel | undefined): ProfilePanel {
  return previous && isDcpProfileId(next.id) && next.id === previous.id && next.digest === previous.digest
    ? { ...next, name: previous.name, group: previous.group }
    : next;
}

/** Read develop_profile_info's JSON; throws its reason for an unusable file. */
export function parseProfileInfo(json: string): CameraRawProfileInfo {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(json); } catch { throw new Error("The camera profile could not be read."); }
  if (typeof raw.error === "string") throw new Error(`That file can't be used as a camera profile: ${raw.error}.`);
  if (typeof raw.digest !== "string" || !PROFILE_DIGEST_RE.test(raw.digest)) throw new Error("The camera profile could not be read.");
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    model: typeof raw.model === "string" ? raw.model : "",
    digest: raw.digest,
    embedded: raw.embedded === true,
    matrixOnly: raw.forwardMatrix === false && raw.hueSatMap === false && raw.lookTable === false
      && raw.toneCurve === false && raw.baselineExposureOffset === 0,
  };
}

const cameraKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** The names a raw's camera answers to, for matching a profile's
 *  UniqueCameraModel: a DNG's own tag, and make + model the way Adobe spells
 *  them ("Canon EOS 5D Mark III", "Nikon D850", "Sony ILCE-7M3"). */
export function cameraModelKeys(metadata: CameraRawSourceMetadata | null | undefined): string[] {
  const extra = metadata?.extra ?? {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const candidates = [
    text(extra.uniqueCameraModel),
    `${text(extra.cleanMake)} ${text(extra.cleanModel)}`,
    text(metadata?.model),
    `${text(metadata?.make)} ${text(metadata?.model)}`,
  ];
  return [...new Set(candidates.map(cameraKey).filter(Boolean))];
}

export const profileMatchesCamera = (model: string, keys: readonly string[]) =>
  !!model.trim() && keys.includes(cameraKey(model));

/** The image's own profile, as the decode recorded it. */
export function embeddedCameraProfile(metadata: CameraRawSourceMetadata | null | undefined): { name: string; digest: string } | null {
  const digest = metadata?.extra?.embeddedProfileDigest;
  if (typeof digest !== "string" || !PROFILE_DIGEST_RE.test(digest)) return null;
  const name = metadata?.extra?.embeddedProfileName;
  return { name: typeof name === "string" && name ? name : "Embedded", digest };
}

/** One entry of the Profile menu. `value` keys it; `profile` is what choosing
 *  it writes (the amount stays the user's). */
export interface CameraRawProfileOption {
  value: string;
  label: string;
  profile: Omit<ProfilePanel, "amount">;
}

const BUILT_IN: CameraRawProfileOption[] = [
  { value: "camera-default", label: "Camera Default", profile: { id: "camera-default", name: "Camera Default", group: "Camera Matching" } },
  { value: "adobe-color", label: "Adobe Color", profile: { id: "adobe-color", name: "Adobe Color", group: "Camera Matching" } },
  { value: "camera-neutral", label: "Camera Neutral", profile: { id: "camera-neutral", name: "Camera Neutral", group: "Camera Matching" } },
  { value: "monochrome", label: "Monochrome", profile: { id: "monochrome", name: "Monochrome", group: "Camera Matching" } },
];

/** The Profile menu key a recipe's profile shows as. */
export const profileMenuValue = (profile: ProfilePanel) =>
  profile.id === "custom" ? `custom:${profile.digest ?? profile.name}` : profile.id;

/** The Profile menu for an image: the built-in looks, its embedded profile,
 *  and the library profiles made for its camera. A selection that is none of
 *  those (its profile is missing) stays listed so the menu can show it. */
export function cameraRawProfileMenu(
  library: readonly CameraRawProfileEntry[],
  metadata: CameraRawSourceMetadata | null | undefined,
  current: ProfilePanel,
): CameraRawProfileOption[] {
  const options = [...BUILT_IN];
  const embedded = embeddedCameraProfile(metadata);
  if (embedded) {
    options.push({
      value: "embedded",
      label: embedded.name === "Embedded" ? "Embedded" : `Embedded (${embedded.name})`,
      profile: { id: "embedded", name: embedded.name, group: "Embedded", digest: embedded.digest },
    });
  }
  const keys = cameraModelKeys(metadata);
  for (const entry of library) {
    if (!profileMatchesCamera(entry.model, keys)) continue;
    options.push({
      value: `custom:${entry.digest}`,
      label: entry.name,
      profile: { id: "custom", name: entry.name, group: "Custom", digest: entry.digest },
    });
  }
  const value = profileMenuValue(current);
  if (!options.some((option) => option.value === value) && isDcpProfileId(current.id)) {
    const { amount: _amount, ...profile } = current;
    options.push({ value, label: `${current.name || "Custom"} (missing)`, profile });
  }
  return options;
}

/** Where a recipe's embedded/custom profile comes from now, or why it can't. */
export type CameraRawProfileResolution =
  | { status: "builtin" }
  | { status: "resolved"; name: string; digest: string; source: "embedded" | "library" }
  | { status: "missing"; message: string };

/** Find a recipe's profile again: Embedded is whatever the image carries; a
 *  custom profile is its digest in the library or the image, else — for a
 *  sidecar written where the profile had another fingerprint (ACR's
 *  CameraProfileDigest is its own) — the image's embedded profile or a
 *  library profile of the same name, the way ACR matches CameraProfile by
 *  name. Library profiles count only when made for this camera. */
export function resolveCameraRawProfile(
  profile: ProfilePanel,
  library: readonly CameraRawProfileEntry[],
  metadata: CameraRawSourceMetadata | null | undefined,
): CameraRawProfileResolution {
  if (!isDcpProfileId(profile.id)) return { status: "builtin" };
  const embedded = embeddedCameraProfile(metadata);
  const fromEmbedded = embedded && { status: "resolved" as const, name: embedded.name, digest: embedded.digest, source: "embedded" as const };
  if (profile.id === "embedded") {
    return fromEmbedded
      ?? { status: "missing", message: "This image has no embedded profile — showing Camera Default. Choose another profile." };
  }
  const keys = cameraModelKeys(metadata);
  const forCamera = (entry: CameraRawProfileEntry | undefined) => entry && profileMatchesCamera(entry.model, keys) ? entry : undefined;
  const byDigest = library.find((entry) => entry.digest === profile.digest);
  const sameName = (name: string) => name.trim().toLowerCase() === profile.name.trim().toLowerCase();
  const found = forCamera(byDigest);
  if (found) return { status: "resolved", name: found.name, digest: found.digest, source: "library" };
  if (fromEmbedded && (embedded.digest === profile.digest || sameName(embedded.name))) return fromEmbedded;
  const named = forCamera(library.find((entry) => sameName(entry.name)));
  if (named) return { status: "resolved", name: named.name, digest: named.digest, source: "library" };
  return {
    status: "missing",
    message: byDigest
      ? `The camera profile “${byDigest.name}” is made for ${byDigest.model || "another camera"}, not this image's camera — showing Camera Default. Choose a profile for this camera.`
      : `The camera profile “${profile.name || "Custom"}” isn't installed — showing Camera Default. Load it with Load Profile… to render it again.`,
  };
}

/** The image's as-shot white in kelvin, as the decode recorded it. */
export function asShotKelvin(metadata: CameraRawSourceMetadata | null | undefined): number | undefined {
  const kelvin = metadata?.extra?.asShotKelvin;
  return isAsShotKelvin(kelvin) ? kelvin : undefined;
}

/** RawMetadata.cameraToXyz is normalized as colorMatrix2 (three rows of four
 * coefficients). Keep its exact three-channel basis; never truncate a real
 * fourth channel into a different camera model. */
export function cameraProfileSource(metadata: CameraRawSourceMetadata | null | undefined) {
  const m = metadata?.colorMatrix2;
  const wb = metadata?.whiteBalance;
  if (!m || m.length !== 12 || !wb || wb.length < 3 || [3, 7, 11].some((i) => m[i] !== 0)) return undefined;
  return normalizeProfileSource({ cameraToXyz: [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]], whiteBalance: wb.slice(0, 3) });
}

/** Where the user's loaded profiles live, file by file: the desktop's
 *  app-data CameraProfiles folder, IndexedDB in a browser (app.ts). Big
 *  profiles (Adobe's run to ~1 MB each) stay out of localStorage's quota. */
export interface CameraRawProfileStorage {
  list(): Promise<{ fileName: string; bytes: Uint8Array }[]>;
  put(fileName: string, bytes: Uint8Array): Promise<void>;
}

/** The file a library profile is stored as: its name, kept unique by digest. */
export function storedProfileFileName(entry: Pick<CameraRawProfileEntry, "name" | "digest">): string {
  const stem = [...entry.name].map((c) => (c < " " || '\\/:*?"<>|'.includes(c) ? "_" : c)).join("").trim().slice(0, 100) || "Custom";
  return `${stem} ${entry.digest.slice(0, 8)}.dcp`;
}

/** The name a stored profile without its own ProfileName goes by. */
export const storedProfileName = (fileName: string) =>
  fileName.replace(/\.dcp$/i, "").replace(/ [0-9A-F]{8}$/, "") || "Custom";

/** Read the library older builds kept in localStorage (key
 *  CAMERA_RAW_PROFILES_KEY), for its one-time move into the profile storage.
 *  Storage is user-editable, so each entry is re-checked and a bad one
 *  dropped; the engine re-verifies the bytes before a render uses them. */
export function parseCameraRawProfiles(text: string | null): { entry: CameraRawProfileEntry; bytes: Uint8Array }[] {
  let raw: unknown;
  try { raw = JSON.parse(text ?? "[]"); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: { entry: CameraRawProfileEntry; bytes: Uint8Array }[] = [];
  for (const item of raw.slice(0, MAX_CAMERA_PROFILES)) {
    const { name, model, digest, data } = (item ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || typeof model !== "string" || typeof digest !== "string" || typeof data !== "string") continue;
    if (!PROFILE_DIGEST_RE.test(digest) || data.length > Math.ceil(MAX_CAMERA_PROFILE_BYTES / 3) * 4) continue;
    let binary: string;
    try { binary = atob(data); } catch { continue; }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    out.push({ entry: { name: name.slice(0, 256), model: model.slice(0, 256), digest, origin: "user" }, bytes });
  }
  return out;
}

/** Candidate .dcp paths under an Adobe CameraProfiles folder for a camera:
 *  every profile in the (small) user folder, but only the files named for
 *  this camera in the system folder, which holds one set per supported
 *  camera — the parser then confirms each one's UniqueCameraModel. */
export async function collectAdobeProfilePaths(
  dir: string,
  reader: { readDir(dir: string): Promise<{ name: string; isDirectory: boolean; isFile: boolean }[]> },
  keys: readonly string[],
  userFolder: boolean,
  depth = 3,
): Promise<string[]> {
  let entries: { name: string; isDirectory: boolean; isFile: boolean }[];
  try { entries = await reader.readDir(dir); } catch { return []; }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory && depth > 0) out.push(...await collectAdobeProfilePaths(path, reader, keys, userFolder, depth - 1));
    else if (entry.isFile && /\.dcp$/i.test(entry.name)
      && (userFolder || keys.some((key) => cameraKey(entry.name).startsWith(key)))) out.push(path);
  }
  return out;
}
