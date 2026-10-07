# Design: Real-time collaboration across the Monet apps

**Status:** Substrate shipped — see §1a. §§2–10 are the original feasibility
assessment, kept for the design intent and the work still ahead; where shipped
code has since settled a question it is marked inline.
**Date:** 2026-06-18 (assessment); §1a tracks the implementation
**Scope:** The five apps surveyed in §1's table (Artisan, Cinema, Jouer, Rythme,
Vision) + the shared `monet-ui` / `monet-format` layer. Anime and Galerie are not
wired for collaboration and are not assessed here.
**Author:** Engineering (assessment grounded in a per-app survey of the current code)

---

## 1. Summary

Making the `.monet` model syncable for live multi-user collaboration is a **foundational capability, not a feature flag**. The runtime toggle ("collaboration: on/off") is trivial; the substrate behind it is on the order of **months**.

The encouraging part: the codebase is unusually collab-friendly in the ways that matter most — a small serializable document tree, a single mutation choke point, and heavy binary data kept out of the document. The expensive part: a few cross-cutting systems must be rebuilt (operation/CRDT layer, globally-unique ids, collaborative undo, the entire backend), and **Vision (raster painting) is a materially harder, separate problem** from the rest.

**Verdict by app:**

| App | Difficulty | One-line reason |
|---|---|---|
| Artisan (vector) | 🟢 Moderate | Figma-shaped: normalized tree, no engine-held state, images are the only blobs |
| Cinema (video) | 🟢 Moderate | Compact tree, stateless compositor, clean live↔`.monet` adapter, media is by-reference |
| Jouer (2D game) | 🟢 Moderate | Near-ideal JSON tree; Phaser is a pure projection of state |
| Rythme (audio) | 🟡 Hard | Structural timeline is easy; **PCM is inlined in the doc** → needs a blob subsystem |
| Vision (raster) | 🔴 Very hard | **State lives in WASM memory; collaborative painting has no off-the-shelf CRDT.** Now wired via a stroke-operation channel (brush/erase) — see §1a |

---

## 1a. Implementation status (MVP shipped)

A working MVP of this design now exists as **`@monet-ui/monet-collab`** (see its
README). It takes the pragmatic **Yjs + y-websocket + awareness** path from §4's
"alternative considered" to get collaboration working today. The Rust-in-WASM
substrate §§4–7 argue for was built behind a `crdt` Cargo feature, never enabled
by any build, and has since been removed (see §1a); those sections are kept for
the reasoning, not as a committed plan.

Shipped:
- **Substrate** — `reflect` (plain `.monet` tree ↔ Yjs, id-keyed granular merge),
  `CollabSession` (doc + WebSocket transport + awareness), `bindStore` (bridges
  the apps' whole-state `mutate(...)` model, echo-suppressed), and an
  awareness-based presence channel.
- **Live cursors** — `@monet-ui/monet-collab/react` `<CollabCursors>` overlay +
  hooks; users see each other's cursor (in world coords, correct under pan/zoom)
  and selection.
- **Sync backend** — `scripts/collab-server.mjs` (in-memory y-websocket-compatible
  relay), run with `pnpm collab:server`.
- **Apps wired** — collaboration is now integrated into **four of the five apps in §1's table**,
  all opt-in via `VITE_COLLAB=1` or `?room=…`, each via a small per-app
  `src/collab/index.ts` `startCollab(store)` over the shared `CollabStoreAdapter`:
  - **Artisan** (vector) — document edits + live cursors.
  - **Cinema** (video) — timeline `Project` synced; quiet `applyRemoteProject`
    adopts remote edits without an undo step or echo.
  - **Jouer** (2D game) — scene `Project` synced the same way.
  - **Rythme** (audio) — **structure syncs; PCM stays out of the CRDT.** The
    adapter strips each `Clip.buffer` (`Float32Array[]`) to a descriptor
    (sampleRate/channels/frames) before reflecting and restores samples from a
    local content cache keyed by clip id (`apps/rythme/src/collab`). This is the
    "blob subsystem" applied at the structural layer; cross-peer transfer of
    *new* audio buffers is the remaining side-channel (unknown buffers resolve to
    correct-length silence until delivered).
- **Verified** — reflection convergence unit tests + a two-client end-to-end test
  through the real server (`test:e2e`); and all four wired apps typecheck cleanly
  against the substrate.

**Vision** (raster) — now wired via a **stroke-operation channel** (the engine
merge, `docs/merged-engine-and-format.md`, makes its vector/structure collab-able
too). Because raster pixels live in WASM memory and change per stroke, whole-state
reflect is wrong here; instead each completed local **brush/erase** stroke is
captured (`EngineClient.strokeCapture*`, gated to brush/erase in `CanvasView`) and
broadcast as an op `{layer, brush, points}` over `monet-collab`'s `OpLog`; peers
replay it onto the same layer via `EngineClient.applyRemoteStroke`. Pixels never
travel through the CRDT — only the strokes that produced them. v1 covers brush +
erase; clone/heal/smudge/dodge/burn don't broadcast (they need the tool mode +
clone source the op doesn't carry, so they're safely skipped), and a late-join
raster *snapshot* (so a joiner sees pre-existing pixels, not just future strokes)
is the remaining piece. Runtime two-client validation of co-painting is still to
be done; the `OpLog` substrate itself is unit-tested.

