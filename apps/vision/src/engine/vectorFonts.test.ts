import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectFontFilePaths,
  createVectorFontProvisioner,
  fontFamilyNames,
  fontSearchRoots,
  isSupportedFontFile,
  provisionSystemVectorFonts,
  provisionCssFontFaces,
  readVariationAxes,
  shouldRegisterFace,
  targetFontFamilies,
  vectorFontStacksFromSceneJson,
  type VectorFontFaceInfo,
} from "./vectorFonts";

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  readDir: vi.fn(),
  readFile: vi.fn(),
  join: vi.fn(async (...parts: string[]) => parts.join("/").replace(/\/+/g, "/")),
  homeDir: vi.fn(async () => null as string | null),
  fontDir: vi.fn(async () => null as string | null),
}));

it("loads unique local-face aliases before exposing same-weight subfamilies to CSS", async () => {
  const constructors: unknown[][] = [];
  const loaded: string[] = [];
  const added: string[] = [];
  class LocalFace {
    constructor(readonly family: string, source: string, descriptors: unknown) { constructors.push([family, source, descriptors]); }
    async load() { loaded.push(this.family); return this; }
  }
  vi.stubGlobal("FontFace", LocalFace);
  vi.stubGlobal("document", { fonts: { add: (face: LocalFace) => { expect(loaded).toContain(face.family); added.push(face.family); } } });
  try {
    await provisionCssFontFaces([
      { family: "Same Weight", postscriptName: "SameWeightBold", fullName: "Same Weight Bold", weight: 700, italic: false, faceIndex: 0 },
      { family: "Same Weight", postscriptName: "SameWeightCondensed", fullName: "Same Weight Condensed", weight: 700, italic: false, faceIndex: 1 },
    ]);
    // FontFace takes the family literally (WebKit and Chromium), so quotes would
    // become part of the name and the CSS `"Monet face:…"` stack would never match.
    expect(added).toEqual(["Monet face:SameWeightBold", "Monet face:SameWeightCondensed"]);
    expect(constructors[1]).toEqual(["Monet face:SameWeightCondensed", 'local("SameWeightCondensed"), local("Same Weight Condensed")', { weight: "700", style: "normal" }]);
  } finally { vi.unstubAllGlobals(); }
});

vi.mock("@tauri-apps/api/core", () => ({ isTauri: tauriMocks.isTauri }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: tauriMocks.readDir,
  readFile: tauriMocks.readFile,
}));
vi.mock("@tauri-apps/api/path", () => ({
  join: tauriMocks.join,
  homeDir: tauriMocks.homeDir,
  fontDir: tauriMocks.fontDir,
}));

/** A minimal sfnt holding one `fvar` table — enough for readVariationAxes,
 *  which is the only reader here (nothing parses outlines in this test). */
function variableFontBytes(axes: Array<[string, number, number, number]>): Uint8Array {
  const FVAR = 28; // 12-byte offset table + one 16-byte table record
  // The axes array need not follow the header immediately — pad it so the
  // reader has to honour axesArrayOffset rather than assume the usual 16.
  const AXES = 24;
  const bytes = new Uint8Array(FVAR + AXES + axes.length * 20);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, 0x00010000); // sfntVersion
  v.setUint16(4, 1); // numTables
  for (let i = 0; i < 4; i++) v.setUint8(12 + i, "fvar".charCodeAt(i));
  v.setUint32(20, FVAR); // table offset
  v.setUint32(24, bytes.length - FVAR); // table length
  v.setUint16(FVAR, 1); // majorVersion
  v.setUint16(FVAR + 4, AXES); // axesArrayOffset
  v.setUint16(FVAR + 6, 2); // reserved
  v.setUint16(FVAR + 8, axes.length); // axisCount
  v.setUint16(FVAR + 10, 20); // axisSize
  axes.forEach(([tag, min, def, max], i) => {
    const r = FVAR + AXES + i * 20;
    for (let k = 0; k < 4; k++) v.setUint8(r + k, tag.charCodeAt(k));
    v.setInt32(r + 4, min * 65536);
    v.setInt32(r + 8, def * 65536);
    v.setInt32(r + 12, max * 65536);
  });
  return bytes;
}

