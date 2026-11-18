#!/bin/bash
# Installs a Rust toolchain inside the repo (`.toolchains/`, gitignored) so the
# build never touches a system-wide installation.
#
# The download host can be overridden, e.g. when the mirror is faster:
#   RUSTUP_DIST_SERVER=https://static.rust-lang.org bash scripts/packaging/install-rust.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

export RUSTUP_HOME="$ROOT/.toolchains/rustup"
export CARGO_HOME="$ROOT/.toolchains/cargo"
export RUSTUP_DIST_SERVER="${RUSTUP_DIST_SERVER:-https://rsproxy.cn}"
export RUSTUP_UPDATE_ROOT="${RUSTUP_UPDATE_ROOT:-https://rsproxy.cn/rustup}"

curl --proto '=https' --tlsv1.2 -sSf "$RUSTUP_UPDATE_ROOT/rustup-init.sh" -o /tmp/rustup-init.sh
sh /tmp/rustup-init.sh -y --no-modify-path --profile minimal --default-toolchain stable
source "$CARGO_HOME/env"
echo "--- versions ---"
rustc --version
cargo --version