**Substrate advances since the MVP** (all unit-tested in `monet-collab`):
- **Globally-unique ids (was GAP 2).** Every minter now mixes a per-session random
  token with the counter (`monet-timeline` `newId`, Rythme `ids.ts`; Artisan/Jouer
  already did) so two collaborators never mint the same `clip_N`. `resetIds()`
  clears the token for deterministic test ids; production never resets. Verified by
  the timeline (14) + rythme model (20) + cinema timeline (50) suites.
- **Collaborative per-user undo (was GAP 3).** `CollabSession` exposes a
  `Y.UndoManager` scoped to `LOCAL_ORIGIN` (+ `undo`/`redo`/`canUndo`/`canRedo`):
  undo reverts *your* edits and never a merged-in collaborator's. Unit-tested.
- **Content-addressed blob channel (was GAP 5).** `BlobStore` (`session.blobs`)
  syncs large binary out of the document tree, addressed by content hash; the doc
  carries only the hash. Rythme's adapter now routes **PCM through it** (silence
  until a peer's blob arrives, then the doc re-applies). Unit-tested (idempotent
  addressing + two-peer transfer).

- **Fractional-index list-CRDT (was GAP 6).** Ordered id-collections now store a
  per-item fractional position key (`fracdex.keyBetween`, fuzz-tested over 4000
  random insertions) in a `__pos` `Y.Map<id,key>` — `materialize` sorts by it.
  Concurrent inserts **and** reorders converge, and because each id owns one
  position slot an item can never be duplicated or dropped (a concurrent
  same-item move is last-writer per item). Unit-tested for both convergence cases.
- **Durable backend (was GAP 4).** `scripts/collab-server.mjs` now PERSISTS each
  room's Yjs state to `COLLAB_DATA/<room>.bin` (debounced) and reloads it on the
  next join, so a late-joiner reconstructs the document even after every client
  left; and enforces optional token AUTH (`COLLAB_TOKEN` ↔ `CollabOptions.token`).
  Verified end-to-end (write → all clients leave → new client reconstructs the
  doc; tokenless connection rejected).
- **Canonical CRDT in Rust (was GAP 1) — built, then removed.** A
  `monet_format::crdt` module ported the reflect strategy onto `yrs` behind a
  non-default `crdt` feature. Nothing in the repo ever enabled that feature, so no
  build ever compiled it, and it has since been deleted along with the feature and
  the optional `yrs` dependency. GAP 1 is closed by the TypeScript yjs path in
  `packages/monet-ui/packages/monet-collab`, which is what every wired app runs.

Still to do — the **adoption + hardening** layer on top of the now-complete
substrate: UI adoption of `session.undo()` (apps
still use their local snapshot undo until then); a Vision late-join raster
*snapshot* + broadcasting the non-brush tools (clone/heal/smudge/…); promoting
the server's auth beyond a shared token to real per-user identity; and runtime
two-client validation passes for the newer integrations (Cinema/Jouer/Rythme/
Vision) to match Artisan's `test:e2e`.

