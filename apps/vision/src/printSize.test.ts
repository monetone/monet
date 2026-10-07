import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildPhotoshopMenus } from "./ui/psMenus";
import { Store } from "./state/store";

/** View ▸ Print Size: CSS defines 96 px per inch, so a document authored at
 *  `ppi` shows at physical size when the canvas is zoomed to 96/ppi. */
const printSizeZoom = (ppi: number) => 96 / ppi;

const storeStub = () =>
  new Store({ engine: {}, e: new Proxy({}, { get: () => () => 0 }), commit: () => true, sync: () => {} } as never);

/** Depth-first walk of the built menu bar. */
function findItem(bar: ReturnType<typeof buildPhotoshopMenus>, label: string) {
  const walk = (items: { label?: unknown; items?: unknown[] }[]): typeof items[number] | undefined => {
    for (const it of items) {
      if (it.label === label) return it;
      const nested = it.items && walk(it.items as typeof items);
      if (nested) return nested;
    }
    return undefined;
  };
  return walk(bar.flatMap((m) => m.items) as never) as
    { label?: unknown; action?: () => void; disabled?: boolean } | undefined;
}

describe("View ▸ Print Size", () => {
  it("is a live menu command, not a disabled placeholder", () => {
    const printsize = vi.fn();
    const item = findItem(buildPhotoshopMenus({ printsize }), "Print Size");
    expect(item).toBeDefined();
    expect(item!.disabled).toBeFalsy();
    item!.action!();
    expect(printsize).toHaveBeenCalledTimes(1);
  });

  it("zooms the real store to physical size from the document PPI", () => {
    const store = storeStub();
    for (const [ppi, zoom] of [[96, 1], [300, 0.32], [72, 4 / 3]] as const) {
      store.setOptions({ resolutionPpi: ppi });
      store.setZoom(printSizeZoom(store.state.resolutionPpi));
      expect(store.state.zoom).toBeCloseTo(zoom, 10);
    }
  });

  it("stays inside the canvas zoom range at absurd resolutions", () => {
    const store = storeStub();
    // 0.0096 and 48 are both outside the viewport's 2%–3200% range; the store
    // clamps rather than handing the engine an unrenderable scale.
    store.setOptions({ resolutionPpi: 10_000 });
    store.setZoom(printSizeZoom(store.state.resolutionPpi));
    expect(store.state.zoom).toBe(0.02);
    store.setOptions({ resolutionPpi: 2 });
    store.setZoom(printSizeZoom(store.state.resolutionPpi));
    expect(store.state.zoom).toBe(32);
  });

  // The command bodies are an object literal inside App.tsx, which cannot be
  // imported here: monet-react is a workspace source dep resolving its own React
  // copy, so mounting the app shell throws "Invalid hook call" under vision's
  // vitest resolution. Everything the command touches is exercised above; this
  // is the remaining binding guard — it is the one thing that says `printsize`
  // divides by the document PPI instead of jumping to a flat 100%.
  it("binds the command to the PPI rule, not a flat 100%", () => {
    const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    expect(app).toContain("printsize: () => store.setZoom(96 / store.state.resolutionPpi)");
    expect(app).not.toContain("printsize: () => store.setZoom(1)");
  });
});
