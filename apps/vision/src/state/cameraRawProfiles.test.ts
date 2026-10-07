// Camera Raw ▸ Profile: embedded + user-loaded DNG camera profiles (#446) —
// which profiles an image is offered, how a saved choice (name + digest) is
// found again, the persisted library, and the profile identity surviving every
// round trip a recipe takes (flat params, XMP sidecar, project envelope). The
// engine's DCP parser/renderer is covered by the Rust tests in dcp.rs; the
// workspace flow by e2e/camera-raw-workspace.spec.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { PROFILE_CODES, recipeToParams, normalizeProfileSource, type ProfilePanel } from "@monet-ui/monet-photo";
import {
  CAMERA_RAW_PROFILES_KEY,
  cameraModelKeys,
  cameraProfileSource,
  cameraRawProfileMenu,
  collectAdobeProfilePaths,
  keepProfileName,
  parseCameraRawProfiles,
  resolveCameraRawProfile,
  storedProfileFileName,
  storedProfileName,
  type CameraRawProfileEntry,
} from "./cameraRawProfiles";
import {
  CAMERA_RAW_SOURCE_VERSION,
  normalizeCameraRawSourceMetadata,
  type CameraRawSource,
  type CameraRawSourceMetadata,
} from "./cameraRaw";
import { engineParamsToWorkingRecipe, normalizeWorkingRecipe, workingRecipeToParams } from "./visionDevelopRecipe";
import { parseCameraRawXmp, serializeCameraRawXmp } from "./cameraRawSidecar";
import { decodeProjectEnvelope, encodeProjectEnvelope } from "./projectEnvelope";
import { Store } from "./store";

const STUDIO = "0123456789ABCDEF0123456789ABCDEF";
const EMBEDDED = "FEDCBA9876543210FEDCBA9876543210";
const OTHER = "00000000000000000000000000000001";

/** A Nikon D850 NEF's metadata as the decode reports it, plus (optionally) a DNG's own profile. */
function metadata(embedded = false): CameraRawSourceMetadata {
  return normalizeCameraRawSourceMetadata({
    make: "NIKON CORPORATION", model: "NIKON D850", cleanMake: "Nikon", cleanModel: "D850",
    ...(embedded ? { uniqueCameraModel: "Nikon D850", embeddedProfile: { name: "Adobe Standard", digest: EMBEDDED } } : {}),
  });
}

const library: CameraRawProfileEntry[] = [
  { name: "Studio Portrait", model: "Nikon D850", digest: STUDIO, origin: "user" },
  { name: "Canon Look", model: "Canon EOS R5", digest: OTHER, origin: "user" },
];

const profile = (patch: Partial<ProfilePanel>): ProfilePanel => ({ id: "camera-default", name: "Camera Default", group: "Camera Matching", amount: 1, ...patch });

describe("which camera profiles an image is offered", () => {
  it("matches a profile's UniqueCameraModel against the camera's names, ACR-style", () => {
    expect(cameraModelKeys(metadata())).toEqual(["nikon d850", "nikon corporation nikon d850"]);
    expect(cameraModelKeys(metadata(true))[0]).toBe("nikon d850");
    expect(cameraModelKeys(null)).toEqual([]);
  });

  it("lists the built-in looks, the embedded profile and only this camera's library profiles", () => {
    const menu = cameraRawProfileMenu(library, metadata(true), profile({}));
    expect(menu.map((o) => o.label)).toEqual([
      "Camera Default", "Adobe Color", "Camera Neutral", "Monochrome", "Embedded (Adobe Standard)", "Studio Portrait",
    ]);
    expect(menu.at(-1)!.profile).toEqual({ id: "custom", name: "Studio Portrait", group: "Custom", digest: STUDIO });
    // A non-DNG raw has no embedded profile; a pixel layer (no RAW) gets the built-ins only.
    expect(cameraRawProfileMenu(library, metadata(), profile({})).some((o) => o.value === "embedded")).toBe(false);
    expect(cameraRawProfileMenu(library, null, profile({}))).toHaveLength(4);
  });

  it("keeps a missing selection listed so the menu can show it", () => {
    const menu = cameraRawProfileMenu([], metadata(), profile({ id: "custom", name: "Gone", digest: STUDIO }));
    expect(menu.at(-1)).toMatchObject({ value: `custom:${STUDIO}`, label: "Gone (missing)" });
  });
});