## 2. Goals & non-goals

**Goals**
- Optional, per-document real-time collaboration: multiple users editing the same `.monet` project with low-latency convergence.
- A **shared** collaboration substrate (one implementation reused by every app), not five bespoke ones.
- Presence: live cursors / selection / playhead.
- Offline-capable / late-join: a client can join, catch up, and reconcile.

**Non-goals (initially)**
- Collaborative raster *painting* in Vision (treated as a separate, later track — see §6). *Partly shipped since: brush/erase strokes broadcast as ops, §1a.*
- Server-side rendering/transcoding.
- Permissions/ACL beyond basic room membership (can layer on later).

---

## 3. Current architecture — what helps, what hurts

The survey found a consistent shape across all apps.

### 3.1 What already helps (the hard blockers are largely absent)

- **The document is a small, serializable, framework-free tree.** Cinema: `Project → media[] + sequences[] → Track[] → Clip[]` (`apps/cinema/src/timeline/model/types.ts`). Artisan/Jouer: normalized item/entity trees. All scalars, short strings, small arrays — textbook CRDT material.
- **One mutation choke point.** Every structural edit funnels through `TimelineStore.mutate(label, fn)` (`packages/monet-ui/packages/monet-timeline/src/store.ts`), subclassed by each app's `Store`. This is the single seam to (a) emit operations and (b) apply remote operations.
- **Heavy binary is deliberately out of the document.** Cinema clips reference media by `mediaId` + path; decoded frames / waveform peaks / thumbnails live in a runtime-only registry (`apps/cinema/src/media/registry.ts`) that is never serialized and never on the undo stack.
- **The compositing engine holds no document state (mostly).** Cinema's WASM engine is a stateless-per-frame compositor reprogrammed from the model every frame — there is no out-of-JS-reach state to sync. (Vision is the exception; see §6.)
- **Live model ↔ `.monet` is an isomorphic adapter.** `apps/cinema/src/timeline/io/monet-adapter.ts` maps field-for-field with stable ids, so a sync layer can operate on the live tree and reuse the format only at save/load.

### 3.2 What hurts (cross-cutting, applies to every app)

