import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── scripting console runs in an isolated Worker realm ─────────
// The Scripting Console used to `new Function(code)` in the page realm, where a
// pasted script had ambient access to window/document/fetch and could
// `import("@tauri-apps/plugin-fs")` to read/write any file (review Sec C1). It
// now runs in a Worker that has no window/document and no Tauri IPC bridge, and
// the curated `vision` ops are validated + executed on the main thread. These
// tests assert the host realm is unreachable while curated ops still work — and
// would fail against the old in-page implementation.

test("sandboxed scripts cannot reach window or document", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(async () => {
    const mv = (window as unknown as { __mv: any }).__mv;
    // Throws inside the worker if the host realm is visible; runs clean if not.
    const err = await mv.runScript(
      'if (typeof window !== "undefined") throw new Error("window reachable");' +
      'if (typeof document !== "undefined") throw new Error("document reachable");' +
      'if (typeof globalThis.__mv !== "undefined") throw new Error("__mv reachable");' +
      'vision.newDoc(40, 40, "iso");',
    );
    return { err, w: mv.engine.engine.width(), h: mv.engine.engine.height() };
  });
  expect(r.err).toBe(""); // none of the host globals were reachable
  expect(r.w).toBe(40); // the curated op still executed on the main thread
  expect(r.h).toBe(40);
});

test("a script cannot mutate host state outside the curated vision API", async ({ page }) => {
  await gotoApp(page);
  const tampered = await page.evaluate(async () => {
    const mv = (window as unknown as { __mv: any }).__mv;
    // Try to scribble on the host through any global the worker might see.
    await mv.runScript('try { globalThis.__pwned = 1; self.__pwned = 1; } catch {}');
    return (window as unknown as { __pwned?: number }).__pwned ?? null;
  });
  expect(tampered).toBeNull(); // the worker's globalThis is not the page's
});

test("sandboxed scripts have no ambient network or worker escape", async ({ page }) => {
  await gotoApp(page);
  const err = await page.evaluate(async () => {
    const mv = (window as unknown as { __mv: any }).__mv;
    return mv.runScript(`
      for (const name of [
        "fetch", "fetchLater", "XMLHttpRequest", "WebSocket", "WebSocketStream", "EventSource",
        "WebTransport", "RTCPeerConnection", "webkitRTCPeerConnection", "Worker",
        "SharedWorker", "importScripts", "FontFace", "fonts", "caches", "indexedDB",
        "navigator", "location", "BroadcastChannel", "postMessage", "close", "eval",
        "Function", "setTimeout", "setInterval", "onmessage", "addEventListener",
        "removeEventListener", "dispatchEvent", "Notification", "ShadowRealm",
        "webkitRequestFileSystem", "webkitRequestFileSystemSync",
        "webkitResolveLocalFileSystemURL", "webkitResolveLocalFileSystemSyncURL",
        "IdleDetector", "PressureObserver"
      ]) {
        for (let owner = globalThis; owner; owner = Object.getPrototypeOf(owner)) {
          const descriptor = Object.getOwnPropertyDescriptor(owner, name);
          if (descriptor && (descriptor.value !== undefined || descriptor.get || descriptor.set))
            throw new Error(name + " reachable");
        }
      }
      vision.newDoc(41, 42, "network-isolated");
    `);
  });
  expect(err).toBe("");
});

test("scripts cannot recursively invoke the worker handler to reopen dynamic import", async ({ page }) => {
  await gotoApp(page);
  const marker = "/__nested_script_probe__.js";
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes(marker)) requests.push(request.url()); });
  const err = await page.evaluate(async (url) => {
    const mv = (window as unknown as { __mv: any }).__mv;
    return mv.runScript(`
      RegExp.prototype.test = () => false;
      try { onmessage({ data: { code: "im" + "port('${url}')", ops: [] } }); } catch {}
      vision.newDoc(45, 46, "nested-handler-blocked");
    `);
  }, marker);
  await page.waitForTimeout(100);
  expect(err).toBe("");
  expect(requests).toEqual([]);
});

test("scripts exceeding the operation budget replay nothing", async ({ page }) => {
  await gotoApp(page);
  const result = await page.evaluate(async () => {
    const mv = (window as unknown as { __mv: any }).__mv;
    const before = [mv.engine.engine.width(), mv.engine.engine.height()];
    const error = await mv.runScript(`
      for (let i = 0; i < 257; i++) {
        try { vision.newDoc(100 + i, 100 + i, "op-bomb"); } catch {}
      }
    `);
    return { before, after: [mv.engine.engine.width(), mv.engine.engine.height()], error };
  });
  expect(result.error).toBe("Script operation limit exceeded (256)");
  expect(result.after).toEqual(result.before);
});

test("sandboxed scripts cannot navigate or dynamically import", async ({ page }) => {
  await gotoApp(page);
  const marker = "/__script_network_probe__.js";
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes(marker)) requests.push(request.url()); });
  const errors = await page.evaluate(async (url) => {
    const mv = (window as unknown as { __mv: any }).__mv;
    return Promise.all([
      mv.runScript(`import("${url}")`),
      mv.runScript(`eval("im" + "port('${url}')")`),
      mv.runScript(`(()=>{}).constructor("return im" + "port('${url}')")()`),
      mv.runScript(`try { location.href = "${url}" } catch {}`),
    ]);
  }, marker);
  await page.waitForTimeout(100);
  expect(errors[0]).toBe("Dynamic import is not available in scripts");
  expect(errors.slice(1, 3).every(Boolean)).toBe(true);
  expect(errors[3]).toBe("");
  expect(requests).toEqual([]);
});

test("runaway scripts are terminated", async ({ page }) => {
  await gotoApp(page);
  const result = await page.evaluate(async () => {
    const mv = (window as unknown as { __mv: any }).__mv;
    const timeoutError = await mv.runScript("for (;;) {}");
    const nextError = await mv.runScript('vision.newDoc(43, 44, "after-timeout");');
    return { timeoutError, nextError, width: mv.engine.engine.width(), height: mv.engine.engine.height() };
  });
  expect(result).toEqual({
    timeoutError: "Script timed out after 2000 ms",
    nextError: "",
    width: 43,
    height: 44,
  });
});
