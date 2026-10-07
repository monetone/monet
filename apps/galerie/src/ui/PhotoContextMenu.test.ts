// PhotoContextMenu — unit tests over the pure item builder: target gating,
// collection submenu contents, quick-collection label flip, checked marks,
// and the Go to Folder gate. Store-writing actions are exercised elsewhere;
// here we assert the structure the menu presents.

import { describe, expect, it } from "vitest";

import type { CollectionRow, PhotoRow } from "../catalog/types";
import { photoContextItems, type PhotoContextDeps } from "./PhotoContextMenu";

const photo = (id: number, extra: Partial<PhotoRow> = {}): PhotoRow =>
  ({ id, path: `/shoot/p${id}.dng`, rating: 0, flag: 0, colorLabel: null, ...extra }) as PhotoRow;

const col = (id: number, name: string, kind = "collection"): CollectionRow =>
  ({ id, name, kind, parentId: null, ruleAst: null, sortOrder: 0, createdAt: id }) as CollectionRow;

const deps = (over: Partial<PhotoContextDeps> = {}): PhotoContextDeps => ({
  targets: [photo(1)],
  collections: [],
  activeCollectionId: null,
  quickMemberIds: [],
  folderPaths: [],
  labels: { red: "Red", yellow: "Amber" },
  onRemove: () => {},
  ...over,
});

const byId = (items: ReturnType<typeof photoContextItems>, id: string) => {
  const item = items.find((i) => i.id === id);
  if (!item) throw new Error(`missing menu item ${id}`);
  return item;
};

describe("photoContextItems", () => {
  it("disables every photo-targeting item when there are no targets", () => {
    const items = photoContextItems(deps({ targets: [] }));
    for (const id of [
      "quick",
      "addtocollection",
      "removefromcollection",
      "flag",
      "rating",
      "label",
      "stacking",
      "vcopy",
      "devsettings",
      "gotofolder",
      "reveal",
      "editinvision",
      "remove",
    ]) {
      expect(byId(items, id).disabled, id).toBe(true);
    }
  });

  it("lists only manual collections in Add to Collection, excluding Quick", () => {
    const quick = col(9, "Quick Collection"); // reserved-name sentinel
    const items = photoContextItems(
      deps({ collections: [col(1, "Keepers"), col(2, "Sets", "set"), col(3, "Smart", "smart"), quick] }),
    );
    const sub = byId(items, "addtocollection").items!;
    expect(sub.map((i) => i.label)).toEqual(["Keepers"]);
    // No manual collections at all → a disabled placeholder row.
    const empty = byId(photoContextItems(deps()), "addtocollection").items!;
    expect(empty).toHaveLength(1);
    expect(empty[0].disabled).toBe(true);
  });

  it("enables Remove from Collection only while viewing a manual collection", () => {
    const cols = [col(1, "Keepers"), col(2, "Smart", "smart")];
    expect(byId(photoContextItems(deps({ collections: cols, activeCollectionId: 1 })), "removefromcollection").disabled).toBe(false);
    expect(byId(photoContextItems(deps({ collections: cols, activeCollectionId: 2 })), "removefromcollection").disabled).toBe(true);
    expect(byId(photoContextItems(deps({ collections: cols })), "removefromcollection").disabled).toBe(true);
  });

  it("flips the Quick Collection label only when every target is a member", () => {
    const targets = [photo(1), photo(2)];
    expect(byId(photoContextItems(deps({ targets, quickMemberIds: [1, 2] })), "quick").label).toBe(
      "Remove from Quick Collection",
    );
    expect(byId(photoContextItems(deps({ targets, quickMemberIds: [1] })), "quick").label).toBe(
      "Add to Quick Collection",
    );
  });

  it("checks flag/rating/label entries only when all targets agree", () => {
    const agree = photoContextItems(
      deps({ targets: [photo(1, { flag: 1, rating: 3, colorLabel: "red" }), photo(2, { flag: 1, rating: 3, colorLabel: "red" })] }),
    );
    expect(byId(byId(agree, "flag").items!, "flag-pick").checked).toBe(true);
    expect(byId(byId(agree, "rating").items!, "rate-3").checked).toBe(true);
    expect(byId(byId(agree, "label").items!, "label-red").checked).toBe(true);
    // Custom label-set names come from the labels map.
    expect(byId(byId(agree, "label").items!, "label-yellow").label).toBe("Amber");

    const mixed = photoContextItems(deps({ targets: [photo(1, { flag: 1, colorLabel: "red" }), photo(2)] }));
    expect(byId(byId(mixed, "flag").items!, "flag-pick").checked).toBe(false);
    expect(byId(byId(mixed, "label").items!, "label-red").checked).toBe(false);
    expect(byId(byId(mixed, "label").items!, "label-none").checked).toBe(false);
  });

  it("gates Go to Folder on the first target's dir being a tracked folder", () => {
    expect(byId(photoContextItems(deps({ folderPaths: ["/shoot"] })), "gotofolder").disabled).toBe(false);
    expect(byId(photoContextItems(deps({ folderPaths: ["/elsewhere"] })), "gotofolder").disabled).toBe(true);
  });

  it("routes Remove from Catalog through the confirm callback and gates Sync on 2+ targets", () => {
    let removes = 0;
    const one = photoContextItems(deps({ onRemove: () => removes++ }));
    byId(one, "remove").action!();
    expect(removes).toBe(1);
    expect(byId(byId(one, "devsettings").items!, "syncdev").disabled).toBe(true);
    const two = photoContextItems(deps({ targets: [photo(1), photo(2)] }));
    expect(byId(byId(two, "devsettings").items!, "syncdev").disabled).toBe(false);
  });
});
