import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpServer } from "@monet-ui/monet-mcp";

const app = vi.hoisted(() => ({
  adj: {
    blackWhiteParams: vi.fn(),
    brightnessContrast: vi.fn(),
    exposure: vi.fn(),
    hueSaturation: vi.fn(),
    hueSaturationParams: vi.fn(),
    invert: vi.fn(),
    posterize: vi.fn(),
    threshold: vi.fn(),
    vibrance: vi.fn(),
  },
  fil: {
    box: vi.fn(),
    gaussian: vi.fn(),
    median: vi.fn(),
    sharpen: vi.fn(),
    unsharp: vi.fn(),
  },
  xform: {
    crop: vi.fn(),
    flipH: vi.fn(),
    flipV: vi.fn(),
    resizeImage: vi.fn(),
    rotate180: vi.fn(),
    rotate90: vi.fn(),
  },
  store: {
    state: {
      activeDocId: 11,
      activeLayerId: 22,
      layers: [{ name: "Tagline" }, { name: "Logo" }],
      colorPolicyPrefs: {
        blackPointCompensation: true, desaturateMonitorColors: false, desaturateMonitorAmount: 20,
        blendRgbColorsUsingGamma: false, blendRgbGamma: 1, blendTextColorsUsingGamma: false, blendTextGamma: 1.45,
      } as Record<string, unknown>,
    },
    activeName: vi.fn(() => "logo-smart-contents.mvision"),
    setColorPolicyPrefs: vi.fn((patch: Record<string, unknown>) => {
      app.store.state.colorPolicyPrefs = { ...app.store.state.colorPolicyPrefs, ...patch };
    }),
    addLayer: vi.fn(),
    cameraRawDevelopTarget: vi.fn(() => true),
    cleanupLayers: vi.fn(() => ({ deleted: 1, renamed: 2 })),
    newDocument: vi.fn((_w: number, _h: number, name = "Untitled") => {
      app.store.activeName.mockReturnValueOnce(name);
    }),
    setOptions: vi.fn(),
    setProof: vi.fn(),
    pendingCameraRawSessions: vi.fn(() => []),
    selectCameraRawSession: vi.fn(() => true),
  },
  openPath: vi.fn(async () => {}),
  smart: {
    editContents: vi.fn(() => 33),
    editedContentsBinding: vi.fn(() => ({ editDocId: 11 })),
    updateEditedContents: vi.fn(() => true),
  },
  removeDistractions: vi.fn(),
  removeReflections: vi.fn(),
  splitReflections: vi.fn(),
  engine: {
    e: {
      export_png: vi.fn(() => new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
      layer_kind: vi.fn(() => 0),
      smart_filter_count: vi.fn(() => 0),
      smart_filter_id: vi.fn(() => 0),
    },
    vectorscope: vi.fn(() => new Float32Array([0, 0.5, 1])),
    waveform: vi.fn(() => new Float32Array([0, 0.25, 0.75])),
    waveformRgb: vi.fn(() => new Float32Array([0, 0.1, 0.2, 0.3])),
  },
  ml: {
    selectSubject: vi.fn(async () => ({ ok: true, coverage: 0.42 })),
    removeBackground: vi.fn(async () => ({ ok: true })),
    styleTransfer: vi.fn(async (name: string) => ({ ok: true, w: 10, h: 8, style: name })),
    superResolution: vi.fn(async () => ({ ok: true, inW: 4, inH: 4, outW: 12, outH: 12 })),
    generativeFill: vi.fn(async () => ({ ok: true, w: 10, h: 8, holePx: 5, box: [0, 0, 4, 4] })),
    generativeExpand: vi.fn(async () => ({ ok: true, w: 20, h: 20, holePx: 9, box: [0, 0, 4, 4] })),
    aiDenoise: vi.fn(async () => ({ ok: true, w: 10, h: 8, tiles: 4 })),
    generativeFillPrompt: vi.fn(async () => ({ ok: true, w: 10, h: 8, holePx: 5, box: [0, 0, 4, 4], model: "diffusion" })),
    generateImage: vi.fn(async () => ({ ok: true, w: 12, h: 12 })),
    generateBackground: vi.fn(async () => ({ ok: true, w: 10, h: 8, coverage: 0.3 })),
  },
}));

vi.mock("../state/app", () => app);

import { mcpHandlers, mcpManifest } from "./mcp.generated";
import { defaultRecipe } from "../state/cameraRaw";
import { beginMlJob, cancelMlJob, mlJobCancelled } from "../ml/mlJob";

const handlers = mcpHandlers as Record<string, (args: Record<string, unknown>) => unknown>;

describe("generated MCP handlers", () => {
  it("has one generated handler for every manifest tool", () => {
    expect(Object.keys(handlers).sort()).toEqual(mcpManifest.tools.map((t) => t.name).sort());
    expect(mcpManifest.tools).toHaveLength(90); // +6 automation tools, +1 Black & White adjustment, +1 ML cancellation tool, +9 action authoring (#474), +6 shortcut sets (#483), +1 dock collapse (#479), +1 panel options (#480), +1 Convert to Profile (#437), +1 Camera Raw import options (#443), +1 Color Settings (#438), +2 Smart Object contents (#460), +2 print settings / Print One Copy (#440), +2 Camera Raw profiles (#446), +2 Photoshop Raw open / DICOM series (#466), +2 droplets (#469), +1 float windows (#477), +2 lens profiles (#445)
  });

  it("routes doc.setColorSettings into Color Settings and refuses out-of-range values", () => {
    expect(JSON.parse(handlers["doc.setColorSettings"]({ blackPointCompensation: false, desaturateMonitorColors: 35, blendRgbGamma: 1 }) as string))
      .toEqual({ blackPointCompensation: false, desaturateMonitorColors: 35, blendRgbGamma: 1, blendTextGamma: 0 });
    expect(app.store.setColorPolicyPrefs).toHaveBeenLastCalledWith({
      blackPointCompensation: false, desaturateMonitorColors: true, desaturateMonitorAmount: 35, blendRgbColorsUsingGamma: true, blendRgbGamma: 1,
    });
    // 0 turns an option off and keeps its value for the next time it is on.
    handlers["doc.setColorSettings"]({ blendRgbGamma: 0, blendTextGamma: 1.45 });
    expect(app.store.setColorPolicyPrefs).toHaveBeenLastCalledWith({ blendRgbColorsUsingGamma: false, blendTextColorsUsingGamma: true, blendTextGamma: 1.45 });

    const calls = app.store.setColorPolicyPrefs.mock.calls.length;
    expect(() => handlers["doc.setColorSettings"]({ blendRgbGamma: 0.5 })).toThrow("blendRgbGamma must be 0 (off) or between 1 and 3; got 0.5");
    expect(() => handlers["doc.setColorSettings"]({ desaturateMonitorColors: 150 })).toThrow("desaturateMonitorColors must be 0 (off) or between 0 and 100");
    expect(app.store.setColorPolicyPrefs).toHaveBeenCalledTimes(calls);
  });

  // HANDOFF: an agent must be able to hand a running app a document, not only
  // ask it for a blank one — and a failed open must never read as a success.
  it("routes doc.open through the shared native loader and propagates its errors", async () => {
    const schema = mcpManifest.tools.find((t) => t.name === "doc.open")?.inputSchema;
    expect(schema).toMatchObject({ properties: { path: { type: "string" } }, required: ["path"] });

    await expect(handlers["doc.open"]({ path: "/tmp/Sunset.psd" })).resolves.toBe("Opened /tmp/Sunset.psd");
    expect(app.openPath).toHaveBeenCalledWith("/tmp/Sunset.psd");

    app.openPath.mockRejectedValueOnce(new Error("No such file"));
    await expect(handlers["doc.open"]({ path: "/tmp/nope.psd" })).rejects.toThrow("No such file");
  });

  it("routes document tools through the app action layer", () => {
    expect(mcpManifest.tools.find((t) => t.name === "doc.new")?.description).toContain("new tab");
    expect(mcpManifest.tools.find((t) => t.name === "doc.new")?.description).not.toContain("replacing the current");
    expect(handlers["doc.new"]({ width: 64, height: 48, name: "MCP" })).toBe('Created 64×48 document "MCP"');
    expect(app.store.newDocument).toHaveBeenCalledWith(64, 48, "MCP", "white", 1, {
      resolutionPpi: 72,
      colorMode: 0,
      colorProfile: 0,
    });
    handlers["doc.new"]({ width: 32, height: 24, name: "Adobe", resolutionPpi: 300, colorMode: "rgb", colorProfile: "adobe-rgb" });
    expect(app.store.newDocument).toHaveBeenLastCalledWith(32, 24, "Adobe", "white", 1, {
      resolutionPpi: 300,
      colorMode: 0,
      colorProfile: 2,
    });
    expect(handlers["doc.new"]({ width: 2, height: 1, name: "Print", resolutionPpi: 100, sizeUnit: "in" })).toBe('Created 200×100 document "Print"');
    expect(app.store.newDocument).toHaveBeenLastCalledWith(200, 100, "Print", "white", 1, {
      resolutionPpi: 100,
      colorMode: 0,
      colorProfile: 0,
    });
    expect(handlers["doc.new"]({ width: 10_000, height: 10_000, name: "Bounded" })).toBe('Created 8944×8944 document "Bounded"');
    expect(app.store.newDocument).toHaveBeenLastCalledWith(8_944, 8_944, "Bounded", "white", 1, {
      resolutionPpi: 72,
      colorMode: 0,
      colorProfile: 0,
    });
    expect(handlers["doc.new"]({ width: 100, height: 1, name: "Wide", resolutionPpi: 1_000, sizeUnit: "in" })).toBe('Created 32767×328 document "Wide"');
    expect(app.store.newDocument).toHaveBeenLastCalledWith(32_767, 328, "Wide", "white", 1, {
      resolutionPpi: 1_000,
      colorMode: 0,
      colorProfile: 0,
    });

    expect(handlers["doc.addLayer"]({})).toBe("Added a new layer");
    expect(app.store.addLayer).toHaveBeenCalledTimes(1);

    expect(handlers["doc.exportPngBase64"]({})).toEqual({
      image: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mimeType: "image/png",
    });
    expect(app.engine.e.export_png).toHaveBeenCalledTimes(1);
  });

  it("emits the exported canvas as an MCP image content block", async () => {
    const server = createMcpServer({
      serverInfo: { name: "monet-vision", version: mcpManifest.version },
      tools: mcpManifest.tools,
      handlers: mcpHandlers,
    });
    const response = JSON.parse(await server.handleRaw(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "doc.exportPngBase64", arguments: {} },
    })));

    expect(response.result).toEqual({
      content: [{ type: "image", data: "iVBORw==", mimeType: "image/png" }],
    });
  });

  it("routes adjustment tools with generated argument unpacking", () => {
    expect(handlers["adj.blackWhite"]({
      reds: 100, yellows: 70, greens: 20, cyans: 30, blues: 0, magentas: 90,
      tint: true, tintHue: 42, tintSaturation: 25,
    })).toBe("Applied black & white");
    handlers["adj.brightnessContrast"]({ brightness: 12, contrast: -4 });
    handlers["adj.exposure"]({ exposure: 1.25, offset: 0.1, gamma: 0.9 });
    handlers["adj.hueSaturation"]({
      hue: 10, saturation: 20, lightness: -5, colorize: false,
      ranges: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    });
    handlers["adj.vibrance"]({ vibrance: 30, saturation: 15 });
    handlers["adj.invert"]({});
    handlers["adj.posterize"]({ levels: 8 });
    handlers["adj.threshold"]({ level: 127 });

    expect(app.adj.blackWhiteParams).toHaveBeenCalledWith(Float32Array.from([
      1, 0, 0, 1, 0.7, 0.2, 0.3, 0, 0.9, 1, 42, 0.25,
    ]));
    expect(app.adj.brightnessContrast).toHaveBeenCalledWith(12, -4);
    expect(app.adj.exposure).toHaveBeenCalledWith(1.25, 0.1, 0.9);
    expect(app.adj.hueSaturationParams).toHaveBeenCalledWith(Float32Array.from([
      10, 0.2, -0.05, 0,
      1, 0.02, 0.03, 4, 0.05, 0.06, 7, 0.08, 0.09,
      10, 0.11, 0.12, 13, 0.14, 0.15, 16, 0.17, 0.18,
    ]));
    expect(app.adj.vibrance).toHaveBeenCalledWith(30, 15);
    expect(app.adj.invert).toHaveBeenCalledTimes(1);
    expect(app.adj.posterize).toHaveBeenCalledWith(8);
    expect(app.adj.threshold).toHaveBeenCalledWith(127);
  });

  it("publishes and enforces the expanded adjustment contracts", () => {
    const tools = new Map(mcpManifest.tools.map((tool) => [tool.name, tool.inputSchema]));
    expect(tools.get("adj.hueSaturation")).toMatchObject({
      properties: {
        hue: { minimum: -180, maximum: 360 },
        colorize: { type: "boolean", default: false },
        ranges: { type: "array", items: { type: "number" } },
      },
      required: ["hue", "saturation", "lightness"],
    });
    expect(tools.get("adj.blackWhite")).toMatchObject({
      properties: {
        reds: { minimum: -200, maximum: 300, default: 40 },
        tint: { type: "boolean", default: false },
        tintHue: { minimum: 0, maximum: 360, default: 40 },
      },
    });
    expect(tools.get("adj.blackWhite")?.required).toBeUndefined();

    expect(() => handlers["adj.hueSaturation"]({ hue: 0, saturation: 0, lightness: 0, ranges: [1] }))
      .toThrow("exactly 18 numbers");
    expect(() => handlers["adj.hueSaturation"]({ hue: -1, saturation: 10, lightness: 0, colorize: true }))
      .toThrow("out of bounds");
    expect(() => handlers["adj.hueSaturation"]({ hue: 0, saturation: 101, lightness: 0 }))
      .toThrow("out of bounds");
    expect(() => handlers["adj.blackWhite"]({ reds: Number.POSITIVE_INFINITY }))
      .toThrow("out of bounds");
  });

  it("validates and routes complete Camera Raw recipes", () => {
    const recipe = defaultRecipe();
    recipe.basic.exposure = 1.25;
    const recipeSchema = mcpManifest.tools
      .find((tool) => tool.name === "adj.cameraRawRecipe")
      ?.inputSchema.properties?.recipeJson;
    expect(recipeSchema).toMatchObject({ type: "string", maxLength: 1_048_576 });
    const publishedLimit = recipeSchema?.maxLength;
    expect(publishedLimit).toBe(1_048_576);

    expect(handlers["adj.cameraRawRecipe"]({ recipeJson: JSON.stringify(recipe) })).toBe("Applied Camera Raw recipe");
    expect(app.store.cameraRawDevelopTarget).toHaveBeenCalledWith(
      11,
      22,
      expect.objectContaining({ basic: expect.objectContaining({ exposure: 1.25 }) }),
      undefined,
    );
    expect(() => handlers["adj.cameraRawRecipe"]({ recipeJson: "{" })).toThrow("Camera Raw recipe must be valid JSON");
    // A non-object payload is rejected; the working loader is otherwise lenient
    // (it migrates/clamps any recipe object, incl. a future schemaVersion).
    expect(() => handlers["adj.cameraRawRecipe"]({ recipeJson: "42" })).toThrow("Camera Raw recipe is invalid or unsupported");
    const atLimit = JSON.stringify(recipe).padEnd(publishedLimit!, " ");
    expect(handlers["adj.cameraRawRecipe"]({ recipeJson: atLimit })).toBe("Applied Camera Raw recipe");
    expect(() => handlers["adj.cameraRawRecipe"]({ recipeJson: `${atLimit} ` }))
      .toThrow("Camera Raw recipe JSON exceeds the 1 MiB limit");
    recipe.enhance.superResolution = true;
    expect(() => handlers["adj.cameraRawRecipe"]({ recipeJson: JSON.stringify(recipe) }))
      .toThrow("Camera Raw Super Resolution is only supported while opening a RAW source");
    expect(app.store.cameraRawDevelopTarget).toHaveBeenCalledTimes(2);
  });

  it("routes filter and transform tools with generated argument unpacking", () => {
    handlers["fil.gaussian"]({ radius: 2 });
    handlers["fil.box"]({ radius: 3 });
    handlers["fil.sharpen"]({ amount: 140 });
    handlers["fil.unsharp"]({ radius: 1.5, amount: 180, threshold: 6 });
    handlers["fil.median"]({ radius: 4 });
    handlers["fil.removeDistractions"]({ strength: 0.8 });
    handlers["fil.removeReflections"]({ strength: 0.7 });
    handlers["xform.resizeImage"]({ width: 320, height: 240 });
    handlers["xform.crop"]({ x: 5, y: 6, width: 100, height: 80 });
    handlers["xform.flipHorizontal"]({});
    handlers["xform.flipVertical"]({});
    handlers["xform.rotate90"]({ clockwise: false });
    handlers["xform.rotate180"]({});

    expect(app.fil.gaussian).toHaveBeenCalledWith(2);
    expect(app.fil.box).toHaveBeenCalledWith(3);
    expect(app.fil.sharpen).toHaveBeenCalledWith(140);
    expect(app.fil.unsharp).toHaveBeenCalledWith(1.5, 180, 6);
    expect(app.fil.median).toHaveBeenCalledWith(4);
    expect(app.removeDistractions).toHaveBeenCalledWith(0.8);
    expect(app.removeReflections).toHaveBeenCalledWith(0.7);
    expect(app.xform.resizeImage).toHaveBeenCalledWith(320, 240);
    expect(app.xform.crop).toHaveBeenCalledWith(5, 6, 100, 80);
    expect(app.xform.flipH).toHaveBeenCalledTimes(1);
    expect(app.xform.flipV).toHaveBeenCalledTimes(1);
    expect(app.xform.rotate90).toHaveBeenCalledWith(false);
    expect(app.xform.rotate180).toHaveBeenCalledTimes(1);
  });

  it("routes Smart Object contents editing", () => {
    expect(() => handlers["layer.editSmartObjectContents"]({})).toThrow("not a Smart Object");
    expect(app.smart.editContents).not.toHaveBeenCalled();
    app.engine.e.layer_kind.mockReturnValueOnce(7);
    expect(JSON.parse(handlers["layer.editSmartObjectContents"]({}) as string)).toEqual({
      docId: 33, name: "logo-smart-contents.mvision", layers: ["Tagline", "Logo"],
    });
    expect(handlers["layer.updateSmartObjectContents"]({})).toBe("Updated the Smart Object; document 11 is active");
    expect(app.smart.updateEditedContents).toHaveBeenCalledTimes(1);
    app.smart.editedContentsBinding.mockReturnValueOnce(null as unknown as { editDocId: number });
    expect(() => handlers["layer.updateSmartObjectContents"]({})).toThrow("not Smart Object contents");
    expect(app.smart.updateEditedContents).toHaveBeenCalledTimes(1);
    // A refused commit is an error, not "Updated".
    app.smart.updateEditedContents.mockReturnValueOnce(false);
    expect(() => handlers["layer.updateSmartObjectContents"]({})).toThrow("did not take these contents");
  });

  it("routes layer cleanup and proof tools", () => {
    expect(handlers["layer.cleanup"]({ deleteEmpty: true, autoName: true, onlyGeneric: false })).toBe("Layer cleanup deleted=1 renamed=2");
    expect(app.store.cleanupLayers).toHaveBeenCalledWith({ deleteEmpty: true, autoName: true, onlyGeneric: false });
    expect(handlers["view.setProof"]({ mode: "acescg" })).toBe("Proof mode set to acescg bpc=true");
    expect(app.store.setProof).toHaveBeenCalledWith("acescg", expect.objectContaining({ blackPointCompensation: true }));
    // Black Point Compensation can be turned off through the same tool.
    expect(handlers["view.setProof"]({ mode: "cmyk", bpc: false })).toBe("Proof mode set to cmyk bpc=false");
    expect(app.store.setProof).toHaveBeenCalledWith("cmyk", expect.objectContaining({ blackPointCompensation: false }));
  });

  it("routes scope setter and read-only stats tools", () => {
    expect(handlers["view.setScope"]({ mode: "vectorscope" })).toBe("Scope set to vectorscope");
    expect(app.store.setOptions).toHaveBeenCalledWith({ histScope: "vectorscope" });
    const stats = JSON.parse(handlers["view.scope"]({ kind: "vectorscope" }) as string);
    expect(Object.keys(stats).sort()).toEqual(["cells", "height", "kind", "max", "mean", "nonZero", "width"]);
    expect(app.engine.vectorscope).toHaveBeenCalled();
  });

  it("routes reflection split and Camera Raw filmstrip tools", () => {
    expect(handlers["fil.removeReflections"]({ strength: 0.5, split: true })).toBe("Split reflections strength=0.5");
    expect(app.splitReflections).toHaveBeenCalledWith(0.5);
    expect(handlers["fil.removeReflections"]({ strength: 0.5 })).toBe("Removed reflections strength=0.5");
    expect(app.removeReflections).toHaveBeenCalledWith(0.5);
    expect(handlers["cameraRaw.selectSession"]({ sessionId: "cr-1" })).toContain("cr-1");
    expect(app.store.selectCameraRawSession).toHaveBeenCalledWith("cr-1");
  });
});