describe("vector font host provisioning helpers", () => {
  beforeEach(() => {
    tauriMocks.isTauri.mockReturnValue(false);
    tauriMocks.readDir.mockReset();
    tauriMocks.readFile.mockReset();
    tauriMocks.join.mockClear();
    tauriMocks.homeDir.mockClear();
    tauriMocks.fontDir.mockClear();
  });

  it("recognizes TrueType and OpenType font containers", () => {
    expect(isSupportedFontFile("HelveticaNeue.ttc")).toBe(true);
    expect(isSupportedFontFile("Inter.otf")).toBe(true);
    expect(isSupportedFontFile("notes.txt")).toBe(false);
  });

  it("extracts concrete families from CSS stacks", () => {
    expect(fontFamilyNames('"Helvetica Neue", Helvetica, Arial, sans-serif')).toEqual([
      "Helvetica Neue",
      "Helvetica",
      "Arial",
    ]);
  });

  it("treats CSS Fonts 4 generic keywords as generics, not concrete families", () => {
    expect(fontFamilyNames('"My Face", ui-sans-serif, ui-serif, ui-monospace, ui-rounded')).toEqual([
      "My Face",
    ]);
  });

  it("builds platform-specific font search roots", () => {
    expect(fontSearchRoots("MacIntel", "/Users/me", "/Users/me/Library/Fonts")).toEqual([
      "/Users/me/Library/Fonts",
      "/System/Library/Fonts",
      "/Library/Fonts",
    ]);
    expect(fontSearchRoots("Win32", null, null)).toEqual(["C:\\Windows\\Fonts"]);
    expect(fontSearchRoots("Linux x86_64", "/home/me", null)).toContain("/home/me/.local/share/fonts");
  });

  it("matches inspected faces against known vector font stacks", () => {
    const targets = targetFontFamilies(['"Helvetica Neue", Helvetica, Arial, sans-serif']);
    const face: VectorFontFaceInfo = {
      family: "Helvetica Neue",
      faceIndex: 0,
      weight: 400,
      italic: false,
    };
    expect(shouldRegisterFace(face, targets)).toBe(true);
    expect(shouldRegisterFace({ ...face, family: "Bodoni 72" }, targets)).toBe(false);
  });

  it("extracts concrete font stacks from nested vector scene JSON", () => {
    const scene = JSON.stringify({
      layers: [
        {
          items: [
            {
              type: "text",
              fontFamily: '"Document Face", serif',
              runs: [
                { text: "A", fontFamily: "Run Face, sans-serif" },
                { text: "B", fontFamily: "serif" },
              ],
            },
          ],
        },
      ],
    });

    expect(new Set(vectorFontStacksFromSceneJson(scene))).toEqual(new Set([
      '"Document Face", serif',
      "Run Face, sans-serif",
    ]));
    expect(vectorFontStacksFromSceneJson("{")).toEqual([]);
    expect(vectorFontStacksFromSceneJson(JSON.stringify({ fontFamily: "serif" }))).toEqual([]);
  });

  it("collects supported font files deterministically within depth and count limits", async () => {
    const dirs: Record<string, Array<{ name: string; isDirectory: boolean; isFile: boolean }>> = {
      "/Fonts": [
        { name: "B", isDirectory: true, isFile: false },
        { name: "A.otf", isDirectory: false, isFile: true },
        { name: "readme.md", isDirectory: false, isFile: true },
      ],
      "/Fonts/B": [
        { name: "C.ttf", isDirectory: false, isFile: true },
        { name: "D", isDirectory: true, isFile: false },
      ],
      "/Fonts/B/D": [
        { name: "E.ttc", isDirectory: false, isFile: true },
      ],
    };
    const files = await collectFontFilePaths(["/Fonts"], {
      readDir: async (path) => dirs[path] ?? [],
      join: async (...parts) => parts.join("/").replace(/\/+/g, "/"),
    }, { maxDepth: 1, maxFiles: 2 });

    expect(files).toEqual(["/Fonts/A.otf", "/Fonts/B/C.ttf"]);
  });

  it("applies the total-byte cap to inspected files even when faces do not match", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.readDir.mockResolvedValue([
      { name: "A.otf", isDirectory: false, isFile: true },
      { name: "B.otf", isDirectory: false, isFile: true },
      { name: "C.otf", isDirectory: false, isFile: true },
    ]);
    tauriMocks.readFile.mockResolvedValue(new Uint8Array(4));
    const inspectVectorFontFaces = vi.fn(() => JSON.stringify([
      { family: "Unmatched", faceIndex: 0, weight: 400, italic: false },
    ]));
    const registerVectorFontFace = vi.fn();

    const client = {
      engine: {},
      e: { inspectVectorFontFaces, registerVectorFontFace, beginVectorFontBatch: vi.fn(), endVectorFontBatch: vi.fn() },
    } as unknown as Parameters<typeof provisionSystemVectorFonts>[0];

    const summary = await provisionSystemVectorFonts(client, {
      roots: ["/Fonts"],
      targetStacks: ["Arial, sans-serif"],
      maxDepth: 0,
      maxFiles: 3,
      maxFileBytes: 10,
      maxTotalBytes: 8,
    });

    expect(summary.status).toBe("empty");
    expect(summary.scannedFiles).toBe(3);
    expect(tauriMocks.readFile).toHaveBeenCalledTimes(2);
    expect(inspectVectorFontFaces).toHaveBeenCalledTimes(2);
    expect(registerVectorFontFace).not.toHaveBeenCalled();
  });

  it("registers matching inspected faces and notifies once", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    tauriMocks.readDir.mockResolvedValue([
      { name: "Arial.ttf", isDirectory: false, isFile: true },
    ]);
    tauriMocks.readFile.mockResolvedValue(bytes);
    const inspectVectorFontFaces = vi.fn(() => JSON.stringify([
      { family: "Arial", faceIndex: 2, weight: 700, italic: true },
      { family: "Unmatched", faceIndex: 0, weight: 400, italic: false },
    ]));
    const registerVectorFontFace = vi.fn();
    const onFontsChanged = vi.fn();

    const client = {
      engine: {},
      e: { inspectVectorFontFaces, registerVectorFontFace, beginVectorFontBatch: vi.fn(), endVectorFontBatch: vi.fn() },
    } as unknown as Parameters<typeof provisionSystemVectorFonts>[0];

    const summary = await provisionSystemVectorFonts(client, {
      roots: ["/Fonts"],
      targetStacks: ["Arial, sans-serif"],
      maxDepth: 0,
      onFontsChanged,
    });

    expect(summary.status).toBe("registered");
    expect(summary.registeredFaces).toBe(1);
    expect(summary.registeredFamilies).toEqual(["Arial"]);
    expect(summary.discoveredFamilies).toEqual(["Arial", "Unmatched"]);
    expect(registerVectorFontFace).toHaveBeenCalledWith("Arial", bytes, 2, 700, true);
    expect(onFontsChanged).toHaveBeenCalledTimes(1);
  });

  it("provisions the first document after inactive Home with unchanged font targets", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    const bytes = variableFontBytes([["wght", 100, 400, 900]]);
    tauriMocks.readDir.mockResolvedValue([{ name: "Arial.ttf", isDirectory: false, isFile: true }]);
    tauriMocks.readFile.mockResolvedValue(bytes);
    const face = { family: "Arial", faceIndex: 0, weight: 400, italic: false };
    const registerVectorFontFace = vi.fn();
    const onFacesDiscovered = vi.fn();
    const client = {
      engine: null,
      e: {
        inspectVectorFontFaces: vi.fn(() => JSON.stringify([face])),
        registerVectorFontFace, beginVectorFontBatch: vi.fn(), endVectorFontBatch: vi.fn(),
      },
    } as unknown as Parameters<typeof provisionSystemVectorFonts>[0];
    const provision = vi.fn((documentFontStacks: string[]) => provisionSystemVectorFonts(client, {
      roots: ["/Fonts"], targetStacks: ["Arial"], documentFontStacks, onFacesDiscovered,
    }));
    const provisioner = createVectorFontProvisioner({ getDocumentFontStacks: () => [], provision });

    await provisioner(true); // Cold Home has no engine or document font targets.
    expect((await provision.mock.results[0].value).status).toBe("inactive");
    expect(tauriMocks.readDir).not.toHaveBeenCalled();
    (client as unknown as { engine: unknown }).engine = {};
    await provisioner(); // New / flat-image Open still has no document font targets.

    expect(registerVectorFontFace).toHaveBeenCalledWith("Arial", bytes, 0, 400, false);
    expect(onFacesDiscovered).toHaveBeenCalledWith([
      { ...face, axes: [{ tag: "wght", min: 100, def: 400, max: 900 }] },
    ]);
    await provisioner(); // The completed active scan is still deduplicated.
    expect(provision).toHaveBeenCalledTimes(2);
  });

  // #453: the Character panel's variable-font axis sliders need each face's
  // `fvar` ranges. The bytes are already in hand during the scan, so they are
  // read here rather than through the engine's inspect call.
  it("reads a variable face's fvar axes, and nothing from a static font", () => {
    expect(readVariationAxes(variableFontBytes([["wght", 100, 400, 900], ["wdth", 75, 100, 125]]))).toEqual([
      { tag: "wght", min: 100, def: 400, max: 900 },
      { tag: "wdth", min: 75, def: 100, max: 125 },
    ]);
    expect(readVariationAxes(new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toEqual([]);
    // Arbitrary files off the user's disk: a truncated font must not throw.
    expect(readVariationAxes(variableFontBytes([["wght", 100, 400, 900]]).slice(0, 30))).toEqual([]);
    expect(readVariationAxes(new Uint8Array(0))).toEqual([]);
  });

  it("hands every inspected face, with its axes, to the type style picker", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.readDir.mockResolvedValue([{ name: "Variable.ttf", isDirectory: false, isFile: true }]);
    tauriMocks.readFile.mockResolvedValue(variableFontBytes([["wght", 100, 400, 900]]));
    const onFacesDiscovered = vi.fn();
    const client = {
      engine: {},
      e: {
        inspectVectorFontFaces: vi.fn(() => JSON.stringify([
          { family: "Vari", fullName: "Vari Semibold", faceIndex: 0, weight: 600, italic: false },
        ])),
        registerVectorFontFace: vi.fn(), beginVectorFontBatch: vi.fn(), endVectorFontBatch: vi.fn(),
      },
    } as unknown as Parameters<typeof provisionSystemVectorFonts>[0];

    await provisionSystemVectorFonts(client, { roots: ["/Fonts"], targetStacks: [], maxDepth: 0, onFacesDiscovered });

    expect(onFacesDiscovered).toHaveBeenCalledWith([{
      family: "Vari", fullName: "Vari Semibold", faceIndex: 0, weight: 600, italic: false,
      axes: [{ tag: "wght", min: 100, def: 400, max: 900 }],
    }]);
  });

  it("reports every inspected family to the editable-type catalog", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.readDir.mockResolvedValue([{ name: "Faces.otf", isDirectory: false, isFile: true }]);
    tauriMocks.readFile.mockResolvedValue(new Uint8Array([1]));
    const onFamiliesDiscovered = vi.fn();
    const client = {
      engine: {},
      e: {
        inspectVectorFontFaces: vi.fn(() => JSON.stringify([
          { family: "Bodoni 72", faceIndex: 0, weight: 400, italic: false },
          { family: "Arial", faceIndex: 0, weight: 400, italic: false },
        ])),
        registerVectorFontFace: vi.fn(), beginVectorFontBatch: vi.fn(), endVectorFontBatch: vi.fn(),
      },
    } as unknown as Parameters<typeof provisionSystemVectorFonts>[0];

    const summary = await provisionSystemVectorFonts(client, {
      roots: ["/Fonts"], targetStacks: [], maxDepth: 0, onFamiliesDiscovered,
    });

    expect(summary.discoveredFamilies).toEqual(["Arial", "Bodoni 72"]);
    expect(onFamiliesDiscovered).toHaveBeenCalledWith(["Arial", "Bodoni 72"]);
  });

  it("registers inspected faces requested only by document font stacks", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    const bytes = new Uint8Array([4, 3, 2, 1]);
    tauriMocks.readDir.mockResolvedValue([
      { name: "DocumentFace.otf", isDirectory: false, isFile: true },
    ]);
    tauriMocks.readFile.mockResolvedValue(bytes);
    const inspectVectorFontFaces = vi.fn(() => JSON.stringify([
      { family: "Document Face", faceIndex: 0, weight: 400, italic: false },
    ]));
    const registerVectorFontFace = vi.fn();

    const client = {
      engine: {},
      e: { inspectVectorFontFaces, registerVectorFontFace, beginVectorFontBatch: vi.fn(), endVectorFontBatch: vi.fn() },
    } as unknown as Parameters<typeof provisionSystemVectorFonts>[0];

    const summary = await provisionSystemVectorFonts(client, {
      roots: ["/Fonts"],
      targetStacks: [],
      documentFontStacks: ['"Document Face", serif'],
      maxDepth: 0,
    });

    expect(summary.status).toBe("registered");
    expect(summary.registeredFamilies).toEqual(["Document Face"]);
    expect(registerVectorFontFace).toHaveBeenCalledWith("Document Face", bytes, 0, 400, false);
  });

  it("prioritizes document-requested faces over default stacks under the face cap", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    // Arial (a default stack) sorts before ZDoc (the document stack); with a
    // one-face budget the document font must still win over the earlier default.
    const arialBytes = new Uint8Array([1]);
    const docBytes = new Uint8Array([2]);
    tauriMocks.readDir.mockResolvedValue([
      { name: "Arial.ttf", isDirectory: false, isFile: true },
      { name: "ZDoc.ttf", isDirectory: false, isFile: true },
    ]);
    tauriMocks.readFile.mockImplementation(async (path: string) =>
      path.endsWith("ZDoc.ttf") ? docBytes : arialBytes,
    );
    const inspectVectorFontFaces = vi.fn((bytes: Uint8Array) =>
      JSON.stringify([
        bytes[0] === 2
          ? { family: "ZDoc", faceIndex: 0, weight: 400, italic: false }
          : { family: "Arial", faceIndex: 0, weight: 400, italic: false },
      ]),
    );
    const registerVectorFontFace = vi.fn();

    const client = {
      engine: {},
      e: { inspectVectorFontFaces, registerVectorFontFace, beginVectorFontBatch: vi.fn(), endVectorFontBatch: vi.fn() },
    } as unknown as Parameters<typeof provisionSystemVectorFonts>[0];

    const summary = await provisionSystemVectorFonts(client, {
      roots: ["/Fonts"],
      targetStacks: ["Arial, sans-serif"],
      documentFontStacks: ["ZDoc, sans-serif"],
      maxDepth: 0,
      maxRegisteredFaces: 1,
    });

    expect(summary.registeredFaces).toBe(1);
    expect(summary.registeredFamilies).toEqual(["ZDoc"]);
    expect(registerVectorFontFace).toHaveBeenCalledTimes(1);
    expect(registerVectorFontFace).toHaveBeenCalledWith("ZDoc", docBytes, 0, 400, false);
  });

  it("retries unchanged font targets after the engine is torn down mid-read", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.readDir.mockResolvedValue([
      { name: "Arial.ttf", isDirectory: false, isFile: true },
    ]);
    const inspectVectorFontFaces = vi.fn(() =>
      JSON.stringify([{ family: "Arial", faceIndex: 0, weight: 400, italic: false }]),
    );
    const registerVectorFontFace = vi.fn();
    const client = {
      engine: {},
      e: { inspectVectorFontFaces, registerVectorFontFace, beginVectorFontBatch: vi.fn(), endVectorFontBatch: vi.fn() },
    } as unknown as Parameters<typeof provisionSystemVectorFonts>[0];
    // Simulate the open document being torn down during the awaited file read;
    // the scan must not touch the engine afterwards or reject.
    const bytes = new Uint8Array([1, 2, 3, 4]);
    tauriMocks.readFile.mockResolvedValue(bytes).mockImplementationOnce(async () => {
      (client as unknown as { engine: unknown }).engine = null;
      return bytes;
    });

    const provision = vi.fn((documentFontStacks: string[]) => provisionSystemVectorFonts(client, {
      roots: ["/Fonts"],
      targetStacks: ["Arial, sans-serif"],
      documentFontStacks,
      maxDepth: 0,
    }));
    const provisioner = createVectorFontProvisioner({ getDocumentFontStacks: () => [], provision });

    await provisioner(true);
    expect(await provision.mock.results[0].value).toMatchObject({ status: "inactive", scannedFiles: 1 });
    expect(inspectVectorFontFaces).not.toHaveBeenCalled();
    expect(registerVectorFontFace).not.toHaveBeenCalled();

    (client as unknown as { engine: unknown }).engine = {};
    await provisioner(); // New has the same [] targets as the interrupted scan.
    expect(registerVectorFontFace).toHaveBeenCalledWith("Arial", bytes, 0, 400, false);
    await provisioner();
    expect(provision).toHaveBeenCalledTimes(2);
  });

  it("brackets registrations in a font batch so vector layers rerender once", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    tauriMocks.readDir.mockResolvedValue([
      { name: "Arial.ttf", isDirectory: false, isFile: true },
      { name: "Arial2.ttf", isDirectory: false, isFile: true },
    ]);
    tauriMocks.readFile.mockResolvedValue(bytes);
    const inspectVectorFontFaces = vi.fn(() =>
      JSON.stringify([{ family: "Arial", faceIndex: 0, weight: 400, italic: false }]),
    );
    const registerVectorFontFace = vi.fn();
    const beginVectorFontBatch = vi.fn();
    const endVectorFontBatch = vi.fn();
    const client = {
      engine: {},
      e: { inspectVectorFontFaces, registerVectorFontFace, beginVectorFontBatch, endVectorFontBatch },
    } as unknown as Parameters<typeof provisionSystemVectorFonts>[0];

    await provisionSystemVectorFonts(client, {
      roots: ["/Fonts"],
      targetStacks: ["Arial, sans-serif"],
      maxDepth: 0,
    });

    expect(beginVectorFontBatch).toHaveBeenCalledTimes(1);
    expect(endVectorFontBatch).toHaveBeenCalledTimes(1);
    expect(registerVectorFontFace).toHaveBeenCalledTimes(2);
    // The batch opens before any registration and closes after all of them.
    expect(beginVectorFontBatch.mock.invocationCallOrder[0]).toBeLessThan(
      registerVectorFontFace.mock.invocationCallOrder[0],
    );
    expect(endVectorFontBatch.mock.invocationCallOrder[0]).toBeGreaterThan(
      registerVectorFontFace.mock.invocationCallOrder[1],
    );
  });

  it("does not open a font batch when no faces match", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.readDir.mockResolvedValue([{ name: "X.ttf", isDirectory: false, isFile: true }]);
    tauriMocks.readFile.mockResolvedValue(new Uint8Array([1]));
    const beginVectorFontBatch = vi.fn();
    const endVectorFontBatch = vi.fn();
    const client = {
      engine: {},
      e: {
        inspectVectorFontFaces: vi.fn(() =>
          JSON.stringify([{ family: "Unmatched", faceIndex: 0, weight: 400, italic: false }]),
        ),
        registerVectorFontFace: vi.fn(),
        beginVectorFontBatch,
        endVectorFontBatch,
      },
    } as unknown as Parameters<typeof provisionSystemVectorFonts>[0];

    await provisionSystemVectorFonts(client, {
      roots: ["/Fonts"],
      targetStacks: ["Arial, sans-serif"],
      maxDepth: 0,
    });

    expect(beginVectorFontBatch).not.toHaveBeenCalled();
    expect(endVectorFontBatch).not.toHaveBeenCalled();
  });
});

