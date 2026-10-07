# Plans

Numbered plan records for the Monet apps — Vision, Artisan, Galerie, and the
format/packages layer shared by all seven. A **live tracker** still has open
items; a **record** is kept only as history of work that is finished.

## Live trackers

- **[08-open-items.md](08-open-items.md)** — bounded follow-ups for ONNX model
  conversions, the C2PA production cert, a WebCodecs encoder swap, Black Point
  Compensation, and video layers. Most items are done; the C2PA certificate
  purchase and the WebCodecs hardware probe are the user's steps and still open.
- **[13-artisan-qa-audit.md](13-artisan-qa-audit.md)** — Artisan's second QA pass
  (2026-08-09): all four e2e suites run, defects found and fixed. Its "verified
  but not fixed" list is still open, tracked as issues #253–#256 — including the
  tool-teardown class (`mutateFrom` without `onDeactivate`).
- **[14-vision-release-review.md](14-vision-release-review.md)** — Vision's
  release-readiness code review (2026-09-22): verdict no-go, ten blockers filed as
  #504–#513, the rest of the must-fix list, a fix order and every area's health.
  Raw findings with verifier verdicts are in its `.json` sibling.

## Records

- **[10-monet-photo-refactor.md](10-monet-photo-refactor.md)** — completed
  architecture record (all phases done 2026-07-21) for the shared `monet-photo`
  packages behind Vision and Galerie's develop stacks.
- **[11-universal-container.md](11-universal-container.md)** — the agreed design
  for one ZIP container with a per-app extension (`.mvis`, `.mart`, `.mgal`,
  `.mcin`, `.mani`, `.mryt`, `.mjou`), now implemented in `monet-format` and
  adopted by the apps. Its "known limits" section is the live part.
- **[12-artisan-illustrator-gaps.md](12-artisan-illustrator-gaps.md)** — Artisan's
  first QA pass plus the Illustrator feature-by-feature comparison; records what
  was closed in that pass and a ranked ledger of the remaining gaps.
