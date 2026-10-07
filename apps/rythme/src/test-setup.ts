// Vitest setup — initialize the monet-format WASM once (loaded from disk in
// Node) so the synchronous `parse`/`serialize` used by the adapter tests work.
import { initMonetFormat } from "@monet-ui/monet-format";

await initMonetFormat();
