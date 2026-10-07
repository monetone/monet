// actions - document-backed Actions panel macros

import { newId } from "../model/factory";
import { findItem } from "../model/query";
import type { ActionStep, ActionStepCommand, Document, DocumentAction, ID } from "../model/types";
import * as Arrange from "./arrange";
import * as Group from "./group";
import * as Items from "./items";

export const ACTION_COMMANDS: ActionStepCommand[] = [
  "duplicate",
  "group",
  "ungroup",
  "bring-to-front",
  "bring-forward",
  "send-backward",
  "send-to-back",
  "delete",
];

export const ACTION_COMMAND_LABELS: Record<ActionStepCommand, string> = {
  duplicate: "Duplicate",
  group: "Group",
  ungroup: "Ungroup",
  "bring-to-front": "Bring to Front",
  "bring-forward": "Bring Forward",
  "send-backward": "Send Backward",
  "send-to-back": "Send to Back",
  delete: "Delete",
};

export interface ActionMutationOptions {
  now?: string;
}

export interface ReplayResult {
  selection: ID[];
  applied: ActionStepCommand[];
}

const actions = (doc: Document): DocumentAction[] => {
  if (!doc.actions) doc.actions = [];
  return doc.actions;
};

export const findAction = (doc: Document, actionId: ID): DocumentAction | undefined =>
  actions(doc).find((action) => action.id === actionId);

export const makeActionStep = (command: ActionStepCommand, opts: Partial<ActionStep> = {}): ActionStep => ({
  id: opts.id ?? newId("actstep"),
  command,
  name: opts.name ?? ACTION_COMMAND_LABELS[command],
  enabled: opts.enabled,
});

export const createAction = (
  doc: Document,
  name: string,
  steps: ActionStep[] = [makeActionStep("duplicate")],
  opts: ActionMutationOptions = {},
): ID => {
  const id = newId("act");
  actions(doc).push({
    id,
    name: name.trim() || `Action ${actions(doc).length + 1}`,
    steps: steps.map((step) => ({ ...step })),
    createdAt: opts.now,
    updatedAt: opts.now,
  });
  return id;
};

export const renameAction = (doc: Document, actionId: ID, name: string, opts: ActionMutationOptions = {}): boolean => {
  const action = findAction(doc, actionId);
  const next = name.trim();
  if (!action || !next) return false;
  action.name = next;
  action.updatedAt = opts.now;
  return true;
};

export const deleteAction = (doc: Document, actionId: ID): boolean => {
  const list = actions(doc);
  const idx = list.findIndex((action) => action.id === actionId);
  if (idx < 0) return false;
  list.splice(idx, 1);
  return true;
};

export const appendActionStep = (
  doc: Document,
  actionId: ID,
  command: ActionStepCommand,
  opts: ActionMutationOptions = {},
): ID | null => {
  const action = findAction(doc, actionId);
  if (!action) return null;
  const step = makeActionStep(command);
  action.steps.push(step);
  action.updatedAt = opts.now;
  return step.id;
};

export const deleteActionStep = (doc: Document, actionId: ID, stepId: ID, opts: ActionMutationOptions = {}): boolean => {
  const action = findAction(doc, actionId);
  if (!action) return false;
  const idx = action.steps.findIndex((step) => step.id === stepId);
  if (idx < 0) return false;
  action.steps.splice(idx, 1);
  action.updatedAt = opts.now;
  return true;
};

export const setActionStepEnabled = (
  doc: Document,
  actionId: ID,
  stepId: ID,
  enabled: boolean,
  opts: ActionMutationOptions = {},
): boolean => {
  const action = findAction(doc, actionId);
  const step = action?.steps.find((candidate) => candidate.id === stepId);
  if (!action || !step) return false;
  step.enabled = enabled;
  action.updatedAt = opts.now;
  return true;
};

const liveSelection = (doc: Document, selection: Iterable<ID>): ID[] =>
  Array.from(new Set(selection)).filter((id) => !!findItem(doc, id));

const runStep = (doc: Document, command: ActionStepCommand, selection: ID[]): ID[] => {
  const ids = liveSelection(doc, selection);
  if (!ids.length) return ids;

  switch (command) {
    case "duplicate": {
      const next = Items.duplicateItems(doc, ids);
      return next.length ? next : ids;
    }
    case "group": {
      const groupId = Group.group(doc, ids);
      return groupId ? [groupId] : ids;
    }
    case "ungroup": {
      const released = Group.ungroup(doc, ids);
      return released.length ? released : ids;
    }
    case "bring-to-front":
      Arrange.bringToFront(doc, ids);
      return ids;
    case "bring-forward":
      Arrange.bringForward(doc, ids);
      return ids;
    case "send-backward":
      Arrange.sendBackward(doc, ids);
      return ids;
    case "send-to-back":
      Arrange.sendToBack(doc, ids);
      return ids;
    case "delete":
      Items.removeItems(doc, ids);
      return [];
    default:
      return ids;
  }
};

export const replayAction = (doc: Document, actionId: ID, selection: Iterable<ID>): ReplayResult => {
  const action = findAction(doc, actionId);
  if (!action) return { selection: liveSelection(doc, selection), applied: [] };

  let current = liveSelection(doc, selection);
  const applied: ActionStepCommand[] = [];
  for (const step of action.steps) {
    if (step.enabled === false) continue;
    current = runStep(doc, step.command, current);
    applied.push(step.command);
  }
  return { selection: liveSelection(doc, current), applied };
};
