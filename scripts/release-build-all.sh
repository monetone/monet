#!/bin/bash
# Build native release bundles for all seven Monet apps, sequentially, sharing
# one Cargo target dir so common Rust deps (tauri, serde, …) compile once
# across apps.
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

RESULTS=/tmp/tauri-build-results.txt
: > "$RESULTS"
echo "START $(date '+%H:%M:%S')" >> "$RESULTS"

# 1. Build shared libraries, release WASM engines, and web bundles BEFORE
# setting CARGO_TARGET_DIR so wasm-pack workspaces (monet-ui vs packages/engine)
# do not collide on unhashed cdylib/rlib artifacts in target/wasm32-unknown-unknown.
unset CARGO_TARGET_DIR
echo "[$(date '+%H:%M:%S')] frontend + engines (release)" >> "$RESULTS"
(
  pnpm run build:libs &&
  pnpm run build:engines &&
  pnpm --filter monet-vision run verify:release &&
  pnpm --filter monet-cinema run build:release &&
  pnpm --filter monet-galerie run build &&
  pnpm --filter monet-artisan run build &&
  pnpm --filter monet-jouer run build &&
  pnpm --filter monet-rythme run build &&
  pnpm --filter monet-anime run build
) > /tmp/tauri-frontend-release.log 2>&1
echo "frontend-release exit=$?" >> "$RESULTS"

export CARGO_TARGET_DIR="$REPO_ROOT/target"
DMG_STAGE="$CARGO_TARGET_DIR/release/bundle/dmg-stage"
rm -rf "$DMG_STAGE"
mkdir -p "$DMG_STAGE"

for app in artisan cinema jouer rythme vision anime galerie; do
  echo "[$(date '+%H:%M:%S')] === tauri build: $app ===" >> "$RESULTS"
  pnpm --filter "monet-$app" exec tauri build -c '{"build":{"beforeBuildCommand":""}}' > "/tmp/tauri-$app.log" 2>&1
  code=$?
  echo "$app tauri-build exit=$code" >> "$RESULTS"
  cp -f "$CARGO_TARGET_DIR"/release/bundle/dmg/*.dmg "$DMG_STAGE"/ 2>/dev/null || true
done

mkdir -p "$CARGO_TARGET_DIR/release/bundle/dmg"
cp -f "$DMG_STAGE"/*.dmg "$CARGO_TARGET_DIR/release/bundle/dmg/" 2>/dev/null || true
rm -rf "$DMG_STAGE"

echo "ALL DONE $(date '+%H:%M:%S')" >> "$RESULTS"
echo "=== bundles ===" >> "$RESULTS"
ls -1d "$CARGO_TARGET_DIR"/release/bundle/macos/*.app 2>/dev/null >> "$RESULTS"
ls -1 "$CARGO_TARGET_DIR"/release/bundle/dmg/*.dmg 2>/dev/null >> "$RESULTS"