describe("createVectorFontProvisioner", () => {
  it("serializes provisioning so concurrent requests never run overlapping scans", async () => {
    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provision = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await gate;
      active--;
    });

    const provisioner = createVectorFontProvisioner({
      getDocumentFontStacks: () => ["Doc, sans-serif"],
      provision,
    });

    const first = provisioner(true);
    const second = provisioner(true); // arrives while the first scan is in flight
    release();
    await Promise.all([first, second]);

    expect(maxActive).toBe(1);
    expect(provision).toHaveBeenCalledTimes(2);
  });

  it("skips redundant scans when the document font signature is unchanged", async () => {
    const provision = vi.fn(async () => {});
    const provisioner = createVectorFontProvisioner({
      getDocumentFontStacks: () => ["Doc, sans-serif"],
      provision,
    });

    await provisioner(true); // initial forced scan
    await provisioner(); // unchanged, not forced -> skipped
    await provisioner(); // still unchanged -> skipped

    expect(provision).toHaveBeenCalledTimes(1);
  });

  it("rescans when the document font signature changes", async () => {
    let stacks = ["A, sans-serif"];
    const provision = vi.fn(async () => {});
    const provisioner = createVectorFontProvisioner({
      getDocumentFontStacks: () => stacks,
      provision,
    });

    await provisioner(true);
    stacks = ["B, sans-serif"];
    await provisioner();

    expect(provision).toHaveBeenCalledTimes(2);
  });

  it("reports scan failures through onError without poisoning later requests", async () => {
    const onError = vi.fn();
    let stacks = ["A, sans-serif"];
    const provision = vi
      .fn()
      .mockRejectedValueOnce(new Error("scan failed"))
      .mockResolvedValueOnce(undefined);
    const provisioner = createVectorFontProvisioner({
      getDocumentFontStacks: () => stacks,
      provision,
      onError,
    });

    await provisioner(true);
    expect(onError).toHaveBeenCalledTimes(1);
    // The failed scan did not record a signature, so a changed target still runs.
    stacks = ["B, sans-serif"];
    await provisioner();
    expect(provision).toHaveBeenCalledTimes(2);
  });

  it("debounces non-forced requests so a burst triggers one scan", async () => {
    vi.useFakeTimers();
    try {
      const getDocumentFontStacks = vi.fn(() => ["A, sans-serif"]);
      const provision = vi.fn(async () => {});
      const provisioner = createVectorFontProvisioner({
        getDocumentFontStacks,
        provision,
        debounceMs: 100,
      });

      void provisioner();
      void provisioner();
      void provisioner();
      // Still inside the debounce window: no scan and no signature walk yet.
      expect(provision).not.toHaveBeenCalled();
      expect(getDocumentFontStacks).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);
      expect(provision).toHaveBeenCalledTimes(1);
      expect(getDocumentFontStacks).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs forced requests immediately even when debouncing is configured", async () => {
    vi.useFakeTimers();
    try {
      const provision = vi.fn(async () => {});
      const provisioner = createVectorFontProvisioner({
        getDocumentFontStacks: () => ["A, sans-serif"],
        provision,
        debounceMs: 100,
      });

      await provisioner(true);
      expect(provision).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The other half of the seam the "Untitled Font N" defect fell through. The
// engine test `an_apple_shaped_face_reports_the_family_the_host_asks_for`
// (packages/engine/src/lib.rs) pins that the parser reads "Verdana" out of an
// Apple-shaped name table; this pins that such a family is one the provisioner
// actually registers. Both halves passing is what makes a real scan work — the
// defect was that the first half returned "Untitled Font 1", which this side
// could never have caught, because every test here stubs the parser.
describe("a family the parser reports is one the stacks ask for", () => {
  it("registers a face named for a default stack, and skips one that is not", () => {
    const targets = targetFontFamilies();

    expect(shouldRegisterFace(
      { family: "Verdana", faceIndex: 0, weight: 400, italic: false } as VectorFontFaceInfo,
      targets,
    ), "the name the engine reads out of stack_font.ttf").toBe(true);

    expect(shouldRegisterFace(
      { family: "Untitled Font 1", faceIndex: 0, weight: 400, italic: false } as VectorFontFaceInfo,
      targets,
    ), "the name it used to read instead — never registered, so no Style picker").toBe(false);
  });
});
