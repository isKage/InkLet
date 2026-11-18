#!/bin/bash
# Builds the macOS installer (.dmg) and drops it in ./dist/.
#
# Nothing is installed: the .app stays inside the build tree, only the .dmg is
# copied out. Old installers in dist/ are removed first, so what is there is
# always from the current build.
#
# The Rust toolchain lives inside the repo (.toolchains/, gitignored) so the
# system installation is never touched. If hdiutil is not allowed to create disk
# images (some sandboxes), the script falls back to a .zip of the .app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

export CARGO_HOME="$ROOT/.toolchains/cargo"
export RUSTUP_HOME="$ROOT/.toolchains/rustup"
export PATH="$CARGO_HOME/bin:$PATH"

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust toolchain missing. Run: bash scripts/packaging/install-rust.sh" >&2
  exit 1
fi

cd "$ROOT"
VERSION="$(node -p "require('./apps/desktop/package.json').version")"
BUNDLE="$ROOT/apps/desktop/src-tauri/target/release/bundle"
DIST="$ROOT/dist"

# Start from nothing: no stale installer from an earlier build.
rm -rf "$DIST"
mkdir -p "$DIST"
rm -rf "$BUNDLE/dmg" "$BUNDLE/macos" "$BUNDLE"/*.zip 2>/dev/null || true

if ! pnpm --filter @inklet/desktop exec tauri build --bundles app,dmg; then
  cat >&2 <<'NOTE'

dmg bundling failed. In a normal Terminal this usually does not happen; it fails
when `hdiutil` is not allowed to attach disk images (sandboxed or restricted
sessions). Re-run from Terminal.app to get the .dmg. Falling back to a .zip of
InkLet.app so there is still something to upload.
NOTE
  pnpm --filter @inklet/desktop exec tauri build --bundles app
  ditto -c -k --keepParent "$BUNDLE/macos/InkLet.app" "$DIST/InkLet_${VERSION}_aarch64.zip"
fi

# Only the installers leave the build tree.
cp "$BUNDLE/dmg/"*.dmg "$DIST/" 2>/dev/null || true

echo
echo "Installers in dist/:"
ls -lh "$DIST" | tail -n +2
