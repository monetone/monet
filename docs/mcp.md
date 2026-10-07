# MCP support across the Monet apps

Every Monet app exposes a local **Model Context Protocol** (MCP) server so an MCP
client — Claude Desktop, Claude Code, the MCP Inspector — can drive the *running*
app: same engine, same document, live UI. New features get MCP support
**automatically**: author a command the `@mcp` way and it becomes a tool with no
extra wiring.

## How it fits together

```
   MCP client (Claude)
        │  JSON-RPC over HTTP  (127.0.0.1:<port>/mcp, Bearer token)
        ▼
┌─────────────────────────────────────────────┐
│ monet-mcp  (Rust Tauri plugin)               │   packages/monet-ui/crates/monet-mcp
│  • tiny_http server on a background thread    │
│  • dumb pipe: forwards each request to the    │
│    webview over Tauri events, returns reply   │
└───────────────┬───────────────────────────────┘
                │  events:  monet://mcp/request · /response · /ready · /hello
                ▼
┌─────────────────────────────────────────────┐
│ @monet-ui/monet-mcp  (TS, in the webview)     │   packages/monet-ui/packages/monet-mcp
│  • createMcpServer(): the MCP protocol core   │   (pure → reusable for a headless host)
│  • startMonetMcp(): the Tauri event bridge    │
│  • codegen: @mcp commands → manifest+handlers │
└───────────────┬───────────────────────────────┘
                ▼
   src/mcp/commands.ts   ← you write these (@mcp-annotated, thin wrappers)
   src/mcp/mcp.manifest.json + mcp.generated.ts   ← generated, committed
```

Why events for the bridge? They're covered by the `core:default` capability that
every app already grants, so **no capability or plugin-ACL changes are needed**.
The Rust side is transport-only; the TS side owns the protocol and the tool
manifest. The protocol core (`createMcpServer`) has no Tauri/DOM dependency, so
the same manifest + handlers can later back a **headless** MCP host (the "both"
host model) without re-implementing anything.

## Adding a command (this is the "automatic" part)

Add a typed, `@mcp`-tagged exported function to the app's `src/mcp/commands.ts`,
delegating to the app's existing action layer:

```ts
/**
 * Apply a Gaussian blur to the active layer.
 * @mcp fil.gaussian
 * @param radius Blur radius in pixels (0..250).
 */
export function gaussian(radius: number): string {
  fil.gaussian(radius);
  return `Gaussian blur r=${radius}`;
}
```

Then regenerate and commit:

```sh
pnpm --filter monet-<app> mcp:codegen
```

Convention:

- `@mcp` marks the function as a tool. Text after it (`@mcp fil.gaussian`) is the
  tool name; otherwise the function name is used.
- The JSDoc summary becomes the tool description.
- Each `@param` becomes a property description; a trailing `(lo..hi)` is parsed
  into JSON-Schema `minimum`/`maximum`.
- Types map: `number`→number, `boolean`→boolean, `string`→string, a union of
  string literals → string `enum`, `T[]` → array. `?`/defaults → optional (and an
  omitted annotation is inferred from a default literal).
- Return a short string — it becomes the tool's text result.

### Keeping it honest

`pnpm --filter monet-<app> mcp:check` fails if the committed manifest/handlers
drift from the source — so a new `@mcp` command that wasn't regenerated breaks
CI. Run it in CI alongside `typecheck`. Add `--strict` to also fail when an
exported command in `commands.ts` lacks an `@mcp` tag.

## Wiring (per app — already done for all seven)

1. `package.json`: dep `@monet-ui/monet-mcp: workspace:*`; scripts
   `mcp:codegen` / `mcp:check`.
2. `mcp.config.json`: `{ app, version, src: ["src/mcp/commands.ts"], out: "src/mcp" }`.
3. `src/mcp/commands.ts` (+ generated `mcp.manifest.json`, `mcp.generated.ts`).
4. `src/mcp/index.ts`: `startMonetMcp({ serverInfo, tools, handlers })`.
5. `src/main.tsx`: start the bridge after boot, native-desktop only.
6. `src-tauri/Cargo.toml`: dep `monet-mcp = { path = "../../../packages/monet-ui/crates/monet-mcp" }`.
7. `src-tauri/src/main.rs`: `.plugin(monet_mcp::init(monet_mcp::McpOptions::new("Monet <App>").port(<port>)))`.

### Ports

| app | port |
|-----|------|
| vision | 48211 |
| artisan | 48212 |
| cinema | 48213 |
| jouer | 48214 |
| rythme | 48215 |
| anime | 48216 |
| galerie | 48217 |

If the port is taken the host tries the next few, then an OS-assigned one. The
actual URL + token are always written to `mcp.json` in the app's config dir and
emitted on `monet://mcp/ready`.

This table is the source of truth for the assignment and is checked against the
apps by `node --test docs/mcp-ports.test.mjs` — adding an app without adding its
row (or reusing a port) fails.

## Connecting a client

