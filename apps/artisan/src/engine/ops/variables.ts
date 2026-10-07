// ops/variables - baseline data-driven graphics variables

import { cloneDeep } from "../clone";
import { newId } from "../model/factory";
import { defaultVariableSettings, resolvedVariableSettings } from "../model/variables";
import { findItem, selectionLeaves } from "../model/query";
import { paintedFill, setPrimaryFill } from "../model/appearance";
import { setText } from "./text";
import type {
  DataSet,
  DataVariable,
  DataVariableKind,
  DataVariableSettings,
  DataVariableValue,
  Document,
  ID,
  Item,
} from "../model/types";

export interface VariableMutationOptions {
  id?: ID;
  now?: string;
}

export interface DataSetApplyResult {
  applied: ID[];
  missing: ID[];
}

const settings = (doc: Document): DataVariableSettings => {
  if (!doc.variables) doc.variables = defaultVariableSettings();
  if (!doc.variables.variables || !doc.variables.dataSets) {
    doc.variables = resolvedVariableSettings(doc.variables);
  }
  return doc.variables;
};

const valueForItem = (item: Item, kind: DataVariableKind): DataVariableValue | null => {
  if (kind === "visibility") return { visible: item.visible !== false };
  if (kind === "text") return item.type === "text" ? { text: item.text } : null;
  if (kind === "fill") return { paint: cloneDeep(paintedFill(item)) };
  return null;
};

const valueMatchesKind = (kind: DataVariableKind, value: DataVariableValue): boolean => {
  if (kind === "visibility") return typeof value.visible === "boolean";
  if (kind === "text") return typeof value.text === "string";
  if (kind === "fill") return !!value.paint;
  return false;
};

export const variableList = (doc: Document): DataVariable[] => settings(doc).variables;

export const dataSetList = (doc: Document): DataSet[] => settings(doc).dataSets;

export const findVariable = (doc: Document, variableId: ID): DataVariable | undefined =>
  variableList(doc).find((variable) => variable.id === variableId);

export const findDataSet = (doc: Document, dataSetId: ID): DataSet | undefined =>
  dataSetList(doc).find((dataSet) => dataSet.id === dataSetId);

export const createVariable = (
  doc: Document,
  name: string,
  kind: DataVariableKind,
  binding?: DataVariable["binding"],
  opts: VariableMutationOptions = {},
): ID => {
  const vars = settings(doc);
  const id = opts.id ?? newId("var");
  vars.variables.push({
    id,
    name: name.trim() || `${kind[0].toUpperCase()}${kind.slice(1)} Variable`,
    kind,
    ...(binding ? { binding: { ...binding, attribute: kind } } : {}),
    ...(opts.now ? { createdAt: opts.now, updatedAt: opts.now } : {}),
  });
  vars.updatedAt = opts.now;
  return id;
};

export const bindVariable = (
  doc: Document,
  variableId: ID,
  itemId: ID,
  opts: VariableMutationOptions = {},
): boolean => {
  const variable = findVariable(doc, variableId);
  const item = findItem(doc, itemId)?.item;
  if (!variable || !item || !valueForItem(item, variable.kind)) return false;
  variable.binding = { itemId, attribute: variable.kind };
  variable.updatedAt = opts.now;
  settings(doc).updatedAt = opts.now;
  return true;
};

export const createVariableFromSelection = (
  doc: Document,
  selection: Iterable<ID>,
  kind: DataVariableKind,
  name: string,
  opts: VariableMutationOptions = {},
): ID | null => {
  for (const item of selectionLeaves(doc, selection))
    if (valueForItem(item, kind)) return createVariable(doc, name, kind, { itemId: item.id, attribute: kind }, opts);
  return null;
};

export const canCreateVariable = (doc: Document, selection: Iterable<ID>, kind: DataVariableKind): boolean =>
  selectionLeaves(doc, selection).some((item) => !!valueForItem(item, kind));

