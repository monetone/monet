// model/shortcuts - document-backed keyboard shortcut settings

import type { ShortcutBinding, ShortcutModifier, ShortcutSettings } from "./types";

const MODIFIER_ORDER: ShortcutModifier[] = ["meta", "alt", "shift"];

export const defaultShortcutSettings = (): ShortcutSettings => ({
  setName: "Artisan Default",
  overrides: [],
});

export const normalizeShortcutBinding = (binding: ShortcutBinding): ShortcutBinding => ({
  key: binding.key.toLowerCase(),
  modifiers: MODIFIER_ORDER.filter((modifier) => binding.modifiers.includes(modifier)),
});

export const shortcutBindingId = (binding: ShortcutBinding): string => {
  const normalized = normalizeShortcutBinding(binding);
  return [...normalized.modifiers, normalized.key].join("+");
};

export const shortcutBindingsEqual = (a: ShortcutBinding, b: ShortcutBinding): boolean =>
  shortcutBindingId(a) === shortcutBindingId(b);

export const resolvedShortcutSettings = (settings?: Partial<ShortcutSettings>): ShortcutSettings => ({
  setName: settings?.setName?.trim() || "Artisan Default",
  overrides: (settings?.overrides ?? []).map((override) => ({
    actionId: override.actionId,
    ...(override.binding ? { binding: normalizeShortcutBinding(override.binding) } : {}),
    ...(override.enabled !== undefined ? { enabled: override.enabled } : {}),
    ...(override.updatedAt ? { updatedAt: override.updatedAt } : {}),
  })),
  ...(settings?.updatedAt ? { updatedAt: settings.updatedAt } : {}),
});

export const formatShortcutBinding = (binding: ShortcutBinding): string => {
  const normalized = normalizeShortcutBinding(binding);
  const parts = normalized.modifiers.map((modifier) => {
    if (modifier === "meta") return "⌘";
    if (modifier === "alt") return "⌥";
    return "⇧";
  });
  const key = normalized.key.length === 1 ? normalized.key.toUpperCase() : normalized.key;
  return `${parts.join("")}${key}`;
};
