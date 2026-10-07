import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { installOpenFilesListener, OPEN_FILES_EVENT, OPEN_FILES_READY_EVENT } from "./openFiles";

// ── Launch hand-off guard ──────────────────────────────────────────────────
// `open -a "Monet Vision" photo.tif`, a Finder double-click, or an argv path
// must land on the photo, not a blank "Untitled". That hand-off spans two
// languages and a Tauri event name, so nothing else can catch a drift:
//   • Rust  — src-tauri/src/main.rs parks the paths (the OS delivers them long
//             before React mounts) and flushes them on the ready handshake.
//   • React — App.tsx listens, replies ready, and funnels the paths to
//             openPaths (which evicts the pristine boot tab).
// A rename on one side alone silently reverts the feature to a blank document,
// and it is native-only, so the browser/e2e build can never exercise it.
//
// If the event names change on purpose, change both sides, then update THIS
// test — don't silence it.

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("Vision opens the file the OS launched it with", () => {
  it("main.rs collects argv + macOS Opened URLs and emits them on the shared event", () => {
    const rs = read("../../src-tauri/src/main.rs");
    expect(rs).toContain(`const EV_OPEN: &str = "${OPEN_FILES_EVENT}"`);
    expect(rs).toContain(`const EV_OPEN_READY: &str = "${OPEN_FILES_READY_EVENT}"`);
    // Both delivery routes must feed the same queue: argv (Linux/Windows) and
    // RunEvent::Opened (macOS `open -a`, Finder, file associations).
    expect(rs).toMatch(/queue_open\(app\.handle\(\), file_args\(std::env::args_os\(\)\.skip\(1\)\)\)/);
    expect(rs).toMatch(/RunEvent::Opened \{ urls \}[\s\S]{0,80}queue_open\(_app, file_urls\(urls\)\)/);
    // The backlog is only drained after the webview says it is listening.
    expect(rs).toMatch(/listen\(EV_OPEN_READY[\s\S]{0,200}flush_open/);
    // A cold launch's files arrive as RunEvent::Opened before setup runs, so
    // the queue is managed on the Builder; managed in setup, Vision panicked
    // on every Finder or droplet launch (#469). The native harness drives both.
    const main = rs.split("fn main()")[1];
    expect(main.indexOf(".manage(PendingOpen::default())")).toBeGreaterThan(-1);
    expect(main.indexOf(".manage(PendingOpen::default())")).toBeLessThan(main.indexOf(".setup("));
    expect(main).not.toMatch(/app\.manage\(PendingOpen/);
  });

  // The droplet app hands over its descriptor with the dropped images, and a
  // native window drop can carry both too; both must reach the droplet check
  // (state/dropletRouting.test.ts) before anything opens (#469). They are
  // native-only, so CI can only read the wiring: scripts/native-webview-e2e.mjs
  // drives the launch hand-off for real (warm and cold), and
  // e2e/droplet-drop.spec.ts drives the browser drop.
  it("App.tsx installs the tested launch listener and routes native window drops the same way", () => {
    const tsx = read("../App.tsx");
    expect(tsx).toContain("installOpenFilesListener(listen, emit, openDroppedPaths)");
    expect(tsx).toContain("onPaths: (paths, point) => { if (isCanvasDrop(point)) void openDroppedPaths(paths); }");
  });

  it("subscribes before ready, opens one non-empty batch, and tears down", async () => {
    const order: string[] = [];
    const unlisten = vi.fn();
    let receive: ((event: { payload?: string[] }) => void) | undefined;
    const listen = vi.fn(async (event: string, handler: typeof receive) => {
      order.push(event);
      receive = handler;
      return unlisten;
    });
    const emit = vi.fn(async (event: string) => { order.push(event); });
    const open = vi.fn();

    const cleanup = await installOpenFilesListener(listen, emit, open);
    expect(order).toEqual([OPEN_FILES_EVENT, OPEN_FILES_READY_EVENT]);
    receive?.({ payload: [] });
    receive?.({ payload: ["/a.tif", "/b.psd"] });
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(["/a.tif", "/b.psd"]);
    cleanup();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("unsubscribes if the ready handshake fails", async () => {
    const unlisten = vi.fn();
    const listen = vi.fn(async () => unlisten);
    const error = new Error("ready failed");
    await expect(installOpenFilesListener(listen, async () => { throw error; }, vi.fn())).rejects.toBe(error);
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("tauri.conf.json claims the file types Vision can open", () => {
    const conf = JSON.parse(read("../../src-tauri/tauri.conf.json"));
    const assoc = conf.bundle.fileAssociations as { ext: string[]; role: string }[];
    const exts: string[] = assoc.flatMap((a) => a.ext);
    // Foreign formats Vision imports, plus its own container.
    for (const ext of ["png", "jpg", "tif", "psd", "cr3", "mvis", "jp2", "jpf", "jpx", "j2k", "j2c", "jpc", "dpx", "sdpx", "cin", "iff", "ilbm", "lbm", "dcm", "dc3", "dic", "dicom", "raw", "rawps"]) {
      expect(exts, `no file association for .${ext}`).toContain(ext);
    }
    // Vision OWNS .mvis and can open every other app's container (design doc
    // 11: dispatch is on the manifest, so any Monet document opens here).
    expect(assoc.find((a) => a.ext.includes("mvis"))?.role).toBe("Editor");
    const viewer = assoc.find((a) => a.role === "Viewer")?.ext ?? [];
    expect(viewer.sort()).toEqual(["mani", "mart", "mcin", "mgal", "mjou", "mryt"]);
  });
});
