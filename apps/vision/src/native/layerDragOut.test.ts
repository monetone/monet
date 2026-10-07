import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  enabled: false,
  invoke: vi.fn(),
  tempDir: vi.fn(),
  join: vi.fn(),
  mkdir: vi.fn(),
  remove: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  isTauri: () => native.enabled,
}));
vi.mock("@tauri-apps/api/path", () => ({ tempDir: native.tempDir, join: native.join }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: native.mkdir,
  remove: native.remove,
  writeFile: native.writeFile,
}));

const { beginLayerPngDrag, layerPngFilename } = await import("./layerDragOut");

function transfer(files: File[] = []): DataTransfer {
  return {
    effectAllowed: "uninitialized",
    items: { add: vi.fn((file: File) => { files.push(file); return null; }) },
  } as unknown as DataTransfer;
}

describe("layer PNG drag-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.enabled = false;
    native.invoke.mockResolvedValue(undefined);
    native.tempDir.mockResolvedValue("/tmp");
    native.join.mockImplementation(async (...parts: string[]) => parts.join("/"));
    native.mkdir.mockResolvedValue(undefined);
    native.remove.mockResolvedValue(undefined);
    native.writeFile.mockResolvedValue(undefined);
  });

  it("attaches the exact PNG to a browser drag", async () => {
    const files: File[] = [];
    const dataTransfer = transfer(files);
    const bytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3);

    expect(beginLayerPngDrag(dataTransfer, "Hero / glow", bytes, "")).toBeUndefined();
    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("Hero_glow.png");
    expect(files[0].type).toBe("image/png");
    expect(new Uint8Array(await files[0].arrayBuffer())).toEqual(bytes);
    expect(layerPngFilename("")).toBe("layer.png");
    expect(layerPngFilename("..")).toBe("layer.png");
    expect(layerPngFilename("x".repeat(300))).toHaveLength(244);
  });

  // The receiver may open the pasteboard's file URL well after the gesture
  // ends, so the staged PNG has to outlive the drag session; the NEXT drag
  // sweeps it.
  it("keeps the staged PNG past the drop and sweeps it on the next drag", async () => {
    native.enabled = true;
    const bytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);
    const preview = "data:image/png;base64,iVBORw0KGgo=";

    await beginLayerPngDrag(transfer(), "Hero / glow", bytes, preview);

    const dir = native.mkdir.mock.calls[0][0];
    const path = `${dir}/Hero_glow.png`;
    expect(dir).toMatch(/^\/tmp\/monet-vision-drag-/);
    expect(native.writeFile).toHaveBeenCalledWith(path, bytes, { createNew: true, mode: 0o600 });
    expect(native.invoke).toHaveBeenCalledWith("plugin:drag|start_drag", {
      item: [path],
      image: preview,
      options: { mode: "copy" },
    });
    expect(native.remove).not.toHaveBeenCalled();

    await beginLayerPngDrag(transfer(), "Second", bytes, preview);
    expect(native.remove.mock.calls).toEqual([[path], [dir]]);
    expect(native.mkdir.mock.calls[1][0]).not.toBe(dir);
  });

  it("cleans its temporary file when the native drag cannot start", async () => {
    native.enabled = true;
    native.invoke.mockRejectedValueOnce(new Error("drag unavailable"));

    await expect(beginLayerPngDrag(transfer(), "Layer", Uint8Array.of(1), ""))
      .rejects.toThrow("drag unavailable");

    const dir = native.mkdir.mock.calls[0][0];
    const path = `${dir}/Layer.png`;
    expect(native.invoke).toHaveBeenCalledWith(
      "plugin:drag|start_drag",
      expect.objectContaining({ image: path }),
    );
    // A failed start sweeps its own staging area immediately (the trailing two
    // calls; the leading pair is the previous test's drag being swept).
    expect(native.remove.mock.calls.slice(-2)).toEqual([[path], [dir]]);
  });
});
