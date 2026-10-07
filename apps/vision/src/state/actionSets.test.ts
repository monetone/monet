import { describe, expect, it } from "vitest";
import {
  createActionMeta, defaultActionName, filterActionMetas, findActionRef, markActionPlayed, toggleActionFavorite,
  encodeOpArgs, decodeOpArgs, isSerializableArgs, serializeActionsFile, parseActionsFile,
  MAX_ACTIONS_IMPORT_BYTES, MAX_ACTION_STEPS, MAX_ACTION_TOTAL_STEPS,
  MAX_ACTION_VALUE_DEPTH, MAX_IMPORTED_ACTIONS,
  type PortableAction,
} from "./actionSets";

describe("action set helpers", () => {
  it("generates the next unused action name", () => {
    const existing = [createActionMeta(1, "Action 1", 2), createActionMeta(2, "Action 2", 1)];
    expect(defaultActionName(existing)).toBe("Action 3");
  });

  it("filters by search text and favorites", () => {
    const a = createActionMeta(1, "Web resize", 3);
    const b = { ...createActionMeta(2, "Retouch", 4), favorite: true };
    expect(filterActionMetas([a, b], "ret", false)).toEqual([b]);
    expect(filterActionMetas([a, b], "", true)).toEqual([b]);
  });

  it("toggles favorites and records playback time immutably", () => {
    const a = createActionMeta(1, "Retouch", 4, 10);
    const fav = toggleActionFavorite([a], 1)[0];
    expect(fav.favorite).toBe(true);
    expect(markActionPlayed([fav], 1, 99)[0].lastPlayedAt).toBe(99);
    expect(a.favorite).toBe(false);
  });
});

describe("command-line action references (#468)", () => {
  const list = [
    createActionMeta(1, "Invert", 1, 0, "Default Actions"),
    createActionMeta(2, "Resize", 1, 0, "Web/Export"),
    createActionMeta(3, "Dodge/Burn", 1, 0, "Retouch"),
    createActionMeta(4, "Invert", 1, 0, "Retouch"),
    createActionMeta(5, "Same", 1, 0, "Dup"),
    createActionMeta(6, "Same", 1, 0, "Dup"),
  ];

  it("resolves Set/Name case-insensitively, with a slash in the set or the name", () => {
    expect(findActionRef(list, "default actions/INVERT")?.id).toBe(1);
    expect(findActionRef(list, " Web/Export/Resize ")?.id).toBe(2);
    expect(findActionRef(list, "Retouch/Dodge/Burn")?.id).toBe(3);
    expect(findActionRef(list, "Retouch/Invert")?.id).toBe(4);
  });

  it("accepts a bare name only when one action has it", () => {
    expect(findActionRef(list, "resize")?.id).toBe(2);
    expect(findActionRef(list, "Dodge/Burn")?.id).toBe(3);
  });

  it("returns null for an unknown or ambiguous reference", () => {
    for (const ref of ["Nope/Invert", "Default Actions/Nope", "Invert", "Dup/Same", "Same", ""]) {
      expect(findActionRef(list, ref), ref).toBeNull();
    }
  });
});

