#!/bin/bash
# Runs the desktop shell's Rust tests using the repo-local toolchain.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

export CARGO_HOME="$ROOT/.toolchains/cargo"
export RUSTUP_HOME="$ROOT/.toolchains/rustup"
export PATH="$CARGO_HOME/bin:$PATH"

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust toolchain missing. Run: bash scripts/packaging/install-rust.sh" >&2
  exit 1
fi

cargo test --manifest-path "$ROOT/apps/desktop/src-tauri/Cargo.toml" "$@"
