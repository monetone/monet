// ops/variables.test - data-driven graphics variables

import { describe, expect, it } from "vitest";
import {
  IO,
  Ops,
  makeDocument,
  makeRect,
  makeText,
  rgba,
  solid,
  paintedFill,
  type RectItem,
  type TextItem,
} from "../index";

describe("variable operations", () => {
  it("binds variables, applies data set values, and round-trips through JSON", () => {
    const doc = makeDocument("Variables");
    const label = makeText("Alice", 0, 0);
    const badge = makeRect(0, 80, 100, 40, 0, 0, { fill: solid(rgba(255, 0, 0)) });
    doc.layers[0].items.push(label, badge);

    const textVar = Ops.Variables.createVariableFromSelection(doc, [label.id], "text", "Name")!;
    const visibilityVar = Ops.Variables.createVariableFromSelection(doc, [badge.id], "visibility", "Badge Visible")!;
    const fillVar = Ops.Variables.createVariableFromSelection(doc, [badge.id], "fill", "Badge Color")!;
    const dataSet = Ops.Variables.captureDataSet(doc, "Primary");

    expect(doc.variables?.variables.map((variable) => variable.name)).toEqual(["Name", "Badge Visible", "Badge Color"]);
    expect(doc.variables?.dataSets[0].values[textVar]).toEqual({ text: "Alice" });

    expect(Ops.Variables.setDataSetValue(doc, dataSet, textVar, { text: "Bob" })).toBe(true);
    expect(Ops.Variables.setDataSetValue(doc, dataSet, visibilityVar, { visible: false })).toBe(true);
    expect(Ops.Variables.setDataSetValue(doc, dataSet, fillVar, { paint: solid(rgba(0, 128, 255)) })).toBe(true);

    const result = Ops.Variables.applyDataSet(doc, dataSet);

    expect(result).toEqual({ applied: [textVar, visibilityVar, fillVar], missing: [] });
    expect((doc.layers[0].items[0] as TextItem).text).toBe("Bob");
    expect((doc.layers[0].items[1] as RectItem).visible).toBe(false);
    expect((doc.layers[0].items[1] as RectItem).fill).toMatchObject({ type: "solid", color: { r: 0, g: 128, b: 255 } });
    expect(doc.variables?.activeDataSetId).toBe(dataSet);

    const restored = IO.deserializeDocument(IO.serializeDocument(doc));
    expect(restored.variables?.variables).toEqual(doc.variables?.variables);
    expect(restored.variables?.dataSets).toEqual(doc.variables?.dataSets);
  });

  it("guards incompatible text bindings and removes deleted variable values", () => {
    const doc = makeDocument("Variable Guards");
    const rect = makeRect(0, 0, 20, 20);
    doc.layers[0].items.push(rect);

    expect(Ops.Variables.createVariableFromSelection(doc, [rect.id], "text", "Bad Text")).toBeNull();
    const fillVar = Ops.Variables.createVariableFromSelection(doc, [rect.id], "fill", "Fill")!;
    const dataSet = Ops.Variables.captureDataSet(doc, "Snapshot");

    expect(doc.variables?.dataSets[0].values[fillVar]).toBeTruthy();
    expect(Ops.Variables.deleteVariable(doc, fillVar)).toBe(true);
    expect(doc.variables?.variables).toHaveLength(0);
    expect(doc.variables?.dataSets.find((entry) => entry.id === dataSet)?.values[fillVar]).toBeUndefined();
  });

  it("enables and binds the eligible item in a mixed selection", () => {
    const doc = makeDocument("Mixed Variables");
    const rect = makeRect(0, 0, 20, 20);
    const text = makeText("Headline", 0, 0);
    doc.layers[0].items.push(rect, text);

    expect(Ops.Variables.canCreateVariable(doc, [rect.id, text.id], "text")).toBe(true);
    const variableId = Ops.Variables.createVariableFromSelection(doc, [rect.id, text.id], "text", "Headline")!;
    expect(doc.variables?.variables.find((variable) => variable.id === variableId)?.binding?.itemId).toBe(text.id);
  });

  it("clears rich runs and cached layout when applying a text data set", () => {
    const doc = makeDocument("Rich Text Variable");
    const label = makeText("Sale", 0, 0);
    label.runs = [{ text: "Sale", fontWeight: 700 }];
    label.layout = { engine: "test", version: 1, runs: [] };
    doc.layers[0].items.push(label);
    const variable = Ops.Variables.createVariableFromSelection(doc, [label.id], "text", "Headline")!;
    const dataSet = Ops.Variables.captureDataSet(doc, "Clearance");
    Ops.Variables.setDataSetValue(doc, dataSet, variable, { text: "Clearance" });

    Ops.Variables.applyDataSet(doc, dataSet);

    expect(label).toMatchObject({ text: "Clearance", name: "Clearance" });
    expect(label.runs).toBeUndefined();
    expect(label.layout).toBeUndefined();
  });

  it("captures and restores the top painted appearance fill", () => {
    const doc = makeDocument("Stacked Variables");
    const red = solid(rgba(255, 0, 0));
    const blue = solid(rgba(0, 0, 255));
    const green = solid(rgba(0, 180, 0));
    const badge = makeRect(0, 0, 40, 40, 0, 0, { fill: red });
    badge.appearance = { entries: [
      { id: "bottom", kind: "fill", paint: red },
      { id: "top", kind: "fill", paint: blue },
    ] };
    doc.layers[0].items.push(badge);
    const variable = Ops.Variables.createVariableFromSelection(doc, [badge.id], "fill", "Color")!;
    const dataSet = Ops.Variables.captureDataSet(doc, "Blue");
    expect(doc.variables!.dataSets[0].values[variable]).toEqual({ paint: blue });

    Ops.Appearance.updateEntry(doc, [badge.id], "top", { paint: green });
    Ops.Variables.applyDataSet(doc, dataSet);

    expect(paintedFill(badge)).toEqual(blue);
  });
});