// ── ML tools: sync/throw, single-flight job table, weight probe ───────────────

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Stub global fetch for the SD/model presence probe. `decide(url)` returns whether
// the file is present and (for HEAD content-length) its size.
function stubFetch(decide: (url: string) => { present?: boolean; size?: number }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const { present = true, size } = decide(String(url));
    return {
      ok: present,
      status: present ? 200 : 404,
      headers: { get: (h: string) => (h.toLowerCase() === "content-length" && size != null ? String(size) : null) },
      body: { cancel: async () => {} },
    };
  }));
}

describe("ml.* MCP tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("selectSubject returns a coverage string on success and throws on failure", async () => {
    app.ml.selectSubject.mockResolvedValueOnce({ ok: true, coverage: 0.42 });
    await expect(handlers["ml.selectSubject"]({})).resolves.toBe("Selected subject (coverage 42.0%)");
    app.ml.selectSubject.mockResolvedValueOnce({ ok: false, coverage: 0 });
    await expect(handlers["ml.selectSubject"]({})).rejects.toThrow(/Select Subject failed/);
  });

  it("generativeFill propagates the op's own thrown errors (needs a selection)", async () => {
    stubFetch(() => ({ present: true }));
    app.ml.generativeFill.mockRejectedValueOnce(new Error("Make a selection to fill first."));
    await expect(handlers["ml.generativeFill"]({})).rejects.toThrow("Make a selection to fill first.");
  });

  it("generativeFill refuses to run when the local MI-GAN model is absent", async () => {
    stubFetch(() => ({ present: false }));
    await expect(handlers["ml.generativeFill"]({})).rejects.toThrow(/MI-GAN is not installed/);
    expect(app.ml.generativeFill).not.toHaveBeenCalled();
  });

  it("job tools are single-flight: a second start while one runs throws", async () => {
    const d = deferred<{ ok: boolean; w: number; h: number; tiles: number }>();
    app.ml.aiDenoise.mockReturnValueOnce(d.promise);
    const started = JSON.parse(handlers["ml.aiDenoise"]({}) as string);
    expect(started).toMatchObject({ kind: "aiDenoise", poll: "ml.jobStatus" });
    expect(typeof started.jobId).toBe("number");
    expect(() => handlers["ml.aiDenoise"]({})).toThrow(/already running/);
    d.resolve({ ok: true, w: 10, h: 8, tiles: 4 });
    await d.promise;
    await Promise.resolve();
  });

  it("shares one single-flight gate with dialog-started jobs in both directions", async () => {
    const dialogEnd = beginMlJob();
    try {
      expect(() => handlers["ml.aiDenoise"]({})).toThrow(/already running/);
      expect(app.ml.aiDenoise).not.toHaveBeenCalled();
    } finally { dialogEnd(); }

    const d = deferred<{ ok: boolean; w: number; h: number; tiles: number }>();
    app.ml.aiDenoise.mockReturnValueOnce(d.promise);
    handlers["ml.aiDenoise"]({});
    expect(() => beginMlJob()).toThrow(/already running/);
    d.resolve({ ok: true, w: 10, h: 8, tiles: 4 });
    await d.promise;
    await Promise.resolve();
  });

  it("cancels an MCP job through its own tool and releases the shared controller", async () => {
    const d = deferred<{ ok: boolean; w: number; h: number; tiles: number }>();
    app.ml.aiDenoise.mockReturnValueOnce(d.promise);
    const { jobId } = JSON.parse(handlers["ml.aiDenoise"]({}) as string);

    expect(JSON.parse(handlers["ml.jobCancel"]({ jobId }) as string))
      .toEqual({ jobId, state: "cancelling" });
    expect(JSON.parse(handlers["ml.jobStatus"]({ jobId }) as string).state).toBe("cancelling");
    expect(mlJobCancelled()).toBe(true);

    const aborted = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    d.reject(aborted);
    await d.promise.catch(() => {});
    await Promise.resolve();

    expect(JSON.parse(handlers["ml.jobStatus"]({ jobId }) as string).state).toBe("cancelled");
    expect(cancelMlJob()).toBe(false);
    const nextEnd = beginMlJob();
    nextEnd();
  });

  it("jobStatus transitions running → done and returns the op result", async () => {
    const d = deferred<{ ok: boolean; w: number; h: number; tiles: number }>();
    app.ml.aiDenoise.mockReturnValueOnce(d.promise);
    const { jobId } = JSON.parse(handlers["ml.aiDenoise"]({}) as string);
    expect(JSON.parse(handlers["ml.jobStatus"]({ jobId }) as string)).toMatchObject({ state: "running", kind: "aiDenoise" });
    d.resolve({ ok: true, w: 10, h: 8, tiles: 4 });
    await d.promise;
    await Promise.resolve();
    const done = JSON.parse(handlers["ml.jobStatus"]({ jobId }) as string);
    expect(done.state).toBe("done");
    expect(done.result).toEqual({ ok: true, w: 10, h: 8, tiles: 4 });
  });

  it("jobStatus throws for an unknown job id", () => {
    expect(() => handlers["ml.jobStatus"]({ jobId: 999_999 })).toThrow(/No such ML job/);
  });

  it("generateImage requires SD weights and never downgrades when they are missing", async () => {
    stubFetch(() => ({ present: false }));
    await expect(handlers["ml.generateImage"]({ prompt: "a cat", steps: 4 })).rejects.toThrow(/Stable Diffusion weights not installed/);
    expect(app.ml.generateImage).not.toHaveBeenCalled();
  });

  it("generativeFillPrompt throws missing-weights naming MI-GAN, without calling the op", async () => {
    stubFetch((url) => ({ present: !url.includes("vae_encoder") }));
    await expect(handlers["ml.generativeFillPrompt"]({ prompt: "grass", steps: 4 })).rejects.toThrow(/vae_encoder\/model\.onnx[\s\S]*ml\.generativeFill/);
    expect(app.ml.generativeFillPrompt).not.toHaveBeenCalled();
  });

  it("generateImage starts a job when all SD weights are present", async () => {
    stubFetch(() => ({ present: true }));
    const d = deferred<{ ok: boolean; w: number; h: number }>();
    app.ml.generateImage.mockReturnValueOnce(d.promise);
    const started = JSON.parse((await handlers["ml.generateImage"]({ prompt: "sky", steps: 4 })) as string);
    expect(started).toMatchObject({ kind: "generateImage", poll: "ml.jobStatus" });
    expect(app.ml.generateImage).toHaveBeenCalledWith("sky", 4, expect.any(Function));
    d.resolve({ ok: true, w: 512, h: 512 });
    await d.promise;
    await Promise.resolve();
  });

  it("models reports per-feature weight presence and marks absent files present:false", async () => {
    stubFetch((url) => ({ present: !url.includes("/models/sd") }));
    const models = JSON.parse((await handlers["ml.models"]({})) as string) as Array<{
      feature: string; files: { path: string; present: boolean }[]; ready: boolean; note?: string;
    }>;
    const byFeature = Object.fromEntries(models.map((m) => [m.feature, m]));
    expect(byFeature.styles.ready).toBe(true);
    expect(byFeature.styles.files).toHaveLength(5);
    expect(byFeature["sd-core"].ready).toBe(false);
    expect(byFeature["sd-core"].files.every((f) => f.present === false)).toBe(true);
    expect(byFeature["sd-vae_encoder"].files[0]).toEqual({ path: "sd/vae_encoder/model.onnx", present: false });
  });

  it("models flags a complete local demo SD set", async () => {
    stubFetch((url) => ({ present: url.includes("/models/sd/"), size: 8_000_000 }));
    const models = JSON.parse((await handlers["ml.models"]({})) as string) as Array<{ feature: string; note?: string }>;
    expect(models.find((m) => m.feature === "sd-core")!.note).toBe("demo/placeholder weights");
  });
});
