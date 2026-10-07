# Native OS dialogs

Thin, typed async helpers over Tauri's `@tauri-apps/plugin-dialog` for opening native file/save dialogs and confirm/ask/message prompts — degrading gracefully (no throw) when run outside a Tauri webview.

All symbols are exported from `@monet-ui/monet-react`:

```tsx
import { openFile, saveFile, confirm, ask, message } from "@monet-ui/monet-react";
```

> **Note on the stylesheet:** these are native OS dialogs rendered by the platform, not DOM/React UI, so they need **no** CSS. For the rest of the Monet React surface, the app imports `@monet-ui/monet-core/index.css` once at its entry point.

> **Note on React:** This group contains **no React components and no hooks** — it is a set of standalone async functions. Each returns a `Promise` and can be called from any event handler, effect, or plain async code.

## Environment & graceful degradation

The plugin module is lazy-imported only when running inside a Tauri webview (guarded by `isTauri()`). Outside Tauri (e.g. `vite dev` in a plain browser), or if the optional `@tauri-apps/plugin-dialog` dependency is missing, every helper resolves to a safe default instead of throwing, and logs a one-time `console.warn`:

| Helper | Default outside Tauri |
| --- | --- |
| `openFile` / `saveFile` | resolves `null` (as if the user cancelled) |
| `confirm` / `ask` | resolves `false` |
| `message` | resolves `undefined` (no-op) |

On the Rust side, register the plugin with `monet_ui::dialog_plugin()` and add the `"dialog:default"` capability so these commands are permitted.

---

## `openFile`

Opens a native file or directory selection dialog. Resolves to the selected path as a `string`, or a `string[]` when `multiple` is `true`. Resolves to `null` if the user cancels (or when outside a Tauri webview).

**Signature**

```ts
function openFile(opts?: OpenFileOptions): Promise<string | string[] | null>
```

**Params** — `opts` (`OpenFileOptions`, optional, defaults to `{}`)

### `OpenFileOptions`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `string` | — | The dialog window title (desktop only). |
| `filters` | `DialogFilter[]` | — | Extension filters to constrain the selectable files. |
| `defaultPath` | `string` | — | Initial directory or file path the dialog opens at. |
| `multiple` | `boolean` | — | Allow selecting more than one path. When `true`, resolves to a `string[]` (or `null` if cancelled). |
| `directory` | `boolean` | — | Select directories instead of files. |
| `recursive` | `boolean` | — | When `directory` is `true`, allow the picked scope to be read recursively later. |
| `canCreateDirectories` | `boolean` | — | Allow creating directories from within the dialog (macOS only). |

All props are optional.

**Returns** — `Promise<string | string[] | null>`: the selected path(s), or `null` if cancelled / outside Tauri.

```tsx
import { openFile } from "@monet-ui/monet-react";

const path = await openFile({
  title: "Open an image",
  filters: [{ name: "Images", extensions: ["png", "jpeg"] }],
});
if (path) console.log("Selected:", path);
```

---

## `saveFile`

Opens a native save dialog. Resolves to the chosen path, or `null` if the user cancels (or when outside a Tauri webview).

**Signature**

```ts
function saveFile(opts?: SaveFileOptions): Promise<string | null>
```

**Params** — `opts` (`SaveFileOptions`, optional, defaults to `{}`)

### `SaveFileOptions`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `string` | — | The dialog window title (desktop only). |
| `filters` | `DialogFilter[]` | — | Extension filters to constrain/suggest the file type. |
| `defaultPath` | `string` | — | Initial directory or suggested file path. |
| `canCreateDirectories` | `boolean` | — | Allow creating directories from within the dialog (macOS only). |

All props are optional.

**Returns** — `Promise<string | null>`: the chosen path, or `null` if cancelled / outside Tauri.

```tsx
import { saveFile } from "@monet-ui/monet-react";

const path = await saveFile({
  title: "Export as…",
  defaultPath: "untitled.png",
  filters: [{ name: "PNG", extensions: ["png"] }],
});
if (path) await writeFile(path, bytes);
```

