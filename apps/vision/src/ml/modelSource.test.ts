import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelDef } from "./modelRegistry";

const native = vi.hoisted(() => ({ enabled: false, verified: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => native.enabled,
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: (...args: unknown[]) => native.invoke(...args),
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/appdata",
  join: async (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
}));

// Stub fetch so that any URL containing one of `present` substrings answers 206
// (a 1-byte ranged hit), everything else 404. Mirrors the real ranged presence
// probe in modelSource.filePresent.
function stubPresent(...present: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const ok = present.some((p) => url.includes(p));
      return { ok, status: ok ? 206 : 404, body: null };
    }),
  );
}

describe("modelSource — SD weight-set resolution", () => {
  afterEach(() => {
    native.enabled = false;
    native.verified = false;
    native.invoke.mockReset();
    vi.unstubAllGlobals();
  });

  it("hashes an app-data unit once and re-verifies after cache invalidation", async () => {
    vi.resetModules();
    native.enabled = true;
    native.verified = true;
    native.invoke.mockImplementation(async () => native.verified);
    const sha = "a".repeat(64);
    const def: ModelDef = {
      id: "drunet", label: "Test", role: "Test", bundled: false, license: "BSD-3-Clause",
      files: [
        { rel: "unit/a.onnx", url: "https://models.example/a", sha256: sha, bytes: 1 },
        { rel: "unit/b.onnx", url: "https://models.example/b", sha256: sha, bytes: 1 },
      ],
    };
    const { resetModelSourceCache, resolveModelUrl } = await import("./modelSource");
    expect(await resolveModelUrl(def, "unit/a.onnx")).toContain("asset://localhost//appdata/models/unit/a.onnx");
    expect(native.invoke).toHaveBeenCalledWith("plugin:models|verify_model_unit", {
      files: def.files.map(({ rel, sha256, bytes }) => ({ rel, sha256, bytes })),
    });

    native.verified = false;
    expect(await resolveModelUrl(def, "unit/a.onnx")).toContain("asset://localhost//appdata/models/unit/a.onnx");
    expect(native.invoke).toHaveBeenCalledTimes(1);

    resetModelSourceCache();
    expect(await resolveModelUrl(def, "unit/a.onnx")).toBe("/models/unit/a.onnx");
    expect(native.invoke).toHaveBeenCalledTimes(2);
  });

  // verify_model_unit errors for reasons that are NOT "absent": a symlinked
  // models dir (reject_symlink_components), a transient IO error while hashing,
  // an unreadable file. Caching that as "not installed" told the user to import
  // a model they already had — for the whole session, with no refresh path. (#130)
  it("retries verification after a failed probe instead of caching 'not installed'", async () => {
    vi.resetModules();
    native.enabled = true;
    const sha = "a".repeat(64);
    const def: ModelDef = {
      id: "drunet", label: "Test", role: "Test", bundled: false, license: "BSD-3-Clause",
      files: [{ rel: "unit/a.onnx", url: "https://models.example/a", sha256: sha, bytes: 1 }],
    };
    native.invoke.mockRejectedValueOnce(new Error("symlinked models directory"));
    native.invoke.mockResolvedValue(true);
    const { resolveModelUrl } = await import("./modelSource");

    // Could not verify → this probe still answers "not installed" (bundled path)…
    expect(await resolveModelUrl(def, "unit/a.onnx")).toBe("/models/unit/a.onnx");
    // …but the failure is not cached, so the next probe re-verifies and wins.
    expect(await resolveModelUrl(def, "unit/a.onnx")).toContain("asset://localhost//appdata/models/unit/a.onnx");
    expect(native.invoke).toHaveBeenCalledTimes(2);
  });

  it("prefers the real /models/sd15 set when every core file is present", async () => {
    vi.resetModules();
    stubPresent("/models/sd15/");
    const { resolveSdBase } = await import("./modelSource");
    const r = await resolveSdBase(true);
    expect(r.kind).toBe("real");
    expect(r.base).toBe("/models/sd15");
    expect(r.inpaint).toBe(true); // sd15 vae_encoder present
  });

  it("falls back to the demo placeholder when sd15 is incomplete", async () => {
    vi.resetModules();
    // sd15 unet missing → not a complete set; demo present.
    stubPresent("/models/sd/", "/models/sd15/text_encoder", "/models/sd15/tokenizer", "/models/sd15/vae_decoder");
    const { resolveSdBase } = await import("./modelSource");
    const r = await resolveSdBase(true);
    expect(r.kind).toBe("demo");
    expect(r.base).toBe("/models/sd");
  });

  it("sdAvailable reports 'missing' for inpaint when no vae_encoder exists anywhere", async () => {
    vi.resetModules();
    // demo set present but WITHOUT a vae_encoder (today's real state).
    stubPresent("/models/sd/text_encoder", "/models/sd/unet", "/models/sd/vae_decoder", "/models/sd/tokenizer");
    const { sdAvailable } = await import("./modelSource");
    expect(await sdAvailable(false)).toBe("demo"); // generate: demo weights fine
    expect(await sdAvailable(true)).toBe("missing"); // inpaint: no vae_encoder → downgrade
  });

  it("reports missing when neither real nor demo core weights are complete", async () => {
    vi.resetModules();
    stubPresent();
    const { resolveSdBase, sdAvailable } = await import("./modelSource");
    expect((await resolveSdBase()).kind).toBe("missing");
    expect(await sdAvailable(false)).toBe("missing");
  });

  it("sdAvailable reports 'real' with the full sd15 set", async () => {
    vi.resetModules();
    stubPresent("/models/sd15/");
    const { sdAvailable } = await import("./modelSource");
    expect(await sdAvailable(false)).toBe("real");
    expect(await sdAvailable(true)).toBe("real");
  });

  it("webgpuAvailable is true when an adapter is returned", async () => {
    vi.resetModules();
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => ({}) } });
    const { webgpuAvailable } = await import("./modelSource");
    expect(await webgpuAvailable(true)).toBe(true);
  });

  it("webgpuAvailable is false when navigator.gpu is absent (no adapter)", async () => {
    vi.resetModules();
    vi.stubGlobal("navigator", {});
    const { webgpuAvailable } = await import("./modelSource");
    expect(await webgpuAvailable(true)).toBe(false);
  });

  it("webgpuAvailable is false when requestAdapter returns null", async () => {
    vi.resetModules();
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => null } });
    const { webgpuAvailable } = await import("./modelSource");
    expect(await webgpuAvailable(true)).toBe(false);
  });
});