export const deleteVariable = (doc: Document, variableId: ID): boolean => {
  const vars = settings(doc);
  const idx = vars.variables.findIndex((variable) => variable.id === variableId);
  if (idx < 0) return false;
  vars.variables.splice(idx, 1);
  for (const dataSet of vars.dataSets) delete dataSet.values[variableId];
  if (vars.activeDataSetId && !vars.dataSets.some((dataSet) => dataSet.id === vars.activeDataSetId)) {
    delete vars.activeDataSetId;
  }
  return true;
};

export const captureVariableValue = (doc: Document, variableId: ID): DataVariableValue | null => {
  const variable = findVariable(doc, variableId);
  if (!variable?.binding) return null;
  const item = findItem(doc, variable.binding.itemId)?.item;
  return item ? valueForItem(item, variable.kind) : null;
};

export const captureDataSet = (
  doc: Document,
  name: string,
  opts: VariableMutationOptions = {},
): ID => {
  const vars = settings(doc);
  const id = opts.id ?? newId("dataset");
  const values: Record<ID, DataVariableValue> = {};
  for (const variable of vars.variables) {
    const value = captureVariableValue(doc, variable.id);
    if (value) values[variable.id] = value;
  }
  vars.dataSets.push({
    id,
    name: name.trim() || `Data Set ${vars.dataSets.length + 1}`,
    values,
    ...(opts.now ? { createdAt: opts.now, updatedAt: opts.now } : {}),
  });
  vars.activeDataSetId = id;
  vars.updatedAt = opts.now;
  return id;
};

export const deleteDataSet = (doc: Document, dataSetId: ID): boolean => {
  const vars = settings(doc);
  const idx = vars.dataSets.findIndex((dataSet) => dataSet.id === dataSetId);
  if (idx < 0) return false;
  vars.dataSets.splice(idx, 1);
  if (vars.activeDataSetId === dataSetId) vars.activeDataSetId = vars.dataSets[0]?.id;
  return true;
};

export const setActiveDataSet = (doc: Document, dataSetId: ID | null): boolean => {
  const vars = settings(doc);
  if (dataSetId === null) {
    delete vars.activeDataSetId;
    return true;
  }
  if (!vars.dataSets.some((dataSet) => dataSet.id === dataSetId)) return false;
  vars.activeDataSetId = dataSetId;
  return true;
};

export const setDataSetValue = (
  doc: Document,
  dataSetId: ID,
  variableId: ID,
  value: DataVariableValue,
  opts: VariableMutationOptions = {},
): boolean => {
  const variable = findVariable(doc, variableId);
  const dataSet = findDataSet(doc, dataSetId);
  if (!variable || !dataSet || !valueMatchesKind(variable.kind, value)) return false;
  dataSet.values[variableId] = cloneDeep(value);
  dataSet.updatedAt = opts.now;
  settings(doc).updatedAt = opts.now;
  return true;
};

export const applyDataSet = (doc: Document, dataSetId: ID): DataSetApplyResult => {
  const dataSet = findDataSet(doc, dataSetId);
  const result: DataSetApplyResult = { applied: [], missing: [] };
  if (!dataSet) return result;

  for (const variable of variableList(doc)) {
    if (!variable.binding) {
      result.missing.push(variable.id);
      continue;
    }
    const value = dataSet.values[variable.id];
    const loc = findItem(doc, variable.binding.itemId);
    if (!loc || !value || !valueMatchesKind(variable.kind, value)) {
      result.missing.push(variable.id);
      continue;
    }
    if (variable.kind === "visibility") {
      loc.item.visible = value.visible!;
    } else if (variable.kind === "text") {
      if (loc.item.type !== "text") {
        result.missing.push(variable.id);
        continue;
      }
      setText(doc, [loc.item.id], value.text!);
    } else if (variable.kind === "fill") {
      setPrimaryFill(loc.item, value.paint!);
    }
    result.applied.push(variable.id);
  }
  settings(doc).activeDataSetId = dataSetId;
  return result;
};
