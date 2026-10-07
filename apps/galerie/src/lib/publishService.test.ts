import { beforeEach, describe, expect, it } from "vitest";

import type { CollectionRow, PhotoRow } from "../catalog/types";
import type { PresetStorage } from "./exportPresets";
import {
  DEFAULT_PUBLISH_CONFIG,
  findPublishServices,
  forgetPublishService,
  forgetPublished,
  isPublishService,
  loadPublishRecords,
  markToRepublish,
  parsePublishService,
  publishPlan,
  publishServiceMarker,
  publishSignature,
  publishState,
  publishSummary,
  recordPublished,
  resetPublishRecords,
  type PublishServiceConfig,
} from "./publishService";

function fakeStorage(initial: Record<string, string> = {}): PresetStorage {
  const map: Record<string, string> = { ...initial };
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => {
      map[k] = v;
    },
  };
}

const config: PublishServiceConfig = { dir: "/pub", format: "jpeg", quality: 0.85, longEdge: 2048 };

const photo = (id: number, over: Partial<PhotoRow> = {}): PhotoRow =>
  ({
    id,
    sourceAssetId: id,
    path: `/src/IMG_${id}.CR3`,
    readPath: `/src/IMG_${id}.CR3`,
    format: "raw:CR3",
    isVirtualCopy: false,
    orientation: 1,
    rating: 0,
    flag: 0,
    colorLabel: null,
    captureTime: null,
    addedTime: 0,
    width: 6000,
    height: 4000,
    cameraMake: null,
    cameraModel: null,
    lens: null,
    iso: null,
    fNumber: null,
    focalLength: null,
    exposureTime: null,
    gpsLat: null,
    gpsLon: null,
    hasRecipe: false,
    processVersion: 6,
    copyName: null,
    stackId: null,
    stackOrder: null,
    stackCount: 1,
    missing: false,
    title: null,
    caption: null,
    creator: null,
    copyright: null,
    city: null,
    stateProvince: null,
    country: null,
    jobTitle: null,
    credit: null,
    source: null,
    ...over,
  }) as PhotoRow;

const row = (id: number, ruleAst: string | null, kind = "collection"): CollectionRow => ({
  id,
  name: `S${id}`,
  kind,
  parentId: null,
  ruleAst,
  sortOrder: 0,
  createdAt: 0,
});

beforeEach(() => resetPublishRecords());

describe("publish service settings", () => {
  it("round-trips through the collection rule field and rejects non-services", () => {
    expect(parsePublishService(publishServiceMarker(config))).toEqual(config);
    expect(parsePublishService(null)).toBeNull();
    expect(parsePublishService("not json")).toBeNull();
    expect(parsePublishService('{"monetSystemCollection":"previous-import"}')).toBeNull();
    // A service without a destination is unusable — never guess one.
    expect(parsePublishService('{"monetSystemCollection":"publish-hard-drive","dir":""}')).toBeNull();
  });

  it("clamps hostile persisted values instead of trusting them", () => {
    const parsed = parsePublishService(
      '{"monetSystemCollection":"publish-hard-drive","dir":"/pub","format":"exe","quality":9,"longEdge":-5}',
    );
    expect(parsed).toEqual({
      dir: "/pub",
      format: "jpeg",
      quality: DEFAULT_PUBLISH_CONFIG.quality,
      longEdge: null,
    });
  });

  it("finds services in the collection tree and leaves other collections alone", () => {
    const marker = publishServiceMarker(config);
    const rows = [row(1, null), row(2, marker), row(3, marker, "smart")];
    expect(findPublishServices(rows).map((s) => s.row.id)).toEqual([2]);
    expect(rows.map(isPublishService)).toEqual([false, true, false]);
  });
});

