// Preferences ▸ Camera Raw ▸ Save settings to a sidecar .xmp when opening
// (#482), and the native opens that read those sidecars: File ▸ Open and a
// Batch over files on disk. Driven through the real app module with Tauri, the
// engine and the disk mocked out.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@engine", () => ({ default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }), Engine: class Engine {} }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null), save: vi.fn(async () => null) }));
const disk = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: vi.fn(async (path: string) => disk.has(path)) }));
vi.mock("./atomicWrite", () => ({ atomicWriteBytes: vi.fn(async (path: string, bytes: Uint8Array) => { disk.set(path, bytes); }) }));
vi.mock("./nativeBoundedRead", () => ({
  readNativeFileBounded: vi.fn(async (path: string) => {
    const bytes = disk.get(path);
    if (!bytes) throw new Error(`${path}: not found`);
    return bytes;
  }),
}));
import { open, save } from "@tauri-apps/plugin-dialog";
import { actions, batchProcess, engine, openPaths, saveCameraRawSidecar, saveCameraRawSidecarOnOpen, store } from "./app";
import { atomicWriteBytes } from "./atomicWrite";
import { parseCameraRawXmp, serializeCameraRawXmp, type CameraRawSidecarSourceSnapshot } from "./cameraRawSidecar";
import { normalizeWorkingRecipe } from "./visionDevelopRecipe";

// What Lightroom Classic writes beside a raw: its own namespaces and crs: fields
// Vision reads (Exposure2012) and fields it doesn't (a lens profile).
const LIGHTROOM = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   xmp:Rating="4"
   crs:Version="15.0"
   crs:Exposure2012="+0.50"
   crs:LensProfileName="Adobe (Nikon NIKKOR Z 24-70mm f/4 S)"/>
 </rdf:RDF>
