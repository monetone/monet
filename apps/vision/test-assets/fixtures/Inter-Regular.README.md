# e2e test fixtures

## Inter-Regular.woff2

Test-only font fixture for the OpenType-toggle e2e (`e2e/opentype-toggles.spec.ts`).
It is injected into the page via `@font-face`/`FontFace` at test time and is **not**
bundled into the app.

- **Font:** Inter (Regular), full web build (retains all OpenType features:
  `ss01`–`ss20`, `salt`, `tnum`, `zero`, `cv01`–`cv08`, …).
- **Version:** inter-ui 3.19.3.
- **License:** SIL Open Font License 1.1 — see `Inter-OFL-LICENSE.txt`.
- **Copyright:** 2016–2018 The Inter Project Authors (me@rsms.me).
- **Source URL:** https://cdn.jsdelivr.net/npm/inter-ui@3.19.3/Inter%20(web)/Inter-Regular.woff2
- **Project home:** https://rsms.me/inter/ · https://github.com/rsms/inter

Chosen because its stylistic sets are visibly distinct: `ss01` remaps digits
(open digits) — the Gap-9 Phase-0 spike measured a 1342-pixel diff for `"ss01" 1`
on the string `agffistx 0123456789`.
