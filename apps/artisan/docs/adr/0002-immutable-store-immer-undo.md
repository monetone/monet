# 2. Immutable store with Immer structural-sharing edits + snapshot undo

## Status

Accepted.

## Context

The editor holds one `EditorState` object that React subscribes to via
`useSyncExternalStore`. To drive React cleanly, each change must yield a new state
reference. Document edits also need undo/redo. An earlier design produced the next
document by deep-cloning the whole `Document` (`structuredClone`) on every edit.
That made each state independent and undo trivial, but cost grew with document
size: every keystroke or drag frame copied the entire tree, defeating per-item
render memoization (every node got a fresh reference) and making large documents
expensive to mutate.

## Decision

Document edits flow through Immer's `produce`. `ArtisanStore.mutate(fn)` (and
`mutateFrom(base, fn)` for interactive drags) run the recipe against an Immer
draft and structurally share the result: only the nodes on the path to an edited
item are copied; untouched subtrees keep their reference identity. Edits are
grouped into **transactions** (`beginTransaction` / `mutate` / `endTransaction`,
or the `transact` helper). Undo/redo is **snapshot-based**: at `endTransaction`
the pre-edit `Document` reference is pushed onto an undo stack (only when the doc
reference actually changed), and undo/redo swap whole-document references.
Selection, view, tool, and other ephemeral editor state do **not** participate in
undo; the captured selection is restored alongside the doc, with ids that no
longer exist filtered out. The undo stack is capped at **250 entries** (oldest
dropped).

## Consequences

- Untouched subtrees keep reference identity, so per-item render memoization stays
  effective and large-document edits are far cheaper than full clones.
- Undo snapshots are cheap because consecutive document snapshots share most of
  their structure rather than being independent deep copies.
- Immer freezes produced state, reinforcing immutability; recipe return values
  (e.g. ids returned by ops) are intentionally discarded so Immer never treats a
  return as a state replacement.
- Undo depth is bounded at 250 entries — older history is irrecoverable, a
  deliberate trade of unlimited history for bounded memory.
- A leaked transaction (begin without end) is auto-committed when the next
  transaction begins; tools are responsible for ending or cancelling their own
  transactions on deactivation.