describe("finding a saved profile choice again", () => {
  it("resolves Embedded to the image's own profile and custom by digest, then by name for this camera", () => {
    // An ACR sidecar names the DNG's own "Adobe Standard" under ACR's digest.
    expect(resolveCameraRawProfile(profile({ id: "custom", name: "adobe standard", digest: "A".repeat(32) }), library, metadata(true)))
      .toEqual({ status: "resolved", name: "Adobe Standard", digest: EMBEDDED, source: "embedded" });
    expect(resolveCameraRawProfile(profile({ id: "monochrome" }), library, metadata())).toEqual({ status: "builtin" });
    expect(resolveCameraRawProfile(profile({ id: "embedded", name: "Embedded" }), library, metadata(true)))
      .toEqual({ status: "resolved", name: "Adobe Standard", digest: EMBEDDED, source: "embedded" });
    expect(resolveCameraRawProfile(profile({ id: "custom", name: "Renamed", digest: STUDIO }), library, metadata()))
      .toMatchObject({ status: "resolved", name: "Studio Portrait", digest: STUDIO });
    // ACR's digest for the same profile is another fingerprint: the name finds it.
    expect(resolveCameraRawProfile(profile({ id: "custom", name: "Studio Portrait", digest: "A".repeat(32) }), library, metadata()))
      .toMatchObject({ status: "resolved", digest: STUDIO });
  });

  it("says why a profile can't render: not embedded, not installed, or for another camera", () => {
    const noEmbedded = resolveCameraRawProfile(profile({ id: "embedded" }), library, metadata());
    expect(noEmbedded).toMatchObject({ status: "missing", message: expect.stringContaining("no embedded profile") });
    const gone = resolveCameraRawProfile(profile({ id: "custom", name: "Gone", digest: "B".repeat(32) }), library, metadata());
    expect(gone).toMatchObject({ status: "missing", message: expect.stringContaining("“Gone” isn't installed") });
    expect(gone.status === "missing" && gone.message).toContain("Load Profile…");
    const foreign = resolveCameraRawProfile(profile({ id: "custom", name: "Canon Look", digest: OTHER }), library, metadata());
    expect(foreign).toMatchObject({ status: "missing", message: expect.stringContaining("made for Canon EOS R5") });
  });

  it("keeps a profile's name across the flat params, which carry only its code and digest", () => {
    const named = profile({ id: "custom", name: "Studio Portrait", group: "Custom", digest: STUDIO });
    const decoded = profile({ id: "custom", name: "Custom", digest: STUDIO });
    expect(keepProfileName(decoded, named)).toMatchObject({ name: "Studio Portrait", group: "Custom" });
    expect(keepProfileName({ ...decoded, digest: OTHER }, named).name).toBe("Custom");
  });
});