---

## `confirm`

Shows a native confirmation dialog (Ok / Cancel). Resolves to `true` when the user confirms, `false` when they cancel (or when outside a Tauri webview).

**Signature**

```ts
function confirm(message: string, opts?: ConfirmOptions): Promise<boolean>
```

**Params**

- `message` (`string`, **required**) — the message body shown in the dialog.
- `opts` (`ConfirmOptions`, optional, defaults to `{}`).

### `ConfirmOptions`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `string` | app name | Dialog title. Defaults to the app name. |
| `kind` | `DialogKind` | `"info"` | Dialog kind. One of `"info"`, `"warning"`, `"error"`. |
| `okLabel` | `string` | — | Label of the confirm (Ok) button. |
| `cancelLabel` | `string` | — | Label of the cancel button. |

All props are optional.

**Returns** — `Promise<boolean>`: `true` if confirmed, otherwise `false`.

```tsx
import { confirm } from "@monet-ui/monet-react";

const ok = await confirm("Delete this file permanently?", {
  title: "Confirm delete",
  kind: "warning",
  okLabel: "Delete",
});
if (ok) await remove(path);
```

---

## `ask`

Shows a native question dialog (Yes / No). Resolves to `true` when the user answers Yes, `false` for No (or when outside a Tauri webview).

**Signature**

```ts
function ask(message: string, opts?: AskOptions): Promise<boolean>
```

**Params**

- `message` (`string`, **required**) — the question shown in the dialog.
- `opts` (`AskOptions`, optional, defaults to `{}`).

### `AskOptions`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `string` | app name | Dialog title. Defaults to the app name. |
| `kind` | `DialogKind` | `"info"` | Dialog kind. One of `"info"`, `"warning"`, `"error"`. |
| `okLabel` | `string` | — | Label of the affirmative (Yes) button. |
| `cancelLabel` | `string` | — | Label of the negative (No) button. |

All props are optional.

**Returns** — `Promise<boolean>`: `true` for Yes, `false` for No.

```tsx
import { ask } from "@monet-ui/monet-react";

const yes = await ask("Save changes before closing?", {
  okLabel: "Save",
  cancelLabel: "Discard",
});
```

---

## `message`

Shows a native message dialog with a single Ok button. Resolves when the dialog is dismissed (or immediately as a no-op when outside a Tauri webview).

**Signature**

```ts
function message(message: string, opts?: MessageOptions): Promise<void>
```

**Params**

- `message` (`string`, **required**) — the message body shown in the dialog.
- `opts` (`MessageOptions`, optional, defaults to `{}`).

### `MessageOptions`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `string` | app name | Dialog title. Defaults to the app name. |
| `kind` | `DialogKind` | `"info"` | Dialog kind. One of `"info"`, `"warning"`, `"error"`. |

All props are optional.

**Returns** — `Promise<void>`: resolves once the dialog is dismissed.

```tsx
import { message } from "@monet-ui/monet-react";

await message("Export complete.", { title: "Done" });
```

---

## Types & constants

### `DialogKind`

The kind of a message / confirm / ask dialog. Defaults to `"info"`.

```ts
type DialogKind = "info" | "warning" | "error";
```

Used by `MessageOptions.kind`, `ConfirmOptions.kind`, and `AskOptions.kind`.

### `DialogFilter`

An extension filter for the open/save file dialogs. Extensions are given **without** a leading `.` (e.g. `["png", "jpeg"]`).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | yes | Human-readable filter name shown in the dialog. |
| `extensions` | `string[]` | yes | Extensions to filter by, without the `.` prefix. |

```ts
interface DialogFilter {
  name: string;
  extensions: string[];
}
```

Used by `OpenFileOptions.filters` and `SaveFileOptions.filters`.

```tsx
import type { DialogFilter } from "@monet-ui/monet-react";

const imageFilter: DialogFilter = { name: "Images", extensions: ["png", "jpeg", "webp"] };
```