describe("modelSource — quality-tier selection", () => {
  const base: ModelDef = {
    id: "drunet", label: "Base", role: "", bundled: false, license: "BSD-3-Clause",
    files: [{ rel: "drunet_color.onnx", sha256: "a".repeat(64), bytes: 1 }],
  };
  const alt: ModelDef = {
    id: "drunet", label: "HQ", role: "", bundled: false, license: "MIT", qualityTierFor: "drunet",
    files: [{ rel: "denoise_hq.onnx", sha256: "b".repeat(64), bytes: 1 }],
  };

  it("pickTierUnit prefers an installed alternate, else the base", async () => {
    const { pickTierUnit } = await import("./modelSource");
    expect(pickTierUnit(base, alt, true)).toBe(alt); // alt installed → HQ tier
    expect(pickTierUnit(base, alt, false)).toBe(base); // alt not installed → base
    expect(pickTierUnit(base, undefined, true)).toBe(base); // no alt registered → base
  });

  it("bestUnit falls back to the base unit when no quality-tier alternate is registered", async () => {
    vi.resetModules();
    const { bestUnit } = await import("./modelSource");
    const u = await bestUnit("drunet"); // no registry row has qualityTierFor === "drunet" yet
    expect(u.id).toBe("drunet");
    expect(u.qualityTierFor).toBeUndefined(); // it's the base row, not an alternate
    expect(u.files[0].rel).toBe("drunet_color.onnx");
  });
});
