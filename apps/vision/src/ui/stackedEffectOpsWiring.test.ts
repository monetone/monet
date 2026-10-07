import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Layer effects became a multiset (stacked strokes, layered shadows), but
// `store.setEffect` is still the WHOLE-TYPE op and collapses a stacked type
// down to one instance. Scale Effects and Global Light both walked every
// FX_DEFS entry and called it — so applying either to a layer carrying two
// drop shadows silently destroyed the second one. Both must now read and write
// per instance. This is a data-loss guard, not a style preference.
const storeSource = readFileSync(fileURLToPath(new URL("../state/store.ts", import.meta.url)), "utf8");

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `missing anchor: ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("whole-layer effect ops never collapse a stacked type", () => {
  for (const fn of ["scaleEffects", "setGlobalLight"]) {
    it(`store.${fn} writes per instance, not per type`, () => {
      const body = section(storeSource, `  ${fn}(`, "\n  }");
      expect(body, "must enumerate the instances of each effect type").toContain(
        "this.effectInstanceCount(id, d.id)",
      );
      expect(body, "must read the addressed instance").toContain("this.effectParamsAt(id, d.id, i)");
      expect(body, "must write the addressed instance").toContain("set_layer_effect_at(id, d.id, i,");
      // The whole-type setter is what flattens a stack — it must not appear.
      expect(body, "set_layer_effect would collapse the stack").not.toContain("set_layer_effect(id, d.id");
    });
  }
});
