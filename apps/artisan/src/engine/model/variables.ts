// model/variables - document-backed data-driven graphics metadata

import { cloneDeep } from "../clone";
import type { DataSet, DataVariable, DataVariableSettings } from "./types";

export const defaultVariableSettings = (): DataVariableSettings => ({
  variables: [],
  dataSets: [],
});

export const resolvedVariableSettings = (
  settings?: Partial<DataVariableSettings>,
): DataVariableSettings => ({
  variables: (settings?.variables ?? []).map((variable) => ({
    id: variable.id,
    name: variable.name?.trim() || "Variable",
    kind: variable.kind,
    ...(variable.binding ? { binding: { ...variable.binding } } : {}),
    ...(variable.createdAt ? { createdAt: variable.createdAt } : {}),
    ...(variable.updatedAt ? { updatedAt: variable.updatedAt } : {}),
  })) as DataVariable[],
  dataSets: (settings?.dataSets ?? []).map((dataSet) => ({
    id: dataSet.id,
    name: dataSet.name?.trim() || "Data Set",
    values: cloneDeep(dataSet.values ?? {}),
    ...(dataSet.createdAt ? { createdAt: dataSet.createdAt } : {}),
    ...(dataSet.updatedAt ? { updatedAt: dataSet.updatedAt } : {}),
  })) as DataSet[],
  ...(settings?.activeDataSetId ? { activeDataSetId: settings.activeDataSetId } : {}),
  ...(settings?.updatedAt ? { updatedAt: settings.updatedAt } : {}),
});
