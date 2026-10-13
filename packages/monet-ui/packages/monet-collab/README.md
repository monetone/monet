# @monet-ui/monet-collab

Real-time collaboration substrate for the Monet apps: bind an app's document
store to a shared **Yjs** CRDT synced over a backend, with **awareness-based
presence** (live cursors + selection). Opt-in and app-agnostic.

This is the pragmatic, working MVP of the plan in
[`docs/realtime-collaboration.md`](../../../../docs/realtime-collaboration.md).
(The long-term "CRDT in the Rust `monet-format` WASM" remains the documented
target; this Yjs-based layer gets working collaboration today.)

## How it works

- **`reflect`** — two-way reflection between an app's plain document tree and a
  Yjs tree. Objects ↔ `Y.Map`; arrays of `{id}` objects ↔ an id-keyed `Y.Map` +
  `__order` list, so concurrent edits to **different** entities (clips, layers,
  items…) merge granularly. Other arrays/scalars are last-writer-wins.
- **`CollabSession`** — one shared doc/room: the `Y.Doc`, the WebSocket transport
  (`y-websocket`), and the awareness channel (cursors/selection).
- **`bindStore`** — bridges the app's whole-state `mutate(...)` model to the CRDT:
  local edit → `reconcile(root, getDoc())`; remote update → `applyRemote(materialize(root))`.
  Echoes are suppressed via the transaction origin.
- **`@monet-ui/monet-collab/react`** — `<CollabCursors>` overlay + `useCollabPresence`
  / `useConnectionStatus` hooks.

## Use it in an app

```ts
import { CollabSession, bindStore } from "@monet-ui/monet-collab";

const session = new CollabSession({ room: "my-doc", wsUrl: "ws://localhost:1234", user });
bindStore(session, {
  getDoc: () => store.getState().doc,           // current plain document
  applyRemote: (doc) => store.applyRemoteDoc(doc), // adopt remote doc (no undo / no re-broadcast)
  subscribe: (fn) => store.subscribe(fn),        // fires on local change
});
```

Publish presence and render peers' cursors:

```tsx
session.setCursor({ x, y });        // document/world coords (correct under any pan/zoom)
session.setSelection(selectedIds);

<CollabCursors session={session} toScreen={worldToScreen} />
```

## Run the sync backend

```bash
pnpm collab:server            # ws://127.0.0.1:1234 (PORT/HOST overridable)
```

In **Artisan**, collaboration turns on with `VITE_COLLAB=1` or a `?room=<id>` URL
param (server URL via `VITE_COLLAB_WS`). Open the same room in two windows to see
each other's cursors and edits live.

## Verify

```bash
pnpm --filter @monet-ui/monet-collab run test       # reflection convergence (unit)
pnpm --filter @monet-ui/monet-collab run test:e2e   # 2 clients + real server: sync + cursors
```

## Status

- ✅ Substrate (reflect / session / binding / presence) + sync server.
- ✅ Wired into **Artisan** (vector canvas) — live document sync + cursors.
- ⏳ Other apps adopt it by implementing the small `CollabStoreAdapter`
  (`getDoc`/`applyRemote`/`subscribe`). Timeline apps (Cinema/Rythme/Jouer) bind
  the shared `TimelineStore`; **Vision** (raster) is a separate, harder track —
  see the design doc.
