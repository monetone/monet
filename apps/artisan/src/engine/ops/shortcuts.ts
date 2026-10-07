// ops/shortcuts - shortcut editor metadata edits

import { normalizeShortcutBinding, resolvedShortcutSettings } from "../model/shortcuts";
import type { Document, ShortcutBinding, ShortcutOverride, ShortcutSettings } from "../model/types";

export interface ShortcutOverridePatch {
  binding?: ShortcutBinding;
  enabled?: boolean;
  now?: string;
}

export const setShortcutOverride = (
  doc: Document,
  actionId: string,
  patch: ShortcutOverridePatch,
): ShortcutSettings => {
  const current = resolvedShortcutSettings(doc.shortcuts);
  const nextOverride: ShortcutOverride = {
    actionId,
    ...(patch.binding ? { binding: normalizeShortcutBinding(patch.binding) } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : { enabled: true }),
    ...(patch.now ? { updatedAt: patch.now } : {}),
  };
  doc.shortcuts = {
    ...current,
    overrides: [
      ...current.overrides.filter((override) => override.actionId !== actionId),
      nextOverride,
    ],
    ...(patch.now ? { updatedAt: patch.now } : {}),
  };
  return doc.shortcuts;
};

export const resetShortcutOverride = (
  doc: Document,
  actionId: string,
  opts: { now?: string } = {},
): ShortcutSettings => {
  const current = resolvedShortcutSettings(doc.shortcuts);
  doc.shortcuts = {
    ...current,
    overrides: current.overrides.filter((override) => override.actionId !== actionId),
    ...(opts.now ? { updatedAt: opts.now } : {}),
  };
  return doc.shortcuts;
};
