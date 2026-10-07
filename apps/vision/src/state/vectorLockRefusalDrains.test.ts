// Locking a shape layer used to protect nothing — the Pen and Direct/Path
// Selection tools rewrote its geometry anyway. The engine refuses now and
// reports through `last_edit_error`, which is a channel someone has to drain:
// these store methods return false (or void) on refusal, and an undrained
// message resurfaces on the user's next unrelated commit, blaming the wrong
// action. The drag entry points must also bail BEFORE selecting, or the UI
// shows a grabbed anchor that cannot move.
//
// store.ts pulls the WASM engine, so the wiring is asserted from source (the
// house idiom — see channelPlates.test / spotChannels.test).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");

/** The body of `name(` up to the next doc comment. */
function method(name: string): string {
  const from = store.indexOf(`  ${name}(`);
  expect(from, `missing store method: ${name}`).toBeGreaterThan(0);
  const to = store.indexOf("\n  /**", from);
  return store.slice(from, to > from ? to : from + 1400);
}

describe("a refused vector edit drains its own error", () => {
  // The two drag entry points call vector_begin_edit, which is where the
  // refusal happens; they must not arm a drag afterwards.
  for (const name of ["directSelectAt", "directSelectHandleAt", "pathSelectAt"]) {
    it(`${name} bails before selecting when the layer is locked`, () => {
      const body = method(name);
      expect(body).toContain("vector_begin_edit");
      expect(body, "must drain and bail").toContain("if (this.engine.consumeEditError()) return false;");
      // The drain has to precede the ARMING selection (the last one — an early
      // `this.set({ selected…: null })` is the miss branch), or a locked path
      // reads as grabbed.
      expect(body.indexOf("consumeEditError")).toBeLessThan(body.lastIndexOf("this.set({ selected"));
    });
  }

  // The one-shot ops return false both for an honest miss (no message) and for
  // a locked layer (message). Draining covers the second, no-ops the first.
  for (const [name, call] of [
    ["addAnchorAt", "vector_insert_anchor"],
    ["deleteAnchorAt", "vector_delete_anchor"],
    ["convertPointAt", "vector_convert_anchor"],
  ] as const) {
    it(`${name} drains on a refused ${call}`, () => {
      const body = method(name);
      expect(body).toContain(call);
      expect(body, "a bare `return false` leaks the refusal onto the next commit").toContain(
        "this.engine.consumeEditError()",
      );
    });
  }
});