describe("publish state", () => {
  it("changes the signature when the edit, the metadata or the settings change", () => {
    const base = publishSignature(photo(1), '{"exposure":0}', config);
    expect(publishSignature(photo(1), '{"exposure":0}', config)).toBe(base);
    expect(publishSignature(photo(1), '{"exposure":1}', config)).not.toBe(base);
    expect(publishSignature(photo(1, { title: "New" }), '{"exposure":0}', config)).not.toBe(base);
    expect(publishSignature(photo(1), '{"exposure":0}', { ...config, longEdge: 1024 })).not.toBe(base);
  });

  it("classifies new / published / modified, including Mark to Republish", () => {
    expect(publishState(null, "a")).toBe("new");
    expect(publishState({ path: "/pub/a.jpg", signature: "a", publishedAt: 0 }, "a")).toBe("published");
    expect(publishState({ path: "/pub/a.jpg", signature: "a", publishedAt: 0 }, "b")).toBe("modified");
    expect(
      publishState({ path: "/pub/a.jpg", signature: "a", publishedAt: 0, republish: true }, "a"),
    ).toBe("modified");
  });
});

describe("publishPlan", () => {
  const members = [photo(1), photo(2), photo(3)];
  const signatures = new Map([
    [1, "sig1"],
    [2, "sig2-edited"],
    [3, "sig3"],
  ]);
  const records = {
    2: { path: "/pub/IMG_2.jpg", signature: "sig2", publishedAt: 0 },
    3: { path: "/pub/IMG_3.jpg", signature: "sig3", publishedAt: 0 },
    9: { path: "/pub/IMG_9.jpg", signature: "sig9", publishedAt: 0 },
  };

  it("pushes only the diff: new + modified out, dropped members deleted", () => {
    const plan = publishPlan(members, signatures, records);
    expect(plan.publish.map((e) => [e.photo.id, e.state, e.signature])).toEqual([
      [1, "new", "sig1"],
      [2, "modified", "sig2-edited"],
    ]);
    expect(plan.remove).toEqual([{ photoId: 9, path: "/pub/IMG_9.jpg" }]);
    expect(publishSummary(plan, members.length)).toEqual({
      new: 1,
      modified: 1,
      published: 1,
      deleted: 1,
    });
  });

  it("has nothing to do once everything is published and unchanged", () => {
    const plan = publishPlan([photo(3)], new Map([[3, "sig3"]]), { 3: records[3] });
    expect(plan).toEqual({ publish: [], remove: [] });
  });
});

describe("record storage", () => {
  it("records a publish, marks republish, and forgets photos and services", () => {
    const s = fakeStorage();
    recordPublished(7, [{ photoId: 1, path: "/pub/IMG_1.jpg", signature: "sig1" }], s, 1000);
    expect(loadPublishRecords(7, s)).toEqual({
      1: { path: "/pub/IMG_1.jpg", signature: "sig1", publishedAt: 1000 },
    });
    // Republished photos come back as Modified even though nothing changed.
    markToRepublish(7, [1], s);
    expect(publishState(loadPublishRecords(7, s)[1], "sig1")).toBe("modified");

    forgetPublished(7, [1], s);
    expect(loadPublishRecords(7, s)).toEqual({});

    recordPublished(7, [{ photoId: 2, path: "/pub/IMG_2.jpg", signature: "sig2" }], s);
    forgetPublishService(7, s);
    expect(loadPublishRecords(7, s)).toEqual({});
  });

  it("keeps records per service and survives a reload from storage", () => {
    const map: Record<string, string> = {};
    const s: PresetStorage = {
      getItem: (k) => (k in map ? map[k] : null),
      setItem: (k, v) => {
        map[k] = v;
      },
    };
    recordPublished(1, [{ photoId: 5, path: "/a/5.jpg", signature: "x" }], s, 1);
    recordPublished(2, [{ photoId: 5, path: "/b/5.jpg", signature: "y" }], s, 2);
    resetPublishRecords(); // next read comes off "disk"
    expect(loadPublishRecords(1, s)[5].path).toBe("/a/5.jpg");
    expect(loadPublishRecords(2, s)[5].path).toBe("/b/5.jpg");
  });

  it("survives a corrupt blob rather than losing the panel", () => {
    const s = fakeStorage({ "galerie.publishRecords": "{oops" });
    expect(loadPublishRecords(1, s)).toEqual({});
  });
});
