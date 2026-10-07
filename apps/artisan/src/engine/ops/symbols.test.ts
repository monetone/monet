// ─────────────────────────────────────────────────────────────
// ops/symbols.test — symbol library and linked instances
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  IO,
  Ops,
  Query,
  makeDocument,
  makeEllipse,
  makeRect,
  rgba,
  solid,
  type GroupItem,
} from "../index";

const group = (doc: ReturnType<typeof makeDocument>, id: string): GroupItem => Query.getItem(doc, id) as GroupItem;

describe("symbol operations", () => {
  it("creates a symbol definition from selected artwork and replaces it with a linked instance", () => {
    const doc = makeDocument("Symbols");
    const rect = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(255, 0, 0)) });
    const ellipse = makeEllipse(50, 0, 30, 30, { fill: solid(rgba(0, 0, 255)) });
    doc.layers[0].items.push(rect, ellipse);

    const result = Ops.Symbols.createSymbolFromSelection(doc, [rect.id, ellipse.id], "Badge", { replaceSelection: true });

    expect(result?.definition.name).toBe("Badge");
    expect(doc.symbols).toHaveLength(1);
    expect(doc.symbols?.[0].items).toHaveLength(2);
    expect(doc.layers[0].items).toHaveLength(1);
    expect(doc.layers[0].items[0].type).toBe("group");
    expect((doc.layers[0].items[0] as GroupItem).symbolInstance).toEqual({ symbolId: result?.definition.id });
    expect(Query.symbolDefinitionEntries(doc)[0]).toMatchObject({ instanceCount: 1 });
    expect(Query.symbolInstanceEntries(doc)[0]).toMatchObject({ symbolName: "Badge", missingDefinition: false });
  });

  it("places, redefines, swaps, and breaks linked symbol instances", () => {
    const doc = makeDocument("Symbol Edits");
    const sourceA = makeRect(0, 0, 20, 20, 0, 0, { fill: solid(rgba(10, 20, 30)) });
    const sourceB = makeEllipse(0, 0, 24, 24, { fill: solid(rgba(200, 30, 60)) });
    doc.layers[0].items.push(sourceA, sourceB);
    const defA = Ops.Symbols.createSymbolFromSelection(doc, [sourceA.id], "A")!.definition;
    const defB = Ops.Symbols.createSymbolFromSelection(doc, [sourceB.id], "B")!.definition;

    const instanceId = Ops.Symbols.placeSymbolInstance(doc, defA.id)!;
    expect(group(doc, instanceId).children[0].type).toBe("rect");

    expect(Ops.Symbols.redefineSymbolFromSelection(doc, defA.id, [sourceB.id])).toBe(true);
    expect(group(doc, instanceId).children[0].type).toBe("ellipse");

    expect(Ops.Symbols.swapSymbol(doc, [instanceId], defB.id)).toEqual([instanceId]);
    expect(group(doc, instanceId).symbolInstance).toEqual({ symbolId: defB.id });
    expect(group(doc, instanceId).name).toBe("B");

    expect(Ops.Symbols.breakLink(doc, [instanceId])).toEqual([instanceId]);
    expect(group(doc, instanceId).symbolInstance).toBeUndefined();
  });

  it("refuses a self-referential redefine without recursing or changing the definition", () => {
    const doc = makeDocument("Recursive Symbol");
    const source = makeRect(0, 0, 20, 20);
    doc.layers[0].items.push(source);
    const definition = Ops.Symbols.createSymbolFromSelection(doc, [source.id], "Tile")!.definition;
    const instanceId = Ops.Symbols.placeSymbolInstance(doc, definition.id)!;
    const definitionBefore = structuredClone(definition.items);
    const instanceBefore = structuredClone(group(doc, instanceId).children);

    expect(Ops.Symbols.redefineSymbolFromSelection(doc, definition.id, [instanceId])).toBe(false);
    expect(definition.items).toEqual(definitionBefore);
    expect(group(doc, instanceId).children).toEqual(instanceBefore);
  });

  it("synchronizes every existing instance after collecting nested targets", () => {
    const doc = makeDocument("Nested Symbol Sync");
    const source = makeRect(0, 0, 20, 20);
    const replacement = makeEllipse(60, 0, 24, 24);
    const filler = makeRect(100, 0, 8, 8);
    doc.layers[0].items.push(source, replacement, filler);
    const definition = Ops.Symbols.createSymbolFromSelection(doc, [source.id], "Tile")!.definition;
    const nestedInstance = Ops.Symbols.placeSymbolInstance(doc, definition.id)!;
    const topLevelInstance = Ops.Symbols.placeSymbolInstance(doc, definition.id)!;
    const wrapperId = Ops.Group.group(doc, [nestedInstance, filler.id])!;

    expect(Ops.Symbols.redefineSymbolFromSelection(doc, definition.id, [replacement.id])).toBe(true);

    expect(group(doc, nestedInstance).children[0].type).toBe("ellipse");
    expect(group(doc, topLevelInstance).children[0].type).toBe("ellipse");
    expect(group(doc, wrapperId).children.map((item) => item.id)).toContain(nestedInstance);
    expect(Query.symbolDefinitionEntries(doc)[0].instanceCount).toBe(2);
  });

  it("duplicates and deletes a definition while detaching its surviving instances", () => {
    const doc = makeDocument("Symbol Library");
    const source = makeRect(0, 0, 20, 20);
    doc.layers[0].items.push(source);
    const definition = Ops.Symbols.createSymbolFromSelection(doc, [source.id], "Tile")!.definition;
    const instanceId = Ops.Symbols.placeSymbolInstance(doc, definition.id)!;

    const copy = Ops.Symbols.cloneDefinition(doc, definition.id)!;
    expect(copy).toMatchObject({ name: "Tile copy" });
    expect(copy.id).not.toBe(definition.id);
    expect(copy.items).toHaveLength(1);
    expect({ ...copy.items[0], id: definition.items[0].id }).toEqual(definition.items[0]);

    expect(Ops.Symbols.deleteSymbolDefinition(doc, definition.id, { detachInstances: true })).toBe(true);
    expect(group(doc, instanceId).symbolInstance).toBeUndefined();
    expect(doc.symbols?.map((symbol) => symbol.id)).toEqual([copy.id]);
  });

  it("round-trips symbol definitions and instance links through JSON", () => {
    const doc = makeDocument("Symbol Roundtrip");
    const source = makeRect(0, 0, 20, 20);
    doc.layers[0].items.push(source);
    const def = Ops.Symbols.createSymbolFromSelection(doc, [source.id], "Tile")!.definition;
    const instanceId = Ops.Symbols.placeSymbolInstance(doc, def.id)!;

    const back = IO.deserializeDocument(IO.serializeDocument(doc));

    expect(back.symbols).toEqual(doc.symbols);
    expect((Query.getItem(back, instanceId) as GroupItem).symbolInstance).toEqual({ symbolId: def.id });
    expect(Query.symbolDefinitionEntries(back)[0]).toMatchObject({ instanceCount: 1 });
  });
});
