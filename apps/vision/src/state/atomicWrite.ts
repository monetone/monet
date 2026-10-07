// Durable document writes. The implementation is shared by every Monet app and
// lives in the design system (`@monet-ui/monet-react` ▸ atomic-write), paired
// with `monet_ui::atomic_save_plugin()` on the Rust side.
//
// This re-export keeps Vision's existing import paths — and the `vi.mock`s that
// target them — pointing at one module.
export { atomicWriteBytes, type AtomicWriteOperations } from "@monet-ui/monet-react";
