#!/usr/bin/env bash

set -euo pipefail

cargo_target_dir="${NODEINK_CARGO_TARGET_DIR:-${TMPDIR:-/tmp}/nodeink-cargo-target}"
export CARGO_TARGET_DIR="$cargo_target_dir"

cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
