import { beforeEach, describe, expect, it, vi } from "vitest";
import { importModel, modelDownloadReady, modelLocalImportReady, removeModel } from "./modelDownload";
import type { ModelDef } from "./modelRegistry";

const native = vi.hoisted(() => ({
  enabled: false,
  invoke: vi.fn(),
  open: vi.fn(),
  reset: vi.fn(),
  clearSessions: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => native.enabled,
  invoke: (...args: unknown[]) => native.invoke(...args),
  Channel: class<T> {
    constructor(readonly onmessage: (event: T) => void) {}
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => native.open(...args) }));
vi.mock("./modelSource", () => ({ resetModelSourceCache: () => native.reset() }));
vi.mock("./onnx", () => ({ clearSessionCache: () => native.clearSessions() }));

function model(overrides: Partial<ModelDef> = {}): ModelDef {
  return {
    id: "drunet",
    label: "Test model",
    role: "Test",
    bundled: false,
    license: "BSD-3-Clause",
    files: [{ rel: "test.onnx", url: "https://models.example/test.onnx", sha256: "a".repeat(64), bytes: 10 }],
    ...overrides,
  };
}

describe("license acceptance gate", () => {
  const gated = {
    id: "sd15",
    label: "Stable Diffusion 1.5",
    role: "test",
    bundled: false,
    license: "CreativeML OpenRAIL-M",
    licenseAcceptance: { name: "CreativeML Open RAIL-M", textPath: "/licenses/CreativeML-OpenRAIL-M.txt" },
    files: [{ rel: "sd15/unet/model.onnx", url: "https://example.com/x", sha256: "a".repeat(64), bytes: 10 }],
  } as unknown as import("./modelRegistry").ModelDef;

  it("downloads are disabled by the pure-local provisioning policy", async () => {
    const { downloadModel } = await import("./modelDownload");
    await expect(downloadModel(gated)).rejects.toThrow(/downloads are disabled/);
    await expect(downloadModel(gated, undefined, undefined, { licenseAccepted: true }))
      .rejects.toThrow(/downloads are disabled/);
  });

  it("refuses a gated Import without explicit acceptance, before any platform work", async () => {
    const { importModel } = await import("./modelDownload");
    await expect(importModel(gated)).rejects.toThrow(/requires accepting the CreativeML Open RAIL-M license before installation/);
  });

  it("acceptance moves past the Import gate (fails later on the platform check in node)", async () => {
    const { importModel } = await import("./modelDownload");
    await expect(importModel(gated, undefined, undefined, { licenseAccepted: true }))
      .rejects.toThrow(/desktop app/);
  });
});

describe("model download eligibility", () => {
  beforeEach(() => {
    native.enabled = false;
    native.invoke.mockReset();
    native.open.mockReset();
    native.reset.mockReset();
    native.clearSessions.mockReset();
  });

  it("requires a complete HTTPS and SHA-256 pinned unit with an approved license", () => {
    expect(modelDownloadReady(model())).toBe(true);
    expect(modelDownloadReady(model({ files: [{ rel: "test.onnx", sha256: "a".repeat(64), bytes: 10 }] }))).toBe(false);
    expect(modelDownloadReady(model({ files: [{ rel: "test.onnx", url: "http://models.example/test.onnx", sha256: "a".repeat(64), bytes: 10 }] }))).toBe(false);
    expect(modelDownloadReady(model({ files: [{ rel: "test.onnx", url: "https://models.example/test.onnx", sha256: "", bytes: 10 }] }))).toBe(false);
    expect(modelDownloadReady(model({ files: [{ rel: "test.onnx", url: "https://models.example/test.onnx", sha256: "a".repeat(64), bytes: 0 }] }))).toBe(false);
    expect(modelDownloadReady(model({ license: "TBD — verify before enabling" }))).toBe(false);
    expect(modelDownloadReady(model({ files: [
      { rel: "a.onnx", url: "https://models.example/a", sha256: "a".repeat(64), bytes: 10 },
      { rel: "b.onnx", url: "https://models.example/b", sha256: "b".repeat(64), bytes: 10 },
    ] }))).toBe(false);
  });

  it("allows local installation only for non-bundled, licensed, fully pinned artifacts", () => {
    const local = model({ files: [{ rel: "test.onnx", sha256: "a".repeat(64), bytes: 10 }] });
    expect(modelLocalImportReady(local)).toBe(true);
    expect(modelDownloadReady(local)).toBe(false);
    expect(modelLocalImportReady(model({ bundled: true }))).toBe(false);
    expect(modelLocalImportReady(model({ license: "Unverified — not shipped" }))).toBe(false);
    expect(modelLocalImportReady(model({ license: "Unlicensed — local artifact only" }))).toBe(false);
    expect(modelLocalImportReady(model({ files: [{ rel: "test.onnx", sha256: "", bytes: 10 }] }))).toBe(false);
  });

  it("selects a file and sends only its path plus registry metadata to native import", async () => {
    native.enabled = true;
    native.open.mockResolvedValue("/source/drunet_color.onnx");
    native.invoke.mockResolvedValue(undefined);
    const def = model({ files: [{ rel: "drunet_color.onnx", sha256: "a".repeat(64), bytes: 10 }] });

    await expect(importModel(def)).resolves.toBe(true);

    expect(native.open).toHaveBeenCalledWith(expect.objectContaining({
      directory: false,
      multiple: false,
      filters: [{ name: "Test model", extensions: ["onnx"] }],
    }));
    expect(native.invoke).toHaveBeenCalledWith("plugin:models|import_model", expect.objectContaining({
      id: "drunet",
      source: "/source/drunet_color.onnx",
      files: def.files.map(({ rel, sha256, bytes }) => ({ rel, sha256, bytes })),
      onEvent: expect.anything(),
    }));
    expect(native.reset).toHaveBeenCalledOnce();
    expect(native.clearSessions).toHaveBeenCalledOnce();
  });

  it("selects one folder for a multi-file model unit", async () => {
    native.enabled = true;
    native.open.mockResolvedValue("/source/sd15");
    native.invoke.mockResolvedValue(undefined);
    const def = model({
      id: "sd15",
      files: [
        { rel: "sd15/unet/model.onnx", sha256: "a".repeat(64), bytes: 10 },
        { rel: "sd15/tokenizer/vocab.json", sha256: "b".repeat(64), bytes: 20 },
      ],
    });

    await expect(importModel(def)).resolves.toBe(true);

    expect(native.open).toHaveBeenCalledWith(expect.objectContaining({ directory: true, multiple: false }));
    expect(native.invoke).toHaveBeenCalledWith("plugin:models|import_model", expect.objectContaining({
      source: "/source/sd15",
      files: def.files,
    }));
  });

  it("treats closing the picker as a no-op", async () => {
    native.enabled = true;
    native.open.mockResolvedValue(null);

    await expect(importModel(model())).resolves.toBe(false);

    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("removes a multi-file model with one native unit transaction", async () => {
    native.enabled = true;
    native.invoke.mockResolvedValue(undefined);
    const def = model({
      id: "sd15",
      files: [
        { rel: "sd15/unet/model.onnx", url: "https://models.example/unet", sha256: "a".repeat(64), bytes: 10 },
        { rel: "sd15/tokenizer/vocab.json", url: "https://models.example/vocab", sha256: "b".repeat(64), bytes: 20 },
      ],
    });

    await expect(removeModel(def)).resolves.toBeUndefined();

    expect(native.invoke).toHaveBeenCalledOnce();
    expect(native.invoke).toHaveBeenCalledWith("plugin:models|remove_model", {
      id: "sd15",
      files: def.files.map(({ rel, sha256, bytes }) => ({ rel, sha256, bytes })),
    });
    expect(native.reset).toHaveBeenCalledOnce();
    expect(native.clearSessions).toHaveBeenCalledOnce();
  });

  it("invalidates the model-source cache when native removal fails", async () => {
    native.enabled = true;
    native.invoke.mockRejectedValue(new Error("injected remove failure"));

    await expect(removeModel(model())).rejects.toThrow("injected remove failure");

    expect(native.invoke).toHaveBeenCalledOnce();
    expect(native.reset).toHaveBeenCalledOnce();
    expect(native.clearSessions).toHaveBeenCalledOnce();
  });
});