Run the app (`pnpm dev:<app>`), then read the URL + token from the app config
dir's `mcp.json` (also printed to stderr on launch). Point your MCP client at the
Streamable-HTTP endpoint with an `Authorization: Bearer <token>` header, e.g.:

```sh
# Claude Code
claude mcp add --transport http monet-vision http://127.0.0.1:48211/mcp \
  --header "Authorization: Bearer <token-from-mcp.json>"
```

The token can also be passed as `?token=<token>` for tools like the MCP
Inspector. The server binds `127.0.0.1` only.

## Long-running tools (jobs)

The Rust bridge is a dumb pipe with a hard **`BRIDGE_TIMEOUT = 60 s`**
(`packages/monet-ui/crates/monet-mcp/src/lib.rs:56`): a request that doesn't reply within a minute
fails with JSON-RPC `-32001`, and there is no streaming or progress channel. Most
`@mcp` tools finish well inside that window, but the heavy on-device ML tools
(diffusion, tiled denoise) can take minutes on wasm.

Those tools therefore return **immediately with a job handle** instead of blocking:

```
ml.generateImage { "prompt": "a red fox in snow", "steps": 12 }
  → { "jobId": 1, "kind": "generateImage", "poll": "ml.jobStatus" }

ml.jobStatus { "jobId": 1 }
  → { "state": "running", "kind": "generateImage", "elapsedMs": 4210,
      "lastMessage": "Diffusing… step 3/12" }
  → { "state": "done", "kind": "generateImage", "elapsedMs": 68120,
      "lastMessage": "Done.", "result": { "ok": true, "w": 512, "h": 512 } }
```

Poll `ml.jobStatus` until `state` is `"done"` (a `result` field is present) or
`"error"` (an `error` field is present). Job tools: `ml.aiDenoise`,
`ml.generativeFillPrompt`, `ml.generateImage`, `ml.generateBackground`.

The bridge only exists under Tauri, so the job flow is smoke-tested **manually**
(not in CI): run `pnpm tauri dev`, point the MCP Inspector at the URL + token from
the app config dir's `mcp.json`, call a job tool, then poll `ml.jobStatus`.

**Single-flight.** The engine is single-document and the ONNX ops mutate it, so
only **one** ML job runs at a time — starting a second while one is `running`
throws (`An ML job is already running …`). The sync ML tools (`ml.selectSubject`,
`ml.removeBackground`, `ml.styleTransfer`, `ml.superResolution`,
`ml.generativeFill`, `ml.generativeExpand`) block and return their result string
directly; they are bounded ONNX passes, but on a pathological (very large)
document they can still hit the 60 s timeout — resize first, or expect `-32001`.

## Missing weights: a structured error, never a silent downgrade

The prompted diffusion tools (`ml.generativeFillPrompt`, `ml.generateImage`,
`ml.generateBackground`) **probe the Stable-Diffusion weights before starting**
and throw a structured MCP error listing exactly which files are missing rather
than quietly producing a prompt-ignoring result:

```
ml.generativeFillPrompt { "prompt": "green grass" }
  → isError: "Stable Diffusion weights not installed — missing
     vae_encoder/model.onnx under /models/sd (see public/models/MODELS.md).
     For prompt-free inpainting use ml.generativeFill."
```

`ml.generativeFillPrompt` additionally needs `vae_encoder/model.onnx` on top of
the core SD weights. When the SD weights are absent, use the prompt-free
`ml.generativeFill` (MI-GAN) — it is a **separate tool**, not a fallback, so a
prompted request never silently becomes a non-prompted one. See
[`public/models/MODELS.md`](../apps/vision/public/models/MODELS.md) for the SD
weight layout and how to install real weights.

## Inspecting available weights (`ml.models`)

`ml.models` reports, per feature, which model files are present and whether the
feature is ready — call it up front to decide what will actually run:

```
ml.models {}
  → [ { "feature": "styles", "files": [ { "path": "candy.onnx", "present": true }, … ], "ready": true },
      { "feature": "u2netp", "files": [ … ], "ready": true },
      { "feature": "sd-core", "files": [ { "path": "sd/unet/model.onnx", "present": true }, … ],
        "ready": true, "note": "demo/placeholder weights" },
      { "feature": "sd-vae_encoder", "files": [ { "path": "sd/vae_encoder/model.onnx", "present": false } ],
        "ready": false } ]
```

Features covered: `styles`, `u2netp`, `super-res`, `migan`, `drunet`, `sd-core`,
`sd-vae_encoder`. Paths are probed through the same resolver the UI uses
(`src/ml/modelSource.ts`), which prefers the real `/models/sd15` set over the
`/models/sd` demo placeholder; the `note: "demo/placeholder weights"` flag is
that resolver's `kind`, not a size heuristic.

## Security posture

- Localhost-only bind; every request requires the bearer token (defense in depth
  on top of the loopback bind).
- The bridge can only invoke the curated `@mcp` commands — never arbitrary code —
  exactly like the scripting console's op allowlist.
- No new filesystem/network capability is granted; the bridge rides existing
  events.
