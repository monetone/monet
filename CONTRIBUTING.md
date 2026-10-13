# Contributing to Monet

Monet is a development preview. Focused bug fixes, tests and documentation are
welcome. For larger changes, discuss the intended behavior in an
[issue](https://github.com/monetone/monet/issues) first. Report vulnerabilities
privately as described in [SECURITY.md](SECURITY.md).

Read the root [AGENTS.md](AGENTS.md) and the affected app or package's
`AGENTS.md` for architecture and conventions. Run the commands below from the
repository root; the vendored Monet UI examples are not root pnpm workspace
members.

## Set up a clean checkout

Install Node.js 24 (see [.nvmrc](.nvmrc)), pnpm 11.1.3, Rust stable and the
[Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/) for
your operating system. macOS requires the Xcode command-line tools; Windows
requires the C++ build tools and WebView2; Linux requires the distribution's
WebKitGTK and other Tauri development packages. Native CI currently covers
macOS and Windows; a Linux native build is not a release guarantee.

```sh
git clone https://github.com/monetone/monet.git
cd monet
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked --version 0.13.1
pnpm install --frozen-lockfile
pnpm build:libs
pnpm build:engines
pnpm dev:vision
```

The shared TypeScript packages, format WASM and app engine bindings are generated
and gitignored. Build them before typechecking or running tests from a clean
checkout. Missing `@engine` imports usually mean the engine build has not run.
For work limited to one engine-backed app, its `engine:build` or
`engine:build:release` script can replace the root engine build; root checks
need all four app outputs. Repeat the appropriate build after shared engine
changes.

Use `pnpm dev:<app>` to launch the native Tauri app. An app's plain `dev` script
starts Vite for browser testing. Optional local AI weights and private signing
credentials are not required for contributor setup. Vision's optional models
are documented in [MODELS.md](apps/vision/public/models/MODELS.md).

## Check a change

Start with the affected app or package. For example:

```sh
pnpm --filter monet-vision run typecheck
pnpm --filter monet-vision run lint
pnpm --filter monet-vision exec vitest run src/state/saveRevision.test.ts
pnpm --filter monet-vision run mcp:check
```

Add or update a regression test when fixing a bug or changing shared behavior.
Tests must pass or fail; do not introduce skipped or focused tests. Shared code
changes need checks in the affected consumers. Before submitting a change that
affects the workspace, run:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm mcp:check
node --test .github/scripts/*.test.mjs
node .github/scripts/verify-no-test-skips.mjs
```

For Rust engine changes, also run
`cargo test --locked --workspace --manifest-path packages/engine/Cargo.toml`.
For native app changes, run that app's Rust tests; Vision provides
`pnpm --filter monet-vision run test:native`, which also compiles the app without
an installer. Each app's README lists its additional checks.

Browser end-to-end tests require their matching browser installation. Vision
uses `pnpm --filter monet-vision exec playwright install chromium webkit`, then
`pnpm --filter monet-vision run test:e2e`. Browser tests and the `desktop` CSP
project do not establish that native dialogs, menus or IPC work; verify those
in the native app. Binary smoke requirements are in
[the release guide](docs/open-source-release.md).

MCP wrappers live in each app's `src/mcp/commands.ts`. After changing one, run
`pnpm mcp:codegen`, include the generated manifest in the change and run
`pnpm mcp:check`.

## Report and submit

For a bug, include the app, commit or version, operating system, reproduction
steps, expected and actual results, and a minimal sample when possible. Remove
personal document data, credentials and local MCP tokens from samples and logs.

Keep pull requests focused. Describe the behavior changed, the reason, the checks
run and any unresolved limitation. Prefer existing helpers and patterns, keep
shared packages reusable, use Monet menus and controls, and use the shared
atomic save helpers for user documents. Documentation and generated contracts
should describe the behavior introduced by the same change.
