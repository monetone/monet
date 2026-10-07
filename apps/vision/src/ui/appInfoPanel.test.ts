import { describe, expect, it, vi } from "vitest";

// The panel reads the live engine version through state/app; stub it so the
// test pins both the real version string and the mocked-shell fallback.
const stub = vi.hoisted(() => ({ version: (): string => "1.2.3" }));
vi.mock("../state/app", () => ({ engine: { version: () => stub.version() } }));

// The GitHub link routes through Tauri's opener in the native app and falls
// back to window.open in the browser; both paths are pinned below.
const tauri = vi.hoisted(() => ({ value: false }));
const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => tauri.value }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => { opener.openUrl(url); return Promise.resolve(); },
}));

const { AppInfoPanel } = await import("./AppInfoPanel");
const { VISION_CONTAINER_APP } = await import("../state/nativeIoPolicy");

type El = { type: any; props: Record<string, any> };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  walk(el.props?.children, out);
  return out;
}

describe("AppInfoPanel", () => {
  it("shows the container version, the engine build and the GitHub link", () => {
    stub.version = () => "1.2.3";
    const tree = walk(AppInfoPanel());
    expect(tree.some((e) => e.props.children === "Monet Vision")).toBe(true);
    expect(tree.some((e) => e.props.children === VISION_CONTAINER_APP.version)).toBe(true);
    expect(tree.some((e) => e.props.children === "monet-render-engine 1.2.3 · WebAssembly")).toBe(true);
    expect(tree.find((e) => e.type === "a")!.props.href).toBe("https://github.com/monetone/monet");
  });

  it("opens the GitHub link in a new noopener window instead of navigating", () => {
    stub.version = () => "1.2.3";
    tauri.value = false;
    opener.openUrl.mockClear();
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const link = walk(AppInfoPanel()).find((e) => e.type === "a")!;
    let prevented = false;
    link.props.onClick({ preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true);
    expect(open).toHaveBeenCalledWith("https://github.com/monetone/monet", "_blank", "noopener");
    expect(opener.openUrl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("opens the GitHub link through Tauri's opener in the native app", () => {
    stub.version = () => "1.2.3";
    tauri.value = true;
    opener.openUrl.mockClear();
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const link = walk(AppInfoPanel()).find((e) => e.type === "a")!;
    let prevented = false;
    link.props.onClick({ preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true);
    expect(opener.openUrl).toHaveBeenCalledWith("https://github.com/monetone/monet");
    expect(open).not.toHaveBeenCalled();
    tauri.value = false;
    vi.unstubAllGlobals();
  });

  it("degrades gracefully when the engine is unavailable (mocked shell)", () => {
    stub.version = () => { throw new Error("Engine not ready"); };
    const tree = walk(AppInfoPanel());
    expect(tree.some((e) => e.props.children === "monet-render-engine · WebAssembly")).toBe(true);
  });
});
