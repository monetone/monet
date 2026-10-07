# @monet-ui/monet-core

Framework-free design tokens + stylesheet for **Monet**, the liquid-glass panel design
system for [Tauri 2](https://tauri.app) desktop apps. Ships the CSS (tokens, the full
panel-system stylesheet, the Tauri bare-window/vibrancy layer, controls, overlays, canvas)
and a typed token module (`Accent`, `ACCENTS`, `accentVar`, metrics, radii). **Zero runtime
dependencies.**

## Install

Not published to a registry — consume it directly from the
[monet-ui repo](https://github.com/Legoless/monet-ui) as a git submodule. See the root
README's **“Use Monet in your own app”** for the full recipe; in short:

```sh
git submodule add https://github.com/Legoless/monet-ui vendor/monet-ui
pnpm -C vendor/monet-ui install      # the prepare hook builds dist/
```

```jsonc
// package.json
"@monet-ui/monet-core": "link:vendor/monet-ui/packages/monet-core"
```

## Use

```ts
import "@monet-ui/monet-core/index.css";                         // the whole stylesheet
import { ACCENTS, accentVar, type Accent } from "@monet-ui/monet-core";
```

Individual stylesheets are also exported:
`@monet-ui/monet-core/{tokens,styles,tauri,controls,overlays,canvas}.css`.

Pairs with **[`@monet-ui/monet-react`](../monet-react)** (the React components) and the
**`monet-ui`** Rust crate (Tauri integration).

## License

MIT
