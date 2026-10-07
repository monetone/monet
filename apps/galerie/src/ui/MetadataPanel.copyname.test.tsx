// MetadataPanel.copyname.test — GAL-LIB-18: a virtual copy's Copy Name is an
// editable Metadata-panel field (LR's Photo ▸ Set Copy Name…), and Make Master
// Photo promotes the copy. The catalog side (role swap, sibling re-homing, the
// next free "Copy N") is covered by
// src-tauri/src/catalog.rs::make_master_photo_swaps_roles_and_rehomes_siblings.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  isTauri: () => true,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => true),
  readFile: vi.fn(async () => new Uint8Array()),
}));

vi.mock("../import", () => ({ readSidecarDocument: vi.fn(async () => null) }));
vi.mock("../lib/xmpAutoWrite", () => ({
  queueXmpWrite: vi.fn(),
  recordMetadataRead: vi.fn(async () => {}),
  writeSidecarForPhoto: vi.fn(async () => {}),
  metadataStatusFor: vi.fn(async () => "unknown"),
}));

vi.mock("../catalog/catalog", () => ({
  catalogAvailable: () => true,
  addSnapshot: vi.fn(async () => 1),
  listSnapshots: vi.fn(async () => []),
  replacePhotoKeywords: vi.fn(async () => {}),
  addKeyword: vi.fn(async () => 1),
  removeKeyword: vi.fn(async () => {}),
  listPhotoKeywords: vi.fn(async () => []),
  listMetadataPresets: vi.fn(async () => []),
  onRecipeChanged: vi.fn(() => () => {}),
  onPhotoRecipeChanged: vi.fn(() => () => {}),
}));

// The store is the panel's write path for both the rename and Make Master Photo.
const { setCopyName, makeMasterPhoto, reload, notify, state } = vi.hoisted(() => ({
  setCopyName: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  makeMasterPhoto: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  reload: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  notify: vi.fn<(...args: unknown[]) => void>(() => {}),
  state: {
    photos: [] as unknown[],
    selection: [] as number[],
    activeId: null as number | null,
    available: true,
    keywords: [] as unknown[],
  },
}));
vi.mock("../state/store", () => ({
  store: { setCopyName, makeMasterPhoto, reload, notify, getState: () => state, refreshKeywordList: vi.fn() },
  useCatalog: () => state,
}));

import type { PhotoRow } from "../catalog/types";
import { MetadataPanel } from "./MetadataPanel";

/** Only the fields the panel reads matter here; the rest of PhotoRow is noise. */
const photo = (over: Partial<PhotoRow> = {}): PhotoRow =>
  ({
    id: 7,
    path: "/a.cr3",
    isVirtualCopy: true,
    copyName: "Copy 1",
    orientation: 1,
    rating: 0,
    flag: 0,
    colorLabel: null,
    gpsLat: null,
    gpsLon: null,
    stackCount: 1,
    missing: false,
    ...over,
  }) as unknown as PhotoRow;

/** Render the panel with `p` active. */
function panel(p: PhotoRow): string {
  state.photos = [p];
  state.selection = [];
  state.activeId = p.id;
  return renderToStaticMarkup(<MetadataPanel />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MetadataPanel copy name", () => {
  it("shows an editable Copy Name + Make Master Photo only on a virtual copy", () => {
    const html = panel(photo({ copyName: "B&W" }));
    expect(html).toContain("Copy Name");
    expect(html).toContain('value="B&amp;W"');
    expect(html).toContain("Make Master Photo");

    // A master has no copy name — LR hides both controls.
    const master = panel(photo({ isVirtualCopy: false, copyName: null }));
    expect(master).not.toContain("Copy Name");
    expect(master).not.toContain("Make Master Photo");
  });
});
