import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// VIS-LS-09 last mile: Gradient Overlay's 5 styles / Dither / Align with Layer /
// Offset X/Y all reach the engine through the generic FX_DEFS field controls,
// but the multi-stop ramp itself rides past those slots (see effects.ts) and
// needs its own picker. Source-level wiring check (same idiom as
// ./transformPathWiring.test.ts) that the Blending Options dialog renders a
// GradientBar row for Gradient Overlay wired to store.effectGradientStopsAt /
// store.setEffectGradientStopsAt (one instance of a possibly-stacked effect),
// and keeps `fx` state in sync so a later drag on another field (e.g. Opacity)
// can't clobber the ramp with a stale snapshot.
const dialogsSource = readFileSync(fileURLToPath(new URL("./Dialogs.tsx", import.meta.url)), "utf8");

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `missing anchor: ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("Gradient Overlay stop picker wiring", () => {
  it("renders a GradientBar row for Gradient Overlay inside LayerStyle's effects list", () => {
    const body = section(dialogsSource, "function LayerStyle()", "// ── document browser");
    expect(body).toContain("d.id === FX.GRADIENT_OVERLAY");
    expect(body).toContain("<GradientBar stops={store.effectGradientStopsAt(id, 0)} onChange={(stops) => onGradientStops(d.id, 0, stops)} />");
    expect(body).toContain("<GradientBar stops={store.effectGradientStopsAt(id, idx)} onChange={(stops) => onGradientStops(d.id, idx, stops)} />");
  });

  it("routes GradientBar's onChange through store.setEffectGradientStopsAt, not a local workaround", () => {
    const body = section(dialogsSource, "function LayerStyle()", "// ── document browser");
    const onGradientStops = section(body, "const onGradientStops = (eid: number, idx: number, stops: GradientStop[]) => {", "};");
    // Wrapped in `mutate(...)` so the ramp edit joins the dialog's history
    // transaction, but it is still the store setter and not a local copy.
    expect(onGradientStops).toContain("mutate(() => store.setEffectGradientStopsAt(id, idx, stops))");
    // Re-reads the committed params back into `fx` so patchInstance's next
    // slot-copy (base = list[idx] ?? ...) doesn't overwrite the ramp with stale data.
    expect(onGradientStops).toContain("nextList[idx] = store.effectParamsAt(id, eid, idx);");
  });
});