describe("profile identity round trips", () => {
  const custom = () => {
    const recipe = normalizeWorkingRecipe({});
    recipe.profile = { id: "custom", name: "Studio Portrait", group: "Custom", amount: 0.8, digest: STUDIO };
    return recipe;
  };

  it("writes codes 4/5 and the digest into the flat params and reads them back", () => {
    for (const [id, code] of [["embedded", 4], ["custom", 5]] as const) {
      expect(PROFILE_CODES[id]).toBe(code);
      const recipe = custom();
      recipe.profile = { ...recipe.profile, id };
      const params = workingRecipeToParams(recipe);
      expect(params[1087]).toBe(6);
      expect(params[1088]).toBe(code);
      const back = engineParamsToWorkingRecipe(params);
      expect(back.profile).toMatchObject({ id, digest: STUDIO });
      expect(back.profile.amount).toBeCloseTo(0.8, 6);
      expect(Array.from(workingRecipeToParams(back))).toEqual(Array.from(params));
    }
  });

  it("carries the decoder basis through V7 params, the project and XMP without changing V6", () => {
    const recipe = custom();
    const basis = { cameraToXyz: [1, 0, 0, 0, 0.5, 0, 0, 0, 1.5], whiteBalance: [2, 1, 1.5] };
    recipe.profile.sourceCamera = basis;
    for (const params of [workingRecipeToParams(recipe), recipeToParams(recipe)]) {
      expect(params[1087]).toBe(7);
      expect(Array.from(params.slice(-12))).toEqual([...basis.cameraToXyz, ...basis.whiteBalance]);
      expect(engineParamsToWorkingRecipe(params).profile.sourceCamera).toEqual(basis);
    }
    const source: CameraRawSource = { version: CAMERA_RAW_SOURCE_VERSION, originalName: "a.dng", originalBytes: new Uint8Array([1]), metadata: {}, recipe };
    expect(parseCameraRawXmp(serializeCameraRawXmp(source))?.recipe.profile.sourceCamera).toEqual(basis);
    const envelope = decodeProjectEnvelope(encodeProjectEnvelope(new Uint8Array([7]), [], { colorProfileAssigned: true, cameraRaw: source }));
    expect(envelope?.document.cameraRaw?.recipe.profile.sourceCamera).toEqual(basis);
    expect(workingRecipeToParams(custom())[1087]).toBe(6);
    expect(normalizeProfileSource({ ...basis, cameraToXyz: Array(9).fill(0) })).toBeUndefined();
    expect(normalizeProfileSource({ ...basis, whiteBalance: [1, 0, 1] })).toBeUndefined();
    expect(cameraProfileSource({ colorMatrix2: [1, 0, 0, 0.1, 0, 1, 0, 0, 0, 0, 1, 0], whiteBalance: [1, 1, 1, 1] })).toBeUndefined();
  });

  it("keeps name + digest through the XMP sidecar and the project envelope", () => {
    const source: CameraRawSource = {
      version: CAMERA_RAW_SOURCE_VERSION, originalName: "DSC_0001.nef", originalBytes: new Uint8Array([1, 2, 3]),
      metadata: metadata(), recipe: custom(),
    };
    const xmp = serializeCameraRawXmp(source);
    expect(xmp).toContain('crs:CameraProfile="Studio Portrait"');
    expect(xmp).toContain(`crs:CameraProfileDigest="${STUDIO}"`);
    expect(parseCameraRawXmp(xmp)?.recipe.profile).toMatchObject({ id: "custom", name: "Studio Portrait", digest: STUDIO });

    const envelope = decodeProjectEnvelope(encodeProjectEnvelope(new Uint8Array([7]), [], { colorProfileAssigned: true, cameraRaw: source }));
    expect(envelope?.document.cameraRaw?.recipe.profile).toMatchObject({ id: "custom", name: "Studio Portrait", digest: STUDIO });
  });

  it("records a DNG's camera and embedded profile in the source metadata", () => {
    const meta = metadata(true);
    expect(meta.extra).toMatchObject({ uniqueCameraModel: "Nikon D850", embeddedProfileName: "Adobe Standard", embeddedProfileDigest: EMBEDDED });
    expect(normalizeCameraRawSourceMetadata({ embeddedProfile: { name: "X", digest: "not hex" } }).extra).toBeUndefined();
  });
});

