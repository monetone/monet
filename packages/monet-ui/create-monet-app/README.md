# create-monet-app

Scaffold a new [Monet](https://github.com/legoless/monet-ui) liquid-glass
desktop app for **Tauri 2** — a React frontend (`@monet-ui/monet-react`) and
Rust backend (`monet-ui`) in a transparent native window with macOS vibrancy,
Windows acrylic, and a solid Linux fallback.

## Usage

```sh
npx create-monet-app my-app
# or pick an accent:
npx create-monet-app my-studio --accent vector
```

Then (Monet is consumed from a git submodule, not a registry):

```sh
cd my-app
git init
git submodule add https://github.com/Legoless/monet-ui vendor/monet-ui
pnpm -C vendor/monet-ui install   # builds the Monet packages
pnpm install                      # links @monet-ui/* from the submodule
pnpm tauri dev                    # launches the Monet desktop app
```

## Options

| Argument            | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `<target-dir>`      | Directory to create the app in (must be empty or non-existent).    |
| `--accent <name>`   | Accent color: `raster`, `vector`, `audio`, or `motion`. Default `raster`. |
| `--help`, `-h`      | Print usage.                                                       |

## What you get

A complete, buildable Tauri 2 app derived from the Monet example apps:

```
my-app/
  package.json          @monet-ui/monet-react + monet-core + @tauri-apps/api + react
  index.html
  vite.config.ts        Vite on port 1421 (strictPort), TAURI_* env prefix
  pnpm-workspace.yaml   approves esbuild's build script (pnpm v10+ gates them)
  tsconfig.json
  src/
    main.tsx            <MonetProvider><App/></MonetProvider>, imports monet-core CSS
    App.tsx             a DockableWorkspace with a menu, canvas, and two panels
    css.d.ts
  src-tauri/
    Cargo.toml          tauri (macos-private-api for macOS) + monet-ui submodule path
    build.rs
    tauri.conf.json     macOSPrivateApi (macOS), transparent window, dev/build commands
    capabilities/default.json
    src/main.rs         MonetWindow::builder(...).accent(...).build()
    icons/
```

## Zero dependencies

The scaffolder uses only Node.js builtins (`node:fs`, `node:path`, `node:url`).
It copies the bundled `template/` directory into your target directory,
substituting the app name and accent into placeholder tokens.

## License

MIT
