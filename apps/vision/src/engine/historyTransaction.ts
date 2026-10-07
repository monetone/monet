// The engine's history-transaction predicate, kept OUT of EngineClient so the
// modules that only need the guard (store, MCP, dialogs) do not drag the wasm
// `@engine` import into a node unit test. Structurally typed for the same
// reason the query below is optional: the generated WASM declaration can lag
// the Rust export during a rebuild.

type HistoryTransactionQueryable = { history_transaction_active?: () => boolean };

/** `object` rather than the query type itself: a wasm `Engine` whose generated
 *  declaration lags the Rust export shares no property with it, which is
 *  exactly the case this guard has to survive. */
export function historyTransactionActive(engine: object | null | undefined): boolean {
  return (engine as HistoryTransactionQueryable | null | undefined)?.history_transaction_active?.() === true;
}

export const HISTORY_TRANSACTION_IO_BLOCKED = "Finish or cancel the current edit before saving or exporting.";

export function assertHistorySettled(engine: object | null | undefined): void {
  if (historyTransactionActive(engine)) throw new Error(HISTORY_TRANSACTION_IO_BLOCKED);
}
