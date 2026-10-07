import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyProject, newClip, silentBuffer } from "../engine/model/factory";
import { RythmeStore } from "../engine/store/store";

interface Adapter {
  getDoc(): unknown;
  subscribe(fn: () => void): () => void;
}

const harness = vi.hoisted(() => ({
  puts: 0,
  reads: 0,
  unsubscribe: null as (() => void) | null,
}));

vi.mock("@monet-ui/monet-collab", () => ({
  CollabSession: class {
    blobs = {
      put: () => { harness.puts++; return "hash"; },
      get: () => null,
      onBlob: () => () => {},
    };
  },
  bindStore: (_session: unknown, adapter: Adapter) => {
    harness.reads++;
    adapter.getDoc();
    harness.unsubscribe = adapter.subscribe(() => {
      harness.reads++;
      adapter.getDoc();
    });
    return harness.unsubscribe;
  },
}));

const { startCollab } = await import("./index");

beforeEach(() => {
  harness.puts = 0;
  harness.reads = 0;
  harness.unsubscribe = null;
  vi.stubGlobal("location", { search: "?room=test" });
});

afterEach(() => {
  harness.unsubscribe?.();
  vi.unstubAllGlobals();
});

describe("Rythme collaboration binding", () => {
  it("strips and reconciles only when the persisted project changes", () => {
    const project = emptyProject();
    project.tracks[0].clips.push(newClip(silentBuffer(0.01), { trackId: project.tracks[0].id }));
    const store = new RythmeStore(project);
    expect(startCollab(store)).not.toBeNull();
    expect(harness.reads).toBe(1);
    expect(harness.puts).toBe(1);

    store.setPlayhead(120);
    store.setPlaying(true);
    store.setZoom(24);
    expect(harness.reads).toBe(1);
    expect(harness.puts).toBe(1);

    store.mutate("Rename", (project) => { project.name = "Changed"; });
    expect(harness.reads).toBe(2);
    expect(harness.puts).toBe(2);
  });
});
