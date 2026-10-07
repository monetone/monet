// Preferences ▸ History Log (V-HIST-1): the edit audit trail behind the pane.
// Engine-free (node) — the pane itself is a form over these, so this pins the
// parts that can silently rot: preference validation/persistence, the
// undo/redo-vs-new-edit discrimination, the line format, and the cap.
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import {
  Store, normalizeHistoryLog, historyLogLine, historyLogDelta, appendHistoryLog,
  DEFAULT_HISTORY_LOG, HISTORY_LOG_MAX, type HistoryLogPrefs,
} from "./store";

// Minimal Storage stand-in — the unit suite runs in node, which has none.
function installStorage(): Map<string, string> {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
  return cells;
}

function newStore(): Store {
  const engine = { set_history_states() {}, undo_depth() { return 0; } };
  const client = { onCommit: null, engine, e: engine, sync: () => {}, commit: () => {} };
  return new Store(client as never);
}

const AT = new Date(2026, 6, 27, 9, 5, 3); // 2026-07-27 09:05:03, local
const on = (patch: Partial<HistoryLogPrefs> = {}): HistoryLogPrefs =>
  ({ ...DEFAULT_HISTORY_LOG, enabled: true, ...patch });

beforeEach(() => { installStorage(); });

describe("normalizeHistoryLog", () => {
  it("falls back to the Photoshop defaults for anything malformed", () => {
    expect(normalizeHistoryLog(null)).toEqual(DEFAULT_HISTORY_LOG);
    expect(normalizeHistoryLog("nope")).toEqual(DEFAULT_HISTORY_LOG);
    expect(normalizeHistoryLog([true])).toEqual(DEFAULT_HISTORY_LOG);
    expect(normalizeHistoryLog({ enabled: 1, detail: "verbose" })).toEqual(DEFAULT_HISTORY_LOG);
  });

  it("keeps valid values and drops unknown keys", () => {
    expect(normalizeHistoryLog({ enabled: true, detail: "detailed", bogus: 3 }))
      .toEqual({ enabled: true, detail: "detailed" });
  });

  it("is off out of the box — the log is opt-in", () => {
    expect(DEFAULT_HISTORY_LOG.enabled).toBe(false);
  });
});

describe("historyLogLine", () => {
  it("zero-pads to Photoshop's 'date time  text' shape", () => {
    expect(historyLogLine(AT, "Levels")).toBe("2026-07-27 09:05:03  Levels");
  });
});

describe("historyLogDelta", () => {
  it("logs nothing while the preference is off", () => {
    expect(historyLogDelta(DEFAULT_HISTORY_LOG, [], ["Brush"], 1, "Doc", AT)).toEqual([]);
  });

  it("logs the new state's label at Concise", () => {
    expect(historyLogDelta(on(), ["Brush"], ["Brush", "Levels"], 2, "sunset.jpg", AT))
      .toEqual(["2026-07-27 09:05:03  Levels"]);
  });

  it("adds the document and timeline position at Detailed", () => {
    expect(historyLogDelta(on({ detail: "detailed" }), ["Brush"], ["Brush", "Levels"], 2, "sunset.jpg", AT))
      .toEqual(["2026-07-27 09:05:03  sunset.jpg: Levels (state 2 of 2)"]);
  });

  it("skips timeline states entirely at Sessions Only", () => {
    expect(historyLogDelta(on({ detail: "sessions" }), ["Brush"], ["Brush", "Levels"], 2, "Doc", AT)).toEqual([]);
  });

  it("ignores a plain undo/redo — the labels are unchanged, only the cursor moved", () => {
    const timeline = ["Brush", "Levels"];
    expect(historyLogDelta(on(), timeline, timeline, 1, "Doc", AT)).toEqual([]); // undo
    expect(historyLogDelta(on(), timeline, timeline, 2, "Doc", AT)).toEqual([]); // redo
  });

  it("logs an edit that truncated the redo tail", () => {
    // Undone to state 1, then a fresh edit replaces "Levels" with "Crop".
    expect(historyLogDelta(on(), ["Brush", "Levels"], ["Brush", "Crop"], 2, "Doc", AT))
      .toEqual(["2026-07-27 09:05:03  Crop"]);
  });

  it("logs nothing at the opened state or for an index off the timeline", () => {
    expect(historyLogDelta(on(), [], ["Brush"], 0, "Doc", AT)).toEqual([]);
    expect(historyLogDelta(on(), [], ["Brush"], 2, "Doc", AT)).toEqual([]);
  });
});

describe("appendHistoryLog", () => {
  it("returns the same array when there is nothing to add (no re-render)", () => {
    const entries = ["a"];
    expect(appendHistoryLog(entries, [])).toBe(entries);
  });

  it("drops the oldest lines once the cap is passed", () => {
    const full = Array.from({ length: HISTORY_LOG_MAX }, (_, i) => `line ${i}`);
    const next = appendHistoryLog(full, ["newest"]);
    expect(next).toHaveLength(HISTORY_LOG_MAX);
    expect(next[0]).toBe("line 1"); // "line 0" fell off the front
    expect(next.at(-1)).toBe("newest");
  });
});

describe("History Log preference", () => {
  it("persists a partial change and reloads it in a fresh store", () => {
    const store = newStore();
    store.setHistoryLog({ enabled: true });
    expect(store.state.historyLog).toEqual({ enabled: true, detail: "concise" });

    expect(newStore().state.historyLog.enabled).toBe(true);
  });

  it("survives corrupt storage without blocking the other preferences", () => {
    localStorage.setItem("mv.historyLog", "{not json");
    localStorage.setItem("mv.gridPrefs", JSON.stringify({ spacing: 24 }));
    const store = newStore();
    expect(store.state.historyLog).toEqual(DEFAULT_HISTORY_LOG);
    expect(store.state.gridSpacing).toBe(24);
  });

  it("clears the session log on demand", () => {
    const store = newStore();
    (store as unknown as { set(patch: unknown): void }).set({ historyLogEntries: ["a", "b"] });
    expect(store.historyLogText()).toBe("a\nb");
    store.clearHistoryLog();
    expect(store.state.historyLogEntries).toEqual([]);
    expect(store.historyLogText()).toBe("");
  });
});