</x:xmpmeta>
`;
const bytesOf = (text: string) => new TextEncoder().encode(text);
const onEditError = vi.fn();

function source(originalPath?: string): CameraRawSidecarSourceSnapshot {
  const recipe = normalizeWorkingRecipe({});
  recipe.basic.exposure = 1.25;
  return {
    originalName: "a.dng", originalByteLength: 4, sha256: "a".repeat(64), metadata: {},
    recipe, ...(originalPath ? { originalPath } : {}),
  };
}

beforeEach(() => {
  disk.clear();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  engine.onEditError = onEditError;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("saving the settings to a sidecar on open", () => {
  it("never writes over another app's sidecar, and says why", async () => {
    disk.set("/raw/a.xmp", bytesOf(LIGHTROOM));
    expect(await saveCameraRawSidecarOnOpen(source("/raw/a.dng"))).toBe(false);
    expect(atomicWriteBytes).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(disk.get("/raw/a.xmp"))).toBe(LIGHTROOM);
    expect(onEditError).toHaveBeenCalledWith(expect.stringContaining("Left a.xmp as it is: another app wrote it"));
  });

  it("writes a new sidecar, and replaces one Vision wrote in full", async () => {
    expect(await saveCameraRawSidecarOnOpen(source("/raw/a.dng"))).toBe(true);
    expect(parseCameraRawXmp(disk.get("/raw/a.xmp")!)?.recipe.basic.exposure).toBe(1.25);
    const newer = source("/raw/a.dng");
    newer.recipe.basic.exposure = -0.5;
    expect(await saveCameraRawSidecarOnOpen(newer)).toBe(true);
    expect(parseCameraRawXmp(disk.get("/raw/a.xmp")!)?.recipe.basic.exposure).toBe(-0.5);
    expect(onEditError).not.toHaveBeenCalled();
  });

  it("keeps a Vision sidecar another app has added to", async () => {
    const enriched = serializeCameraRawXmp(source()).replace("  </rdf:Description>",
      "   <dc:subject><rdf:Bag><rdf:li>trip</rdf:li></rdf:Bag></dc:subject>\n  </rdf:Description>");
    disk.set("/raw/a.xmp", bytesOf(enriched));
    expect(await saveCameraRawSidecarOnOpen(source("/raw/a.dng"))).toBe(false);
    expect(new TextDecoder().decode(disk.get("/raw/a.xmp"))).toBe(enriched);
  });

  it("does nothing, and never prompts, without a path beside which to write", async () => {
    expect(await saveCameraRawSidecarOnOpen(source())).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(atomicWriteBytes).not.toHaveBeenCalled();
  });
});

describe("saving the settings explicitly (Done / Save Settings / Export XMP)", () => {
  it("never writes over another app's sidecar, and says why", async () => {
    disk.set("/raw/a.xmp", bytesOf(LIGHTROOM));
    // true, not false: the foreign write is skipped but Done still completes.
    expect(await saveCameraRawSidecar(source("/raw/a.dng"))).toBe(true);
    expect(atomicWriteBytes).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(disk.get("/raw/a.xmp"))).toBe(LIGHTROOM);
    expect(onEditError).toHaveBeenCalledWith(expect.stringContaining("Left a.xmp as it is: another app wrote it"));
  });

  it("writes a new sidecar, and replaces one Vision wrote in full", async () => {
    expect(await saveCameraRawSidecar(source("/raw/a.dng"))).toBe(true);
    expect(parseCameraRawXmp(disk.get("/raw/a.xmp")!)?.recipe.basic.exposure).toBe(1.25);
    const newer = source("/raw/a.dng");
    newer.recipe.basic.exposure = -0.5;
    expect(await saveCameraRawSidecar(newer)).toBe(true);
    expect(parseCameraRawXmp(disk.get("/raw/a.xmp")!)?.recipe.basic.exposure).toBe(-0.5);
    expect(onEditError).not.toHaveBeenCalled();
  });

  it("keeps a Vision sidecar another app has added to", async () => {
    const enriched = serializeCameraRawXmp(source()).replace("  </rdf:Description>",
      "   <dc:subject><rdf:Bag><rdf:li>trip</rdf:li></rdf:Bag></dc:subject>\n  </rdf:Description>");
    disk.set("/raw/a.xmp", bytesOf(enriched));
    expect(await saveCameraRawSidecar(source("/raw/a.dng"))).toBe(true);
    expect(new TextDecoder().decode(disk.get("/raw/a.xmp"))).toBe(enriched);
  });
});

describe("native raw opens read the sidecar beside the file", () => {
  const RAW = new Uint8Array([1, 2, 3, 4]);

  it("File ▸ Open applies a Lightroom sidecar's crs: settings", async () => {
    disk.set("/raw/a.dng", RAW);
    disk.set("/raw/a.xmp", bytesOf(LIGHTROOM));
    const openRaw = vi.spyOn(store, "openRaw").mockReturnValue("camera-raw-1");
    vi.spyOn(store, "waitForCameraRawSession").mockResolvedValue("open");
    expect(await openPaths(["/raw/a.dng"])).toEqual([]);
    expect(openRaw).toHaveBeenCalledWith(RAW, "a.dng", expect.objectContaining({
      originalPath: "/raw/a.dng", sidecarPath: "/raw/a.xmp", recipe: expect.objectContaining({ basic: expect.objectContaining({ exposure: 0.5 }) }),
    }));
  });

  it("a Batch over files carries each raw's path and sidecar, so opening it never prompts", async () => {
    disk.set("/raw/a.dng", RAW);
    disk.set("/raw/a.xmp", bytesOf(LIGHTROOM));
    vi.mocked(open).mockResolvedValueOnce(["/raw/a.dng"] as never);
    const openRaw = vi.spyOn(store, "openRaw").mockReturnValue("camera-raw-1");
    vi.spyOn(store, "cameraRawSession").mockReturnValue({ session: { source: { recipe: normalizeWorkingRecipe({}) } } } as never);
    vi.spyOn(store, "completeCameraRawOpen").mockReturnValue(3);
    vi.spyOn(actions, "resolve").mockImplementation((reference) => reference.id ?? null);
    vi.spyOn(actions, "playNamed").mockImplementation(async () => true);
    await batchProcess({ source: "files", actionId: 9, destination: "none", suppressOpenDialogs: true });
    expect(openRaw).toHaveBeenCalledWith(RAW, "a.dng", expect.objectContaining({
      originalPath: "/raw/a.dng", recipe: expect.objectContaining({ basic: expect.objectContaining({ exposure: 0.5 }) }),
    }));
    expect(save).not.toHaveBeenCalled();
  });
});