describe("portable action serialization", () => {
  const ALLOWED = new Set(["adj.invert", "adj.posterize", "adj.curves", "adj.levelsMulti", "fil.gaussian"]);

  it("round-trips typed-array args byte-exact (u8/f32)", () => {
    const u8 = new Uint8Array([0, 1, 2, 254, 255]);
    const f32 = new Float32Array([0, 0.5, -1.25, 3.14159]);
    const [du8, df32, n, b] = decodeOpArgs(encodeOpArgs([u8, f32, 7, true]));
    expect(du8).toBeInstanceOf(Uint8Array);
    expect(Array.from(du8 as Uint8Array)).toEqual([0, 1, 2, 254, 255]);
    expect(df32).toBeInstanceOf(Float32Array);
    expect(Array.from(df32 as Float32Array)).toEqual([0, 0.5, -1.25, Math.fround(3.14159)]);
    expect(n).toBe(7);
    expect(b).toBe(true);
  });

  it("encodes to JSON-safe {$ta,b64} shape", () => {
    const enc = encodeOpArgs([new Uint8Array([1, 2, 3])]) as { $ta: string; b64: string }[];
    expect(enc[0].$ta).toBe("u8");
    expect(typeof enc[0].b64).toBe("string");
    expect(() => JSON.stringify(enc)).not.toThrow();
  });

  it("classifies serializable vs non-serializable args", () => {
    expect(isSerializableArgs([1, "x", true, null, [1, 2], { a: 1 }, new Uint8Array([1])])).toBe(true);
    expect(isSerializableArgs([() => 0])).toBe(false);
    expect(isSerializableArgs([new Uint16Array([1])])).toBe(false);
    expect(isSerializableArgs([new Map()])).toBe(false);
  });

  it("throws when encoding a non-serializable arg", () => {
    expect(() => encodeOpArgs([() => 0])).toThrow();
  });

  it("round-trips a full actions file", () => {
    const acts: PortableAction[] = [
      { name: "Invert+Posterize", favorite: true, createdAt: 100, steps: [["adj.invert", []], ["adj.posterize", [4]]] },
      { name: "Blur", favorite: false, createdAt: 200, steps: [["fil.gaussian", [3]]] },
    ];
    const json = serializeActionsFile(acts);
    const { actions, rejected } = parseActionsFile(json, ALLOWED);
    expect(rejected).toEqual([]);
    expect(actions.map((a) => a.name)).toEqual(["Invert+Posterize", "Blur"]);
    expect(actions[0].favorite).toBe(true);
    expect(actions[0].createdAt).toBe(100);
    expect(actions[0].steps).toEqual([["adj.invert", []], ["adj.posterize", [4]]]);
  });

  it("round-trips finite numbers and rejects values JSON would coerce", () => {
    const args = [{ values: [-Number.MAX_VALUE, Number.MIN_VALUE] }, Number.MAX_SAFE_INTEGER];
    const acts: PortableAction[] = [{ name: "Finite", favorite: false, createdAt: 0, steps: [["adj.posterize", args]] }];
    expect(parseActionsFile(serializeActionsFile(acts), ALLOWED).actions[0].steps[0][1]).toEqual(args);

    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(isSerializableArgs([value])).toBe(false);
      expect(isSerializableArgs([{ value }])).toBe(false);
      expect(() => serializeActionsFile([{ ...acts[0], steps: [["adj.posterize", [value]]] }])).toThrow();
    }
  });

  it("preserves typed-array steps through a file round-trip (decode at play time)", () => {
    const curve = new Uint8Array(256).map((_, i) => 255 - i);
    const acts: PortableAction[] = [{ name: "Curve", favorite: false, createdAt: 0, steps: [["adj.curves", [curve]]] }];
    const parsed = parseActionsFile(serializeActionsFile(acts), ALLOWED).actions;
    const [decoded] = decodeOpArgs(parsed[0].steps[0][1]);
    expect(Array.from(decoded as Uint8Array)).toEqual(Array.from(curve));
  });

  it("rejects the whole action containing an unknown op but imports siblings", () => {
    const acts: PortableAction[] = [
      { name: "Good", favorite: false, createdAt: 0, steps: [["adj.invert", []]] },
      { name: "Bad", favorite: false, createdAt: 0, steps: [["adj.invert", []], ["engine.raw", []]] },
    ];
    const { actions, rejected } = parseActionsFile(serializeActionsFile(acts), ALLOWED);
    expect(actions.map((a) => a.name)).toEqual(["Good"]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].name).toBe("Bad");
    expect(rejected[0].reason).toContain("engine.raw");
  });

  it("rejects a version > 1 file outright", () => {
    const bad = JSON.stringify({ format: "mvactions", version: 2, app: "x", exportedAt: 0, actions: [{ name: "A", favorite: false, createdAt: 0, steps: [["adj.invert", []]] }] });
    const { actions, rejected } = parseActionsFile(bad, ALLOWED);
    expect(actions).toEqual([]);
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("rejects a wrong-format file outright", () => {
    const bad = JSON.stringify({ format: "psactions", version: 1, actions: [] });
    expect(parseActionsFile(bad, ALLOWED).actions).toEqual([]);
    expect(parseActionsFile(bad, ALLOWED).rejected.length).toBeGreaterThan(0);
  });

  it("treats malformed JSON as zero actions, not a throw", () => {
    expect(() => parseActionsFile("{not json", ALLOWED)).not.toThrow();
    expect(parseActionsFile("{not json", ALLOWED).actions).toEqual([]);
    expect(parseActionsFile(null, ALLOWED).actions).toEqual([]);
  });

  it("enforces file, action-count, and step-count import ceilings", () => {
    const action = (steps: number) => ({
      name: "Bounded",
      favorite: false,
      createdAt: 0,
      steps: Array.from({ length: steps }, () => ["adj.invert", []]),
    });
    const exactActions = JSON.stringify({ format: "mvactions", version: 1, actions: Array.from({ length: MAX_IMPORTED_ACTIONS }, () => action(0)) });
    expect(parseActionsFile(exactActions, ALLOWED).actions).toHaveLength(MAX_IMPORTED_ACTIONS);

    const tooManyActions = JSON.stringify({ format: "mvactions", version: 1, actions: Array.from({ length: MAX_IMPORTED_ACTIONS + 1 }, () => action(0)) });
    expect(parseActionsFile(tooManyActions, ALLOWED).rejected[0].reason).toContain("too many actions");

    const exactSteps = JSON.stringify({ format: "mvactions", version: 1, actions: [action(MAX_ACTION_STEPS)] });
    expect(parseActionsFile(exactSteps, ALLOWED).actions[0].steps).toHaveLength(MAX_ACTION_STEPS);
    const tooManySteps = JSON.stringify({ format: "mvactions", version: 1, actions: [action(MAX_ACTION_STEPS + 1)] });
    expect(parseActionsFile(tooManySteps, ALLOWED).rejected[0].reason).toContain("too many action steps");

    const actionsOverTotal = Math.floor(MAX_ACTION_TOTAL_STEPS / MAX_ACTION_STEPS) + 1;
    const tooManyTotalSteps = JSON.stringify({
      format: "mvactions",
      version: 1,
      actions: Array.from({ length: actionsOverTotal }, () => action(MAX_ACTION_STEPS)),
    });
    expect(parseActionsFile(tooManyTotalSteps, ALLOWED).rejected[0].reason).toContain("too many total action steps");

    expect(parseActionsFile(" ".repeat(MAX_ACTIONS_IMPORT_BYTES + 1), ALLOWED).rejected[0].reason).toContain("import limit");
  });

  it("rejects action arguments beyond the nesting cap and malformed typed-array envelopes", () => {
    let nested: unknown = 0;
    for (let i = 0; i < MAX_ACTION_VALUE_DEPTH + 2; i++) nested = [nested];
    expect(isSerializableArgs([nested])).toBe(false);
    expect(isSerializableArgs([{ $ta: "u16", b64: "AAAA" }])).toBe(false);
    expect(isSerializableArgs([{ $ta: "f32", b64: "AA==" }])).toBe(false);
    expect(isSerializableArgs([{ $ta: "u8", b64: "not base64" }])).toBe(false);
  });
});
