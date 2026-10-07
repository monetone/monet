#!/bin/bash
# Build native release bundles for all seven Monet apps, sequentially, sharing
# one Cargo target dir so common Rust deps (tauri, serde, …) compile once
# across apps.
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
export CARGO_TARGET_DIR="$REPO_ROOT/target"

RESULTS=/tmp/tauri-build-results.txt
: > "$RESULTS"
echo "START $(date '+%H:%M:%S')" >> "$RESULTS"

# Artisan's tauri beforeBuildCommand is just `vite build`, so its release WASM
# engine must be built first (cinema/vision/galerie build their own via
# beforeBuildCommand; anime, jouer and rythme have no engine).
echo "[$(date '+%H:%M:%S')] artisan engine (release)" >> "$RESULTS"
pnpm --filter monet-artisan run engine:build:release > /tmp/tauri-artisan-engine.log 2>&1
echo "artisan-engine exit=$?" >> "$RESULTS"

for app in artisan cinema jouer rythme vision anime galerie; do
  echo "[$(date '+%H:%M:%S')] === tauri build: $app ===" >> "$RESULTS"
  pnpm --filter "monet-$app" run tauri build > "/tmp/tauri-$app.log" 2>&1
  code=$?
  echo "$app tauri-build exit=$code" >> "$RESULTS"
done

echo "ALL DONE $(date '+%H:%M:%S')" >> "$RESULTS"
echo "=== bundles ===" >> "$RESULTS"
ls -1 "$CARGO_TARGET_DIR"/release/bundle/macos/*.app 2>/dev/null >> "$RESULTS"
ls -1 "$CARGO_TARGET_DIR"/release/bundle/dmg/*.dmg 2>/dev/null >> "$RESULTS"
