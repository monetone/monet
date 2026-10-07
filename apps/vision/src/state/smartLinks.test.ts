// The Place-Linked registry. Package…, project save and relink all read it, and
// restoreSmartLinksForDoc is what decides whether a reopened project's smart-object
// links survive — none of it had a test. The registry is a module-level Map, so
// every test starts by clearing the docs it uses.
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSmartLinksForDoc,
  deleteSmartLink,
  getSmartLink,
  hasSmartLink,
  listSmartLinks,
  markSmartLinkMissing,
  restoreSmartLinksForDoc,
  serializeSmartLinksForDoc,
  setSmartLink,
  smartLinkKey,
  type SmartLinkInfo,
} from "./smartLinks";

const DOC = 1;
const OTHER = 2;

const link = (overrides: Partial<SmartLinkInfo> = {}): SmartLinkInfo => ({
  docId: DOC,
  layerId: 10,
  name: "logo.png",
  path: "/assets/logo.png",
  missing: false,
  linkedAt: 1000,
  updatedAt: 2000,
  ...overrides,
});

beforeEach(() => {
  clearSmartLinksForDoc(DOC);
  clearSmartLinksForDoc(OTHER);
});

describe("smart-link registry", () => {
  it("keys links by document and layer so the same layer id in two documents does not collide", () => {
    setSmartLink(link({ name: "a.png" }));
    setSmartLink(link({ docId: OTHER, name: "b.png" }));

    expect(smartLinkKey(DOC, 10)).not.toBe(smartLinkKey(OTHER, 10));
    expect(getSmartLink(DOC, 10)?.name).toBe("a.png");
    expect(getSmartLink(OTHER, 10)?.name).toBe("b.png");
  });

  it("returns copies so callers cannot mutate the registry through a read", () => {
    setSmartLink(link());
    const read = getSmartLink(DOC, 10)!;
    read.name = "hacked";
    read.missing = true;

    expect(getSmartLink(DOC, 10)).toMatchObject({ name: "logo.png", missing: false });

    const listed = listSmartLinks(DOC)[0];
    listed.path = "/elsewhere";
    expect(getSmartLink(DOC, 10)?.path).toBe("/assets/logo.png");
  });

  it("stores a copy of the caller's object", () => {
    const info = link();
    setSmartLink(info);
    info.name = "renamed-after-set";

    expect(getSmartLink(DOC, 10)?.name).toBe("logo.png");
  });

  it("reports and removes membership", () => {
    expect(hasSmartLink(DOC, 10)).toBe(false);
    expect(getSmartLink(DOC, 10)).toBeNull();

    setSmartLink(link());
    expect(hasSmartLink(DOC, 10)).toBe(true);

    expect(deleteSmartLink(DOC, 10)).toBe(true);
    expect(deleteSmartLink(DOC, 10)).toBe(false);
    expect(hasSmartLink(DOC, 10)).toBe(false);
  });

  it("lists only the requested document, optionally filtered to still-live smart layers", () => {
    setSmartLink(link({ layerId: 10 }));
    setSmartLink(link({ layerId: 11 }));
    setSmartLink(link({ docId: OTHER, layerId: 12 }));

    expect(listSmartLinks(DOC).map((l) => l.layerId).sort()).toEqual([10, 11]);
    expect(listSmartLinks(DOC, (id) => id === 11).map((l) => l.layerId)).toEqual([11]);
    expect(listSmartLinks(OTHER).map((l) => l.layerId)).toEqual([12]);
  });

  it("marks a link missing with a timestamp, and reports when there is nothing to mark", () => {
    setSmartLink(link());

    expect(markSmartLinkMissing(DOC, 10, true, 9999)).toBe(true);
    expect(getSmartLink(DOC, 10)).toMatchObject({ missing: true, updatedAt: 9999, linkedAt: 1000 });

    expect(markSmartLinkMissing(DOC, 10, false, 12345)).toBe(true);
    expect(getSmartLink(DOC, 10)).toMatchObject({ missing: false, updatedAt: 12345 });

    expect(markSmartLinkMissing(DOC, 99, true)).toBe(false);
    expect(hasSmartLink(DOC, 99)).toBe(false);
  });

  it("clears one document's links and returns how many went", () => {
    setSmartLink(link({ layerId: 10 }));
    setSmartLink(link({ layerId: 11 }));
    setSmartLink(link({ docId: OTHER, layerId: 12 }));

    expect(clearSmartLinksForDoc(DOC)).toBe(2);
    expect(listSmartLinks(DOC)).toEqual([]);
    expect(listSmartLinks(OTHER)).toHaveLength(1);
    expect(clearSmartLinksForDoc(DOC)).toBe(0);
  });
});

