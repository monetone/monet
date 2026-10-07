import { beforeAll, describe, expect, it } from "vitest";
import {
  createContainer,
  getEntry,
  initMonetFormat,
  readContainer,
  setEntry,
  writeContainer,
} from "@monet-ui/monet-format";
import { createProject, createScene } from "../model/factory";
import { containerReport, projectFromContainer, projectToContainer, SCENE_PATH } from "./jouer";

// The container is Jouer's on-disk format (docs/plans/11-universal-container.md).
// Two things must hold: our scene survives a round trip, and everything that
// isn't ours survives it byte-for-byte (rule 2) — including a document that
// carries no Jouer scene at all.
beforeAll(async () => {
  await initMonetFormat();
});

function rythmeContainer() {
  const c = createContainer({ name: "monet-rythme", version: "0.1.0" }, "time");
  setEntry(c, "timeline.json", "timeline", new TextEncoder().encode(`{"tracks":[]}`));
  setEntry(c, "audio/take-1.wav", "audio", new Uint8Array([0xff, 0x00, 0x7f, 0x80]));
  c.manifest.futureField = { unknown: "keep me" }; // rule 3: unknown manifest fields are couriered
  return c;
}

describe("jouer container io", () => {
  it("round-trips a project through a v1 container", () => {
    const scene = createScene("Level 1");
    const project = createProject("Demo", { scenes: [scene], activeSceneId: scene.id });
    const back = readContainer(writeContainer(projectToContainer(project)));

    expect(back.manifest.format).toBe("monet");
    expect(back.manifest.schemaVersion).toBe(1);
    expect(back.manifest.app.name).toBe("monet-jouer");
    expect(back.manifest.kind).toBe("scene");
    expect(back.manifest.entries).toEqual([{ path: SCENE_PATH, role: "scene" }]);
    expect(projectFromContainer(back).scenes[0].name).toBe("Level 1");
    expect(containerReport(back)).toBeNull(); // nothing ignored → nothing to shout about
  });

  it("opens a container by its manifest role, not by where the scene sits", () => {
    const c = createContainer({ name: "monet-jouer", version: "0.1.0" }, "scene");
    const project = createProject("Odd");
    setEntry(c, "nested/elsewhere.json", "scene", new TextEncoder().encode(
      new TextDecoder().decode(getEntry(projectToContainer(project), SCENE_PATH)!),
    ));
    expect(projectFromContainer(c).name).toBe("Odd");
  });

  it("opens another app's container blank, says so, and couriers every entry it did not consume", () => {
    const foreign = readContainer(writeContainer(rythmeContainer()));

    const project = projectFromContainer(foreign);
    expect(project.scenes).toHaveLength(1); // blank Jouer document, not a failed open
    const report = containerReport(foreign);
    expect(report).toMatch(/No Jouer scene in this monet-rythme document/);
    expect(report).toMatch(/timeline, audio/); // rule 1: named, so nothing looks lost

    // Re-save it as a Jouer document: our scene lands, Rythme's work is untouched.
    project.name = "Played";
    const back = readContainer(writeContainer(projectToContainer(project, foreign)));
    expect(getEntry(back, "audio/take-1.wav")).toEqual(new Uint8Array([0xff, 0x00, 0x7f, 0x80]));
    expect(new TextDecoder().decode(getEntry(back, "timeline.json")!)).toBe(`{"tracks":[]}`);
    expect(back.manifest.futureField).toEqual({ unknown: "keep me" });
    expect(back.manifest.kind).toBe("time"); // not ours to relabel
    expect(back.manifest.app.name).toBe("monet-jouer"); // but we wrote it last
    expect(projectFromContainer(back).name).toBe("Played");
    expect(containerReport(back)).toMatch(/Kept timeline, audio untouched/);
  });
});
