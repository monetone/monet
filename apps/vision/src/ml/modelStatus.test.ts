// modelStatus drives every Model Manager status chip and the
// drunet/migan/lama "installed?" gates that decide whether the AI buttons are
// enabled — misreporting it either hides a model the user has, or offers a
// button that then throws. modelSource.test.ts covers the resolution helpers but
// never this function, so all five outcomes are asserted here.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MODEL_REGISTRY, type ModelDef } from "./modelRegistry";

const native = vi.hoisted(() => ({ enabled: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => native.enabled,
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: (...args: unknown[]) => native.invoke(...args),
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/appdata",
  join: async (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
}));

const sha = (c: string) => c.repeat(64);

/** Answer 206 for any URL containing one of `present`, 404 otherwise — the
 *  ranged presence probe filePresent performs. */
function stubPresent(...present: string[]) {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      seen.push(url);
      const ok = present.some((p) => url.includes(p));
      return { ok, status: ok ? 206 : 404, body: null };
    }),
  );
  return seen;
}

const registry = (id: ModelDef["id"]): ModelDef => MODEL_REGISTRY.find((def) => def.id === id)!;

const importable = (files: ModelDef["files"]): ModelDef => ({
  id: "drunet", label: "Denoiser", role: "AI Denoise", bundled: false, license: "BSD-3-Clause", files,
});

describe("modelSource.modelStatus", () => {
  afterEach(() => {
    native.enabled = false;
    native.invoke.mockReset();
    vi.unstubAllGlobals();
  });

  it("reports 'bundled' for a unit that ships in public/models", async () => {
    vi.resetModules();
    stubPresent(); // nothing on disk — bundled must not depend on a probe
    const { modelStatus } = await import("./modelSource");

    await expect(modelStatus(registry("u2netp"))).resolves.toBe("bundled");
  });

  it("reports 'downloaded' for a verified app-data install, ahead of the bundled path", async () => {
    vi.resetModules();
    native.enabled = true;
    native.invoke.mockResolvedValue(true);
    stubPresent();
    const { modelStatus } = await import("./modelSource");

    const def = importable([{ rel: "drunet_color.onnx", sha256: sha("a"), bytes: 10 }]);
    await expect(modelStatus(def)).resolves.toBe("downloaded");
    expect(native.invoke).toHaveBeenCalledWith("plugin:models|verify_model_unit", {
      files: [{ rel: "drunet_color.onnx", sha256: sha("a"), bytes: 10 }],
    });
  });

  it("reports 'local' for a BYO unit whose files are all served from /models", async () => {
    vi.resetModules();
    stubPresent("/models/drunet_color.onnx");
    const { modelStatus } = await import("./modelSource");

    await expect(modelStatus(importable([{ rel: "drunet_color.onnx", sha256: sha("a"), bytes: 10 }]))).resolves.toBe("local");
  });

  it("reports 'missing' when a multi-file unit is only partially present", async () => {
    vi.resetModules();
    // Only the first of the two files answers — a partial set must never read as
    // installed, or the model loads and fails mid-inference.
    stubPresent("/models/unit/a.onnx");
    const { modelStatus } = await import("./modelSource");

    const def = importable([
      { rel: "unit/a.onnx", sha256: sha("a"), bytes: 10 },
      { rel: "unit/b.onnx", sha256: sha("b"), bytes: 10 },
    ]);
    await expect(modelStatus(def)).resolves.toBe("missing");
  });

  it("reports 'missing' when nothing is present anywhere", async () => {
    vi.resetModules();
    stubPresent();
    const { modelStatus } = await import("./modelSource");

    await expect(modelStatus(registry("lama"))).resolves.toBe("missing");
  });

  it("reports 'local' for sd15 when the real weight set is served", async () => {
    vi.resetModules();
    stubPresent("/models/sd15/");
    const { modelStatus } = await import("./modelSource");

    await expect(modelStatus(registry("sd15"))).resolves.toBe("local");
  });

  it("reports 'demo' for sd15 when only the placeholder core is present", async () => {
    vi.resetModules();
    stubPresent("/models/sd/");
    const { modelStatus } = await import("./modelSource");

    // The real set is absent, so the chip must say "demo" rather than claiming a
    // local install — the placeholder only produces abstract output.
    await expect(modelStatus(registry("sd15"))).resolves.toBe("demo");
  });

  it("reports 'missing' for sd15 when neither weight set is complete", async () => {
    vi.resetModules();
    stubPresent("/models/sd15/unet"); // one file of the core, nothing else
    const { modelStatus } = await import("./modelSource");

    await expect(modelStatus(registry("sd15"))).resolves.toBe("missing");
  });
});