describe("serializeSmartLinksForDoc", () => {
  it("drops docId, prefers the package-relative path, and keeps the absolute path when there is none", () => {
    setSmartLink(link({ layerId: 10, path: "/abs/logo.png", relativePath: "Links/logo.png" }));
    setSmartLink(link({ layerId: 11, path: "/abs/other.png", name: "other.png" }));

    const rows = serializeSmartLinksForDoc(DOC).sort((a, b) => a.layerId - b.layerId);

    expect(rows[0]).not.toHaveProperty("docId");
    expect(rows[0].path).toBe("Links/logo.png");
    expect(rows[0].relativePath).toBe("Links/logo.png");
    expect(rows[1].path).toBe("/abs/other.png");
  });

  it("omits links whose layer no longer exists in the document being saved", () => {
    setSmartLink(link({ layerId: 10 }));
    setSmartLink(link({ layerId: 11 }));

    expect(serializeSmartLinksForDoc(DOC, new Set([11])).map((l) => l.layerId)).toEqual([11]);
    expect(serializeSmartLinksForDoc(DOC, new Set()).length).toBe(0);
  });
});

describe("restoreSmartLinksForDoc", () => {
  it("replaces whatever the document already had", () => {
    setSmartLink(link({ layerId: 10, name: "stale.png" }));

    restoreSmartLinksForDoc(DOC, [{ layerId: 11, name: "fresh.png", missing: false, linkedAt: 1, updatedAt: 2 }]);

    expect(listSmartLinks(DOC).map((l) => l.name)).toEqual(["fresh.png"]);
  });

  it("leaves other documents alone", () => {
    setSmartLink(link({ docId: OTHER, layerId: 10 }));

    restoreSmartLinksForDoc(DOC, []);

    expect(listSmartLinks(OTHER)).toHaveLength(1);
  });

  it("drops links whose layer is not in the reopened document", () => {
    restoreSmartLinksForDoc(
      DOC,
      [
        { layerId: 10, name: "kept.png", missing: false, linkedAt: 1, updatedAt: 2 },
        { layerId: 99, name: "gone.png", missing: false, linkedAt: 1, updatedAt: 2 },
      ],
      new Set([10]),
    );

    expect(listSmartLinks(DOC).map((l) => l.name)).toEqual(["kept.png"]);
  });

  it("rejects rows with a bad layer id, a missing name or non-finite timestamps", () => {
    const bad = [
      { layerId: Number.NaN, name: "nan-layer.png", missing: false, linkedAt: 1, updatedAt: 2 },
      { layerId: Number.POSITIVE_INFINITY, name: "inf-layer.png", missing: false, linkedAt: 1, updatedAt: 2 },
      { layerId: 12, name: "", missing: false, linkedAt: 1, updatedAt: 2 },
      { layerId: 13, name: "nan-linked.png", missing: false, linkedAt: Number.NaN, updatedAt: 2 },
      { layerId: 14, name: "inf-updated.png", missing: false, linkedAt: 1, updatedAt: Number.POSITIVE_INFINITY },
    ] as Parameters<typeof restoreSmartLinksForDoc>[1];

    restoreSmartLinksForDoc(DOC, bad);

    expect(listSmartLinks(DOC)).toEqual([]);
  });

  it("truncates a fractional layer id and coerces missing to a boolean", () => {
    restoreSmartLinksForDoc(DOC, [
      { layerId: 10.9, name: "a.png", missing: 1 as unknown as boolean, linkedAt: 1, updatedAt: 2 },
      { layerId: 11, name: "b.png", missing: undefined as unknown as boolean, linkedAt: 1, updatedAt: 2 },
    ]);

    expect(getSmartLink(DOC, 10)).toMatchObject({ name: "a.png", missing: true });
    expect(getSmartLink(DOC, 11)).toMatchObject({ name: "b.png", missing: false });
  });

  it("round-trips a serialized document", () => {
    setSmartLink(link({ layerId: 10, path: "/abs/logo.png", relativePath: "Links/logo.png" }));
    const saved = serializeSmartLinksForDoc(DOC);

    clearSmartLinksForDoc(DOC);
    restoreSmartLinksForDoc(DOC, saved, new Set([10]));

    expect(getSmartLink(DOC, 10)).toEqual({
      docId: DOC,
      layerId: 10,
      name: "logo.png",
      path: "Links/logo.png",
      relativePath: "Links/logo.png",
      missing: false,
      linkedAt: 1000,
      updatedAt: 2000,
    });
  });
});