1. **No operations on the wire.** `mutate` does `structuredClone(project)` and swaps the whole tree; edits are imperative in-place mutations (`ops.ts`, `edits.ts`). There are no discrete, serializable ops to broadcast. → Must introduce a CRDT as the source of truth, or extract Immer patches / before-after diffs into ops. **Done:** `monet-collab`'s `reflect` + `bindStore` sit on that seam.
2. **IDs collide.** `newId()` is a session-monotonic counter (`packages/monet-ui/packages/monet-timeline/src/model.ts`, app `factory.ts`s) — `clip_1`, `clip_2`, … Two clients mint the same id. → Globally-unique ids (UUID / client-scoped) everywhere ids are minted. **Done:** every minter now mixes a per-session token.
3. **Undo is snapshot-based and local.** Whole-project clones on a stack — incompatible with multi-user (a global undo clobbers others' concurrent edits). → Per-user, operation-scoped undo (Yjs `UndoManager`-style). One of the genuinely hard problems. **Done in the substrate** (`session.undo()`); the apps still run their local snapshot undo, so UI adoption is outstanding.
4. **The backend was greenfield.** At the time of the survey there were no WebSocket/WebRTC/CRDT/auth/DB dependencies anywhere; apps were local Tauri/file-based. → Transport, awareness/presence, identity/auth and server persistence all had to be built. **Done:** `@monet-ui/monet-collab` (Yjs + `y-websocket` + awareness) plus `scripts/collab-server.mjs` (room persistence + shared-token auth). Real per-user identity is still outstanding.
5. **Presence is entangled with the document.** Selection/playhead/active-layer are single global fields today; interactive drags emit many coalesced whole-state commits. → Split into ephemeral *awareness* state on a separate channel; throttle/batch drag streams. **Done:** `monet-collab`'s awareness-based presence channel.
6. **Some docs embed binary that must be externalized.** Rythme inlines PCM (base64) in the `.monet`; Artisan/Jouer inline images as `data:` URLs inside the tree. → Move to out-of-band, content-addressed blob storage; the doc holds only an id/hash. **Done:** `BlobStore` (`session.blobs`); Rythme routes PCM through it.

---

## 4. Recommended architecture

**Put the CRDT in the shared Rust `monet-format` crate, compiled into the same WASM both frontends already load.**

We just consolidated the `.monet` format into `packages/monet-ui/crates/monet-format` (Rust → WASM, consumed by every app). That crate is the natural home for a CRDT document model: model `MonetDocument` on a Rust CRDT (`yrs`, `automerge-rs`, or `loro`) behind a feature flag, and collaboration becomes a **shared capability every app inherits** rather than five separate integrations.

```
┌─────────────────────────────────────────────────────────────┐
│ App (Cinema / Artisan / …)                                   │
│   UI ──edit──▶ store.mutate(label, fn) ──┐                   │
│   UI ◀─subscribe── store ◀───────────────┤                   │
└──────────────────────────────────────────┼──────────────────┘
                                            │ ops in / out
                              ┌─────────────▼───────────────┐
                              │ monet-format WASM (shared)   │
                              │   CRDT doc (yrs/automerge/   │
                              │   loro) = MonetDocument      │
                              │   + presence/awareness       │
                              └─────────────┬───────────────┘
                                            │ encoded updates
                ┌───────────────────────────▼──────────────────┐
                │ Sync backend: relay + persistence + auth      │
                │ + content-addressed blob store (media/PCM/img)│
                └───────────────────────────────────────────────┘
```

**The central design decision this forces:** today JS owns the authoritative state. Hosting the CRDT in WASM **moves the authoritative document into Rust/WASM**, and there are two document representations today (the TS `monet-timeline` model and the Rust `monet-format` schema). We must pick a canonical owner and accept a hot JS↔WASM edit boundary. This is the main thing to validate in a spike (§7) before committing.

**Alternative considered — and taken as the interim path:** a JS-side CRDT (Yjs) in *one shared* package rather than per app. That is what shipped as `@monet-ui/monet-collab`, which avoids the re-fragmentation this section feared. A Rust `monet_format::crdt` core was later built behind a non-default `crdt` feature, but no build ever enabled it and it has since been removed; the JS package is what collaboration runs on.

---

## 5. Cross-cutting work items

- **Operation layer:** intercept `store.mutate` to produce CRDT mutations (or extract Immer JSON patches via `enablePatches`); re-express the imperative editors in `ops.ts`/`edits.ts` against the CRDT doc. Apply remote updates back through the same seam.
- **Globally-unique ids:** replace `newId()` counters with UUID/client-scoped ids in `monet-timeline/src/model.ts` and every app factory; reuse the existing `reid*`/dup-id-detection helpers that already exist for foreign-import collisions.
- **Collaborative undo:** per-user, op-scoped undo replacing snapshot stacks.
- **Awareness/presence channel:** cursors, selection, playhead — separate from the document CRDT; throttled.
- **Asset/blob subsystem:** content-addressed store (hash → bytes) with a local cache (IndexedDB/OPFS) + backend object store + lazy fetch; clips/images/PCM reference by id+hash. Biggest single chunk for Rythme.
- **Backend:** sync relay (WebSocket/WebRTC), document persistence + snapshotting for late-joiners, identity/auth, room/session model.
- **Merge-invariant normalization:** editorial invariants (no per-track clip overlap; sorted/deduped keyframes; valid z-order; tree-move without cycles) must converge deterministically after concurrent edits — list-CRDT with fractional indexing for ordered arrays; deterministic re-sort.

---

## 6. Vision (raster) is a separate, harder problem

Vision is rated **very hard** for reasons the others are not:

- **State lives in WASM linear memory** (the merged engine crate `packages/engine`; Vision's own `apps/vision/engine/` crate was folded into it — see `docs/merged-engine-and-format.md`), by design — pixels are kept out of JS for performance. There is no JS document to attach a CRDT to; the op-log/CRDT must live *inside* Rust or the engine must expose its model to JS (a large perf-regressing re-architecture).
- **Collaborative painting has no off-the-shelf CRDT.** Two users painting the same region concurrently resolves only via tile-level last-writer-wins (data loss) or region locking (kills the real-time feel). This is research-grade.
- **~140 imperative engine actions + the brush stroke path** must each be reified into a serializable, replayable op protocol; snapshot undo (`Snap::LayerPx`/`Stack`) must become op-derived per-user undo.
- **Canvas-geometry ops** (crop/resize/rotate) reshape every buffer — a hard global-barrier coordination problem mid-session.

**Recommendation:** stage Vision separately. True low-latency co-painting remains a later, dedicated project.

**What shipped instead of the full-buffer broadcast:** completed brush/erase
strokes are captured and broadcast as ops `{layer, brush, points}` and replayed
by peers — pixels never cross the wire. See §1a for the coverage gaps (non-brush
tools, late-join raster snapshot).

---

## 7. Phased plan

*Steps 1–3 are done (via the JS substrate rather than the WASM-first order below);
step 4 is partly done. Kept for the reasoning.*

1. **Spike (1–2 weeks).** Prototype `yrs`/`loro` inside the `monet_format` WASM with a couple of real `ops.ts` operations round-tripping between two clients. Decide canonical document ownership (Rust vs TS) and the id/undo approach. *De-risks the whole estimate before committing.*
2. **Shared substrate (~3–5 months).** CRDT doc in the crate (feature-flagged) + operation seam + globally-unique ids + awareness channel + minimal sync relay + persistence + blob store. First real target: **Artisan or Cinema** (cleanest) → live cursors, mergeable structural edits, per-user undo, out-of-band images.
3. **Generalize to Jouer**, then **Rythme** (build the audio-blob subsystem).
4. **Vision** as its own track (structured-tree sync first, then explore co-painting).

---

## 8. Effort (rough, one strong engineer unless noted; much is shared after the substrate)

| Piece | Estimate |
|---|---|
| De-risking spike | 1–2 weeks |
| Shared substrate (small team) | 3–5 months |
| First app to MVP (Artisan/Cinema), given the substrate | ~6–10 weeks |
| Jouer | ~2–3.5 months |
| Rythme (incl. audio-blob subsystem) | ~2–4 months |
| Vision (structured sync; co-painting excluded) | 4–8+ months, effectively a re-architecture |

A **collaborative MVP on one structured-document app** (incl. the shared substrate) is realistically **~2–3 months**; **all apps except Vision raster** ~6–9 months; Vision co-painting is a further large project.

---

## 9. Open questions / decisions

1. ~~**CRDT library**~~ **Decided: Yjs** — the JS substrate uses Yjs. Ordered collections use fractional indexing rather than a movable tree.
2. **Canonical document owner:** still open. The TS model is authoritative today; the Rust core built to own it long-term was removed without ever being wired into a build.
3. ~~**Undo model**~~ **Decided: Yjs `UndoManager`-style per-origin undo**, shipped as `session.undo()`. Open only in that the apps have not adopted it yet.
4. **Backend host:** a self-hosted WebSocket relay (`scripts/collab-server.mjs`) is what runs today; whether to keep it or move to a managed service for production is still open.
5. **Blob store:** where bytes live (S3-style object store), CDN, and the local cache layer (OPFS vs IndexedDB).
6. **Auth/identity & sharing model.**

---

## 10. Risks

- **JS↔WASM edit-boundary cost** if the authoritative doc moves into Rust — must be measured in the spike.
- **Intent-preserving merge** of relational edits (ripple/roll/slide in Cinema, pathfinder/boolean ops in Artisan) — naive CRDT merge can violate editor invariants.
- **Collaborative undo** is historically the part that sinks schedules.
- **Vision co-painting** has no proven off-the-shelf solution — scope it out of the first releases.
- The work **touches the shared editing core** every app depends on; regressions there are high-blast-radius. Feature-flag throughout and keep the snapshot path working until the CRDT path is proven.
