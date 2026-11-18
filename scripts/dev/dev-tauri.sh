#!/bin/bash
# Opens the app in a real desktop window (needs the repo-local Rust toolchain).
# Use `pnpm dev` instead for pure UI work in a browser — but note that the
# browser preview has no file-system access.
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
pnpm --filter @inklet/desktop exec tauri dev