describe("the stored profile library", () => {
  it("reads the localStorage library older builds kept, and drops what storage mangled", () => {
    const legacy = JSON.stringify([{ name: "Studio Portrait", model: "Nikon D850", digest: STUDIO, data: btoa("IIRC") }]);
    expect(parseCameraRawProfiles(legacy)).toEqual([{ entry: library[0], bytes: new Uint8Array([73, 73, 82, 67]) }]);
    const hostile = JSON.stringify([{ name: "x", model: "y", digest: "lower", data: "AAAA" }, { name: 1 }, null, { name: "z", model: "", digest: STUDIO, data: "@@" }]);
    expect(parseCameraRawProfiles(hostile)).toEqual([]);
    expect(parseCameraRawProfiles("{not json")).toEqual([]);
  });

  it("stores each profile under its name, kept unique by digest", () => {
    expect(storedProfileFileName({ name: "Studio: Portrait/1", digest: STUDIO })).toBe("Studio_ Portrait_1 01234567.dcp");
    expect(storedProfileName("Studio_ Portrait_1 01234567.dcp")).toBe("Studio_ Portrait_1");
    expect(storedProfileName(" 01234567.dcp")).toBe("Custom");
  });

  it("scans Adobe's folders: every user profile, only this camera's system ones", async () => {
    const tree: Record<string, { name: string; isDirectory: boolean; isFile: boolean }[]> = {
      "/u": [{ name: "Mine.dcp", isDirectory: false, isFile: true }, { name: ".hidden.dcp", isDirectory: false, isFile: true }],
      "/s": [{ name: "Camera", isDirectory: true, isFile: false }, { name: "Adobe Standard", isDirectory: true, isFile: false }],
      "/s/Camera": [{ name: "Nikon D850", isDirectory: true, isFile: false }],
      "/s/Camera/Nikon D850": [{ name: "Nikon D850 Camera Standard.dcp", isDirectory: false, isFile: true }],
      "/s/Adobe Standard": [
        { name: "Nikon D850 Adobe Standard.dcp", isDirectory: false, isFile: true },
        { name: "Canon EOS R5 Adobe Standard.dcp", isDirectory: false, isFile: true },
      ],
    };
    const reader = { readDir: async (dir: string) => { if (!tree[dir]) throw new Error("ENOENT"); return tree[dir]; } };
    const keys = cameraModelKeys(metadata());
    expect(await collectAdobeProfilePaths("/u", reader, keys, true)).toEqual(["/u/Mine.dcp"]);
    expect(await collectAdobeProfilePaths("/s", reader, keys, false)).toEqual([
      "/s/Camera/Nikon D850/Nikon D850 Camera Standard.dcp", "/s/Adobe Standard/Nikon D850 Adobe Standard.dcp",
    ]);
    expect(await collectAdobeProfilePaths("/missing", reader, keys, false)).toEqual([]);
  });
});

