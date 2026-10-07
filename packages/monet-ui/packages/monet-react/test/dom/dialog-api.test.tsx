// DOM tests for the native-dialog wrapper (dialog-api.ts).
//
// These run under jsdom, where there is no Tauri webview: `window` has no
// `__TAURI_INTERNALS__`, so `isTauri()` is false and every helper must take its
// graceful-degradation path WITHOUT throwing and WITHOUT importing
// @tauri-apps/plugin-dialog (which isn't resolvable in this environment). We
// assert the documented safe defaults:
//   • openFile / saveFile → null
//   • confirm  / ask      → false
//   • message             → resolves (undefined), no throw
//
// No jest-dom: assertions read the resolved values directly.

import { describe, it, expect, beforeEach } from "vitest";
import { isTauri } from "../../src/chrome.tsx";
import {
  openFile,
  saveFile,
  confirm,
  ask,
  message,
} from "../../src/dialog-api.ts";

// Guard: the whole point of this suite is the OUTSIDE-Tauri path. If jsdom ever
// gained a Tauri internals shim, the graceful-default assertions below would be
// meaningless — so fail loudly instead.
beforeEach(() => {
  expect("__TAURI_INTERNALS__" in window).toBe(false);
  expect(isTauri()).toBe(false);
});

describe("dialog-api (outside Tauri)", () => {
  it("openFile resolves to null (single)", async () => {
    await expect(openFile()).resolves.toBe(null);
    await expect(openFile({ multiple: false })).resolves.toBe(null);
  });

  it("openFile resolves to null (multiple)", async () => {
    // Even with multiple:true the cancelled/unavailable result is null, never
    // an empty array — matching the plugin's own cancel semantics.
    await expect(openFile({ multiple: true })).resolves.toBe(null);
  });

  it("saveFile resolves to null", async () => {
    await expect(saveFile()).resolves.toBe(null);
    await expect(
      saveFile({ defaultPath: "untitled.txt" }),
    ).resolves.toBe(null);
  });

  it("confirm resolves to false", async () => {
    await expect(confirm("Delete everything?")).resolves.toBe(false);
    await expect(
      confirm("Delete everything?", { kind: "warning" }),
    ).resolves.toBe(false);
  });

  it("ask resolves to false", async () => {
    await expect(ask("Are you sure?")).resolves.toBe(false);
    await expect(
      ask("Are you sure?", { title: "Monet", kind: "warning" }),
    ).resolves.toBe(false);
  });

  it("message resolves without throwing (no-op)", async () => {
    await expect(message("Saved!")).resolves.toBeUndefined();
    await expect(
      message("Something failed", { kind: "error" }),
    ).resolves.toBeUndefined();
  });

  it("does not throw when passed rich options", async () => {
    await expect(
      openFile({
        title: "Open image",
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpeg"] }],
      }),
    ).resolves.toBe(null);
    await expect(
      saveFile({
        title: "Save image",
        filters: [{ name: "Images", extensions: ["png"] }],
      }),
    ).resolves.toBe(null);
  });
});
