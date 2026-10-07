# Implementation

- `shortcutSets.ts` stores named override maps separately from the existing active bindings and workspace format. A selected name disambiguates sets with identical chords.
- The dialog stages save, save-as, delete, select, and import changes until OK. Cancel discards them. Export writes the current draft explicitly, through the native atomic-save helper or a browser download.
- `.monetkeys` is versioned JSON with a format identifier, set name, and overrides. Import is bounded to 256 KiB and validates names, command IDs, chords, and conflicts against the full application/tool catalog before changing the draft. In the dialog a duplicate import receives a fresh name (a numeric suffix). MCP `shortcuts.importSet` and `shortcuts.saveSet` stay explicit: a name that already exists is refused with an error naming that set, unless `replace: true` is passed or a different name is used.
- MCP exposes list/save/select/delete/import/export through the same validation and persistence helpers. Workspaces continue capturing and applying `keyboardShortcuts` unchanged.

# Verification

- Unit tests cover profile transfer, malformed files, conflicts, default/duplicate-name protection, storage failures, and MCP operations.
- Playwright covers the actual dialog lifecycle, conflict acceptance, Cancel, named-set persistence, file export/import across independent browser profiles, and dispatch after reload.
- Existing keyboard shortcut and workspace regression suites remain required.