describe("the store's profile library and render preparation", () => {
  /** Chromium/WebKit's per-origin localStorage budget, in UTF-16 characters. */
  const QUOTA = 5_241_856;
  let cells: Map<string, string>;
  beforeEach(() => {
    cells = new Map();
    const used = () => [...cells].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
    (globalThis as { localStorage?: Storage }).localStorage = {
      get length() { return cells.size; }, clear: () => cells.clear(), key: (i: number) => [...cells.keys()][i] ?? null,
      getItem: (k: string) => cells.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (used() - (cells.get(k)?.length ?? 0) + v.length + k.length > QUOTA) throw new DOMException("quota", "QuotaExceededError");
        cells.set(k, v);
      },
      removeItem: (k: string) => { cells.delete(k); },
    } as Storage;
  });

  /** The app-data folder / IndexedDB, surviving "relaunches" (new Stores). */
  function fakeStorage() {
    const files = new Map<string, Uint8Array>();
    return {
      files,
      list: vi.fn(async () => [...files].map(([fileName, bytes]) => ({ fileName, bytes }))),
      put: vi.fn(async (fileName: string, bytes: Uint8Array) => { files.set(fileName, bytes); }),
    };
  }

  /** A .dcp stand-in: its first byte picks the profile, byte 1 its variant. */
  const dcp = (kind: number, variant = 0, size = 2) => {
    const bytes = new Uint8Array(size);
    bytes[0] = kind;
    bytes[1] = variant;
    return bytes;
  };
  const variantDigest = (variant: number) => variant.toString(16).toUpperCase().padStart(32, "0");

  /** An engine client whose parser reports what the first byte selects. */
  function client() {
    const registered = new Set<string>();
    const info = (bytes: Uint8Array) => bytes[0] === 1
      ? JSON.stringify({ name: "Studio Portrait", model: "Nikon D850", digest: STUDIO, embedded: false })
      : bytes[0] === 2
        ? JSON.stringify({ name: "", model: "Nikon D850", digest: EMBEDDED, embedded: true })
        : bytes[0] === 3
          ? JSON.stringify({ name: `Look ${bytes[1]}`, model: "Nikon D850", digest: variantDigest(bytes[1] + 1), embedded: false })
          : JSON.stringify({ error: "not a DNG camera profile (.dcp) or DNG file" });
    return {
      engine: null, onCommit: null, lastBrush: [], onEditError: vi.fn(), registered, refreshFromEngine: vi.fn(),
      onDevelopProfileMissing: null as ((digests: string[]) => void) | null,
      reportMissingDevelopProfiles: vi.fn(),
      developProfileInfo: vi.fn(info),
      registerDevelopProfile: vi.fn((bytes: Uint8Array) => {
        const json = info(bytes);
        const parsed = JSON.parse(json);
        if (parsed.digest) registered.add(parsed.digest);
        return json;
      }),
      developProfileRegistered: vi.fn((digest: string) => registered.has(digest)),
    };
  }

  const hostBytes = (digest: string) =>
    (globalThis as { __monetDevelopProfileBytes?: (digest: string) => Uint8Array | undefined }).__monetDevelopProfileBytes!(digest);

  it("loads a .dcp once, stores it outside localStorage, and refuses a file that isn't one", async () => {
    const storage = fakeStorage();
    const store = new Store(client() as never);
    await store.attachCameraRawProfileStorage(storage);
    expect(() => store.importCameraRawProfile("junk.dcp", new Uint8Array([9]))).toThrow("can't be used as a camera profile: not a DNG camera profile");
    expect(() => store.importCameraRawProfile("photo.dng", new Uint8Array([2]))).toThrow("is a DNG image");
    expect(store.state.cameraRawProfiles).toEqual([]);
    const entry = store.importCameraRawProfile("Studio.dcp", dcp(1));
    expect(entry).toEqual({ name: "Studio Portrait", model: "Nikon D850", digest: STUDIO, origin: "user" });
    expect(store.importCameraRawProfile("Again.dcp", dcp(1))).toBe(entry);
    expect(store.state.cameraRawProfiles).toHaveLength(1);
    expect([...storage.files.keys()]).toEqual(["Studio Portrait 01234567.dcp"]);
    expect(cells.size).toBe(0);
    const next = new Store(client() as never);
    await next.attachCameraRawProfileStorage(storage);
    expect(next.state.cameraRawProfiles).toEqual([entry]);
  });

  it("keeps ten 1.1 MB profiles across a relaunch without touching the other mv.* libraries", async () => {
    cells.set("mv.swatches", JSON.stringify(["#123456"]));
    const storage = fakeStorage();
    const store = new Store(client() as never);
    await store.attachCameraRawProfileStorage(storage);
    for (let i = 0; i < 10; i++) store.importCameraRawProfile(`Look ${i}.dcp`, dcp(3, i, 1_100_000));
    await Promise.all(storage.put.mock.results.map((result) => result.value));
    const next = new Store(client() as never);
    await next.attachCameraRawProfileStorage(storage);
    expect(next.state.cameraRawProfiles.map((entry) => entry.name)).toEqual(Array.from({ length: 10 }, (_, i) => `Look ${i}`));
    expect(hostBytes(variantDigest(10))?.length).toBe(1_100_000);
    // localStorage still has all its room for the other libraries.
    expect([...cells.keys()]).toEqual(["mv.swatches"]);
    expect(() => localStorage.setItem("mv.brushPresets", "x".repeat(4_000_000))).not.toThrow();
  });

  it("moves the library older builds kept in localStorage into the profile storage, once", async () => {
    cells.set(CAMERA_RAW_PROFILES_KEY, JSON.stringify([{ name: "Studio Portrait", model: "Nikon D850", digest: STUDIO, data: btoa("\u0001\u0000") }]));
    cells.set("mv.swatches", "[]");
    const storage = fakeStorage();
    const store = new Store(client() as never);
    await store.attachCameraRawProfileStorage(storage);
    expect(store.state.cameraRawProfiles).toEqual([library[0]]);
    expect([...storage.files.keys()]).toEqual(["Studio Portrait 01234567.dcp"]);
    expect([...cells.keys()]).toEqual(["mv.swatches"]);
    // A failed move keeps the old copy for the next launch.
    cells.set(CAMERA_RAW_PROFILES_KEY, JSON.stringify([{ name: "Studio Portrait", model: "Nikon D850", digest: STUDIO, data: btoa("\u0001\u0000") }]));
    const engine = client();
    const broken = new Store(engine as never);
    await broken.attachCameraRawProfileStorage({ list: async () => [], put: async () => { throw new Error("disk full"); } });
    expect(cells.has(CAMERA_RAW_PROFILES_KEY)).toBe(true);
    expect(engine.onEditError).toHaveBeenCalledWith(expect.stringContaining("disk full"));
    expect(broken.state.cameraRawProfiles).toEqual([library[0]]);
  });

  it("hands the engine a profile's tables once, keyed by digest, and reports a missing one", async () => {
    const engine = client();
    const store = new Store(engine as never);
    await store.attachCameraRawProfileStorage(fakeStorage());
    store.importCameraRawProfile("Studio.dcp", dcp(1));
    const source: CameraRawSource = {
      version: CAMERA_RAW_SOURCE_VERSION, originalName: "a.nef", originalBytes: new Uint8Array([2]),
      metadata: normalizeCameraRawSourceMetadata({ ...metadata(true), uniqueCameraModel: "Nikon D850", embeddedProfile: { name: "Adobe Standard", digest: EMBEDDED }, asShotKelvin: 2850 }),
      recipe: normalizeWorkingRecipe({}),
    };
    (store as unknown as { cameraRawSessions: Map<string, unknown> }).cameraRawSessions.set("s", { state: { source }, working: source.recipe });
    const recipe = normalizeWorkingRecipe({ profile: { id: "custom", name: "Studio Portrait", group: "Custom", amount: 1, digest: STUDIO } });
    const prepared = store.prepareCameraRawProfile(recipe, { sessionId: "s" });
    expect(prepared.missing).toBeNull();
    // Developed at the image's as-shot white, not an assumed 5500 K.
    expect(prepared.recipe.profile).toMatchObject({ id: "custom", digest: STUDIO, asShotKelvin: 2850 });
    expect(workingRecipeToParams(prepared.recipe).at(-1)).toBe(2850);
    expect(store.prepareCameraRawProfile(recipe, { sessionId: "s" }).missing).toBeNull();
    const withMissingLens = store.prepareCameraRawProfile({ ...recipe, optics: {
      ...recipe.optics, enableProfileCorrections: true, profileName: "Unavailable lens",
    } }, { sessionId: "s" });
    expect(withMissingLens.missing).toBeNull(); // a valid DCP still has a usable Amount control
    expect(withMissingLens.lensWarning).toContain("lens profile");
    expect(engine.registerDevelopProfile).toHaveBeenCalledTimes(1); // re-renders don't re-upload
    // Embedded registers from the RAW's own bytes, under the image's name for it.
    const embedded = store.prepareCameraRawProfile(normalizeWorkingRecipe({ profile: { id: "embedded", name: "Embedded" } }), { sessionId: "s" });
    expect(embedded.recipe.profile).toMatchObject({ id: "embedded", name: "Adobe Standard", digest: EMBEDDED });
    expect(engine.registered.has(EMBEDDED)).toBe(true);
    // An ACR sidecar's "Adobe Standard" (with ACR's own digest) is the DNG's embedded one.
    const acr = normalizeWorkingRecipe({ profile: { id: "custom", name: "Adobe Standard", group: "Custom", amount: 1, digest: "A".repeat(32) } });
    expect(store.prepareCameraRawProfile(acr, { sessionId: "s" })).toMatchObject({
      missing: null, recipe: { profile: { id: "embedded", name: "Adobe Standard", digest: EMBEDDED } },
    });
    // Missing: the recipe keeps its selection (it renders as Camera Default).
    const gone = normalizeWorkingRecipe({ profile: { id: "custom", name: "Gone", group: "Custom", amount: 1, digest: "C".repeat(32) } });
    const result = store.prepareCameraRawProfile(gone, { sessionId: "s" });
    expect(result.recipe).toBe(gone);
    expect(result.missing).toContain("“Gone” isn't installed");
    // A Camera Raw Filter on pixels has no camera: no DCP profile renders there.
    expect(store.prepareCameraRawProfile(recipe, { documentId: 99, layerId: 1 }).missing).toContain("not this image's camera — showing Camera Default");
  });

  it("rehydrates each target's decoder basis after syncing a profile and refuses source-free matrix-only looks", async () => {
    const engine = client();
    const store = new Store(engine as never);
    await store.attachCameraRawProfileStorage(fakeStorage());
    store.importCameraRawProfile("Studio.dcp", dcp(1));
    const recipe = normalizeWorkingRecipe({ profile: { id: "custom", name: "Studio Portrait", group: "Custom", amount: 1, digest: STUDIO } });
    const sessions = (store as unknown as { cameraRawSessions: Map<string, unknown> }).cameraRawSessions;
    for (const [id, gain] of [["A", 1], ["B", 2]] as const) {
      const source: CameraRawSource = {
        version: CAMERA_RAW_SOURCE_VERSION, originalName: `${id}.nef`, originalBytes: dcp(2), recipe,
        metadata: normalizeCameraRawSourceMetadata({ ...metadata(), cameraToXyz: [[gain, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]], wbCoefficients: [gain, 1, 1, 1] }),
      };
      sessions.set(id, { state: { source }, working: recipe });
    }
    const a = store.prepareCameraRawProfile(recipe, { sessionId: "A" });
    const b = store.prepareCameraRawProfile(a.recipe, { sessionId: "B" });
    expect(a.recipe.profile.sourceCamera?.cameraToXyz[0]).toBe(1);
    expect(b.recipe.profile.sourceCamera).toEqual({ cameraToXyz: [2, 0, 0, 0, 1, 0, 0, 0, 1], whiteBalance: [2, 1, 1] });
    expect(a.recipe.profile.sourceCamera?.whiteBalance[0]).toBe(1); // donor untouched
    const rgb = store.prepareCameraRawProfile(a.recipe, { documentId: 99, layerId: 1 });
    expect(rgb.recipe.profile.sourceCamera).toBeUndefined();
    expect(rgb.missing).toContain("not this image's camera");
    engine.developProfileInfo.mockImplementation(() => JSON.stringify({ name: "Studio Portrait", model: "Nikon D850", digest: STUDIO,
      forwardMatrix: false, hueSatMap: false, lookTable: false, toneCurve: false, baselineExposureOffset: 0 }));
    const entry = sessions.get("B") as { state: { source: CameraRawSource } };
    entry.state.source.metadata = metadata();
    expect(store.prepareCameraRawProfile(a.recipe, { sessionId: "B" }).missing).toContain("original three-channel RAW camera data");
  });

  it("gives the engine back any profile it names — library or embedded — and says when nobody has it", async () => {
    const engine = client();
    const store = new Store(engine as never);
    await store.attachCameraRawProfileStorage(fakeStorage());
    store.importCameraRawProfile("Studio.dcp", dcp(1));
    const source: CameraRawSource = {
      version: CAMERA_RAW_SOURCE_VERSION, originalName: "a.dng", originalBytes: new Uint8Array([2, 7]), metadata: metadata(true),
      recipe: normalizeWorkingRecipe({ profile: { id: "custom", name: "Gone Look", group: "Custom", amount: 1, digest: "D".repeat(32) } }),
    };
    (store as unknown as { cameraRawSessions: Map<string, unknown> }).cameraRawSessions.set("s", { state: { source }, working: source.recipe });
    expect(hostBytes(STUDIO)).toEqual(dcp(1));
    expect(hostBytes(EMBEDDED)).toEqual(new Uint8Array([2, 7]));
    expect(hostBytes("D".repeat(32))).toBeUndefined();
    // The engine's report of what rendered as Camera Default reaches the user, once.
    engine.onDevelopProfileMissing!(["D".repeat(32), STUDIO]);
    engine.onDevelopProfileMissing!(["D".repeat(32)]);
    await store.cameraRawProfilesReady;
    await Promise.resolve();
    expect(engine.onEditError).toHaveBeenCalledTimes(1);
    expect(engine.onEditError).toHaveBeenCalledWith(expect.stringContaining("“Gone Look” isn't installed, so layers using it show Camera Default"));
  });
});
