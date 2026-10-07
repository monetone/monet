import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDocument, makeRect } from "../engine";
import { fileCommands } from "../io/commands";
import { store } from "../state/app";
import { deleteSelection, group, openDocument, pathfinder, undo, ungroup } from "./commands";

beforeEach(() => {
  store.replaceDoc(makeDocument(), { markClean: true });
});

describe("Artisan MCP mutation outcomes", () => {
  it("reports a cancelled open instead of claiming success", async () => {
    vi.spyOn(fileCommands, "openPath").mockResolvedValueOnce(false);

    await expect(openDocument("/tmp/other.mart")).rejects.toThrow(/cancelled.*unsaved/i);
  });

  it("reports success only when grouping changes the document", () => {
    const a = makeRect(0, 0, 10, 10);
    const b = makeRect(20, 0, 10, 10);
    store.transact("Fixture", (doc) => doc.layers[0].items.push(a, b));
    store.setSelection([a.id, b.id]);

    expect(group()).toBe("Grouped the selection");
    expect(store.doc.layers[0].items).toHaveLength(1);
  });

  it("throws actionable errors for refused edits", () => {
    const item = makeRect(0, 0, 10, 10);
    store.transact("Fixture", (doc) => doc.layers[0].items.push(item));
    store.setSelection([item.id]);

    expect(group).toThrow(/two or more/);
    expect(() => pathfinder("unite")).toThrow(/two or more/);
    expect(ungroup).toThrow(/selected group/);
    store.clearSelection();
    expect(deleteSelection).toThrow(/selected object/);
    store.replaceDoc(makeDocument(), { markClean: true });
    expect(undo).toThrow(/nothing to undo/);
  });
});
