// heic.ts — open HEIC/HEIF images (the iPhone camera default). HEVC decode is
// patent-encumbered, so — like Chrome and jSquash — Monet Vision ships no wasm
// HEIC decoder. It decodes through the macOS OS codec in the native `heic`
// Tauri plugin (ImageIO, EXIF orientation honored). This module holds only the
// extension matcher so it stays unit-testable; the opener (openHeic) lives in
// state/app.ts alongside the other importers (it needs the store + Tauri invoke).
// Desktop-only: the browser dev build has no native codec (openHeic surfaces a
// clean "requires the desktop app" message there).

export const HEIC_RE = /\.hei[cf]$/i;
