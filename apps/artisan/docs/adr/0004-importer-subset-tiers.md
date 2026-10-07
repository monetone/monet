# 4. Importer subset-support tiers

## Status

Accepted.

## Context

Artisan opens several third-party vector formats (SVG/Inkscape, PDF, Adobe
Illustrator, EPS/PS, CorelDRAW). Each is a large, complex specification. Achieving
full fidelity for all of them is impractical, but partial import of the *geometry*
that matters most is highly valuable. The formats also differ wildly in how
openly they are specified — SVG is an open, parseable XML format, while CDR is a
reverse-engineered binary RIFF tree.

## Decision

Importers ship at explicit, documented **fidelity tiers** rather than blocking on
completeness, dispatched by a single magic-byte `detectFormat` in
`src/io/import/index.ts`:

- **Lossless** — `.artisan` native JSON (round-trippable, `monet-artisan` v1).
- **Full** — SVG / Inkscape SVG: shapes, text, images, groups, `use`, paints with
  inheritance, transforms, gradients, viewBox.
- **Subset** — PDF and Adobe Illustrator / EPS / PS: vectors with solid
  fills/strokes and transforms via a content-stream interpreter. Clipping, text,
  and images are skipped. (Modern `.ai` is PDF and routes through the PDF
  importer; legacy `%!PS` runs the same path-operator interpreter.)
- **Best-effort** — CorelDRAW CDR: geometry decoded spec-accurately per the Kaitai
  `coreldraw_cdr.ksy` (`loda`/`trfd` pairs, point-type state machine), but fills
  are defaulted because the fill table is not yet resolved.

Each importer returns an `ImportResult` carrying a `warnings: string[]` channel so
degraded conversions can be reported rather than silently dropped, and each
documents its tier in its file header comment.

## Consequences

- Users get usable imports of partially-supported formats today instead of
  waiting for full parsers; the limits are knowable up front (README support
  matrix + per-importer header comments).
- The `warnings` contract gives a path to surface lossy conversions to the user.
- Each tier can be raised independently (e.g. resolve CDR fills, add PDF clipping)
  without changing the dispatcher contract.
- Untrusted-input formats (notably SVG) require ongoing security hardening — tier
  coverage is about geometry fidelity, not input safety.
