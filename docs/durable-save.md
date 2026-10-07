# Durable save — one implementation, every app

A plain `writeFile` **truncates the destination before the new bytes land**. If
the write is interrupted — crash, power cut, full disk — the user is left with
neither the old document nor the new one. Every Monet app now writes through one
shared implementation instead.

## The two halves

| Half | Where | What it does |
| --- | --- | --- |
| TS | `@monet-ui/monet-react` ▸ `atomicWriteBytes` | picks the durable native path, falls back to write-sibling + rename |
| Rust | `monet_ui::atomic_save_plugin()` | the `atomicsave` plugin: write → flush → **fsync** → rename → fsync(parent dir) |

`fsync` is the half that matters for power loss, and `tauri-plugin-fs` cannot
express it — it only does `write_all` and exposes no sync at all, so a rename
could reach disk while the data was still in the page cache. On macOS a plain
`fsync` only pushes to the drive's write cache, so the plugin uses `F_FULLFSYNC`
where the filesystem supports it and falls back to `sync_all` when it does not.

Both halves are required. With the TS half alone the write is still *crash-safe*
(a complete sibling is renamed over the destination — rename is the only atomic
step a filesystem gives us) but **not power-loss durable**. That gap used to be
swallowed by a silent `catch`; it now logs once per session:

```
[monet] durable save unavailable — falling back to write+rename (no fsync).
```

If you see that in a desktop build, the app is missing
`monet_ui::atomic_save_plugin()` or its capability does not allow the command.

## Using it

```rust
// src-tauri/src/main.rs
tauri::Builder::default()
    .invoke_handler(monet_ui::invoke_handler())
    .plugin(monet_ui::atomic_save_plugin())
```

```ts
import { atomicWriteBytes } from "@monet-ui/monet-react";

await atomicWriteBytes(path, bytes); // never a bare writeFile for user data
```

## Where each app writes

| App | Plugin | Document/project writes routed |
| --- | --- | --- |
| vision | ✅ | ✅ (originator of this code) |
| artisan | ✅ | ✅ `io/files.ts` — `writeBytesTo` / `writeTextTo` |
| cinema | ✅ | ✅ `io/files.ts` — the shared `writeFile` helper |
| jouer | ✅ | ✅ `io/files.ts` — `writeBytes` |
| rythme | ✅ | ✅ `ui/io-web.ts` — `saveNativeBytes` |
| anime | ✅ | ✅ `io/files.ts` |
| galerie | ✅ | — see below |

**Galerie is deliberately not routed.** Its TS writes are all *exports* to a
path the user picks in a save dialog (book pages, print pages, exported images,
web galleries) — regenerable from the catalog, which is not written through
this path. Routing them would also mean reworking nine export test files whose
assertions are built on plugin-fs's direct-write semantics (they assert the
written path, which under a temp-file + rename becomes the temp path). The
plugin is registered, so the moment Galerie gains an in-place document save it
gets durability by switching one call.

## Testing note (read before moving this code)

`atomic-write.ts` and its two test files live **in the package**, not in an app.
That is deliberate: Vitest externalizes a workspace dependency, so an app's
`vi.mock("@tauri-apps/api/core")` cannot reach through the package boundary into
this module. The native-path test needs exactly that mock, so it has to run
where the module is source.

For the same reason, an app testing its *own* save path should now mock
`@monet-ui/monet-react`'s `atomicWriteBytes` rather than plugin-fs's
`writeFile` — the seam moved. Artisan (`io/native-files.test.ts`,
`io/container-courier.test.ts`) and Rythme (`ui/io-web.test.ts`) show the shape.
