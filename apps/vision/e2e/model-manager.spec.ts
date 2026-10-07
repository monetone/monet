import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Model Manager + no-silent-downgrade (plan 02 Phase 3) ──────────
// The Model Manager shows every registry model's status; NeuralAI refuses to
// silently downgrade a prompted fill. The real SD-1.5 weights are gitignored, so
// CI probes "demo"/"missing" while a dev machine with them built probes "real" —
// every assertion here is driven by the actual sdAvailable() probe so it passes
// in both environments.

async function openNeuralAI(page: import("@playwright/test").Page) {
  // Same pattern as ml-menu.spec: wait for the menu tree to sync, then dispatch
  // the Filter ▸ Neural Filters ▸ "AI Neural Filters" leaf by the id the tree
  // assigns it (the built node id — not necessarily the raw blueprint monetId).
  await page.waitForFunction(() => (window as any).__mv?.macMenu?.currentMenuTree?.().length === 8);
  const id = await page.evaluate(() => {
    const out: { id: string; text: string }[] = [];
    const walk = (n: any) => {
      if (n.kind === "submenu") n.items.forEach(walk);
      else if (n.kind === "item") out.push({ id: n.id, text: n.text });
    };
    (window as any).__mv.macMenu.currentMenuTree().forEach(walk);
    return out.find((i) => /AI Neural Filters/i.test(i.text))?.id;
  });
  expect(id, "Filter ▸ Neural Filters ▸ AI Neural Filters menu leaf").toBeTruthy();
  await page.evaluate((mid) => (window as any).__mv.macMenu.dispatchMenuAction(mid), id);
  await expect(page.getByPlaceholder(/Describe what to fill the selection with/i)).toBeVisible();
}

test("Model Manager distinguishes bundled models from probed local-only models", async ({ page }) => {
  await gotoApp(page);
  const [sdReal, drunet, migan] = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    return [await mv.models.sdStatus(false), await mv.models.drunetInstalled(), await mv.models.miganInstalled()] as const;
  });

  await openNeuralAI(page);
  await page.getByRole("button", { name: "Manage AI Models…" }).first().click();

  // The chips are unique to the Model Manager, so the first one appearing is our
  // "dialog is open" signal (the title "AI Models" also appears in a first-run toast).
  await expect(page.locator('[data-testid="model-u2netp-status"]')).toBeVisible();

  // Always-bundled models.
  for (const id of ["styles", "u2netp", "super-res"]) {
    await expect(page.locator(`[data-testid="model-${id}-status"]`)).toHaveText("Bundled");
  }
  await expect(page.locator('[data-testid="model-migan-status"]'))
    .toHaveText(migan ? "Installed (local)" : "Not shipped");
  // Optional models reflect the probe (real weights present locally, absent in CI).
  await expect(page.locator('[data-testid="model-sd15-status"]'))
    .toHaveText(sdReal === "real" ? "Installed (local)" : sdReal === "demo" ? "Local demo" : "Not installed");
  await expect(page.locator('[data-testid="model-drunet-status"]'))
    .toHaveText(drunet ? "Installed" : "Not installed");
});

test("NeuralAI shows the no-silent-downgrade notice only when real SD weights are absent", async ({ page }) => {
  await gotoApp(page);
  const [sdInpaint, migan] = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    return [await mv.models.sdStatus(true), await mv.models.miganInstalled()] as const;
  });

  await openNeuralAI(page);
  const fillBox = page.getByPlaceholder(/Describe what to fill the selection with/i);
  await expect(fillBox).toBeVisible();
  await fillBox.fill("a clear blue sky");

  const notice = page.locator('[data-testid="mv-fill-downgrade"]');
  if (sdInpaint === "real") {
    await expect(page.getByRole("button", { name: "Generative Fill (Prompt · Diffusion)" })).toBeVisible();
    await expect(notice).toHaveCount(0);
  } else {
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(sdInpaint === "missing"
      ? migan ? /local MI-GAN model/i : /No redistribution-cleared inpainting model/i
      : /Demo weights/i);
    // The gate always offers a route to the manager and only offers a fallback
    // action when the corresponding local model is actually present.
    await expect(page.getByRole("button", { name: "Manage AI Models…" }).first()).toBeVisible();
    if (sdInpaint === "missing" && !migan)
      await expect(page.getByRole("button", { name: /Fill with local MI-GAN/i })).toHaveCount(0);
  }
});

// ── WebGPU capability gate ─────────────────────────────────────
// The real ~2 GB SD-1.5 weights only run on the WebGPU execution provider (they
// don't fit wasm32's 4 GB heap). navigator.gpu is forced present/absent BEFORE
// the app loads so both cases are deterministic regardless of the headless
// Chromium's native WebGPU support. The warning is additive: it only appears
// when real weights ARE installed but WebGPU is unavailable — so on CI (demo
// weights) it stays hidden in both cases, driven off the live sdStatus probe.

async function forceWebGpu(page: import("@playwright/test").Page, present: boolean) {
  await page.addInitScript((has: boolean) => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: has ? { requestAdapter: async () => ({}) } : undefined,
    });
  }, present);
}

test("WebGPU absent → real SD-1.5 is gated with a warning (demo/CI stays silent)", async ({ page }) => {
  await forceWebGpu(page, false);
  await gotoApp(page);
  const [sdGen, wgpu] = await page.evaluate(async () => {
    const mv = (window as any).__mv;
    return [await mv.models.sdStatus(false), await mv.models.webgpu()] as const;
  });
  expect(wgpu).toBe(false); // the mock took effect before app load

  await openNeuralAI(page);
  const warning = page.locator('[data-testid="mv-webgpu-warning"]');
  if (sdGen === "real") {
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/WebGPU/i);
  } else {
    await expect(warning).toHaveCount(0); // no real weights → nothing to gate
  }
});

test("WebGPU present → no gate warning regardless of weight set", async ({ page }) => {
  await forceWebGpu(page, true);
  await gotoApp(page);
  const wgpu = await page.evaluate(() => (window as any).__mv.models.webgpu());
  expect(wgpu).toBe(true);

  await openNeuralAI(page);
  await expect(page.locator('[data-testid="mv-webgpu-warning"]')).toHaveCount(0);
});

test("NeuralAI exposes the diffusion controls (negative prompt / guidance / seed)", async ({ page }) => {
  await gotoApp(page);
  await openNeuralAI(page);
  // The controls the backend already consumes (diffusion.ts) are now surfaced.
  await expect(page.getByPlaceholder(/Negative prompt — what to avoid/i)).toBeVisible();
  await expect(page.getByText("Guidance", { exact: true })).toBeVisible();
  await expect(page.getByText("Seed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Randomize seed" })).toBeVisible();
});

test("NeuralAI exposes the img2img reference-image control and it is wired", async ({ page }) => {
  await gotoApp(page);
  // The app-level entry the button drives is exposed for scripting/e2e.
  expect(await page.evaluate(() => typeof (window as any).__mv.ml.generateImageReference)).toBe("function");
  await openNeuralAI(page);
  await expect(page.locator("button[data-mv-img2img]")).toBeVisible();
});
