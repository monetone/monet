// ─────────────────────────────────────────────────────────────
// Monet — creative color graphics sibling (paint + future SVG)
// ─────────────────────────────────────────────────────────────
// The named graphics sibling re-exported by creative-color.tsx (mirroring
// primitives-graphics / creative-tree). The pure color-space math + CSS paint
// string builders live in creative-color-math.ts — a `.ts` file so the zero-dep
// `node:test` suite can import them directly (Node refuses `.tsx`). This module
// simply re-exports that surface (and is the home for any JSX/SVG color visuals
// the components grow later), so callers have one import site.

export * from "./creative-color-math";
